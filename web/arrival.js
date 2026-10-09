const $ = s => document.querySelector(s);
const KEY = 'uwo-arrival-settings';
const DEFAULTS = { threshold: 0.75, cooldown: 90, sound: true, volume: 0.6, repeat: 3, notify: false, discord: false, webhook: '',
  message: '⚓ {place}에 도착했어요! ({time})', titleFlash: true };
const STRONG_MARGIN = 0.12; // one frame this far above the threshold alerts immediately
const MIN_FRAME_GAP = 300; // ms between frames handed to the worker
const settings = { ...DEFAULTS, ...load() };
const originalTitle = document.title;
let worker, stream, track, reader, fallbackTimer, staleTimer, flashTimer;
let busy = false, lastSent = 0, lastFrameAt = 0, lastAlertAt = 0, streak = 0, detectCount = 0;
let audio;
const log = [];
const testWaiters = new Map();

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ } }
function notice(text, kind = '') { const el = $('#notice'); el.textContent = text; el.className = kind; el.hidden = !text; }
function fmtTime(d = new Date()) { return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

// ---- settings binding ----
for (const el of document.querySelectorAll('[data-setting]')) {
  const key = el.dataset.setting;
  if (el.type === 'checkbox') el.checked = !!settings[key]; else el.value = settings[key];
  el.addEventListener(el.type === 'range' || el.type === 'text' || el.type === 'url' ? 'input' : 'change', () => {
    settings[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value.trim();
    if (key === 'notify' && el.checked) requestNotifyPermission();
    save(); renderSettings();
  });
}
function renderSettings() {
  $('#threshold-value').value = settings.threshold.toFixed(2);
  $('#meter-mark').style.left = `${settings.threshold * 100}%`;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  $('#notify-state').textContent = perm === 'unsupported' ? '이 브라우저는 시스템 알림을 지원하지 않아요.'
    : perm === 'granted' ? '알림 권한이 허용되어 있어요.' : perm === 'denied' ? '알림 권한이 차단되어 있어요. 주소창 자물쇠 아이콘에서 허용해 주세요.' : '체크하면 알림 권한을 요청해요.';
  $('#discord-state').textContent = settings.discord && !isDiscordUrl(settings.webhook) ? '디스코드 웹훅 URL 형식이 아니에요.' : '';
}
async function requestNotifyPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') await Notification.requestPermission();
  renderSettings();
}
function isDiscordUrl(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && /(^|\.)discord(app)?\.com$/.test(u.hostname) && u.pathname.startsWith('/api/webhooks/'); } catch { return false; }
}

// ---- capture ----
const supported = !!navigator.mediaDevices?.getDisplayMedia;
if (!supported) { $('#start').disabled = true; $('#capture-support').textContent = '이 브라우저는 화면 캡처를 지원하지 않아요. PC의 크롬이나 엣지에서 열어 주세요.'; }
else if (!('MediaStreamTrackProcessor' in window)) $('#capture-support').textContent = '이 브라우저에서는 0.5초 간격으로 검사해요. 크롬·엣지가 더 안정적이에요.';

$('#start').onclick = startCapture;
$('#stop').onclick = () => stopCapture('캡처를 중지했어요.');

