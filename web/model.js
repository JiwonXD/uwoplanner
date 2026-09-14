export const MAX_CABINS=11;
export const GRADE_ORDER=['S+','S','A','B','C'];
export const EMPTY=()=>Array.from({length:7},()=>Array(MAX_CABINS).fill(null));
export const cabinCount=(state,ship)=>state.shipCapacities?.[ship]??MAX_CABINS;
export const fleetCapacity=state=>Array.from({length:state.shipCount},(_,s)=>cabinCount(state,s)).reduce((a,b)=>a+b,0);
export const KEY='hangro-planner-v1';
export function initialState(){return {version:1,ships:EMPTY(),shipCapacities:Array(7).fill(MAX_CABINS),shipCount:7,targets:[],owned:[],ownedOnly:false,
  configs:{},locked:[],required:[],statPriority:'',budget:10000};}
export function slotLimit(mate){return mate.grade==='S+'?6:5;}
export function primaryStats(mate){
  const entries=Object.entries(mate.stats||{}).filter(([,value])=>Number.isFinite(value)&&value>0);
  const highest=Math.max(0,...entries.map(([,value])=>value));
  return entries.filter(([,value])=>value===highest).map(([name])=>name);
}
export function indexCatalog(data){return {...data, mateById:new Map(data.mates.map(m=>[m.id,m])),
  abilityById:new Map(data.abilities.map(a=>[a.id,a]))};}
export function candidates(mate){
  const map=new Map();
  for(const g of mate.grants) if(g.kind==='effect'&&g.origin!=='transcendence_3') {
    if(!map.has(g.ability)||g.level>map.get(g.ability).level)map.set(g.ability,g);
  }
  return [...map.values()];
}
export function configuration(mate,state){
  const saved=state.configs[mate.id];
  return {effects:saved?.effects||candidates(mate).slice(0,slotLimit(mate)).map(g=>g.ability),transcended:!!saved?.transcended};
}
export function activeGrants(mate,config){
  const ids=new Set((config.effects||[]).slice(0,slotLimit(mate)));
  return [...candidates(mate).filter(g=>ids.has(g.ability)),
    ...mate.grants.filter(g=>g.kind==='skill'||(g.origin==='transcendence_3'&&config.transcended))];
}
export function summarize(state,data){
  const levels=new Map();const shipStats=Array.from({length:7},()=>({}));const stats={},primaryStatCounts={},gradeCounts={};let placed=0;
  for(let s=0;s<state.shipCount;s++)for(const id of state.ships[s].slice(0,cabinCount(state,s))){
    if(!id)continue;const mate=data.mateById.get(id);if(!mate)continue;placed++;
    gradeCounts[mate.grade]=(gradeCounts[mate.grade]||0)+1;
    for(const name of primaryStats(mate))primaryStatCounts[name]=(primaryStatCounts[name]||0)+1;
    for(const [name,value]of Object.entries(mate.stats)){stats[name]=(stats[name]||0)+value;shipStats[s][name]=(shipStats[s][name]||0)+value;}
    for(const g of activeGrants(mate,configuration(mate,state))){
      const ability=data.abilityById.get(g.ability);if(!ability?.scope)continue;
      const key=`${g.ability}:${ability.scope==='fleet'?'fleet':s}`;
      levels.set(key,(levels.get(key)||0)+g.level);
    }
  }
  const targets=state.targets.map(t=>({...t,actual:levels.get(`${t.ability}:${t.scope}`)||0}));
  return {levels,stats,shipStats,primaryStatCounts,gradeCounts,placed,targets,achieved:targets.filter(t=>t.actual>=t.level).length};
}
export function validateState(value,data){
  if(!value||value.version!==1||!Array.isArray(value.ships)||value.ships.length!==7)throw Error('지원하지 않는 배치 파일입니다.');
  const clean=initialState();clean.shipCount=Number(value.shipCount);
  if(!Number.isInteger(clean.shipCount)||clean.shipCount<1||clean.shipCount>7)throw Error('선박 수가 올바르지 않습니다.');
  if(value.shipCapacities!==undefined&&(!Array.isArray(value.shipCapacities)||value.shipCapacities.length!==7))throw Error('선박별 선실 수가 올바르지 않습니다.');
  clean.shipCapacities=value.ships.map((row,s)=>value.shipCapacities?.[s]??row?.length);
  if(clean.shipCapacities.some(n=>!Number.isInteger(n)||n<1||n>MAX_CABINS))throw Error('선실 수가 올바르지 않습니다.');
  const used=new Set();
  clean.ships=value.ships.map((row,s)=>{
    if(!Array.isArray(row)||row.length<1||row.length>MAX_CABINS)throw Error('선실 수가 올바르지 않습니다.');
    return Array.from({length:MAX_CABINS},(_,c)=>{const id=c<row.length?row[c]:null;if(id===null)return null;if(c>=clean.shipCapacities[s]||s>=clean.shipCount||!data.mateById.has(id)||used.has(id))throw Error('중복되거나 유효하지 않은 항해사 배치입니다.');used.add(id);return id;});
  });
  clean.owned=[...new Set((Array.isArray(value.owned)?value.owned:[]).filter(id=>data.mateById.has(id)))];
  clean.ownedOnly=!!value.ownedOnly;
  clean.required=[...new Set((Array.isArray(value.required)?value.required:[]).filter(id=>data.mateById.has(id)))];
  if(clean.required.some(id=>!clean.owned.includes(id)))throw Error('필수 항해사는 보유 항해사여야 합니다.');
  clean.locked=[...new Set((Array.isArray(value.locked)?value.locked:[]).filter(id=>used.has(id)))];
  clean.targets=[];
  const keys=new Set();
  for(const t of (Array.isArray(value.targets)?value.targets:[])){
    const a=data.abilityById.get(t.ability);const scope=t.scope;
    if(!a?.known||!a.scope||!Number.isInteger(t.level)||t.level<1||t.level>10||
      (a.scope==='fleet'?scope!=='fleet':!Number.isInteger(scope)||scope<0||scope>=clean.shipCount))throw Error('목표 효과가 올바르지 않습니다.');
    const key=`${t.ability}:${scope}`;if(keys.has(key))throw Error('중복된 목표입니다.');keys.add(key);
    clean.targets.push({ability:t.ability,scope,level:t.level});
  }
  if(clean.targets.length>40)throw Error('목표는 최대 40개까지 설정할 수 있습니다.');
  for(const [id,config]of Object.entries(value.configs||{})){
    const mate=data.mateById.get(id);if(!mate)continue;
    const possible=new Set(candidates(mate).map(g=>g.ability));
    const effects=[...new Set((Array.isArray(config.effects)?config.effects:[]).filter(a=>possible.has(a)))];
    if(effects.length>slotLimit(mate))throw Error(`${mate.name}: 장착 효과 수가 초과됐습니다.`);
    clean.configs[id]={effects,transcended:!!config.transcended};
  }
  const statNames=new Set(data.mates.flatMap(m=>Object.keys(m.stats)));
  clean.statPriority=statNames.has(value.statPriority)?value.statPriority:'';
  clean.budget=[2000,10000,30000].includes(value.budget)?value.budget:10000;
  return clean;
}

export function migrateLegacyLocks(state){
  const locked=state.locked||[];
  state.required=[...new Set([...state.required,...locked])];
  state.owned=[...new Set([...state.owned,...locked])];
  state.locked=[];
  return state;
}
