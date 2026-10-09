const $ = s => document.querySelector(s);
const KEY = 'uwo-arrival-settings';
const SETTINGS_VERSION = 2;
const DEFAULTS = { threshold: 0.8, cooldown: 90, sound: true, tone: 'chime', volume: 0.6, repeat: 3, discord: false, webhook: '',
  message: '⚓ {place}에 도착했어요! ({time})' };
const STRONG_MARGIN = 0.03; // one frame this far above the threshold alerts immediately (negatives measured at or below 0.55)
const MIN_FRAME_GAP = 600; // ms between frames handed to the worker; arrival screens stay up for seconds, so ~1.5 checks/s is plenty
const DEBUG = new URLSearchParams(location.search).has('debug'); // ?debug shows the log and screenshot test tools
const TONE_KEYS = ['confirm', 'melody', 'glass', 'low', 'chime', 'beep', 'sharp', 'horn'];
const settings = { ...DEFAULTS, ...load() };
const originalTitle = document.title;
let worker, stream, track, reader, fallbackTimer, staleTimer, flashTimer;
let busy = false, lastSent = 0, lastFrameAt = 0, lastAlertAt = 0, streak = 0, detectCount = 0;
let audio;
const log = [];
const recent = []; // {ts, score, name} for the rolling best-score readout
const testWaiters = new Map();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY)) || {};
    if (saved.version !== SETTINGS_VERSION) saved.threshold = DEFAULTS.threshold; // older saves kept a lower default
    if (saved.tone && !TONE_KEYS.includes(saved.tone)) delete saved.tone; // tones removed in a later version
    const picked = {};
    for (const key of Object.keys(DEFAULTS)) if (key in saved) picked[key] = saved[key];
    return picked;
  } catch { return {}; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify({ ...settings, version: SETTINGS_VERSION })); } catch { /* private mode */ } }
function notice(text, kind = '') { const el = $('#notice'); el.textContent = text; el.className = kind; el.hidden = !text; }
function fmtTime(d = new Date()) { return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function setState(text, active) { $('#capture-state').textContent = text; const chip = $('#state-chip'); chip.textContent = active ? '감시 중' : text; chip.classList.toggle('active', !!active); }

// ---- settings binding ----
function bindSettings() {
  for (const el of document.querySelectorAll('[data-setting]')) {
    const key = el.dataset.setting;
    if (el.type === 'checkbox') el.checked = !!settings[key]; else el.value = settings[key];
    if (el.dataset.bound) continue;
    el.dataset.bound = '1';
    el.addEventListener(el.type === 'checkbox' || el.type === 'number' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      settings[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value.trim();
      if (key === 'tone') { unlockAudio(); preloadTone(); }
      save(); renderSettings();
    });
  }
}
function renderSettings() {
  $('#threshold-value').value = settings.threshold.toFixed(2);
  $('#meter-mark').style.left = `${settings.threshold * 100}%`;
  if (settings.discord && !isDiscordUrl(settings.webhook)) $('#discord-state').textContent = settings.webhook ? '디스코드 웹훅 URL 형식이 아니에요.' : '웹훅 URL을 입력해 주세요.';
}
$('#settings-reset').onclick = () => {
  if (!confirm('알림 설정을 기본값으로 되돌릴까요? 웹훅 URL도 지워져요.')) return;
  Object.assign(settings, DEFAULTS); save(); bindSettings(); $('#discord-state').textContent = ''; renderSettings(); notice('설정을 기본값으로 되돌렸어요.');
};
$('#webhook-toggle').onclick = () => {
  const input = $('#webhook'), show = input.type === 'password';
  input.type = show ? 'text' : 'password'; $('#webhook-toggle').textContent = show ? '숨기기' : '표시';
};
function isDiscordUrl(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && /(^|\.)discord(app)?\.com$/.test(u.hostname) && u.pathname.startsWith('/api/webhooks/'); } catch { return false; }
}
$('#about').onclick = () => $('#about-dialog').showModal();
$('#about-close').onclick = () => $('#about-dialog').close();

// ---- capture ----
const supported = !!navigator.mediaDevices?.getDisplayMedia;
if (!supported) { $('#start').disabled = true; $('#capture-support').textContent = '이 브라우저는 화면 캡처를 지원하지 않아요. PC의 크롬이나 엣지에서 열어 주세요.'; }
else if (!('MediaStreamTrackProcessor' in window)) $('#capture-support').textContent = '이 브라우저에서는 0.7초 간격으로 검사해요. 크롬·엣지가 더 안정적이에요.';