async function startCapture() {
  try {
    unlockAudio();
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 4, max: 5 } }, audio: false,
      selfBrowserSurface: 'exclude', surfaceSwitching: 'include', monitorTypeSurfaces: 'include', preferCurrentTab: false });
  } catch (error) {
    notice(error.name === 'NotAllowedError' ? '캡처할 창을 선택하지 않았어요.' : `캡처를 시작하지 못했어요: ${error.message}`, 'error');
    return;
  }
  track = stream.getVideoTracks()[0];
  track.addEventListener('ended', () => stopCapture('게임 창 공유가 끝났어요. 다시 캡처를 시작해 주세요.'));
  $('#preview').srcObject = stream; $('#preview-empty').hidden = true;
  $('#start').hidden = true; $('#stop').hidden = false; $('#capture-state').textContent = '감시 중';
  const label = track.label || '';
  notice(label ? `‘${label}’ 창을 감시하고 있어요. 이 탭은 닫지 말고 다른 일을 하셔도 돼요.` : '감시를 시작했어요. 이 탭은 닫지 말고 다른 일을 하셔도 돼요.');
  ensureWorker(); busy = false; streak = 0; lastFrameAt = Date.now();
  if ('MediaStreamTrackProcessor' in window) {
    reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    pump(reader);
  } else {
    fallbackTimer = setInterval(grabFromVideo, 500);
  }
  clearInterval(staleTimer);
  staleTimer = setInterval(checkStale, 5000);
}
async function pump(r) {
  try {
    for (;;) {
      const { value: frame, done } = await r.read();
      if (done) break;
      offerFrame(frame);
    }
  } catch { /* reader cancelled */ }
}
function offerFrame(frame) {
  const now = performance.now();
  lastFrameAt = Date.now(); $('#stale-line').hidden = true;
  if (busy || now - lastSent < MIN_FRAME_GAP) { frame.close(); return; }
  busy = true; lastSent = now;
  worker.postMessage({ type: 'frame', image: frame, ts: Date.now() }, [frame]);
}
async function grabFromVideo() {
  const video = $('#preview');
  if (busy || video.readyState < 2) return;
  busy = true; lastSent = performance.now(); lastFrameAt = Date.now(); $('#stale-line').hidden = true;
  try { const bmp = await createImageBitmap(video); worker.postMessage({ type: 'frame', image: bmp, ts: Date.now() }, [bmp]); }
  catch { busy = false; }
}
function stopCapture(message) {
  reader?.cancel().catch(() => {}); reader = null;
  clearInterval(fallbackTimer); clearInterval(staleTimer);
  stream?.getTracks().forEach(t => t.stop()); stream = track = null;
  $('#preview').srcObject = null; $('#preview-empty').hidden = false; $('#match-box').hidden = true;
  $('#start').hidden = false; $('#stop').hidden = true; $('#capture-state').textContent = '대기'; $('#stale-line').hidden = true;
  busy = false;
  if (message) notice(message);
}
function checkStale() {
  if (!stream) return;
  const gap = Date.now() - lastFrameAt;
  if (gap > 10000) { $('#stale-line').textContent = `${Math.round(gap / 1000)}초 동안 새 프레임이 없어요. 게임 창이 최소화되어 있거나 가려져 있지 않은지 확인해 주세요.`; $('#stale-line').hidden = false; }
}
window.addEventListener('pagehide', () => stopCapture());

// ---- worker ----
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker('./detect-worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.test !== undefined) { testWaiters.get(data.test)?.(data); testWaiters.delete(data.test); return; }
    busy = false;
    if (data.type === 'error') { $('#detect-line').textContent = `검사 오류: ${data.message}`; return; }
    onResult(data);
  };
  worker.onerror = e => { busy = false; notice(`감지 모듈 오류: ${e.message}`, 'error'); };
  return worker;
}
function onResult(r) {
  renderResult(r);
  const hit = r.score >= settings.threshold;
  streak = hit ? streak + 1 : 0;
  const strong = r.score >= settings.threshold + STRONG_MARGIN;
  if ((streak >= 2 || (hit && strong)) && Date.now() - lastAlertAt > settings.cooldown * 1000) {
    lastAlertAt = Date.now(); streak = 0;
    fireAlert(r);
  }
}
function renderResult(r) {
  const pct = Math.max(0, Math.min(1, r.score)) * 100;
  const fill = $('#meter-fill'); fill.style.width = `${pct}%`; fill.classList.toggle('hit', r.score >= settings.threshold);
  $('#detect-line').textContent = `${fmtTime(new Date(r.ts))} 검사 · 유사도 ${r.score.toFixed(2)} (${r.name || '-'}) · ${r.frameWidth}×${r.frameHeight} · ${r.ms}ms`;
  const box = $('#match-box'), video = $('#preview');
  if (r.score >= settings.threshold - 0.2 && video.videoWidth) {
    const sx = video.clientWidth / r.frameWidth, sy = video.clientHeight / r.frameHeight;
    Object.assign(box.style, { left: `${r.x * sx}px`, top: `${r.y * sy}px`, width: `${r.boxW * sx}px`, height: `${r.boxH * sy}px` });
    box.classList.toggle('hit', r.score >= settings.threshold); box.hidden = false;
  } else box.hidden = true;
}

