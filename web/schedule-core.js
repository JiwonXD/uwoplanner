// Pure calendar functions shared by the schedule page and the Node tests. Times are epoch milliseconds;
// "KST wall" values are the same instant shifted by +9h so that UTC getters read Korean wall-clock time.
import {EPOCH, EVENTS, REGIONS, CALENDAR, CATEGORIES, RECOMMEND, CLIMATES, CATEGORY_SEASONS, GOODS_CATEGORY, REGION_ALIASES, PANDEMIC_HOURS} from './schedule-data.js';

export const HOUR = 3600e3, DAY = 24 * HOUR, KST = 9 * HOUR;
const epochMs = Date.parse(EPOCH);
const wall = ms => new Date(ms + KST);
const pad = n => String(n).padStart(2, '0');

// Midnight KST of the day containing `ms`.
export function kstDayStart(ms) { return Math.floor((ms + KST) / DAY) * DAY - KST; }
// Instant for a KST calendar date and time, e.g. kstTime('2026-10-24', 17, 0).
export function kstTime(day, hour = 0, minute = 0) { return Date.parse(`${day}T${pad(hour)}:${pad(minute)}:00+09:00`); }
export function kstDate(ms) { const d = wall(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
export function kstClock(ms) { const d = wall(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }

// In-game month (1-12) at `ms`. The month changes daily at 09:00 KST.
export function gameMonth(ms) {
  const day = kstDayStart(ms - CALENDAR.changeHour * HOUR);
  const days = Math.round((day - kstTime(CALENDAR.referenceDay)) / DAY);
  return ((CALENDAR.referenceMonth - 1 + days) % 12 + 12) % 12 + 1;
}
// Next month change at or after `ms`.
export function nextMonthChange(ms) {
  const today = kstDayStart(ms) + CALENDAR.changeHour * HOUR;
  return today > ms ? today : today + DAY;
}

// Season of each climate zone in a game month, and +1 / -1 / 0 for a category in that season.
export function climateSeasons(month) { return CLIMATES.map(c => ({...c, season: c.months[month - 1]})); }
export function seasonEffect(category, season) { return CATEGORY_SEASONS[category]?.[season] || 0; }

// 대유행 events starting in [from, to). Each lasts PANDEMIC_HOURS from the top of its hour.
export function pandemicEvents(from, to) {
  const out = [];
  for (let h = Math.ceil((from - epochMs) / HOUR); epochMs + h * HOUR < to; h++) {
    for (const region of REGIONS) for (const event of EVENTS) {
      if (((region.base + h) % event.period + event.period) % event.period === 0) {
        const start = epochMs + h * HOUR;
        out.push({kind: 'pandemic', start, end: start + PANDEMIC_HOURS * HOUR, region: region.name, event: event.name, categories: event.categories,
          goods: recommendPandemic(event.name, region.name)});
      }
    }
  }
  return out;
}
export function recommendPandemic(event, region) {
  const table = RECOMMEND.pandemic[event]; if (!table) return [];
  return table[region] || table['*'] || [];
}
export function recommendBoost(category) { return RECOMMEND.boost[category] || []; }

// 부양 entries typed or pasted by the user. Accepts single lines ("*11시 메리다 미술품 부양",
// "17:30 브레멘 향신료 관세 1%", "2026-10-25 09:09 산티아고 미술품") and whole chat exports of community
// guides: date headers ("2026년 10월 24일 토요일") set the day, "[대화명] [오후 2:48]" prefixes are dropped
// (names are never kept), and 대유행 lines are skipped because the page computes those. A boost may name
// goods instead of a category ("16시 아르한겔스크 목피화 부양"); goods after " - " become that boost's list.
// Times: within one message a smaller hour than the previous line means the next day ("…22시, 00시"); a
// line earlier than its message's post time, or (for typed lines) already over at `now`, moves to the next day.
const REGION_WORDS = [...REGIONS.map(r => r.name), ...Object.keys(REGION_ALIASES)].map(w => w.replace(/\s+/g, ''));
const EVENT_NAMES = EVENTS.map(e => e.name);
const SKIP = /님이 (들어왔|나갔)습니다|메시지가 삭제|^사진( \d+장)?$|^https?:\/\/|^특물\b|점검|^서버 ?on/i;
function goodsCategoryAt(words, from) {
  for (let end = words.length; end > from; end--) {
    const category = GOODS_CATEGORY[words.slice(from, end).join('')];
    if (category) return {category, goods: words.slice(from, end).join(' ')};
  }
  return null;
}
export function parseBoosts(text, day, {now = null} = {}) {
  const boosts = [], rejected = [];
  let pandemic = 0, current = day, posted = null, lastHour = -1;
  for (const raw of String(text).split(/\r?\n/)) {
    let line = raw.trim(); if (!line) continue;
    const header = line.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    if (header) { current = `${header[1]}-${pad(header[2])}-${pad(header[3])}`; posted = null; lastHour = -1; continue; }
    const prefix = line.match(/^\[[^\]]*\]\s*\[(오전|오후)\s*(\d{1,2}):(\d{2})\]\s*/);
    if (prefix) {
      const h = Number(prefix[2]) % 12 + (prefix[1] === '오후' ? 12 : 0);
      posted = kstTime(current, h, Number(prefix[3])); lastHour = -1; line = line.slice(prefix[0].length).trim();
      if (!line) continue;
    }
    if (SKIP.test(line)) continue;
    line = line.replace(/^[*•·-]+\s*/, '');
    const m = line.match(/^(?:(\d{4})[-./](\d{1,2})[-./](\d{1,2})\s+)?(\d{1,2})(?:시\s*(?:(\d{1,2})분)?|:(\d{2}))\s*(.+)$/);
    if (!m) { if (/부양/.test(line)) rejected.push(raw.trim()); continue; }
    const [body, listed] = m[7].split(/\s+-\s+/);
    const words = body.replace(/\(.*?\)/g, ' ').split(/[\s,·]+/).filter(Boolean).filter(w => w !== '부양' && w !== '행사');
    const compact = body.replace(/\s+/g, '');
    if (!/부양/.test(body) && REGION_WORDS.some(r => compact.includes(r)) && EVENT_NAMES.some(e => body.includes(e))) { pandemic++; continue; }
    const hour = Number(m[4]), minute = Number(m[5] || m[6] || 0);
    const city = words[0];
    let category = words.slice(1).find(w => CATEGORIES.includes(w)) || null, named = null;
    if (!category) { const found = goodsCategoryAt(words, 1); if (found) ({category, goods: named} = found); }
    if (!city || !category || hour > 23 || minute > 59 || REGION_WORDS.includes(city.replace(/\s+/g, ''))) { rejected.push(raw.trim()); continue; }
    const date = m[1] ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : current;
    let start = kstTime(date, hour, minute);
    if (!m[1]) {
      if (lastHour >= 0 && hour < lastHour) start += DAY;
      else if (posted !== null ? start < posted - HOUR / 2 : now !== null && start + HOUR <= now) start += DAY;
      lastHour = hour;
    }
    const tariff = line.match(/관세\s*:?\s*(\d{1,2})\s*%/);
    const own = (listed || '').split(/[,،]/).map(x => x.replace(/\(.*?\)|부양$/g, '').trim()).filter(Boolean).map(name => ({name}));
    const same = x => x.name.replace(/\s+/g, '') === (named || '').replace(/\s+/g, '');
    const goods = own.length ? own : named ? [recommendBoost(category).find(same) || {name: named}, ...recommendBoost(category).filter(x => !same(x))] : recommendBoost(category);
    boosts.push({kind: 'boost', start, end: start + HOUR, city, category, tariff: tariff ? Number(tariff[1]) : null, goods});
  }
  return {boosts, rejected, pandemic};
}
