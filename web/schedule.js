import {pandemicEvents, gameMonth, nextMonthChange, parseBoosts, recommendBoost, kstTime, kstDayStart, kstDate, kstClock, climateSeasons, seasonEffect, DAY, HOUR} from './schedule-core.js';
import {EVENTS, REGIONS, CATEGORY_SEASONS} from './schedule-data.js';

const $ = s => document.querySelector(s);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const BOOST_KEY = 'uwo-boosts';
const VIEW_KEY = 'uwo-schedule-view';
const EVENT_INDEX = Object.fromEntries(EVENTS.map((e, i) => [e.name, i]));
let kind = 'all';

// ---- stored 부양 entries (per browser) ----
function loadBoosts() {
  try {
    const list = JSON.parse(localStorage.getItem(BOOST_KEY)) || [];
    return list.filter(b => Number.isFinite(b.start) && b.city && b.category)
      .map(b => ({kind: 'boost', start: b.start, end: b.start + HOUR, city: String(b.city), category: String(b.category), tariff: Number.isFinite(b.tariff) ? b.tariff : null, goods: recommendBoost(b.category)}));
  } catch { return []; }
}
function saveBoosts(list) {
  try { localStorage.setItem(BOOST_KEY, JSON.stringify(list.map(({start, city, category, tariff}) => ({start, city, category, tariff})))); }
  catch { notice('브라우저 저장 공간을 사용할 수 없어 부양 일정이 새로고침 후 사라져요.'); }
}
let boosts = loadBoosts();
function notice(text) { $('#notice').textContent = text; $('#notice').hidden = !text; }

// ---- formatting ----
function untilText(ms, now) {
  if (ms <= now) return '';
  const minutes = Math.ceil((ms - now) / 60000), h = Math.floor(minutes / 60), m = minutes % 60;
  if (h >= 24) return `${Math.floor(h / 24)}일 ${h % 24}시간`;
  return h ? `${h}시간 ${m}분` : `${m}분`;
}
function timeLabel(ms, now) {
  const dayDiff = Math.round((kstDayStart(ms) - kstDayStart(now)) / DAY);
  return `${dayDiff === 1 ? '내일 ' : dayDiff > 1 ? `${kstDate(ms).slice(5).replace('-', '/')} ` : ''}${kstClock(ms)}`;
}
function goodsHtml(goods) {
  if (!goods.length) return '<p class="goods none">추천 교역품 정보가 아직 없어요.</p>';
  return `<ul class="goods">${goods.map(g => `<li><b>${escape(g.name)}</b>${g.where ? `<small>${escape(g.where)}</small>` : ''}${g.note ? `<small>${escape(g.note)}</small>` : ''}</li>`).join('')}</ul>`;
}

// ---- today list ----
function renderToday(now) {
  const from = now - HOUR, to = now + DAY;
  const items = [
    ...pandemicEvents(from, to),
    ...boosts.filter(b => b.end > now && b.start < to),
    {kind: 'month', start: nextMonthChange(now), end: nextMonthChange(now)},
  ].filter(e => e.end > now || e.kind === 'month')
    .filter(e => e.start < to)
    .filter(e => kind === 'all' || e.kind === kind)
    .filter(e => !$('#only-recommended').checked || (e.goods && e.goods.length))
    .sort((a, b) => a.start - b.start || (a.kind === 'boost' ? -1 : b.kind === 'boost' ? 1 : 0));
  $('#today').innerHTML = items.map(e => {
    const live = e.start <= now && now < e.end;
    const status = e.kind === 'month' ? `${untilText(e.start, now)} 후` : live ? `진행 중 · ${untilText(e.end, now)} 남음` : `시작까지 ${untilText(e.start, now)}`;
    if (e.kind === 'month') return `<li class="event month"><time>${timeLabel(e.start, now)}</time><div><span class="badge badge-month">게임 시간</span><h3>${gameMonth(e.start)}월로 넘어가요</h3></div><span class="event-status">${status}</span></li>`;
    const head = e.kind === 'boost'
      ? `<span class="badge badge-boost">부양</span><h3>${escape(e.city)} · ${escape(e.category)}${e.tariff != null ? ` <small>관세 ${e.tariff}%</small>` : ''}</h3>`
      : `<span class="badge badge-pandemic" data-event="${EVENT_INDEX[e.event]}">대유행 · ${escape(e.event)}</span><h3>${escape(e.region)}</h3><p class="small">${e.categories.join(', ')}</p>`;
    return `<li class="event ${e.kind}${live ? ' live' : ''}"><time>${timeLabel(e.start, now)}</time><div>${head}${goodsHtml(e.goods)}</div><span class="event-status">${status}</span></li>`;
  }).join('') || '<li class="empty-roster">조건에 맞는 일정이 없어요.</li>';
}

