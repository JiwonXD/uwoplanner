import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const out = new URL('dist/', root);
await mkdir(out, { recursive: true });
for (const file of ['index.html','style.css','app.js','model.js','solver.js','worker.js','favicon.svg']) {
  await copyFile(new URL(`web/${file}`, root), new URL(file, out));
}
const catalog = JSON.parse(await readFile(new URL('data/simulator/catalog.json', root), 'utf8'));
const grants = new Map();
for (const g of catalog.grants) {
  if (!grants.has(g.navigator_id)) grants.set(g.navigator_id, []);
  grants.get(g.navigator_id).push({ ability: g.ability_id, kind: g.kind, level: g.level,
    origin: g.origin, unlock: g.unlock_level, slot: g.slot_index });
}
const data = {
  version: catalog.source.snapshot_generated_at_utc,
  rules: catalog.game_rules,
  mates: catalog.navigators.map(n => ({id:n.id, name:n.name, grade:n.grade, type:n.type,
    job:n.job, stats:n.stats, grants:grants.get(n.id) || []})),
  abilities: catalog.abilities.map(a => ({id:a.id, name:a.name, kind:a.kind,
    category:a.category, scope:a.aggregation_scope, description:a.description,
    values:a.level_values, known:a.definition_available}))
};
await writeFile(new URL('catalog.json',out), JSON.stringify(data));
await writeFile(new URL('.nojekyll',out),'');
console.log(`Built dist: ${data.mates.length} navigators / ${data.abilities.length} abilities. No runtime server required.`);
