import {candidates,configuration,activeGrants,slotLimit,summarize,EMPTY,cabinCount,fleetCapacity,primaryStats,GRADE_ORDER} from './model.js';
// Reorder the selected crew without changing equipment or ship-target contributions.
export function distributeFleet(state,data){
  const result=structuredClone(state),locked=new Set(state.locked||[]);
  const free=[],reserved=Array.from({length:state.shipCount},()=>[]),ranks=new Map();
  const shipTargets=reserved.map((_,ship)=>new Set(state.targets.filter(t=>t.scope===ship).map(t=>t.ability)));
  for(let ship=0;ship<state.shipCount;ship++)for(let cabin=0;cabin<cabinCount(state,ship);cabin++){
    const id=state.ships[ship][cabin];if(!id||locked.has(id))continue;
    const mate=data.mateById.get(id),grade=GRADE_ORDER.indexOf(mate.grade);
    ranks.set(id,state.statPriority?[primaryStats(mate).includes(state.statPriority)?0:1,grade<0?GRADE_ORDER.length:grade]:[0,0]);
    const needed=activeGrants(mate,configuration(mate,state)).some(g=>shipTargets[ship].has(g.ability));
    (needed?reserved[ship]:free).push(id);result.ships[ship][cabin]=null;
  }
  const compare=(a,b)=>ranks.get(a)[0]-ranks.get(b)[0]||ranks.get(a)[1]-ranks.get(b)[1];
  free.sort(compare);reserved.forEach(row=>row.sort(compare));
  const maxCabins=Math.max(...Array.from({length:state.shipCount},(_,ship)=>cabinCount(state,ship)));
  for(let cabin=0;cabin<maxCabins;cabin++)for(let ship=0;ship<state.shipCount;ship++){
    const capacity=cabinCount(state,ship);if(cabin>=capacity||result.ships[ship][cabin])continue;
    const local=reserved[ship];
    const remaining=result.ships[ship].slice(cabin,capacity).filter(id=>!id).length;
    // Keep enough seats for crew needed by this ship, including partial goals.
    const useLocal=local.length&&(!free.length||local.length>=remaining||compare(local[0],free[0])<=0);
    const id=useLocal?local.shift():free.shift();if(id)result.ships[ship][cabin]=id;
  }
  return result;
}
// Time-bounded search: randomised greedy construction, redundancy removal and a local search
// (one-for-one swaps and two-for-one merges), repeated from different starting orders until
// the budget runs out. Only crew that can contribute to a target are ever added, so achieved
// goals leave cabins empty. Reports the best found arrangement; does not claim a proof of
// global optimality or infeasibility.
export function solve(input,data,{milliseconds=10000,onProgress=()=>{},random=Math.random}={}){
  const started=performance.now(),deadline=started+milliseconds;const targets=input.targets;const locked=new Set(input.locked);
  const owned=new Set(input.owned);const pool=data.mates.filter(m=>!input.ownedOnly||owned.has(m.id));
  const required=new Set(input.required||[]);
  if(input.ownedOnly&&[...locked].some(id=>!owned.has(id)))throw Error('잠금한 항해사 중 미보유 항해사가 있어요. 보유로 표시하거나 잠금을 해제해 주세요.');
  for(const id of required)if(!owned.has(id)||!data.mateById.has(id))throw Error('필수 항해사의 보유 정보를 확인해 주세요.');
  if(new Set([...required,...locked]).size>fleetCapacity(input))throw Error('필수·잠금 항해사가 선실 수보다 많아요. 선박 수를 늘리거나 필수 지정을 줄여 주세요.');
  const base=structuredClone(input);base.ships=EMPTY();
  for(let s=0;s<input.shipCount;s++)for(let c=0;c<cabinCount(input,s);c++){
    const id=input.ships[s][c];if(id&&locked.has(id))base.ships[s][c]=id;
  }
  const stat=input.statPriority;
  const isPrimary=mate=>!!stat&&primaryStats(mate).includes(stat);
  const gradeRank=mate=>{const rank=GRADE_ORDER.indexOf(mate.grade);return rank<0?GRADE_ORDER.length:rank;};
  // Targets on abilities without a known scope never accumulate in summarize(); keep the solver consistent with it.
  const abilityTargets=new Map();targets.forEach((t,i)=>{if(!data.abilityById.get(t.ability)?.scope)return;if(!abilityTargets.has(t.ability))abilityTargets.set(t.ability,[]);abilityTargets.get(t.ability).push(i);});
  const ones=targets.map(()=>1);
  // Candidate records: only crew with at least one targeted effect or fixed grant can help,
  // plus mandatory crew, who ride along regardless.
  const relevant=pool.map(m=>{
    const fixed=m.grants.filter(g=>g.kind==='skill'||(g.origin==='transcendence_3'&&configuration(m,input).transcended));
    const options=candidates(m).filter(g=>abilityTargets.has(g.ability));
    const useful=options.length>0||fixed.some(g=>abilityTargets.has(g.ability));
    // Crew whose targeted grants are all fleet-wide score the same on every ship.
    const shipBound=[...options,...fixed].some(g=>(abilityTargets.get(g.ability)||[]).some(i=>targets[i].scope!=='fleet'));
    return {mate:m,options,fixed,useful,shipBound};
  }).filter(r=>r.useful||required.has(r.mate.id));
  const byId=new Map(relevant.map(r=>[r.mate.id,r]));
  const removable=id=>id&&!locked.has(id)&&!required.has(id);
  // ---- scoring ----
  // A snapshot holds the per-target levels and crew counts of a trial so moves can be scored
  // without re-summarising the whole fleet.
  function snapshot(trial){const s=summarize(trial,data);return {values:s.targets.map(t=>t.actual),count:s.placed,primary:s.primaryStatCounts[stat]||0,grades:GRADE_ORDER.map(g=>s.gradeCounts[g]||0)};}
  function scoreOf(snap){
    let deficit=0,over=0;for(let i=0;i<targets.length;i++){const gap=targets[i].level-snap.values[i];if(gap>0)deficit+=gap/targets[i].level;else over-=gap;}
    return {deficit,count:snap.count,primaryCount:snap.primary,grades:snap.grades,over};
  }
  function objective(trial){const snap=snapshot(trial);return {...scoreOf(snap),snap};}
  // Goal shortfall first, then fewer crew; with a stat priority, prefer crews with more
  // primary-stat holders and then higher grades among equally small crews.
  function better(a,b){if(Math.abs(a.deficit-b.deficit)>1e-8)return a.deficit<b.deficit;
    if(a.count!==b.count)return a.count<b.count;
    if(stat){
      if(a.primaryCount!==b.primaryCount)return a.primaryCount>b.primaryCount;
      for(let i=0;i<GRADE_ORDER.length;i++)if(a.grades[i]!==b.grades[i])return a.grades[i]>b.grades[i];
    }
    return a.over<b.over;}
  // Tie-break between candidates with equal gain: primary stat holders, then higher grade.
  const preferred=(a,b)=>(isPrimary(b)?1:0)-(isPrimary(a)?1:0)||gradeRank(a)-gradeRank(b);
  function contributions(mate,config,ship){
    const delta=[];for(const g of activeGrants(mate,config))for(const i of abilityTargets.get(g.ability)||[])if(targets[i].scope==='fleet'||targets[i].scope===ship)delta.push(i,g.level);return delta;
  }
  function shifted(snap,mate,config,ship,sign){
    const values=snap.values.slice(),delta=contributions(mate,config,ship);
    for(let k=0;k<delta.length;k+=2)values[delta[k]]+=sign*delta[k+1];
    const grades=snap.grades.slice(),rank=gradeRank(mate);if(rank<grades.length)grades[rank]+=sign;
    return {values,count:snap.count+sign,primary:snap.primary+(isPrimary(mate)?sign:0),grades};
  }
  // Best equipment for a candidate on a ship given current levels; only effects that close a gap are equipped.
  function optionFor(rec,ship,current,weights){
    const gain=g=>{
      let total=0;for(const i of abilityTargets.get(g.ability)||[]){const t=targets[i];if(t.scope==='fleet'||t.scope===ship)total+=Math.min(g.level,Math.max(0,t.level-current[i]))/t.level*weights[i];}return total;
    };
    const selected=rec.options.map(g=>({g,gain:gain(g)})).filter(o=>o.gain>0).sort((a,b)=>b.gain-a.gain).slice(0,slotLimit(rec.mate));
    const useful=selected.reduce((n,o)=>n+o.gain,0)+rec.fixed.reduce((n,g)=>n+gain(g),0);
    return {effects:selected.map(o=>o.g.ability),gain:useful};
  }
  const configFor=(mate,effects)=>({effects,transcended:configuration(mate,input).transcended});
  function place(trial,used,current,rec,ship,cabin,option){
    const m=rec.mate;trial.ships[ship][cabin]=m.id;used.add(m.id);trial.configs[m.id]=configFor(m,option.effects);
    const delta=contributions(m,trial.configs[m.id],ship);for(let k=0;k<delta.length;k+=2)current[delta[k]]+=delta[k+1];
  }
  function seatsOf(trial){
    const seats=[];for(let s=0;s<input.shipCount;s++)for(let c=0;c<cabinCount(input,s);c++){const id=trial.ships[s][c];if(removable(id))seats.push({s,c,id,mate:data.mateById.get(id)});}
    return seats;
  }
  // Drop occupants whose removal keeps every achieved level, trying the least valuable first.
  function prune(trial,used){
    const seats=seatsOf(trial).sort((a,b)=>preferred(b.mate,a.mate));
    let snap=snapshot(trial);
    for(const {s,c,id,mate} of seats){
      const next=shifted(snap,mate,trial.configs[id]||configuration(mate,trial),s,-1);
      if(scoreOf(next).deficit<=scoreOf(snap).deficit+1e-8){trial.ships[s][c]=null;used.delete(id);delete trial.configs[id];snap=next;}
    }
  }
  function unused(usedSet){return relevant.filter(r=>!usedSet.has(r.mate.id));}
  // One-for-one swaps: replace an occupant with an unused candidate when the objective improves.
  function swapPass(trial,used,until){
    let improved=false;
    for(const {s,c,id,mate} of seatsOf(trial)){
      if(performance.now()>=until)break;
      if(trial.ships[s][c]!==id)continue;
      const snap=snapshot(trial),current=scoreOf(snap);
      const without=shifted(snap,mate,trial.configs[id]||configuration(mate,trial),s,-1);
      let swap=null;
      for(const rec of unused(used)){
        const option=optionFor(rec,s,without.values,ones);if(option.gain<=0)continue;
        const candidate=scoreOf(shifted(without,rec.mate,configFor(rec.mate,option.effects),s,1));
        if(better(candidate,swap?swap.score:current))swap={rec,option,score:candidate};
      }
      if(swap){
        used.delete(id);delete trial.configs[id];
        trial.ships[s][c]=swap.rec.mate.id;used.add(swap.rec.mate.id);trial.configs[swap.rec.mate.id]=configFor(swap.rec.mate,swap.option.effects);
        improved=true;
      }
    }
    return improved;
  }
  // Two-for-one merges: replace a pair of occupants with one candidate that covers both.
  function mergePass(trial,used,until){
    const seats=seatsOf(trial);const snap=snapshot(trial),current=scoreOf(snap);
    for(let a=0;a<seats.length;a++)for(let b=a+1;b<seats.length;b++){
      if(performance.now()>=until)return false;
      const A=seats[a],B=seats[b];
      const without=shifted(shifted(snap,A.mate,trial.configs[A.id]||configuration(A.mate,trial),A.s,-1),B.mate,trial.configs[B.id]||configuration(B.mate,trial),B.s,-1);
      let merge=null;
      for(const rec of unused(used)){
        for(const seat of (A.s===B.s?[A]:[A,B])){
          const option=optionFor(rec,seat.s,without.values,ones);if(option.gain<=0)continue;
          const candidate=scoreOf(shifted(without,rec.mate,configFor(rec.mate,option.effects),seat.s,1));
          if(better(candidate,merge?merge.score:current))merge={rec,option,seat,score:candidate};
        }
      }
      if(merge){
        for(const seat of [A,B]){trial.ships[seat.s][seat.c]=null;used.delete(seat.id);delete trial.configs[seat.id];}
        trial.ships[merge.seat.s][merge.seat.c]=merge.rec.mate.id;used.add(merge.rec.mate.id);trial.configs[merge.rec.mate.id]=configFor(merge.rec.mate,merge.option.effects);
        return true;
      }
    }
    return false;
  }
  // Relocation: a ship-scoped target is short while a holder of that effect serves another
  // ship. Move the holder over (into an empty cabin, or over a replaceable occupant) and
  // backfill the ship it left with the best unused candidate. Accepted when the objective improves.
  function relocatePass(trial,used,until){
    const snap=snapshot(trial),current=scoreOf(snap);
    const shortTargets=targets.map((t,i)=>({t,i})).filter(({t,i})=>t.scope!=='fleet'&&snap.values[i]<t.level);
    if(!shortTargets.length)return false;
    const seats=seatsOf(trial);
    const config=seat=>trial.configs[seat.id]||configuration(seat.mate,trial);
    for(const {t,i} of shortTargets){
      const dest=t.scope;
      const holders=seats.filter(seat=>seat.s!==dest&&byId.get(seat.id)&&[...byId.get(seat.id).options,...byId.get(seat.id).fixed].some(g=>g.ability===t.ability));
      for(const holder of holders){
        if(performance.now()>=until)return false;
        const emptyCabin=trial.ships[dest].slice(0,cabinCount(input,dest)).indexOf(null);
        const landing=emptyCabin>=0?[{c:emptyCabin,evict:null}]:seats.filter(seat=>seat.s===dest).map(seat=>({c:seat.c,evict:seat}));
        for(const spot of landing){
          let s1=shifted(snap,holder.mate,config(holder),holder.s,-1);
          if(spot.evict)s1=shifted(s1,spot.evict.mate,config(spot.evict),dest,-1);
          const rec=byId.get(holder.id);const moveOption=optionFor(rec,dest,s1.values,ones);if(moveOption.gain<=0)continue;
          const moved=configFor(rec.mate,moveOption.effects);const s2=shifted(s1,rec.mate,moved,dest,1);
          // Backfill the vacated seat (and, if someone was evicted, give them a chance elsewhere is left to later rounds).
          let fill=null;const vacancyShip=holder.s;
          for(const cand of unused(used)){
            const option=optionFor(cand,vacancyShip,s2.values,ones);if(option.gain<=0)continue;
            const s3=shifted(s2,cand.mate,configFor(cand.mate,option.effects),vacancyShip,1);const sc=scoreOf(s3);
            if(better(sc,fill?fill.score:scoreOf(s2)))fill={cand,option,score:sc};
          }
          const finalScore=fill?fill.score:scoreOf(s2);
          if(!better(finalScore,current))continue;
          // apply
          trial.ships[holder.s][holder.c]=null;
          if(spot.evict){trial.ships[dest][spot.c]=null;used.delete(spot.evict.id);delete trial.configs[spot.evict.id];}
          trial.ships[dest][spot.c]=holder.id;trial.configs[holder.id]=moved;
          if(fill){trial.ships[vacancyShip][holder.c]=fill.cand.mate.id;used.add(fill.cand.mate.id);trial.configs[fill.cand.mate.id]=configFor(fill.cand.mate,fill.option.effects);}
          return true;
        }
      }
    }
    return false;
  }
  function refine(trial,used,until){
    for(let round=0;round<12&&performance.now()<until;round++){
      const moved=relocatePass(trial,used,until);
      const swapped=swapPass(trial,used,until);
      const merged=mergePass(trial,used,until);
      if(swapped||merged||moved)prune(trial,used);else break;
    }
  }
  let best=structuredClone(input),score=objective(best),iterations=0,lastProgress=0;
  // Existing occupants excluded by the owned filter cannot survive as the best result.
  if(input.ownedOnly&&input.ships.flat().some(id=>id&&!owned.has(id)&&!locked.has(id))){best=structuredClone(base);score=objective(best);}
  if([...required].some(id=>!best.ships.flat().includes(id)))best=null;
  do{
    const trial=structuredClone(base);const used=new Set(trial.ships.flat().filter(Boolean));let current=snapshot(trial).values;
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
      place(trial,used,current,rec,choice.ship,choice.cabin,choice.option);
    }
    // Small random exclusions diversify combinations without ever dropping locks.
    const records=relevant.filter(r=>iterations===0||random()>.08);
    for(let step=0;step<fleetCapacity(input);step++){
      if(performance.now()>=deadline)break;
      let chosen=null,bestGain=0;
      const empty=trial.ships.slice(0,input.shipCount).map((row,s)=>row.slice(0,cabinCount(input,s)).indexOf(null));
      const anyShip=empty.findIndex(c=>c>=0);if(anyShip<0)break;
      for(const rec of records){if(used.has(rec.mate.id))continue;
        for(let ship=0;ship<input.shipCount;ship++){if(empty[ship]<0)continue;
          if(!rec.shipBound&&ship!==anyShip)continue; // fleet-only crew: one evaluation is enough
          const option=optionFor(rec,ship,current,weights);
          if(option.gain>bestGain+1e-9||(option.gain>0&&Math.abs(option.gain-bestGain)<=1e-9&&chosen&&preferred(rec.mate,chosen.rec.mate)<0)){chosen={rec,ship,cabin:empty[ship],option};bestGain=option.gain;}
        }
      }
      if(!chosen)break; // nothing left that closes a gap: remaining cabins stay empty
      place(trial,used,current,chosen.rec,chosen.ship,chosen.cabin,chosen.option);
    }
    prune(trial,used);
    // Spend a slice of the budget improving this construction by local moves; promising
    // constructions (no worse than the best so far on goal shortfall) get a larger slice.
    const promising=!best||objective(trial).deficit<=score.deficit+1e-8;
    refine(trial,used,Math.min(deadline,performance.now()+Math.max(30,milliseconds*(promising?0.3:0.1))));
    const result=objective(trial);if(!best||better(result,score)){best=trial;score=result;}
    iterations++;
    if(performance.now()-lastProgress>250){lastProgress=performance.now();onProgress({state:distributeFleet(best,data),iterations,elapsed:performance.now()-started,achieved:summarize(best,data).achieved});}
  }while(performance.now()<deadline);
  return {state:distributeFleet(best,data),iterations,elapsed:performance.now()-started,achieved:summarize(best,data).achieved};
}
