// Builds web/barter-data.json: village barter recipes with, for each material, the cities that sell it and
// their peak/off seasons, and the villages that make it when the material is itself a barter good.
// Input: data/world/tips.json (village sheet) and data/world/cities.json from scripts/collect_world.py.
// Monthly marks are computed in the browser from each city's climate (see web/schedule-data.js).
import {readFile, writeFile} from 'node:fs/promises';
import {EVENTS} from '../web/schedule-data.js';

const root = new URL('../', import.meta.url);
const tips = JSON.parse(await readFile(new URL('data/world/tips.json', root), 'utf8')).datasets;
const cities = JSON.parse(await readFile(new URL('data/world/cities.json', root), 'utf8')).cities;
const split = s => String(s || '').split(/[,\s]+/).filter(Boolean);
// The sheet sometimes spaces names differently from the city lists ("올리브 기름" vs "올리브기름").
const key = name => String(name).replace(/\s+/g, '');
// Event categories such as "주류(또는 식료품)" match their leading name.
const eventsFor = category => EVENTS.filter(e => e.categories.some(c => c.replace(/\(.*\)/, '') === category)).map(e => e.name);

const sellers = new Map(), goodsCategory = new Map();
for (const city of cities) for (const item of city.fields.items || []) {
  if (!sellers.has(key(item.name))) sellers.set(key(item.name), []);
  sellers.get(key(item.name)).push({city: city.name, climate: city.fields.climate || null, up: split(item.up), down: split(item.down)});
  goodsCategory.set(key(item.name), item.category);
}
const makers = new Map();
for (const v of tips.VSHEET.villages) for (const b of v.barter || []) {
  if (!makers.has(key(b.r))) makers.set(key(b.r), new Set());
  makers.get(key(b.r)).add(v.name);
  if (b.cat && !goodsCategory.has(key(b.r))) goodsCategory.set(key(b.r), b.cat);
}

let materialsTotal = 0, withSource = 0;
const missing = new Set();
const villages = tips.VSHEET.villages.map(v => ({
  name: v.name, region: v.region,
  rows: (v.barter || []).map(b => ({
    group: b.g, product: b.r, category: b.cat || goodsCategory.get(key(b.r)) || '', condition: b.cond || '', events: eventsFor(b.cat || goodsCategory.get(key(b.r))),
    materials: b.mats.map(m => {
      const match = m.match(/^(.*?\D)\s*(\d+)$/), name = (match ? match[1] : m).trim(), qty = match ? Number(match[2]) : null;
      const from = [...(makers.get(key(name)) || [])], sold = sellers.get(key(name)) || [];
      materialsTotal++; if (sold.length || from.length) withSource++; else missing.add(name);
      return {name, qty, category: goodsCategory.get(key(name)) || null, sellers: sold, villages: from};
    }),
  })),
})).filter(v => v.rows.length);

await writeFile(new URL('web/barter-data.json', root), JSON.stringify({source: 'data/world (village barter sheet + city goods)', villages}));
console.log(`barter-data.json: ${villages.length} villages, ${villages.reduce((n, v) => n + v.rows.length, 0)} recipes, ${withSource}/${materialsTotal} materials with a known source${missing.size ? `; unknown: ${[...missing].join(', ')}` : ''}`);
