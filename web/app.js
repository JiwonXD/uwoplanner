import {KEY,EMPTY,initialState,indexCatalog,candidates,configuration,slotLimit,summarize,validateState,migrateLegacyLocks} from './model.js';
const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const grade=g=>g==='S+'?'제독':g;
const labels={job:'습득 효과',character:'습득 효과',potential:'잠재 후보',relationship:'인연',transcendence_3:'3차 초월'};
let data,catalog,state=initialState(),worker=null,proposed=null,detailMate=null;
let collectionFilter='all';
let goalMode='fleet';
let pendingSlot=null,lastSaved=null;
const history=[];
function setOwned(id,value){
  state.owned=value?[...new Set([...state.owned,id])]:state.owned.filter(x=>x!==id);
  if(!value){state.required=state.required.filter(x=>x!==id);state.locked=state.locked.filter(x=>x!==id);}
}
function toggleRequired(id){
  if(state.required.includes(id))state.required=state.required.filter(x=>x!==id);
  else{if(!state.owned.includes(id))return;state.required.push(id);}
  commit();
}
function requiredButton(m){return `<button class="required-toggle" data-card-required="${m.id}" aria-label="${escape(m.name)} 필수 포함" aria-pressed="${state.required.includes(m.id)}" ${!state.owned.includes(m.id)?'disabled title="보유 항해사로 등록하면 필수 지정할 수 있습니다."':''}>${state.required.includes(m.id)?'✓ 필수':'필수'}</button>`;}
function removeFromFleet(id){
  state.ships=state.ships.map(row=>row.map(x=>x===id?null:x));
  commit();notice(state.required.includes(id)?'승선을 해제했습니다. 필수 지정은 유지되어 다음 자동 맞춤에 다시 포함됩니다.':'승선을 해제했습니다.');
}
function collectionMates(){
  const q=$('#collection-search').value.trim().toLowerCase(),type=$('#collection-type').value,g=$('#collection-grade').value;
  return data.mates.filter(m=>(!q||`${m.name} ${m.job} ${m.grants.map(g=>data.abilityById.get(g.ability)?.name||'').join(' ')}`.toLowerCase().includes(q))&&(!type||type===m.type)&&(!g||g===m.grade)&&
    (collectionFilter==='all'||collectionFilter==='owned'&&state.owned.includes(m.id)||collectionFilter==='missing'&&!state.owned.includes(m.id))).sort((a,b)=>$('#collection-sort').value==='name'?a.name.localeCompare(b.name,'ko'):['S+','S','A','B','C'].indexOf(a.grade)-['S+','S','A','B','C'].indexOf(b.grade)||a.name.localeCompare(b.name,'ko'));
}
function renderCollection(){
  const list=collectionMates();
  $('#collection-counts').textContent=`보유 ${state.owned.length} · 미보유 ${data.mates.length-state.owned.length}`;
  $('#collection-visible').textContent=`검색 결과 ${list.length}명`;
  document.querySelectorAll('[data-collection-filter]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.collectionFilter===collectionFilter));b.textContent=`${{all:'전체',owned:'보유',missing:'미보유'}[b.dataset.collectionFilter]} ${b.dataset.collectionFilter==='all'?data.mates.length:b.dataset.collectionFilter==='owned'?state.owned.length:data.mates.length-state.owned.length}`;});
  $('#collection-rows').innerHTML=list.map(m=>`<div class="collection-row"><label><input type="checkbox" data-own="${m.id}" aria-label="${escape(m.name)} 보유" ${state.owned.includes(m.id)?'checked':''}><span><b>${escape(m.name)}</b><small>${grade(m.grade)} · ${escape(m.type)} · ${escape(m.job)}</small></span></label>${requiredButton(m)}<button class="text-button" data-collection-detail="${m.id}" aria-label="${escape(m.name)} 상세 정보">상세 보기</button></div>`).join('')||'<p class="empty-roster">조건에 맞는 항해사가 없어요.</p>';
}
function renderPage(){
  const collection=location.hash==='#collection';
  $('#workspace').hidden=collection;
  $('#planner-heading').hidden=collection;
  document.querySelector('.mobile-nav').hidden=collection;
  $('#collection').hidden=!collection;
  document.querySelectorAll('[data-page]').forEach(a=>{
    if(a.dataset.page===(collection?'collection':'planner'))a.setAttribute('aria-current','page');
    else a.removeAttribute('aria-current');
  });
  if(collection)renderCollection();
  document.title=collection?'항해사 목록 · 항로':'선단 배치 · 항로';
}
function renderRequired(){
  const q=$('#required-search').value.trim().toLowerCase();
  const list=data.mates.filter(m=>state.owned.includes(m.id)&&(!q||`${m.name} ${m.job}`.toLowerCase().includes(q)));
  $('#required-selected').innerHTML=`<h3>선택 ${state.required.length} / ${state.shipCount*11}명</h3>${state.required.map(id=>`<button class="required-chip" data-required-remove="${id}" aria-label="${escape(data.mateById.get(id).name)} 필수 선택 해제">${escape(data.mateById.get(id).name)} ×</button>`).join('')||'<p class="small hint">선택된 항해사가 없습니다.</p>'}`;
  $('#required-rows').innerHTML=list.map(m=>`<div class="collection-row"><label><input type="checkbox" data-required-check="${m.id}" aria-label="${escape(m.name)} 필수 포함" ${state.required.includes(m.id)?'checked':''}><span><b>${escape(m.name)}</b><small>${grade(m.grade)} · ${escape(m.type)} · ${escape(m.job)}</small></span></label></div>`).join('')||`<p class="empty-roster">${state.owned.length?'검색 결과가 없습니다.':'보유 항해사를 먼저 등록하세요.'}</p>`;
}
function notice(text){$('#notice').textContent=text;$('#notice').hidden=!text;}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{notice('브라우저 저장 공간을 사용할 수 없어요. 배치를 파일로 내보내 주세요.');}}
function clearProposal(){proposed=null;$('#apply-result').hidden=true;$('#dismiss-result').hidden=true;$('#result-preview').hidden=true;}
function commit(){
  if(lastSaved){history.push(lastSaved);if(history.length>20)history.shift();}
  lastSaved=structuredClone(state);clearProposal();$('#solve-status').textContent='설정이 변경되었습니다. 자동 맞춤을 실행하세요.';save();render();
}
function openPicker(s,c){
  pendingSlot=[s,c];$('#picker-title').textContent=`선박 ${s+1} · ${c===0?'선장실':`선실 ${c}`}`;
  $('#picker-context').textContent='배치할 항해사를 선택하세요. 이미 승선한 항해사는 이 자리로 이동합니다.';
  renderRoster();$('#roster-dialog').showModal();$('#search').focus();
}
function renderPreview(result){
  const before=summarize(state,data),after=summarize(result.state,data);
  $('#result-preview').hidden=false;
  $('#result-preview').innerHTML=`<h3>추천 배치 검토</h3><p class="small">목표 달성 ${before.achieved} → ${after.achieved} / ${state.targets.length} · 승선 ${before.placed} → ${after.placed}명</p>${state.statPriority?`<p class="stat-comparison"><strong>${escape(state.statPriority)} 선단 합계</strong><br>${(before.stats[state.statPriority]||0).toLocaleString()} → ${(after.stats[state.statPriority]||0).toLocaleString()}</p>`:''}<div class="comparison-scroll"><table><caption>목표별 현재 배치와 추천 배치 비교</caption><thead><tr><th>목표</th><th>현재</th><th>추천</th><th>부족</th></tr></thead><tbody>${after.targets.map((t,i)=>`<tr><th>${escape(data.abilityById.get(t.ability).name)}<small>${t.scope==='fleet'?'선단 전체':`선박 ${t.scope+1}`} · 목표 ${t.level}</small></th><td>${before.targets[i].actual}</td><td>${t.actual}</td><td>${Math.max(0,t.level-t.actual)||'달성'}</td></tr>`).join('')}</tbody></table></div><details><summary>선박별 항해사·장착 효과 확인</summary>${result.state.ships.slice(0,state.shipCount).map((row,i)=>`<h4>선박 ${i+1} · ${row.filter(Boolean).length}명</h4>${row.filter(Boolean).map(id=>{const m=data.mateById.get(id),cfg=configuration(m,result.state);return `<div class="preview-mate"><b>${escape(m.name)}${state.required.includes(id)?' · 필수':''}</b><p>${cfg.effects.map(a=>escape(data.abilityById.get(a).name)).join(', ')}${cfg.transcended?' · 3차 초월 적용':''}</p></div>`;}).join('')||'<p class="small">빈 선박</p>'}`).join('')}</details>`;
}

