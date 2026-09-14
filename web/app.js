import {KEY,EMPTY,initialState,indexCatalog,candidates,configuration,slotLimit,summarize,validateState} from './model.js';
const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const grade=g=>g==='S+'?'제독':g;
const labels={job:'습득 효과',character:'습득 효과',potential:'잠재 후보',relationship:'인연',transcendence_3:'3차 초월'};
let data,catalog,state=initialState(),selected=null,worker=null,proposed=null,detailMate=null;
let collectionFilter='all';
function setOwned(id,value){
  state.owned=value?[...new Set([...state.owned,id])]:state.owned.filter(x=>x!==id);
  if(!value){state.required=state.required.filter(x=>x!==id);state.locked=state.locked.filter(x=>x!==id);}
}
function toggleRequired(id){
  if(state.required.includes(id))state.required=state.required.filter(x=>x!==id);
  else{setOwned(id,true);state.required.push(id);}
  commit();
}
function collectionMates(){
  const q=$('#collection-search').value.trim().toLowerCase(),type=$('#collection-type').value,g=$('#collection-grade').value;
  return data.mates.filter(m=>(!q||`${m.name} ${m.job}`.toLowerCase().includes(q))&&(!type||type===m.type)&&(!g||g===m.grade)&&
    (collectionFilter==='all'||collectionFilter==='owned'&&state.owned.includes(m.id)||collectionFilter==='missing'&&!state.owned.includes(m.id)||collectionFilter==='required'&&state.required.includes(m.id)));
}
function renderCollection(){
  const list=collectionMates();
  $('#collection-counts').textContent=`보유 ${state.owned.length} · 미보유 ${data.mates.length-state.owned.length} · 필수 ${state.required.length}`;
  $('#collection-visible').textContent=`검색 결과 ${list.length}명`;
  document.querySelectorAll('[data-collection-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.collectionFilter===collectionFilter)));
  $('#collection-rows').innerHTML=list.map(m=>`<div class="collection-row"><label><input type="checkbox" data-own="${m.id}" aria-label="${escape(m.name)} 보유" ${state.owned.includes(m.id)?'checked':''}><span><b>${escape(m.name)}</b><small>${grade(m.grade)} · ${escape(m.type)} · ${escape(m.job)}</small></span></label><button data-required="${m.id}" aria-label="${escape(m.name)} 필수 포함" aria-pressed="${state.required.includes(m.id)}">${state.required.includes(m.id)?'★ 필수':'☆ 필수'}</button></div>`).join('')||'<p class="empty-roster">조건에 맞는 항해사가 없어요.</p>';
}
function notice(text){$('#notice').textContent=text;$('#notice').hidden=!text;}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{notice('브라우저 저장 공간을 사용할 수 없어요. 배치를 파일로 내보내 주세요.');}}
function commit(){proposed=null;$('#apply-result').hidden=true;$('#dismiss-result').hidden=true;save();render();}
function statsHtml(stats){return `<div class="stats-grid">${Object.entries(stats).map(([k,v])=>`<div class="stat-cell">${escape(k)}<strong>${v.toLocaleString()}</strong></div>`).join('')}</div>`;}
function renderRoster(){
  const query=$('#search').value.trim().toLowerCase();const type=$('#type-filter').value;const g=$('#grade-filter').value;
  const placed=new Set(state.ships.flat().filter(Boolean)),owned=new Set(state.owned);
  const list=data.mates.filter(m=>(!type||m.type===type)&&(!g||m.grade===g)&&(!state.ownedOnly||owned.has(m.id))&&
    (!query||`${m.name} ${m.job} ${m.grants.map(x=>data.abilityById.get(x.ability)?.name||'').join(' ')}`.toLowerCase().includes(query)));
  $('#roster-count').textContent=`${list.length}명`;
  $('#roster').innerHTML=list.map(m=>`<div class="mate-card ${selected===m.id?'selected':''} ${placed.has(m.id)?'placed':''}">
    <span class="monogram ${m.type==='전투'?'combat':m.type==='교역'?'trade':''}">${escape(m.name.slice(0,1))}</span>
    <button class="mate-info text-button" style="text-decoration:none;text-align:left" data-select="${m.id}" aria-label="${escape(m.name)} 배치 선택"><div class="mate-name"><span class="grade">${grade(m.grade)}</span>${escape(m.name)}</div><div class="mate-meta">${escape(m.type)} · ${escape(m.job)}${placed.has(m.id)?' · 승선':''}</div></button>
    <button class="detail-button" data-detail="${m.id}" aria-label="${escape(m.name)} 상세">ⓘ</button></div>`).join('')||'<div class="empty-roster">조건에 맞는 항해사가 없어요.</div>';
}
function renderShips(summary){
  $('#ships').innerHTML=state.ships.slice(0,state.shipCount).map((row,s)=>`<article class="ship"><header class="ship-header"><div class="ship-title"><span class="ship-number">${String(s+1).padStart(2,'0')}</span><h3>선박 ${s+1}</h3></div><small>${row.filter(Boolean).length} / 11</small></header><div class="cabins">${row.map((id,c)=>{
    const mate=data.mateById.get(id);return `<div class="cabin ${mate?'filled':''}"><button class="slot-button" data-slot="${s},${c}" aria-label="선박 ${s+1} ${c===0?'선장실':`선실 ${c}`} ${mate?escape(mate.name):'빈자리'}">${mate?`${escape(mate.name)}<span>${grade(mate.grade)} · ${escape(mate.type)}</span>`:`${c===0?'⚑ 선장실':`＋ 선실 ${c}`}`}</button>${mate?`<button class="lock-button ${state.locked.includes(id)?'locked':''}" data-lock="${id}" aria-pressed="${state.locked.includes(id)}" aria-label="${escape(mate.name)} 배치 잠금">${state.locked.includes(id)?'●':'○'}</button>`:''}</div>`;
  }).join('')}</div><div class="ship-footer">${summary.targets.filter(t=>t.scope===s).length}개 선박 목표 · ${row.filter(id=>state.locked.includes(id)).length}명 잠금</div></article>`).join('');
}
function renderTargets(summary){
  $('#targets').innerHTML=summary.targets.map((t,i)=>{
  const a=data.abilityById.get(t.ability);return `<div class="target ${t.actual>=t.level?'target-met':''}"><div class="target-head"><span>${escape(a.name)}</span><button data-delete-target="${i}" aria-label="${escape(a.name)} 목표 삭제">×</button></div><div class="target-meta"><span>${t.scope==='fleet'?'선단 전체':`선박 ${t.scope+1}`} · ${a.kind==='skill'?'기술':escape(a.category)}</span><strong>${t.actual} / ${t.level}${t.actual>=t.level?' ✓':''}</strong></div><div class="progress"><i style="width:${Math.min(100,t.actual/t.level*100)}%"></i></div></div>`;
  }).join('')||'<div class="empty-targets">아직 목표가 없어요.<br>필요한 효과와 레벨을 추가해 보세요.</div>';
  $('#solve').disabled=!state.targets.length||!!worker;
}
function render(){
  const summary=summarize(state,data);
  $('#owned-count').textContent=`${state.owned.length}명`;
  $('#required-list').innerHTML=`<h3>필수 포함 <span class="count">${state.required.length}명</span></h3><p class="small hint">자리는 자동으로 정하고 장착 효과도 목표에 맞춰 선택해요. 자리까지 고정하려면 배치 잠금을 사용하세요.</p>${state.required.map(id=>`<button class="required-chip" data-unrequire="${id}" aria-label="${escape(data.mateById.get(id).name)} 필수 해제">★ ${escape(data.mateById.get(id).name)} ×</button>`).join('')||'<button id="pick-required" class="text-button">필수 항해사 선택</button>'}`;
  $('#placed-count').textContent=summary.placed;$('#achieved-count').textContent=`${summary.achieved} / ${state.targets.length}`;
  $('#ship-count').value=state.shipCount;$('#owned-only').checked=state.ownedOnly;
  $('#stat-priority').value=state.statPriority;$('#budget').value=state.budget;
  $('#selected-name').textContent=selected?`${data.mateById.get(selected).name} · 배치할 선실을 선택하세요`:'배치할 항해사를 선택하세요';
  renderRoster();renderShips(summary);renderTargets(summary);
}
function filterAbilities(){
  const query=$('#ability-search').value.trim().toLowerCase();
  const old=$('#ability-select').value;
  const list=data.abilities.filter(a=>a.known&&a.scope&&(a.name+' '+a.category).toLowerCase().includes(query)).sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  $('#ability-select').innerHTML=list.map(a=>`<option value="${a.id}">${escape(a.name)} · ${a.kind==='skill'?'기술':a.category}</option>`).join('');
  if(list.some(a=>a.id===old))$('#ability-select').value=old;
  else if(list.length)$('#ability-select').selectedIndex=0;
  updateScope();
}
function updateScope(){
  const ability=data.abilityById.get($('#ability-select').value);
  $('#target-scope').innerHTML=ability?.scope==='fleet'?'<option value="fleet">선단 전체</option>':Array.from({length:state.shipCount},(_,s)=>`<option value="${s}">선박 ${s+1}</option>`).join('');
}
function showDialog(html){$('#detail-content').innerHTML=html;if(!$('#detail').open)$('#detail').showModal();}
function showMate(id){
  const m=data.mateById.get(id);if(!m)return;detailMate=id;const cfg=configuration(m,state),choices=candidates(m);
  showDialog(`<div class="eyebrow">NAVIGATOR</div><h2>${escape(m.name)}</h2><p class="small">${grade(m.grade)} · ${escape(m.type)} · ${escape(m.job)}</p>
    <div class="dialog-tools"><label><input type="checkbox" id="mate-owned" ${state.owned.includes(id)?'checked':''}> 보유 항해사</label><label><input type="checkbox" id="mate-required" ${state.required.includes(id)?'checked':''}> 필수 포함</label><label><input type="checkbox" id="mate-transcended" ${cfg.transcended?'checked':''}> 3차 초월 완료</label></div>
    <h3>스탯</h3>${statsHtml(m.stats)}<p class="small">원본 수치 기준 · 성장·장비 보정 미적용</p>
    <h3>장착 효과 <span id="effect-count">${cfg.effects.length}</span> / ${slotLimit(m)}</h3><p class="small">습득 레벨은 계산하지 않아요. 추천 효과에 맞춰 육성해 주세요.</p>
    <div>${choices.map(g=>{const a=data.abilityById.get(g.ability);return `<label class="effect-item"><input type="checkbox" data-equip="${g.ability}" ${cfg.effects.includes(g.ability)?'checked':''}><span>${escape(a?.name)} <b>Lv.${g.level}</b></span><small>${labels[g.origin]||''}</small></label>`;}).join('')}</div>
    <h3>고정 3차 초월 효과</h3>${m.grants.filter(g=>g.origin==='transcendence_3').map(g=>`<p>${escape(data.abilityById.get(g.ability)?.name)} Lv.${g.level}</p>`).join('')||'<p class="small">등록된 효과가 없어요.</p>'}
    <h3>해전 기술</h3>${m.grants.filter(g=>g.kind==='skill').map(g=>`<p class="small">${escape(data.abilityById.get(g.ability)?.name)} · Lv.${g.level}</p>`).join('')}
    ${state.ships.flat().includes(id)?'<button id="remove-mate" class="danger" style="margin-top:20px">승선 해제</button>':''}`);
}
function configureMate(){const mate=data.mateById.get(detailMate);if(!state.configs[detailMate])state.configs[detailMate]=configuration(mate,state);return state.configs[detailMate];}
function busy(value){document.body.classList.toggle('busy',value);$('#stop').hidden=!value;$('#solve').hidden=value;
  for(const id of ['export','import','about','stats-open','budget','clear','ship-count','owned-only','stat-priority','manage-owned'])$('#'+id).disabled=value;
}
function resultText(r,stopped=false){const summary=summarize(r.state,data);const remaining=summary.targets.filter(t=>t.actual<t.level);
  const mandatory=structuredClone(r.state);mandatory.ships=mandatory.ships.map(row=>row.map(id=>state.required.includes(id)?id:null));
  const contribution=summarize(mandatory,data).targets;
  return `${stopped?'중지됨':'탐색 완료'} · ${summary.achieved}/${state.targets.length}개 목표 달성 · ${summary.placed}명 · 필수 ${state.required.length}명 포함. ${state.required.length?`필수 항해사 기여: ${contribution.map(t=>`${data.abilityById.get(t.ability).name} ${t.actual}/${t.level}`).join(', ')}. `:''}${remaining.length?`부족: ${remaining.map(t=>`${data.abilityById.get(t.ability).name} ${t.level-t.actual}`).join(', ')}. `:''}탐색한 조합 중 가장 좋은 결과이며 최적해 보장은 아니에요.`;
}
function finish(result,stopped=false){if(worker)worker.terminate();worker=null;busy(false);
  if(result){proposed=result;$('#solve-status').textContent=resultText(result,stopped);$('#apply-result').hidden=false;$('#dismiss-result').hidden=false;}
  else $('#solve-status').textContent='탐색을 중지했어요. 현재 배치를 유지해요.';
}
async function init(){
  try{
    const response=await fetch('./catalog.json');if(!response.ok)throw Error('항해사 데이터를 불러오지 못했어요. 새로고침해 주세요.');
    catalog=await response.json();data=indexCatalog(catalog);
    try{const saved=localStorage.getItem(KEY);if(saved)state=validateState(JSON.parse(saved),data);}catch{notice('저장된 배치를 읽지 못해 새 배치로 시작했어요.');}
    data.mates.sort((a,b)=>['S+','S','A','B','C'].indexOf(a.grade)-['S+','S','A','B','C'].indexOf(b.grade)||a.name.localeCompare(b.name,'ko'));
    for(const name of Object.keys(data.mates[0].stats))$('#stat-priority').insertAdjacentHTML('beforeend',`<option>${escape(name)}</option>`);
    $('#loading').hidden=true;$('#workspace').hidden=false;filterAbilities();render();
  }catch(error){$('#loading').textContent=error.message;return;}
  for(const id of ['search','type-filter','grade-filter'])$('#'+id).addEventListener('input',renderRoster);
  const openCollection=()=>{if(worker)return;renderCollection();$('#collection').showModal();};
  $('#manage-owned').onclick=openCollection;
  $('#collection-close').onclick=()=>$('#collection').close();
  for(const id of ['collection-search','collection-type','collection-grade'])$('#'+id).oninput=renderCollection;
  document.querySelectorAll('[data-collection-filter]').forEach(b=>b.onclick=()=>{collectionFilter=b.dataset.collectionFilter;renderCollection();});
  $('#collection-rows').onchange=e=>{if(e.target.matches('[data-own]')){setOwned(e.target.dataset.own,e.target.checked);commit();renderCollection();}};
  $('#collection-rows').onclick=e=>{const b=e.target.closest('[data-required]');if(b){toggleRequired(b.dataset.required);renderCollection();}};
  $('#collection-add').onclick=()=>{for(const m of collectionMates())setOwned(m.id,true);commit();renderCollection();};
  $('#collection-remove').onclick=()=>{const list=collectionMates();if(list.length&&confirm(`검색 결과 ${list.length}명의 보유·필수·잠금을 해제할까요?`)){for(const m of list)setOwned(m.id,false);commit();renderCollection();}};
  $('#required-list').onclick=e=>{if(worker)return;const b=e.target.closest('[data-unrequire]');if(b)toggleRequired(b.dataset.unrequire);else if(e.target.id==='pick-required')openCollection();};
  $('#ability-search').addEventListener('input',filterAbilities);$('#ability-select').addEventListener('change',updateScope);
  $('#owned-only').onchange=e=>{state.ownedOnly=e.target.checked;commit();};
  $('#stat-priority').onchange=e=>{state.statPriority=e.target.value;commit();};
  $('#budget').onchange=e=>{state.budget=Number(e.target.value);save();};
  $('#roster').onclick=e=>{if(worker)return;const detail=e.target.closest('[data-detail]');if(detail){showMate(detail.dataset.detail);return;}
    const button=e.target.closest('[data-select]');if(button){selected=selected===button.dataset.select?null:button.dataset.select;render();}};
  $('#ships').onclick=e=>{if(worker)return;const lock=e.target.closest('[data-lock]');if(lock){const id=lock.dataset.lock;state.locked=state.locked.includes(id)?state.locked.filter(x=>x!==id):[...state.locked,id];commit();return;}
    const slot=e.target.closest('[data-slot]');if(!slot)return;const [s,c]=slot.dataset.slot.split(',').map(Number);const occupant=state.ships[s][c];
    if(!selected){if(occupant)showMate(occupant);else notice('왼쪽 목록에서 항해사를 먼저 선택해 주세요.');return;}
    if(state.locked.includes(selected)||state.locked.includes(occupant)){notice('잠금한 항해사는 잠금을 해제한 뒤 이동할 수 있어요.');return;}
    const previous=state.ships.flat().indexOf(selected);if(previous>=0)state.ships[Math.floor(previous/11)][previous%11]=null;
    state.ships[s][c]=selected;selected=null;notice('');commit();};
  $('#ship-count').onchange=e=>{const count=Number(e.target.value);
    if(count<state.shipCount&&state.ships.slice(count).flat().some(Boolean)&&!confirm('줄어드는 선박의 배치를 해제할까요?')){e.target.value=state.shipCount;return;}
    state.shipCount=count;for(let i=count;i<7;i++)state.ships[i]=Array(11).fill(null);
    state.locked=state.locked.filter(id=>state.ships.flat().includes(id));state.targets=state.targets.filter(t=>t.scope==='fleet'||t.scope<count);updateScope();commit();};
  $('#clear').onclick=()=>{if(confirm('선박 배치와 배치 잠금을 모두 비울까요? 목표와 보유 정보는 남아요.')){state.ships=EMPTY();state.locked=[];commit();}};
  $('#target-form').onsubmit=e=>{e.preventDefault();if(worker)return;const a=data.abilityById.get($('#ability-select').value);if(!a)return;
    const level=Number($('#target-level').value);if(!Number.isInteger(level)||level<1||level>10)return;
    const scope=a.scope==='fleet'?'fleet':Number($('#target-scope').value);const old=state.targets.find(t=>t.ability===a.id&&t.scope===scope);
    if(old)old.level=level;else if(state.targets.length<40)state.targets.push({ability:a.id,scope,level});else notice('목표는 최대 40개까지 추가할 수 있어요.');commit();};
  $('#targets').onclick=e=>{if(worker)return;const b=e.target.closest('[data-delete-target]');if(b){state.targets.splice(Number(b.dataset.deleteTarget),1);commit();}};
  $('#detail-close').onclick=()=>$('#detail').close();
  $('#detail-content').onchange=e=>{if(!detailMate)return;
    if(e.target.id==='mate-owned'){setOwned(detailMate,e.target.checked);commit();$('#mate-required').checked=state.required.includes(detailMate);}
    if(e.target.id==='mate-required'){toggleRequired(detailMate);$('#mate-owned').checked=state.owned.includes(detailMate);}
    if(e.target.id==='mate-transcended'){configureMate().transcended=e.target.checked;commit();}
    if(e.target.matches('[data-equip]')){const cfg=configureMate(),id=e.target.dataset.equip;const m=data.mateById.get(detailMate);
      if(state.locked.includes(detailMate)){e.target.checked=cfg.effects.includes(id);notice('효과를 바꾸려면 먼저 배치 잠금을 해제해 주세요.');return;}
      if(e.target.checked&&cfg.effects.length>=slotLimit(m)){e.target.checked=false;notice(`장착 효과는 최대 ${slotLimit(m)}개예요. 다른 효과를 해제해 주세요.`);return;}
      cfg.effects=e.target.checked?[...cfg.effects,id]:cfg.effects.filter(x=>x!==id);$('#effect-count').textContent=cfg.effects.length;commit();}
  };
  $('#detail-content').onclick=e=>{if(e.target.id==='remove-mate'){
    if(state.locked.includes(detailMate)){notice('배치 잠금을 먼저 해제해 주세요.');return;}
    state.ships=state.ships.map(row=>row.map(id=>id===detailMate?null:id));$('#detail').close();commit();}};
  $('#stats-open').onclick=()=>{detailMate=null;const summary=summarize(state,data);showDialog(`<h2>선단 스탯</h2><p class="small">승선한 항해사의 원본 스탯 단순 합계예요. 선박 보정·장비·태생·직업 직접 효과는 포함하지 않아요.</p><h3>전체</h3>${statsHtml(summary.stats)}${summary.shipStats.slice(0,state.shipCount).map((stats,i)=>`<h3>선박 ${i+1}</h3>${statsHtml(stats)}`).join('')}`);};
  $('#about').onclick=()=>{detailMate=null;showDialog(`<h2>계산 기준</h2><p>일반 항해사는 효과 5개, 제독은 6개를 선택해요. 10·30·50·70레벨 효과를 모두 장착 후보로 보고 습득 레벨을 제한하지 않아요. 3차 초월 완료를 체크하면 별도 고정 효과를 더해요.</p><h3>자동 맞춤</h3><p>목표 효과의 부족분을 우선 줄이고, 그다음 선택한 스탯 또는 적은 배치 인원을 고려해요. 잠금한 항해사의 자리와 장착 효과는 유지해요. 시간이 끝나면 찾은 결과를 검토하고 적용할 수 있어요. 전역 최적해나 목표 달성 불가능을 증명하는 계산은 아니에요.</p><h3>데이터 범위</h3><p>2026년 9월 2일 공개 스냅샷 640명 기준이에요. 정의가 없거나 적용 범위가 불확실한 효과는 목표 목록에서 제외했어요. 해전 기술 합산은 참고 사이트 규칙을 따르며, 일부 수치표는 비어 있어요. 태생·직업의 직접 수치 효과는 이번 레벨 목표 계산에 포함하지 않아요.</p><h3>저장</h3><p>보유 항해사와 배치는 이 브라우저에 저장돼요. 기기 간 자동 동기화는 없으니 파일 내보내기로 백업해 주세요.</p>`);};
  $('#solve').onclick=()=>{
    if(!state.targets.length)return;if(state.ownedOnly&&!state.owned.length&&!state.locked.length){notice('보유 항해사를 선택하거나 보유 필터를 꺼 주세요.');return;}
    proposed=null;$('#apply-result').hidden=true;$('#dismiss-result').hidden=true;notice('');busy(true);
    $('#solve-status').textContent='목표와 장착 칸 수에 맞는 조합을 찾고 있어요…';
    try{worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
      worker.onmessage=({data:r})=>{if(r.type==='error'){finish(null);notice(`계산을 완료하지 못했어요: ${r.message}`);return;}
        proposed=r;if(r.type==='done')finish(r);else $('#solve-status').textContent=`${(r.elapsed/1000).toFixed(1)}초 · ${r.achieved}/${state.targets.length}개 목표 달성 · ${r.iterations}개 조합 탐색`;};
      worker.onerror=()=>{finish(null);notice('자동 계산을 시작하지 못했어요. 새로고침 후 다시 시도해 주세요.');};
      worker.postMessage({state:structuredClone(state),catalog});
    }catch(error){finish(null);notice(error.message);}
  };
  $('#stop').onclick=()=>finish(proposed,true);
  $('#apply-result').onclick=()=>{if(proposed){state=validateState(proposed.state,data);commit();$('#solve-status').textContent='추천 배치를 적용했어요. 승선 항해사를 누르면 장착 효과를 확인할 수 있어요.';}};
  $('#dismiss-result').onclick=()=>{proposed=null;$('#apply-result').hidden=true;$('#dismiss-result').hidden=true;$('#solve-status').textContent='현재 배치를 유지했어요.';};
  $('#export').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='hangro-fleet.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('#import').onclick=()=>$('#file').click();
  $('#file').onchange=async e=>{const file=e.target.files[0];if(!file)return;
    try{if(file.size>2_000_000)throw Error('배치 파일이 너무 커요.');const imported=validateState(JSON.parse(await file.text()),data);
      if(confirm('현재 배치를 파일의 내용으로 바꿀까요?')){state=imported;selected=null;updateScope();commit();notice('배치 파일을 불러왔어요.');}
    }catch(error){notice(`불러오기 실패: ${error.message}`);}finally{e.target.value='';}};
}
init();
