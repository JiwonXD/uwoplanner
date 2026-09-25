import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,indexCatalog,summarize,validateState} from '../web/model.js';
import {solve,distributeFleet} from '../web/solver.js';

const grant=(ability,kind='effect')=>({ability,kind,level:1,origin:'job'});
const mate=(id,grade='S',stats={박물학:10},grants=[grant('fleet')])=>({id,name:id,grade,stats,grants});
const catalog=mates=>indexCatalog({mates,abilities:[
  {id:'fleet',kind:'effect',scope:'fleet',known:true},
  {id:'combat',kind:'effect',scope:'ship',known:true},
  {id:'skill',kind:'skill',scope:'ship',known:true}
]});
const occupants=state=>state.ships.slice(0,state.shipCount).flat().filter(Boolean);

test('fleet-only crew fill cabin by cabin across seven ships in primary-stat and grade order',()=>{
  const mates=Array.from({length:10},(_,i)=>mate(String(i),i===9?'S+':'S',i===0?{박물학:900,백병술:1000}:{박물학:10}));
  const data=catalog(mates),state=initialState();state.statPriority='박물학';
  state.ships[0]=[...mates.map(m=>m.id),null];state.targets=[{ability:'fleet',scope:'fleet',level:10}];
  const original=structuredClone(state),result=distributeFleet(state,data);
  assert.deepEqual(state,original);
  assert.deepEqual(result.ships.map(row=>row.filter(Boolean).length),[2,2,2,1,1,1,1]);
  assert.deepEqual(result.ships.map(row=>row[0]),['9','1','2','3','4','5','6']);
  assert.deepEqual(result.ships.slice(0,3).map(row=>row[1]),['7','8','0']);
  assert.equal(summarize(result,data).targets[0].actual,10);
  assert.deepEqual(occupants(result).sort(),occupants(state).sort());
});

test('mixed ship effects and skills stay together while other crew spread over available cabins',()=>{
  const mates=[mate('combat1','C',{백병술:10},[grant('combat'),grant('fleet')]),mate('combat2','C',{백병술:10},[grant('combat')]),
    mate('skill1','B',{백병술:10},[grant('skill','skill')]),mate('skill2','B',{백병술:10},[grant('skill','skill')]),
    ...Array.from({length:5},(_,i)=>mate('free'+i))];
  const data=catalog(mates),state=initialState();state.shipCount=3;state.shipCapacities.fill(3);state.statPriority='박물학';
  state.ships[0].splice(0,3,'combat1','combat2','free0');state.ships[1].splice(0,3,'skill1','skill2','free1');state.ships[2].splice(0,3,'free2','free3','free4');
  state.targets=[{ability:'fleet',scope:'fleet',level:6},{ability:'combat',scope:0,level:3},{ability:'skill',scope:1,level:2}];
  state.required=['combat1'];state.owned=['combat1'];
  const result=distributeFleet(state,data);
  assert.ok(result.ships[0].includes('combat1')&&result.ships[0].includes('combat2'));
  assert.ok(result.ships[1].includes('skill1')&&result.ships[1].includes('skill2'));
  assert.deepEqual(summarize(result,data).targets.map(t=>t.actual),summarize(state,data).targets.map(t=>t.actual));
  assert.deepEqual(result.configs,state.configs);assert.deepEqual(result.required,state.required);
  assert.deepEqual(occupants(result).sort(),occupants(state).sort());validateState(result,data);
});

test('distribution respects unequal capacities and existing locked cabin positions',()=>{
  const data=catalog(Array.from({length:6},(_,i)=>mate('m'+i))),state=initialState();state.shipCount=3;
  state.shipCapacities.splice(0,3,1,2,4);state.ships[0][0]='m0';state.ships[1][0]='m1';state.ships[1][1]='m2';state.ships[2].splice(0,3,'m3','m4','m5');state.locked=['m2'];
  const result=distributeFleet(state,data);
  assert.deepEqual(result.ships.slice(0,3).map(row=>row.filter(Boolean).length),[1,2,3]);assert.equal(result.ships[1][1],'m2');
  assert.deepEqual(occupants(result).sort(),occupants(state).sort());validateState(result,data);
});

test('solver distributes existing best, progress and final results without changing fleet goals',()=>{
  const data=catalog(Array.from({length:8},(_,i)=>mate('m'+i))),state=initialState();state.shipCount=3;
  state.ships[0].splice(0,8,...data.mates.map(m=>m.id));state.targets=[{ability:'fleet',scope:'fleet',level:8}];
  const progress=[];const result=solve(state,data,{milliseconds:300,random:()=>.5,onProgress:r=>progress.push(r)});
  assert.ok(progress.length);
  for(const r of [...progress,result]){
    assert.deepEqual(r.state.ships.slice(0,3).map(row=>row.filter(Boolean).length),[3,3,2]);
    assert.equal(summarize(r.state,data).achieved,1);
  }
});
