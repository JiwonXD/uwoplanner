// Pure calendar functions shared by the schedule page and the Node tests. Times are epoch milliseconds;
// "KST wall" values are the same instant shifted by +9h so that UTC getters read Korean wall-clock time.
import {EPOCH, EVENTS, REGIONS, CALENDAR, CATEGORIES, RECOMMEND, CLIMATES, CATEGORY_SEASONS} from './schedule-data.js';

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

// 대유행 events starting in [from, to). Each lasts one hour from the top of its hour.
export function pandemicEvents(from, to) {
  const out = [];
  for (let h = Math.ceil((from - epochMs) / HOUR); epochMs + h * HOUR < to; h++) {
    for (const region of REGIONS) for (const event of EVENTS) {
      if (((region.base + h) % event.period + event.period) % event.period === 0) {
        const start = epochMs + h * HOUR;
        out.push({kind: 'pandemic', start, end: start + HOUR, region: region.name, event: event.name, categories: event.categories,
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

// 부양 entries typed or pasted by the user, one per line, e.g. "*11시 메리다 미술품 부양",
// "2026-10-25 00:00 제노바 직물" or "17:30 보르도 귀금속 부양 관세 21%". Lines without a known category
// are reported back instead of guessed. `day` (YYYY-MM-DD) is used when a line has no date; hours before
// `rollover` are taken as the next day so a late-night list ("…, 00시 제노바") keeps its order.
export function parseBoosts(text, day, {rollover = 0} = {}) {
  const boosts = [], rejected = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^[\s*•·-]+/, '').trim(); if (!line) continue;
    const m = line.match(/^(?:(\d{4})[-./](\d{1,2})[-./](\d{1,2})\s+)?(\d{1,2})(?:시\s*(\d{1,2})?분?|:(\d{2}))?\s+(.+)$/);
    const words = m ? m[7].replace(/부양|행사/g, ' ').split(/[\s,·-]+/).filter(Boolean) : [];
    const category = words.find(w => CATEGORIES.includes(w));
    const city = words.find(w => w !== category && !/^관세|%$|^\d+$/.test(w));
    const hour = m ? Number(m[4]) : NaN, minute = m ? Number(m[5] || m[6] || 0) : NaN;
    if (!m || !category || !city || hour > 23 || minute > 59) { rejected.push(raw.trim()); continue; }
    const tariff = line.match(/관세\s*:?\s*(\d{1,2})\s*%/);
    let start = kstTime(m[1] ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : day, hour, minute);
    if (!m[1] && hour < rollover) start += DAY;
    boosts.push({kind: 'boost', start, end: start + HOUR, city, category, tariff: tariff ? Number(tariff[1]) : null, goods: recommendBoost(category)});
  }
  return {boosts, rejected};
}
