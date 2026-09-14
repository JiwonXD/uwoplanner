import {candidates,configuration,activeGrants,slotLimit,summarize,EMPTY,cabinCount,fleetCapacity} from './model.js';
// Time-bounded multi-start greedy search. Reports the best found arrangement;
// does not claim a proof of global optimality or infeasibility.
export function solve(input,data,{milliseconds=10000,onProgress=()=>{},random=Math.random}={}){
  const started=performance.now();const targets=input.targets;const locked=new Set(input.locked);
  const owned=new Set(input.owned);const pool=data.mates.filter(m=>!input.ownedOnly||owned.has(m.id));
  const required=new Set(input.required||[]);
  if(input.ownedOnly&&[...locked].some(id=>!owned.has(id)))throw Error('잠금한 항해사 중 미보유 항해사가 있어요. 보유로 표시하거나 잠금을 해제해 주세요.');
  for(const id of required)if(!owned.has(id)||!data.mateById.has(id))throw Error('필수 항해사의 보유 정보를 확인해 주세요.');
  if(new Set([...required,...locked]).size>fleetCapacity(input))throw Error('필수·잠금 항해사가 선실 수보다 많아요. 선박 수를 늘리거나 필수 지정을 줄여 주세요.');
  const base=structuredClone(input);base.ships=EMPTY();
  for(let s=0;s<input.shipCount;s++)for(let c=0;c<cabinCount(input,s);c++){
    const id=input.ships[s][c];if(id&&locked.has(id))base.ships[s][c]=id;
  }
  const stat=input.statPriority;const maxStat=Math.max(1,...pool.map(m=>m.stats[stat]||0));
  const abilityTargets=new Map();targets.forEach((t,i)=>{if(!abilityTargets.has(t.ability))abilityTargets.set(t.ability,[]);abilityTargets.get(t.ability).push(i);});
  const relevant=pool.map(m=>({mate:m,options:candidates(m),fixed:m.grants.filter(g=>g.kind==='skill'||(g.origin==='transcendence_3'&&configuration(m,input).transcended))}));
  function values(state){return summarize(state,data).targets.map(t=>t.actual);}
  function objective(state){const summary=summarize(state,data);return {deficit:summary.targets.reduce((n,t)=>n+Math.max(0,t.level-t.actual)/t.level,0),
    stat:summary.stats[stat]||0,count:summary.placed,over:summary.targets.reduce((n,t)=>n+Math.max(0,t.actual-t.level),0),summary};}
  function better(a,b){if(Math.abs(a.deficit-b.deficit)>1e-8)return a.deficit<b.deficit;
    if(stat&&a.stat!==b.stat)return a.stat>b.stat;if(a.count!==b.count)return a.count<b.count;return a.over<b.over;}
  let best=structuredClone(input),score=objective(best),iterations=0,lastProgress=0;
  // Existing occupants excluded by the owned filter cannot survive as the best result.
  if(input.ownedOnly&&input.ships.flat().some(id=>id&&!owned.has(id)&&!locked.has(id))){best=structuredClone(base);score=objective(best);}
  if([...required].some(id=>!best.ships.flat().includes(id)))best=null;
  function optionFor(rec,ship,current,weights){
    const gain=g=>{
      let total=0;for(const i of abilityTargets.get(g.ability)||[]){const t=targets[i];if(t.scope==='fleet'||t.scope===ship)total+=Math.min(g.level,Math.max(0,t.level-current[i]))/t.level*weights[i];}return total;
    };
    const selected=rec.options.map(g=>({g,gain:gain(g)})).sort((a,b)=>b.gain-a.gain).slice(0,slotLimit(rec.mate));
    const useful=selected.reduce((n,o)=>n+o.gain,0)+rec.fixed.reduce((n,g)=>n+gain(g),0);
    return {effects:selected.map(o=>o.g.ability),gain:useful};
  }
  do{
    const trial=structuredClone(base);const used=new Set(trial.ships.flat().filter(Boolean));let current=values(trial);
    const weights=targets.map(()=>iterations===0?1:0.65+random()*0.9);
    // Mandatory occupants consume real seats and selected-effect slots first.
    // Their actual contributions reduce the deficits used for remaining choices.
    const mandatory=relevant.filter(r=>required.has(r.mate.id)&&!used.has(r.mate.id));
    if(iterations>0)for(let i=mandatory.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[mandatory[i],mandatory[j]]=[mandatory[j],mandatory[i]];}
    for(const rec of mandatory){
      let choice=null;
      for(let ship=0;ship<input.shipCount;ship++){
        const cabin=trial.ships[ship].slice(0,cabinCount(input,ship)).indexOf(null);if(cabin<0)continue;
        const option=optionFor(rec,ship,current,weights);
        if(!choice||option.gain>choice.option.gain)choice={ship,cabin,option};
      }
      if(!choice)throw Error('필수 항해사를 배치할 선실이 부족해요.');
      const {ship,cabin,option}=choice,m=rec.mate;
      trial.ships[ship][cabin]=m.id;used.add(m.id);
      trial.configs[m.id]={effects:option.effects,transcended:configuration(m,input).transcended};
      for(const g of activeGrants(m,trial.configs[m.id]))for(const i of abilityTargets.get(g.ability)||[])if(targets[i].scope==='fleet'||targets[i].scope===ship)current[i]+=g.level;
    }
    // Small random exclusions diversify combinations without ever dropping locks.
    const records=relevant.filter(r=>iterations===0||random()>.08);
    for(let step=0;step<fleetCapacity(input);step++){
      if(performance.now()-started>=milliseconds)break;
      let chosen=null,bestGain=-1;
      const empty=trial.ships.slice(0,input.shipCount).map((row,s)=>row.slice(0,cabinCount(input,s)).indexOf(null));
      for(const rec of records){if(used.has(rec.mate.id))continue;
        for(let ship=0;ship<input.shipCount;ship++){if(empty[ship]<0)continue;
          const option=optionFor(rec,ship,current,weights);
          const gain=option.gain+(stat?(rec.mate.stats[stat]||0)/maxStat*.0001:0);
          if(gain>bestGain){chosen={rec,ship,cabin:empty[ship],option};bestGain=gain;}
        }
      }
      if(!chosen||bestGain<=0)break;
      const {rec,ship,cabin,option}=chosen;const mate=rec.mate;
      trial.ships[ship][cabin]=mate.id;used.add(mate.id);
      trial.configs[mate.id]={effects:option.effects,transcended:configuration(mate,input).transcended};
      for(const g of activeGrants(mate,trial.configs[mate.id]))for(const i of abilityTargets.get(g.ability)||[]){if(targets[i].scope==='fleet'||targets[i].scope===ship)current[i]+=g.level;}
    }
    // Drop redundant occupants in count-minimizing mode, preserving all achieved levels.
    if(!stat){for(let s=0;s<input.shipCount;s++)for(let c=cabinCount(input,s)-1;c>=0;c--){
      const id=trial.ships[s][c];if(!id||locked.has(id)||required.has(id))continue;
      const before=objective(trial);trial.ships[s][c]=null;
      if(objective(trial).deficit>before.deficit+1e-8)trial.ships[s][c]=id;
    }}
    const result=objective(trial);if(!best||better(result,score)){best=trial;score=result;}
    iterations++;
    if(performance.now()-lastProgress>250){lastProgress=performance.now();onProgress({state:best,iterations,elapsed:performance.now()-started,achieved:score.summary.achieved});}
  }while(performance.now()-started<milliseconds);
  return {state:best,iterations,elapsed:performance.now()-started,achieved:score.summary.achieved};
}