$('#start').onclick = startCapture;
$('#stop').onclick = () => stopCapture('캡처를 중지했어요.');

async function startCapture() {
  try {
    unlockAudio();
    setState('창 선택 중', false);
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 2, max: 3 } }, audio: false,
      selfBrowserSurface: 'exclude', surfaceSwitching: 'include', monitorTypeSurfaces: 'include', preferCurrentTab: false });
  } catch (error) {
    setState('대기', false);
    notice(error.name === 'NotAllowedError' ? '캡처할 창을 선택하지 않았어요.' : `캡처를 시작하지 못했어요: ${error.message}`, 'error');
    return;
  }
  track = stream.getVideoTracks()[0];
  track.addEventListener('ended', () => stopCapture('게임 창 공유가 끝났어요. 다시 캡처를 시작해 주세요.'));
  $('#preview').srcObject = stream; $('#preview-empty').hidden = true;
  $('#start').hidden = true; $('#stop').hidden = false; setState('감시 중', true);
  const label = (track.label || '').replace(/^window:|^screen:/, '').trim();
  notice(label ? `‘${label}’ 창을 감시하고 있어요. 이 탭은 닫지 말고 다른 일을 하셔도 돼요.` : '감시를 시작했어요. 이 탭은 닫지 말고 다른 일을 하셔도 돼요.');
  ensureWorker(); preloadTone(); busy = false; streak = 0; lastFrameAt = Date.now();
  if ('MediaStreamTrackProcessor' in window) {
    reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    pump(reader);
  } else {
    fallbackTimer = setInterval(grabFromVideo, 700);
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
  $('#start').hidden = false; $('#stop').hidden = true; setState('대기', false); $('#stale-line').hidden = true;
  busy = false;
  if (message) notice(message);
}
function checkStale() {
  if (!stream) return;
  const gap = Date.now() - lastFrameAt;
  if (gap > 10000) { $('#stale-line').textContent = `${Math.round(gap / 1000)}초 동안 새 화면이 들어오지 않아요. 게임 창이 최소화되어 있지 않은지 확인해 주세요.`; $('#stale-line').hidden = false; }
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
  recent.push({ ts: r.ts, score: r.score, name: r.name });
  while (recent.length && r.ts - recent[0].ts > 30000) recent.shift();
  const peak = recent.reduce((m, e) => e.score > m.score ? e : m, recent[0]);
  $('#detect-line').textContent = DEBUG ? `유사도 ${r.score.toFixed(2)} · 최근 30초 최고 ${peak.score.toFixed(2)} (${peak.name || '-'})` : `도착 화면 유사도 ${r.score.toFixed(2)} · 감시 중`;
  $('#detect-tech').textContent = `${fmtTime(new Date(r.ts))} 검사 · ${r.frameWidth}×${r.frameHeight} · ${r.ms}ms`;
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
  log.unshift(entry); renderLog(); $('#log-box').open = true;
  notice(`⚓ ${fmtTime(when)} ${place} 도착을 감지했어요.`);
  flashTitle(`⚓ ${place} 도착!`);
  if (settings.sound) { playChime(); entry.channels.push('소리'); }
  if (settings.discord) entry.channels.push(await sendDiscord(text) ? '디스코드' : '디스코드 실패');
  renderLog();
}
function renderLog() {
  const ul = $('#log');
  ul.innerHTML = log.length ? log.slice(0, 50).map(e => `<li><b>${fmtTime(e.when)}</b> ${e.place} 도착 · 유사도 ${e.score.toFixed(2)}${e.channels.length ? ` · ${e.channels.join(', ')}` : ''}</li>`).join('')
    : '<li class="small hint">아직 감지된 도착이 없어요.</li>';
}
$('#log-clear').onclick = () => { log.length = 0; renderLog(); };