// ---- header clock ----
function renderClock(now) {
  $('#now-clock').textContent = kstClock(now) + `:${String(Math.floor(now / 1000) % 60).padStart(2, '0')}`;
  const d = new Date(now + 9 * HOUR);
  $('#now-date').textContent = `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${'일월화수목금토'[d.getUTCDay()]}요일 (KST)`;
  $('#game-month').textContent = `${gameMonth(now)}월`;
  $('#month-change').textContent = `게임 시간 · ${untilText(nextMonthChange(now), now)} 후 ${gameMonth(nextMonthChange(now))}월`;
}

// ---- 부양 input ----
function renderBoosts(now) {
  const upcoming = boosts.slice().sort((a, b) => a.start - b.start);
  $('#boost-list').innerHTML = upcoming.map((b, i) => `<li class="${b.end <= now ? 'past' : ''}"><span><b>${timeLabel(b.start, now)}</b> ${escape(b.city)} · ${escape(b.category)}${b.tariff != null ? ` · 관세 ${b.tariff}%` : ''}</span><button class="text-button" data-remove="${b.start}|${escape(b.city)}|${escape(b.category)}" aria-label="${escape(b.city)} ${escape(b.category)} 부양 삭제">삭제</button></li>`).join('')
    || '<li class="small hint">추가한 부양 일정이 없어요.</li>';
}
$('#boost-add').onclick = () => {
  const {boosts: added, rejected} = parseBoosts($('#boost-text').value, $('#boost-day').value || kstDate(Date.now()), {rollover: 6});
  const key = b => `${b.start}|${b.city}|${b.category}`, existing = new Set(boosts.map(key));
  const fresh = added.filter(b => !existing.has(key(b)));
  boosts = [...boosts, ...fresh]; saveBoosts(boosts);
  $('#boost-result').textContent = `${fresh.length}건 추가${added.length - fresh.length ? ` · 이미 있는 ${added.length - fresh.length}건 제외` : ''}${rejected.length ? ` · 읽지 못한 줄 ${rejected.length}개: ${rejected.slice(0, 3).join(' / ')}${rejected.length > 3 ? ' …' : ''}` : ''}`;
  if (fresh.length) $('#boost-text').value = rejected.join('\n');
  render();
};
$('#boost-list').onclick = e => {
  const b = e.target.closest('[data-remove]'); if (!b) return;
  const [start, city, category] = b.dataset.remove.split('|');
  boosts = boosts.filter(x => !(String(x.start) === start && x.city === city && x.category === category)); saveBoosts(boosts); render();
};
$('#boost-clear-past').onclick = () => { const now = Date.now(); boosts = boosts.filter(b => b.end > now); saveBoosts(boosts); render(); };

