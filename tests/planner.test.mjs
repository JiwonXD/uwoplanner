import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initialState,indexCatalog,configuration,activeGrants,slotLimit,summarize,validateState} from '../web/model.js';
import {solve} from '../web/solver.js';
const ability=(id,scope='fleet')=>({id,name:id,scope,kind:'effect',known:true,category:scope==='fleet'?'모험':'전투'});
const grant=(ability,origin='job',level=1)=>({ability,origin,level,kind:'effect',unlock:70});
const mate=(id,grants,grade='S')=>({id,name:id,grade,type:'모험',job:'탐험가',stats:{박물학:10},grants});
function run(state,data){return solve(state,data,{milliseconds:25,random:()=>.5}).state;}

test('all learned effects compete for five slots, admirals have six; levels are not gated',()=>{
  const grants=Array.from({length:8},(_,i)=>grant('a'+i));
  const regular=mate('r',grants),admiral=mate('a',grants,'S+');const state=initialState();
  assert.equal(slotLimit(regular),5);assert.equal(slotLimit(admiral),6);
  assert.equal(activeGrants(regular,configuration(regular,state)).length,5);
  assert.equal(activeGrants(admiral,configuration(admiral,state)).length,6);
  const data=indexCatalog({mates:[regular],abilities:grants.map(g=>ability(g.ability))});
  state.shipCount=1;state.targets=[{ability:'a7',scope:'fleet',level:1}];
  const result=run(state,data);assert.equal(summarize(result,data).achieved,1);
  assert.ok(result.configs.r.effects.includes('a7'));
});
test('fixed transcendence is separate and only included when completed',()=>{
  const m=mate('m',[...Array.from({length:6},(_,i)=>grant('a'+i)),grant('fixed','transcendence_3')]);
  const config=configuration(m,initialState());assert.equal(activeGrants(m,config).length,5);
  config.transcended=true;assert.equal(activeGrants(m,config).length,6);
});
test('fleet effects stack across ships; combat effects do not; LV2 contributes two',()=>{
  const data=indexCatalog({mates:[mate('a',[grant('fleet'),grant('combat','job',2)]),mate('b',[grant('fleet'),grant('combat')])],abilities:[ability('fleet'),ability('combat','ship')]});
  const state=initialState();state.ships[0][0]='a';state.ships[1][0]='b';state.targets=[{ability:'fleet',scope:'fleet',level:2},{ability:'combat',scope:0,level:3}];
  const summary=summarize(state,data);assert.equal(summary.targets[0].actual,2);assert.equal(summary.targets[1].actual,2);
});
test('solver respects locks, ownership, per-ship target and duplicate exclusion',()=>{
  const data=indexCatalog({mates:[mate('a',[grant('combat')]),mate('b',[grant('combat')]),mate('excluded',[grant('combat','job',10)])],abilities:[ability('combat','ship')]});
  const state=initialState();state.shipCount=2;state.ships[0][2]='a';state.locked=['a'];state.ownedOnly=true;state.owned=['a','b'];
  state.configs.a={effects:['combat'],transcended:false};state.targets=[{ability:'combat',scope:1,level:1}];
  const result=run(state,data);assert.equal(result.ships[0][2],'a');assert.ok(result.ships[1].includes('b'));
  assert.equal(result.ships.flat().filter(Boolean).length,2);assert.deepEqual(result.configs.a,state.configs.a);assert.equal(summarize(result,data).achieved,1);
});
test('unreachable target stays short; no fabricated grants or duplicated crew',()=>{
  const data=indexCatalog({mates:[mate('only',[grant('a')])],abilities:[ability('a')]});
  const state=initialState();state.shipCount=1;state.targets=[{ability:'a',scope:'fleet',level:10}];
  const result=run(state,data);assert.equal(summarize(result,data).targets[0].actual,1);assert.equal(result.ships.flat().filter(Boolean).length,1);
});
test('mandatory contributors reduce deficits and non-contributing mandatory crew stay aboard',()=>{
  const data=indexCatalog({mates:[mate('required',[grant('a','job',2)]),mate('favorite',[]),mate('extra',[grant('a')])],abilities:[ability('a')]});
  const state=initialState();state.shipCount=1;state.required=['required','favorite'];state.owned=['required','favorite','extra'];state.ownedOnly=true;
  state.targets=[{ability:'a',scope:'fleet',level:2}];
  const result=run(state,data);assert.equal(summarize(result,data).targets[0].actual,2);
  assert.ok(result.ships[0].includes('favorite'));assert.ok(result.ships[0].includes('required'));assert.ok(!result.ships[0].includes('extra'));
  assert.deepEqual(validateState(result,data).required,state.required);
});
test('mandatory placement is free to move to the ship with a combat target',()=>{
  const data=indexCatalog({mates:[mate('required',[grant('combat','job',2)])],abilities:[ability('combat','ship')]});
  const state=initialState();state.shipCount=2;state.owned=['required'];state.required=['required'];state.ships[0][0]='required';
  state.targets=[{ability:'combat',scope:1,level:2}];
  const result=run(state,data);assert.ok(result.ships[1].includes('required'));assert.equal(summarize(result,data).achieved,1);
});
test('mandatory effects respect selection limits instead of counting every owned effect',()=>{
  const abilities=Array.from({length:6},(_,i)=>ability('a'+i));
  const data=indexCatalog({mates:[mate('required',abilities.map(a=>grant(a.id)))],abilities});
  const state=initialState();state.shipCount=1;state.owned=['required'];state.required=['required'];state.targets=abilities.map(a=>({ability:a.id,scope:'fleet',level:1}));
  const result=run(state,data);assert.equal(summarize(result,data).achieved,5);assert.equal(result.configs.required.effects.length,5);
});
test('mandatory capacity errors are explicit; overlap with a lock counts only once',()=>{
  const mates=Array.from({length:12},(_,i)=>mate('m'+i,[]));const data=indexCatalog({mates,abilities:[]});
  const state=initialState();state.shipCount=1;state.owned=mates.map(m=>m.id);state.required=[...state.owned];
  assert.throws(()=>run(state,data),/선실/);state.required=state.required.slice(0,11);state.ships[0][0]='m0';state.locked=['m0'];
  const result=run(state,data);assert.equal(result.ships[0].filter(Boolean).length,11);assert.equal(result.ships[0][0],'m0');
});
test('old saves acquire an empty mandatory list and invalid unowned mandatory imports fail',()=>{
  const data=indexCatalog({mates:[mate('a',[])],abilities:[]});const old=initialState();delete old.required;
  assert.deepEqual(validateState(old,data).required,[]);old.required=['a'];assert.throws(()=>validateState(old,data),/보유/);
});
test('import validation rejects duplicate crew, over-equipped effects and invalid ship targets',()=>{
  const m=mate('m',Array.from({length:6},(_,i)=>grant('a'+i)));const data=indexCatalog({mates:[m],abilities:[ability('a0','ship')]});
  let state=initialState();state.ships[0][0]='m';state.ships[0][1]='m';assert.throws(()=>validateState(state,data));
  state=initialState();state.configs.m={effects:m.grants.map(g=>g.ability)};assert.throws(()=>validateState(state,data));
  state=initialState();state.shipCount=1;state.targets=[{ability:'a0',scope:1,level:1}];assert.throws(()=>validateState(state,data));
});
test('real source honors global slot limits and provides requested four effect targets',async()=>{
  const raw=JSON.parse(await readFile(new URL('../data/simulator/catalog.json',import.meta.url),'utf8'));
  const data=indexCatalog({abilities:raw.abilities.map(a=>({id:a.id,name:a.name,scope:a.aggregation_scope,known:a.definition_available})),
    mates:raw.navigators.map(n=>({...n,grants:raw.grants.filter(g=>g.navigator_id===n.id).map(g=>({ability:g.ability_id,level:g.level,kind:g.kind,origin:g.origin}))}))});
  const names=['능숙한 돛 조종','긴축 배급','흥정의 기술','타고난 장사꾼'];const state=initialState();
  state.targets=names.map(name=>({ability:data.abilities.find(a=>a.name===name).id,scope:'fleet',level:10}));
  const result=solve(state,data,{milliseconds:400,random:()=>.5}).state;
  assert.equal(summarize(result,data).achieved,4);
  const placed=result.ships.flat().filter(Boolean);assert.equal(new Set(placed).size,placed.length);
  for(const id of placed)assert.ok(configuration(data.mateById.get(id),result).effects.length<=slotLimit(data.mateById.get(id)));
});
test('catalog includes both latest navigators with complete linked grants and LV2 values',async()=>{
  const raw=JSON.parse(await readFile(new URL('../data/simulator/catalog.json',import.meta.url),'utf8'));
  assert.equal(raw.navigators.length,642);
  assert.equal(new Set(raw.navigators.map(n=>n.id)).size,642);
  const defs=new Map(raw.abilities.map(a=>[a.id,a]));
  for(const [name,job,effect,stat,value] of [['멜라티','방적상','직물 판매 할증','판매 전략',380],['제임스 랭커스터','갑판장','탐사의 기본','척후법',406]]){
    const n=raw.navigators.find(n=>n.name===name);assert.ok(n);assert.equal(n.job,job);assert.equal(n.grade,'S');
    assert.equal(Object.keys(n.stats).length,12);assert.equal(n.stats[stat],value);
    const grants=raw.grants.filter(g=>g.navigator_id===n.id);
    assert.equal(grants.filter(g=>g.kind==='effect').length,11);assert.equal(grants.filter(g=>g.kind==='skill').length,2);
    assert.ok(grants.every(g=>defs.get(g.ability_id)?.definition_available));
    assert.equal(grants.find(g=>defs.get(g.ability_id).name===effect).level,2);
  }
});
