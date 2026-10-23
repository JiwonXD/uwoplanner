import {pandemicEvents, gameMonth, parseBoosts, recommendBoost, kstDate, kstClock, DAY, HOUR} from './schedule-core.js';

const $ = s => document.querySelector(s);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const BOOST_KEY = 'uwo-boosts';

// ---- stored 부양 entries (per browser) ----
function loadBoosts() {
  try {
    const list = JSON.parse(localStorage.getItem(BOOST_KEY)) || [];
    return list.filter(b => Number.isFinite(b.start) && b.city && b.category)
      .map(b => ({kind: 'boost', start: b.start, end: b.start + HOUR, city: String(b.city), category: String(b.category), tariff: Number.isFinite(b.tariff) ? b.tariff : null,
        goods: Array.isArray(b.goods) && b.goods.length ? b.goods.filter(x => x && x.name).map(x => ({name: String(x.name), ...(x.where ? {where: String(x.where)} : {})})) : recommendBoost(b.category)}));
  } catch { return []; }
}
function saveBoosts(list) {
  try { localStorage.setItem(BOOST_KEY, JSON.stringify(list.map(({start, city, category, tariff, goods}) => ({start, city, category, tariff, goods})))); }
  catch { notice('브라우저 저장 공간을 사용할 수 없어 부양 일정이 새로고침 후 사라져요.'); }
}
let boosts = loadBoosts();
function notice(text) { $('#notice').textContent = text; $('#notice').hidden = !text; }

// ---- event table: the in-game 교역 이벤트 일정 columns plus what to sell ----
const categoryCell = c => { const name = c.replace(/\(.*\)/, ''); return `<span class="cat"${name !== c ? ` title="${escape(c)}"` : ''}>${escape(name)}</span>`; };
const goodCell = g => { const tip = [g.where, g.note].filter(Boolean).join(', '); return `<span class="good"${tip ? ` title="${escape(tip)}"` : ''}>${escape(g.name)}</span>`; };
function stamp(ms) { const [y, mo, d] = kstDate(ms).split('-'); return `<span class="stamp"><span>${y}/${mo}/${d}</span><span>${kstClock(ms)}</span></span>`; }
function renderToday(now) {
  const items = [...pandemicEvents(now - 2 * HOUR, now + DAY), ...boosts.filter(b => b.end > now && b.start < now + DAY)]
    .filter(e => e.end > now)
    .sort((a, b) => a.start - b.start || (a.kind === 'boost' ? -1 : 1));
  const rows = items.map(e => {
    const live = e.start <= now;
    const kindCell = e.kind === 'boost' ? '<span class="pill pill-boost">부양</span>'
      : `<span class="pill pill-pandemic" title="${escape(e.event)}">대유행</span>`;
    const goodsCell = e.kind === 'boost' ? categoryCell(e.category) : e.categories.map(categoryCell).join('');
    const where = e.kind === 'boost' ? `<b>${escape(e.city)}</b>${e.tariff != null ? `<small>관세 : ${e.tariff}%</small>` : ''}` : `<b>${escape(e.region)}</b>`;
    const recommend = e.goods.length ? e.goods.map(goodCell).join('') : '<span class="none">-</span>';
    return `<div class="et-row${live ? ' live' : ''}" role="row"><span role="cell" class="et-kind">${kindCell}</span><span role="cell" class="et-goods">${goodsCell}</span>`
      + `<span role="cell" class="et-rec">${recommend}</span>`
      + `<span role="cell" class="et-period">${stamp(e.start)}<span class="tilde">~</span>${stamp(e.end)}</span><span role="cell" class="et-where">${where}</span></div>`;
  }).join('');
  $('#today').innerHTML = '<div class="et-head" role="row"><span role="columnheader">행사</span><span role="columnheader">교역품</span><span role="columnheader">추천</span><span role="columnheader">기간</span><span role="columnheader">위치</span></div>'
    + (rows || '<p class="empty-roster">예정된 일정이 없어요.</p>');
}

// ---- 부양 input ----
function renderBoosts(now) {
  $('#boost-list').innerHTML = boosts.filter(b => b.end > now).sort((a, b) => a.start - b.start)
    .map(b => `<li><span>${kstDate(b.start).slice(5).replace('-', '/')} ${kstClock(b.start)} ${escape(b.city)} ${escape(b.category)}</span><button class="icon-button" data-remove="${b.start}|${escape(b.city)}|${escape(b.category)}" title="삭제" aria-label="${escape(b.city)} ${escape(b.category)} 부양 삭제">✕</button></li>`).join('');
}
$('#boost-add').onclick = () => {
  const now = Date.now();
  const {boosts: added, rejected} = parseBoosts($('#boost-text').value, kstDate(now), {now});
  const key = b => `${b.start}|${b.city}|${b.category}`, existing = new Set(boosts.map(key));
  const fresh = added.filter(b => !existing.has(key(b)));
  boosts = [...boosts.filter(b => b.end > now - DAY), ...fresh]; saveBoosts(boosts); // forget entries older than a day
  $('#boost-result').textContent = `＋${fresh.length}${rejected.length ? `  ✕${rejected.length}` : ''}`;
  $('#boost-result').title = rejected.length ? `읽지 못한 줄\n${rejected.join('\n')}` : '';
  if (fresh.length) $('#boost-text').value = rejected.join('\n');
  render();
};
$('#boost-list').onclick = e => {
  const b = e.target.closest('[data-remove]'); if (!b) return;
  const [start, city, category] = b.dataset.remove.split('|');
  boosts = boosts.filter(x => !(String(x.start) === start && x.city === city && x.category === category)); saveBoosts(boosts); render();
};

// ---- wiring ----
function renderClock(now) { $('#now-clock').textContent = kstClock(now); $('#game-month').textContent = `${gameMonth(now)}월`; }
function render() { const now = Date.now(); renderClock(now); renderToday(now); renderBoosts(now); }
$('#about').onclick = () => $('#about-dialog').showModal();
$('#about-close').onclick = () => $('#about-dialog').close();
render();
let lastMinute = Math.floor(Date.now() / 60000);
setInterval(() => { const m = Math.floor(Date.now() / 60000); if (m !== lastMinute) { lastMinute = m; render(); } }, 5000);