function unlockAudio() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch { /* no audio */ }
}
// One synthesised note: oscillator -> optional low-pass -> envelope -> output.
function note(out, { type = 'sine', freq, at, dur, attack = 0.01, level = 1, lowpass }) {
  const osc = audio.createOscillator(), gain = audio.createGain();
  osc.type = type; osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  let node = osc;
  if (lowpass) { const f = audio.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; node = osc.connect(f); }
  node.connect(gain).connect(out); osc.start(at); osc.stop(at + dur + 0.05);
}
// Eight alert sounds with distinct characters: four CC0 recordings from Kenney's Interface Sounds
// (web/sounds, see LICENSE.txt there) and four synthesised tones in the style of popular timer sites.
const TONES = {
  confirm: { label: '확인음 (파일)', file: './sounds/confirmation_001.ogg', length: 0.6 },
  melody: { label: '확인 멜로디 (파일)', file: './sounds/confirmation_002.ogg', length: 1.0 },
  glass: { label: '유리 딩 (파일)', file: './sounds/glass_004.ogg', length: 0.8 },
  low: { label: '낮은 톤 (파일)', file: './sounds/question_004.ogg', length: 0.5 },
  chime: { label: '차임 3음', length: 0.9, play(out, t) { [[880, 0], [1175, 0.18], [1568, 0.36]].forEach(([freq, o]) => note(out, { freq, at: t + o, dur: 0.45, attack: 0.02, level: 0.8 })); } },
  beep: { label: '기본 비프', length: 0.3, play(out, t) { note(out, { freq: 800, at: t, dur: 0.2, attack: 0.005, level: 0.7 }); } },
  sharp: { label: '날카로운 비프', length: 0.25, play(out, t) { note(out, { type: 'square', freq: 1200, at: t, dur: 0.15, attack: 0.005, level: 0.25 }); } },
  horn: { label: '뱃고동', length: 1.4, play(out, t) { note(out, { type: 'sawtooth', freq: 110, at: t, dur: 1.2, attack: 0.12, level: 0.6, lowpass: 420 }); note(out, { type: 'sawtooth', freq: 165, at: t, dur: 1.2, attack: 0.12, level: 0.35, lowpass: 520 }); } },
};
const buffers = new Map(); // decoded file tones, loaded on demand and cached
async function loadBuffer(url) {
  if (buffers.has(url)) return buffers.get(url);
  const promise = fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }).then(bytes => audio.decodeAudioData(bytes));
  buffers.set(url, promise);
  promise.catch(() => buffers.delete(url));
  return promise;
}
function preloadTone(key = settings.tone) { const tone = TONES[key]; if (tone?.file && audio) loadBuffer(tone.file).catch(() => {}); }
async function playChime(repeat = settings.repeat, volume = settings.volume, toneKey = settings.tone) {
  unlockAudio(); if (!audio) return;
  const tone = TONES[toneKey] || TONES.chime;
  const master = audio.createGain(); master.gain.value = Math.max(0, Math.min(1, volume)); master.connect(audio.destination);
  const times = Math.max(1, repeat);
  if (tone.file) {
    let buffer;
    try { buffer = await loadBuffer(tone.file); } catch { return playChime(repeat, volume, 'chime'); } // fall back to a synthesised tone
    const start = audio.currentTime + 0.05, gap = Math.max(tone.length, buffer.duration) + 0.25;
    for (let n = 0; n < times; n++) { const src = audio.createBufferSource(); src.buffer = buffer; src.connect(master); src.start(start + n * gap); }
    return;
  }
  const start = audio.currentTime + 0.05;
  for (let n = 0; n < times; n++) tone.play(master, start + n * (tone.length + 0.25));
}
$('#tone').innerHTML = Object.entries(TONES).map(([key, tone]) => `<option value="${key}">${tone.label}</option>`).join('');
$('#sound-test').onclick = () => playChime(1);

async function sendDiscord(content) {
  if (!isDiscordUrl(settings.webhook)) { $('#discord-state').textContent = settings.webhook ? '디스코드 웹훅 URL 형식이 아니에요.' : '웹훅 URL을 입력해 주세요.'; return false; }
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
    const hit = r.score >= settings.threshold;
    box.insertAdjacentHTML('beforeend', `<div class="test-row ${hit ? 'hit' : ''}"><span>${file.name}</span><b>${r.score >= 0 ? r.score.toFixed(2) : '오류'}</b><small>${hit ? `${r.name} 도착으로 판정` : '도착 아님'} · ${r.frameWidth || '?'}×${r.frameHeight || '?'} · ${r.ms ?? '-'}ms</small></div>`);
  }
};
async function testImage(blob, name = String(Date.now()), options) {
  ensureWorker();
  const bmp = await createImageBitmap(blob);
  const id = `${name}#${Math.random().toString(36).slice(2)}`;
  return new Promise(resolve => { testWaiters.set(id, resolve); worker.postMessage({ type: 'frame', image: bmp, ts: Date.now(), test: id, options }, [bmp]); });
}
window.arrivalTestImage = testImage; // used by automated checks

document.querySelectorAll('[data-debug]').forEach(el => { el.hidden = !DEBUG; });
bindSettings();
renderSettings();
save();