function statsHtml(stats){return `<div class="stats-grid">${Object.entries(stats).map(([k,v])=>`<div class="stat-cell">${escape(k)}<strong>${v.toLocaleString()}</strong></div>`).join('')}</div>`;}
function renderRoster(){
  const query=$('#search').value.trim().toLowerCase();const type=$('#type-filter').value;const g=$('#grade-filter').value;
  const placed=new Set(state.ships.flat().filter(Boolean)),owned=new Set(state.owned);
  const list=data.mates.filter(m=>(!type||m.type===type)&&(!g||m.grade===g)&&(!state.ownedOnly||owned.has(m.id))&&
    (!query||`${m.name} ${m.job} ${m.grants.map(x=>data.abilityById.get(x.ability)?.name||'').join(' ')}`.toLowerCase().includes(query)));
  $('#roster-count').textContent=`${list.length}명`;
  $('#roster').innerHTML=list.map(m=>`<div class="mate-card ${placed.has(m.id)?'placed':''}">
    <span class="monogram ${m.type==='전투'?'combat':m.type==='교역'?'trade':''}">${escape(m.name.slice(0,1))}</span>
    <button class="mate-info text-button" style="text-decoration:none;text-align:left" data-select="${m.id}" aria-label="${escape(m.name)} 배치 선택"><div class="mate-name"><span class="grade">${grade(m.grade)}</span>${escape(m.name)}</div><div class="mate-meta">${escape(m.type)} · ${escape(m.job)}${placed.has(m.id)?' · 승선':''}</div></button>
    ${requiredButton(m)}<button class="detail-button" data-detail="${m.id}" aria-label="${escape(m.name)} 상세">ⓘ</button></div>`).join('')||'<div class="empty-roster">조건에 맞는 항해사가 없어요.</div>';
}
function renderShips(summary){
  $('#ships').innerHTML=state.ships.slice(0,state.shipCount).map((row,s)=>`<article class="ship"><header class="ship-header"><div class="ship-title"><span class="ship-number">${String(s+1).padStart(2,'0')}</span><h3>선박 ${s+1}</h3></div><small>${row.filter(Boolean).length} / 11</small></header><div class="cabins">${row.map((id,c)=>{
    const mate=data.mateById.get(id);return `<div class="cabin ${mate?'filled':''}"><button class="slot-button" data-slot="${s},${c}" aria-label="선박 ${s+1} ${c===0?'선장실':`선실 ${c}`} ${mate?escape(mate.name):'빈자리'}">${mate?`${escape(mate.name)}<span>${grade(mate.grade)} · ${escape(mate.type)}</span>`:`${c===0?'⚑ 선장실':`＋ 선실 ${c}`}`}</button>${mate?`<button class="remove-cabin" data-remove-cabin="${id}" aria-label="${escape(mate.name)} 승선 해제" title="승선 해제">×</button>`:''}</div>`;
  }).join('')}</div><div class="ship-footer">${summary.targets.filter(t=>t.scope===s).length}개 선박 목표 · ${row.filter(id=>state.required.includes(id)).length}명 필수</div></article>`).join('');
}
function renderTargets(summary){
  const rows=summary.targets.map((t,i)=>{
  const a=data.abilityById.get(t.ability);return `<div class="target ${t.actual>=t.level?'target-met':''}"><div class="target-head"><span>${escape(a.name)}</span><button data-delete-target="${i}" aria-label="${escape(a.name)} 목표 삭제">×</button></div><div class="target-meta"><span>${t.scope==='fleet'?'선단 전체':`선박 ${t.scope+1}`} · ${a.kind==='skill'?'기술':escape(a.category)}</span><strong>현재 ${t.actual}${t.actual>=t.level?' · 달성':` · ${t.level-t.actual} 부족`}</strong></div><label class="target-edit">목표 레벨 <input type="number" min="1" max="10" value="${t.level}" data-target-level="${i}" aria-label="${escape(a.name)} ${t.scope==='fleet'?'선단 전체':`선박 ${t.scope+1}`} 목표 레벨"></label><div class="progress"><i style="width:${Math.min(100,t.actual/t.level*100)}%"></i></div></div>`;
  });
  const groups=[{name:'선단 효과',test:t=>t.scope==='fleet'},...Array.from({length:state.shipCount},(_,s)=>[{name:`선박 ${s+1} · 전투 효과`,test:t=>t.scope===s&&data.abilityById.get(t.ability).kind==='effect'},{name:`선박 ${s+1} · 해전 기술`,test:t=>t.scope===s&&data.abilityById.get(t.ability).kind==='skill'}]).flat()];
  $('#targets').innerHTML=groups.map(g=>{const content=summary.targets.map((t,i)=>g.test(t)?rows[i]:'').join('');return content?`<section class="target-group"><h3>${g.name}</h3>${content}</section>`:'';}).join('')||'<div class="empty-targets">등록된 목표가 없습니다.</div>';
  $('#solve').disabled=!state.targets.length||!!worker||(state.ownedOnly&&!state.owned.length);
  $('#solve-readiness').textContent=!state.targets.length?'선단 효과·선박 효과·해전 기술 중 목표를 추가하세요.':state.ownedOnly&&!state.owned.length?'보유 항해사를 등록하거나 보유 제한을 해제하세요.':`${state.targets.length}개 목표 · 필수 ${state.required.length}명`;
}
function render(){
  const summary=summarize(state,data);
  $('#undo').disabled=!history.length||!!worker;
  $('#candidate-summary').textContent=state.ownedOnly?`보유 ${state.owned.length}명 중에서 조합합니다.`:`미보유를 포함한 전체 ${data.mates.length}명 중에서 조합합니다.`;
  $('#owned-count').textContent=`${state.owned.length}명`;
  $('#required-list').innerHTML=`<div class="panel-title"><h3>필수 항해사 <span class="count">${state.required.length}명</span></h3><button id="pick-required" class="text-button">선택·변경</button></div>${state.required.map(id=>`<button class="required-chip" data-unrequire="${id}" aria-label="${escape(data.mateById.get(id).name)} 필수 해제">${escape(data.mateById.get(id).name)} ×</button>`).join('')||'<p class="small hint">지정된 항해사가 없습니다.</p>'}`;
  $('#placed-count').textContent=summary.placed;$('#achieved-count').textContent=`${summary.achieved} / ${state.targets.length}`;
  $('#ship-count').value=state.shipCount;$('#owned-only').checked=state.ownedOnly;
  $('#stat-priority-help').textContent=state.statPriority?`목표를 우선 만족시키고, 탐색한 후보 중 ${state.statPriority} 선단 합계가 높은 조합을 추천합니다. 합계를 높이기 위해 빈 선실도 채울 수 있습니다.`:'목표를 만족하는 데 필요한 항해사 수를 줄입니다.';
  $('#stat-priority').value=state.statPriority;$('#budget').value=state.budget;
  $('#selected-name').textContent='빈 선실을 눌러 항해사를 배치하세요';
  renderRoster();renderShips(summary);renderTargets(summary);if(!$('#collection').hidden)renderCollection();
}
function filterAbilities(){
  const query=$('#ability-search').value.trim().toLowerCase();
  const old=$('#ability-select').value;
  const list=data.abilities.filter(a=>a.known&&a.scope&&(goalMode==='fleet'?a.kind==='effect'&&a.scope==='fleet':goalMode==='ship'?a.kind==='effect'&&a.scope==='ship':a.kind==='skill'&&a.scope==='ship')&&(a.name+' '+a.category).toLowerCase().includes(query)).sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  $('#ability-select').innerHTML=list.map(a=>`<option value="${a.id}">${escape(a.name)} · ${a.kind==='skill'?'기술':a.category}</option>`).join('');
  if(list.some(a=>a.id===old))$('#ability-select').value=old;
  else if(list.length)$('#ability-select').selectedIndex=0;
  $('#ability-empty').hidden=!!list.length;$('#target-form button[type="submit"]').disabled=!list.length;
}
function updateScope(){
  const previous=$('#target-scope').value;
  $('#target-scope').innerHTML=goalMode==='fleet'?'<option value="fleet">선단 전체</option>':Array.from({length:state.shipCount},(_,s)=>`<option value="${s}">선박 ${s+1}</option>`).join('');
  if(goalMode!=='fleet'&&Number(previous)<state.shipCount&&previous!=='fleet')$('#target-scope').value=previous;
  if(!$('#target-scope').value)$('#target-scope').selectedIndex=0;
  $('#target-scope-label').hidden=goalMode==='fleet';
  $('#goal-context').textContent=goalMode==='fleet'?'선단 전체에 적용되는 모험·교역 효과':goalMode==='ship'?'선택한 선박에 적용되는 전투 효과':'선택한 선박에서 사용하는 해전 기술';
  $('#ability-search-label').textContent=goalMode==='fleet'?'모험·교역 효과 검색':goalMode==='ship'?'전투 효과 검색':'해전 기술 검색';
  $('#ability-search').placeholder=goalMode==='skill'?'기술 이름 검색':'효과 이름 검색';
}
function showDialog(html){$('#detail-content').innerHTML=html;if(!$('#detail').open)$('#detail').showModal();}
function showMate(id){
  const m=data.mateById.get(id);if(!m)return;detailMate=id;const cfg=configuration(m,state),choices=candidates(m);
  showDialog(`<div class="eyebrow">NAVIGATOR</div><h2>${escape(m.name)}</h2><p class="small">${grade(m.grade)} · ${escape(m.type)} · ${escape(m.job)}</p>
    <div class="dialog-tools"><span>${state.owned.includes(id)?'보유':'미보유'}${state.required.includes(id)?' · 필수 포함':''}</span><label><input type="checkbox" id="mate-transcended" ${cfg.transcended?'checked':''}> 3차 초월 완료</label></div>
    <h3>스탯</h3>${statsHtml(m.stats)}<p class="small">원본 수치 기준 · 성장·장비 보정 미적용</p>
    <h3>장착 효과 <span id="effect-count">${cfg.effects.length}</span> / ${slotLimit(m)}</h3><p class="small">습득 레벨은 계산하지 않아요. 추천 효과에 맞춰 육성해 주세요.</p>
    <div>${choices.map(g=>{const a=data.abilityById.get(g.ability);return `<label class="effect-item"><input type="checkbox" data-equip="${g.ability}" ${cfg.effects.includes(g.ability)?'checked':''}><span>${escape(a?.name)} <b>Lv.${g.level}</b></span><small>${labels[g.origin]||''}</small></label>`;}).join('')}</div>
    <h3>고정 3차 초월 효과</h3>${m.grants.filter(g=>g.origin==='transcendence_3').map(g=>`<p>${escape(data.abilityById.get(g.ability)?.name)} Lv.${g.level}</p>`).join('')||'<p class="small">등록된 효과가 없어요.</p>'}
    <h3>해전 기술</h3>${m.grants.filter(g=>g.kind==='skill').map(g=>`<p class="small">${escape(data.abilityById.get(g.ability)?.name)} · Lv.${g.level}</p>`).join('')}
    ${state.ships.flat().includes(id)?'<button id="remove-mate" class="danger" style="margin-top:20px">승선 해제</button>':''}`);
}
function configureMate(){const mate=data.mateById.get(detailMate);if(!state.configs[detailMate])state.configs[detailMate]=configuration(mate,state);return state.configs[detailMate];}
function busy(value){document.body.classList.toggle('busy',value);$('#stop').hidden=!value;$('#solve').hidden=value;
  for(const id of ['export','import','about','stats-open','budget','clear','ship-count','owned-only','stat-priority','manage-owned','undo'])$('#'+id).disabled=value;
}
function resultText(r,stopped=false){
  const summary=summarize(r.state,data);
  return `${stopped?'탐색 중지':'탐색 완료'} · ${summary.achieved}/${state.targets.length}개 목표 달성. 아래에서 현재 배치와 비교한 뒤 적용하세요. 제한 시간 안에 찾은 결과이며 최적해를 보장하지 않습니다.`;
}
function finish(result,stopped=false){if(worker)worker.terminate();worker=null;busy(false);$('#undo').disabled=!history.length;
  if(result){proposed=result;renderPreview(result);$('#solve-status').textContent=resultText(result,stopped);$('#apply-result').hidden=false;$('#dismiss-result').hidden=false;}
  else $('#solve-status').textContent='탐색을 중지했어요. 현재 배치를 유지해요.';
}
async function init(){
  try{
    const response=await fetch('./catalog.json');if(!response.ok)throw Error('항해사 데이터를 불러오지 못했어요. 새로고침해 주세요.');
    catalog=await response.json();data=indexCatalog(catalog);
    try{const saved=localStorage.getItem(KEY);if(saved)state=migrateLegacyLocks(validateState(JSON.parse(saved),data));}catch{notice('저장된 배치를 읽지 못해 새 배치로 시작했어요.');}
    lastSaved=structuredClone(state);
    data.mates.sort((a,b)=>['S+','S','A','B','C'].indexOf(a.grade)-['S+','S','A','B','C'].indexOf(b.grade)||a.name.localeCompare(b.name,'ko'));
    for(const name of Object.keys(data.mates[0].stats))$('#stat-priority').insertAdjacentHTML('beforeend',`<option>${escape(name)}</option>`);
    $('#loading').hidden=true;$('#workspace').hidden=false;updateScope();filterAbilities();render();renderPage();
  }catch(error){$('#loading').textContent=error.message;return;}
  for(const id of ['search','type-filter','grade-filter'])$('#'+id).addEventListener('input',renderRoster);
  window.addEventListener('hashchange',()=>{if($('#roster-dialog').open)$('#roster-dialog').close();renderPage();});
  $('#undo').onclick=()=>{if(worker||!history.length)return;state=history.pop();lastSaved=structuredClone(state);clearProposal();updateScope();save();render();notice('직전 변경을 되돌렸습니다.');};
  $('#picker-close').onclick=()=>$('#roster-dialog').close();
  $('#roster-dialog').addEventListener('close',()=>{pendingSlot=null;});
  $('#collection-sort').oninput=renderCollection;
  $('#collection-reset').onclick=()=>{for(const id of ['collection-search','collection-type','collection-grade'])$('#'+id).value='';collectionFilter='all';renderCollection();};
  const openCollection=()=>{location.hash='collection';};
  $('#manage-owned').onclick=openCollection;
  $('#collection-close').onclick=()=>{location.hash='planner';};
  $('#collection-rows').onclick=e=>{if(worker)return;const required=e.target.closest('[data-card-required]');if(required){toggleRequired(required.dataset.cardRequired);return;}const b=e.target.closest('[data-collection-detail]');if(b&&!worker)showMate(b.dataset.collectionDetail);};
  for(const id of ['collection-search','collection-type','collection-grade'])$('#'+id).oninput=renderCollection;
  document.querySelectorAll('[data-collection-filter]').forEach(b=>b.onclick=()=>{collectionFilter=b.dataset.collectionFilter;renderCollection();});
  $('#collection-rows').onchange=e=>{if(worker){renderCollection();return;}if(e.target.matches('[data-own]')){setOwned(e.target.dataset.own,e.target.checked);commit();renderCollection();}};
  $('#collection-add').onclick=()=>{if(worker)return;for(const m of collectionMates())setOwned(m.id,true);commit();renderCollection();};
  $('#collection-remove').onclick=()=>{if(worker)return;const list=collectionMates();if(list.length&&confirm(`검색 결과 ${list.length}명의 보유·필수·잠금을 해제할까요?`)){for(const m of list)setOwned(m.id,false);commit();renderCollection();}};
  $('#required-list').onclick=e=>{if(worker)return;const b=e.target.closest('[data-unrequire]');if(b)toggleRequired(b.dataset.unrequire);else if(e.target.id==='pick-required'){renderRequired();$('#required-dialog').showModal();}};
  $('#required-close').onclick=()=>$('#required-dialog').close();$('#required-search').oninput=renderRequired;
  $('#required-rows').onchange=e=>{if(e.target.matches('[data-required-check]')){toggleRequired(e.target.dataset.requiredCheck);renderRequired();}};
  $('#required-selected').onclick=e=>{const b=e.target.closest('[data-required-remove]');if(b){toggleRequired(b.dataset.requiredRemove);renderRequired();}};
  $('#required-open-owned').onclick=()=>{$('#required-dialog').close();openCollection();};
  document.querySelectorAll('[data-goal-mode]').forEach(b=>b.onclick=()=>{if(worker)return;goalMode=b.dataset.goalMode;document.querySelectorAll('[data-goal-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));$('#ability-search').value='';updateScope();filterAbilities();});
  $('#ability-search').addEventListener('input',filterAbilities);
  $('#ability-select').addEventListener('dblclick',e=>{
    if(worker||!e.target.closest('option'))return;
    $('#target-form').requestSubmit();
  });
  $('#owned-only').onchange=e=>{state.ownedOnly=e.target.checked;commit();};
  $('#stat-priority').onchange=e=>{state.statPriority=e.target.value;commit();};
  $('#budget').onchange=e=>{state.budget=Number(e.target.value);commit();};
  $('#roster').onclick=e=>{if(worker)return;const required=e.target.closest('[data-card-required]');if(required){toggleRequired(required.dataset.cardRequired);return;}const detail=e.target.closest('[data-detail]');if(detail){showMate(detail.dataset.detail);return;}
    const button=e.target.closest('[data-select]');if(button&&pendingSlot){
      const id=button.dataset.select,[s,c]=pendingSlot;
      const previous=state.ships.flat().indexOf(id);if(previous>=0)state.ships[Math.floor(previous/11)][previous%11]=null;
      state.ships[s][c]=id;$('#roster-dialog').close();notice('');commit();
    }};
  $('#ships').onclick=e=>{if(worker)return;const remove=e.target.closest('[data-remove-cabin]');if(remove){removeFromFleet(remove.dataset.removeCabin);return;}
    const slot=e.target.closest('[data-slot]');if(!slot)return;const [s,c]=slot.dataset.slot.split(',').map(Number);const occupant=state.ships[s][c];
    if(occupant)showMate(occupant);else openPicker(s,c);
  };
  $('#ship-count').onchange=e=>{const count=Number(e.target.value);
    if(count<state.shipCount&&state.ships.slice(count).flat().some(Boolean)&&!confirm('줄어드는 선박의 배치를 해제할까요?')){e.target.value=state.shipCount;return;}
    state.shipCount=count;for(let i=count;i<7;i++)state.ships[i]=Array(11).fill(null);
    state.locked=state.locked.filter(id=>state.ships.flat().includes(id));state.targets=state.targets.filter(t=>t.scope==='fleet'||t.scope<count);updateScope();commit();};
  $('#clear').onclick=()=>{if(confirm('선박 배치를 모두 비울까요? 목표·보유·필수 지정은 유지됩니다.')){state.ships=EMPTY();state.locked=[];commit();}};
  $('#target-form').onsubmit=e=>{e.preventDefault();if(worker)return;const a=data.abilityById.get($('#ability-select').value);if(!a)return;
    const level=Number($('#target-level').value);if(!Number.isInteger(level)||level<1||level>10)return;
    const scope=a.scope==='fleet'?'fleet':Number($('#target-scope').value);const old=state.targets.find(t=>t.ability===a.id&&t.scope===scope);
    if(old)old.level=level;else if(state.targets.length<40)state.targets.push({ability:a.id,scope,level});else{notice('목표는 최대 40개까지 추가할 수 있어요.');return;}commit();$('#target-added').textContent=`${a.name} · ${scope==='fleet'?'선단 전체':`선박 ${scope+1}`} Lv.${level} ${old?'수정':'추가'}`;$('#ability-search').value='';filterAbilities();$('#ability-search').focus();};
  $('#targets').onchange=e=>{if(worker)return;const input=e.target.closest('[data-target-level]');if(!input)return;const level=Number(input.value);if(!Number.isInteger(level)||level<1||level>10){input.value=state.targets[Number(input.dataset.targetLevel)].level;return;}state.targets[Number(input.dataset.targetLevel)].level=level;commit();};
  $('#targets').onclick=e=>{if(worker)return;const b=e.target.closest('[data-delete-target]');if(b){state.targets.splice(Number(b.dataset.deleteTarget),1);commit();}};
  $('#detail-close').onclick=()=>$('#detail').close();
  $('#detail-content').onchange=e=>{if(!detailMate)return;
    if(e.target.id==='mate-transcended'){configureMate().transcended=e.target.checked;commit();}
    if(e.target.matches('[data-equip]')){const cfg=configureMate(),id=e.target.dataset.equip;const m=data.mateById.get(detailMate);
      if(e.target.checked&&cfg.effects.length>=slotLimit(m)){e.target.checked=false;notice(`장착 효과는 최대 ${slotLimit(m)}개예요. 다른 효과를 해제해 주세요.`);return;}
      cfg.effects=e.target.checked?[...cfg.effects,id]:cfg.effects.filter(x=>x!==id);$('#effect-count').textContent=cfg.effects.length;commit();}
  };
  $('#detail-content').onclick=e=>{if(e.target.id==='remove-mate'){
    $('#detail').close();removeFromFleet(detailMate);}};
  $('#stats-open').onclick=()=>{detailMate=null;const summary=summarize(state,data);showDialog(`<h2>선단 스탯</h2><p class="small">승선한 항해사의 원본 스탯 단순 합계예요. 선박 보정·장비·태생·직업 직접 효과는 포함하지 않아요.</p><h3>전체</h3>${statsHtml(summary.stats)}${summary.shipStats.slice(0,state.shipCount).map((stats,i)=>`<h3>선박 ${i+1}</h3>${statsHtml(stats)}`).join('')}`);};
  $('#about').onclick=()=>{detailMate=null;showDialog(`<h2>계산 기준</h2><p>일반 항해사는 효과 5개, 제독은 6개를 선택해요. 10·30·50·70레벨 효과를 모두 장착 후보로 보고 습득 레벨을 제한하지 않아요. 3차 초월 완료를 체크하면 별도 고정 효과를 더해요.</p><h3>자동 맞춤</h3><p>목표 효과의 부족분을 우선 줄이고, 그다음 선택한 스탯 또는 적은 배치 인원을 고려해요. 필수 항해사를 포함하며 자리와 장착 효과는 목표에 맞춰 정해요. 시간이 끝나면 찾은 결과를 검토하고 적용할 수 있어요. 전역 최적해나 목표 달성 불가능을 증명하는 계산은 아니에요.</p><h3>데이터 범위</h3><p>9월 2일 스냅샷에 멜라티·제임스 랭커스터를 추가한 642명 기준입니다. 정의가 없거나 적용 범위가 불확실한 효과는 목표 목록에서 제외했어요. 해전 기술 합산은 참고 사이트 규칙을 따르며, 일부 수치표는 비어 있어요. 태생·직업의 직접 수치 효과는 이번 레벨 목표 계산에 포함하지 않아요.</p><h3>저장</h3><p>보유 항해사와 배치는 이 브라우저에 저장돼요. 기기 간 자동 동기화는 없으니 파일 내보내기로 백업해 주세요.</p>`);};
  $('#solve').onclick=()=>{
    if(!state.targets.length)return;if(state.ownedOnly&&!state.owned.length&&!state.locked.length){notice('보유 항해사를 선택하거나 보유 필터를 꺼 주세요.');return;}
    clearProposal();notice('');busy(true);
    $('#solve-status').textContent='목표와 장착 칸 수에 맞는 조합을 찾고 있어요…';
    try{worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
      worker.onmessage=({data:r})=>{if(r.type==='error'){finish(null);notice(`계산을 완료하지 못했어요: ${r.message}`);return;}
        proposed=r;if(r.type==='done')finish(r);else $('#solve-status').textContent=`${(r.elapsed/1000).toFixed(1)}초 · ${r.achieved}/${state.targets.length}개 목표 달성 · ${r.iterations}개 조합 탐색`;};
      worker.onerror=()=>{finish(null);notice('자동 계산을 시작하지 못했어요. 새로고침 후 다시 시도해 주세요.');};
      worker.postMessage({state:structuredClone(state),catalog});
    }catch(error){finish(null);notice(error.message);}
  };
  $('#stop').onclick=()=>finish(proposed,true);
  $('#apply-result').onclick=()=>{if(proposed){state=migrateLegacyLocks(validateState(proposed.state,data));commit();$('#solve-status').textContent='추천 배치를 적용했어요. 승선 항해사를 누르면 장착 효과를 확인할 수 있어요.';}};
  $('#dismiss-result').onclick=()=>{clearProposal();$('#solve-status').textContent='현재 배치를 유지했어요.';};
  $('#export').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='hangro-fleet.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('#import').onclick=()=>$('#file').click();
  $('#file').onchange=async e=>{const file=e.target.files[0];if(!file)return;
    try{if(file.size>2_000_000)throw Error('배치 파일이 너무 커요.');const imported=migrateLegacyLocks(validateState(JSON.parse(await file.text()),data));
      if(confirm('현재 배치를 파일의 내용으로 바꿀까요?')){state=imported;updateScope();commit();notice('배치 파일을 불러왔어요.');}
    }catch(error){notice(`불러오기 실패: ${error.message}`);}finally{e.target.value='';}};
}
// Only dismiss when the press and release are both on the backdrop.
document.querySelectorAll('dialog').forEach(dialog=>{
  let pressedOutside=false;
  const outside=e=>{
    const rect=dialog.getBoundingClientRect();
    return e.target===dialog&&(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom);
  };
  dialog.addEventListener('pointerdown',e=>{pressedOutside=e.button===0&&outside(e);});
  dialog.addEventListener('click',e=>{
    if(pressedOutside&&outside(e))dialog.close();
    pressedOutside=false;
  });
  dialog.addEventListener('pointercancel',()=>{pressedOutside=false;});
  dialog.addEventListener('close',()=>{pressedOutside=false;});
});
init();