// ---- season table ----
function renderSeasons() {
  const month = Number($('#season-month').value);
  const climates = climateSeasons(month);
  const mark = v => v > 0 ? '<span class="up" aria-label="성수기">▲</span>' : v < 0 ? '<span class="down" aria-label="비수기">▼</span>' : '<span class="flat" aria-label="영향 없음">-</span>';
  $('#season-table').innerHTML = `<thead><tr><th>카테고리</th>${climates.map(c => `<th>${c.name}<small>${c.season}</small></th>`).join('')}</tr></thead>`
    + `<tbody>${Object.keys(CATEGORY_SEASONS).map(cat => `<tr><th>${cat}</th>${climates.map(c => `<td>${mark(seasonEffect(cat, c.season))}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

// ---- 대유행 grid ----
function renderGrid() {
  const day = kstTime($('#grid-day').value || kstDate(Date.now()));
  const events = pandemicEvents(day, day + DAY);
  const cell = new Map(events.map(e => [`${e.region}|${Math.round((e.start - day) / HOUR)}`, e]));
  const nowHour = kstDayStart(Date.now()) === day ? Math.floor((Date.now() - day) / HOUR) : -1;
  $('#pandemic-grid').innerHTML = `<thead><tr><th>권역</th>${Array.from({length: 24}, (_, h) => `<th class="${h === nowHour ? 'now' : ''}">${h}</th>`).join('')}</tr></thead>`
    + `<tbody>${REGIONS.map(r => `<tr><th>${r.name}</th>${Array.from({length: 24}, (_, h) => {
      const e = cell.get(`${r.name}|${h}`);
      return e ? `<td class="hit${h === nowHour ? ' now' : ''}" data-event="${EVENT_INDEX[e.event]}" title="${h}시 ${r.name} ${e.event}: ${e.categories.join(', ')}${e.goods.length ? ` · 추천 ${e.goods.map(g => g.name).join(', ')}` : ''}">${e.event}</td>` : `<td class="${h === nowHour ? 'now' : ''}"></td>`;
    }).join('')}</tr>`).join('')}</tbody>`;
  $('#grid-legend').innerHTML = EVENTS.map((e, i) => `<span data-event="${i}">${e.name}</span> ${e.categories.join('·')}`).join(' &nbsp; ');
}

// ---- wiring ----
function render() { const now = Date.now(); renderClock(now); renderToday(now); renderBoosts(now); }
function restoreView() {
  try { const v = JSON.parse(localStorage.getItem(VIEW_KEY)) || {}; if (['all', 'pandemic', 'boost'].includes(v.kind)) kind = v.kind; $('#only-recommended').checked = !!v.onlyRecommended; } catch { /* defaults */ }
  document.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
}
function saveView() { try { localStorage.setItem(VIEW_KEY, JSON.stringify({kind, onlyRecommended: $('#only-recommended').checked})); } catch { /* optional */ } }
document.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => {
  kind = b.dataset.kind; document.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); saveView(); render();
});
$('#only-recommended').onchange = () => { saveView(); render(); };
const today = kstDate(Date.now());
$('#boost-day').value = today; $('#grid-day').value = today;
$('#grid-day').onchange = renderGrid;
$('#season-month').innerHTML = Array.from({length: 12}, (_, i) => `<option value="${i + 1}">${i + 1}월</option>`).join('');
$('#season-month').value = String(gameMonth(Date.now()));
$('#season-month').onchange = renderSeasons;
$('#about').onclick = () => $('#about-dialog').showModal();
$('#about-close').onclick = () => $('#about-dialog').close();
restoreView(); render(); renderSeasons(); renderGrid();
let lastMinute = Math.floor(Date.now() / 60000), lastMonth = gameMonth(Date.now());
setInterval(() => {
  const now = Date.now(); renderClock(now);
  if (Math.floor(now / 60000) !== lastMinute) { lastMinute = Math.floor(now / 60000); renderToday(now); renderBoosts(now); }
  if (gameMonth(now) !== lastMonth) { lastMonth = gameMonth(now); $('#season-month').value = String(lastMonth); renderSeasons(); renderGrid(); }
}, 1000);
