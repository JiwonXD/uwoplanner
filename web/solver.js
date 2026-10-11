import {candidates,configuration,activeGrants,slotLimit,summarize,EMPTY,cabinCount,fleetCapacity,GRADE_ORDER,statRatio} from './model.js';
// Selected-stat weight of a navigator: their stat relative to their own highest stat (see statRatio).
const statOf=(mate,stat)=>stat?statRatio(mate,stat):0;
// Reorder the selected crew without changing equipment or ship-target contributions.
export function distributeFleet(state,data){
  const result=structuredClone(state),locked=new Set(state.locked||[]);
  const free=[],reserved=Array.from({length:state.shipCount},()=>[]),ranks=new Map();
  const shipTargets=reserved.map((_,ship)=>new Set(state.targets.filter(t=>t.scope===ship).map(t=>t.ability)));
  for(let ship=0;ship<state.shipCount;ship++)for(let cabin=0;cabin<cabinCount(state,ship);cabin++){
    const id=state.ships[ship][cabin];if(!id||locked.has(id))continue;
    const mate=data.mateById.get(id),grade=GRADE_ORDER.indexOf(mate.grade);
    ranks.set(id,[-statOf(mate,state.statPriority),grade<0?GRADE_ORDER.length:grade]);
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
// (one-for-one swaps, two-for-one merges and relocations), repeated from different starting
// orders until the budget runs out.
// fillMode 'min' (default): only crew that close a goal gap are added; achieved goals leave cabins
// empty, and a selected stat only breaks ties between equally small crews.
// fillMode 'max': every cabin is filled and, after goal shortfall, the fleet total of the selected
// stat is maximised, so goal contributors may be exchanged for higher-stat crew.
// Reports the best found arrangement; does not claim a proof of global optimality or infeasibility.
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
  const stat=input.statPriority,fill=input.fillMode==='max';
  const statValue=mate=>statOf(mate,stat);
  const gradeRank=mate=>{const rank=GRADE_ORDER.indexOf(mate.grade);return rank<0?GRADE_ORDER.length:rank;};
  // Targets on abilities without a known scope never accumulate in summarize(); keep the solver consistent with it.
  const abilityTargets=new Map();targets.forEach((t,i)=>{if(!data.abilityById.get(t.ability)?.scope)return;if(!abilityTargets.has(t.ability))abilityTargets.set(t.ability,[]);abilityTargets.get(t.ability).push(i);});
  const ones=targets.map(()=>1);
  // Candidate records. In 'min' mode only crew with a targeted effect or fixed grant (plus mandatory
  // crew) can help; in 'max' mode everyone may ride along as a stat filler.
  const relevant=pool.map(m=>{
    const fixed=m.grants.filter(g=>g.kind==='skill'||(g.origin==='transcendence_3'&&configuration(m,input).transcended));
    const options=candidates(m).filter(g=>abilityTargets.has(g.ability));
    const useful=options.length>0||fixed.some(g=>abilityTargets.has(g.ability));
    // Crew whose targeted grants are all fleet-wide score the same on every ship.
    const shipBound=[...options,...fixed].some(g=>(abilityTargets.get(g.ability)||[]).some(i=>targets[i].scope!=='fleet'));
    return {mate:m,options,fixed,useful,shipBound};
  }).filter(r=>r.useful||required.has(r.mate.id)||fill);
  const byId=new Map(relevant.map(r=>[r.mate.id,r]));
  // Targeted ability -> candidates who can provide it (equipable effect or fixed grant).
  const holdersOf=new Map();
  for(const r of relevant)for(const g of [...r.options,...r.fixed])if(abilityTargets.has(g.ability)){if(!holdersOf.has(g.ability))holdersOf.set(g.ability,new Set());holdersOf.get(g.ability).add(r);}
  const holdersFor=(abilities,usedSet,except)=>{const out=new Set();for(const a of abilities)for(const r of holdersOf.get(a)||[])if(!usedSet.has(r.mate.id)&&r.mate.id!==except)out.add(r);return out;};
  const removable=id=>id&&!locked.has(id)&&!required.has(id);
  // Tie-break between candidates: higher selected stat, then higher grade.
  const preferred=(a,b)=>statValue(b)-statValue(a)||gradeRank(a)-gradeRank(b);
  const byPreference=relevant.slice().sort((a,b)=>preferred(a.mate,b.mate));
  // ---- scoring ----
  // A snapshot holds the per-target levels and crew counts of a trial so moves can be scored
  // without re-summarising the whole fleet.
  function snapshot(trial){const s=summarize(trial,data);return {values:s.targets.map(t=>t.actual),count:s.placed,statSum:s.statScores[stat]||0,grades:GRADE_ORDER.map(g=>s.gradeCounts[g]||0)};}
  function scoreOf(snap){
    let deficit=0,over=0;for(let i=0;i<targets.length;i++){const gap=targets[i].level-snap.values[i];if(gap>0)deficit+=gap/targets[i].level;else over-=gap;}
    return {deficit,count:snap.count,statSum:snap.statSum,grades:snap.grades,over};
  }
  function objective(trial){const snap=snapshot(trial);return {...scoreOf(snap),snap};}
  function better(a,b){if(Math.abs(a.deficit-b.deficit)>1e-8)return a.deficit<b.deficit;
    if(fill){
      if(stat&&Math.abs(a.statSum-b.statSum)>1e-9)return a.statSum>b.statSum;
      if(a.count!==b.count)return a.count>b.count;
    }else{
      if(a.count!==b.count)return a.count<b.count;
      if(stat&&Math.abs(a.statSum-b.statSum)>1e-9)return a.statSum>b.statSum;
    }
    for(let i=0;i<GRADE_ORDER.length;i++)if(a.grades[i]!==b.grades[i])return a.grades[i]>b.grades[i];
    return a.over<b.over;}
  function contributions(mate,config,ship){
    const delta=[];for(const g of activeGrants(mate,config))for(const i of abilityTargets.get(g.ability)||[])if(targets[i].scope==='fleet'||targets[i].scope===ship)delta.push(i,g.level);return delta;
  }
  function shifted(snap,mate,config,ship,sign){
    const values=snap.values.slice(),delta=contributions(mate,config,ship);
    for(let k=0;k<delta.length;k+=2)values[delta[k]]+=sign*delta[k+1];
    const grades=snap.grades.slice(),rank=gradeRank(mate);if(rank<grades.length)grades[rank]+=sign;
    return {values,count:snap.count+sign,statSum:snap.statSum+sign*statValue(mate),grades};
  }
  // Best equipment for a candidate on a ship given current levels. In 'min' mode only effects that
  // close a gap are equipped; in 'max' mode every targeted effect is equipped (gap-closing ones first)
  // so a filler can take over a goal when the contributor it duplicates is swapped out later.
  function optionFor(rec,ship,current,weights){
    const gain=g=>{
      let total=0;for(const i of abilityTargets.get(g.ability)||[]){const t=targets[i];if(t.scope==='fleet'||t.scope===ship)total+=Math.min(g.level,Math.max(0,t.level-current[i]))/t.level*weights[i];}return total;
    };
    const applies=g=>(abilityTargets.get(g.ability)||[]).some(i=>targets[i].scope==='fleet'||targets[i].scope===ship);
    const selected=rec.options.map(g=>({g,gain:gain(g)})).filter(o=>o.gain>0||(fill&&applies(o.g))).sort((a,b)=>b.gain-a.gain||b.g.level-a.g.level).slice(0,slotLimit(rec.mate));
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
  function emptySeats(trial){
    const seats=[];for(let s=0;s<input.shipCount;s++)for(let c=0;c<cabinCount(input,s);c++)if(!trial.ships[s][c])seats.push({s,c});return seats;
  }
  const unused=usedSet=>relevant.filter(r=>!usedSet.has(r.mate.id));
  // 'max' mode cost model. Every cabin ends up occupied, so taking a navigator for a goal does not
  // cost a seat; it costs the stat of the filler they displace. The displaced filler is roughly the
  // K-th best navigator by selected stat (K = cabins), so a candidate at or above that level is free
  // and an off-stat candidate costs the gap. Construction then ranks candidates by goal gain per unit
  // of stat lost (plus a small seat price), which prefers several primary-stat crew holding one goal
  // effect each over one off-stat navigator holding them all, whenever cabins allow it.
  const marginal=(()=>{if(!fill||!stat)return 0;const values=relevant.map(r=>statValue(r.mate)).sort((a,b)=>b-a);return values[Math.min(values.length-1,Math.max(0,fleetCapacity(input)-1))]||0;})();
  const costOf=mate=>Math.max(0,marginal-statValue(mate));
  const SEAT_PRICES=[0.02,0.02,0.05,0.1,0.3,1]; // seat price per restart; higher values favour gain per seat when cabins are scarce
  const bestFiller=(usedSet,except)=>byPreference.find(r=>!usedSet.has(r.mate.id)&&r.mate.id!==except)||null;
  // Drop occupants whose removal keeps every achieved level, trying the least valuable first ('min' mode only).
  function prune(trial,used){
    if(fill)return;
    const seats=seatsOf(trial).sort((a,b)=>preferred(b.mate,a.mate));
    let snap=snapshot(trial);
    for(const {s,c,id,mate} of seats){
      const next=shifted(snap,mate,trial.configs[id]||configuration(mate,trial),s,-1);
      if(scoreOf(next).deficit<=scoreOf(snap).deficit+1e-8){trial.ships[s][c]=null;used.delete(id);delete trial.configs[id];snap=next;}
    }
  }
  // 'max' mode: fill every empty cabin with the best remaining crew by selected stat, then grade.
  function fillEmpties(trial,used,current){
    for(const {s,c} of emptySeats(trial)){
      const rec=bestFiller(used);if(!rec)break;
      place(trial,used,current,rec,s,c,optionFor(rec,s,current,ones));
    }
  }
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
        const option=optionFor(rec,s,without.values,ones);if(!fill&&option.gain<=0)continue;
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
  // In 'max' mode the freed seat is immediately refilled with the best remaining filler.
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
          let after=shifted(without,rec.mate,configFor(rec.mate,option.effects),seat.s,1),refill=null;
          if(fill){
            const other=seat===A?B:A;const filler=bestFiller(used,rec.mate.id);
            if(filler){const opt=optionFor(filler,other.s,after.values,ones);refill={rec:filler,option:opt,seat:other};after=shifted(after,filler.mate,configFor(filler.mate,opt.effects),other.s,1);}
          }
          const candidate=scoreOf(after);
          if(better(candidate,merge?merge.score:current))merge={rec,option,seat,refill,score:candidate};
        }
      }
      if(merge){
        for(const seat of [A,B]){trial.ships[seat.s][seat.c]=null;used.delete(seat.id);delete trial.configs[seat.id];}
        trial.ships[merge.seat.s][merge.seat.c]=merge.rec.mate.id;used.add(merge.rec.mate.id);trial.configs[merge.rec.mate.id]=configFor(merge.rec.mate,merge.option.effects);
        if(merge.refill){const r=merge.refill;trial.ships[r.seat.s][r.seat.c]=r.rec.mate.id;used.add(r.rec.mate.id);trial.configs[r.rec.mate.id]=configFor(r.rec.mate,r.option.effects);}
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
    for(const {t} of shortTargets){
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
          // Backfill the vacated seat with the best unused candidate (any crew in 'max' mode).
          let backfill=null;const vacancyShip=holder.s;
          for(const cand of unused(used)){
            if(cand.mate.id===holder.id)continue;
            const option=optionFor(cand,vacancyShip,s2.values,ones);if(!fill&&option.gain<=0)continue;
            const s3=shifted(s2,cand.mate,configFor(cand.mate,option.effects),vacancyShip,1);const sc=scoreOf(s3);
            if(better(sc,backfill?backfill.score:scoreOf(s2)))backfill={cand,option,score:sc};
          }
          const finalScore=backfill?backfill.score:scoreOf(s2);
          if(!better(finalScore,current))continue;
          trial.ships[holder.s][holder.c]=null;
          if(spot.evict){trial.ships[dest][spot.c]=null;used.delete(spot.evict.id);delete trial.configs[spot.evict.id];}
          trial.ships[dest][spot.c]=holder.id;trial.configs[holder.id]=moved;
          if(backfill){trial.ships[vacancyShip][holder.c]=backfill.cand.mate.id;used.add(backfill.cand.mate.id);trial.configs[backfill.cand.mate.id]=configFor(backfill.cand.mate,backfill.option.effects);}
          return true;
        }
      }
    }
    return false;
  }
  // 'max' mode split: one occupant who covers several goals is replaced by two crew who cover the
  // same goals between them, the second taking the seat of a low-value occupant (an effect-less
  // filler first). A one-for-one swap cannot reach this, because the first replacement alone opens a
  // gap that only the second closes; e.g. two primary-stat crew holding a+b and c instead of one
  // off-stat crew holding a+b+c plus a filler.
  function splitPass(trial,used,until){
    if(!fill)return false;
    const snap=snapshot(trial),current=scoreOf(snap);
    const config=seat=>trial.configs[seat.id]||configuration(seat.mate,trial);
    const info=seatsOf(trial).map(seat=>({seat,delta:contributions(seat.mate,config(seat),seat.s)}));
    const victims=info.slice().sort((p,q)=>(p.delta.length>0)-(q.delta.length>0)||statValue(p.seat.mate)-statValue(q.seat.mate)||gradeRank(q.seat.mate)-gradeRank(p.seat.mate)).slice(0,3);
    for(const {seat:A,delta} of info){
      if(delta.length<4)continue; // covers at most one goal: a plain swap suffices
      const without=shifted(snap,A.mate,config(A),A.s,-1);
      const lost=new Set();for(let k=0;k<delta.length;k+=2)lost.add(targets[delta[k]].ability);
      for(const P of holdersFor(lost,used)){
        if(performance.now()>=until)return false;
        const pOption=optionFor(P,A.s,without.values,ones);if(pOption.gain<=0)continue;
        const s1=shifted(without,P.mate,configFor(P.mate,pOption.effects),A.s,1);
        const missing=new Set();for(let i=0;i<targets.length;i++)if(s1.values[i]<targets[i].level&&s1.values[i]<snap.values[i])missing.add(targets[i].ability);
        if(!missing.size)continue; // P alone covers A: the swap pass handles this
        for(const {seat:B} of victims){
          if(B===A)continue;
          const s2=shifted(s1,B.mate,config(B),B.s,-1);
          let second=null;
          for(const Q of holdersFor(missing,used,P.mate.id)){
            const qOption=optionFor(Q,B.s,s2.values,ones);if(qOption.gain<=0)continue;
            const score=scoreOf(shifted(s2,Q.mate,configFor(Q.mate,qOption.effects),B.s,1));
            if(better(score,second?second.score:current))second={Q,qOption,score};
          }
          if(!second)continue;
          for(const seat of [A,B]){trial.ships[seat.s][seat.c]=null;used.delete(seat.id);delete trial.configs[seat.id];}
          trial.ships[A.s][A.c]=P.mate.id;used.add(P.mate.id);trial.configs[P.mate.id]=configFor(P.mate,pOption.effects);
          trial.ships[B.s][B.c]=second.Q.mate.id;used.add(second.Q.mate.id);trial.configs[second.Q.mate.id]=configFor(second.Q.mate,second.qOption.effects);
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
      const split=splitPass(trial,used,until);
      const merged=mergePass(trial,used,until);
      if(swapped||merged||moved||split)prune(trial,used);else break;
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
    const records=relevant.filter(r=>r.useful&&(iterations===0||random()>.08));
    const seatPrice=fill?SEAT_PRICES[iterations===0?0:Math.floor(random()*SEAT_PRICES.length)]:1;
    // 'min' mode ranks by goal gain; 'max' mode by gain per stat lost (see marginal/costOf above).
    const rank=(rec,option)=>fill?option.gain/(costOf(rec.mate)+seatPrice):option.gain;
    for(let step=0;step<fleetCapacity(input);step++){
      if(performance.now()>=deadline)break;
      let chosen=null,bestRank=0;
      const empty=trial.ships.slice(0,input.shipCount).map((row,s)=>row.slice(0,cabinCount(input,s)).indexOf(null));
      const anyShip=empty.findIndex(c=>c>=0);if(anyShip<0)break;
      for(const rec of records){if(used.has(rec.mate.id))continue;
        for(let ship=0;ship<input.shipCount;ship++){if(empty[ship]<0)continue;
          if(!rec.shipBound&&ship!==anyShip)continue; // fleet-only crew: one evaluation is enough
          const option=optionFor(rec,ship,current,weights);if(option.gain<=0)continue;
          const value=rank(rec,option);
          if(value>bestRank+1e-9||(Math.abs(value-bestRank)<=1e-9&&chosen&&preferred(rec.mate,chosen.rec.mate)<0)){chosen={rec,ship,cabin:empty[ship],option};bestRank=value;}
        }
      }
      if(!chosen)break; // nothing left that closes a gap
      place(trial,used,current,chosen.rec,chosen.ship,chosen.cabin,chosen.option);
    }
    if(fill)fillEmpties(trial,used,current);else prune(trial,used);
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
