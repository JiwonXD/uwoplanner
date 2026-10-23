import {pandemicEvents, gameMonth, nextMonthChange, parseBoosts, recommendBoost, kstTime, kstDayStart, kstDate, kstClock, climateSeasons, seasonEffect, DAY, HOUR} from './schedule-core.js';
import {EVENTS, REGIONS, CATEGORY_SEASONS, CLIMATES} from './schedule-data.js';

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
      .map(b => ({kind: 'boost', start: b.start, end: b.start + HOUR, city: String(b.city), category: String(b.category), tariff: Number.isFinite(b.tariff) ? b.tariff : null,
        goods: Array.isArray(b.goods) && b.goods.length ? b.goods.filter(x => x && x.name).map(x => ({name: String(x.name), ...(x.where ? {where: String(x.where)} : {}), ...(x.note ? {note: String(x.note)} : {})})) : recommendBoost(b.category)}));
  } catch { return []; }
}
function saveBoosts(list) {
  try { localStorage.setItem(BOOST_KEY, JSON.stringify(list.map(({start, city, category, tariff, goods}) => ({start, city, category, tariff, goods})))); }
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
      : `<span class="badge badge-pandemic" data-event="${EVENT_INDEX[e.event]}">대유행 · ${escape(e.event)}</span><h3>${escape(e.region)}</h3><p class="small">${e.categories.join(', ')} <button class="text-button" data-show-barter="${escape(e.event)}">물물교환 재료 보기</button></p>`;
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
  const {boosts: added, rejected, pandemic} = parseBoosts($('#boost-text').value, $('#boost-day').value || kstDate(Date.now()), {now: Date.now()});
  const key = b => `${b.start}|${b.city}|${b.category}`, existing = new Set(boosts.map(key));
  const fresh = added.filter(b => !existing.has(key(b)));
  boosts = [...boosts, ...fresh]; saveBoosts(boosts);
  $('#boost-result').textContent = `${fresh.length}건 추가${added.length - fresh.length ? ` · 이미 있는 ${added.length - fresh.length}건 제외` : ''}${pandemic ? ` · 대유행 ${pandemic}줄은 자동 계산이라 건너뜀` : ''}${rejected.length ? ` · 읽지 못한 줄 ${rejected.length}개: ${rejected.slice(0, 3).join(' / ')}${rejected.length > 3 ? ' …' : ''}` : ''}`;
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

// ---- 대유행별 물물교환 ----
// Recipes come from ./barter-data.json (scripts/build_barter.mjs); monthly marks use each port's climate.
const CLIMATE_MONTHS = Object.fromEntries(CLIMATES.map(c => [c.id, c.months]));
let barter = null, barterEvent = null;
function monthMarks(seller) {
  const months = CLIMATE_MONTHS[seller.climate]; if (!months) return null;
  return months.map(season => seller.up.includes(season) ? 1 : seller.down.includes(season) ? -1 : 0);
}
// Ports with identical marks share a line, as in the community sheet.
function sellerLines(material) {
  const lines = new Map();
  for (const s of material.sellers) {
    const marks = monthMarks(s), key = marks ? marks.join(',') : 'unknown';
    if (!lines.has(key)) lines.set(key, {cities: [], marks});
    lines.get(key).cities.push(s.city);
  }
  const out = [...lines.values()];
  if (material.villages.length) out.push({villages: material.villages});
  if (!out.length) out.push({none: true});
  return out;
}
function renderBarter() {
  if (!barter) return;
  const query = $('#barter-search').value.trim().toLowerCase(), month = gameMonth(Date.now());
  document.querySelectorAll('[data-barter-event]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.barterEvent === (barterEvent || ''))));
  const rows = [];
  for (const v of barter.villages) for (const r of v.rows) {
    if (barterEvent && !r.events.includes(barterEvent)) continue;
    const text = [v.name, r.product, r.category, ...r.materials.flatMap(m => [m.name, ...m.sellers.map(s => s.city), ...m.villages])].join(' ').toLowerCase();
    if (query && !text.includes(query)) continue;
    rows.push({v, r, lines: r.materials.map(m => ({m, lines: sellerLines(m)}))});
  }
  $('#barter-count').textContent = `교환품 ${rows.length}개`;
  $('#barter-empty').hidden = !!rows.length; $('#barter-empty').textContent = '조건에 맞는 교환품이 없어요.';
  const mark = (v, i) => `<td class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}${i + 1 === month ? ' now' : ''}">${v > 0 ? '▲' : v < 0 ? '▼' : ''}</td>`;
  const head = `<thead><tr><th>마을</th><th>대유행</th><th>교역품</th><th>재료</th><th>분류</th><th>구매처</th>${Array.from({length: 12}, (_, i) => `<th class="${i + 1 === month ? 'now' : ''}">${i + 1}월</th>`).join('')}</tr></thead>`;
  $('#barter-table').innerHTML = head + rows.map(({v, r, lines}) => {
    const span = lines.reduce((n, x) => n + x.lines.length, 0);
    let first = true;
    return `<tbody>${lines.map(({m, lines: ls}) => ls.map((line, i) => {
      const cells = [];
      if (first) {
        cells.push(`<th rowspan="${span}" class="village">${escape(v.name)}</th><td rowspan="${span}" class="events">${r.events.map(e => `<span data-event="${EVENT_INDEX[e]}">${e}</span>`).join('') || '-'}</td>`,
          `<td rowspan="${span}" class="product"><b>${escape(r.product)}</b><small>${escape(r.category)}</small>${r.condition ? `<small class="cond">${escape(r.condition)}</small>` : ''}${r.group !== '기본' ? `<small>${escape(r.group)}</small>` : ''}</td>`);
        first = false;
      }
      if (i === 0) cells.push(`<td rowspan="${ls.length}" class="material">${escape(m.name)}${m.qty ? ` <small>×${m.qty}</small>` : ''}</td><td rowspan="${ls.length}" class="small">${escape(m.category || '')}</td>`);
      if (line.villages) return `<tr>${cells.join('')}<td colspan="13" class="from-village">${line.villages.map(escape).join(' / ')}</td></tr>`;
      if (line.none) return `<tr>${cells.join('')}<td colspan="13" class="small hint">구매처 정보 없음 (생산·이벤트 품목일 수 있어요)</td></tr>`;
      const marks = line.marks ? line.marks.map((v, i) => mark(v, i)).join('') : '<td colspan="12" class="small hint">기후 정보가 없어 계절을 표시하지 못해요</td>';
      return `<tr>${cells.join('')}<td class="ports">${line.cities.map(escape).join(' · ')}</td>${marks}</tr>`;
    }).join('')).join('')}</tbody>`;
  }).join('');
}
function selectBarterEvent(name, scroll = false) {
  barterEvent = name || null; renderBarter();
  if (scroll) $('#barter').scrollIntoView({behavior: 'smooth', block: 'start'});
}
async function loadBarter() {
  $('#barter-events').innerHTML = `<button data-barter-event="" aria-pressed="false">전체</button>${EVENTS.map((e, i) => `<button data-barter-event="${e.name}" data-event="${i}" aria-pressed="false">${e.name}</button>`).join('')}`;
  $('#barter-events').onclick = e => { const b = e.target.closest('[data-barter-event]'); if (b) selectBarterEvent(b.dataset.barterEvent); };
  $('#barter-search').oninput = renderBarter;
  try {
    const res = await fetch('./barter-data.json'); if (!res.ok) throw Error(res.status);
    barter = await res.json();
  } catch {
    $('#barter-empty').hidden = false; $('#barter-empty').textContent = '물물교환 데이터가 아직 준비되지 않았어요.'; return;
  }
  // Start with the next upcoming 대유행 so the table answers "what should I make for the next event?".
  const next = pandemicEvents(Date.now() - HOUR, Date.now() + DAY).find(e => e.end > Date.now());
  selectBarterEvent(next ? next.event : null);
}
$('#today').addEventListener('click', e => { const b = e.target.closest('[data-show-barter]'); if (b) selectBarterEvent(b.dataset.showBarter, true); });

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
restoreView(); render(); renderSeasons(); renderGrid(); loadBarter();
let lastMinute = Math.floor(Date.now() / 60000), lastMonth = gameMonth(Date.now());
setInterval(() => {
  const now = Date.now(); renderClock(now);
  if (Math.floor(now / 60000) !== lastMinute) { lastMinute = Math.floor(now / 60000); renderToday(now); renderBoosts(now); }
  if (gameMonth(now) !== lastMonth) { lastMonth = gameMonth(now); $('#season-month').value = String(lastMonth); renderSeasons(); renderGrid(); renderBarter(); }
}, 1000);