// ---- alerts ----
async function fireAlert(r) {
  const when = new Date(r.ts || Date.now());
  const place = r.name || '목적지';
  const text = (settings.message || DEFAULTS.message).replaceAll('{place}', place).replaceAll('{time}', fmtTime(when));
  const entry = { when, place, score: r.score, channels: [] };
  detectCount++; $('#detect-count').textContent = detectCount;
  log.unshift(entry); renderLog();
  if (settings.sound) { playChime(); entry.channels.push('소리'); }
  if (settings.titleFlash) flashTitle(`⚓ ${place} 도착!`);
  if (settings.notify) entry.channels.push(await showNotification(place, text) ? '알림' : '알림 실패');
  if (settings.discord) entry.channels.push(await sendDiscord(text) ? '디스코드' : '디스코드 실패');
  renderLog();
}
function renderLog() {
  const ul = $('#log');
  ul.innerHTML = log.length ? log.slice(0, 50).map(e => `<li><b>${fmtTime(e.when)}</b> ${e.place} 도착 감지 · 유사도 ${e.score.toFixed(2)}${e.channels.length ? ` · ${e.channels.join(', ')}` : ''}</li>`).join('')
    : '<li class="small hint">아직 감지된 도착이 없어요.</li>';
}
$('#log-clear').onclick = () => { log.length = 0; renderLog(); };

function unlockAudio() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch { /* no audio */ }
}
function playChime(repeat = settings.repeat, volume = settings.volume) {
  unlockAudio(); if (!audio) return;
  const start = audio.currentTime + 0.05;
  for (let n = 0; n < Math.max(1, repeat); n++) {
    [[880, 0], [1175, 0.18], [1568, 0.36]].forEach(([freq, offset]) => {
      const t = start + n * 1.1 + offset, osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      osc.connect(gain).connect(audio.destination); osc.start(t); osc.stop(t + 0.45);
    });
  }
}
$('#sound-test').onclick = () => playChime(1);

async function showNotification(place, body) {
  if (!('Notification' in window)) return false;
  if (Notification.permission !== 'granted') { await requestNotifyPermission(); if (Notification.permission !== 'granted') return false; }
  try { const n = new Notification(`${place} 도착`, { body, tag: 'uwo-arrival', requireInteraction: true, icon: './favicon.svg' }); n.onclick = () => { window.focus(); n.close(); }; return true; }
  catch { return false; }
}
$('#notify-test').onclick = async () => { const ok = await showNotification('테스트', '이렇게 알림이 떠요.'); if (!ok) notice('알림을 띄우지 못했어요. 권한 상태를 확인해 주세요.', 'error'); };

async function sendDiscord(content) {
  if (!isDiscordUrl(settings.webhook)) { $('#discord-state').textContent = '디스코드 웹훅 URL 형식이 아니에요.'; return false; }
  try {
    const res = await fetch(settings.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, username: '항로 입항 알림' }) });
    if (!res.ok) { $('#discord-state').textContent = `디스코드 응답 오류 ${res.status}`; return false; }
    $('#discord-state').textContent = `${fmtTime()} 디스코드로 보냈어요.`; return true;
  } catch (error) { $('#discord-state').textContent = `디스코드 전송 실패: ${error.message}`; return false; }
}
$('#discord-test').onclick = () => sendDiscord((settings.message || DEFAULTS.message).replaceAll('{place}', '테스트').replaceAll('{time}', fmtTime()));

function flashTitle(text) {
  clearInterval(flashTimer); let on = false; const started = Date.now();
  flashTimer = setInterval(() => { on = !on; document.title = on ? text : originalTitle; if (Date.now() - started > 60000 || (document.hasFocus() && !document.hidden)) { clearInterval(flashTimer); document.title = originalTitle; } }, 800);
}

// ---- screenshot test mode ----
$('#test-files').onchange = async e => {
  const files = [...e.target.files]; e.target.value = '';
  const box = $('#test-results'); box.innerHTML = '';
  for (const file of files) {
    const r = await testImage(file, file.name);
    box.insertAdjacentHTML('beforeend', `<div class="test-row ${r.score >= settings.threshold ? 'hit' : ''}"><span>${file.name}</span><b>${r.score >= 0 ? r.score.toFixed(2) : '오류'}</b><small>${r.name || ''} · ${r.frameWidth || '?'}×${r.frameHeight || '?'} · ${r.ms ?? '-'}ms</small></div>`);
  }
};
async function testImage(blob, name = String(Date.now())) {
  ensureWorker();
  const bmp = await createImageBitmap(blob);
  const id = `${name}#${Math.random().toString(36).slice(2)}`;
  return new Promise(resolve => { testWaiters.set(id, resolve); worker.postMessage({ type: 'frame', image: bmp, ts: Date.now(), test: id }, [bmp]); });
}
window.arrivalTestImage = testImage; // used by automated checks

renderSettings();
