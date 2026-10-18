import { discoverSeasons, isSeasonSubject, organizeEntries, sortByAdded } from './series.mjs?v=sort-direction-2';
import { normalizeLibrary as normalize, safeCover } from './library.mjs';
import { GitHubSync } from './sync.mjs?v=github-sync-2';
const $ = s => document.querySelector(s);
const seasons = {winter:'冬',spring:'春',summer:'夏',autumn:'秋'};
const KEY = 'anime-shelf-v1';
let library = [], editing = null, searchController, pendingAdditions = [];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message) { $('#toast').textContent=message; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4000); }
let syncManager;
function save(next) {
  try { syncManager.setLibrary(next); return true; }
  catch(error) { toast(error.message); return false; }
}
function requireAdmin(){if(syncManager?.canEdit)return true;toast('请先使用 GitHub 管理员账号登录');return false;}
function render() {
  const previous = $('#year').value;
  $('#year').innerHTML='<option value="">所有年份</option>'+[...new Set(library.map(x=>x.year).filter(Boolean))].sort((a,b)=>b-a).map(y=>`<option>${y}</option>`).join('');
  $('#year').value=previous;
  $('#stats').innerHTML=`<div><b>${library.length.toString().padStart(2,'0')}</b><span>部作品</span></div><div><b>${new Set(library.map(x=>x.year).filter(Boolean)).size.toString().padStart(2,'0')}</b><span>个放送年份</span></div>`;
  const query=$('#filter').value.trim().toLowerCase();
  const list=library.filter(x=>(!$('#year').value||String(x.year)===$('#year').value)&&(!$('#season').value||x.season===$('#season').value)&&[x.title,x.original,x.studio,x.sourceTitle].join(' ').toLowerCase().includes(query));
  const direction=$('#direction').value;
  if($('#sort').value==='added')sortByAdded(list,direction);
  else list.sort((a,b)=>{
    const comparison=$('#sort').value==='title'?a.title.localeCompare(b.title,'zh-CN'):String(a.date||a.year).localeCompare(String(b.date||b.year));
    return direction==='asc'?comparison:-comparison;
  });
  $('#count').textContent=list.length;
  $('#grid').innerHTML=list.length?list.map(x=>`<article class="card"><button class="cover-button" data-edit="${x.id}" aria-label="${syncManager?.canEdit?'编辑':'查看'} ${escape(x.title)}"><img class="poster" src="${escape(x.cover)}" alt="${escape(x.title)}封面" loading="lazy" referrerpolicy="no-referrer"></button><h3 title="${escape(x.title)}">${escape(x.title)}</h3><p class="original">${escape(x.original)}</p><div class="meta"><span>${escape(x.studio||'制作公司待补充')}</span><span>${x.year||'未知'}${seasons[x.season]?' · '+seasons[x.season]:''}</span></div></article>`).join(''):'<div class="empty">书架在等下一个故事。<br><br>添加一部作品，或调整筛选条件。</div>';
  $('#grid').querySelectorAll('img').forEach(img=>img.onerror=()=>{img.removeAttribute('src');img.onerror=null;});
}
async function request(path, options={}) {
  const response=await fetch('https://api.bgm.tv'+path,{...options,signal:options.signal||AbortSignal.timeout(18000)});
  if (!response.ok) throw new Error(response.status===429?'请求过于频繁，请稍后再试':`Bangumi 暂时无法响应（${response.status}）`);
  return response.json();
}
function edit(item, existing=false, additions=[]) {
  pendingAdditions=additions;
  editing={...item};
  const form=$('#editForm');
  for(const key of ['title','original','studio','year','season','note']) form.elements[key].value=item[key]??'';
  $('#editCover').src=safeCover(item.cover); $('#editCover').referrerPolicy='no-referrer';
  $('#source').href=`https://bgm.tv/subject/${item.id}`;
  const editable=!!syncManager?.canEdit;
  for(const field of form.elements)if(field.name)field.disabled=!editable;
  $('#saveEntry').hidden=!editable;
  $('#delete').hidden=!existing||!editable;
  $('#editTitle').textContent=!editable?'作品资料':existing?'编辑作品':'确认作品资料';
  $('#seriesSummary').hidden=!additions.length;
  $('#seriesSummary').textContent=additions.length?`保存后将整理 ${additions.length} 个条目（新增 ${additions.filter(x=>!library.some(y=>y.id===x.id)).length} 个）：${additions.map(x=>x.title).join('、')}`:'';
  $('#editDialog').showModal();
}
$('#add').onclick=()=>{if(!requireAdmin())return;$('#searchDialog').showModal();$('#query').focus();};
document.querySelectorAll('.close').forEach(button=>button.onclick=()=>button.closest('dialog').close());
$('#searchDialog').addEventListener('close',()=>searchController?.abort());
for(const selector of ['#filter','#year','#season','#sort','#direction']) $(selector).addEventListener(selector==='#filter'?'input':'change',render);
$('#grid').onclick=e=>{const button=e.target.closest('[data-edit]');if(button)edit(library.find(x=>x.id===Number(button.dataset.edit)),true);};
$('#searchForm').onsubmit=async e=>{
  e.preventDefault(); if(!requireAdmin())return; const query=$('#query').value.trim(); if(!query)return;
  searchController?.abort(); searchController=new AbortController();
  const controller=searchController;
  $('#results').innerHTML='<p class="empty">正在搜索 Bangumi…</p>';
  try {
    const result=await request('/v0/search/subjects?limit=20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keyword:query,sort:'match',filter:{type:[2],nsfw:false}}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(18000)])});
    if(controller!==searchController)return;
    const entries=result.data||[];
    $('#results').innerHTML=entries.length?entries.map(x=>`<article class="result"><img src="${escape(safeCover(x.images?.medium||x.images?.large))}" alt="" referrerpolicy="no-referrer"><div><h3>${escape(x.name_cn||x.name)}</h3><p>${escape(x.name)}</p><p>${escape(x.date||'放送日期未知')}</p></div><button data-subject="${Number(x.id)}">${library.some(item=>item.id===x.id)?'补齐季度':'＋ 收藏'}</button></article>`).join(''):'<p class="empty">没有找到作品，试试原名或其他关键词。</p>';
  }catch(error){if(error.name!=='AbortError')$('#results').innerHTML=`<p class="empty">${escape(error.name==='TimeoutError'?'搜索超时，请重试':error.message)}<br><br>请检查网络后重新搜索。</p>`;}
};
$('#results').onclick=async e=>{
  const button=e.target.closest('[data-subject]');if(!button||!requireAdmin())return;
  const buttons=[...$('#results').querySelectorAll('button'),$('#searchForm button')];
  buttons.forEach(x=>x.disabled=true);button.textContent='检查季度…';
  searchController?.abort();searchController=new AbortController();
  const signal=searchController.signal;
  const load=path=>request(path,{signal:AbortSignal.any([signal,AbortSignal.timeout(18000)])});
  try {
    const x=await load('/v0/subjects/'+button.dataset.subject);
    if(x.type!==2)throw new Error('请选择动画作品');
    const graph=$('#allSeasons').checked?await discoverSeasons(x,load):{subjects:[x],links:[]};
    const selected=graph.subjects.filter(subject=>subject.id===x.id||isSeasonSubject(subject)||library.some(item=>item.id===subject.id));
    const flatten=value=>typeof value==='string'?value:Array.isArray(value)?value.map(v=>typeof v==='string'?v:v.v||'').filter(Boolean).join(' / '):'';
    const records=[];
    for(const subject of selected){
      const prior=library.find(item=>item.id===subject.id);
      if(prior){records.push({...prior,addedAt:new Date().toISOString()});continue;}
      const info=(subject.infobox||[]).filter(field=>field.key==='动画制作');
      let studio=info.map(field=>flatten(field.value)).filter(Boolean).join(' / ');
      if(!studio){const people=await load(`/v0/subjects/${subject.id}/persons`);studio=[...new Set(people.filter(person=>person.relation==='动画制作').map(person=>person.name))].join(' / ');}
      const month=Number((subject.date||'').slice(5,7));
      records.push({id:subject.id,title:subject.name_cn||subject.name,original:subject.name,cover:safeCover(subject.images?.large||subject.images?.common),studio,year:Number((subject.date||'').slice(0,4))||'',season:month?['winter','spring','summer','autumn'][Math.floor((month-1)/3)]:'',date:subject.date||'',note:'',addedAt:new Date().toISOString()});
    }
    const additions=organizeEntries(records,graph.subjects,graph.links);
    if(signal.aborted)return;
    $('#searchDialog').close();edit(additions.find(item=>item.id===x.id),false,additions);
  }catch(error){if(error.name!=='AbortError')toast(error.message||'读取失败，请重试');}
  finally{buttons.forEach(x=>x.disabled=false);button.textContent='＋ 收藏';}
};
$('#editForm').onsubmit=e=>{e.preventDefault();if(!requireAdmin())return;const values=Object.fromEntries(new FormData(e.target));const item=normalize([{...editing,...values}])[0];const changes=normalize(pendingAdditions.length?pendingAdditions.map(x=>x.id===item.id?item:x):[item]);const ids=new Set(changes.map(x=>x.id));const next=[...library.filter(x=>!ids.has(x.id)),...changes];if(save(next)){$('#editDialog').close();toast(`已保存 ${changes.length} 个条目，正在同步 GitHub`);}};
$('#delete').onclick=()=>{if(!requireAdmin())return;if(confirm('确定从书架移除这部作品？')){if(save(library.filter(x=>x.id!==editing.id))){$('#editDialog').close();toast('已移除作品，正在同步 GitHub');}}};
$('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(library,null,2)+'\n'],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='library.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('清单已导出，可替换仓库中的 data/library.json');};
$('#import').onclick=()=>{if(requireAdmin())$('#file').click();};
$('#file').onchange=async e=>{if(!requireAdmin())return;const file=e.target.files[0];if(!file)return;try{if(file.size>10000000)throw new Error('文件不能超过 10 MB');const entries=normalize(JSON.parse(await file.text()));if(confirm(`将用文件中的 ${entries.length} 部作品替换当前清单。是否继续？`)&&save(entries))toast('已导入清单，正在同步 GitHub');}catch(error){toast('导入失败：'+error.message);}finally{e.target.value='';}};
const storage={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)};
const tabStorage={getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)};
let conflictShown=null;
function paintSync(state){
  $('#login').textContent=state.user?'退出管理员':'管理员登录';
  $('#login').disabled=state.phase==='saving';
  $('#add').hidden=!state.canEdit;$('#import').hidden=!state.canEdit;
  $('#syncStatus').textContent=state.message;
  $('#retrySync').hidden=state.phase!=='error'||!state.user;
  $('#restoreBackup').hidden=!state.canEdit||!(state.hasBackup||hasLegacy());
  $('#commitLink').hidden=!/^https:\/\/github\.com\/doublename02\/AnimeList\/commit\/[a-f0-9]+$/.test(state.lastCommitUrl);
  if(!$('#commitLink').hidden)$('#commitLink').href=state.lastCommitUrl;
  $('.storage').textContent=state.user?'修改自动提交到 GitHub；网络中断时保留本地草稿，公开网页在部署完成后更新。':'访客只读 · 清单从公开网页读取；只有网站所有者登录后才能修改并同步。';
  if(state.conflict&&state.conflict!==conflictShown){
    conflictShown=state.conflict;
    $('#conflictInfo').textContent=state.conflict.conflicts.length?`发现 ${state.conflict.conflicts.length} 部作品存在冲突。未冲突的修改会自动合并，请逐项选择保留的版本。`:'云端有其他修改，本地变更与其不冲突。确认后会合并双方修改再保存。';
    $('#conflictChoices').innerHTML=state.conflict.conflicts.map(item=>`<label>${escape(item.title)}<span class="muted">${item.wholeEntry?'新增或删除与另一版本冲突':'冲突字段：'+item.fields.join('、')}</span><select data-conflict="${item.id}"><option value="remote">保留云端版本</option><option value="local">保留本地版本</option></select></label>`).join('');
    $('#conflictDialog').showModal();
  }
  render();
}
function hasLegacy(){try{return storage.getItem(KEY)!==null;}catch{return false;}}
$('#login').onclick=async()=>{
  try{
    if(syncManager.user){if(syncManager.dirty&&!confirm('还有未同步的修改，退出后会保留本地草稿。确定退出？'))return;await syncManager.logout();}
    else await syncManager.login();
  }catch(error){toast(error.message);if(error.status)syncManager.handleError(error);}
};
$('#retrySync').onclick=async()=>{try{if(!syncManager.sha)await syncManager.start(syncManager.publicLoader);else await syncManager.flush();}catch(error){toast(error.message);}};
$('#refreshCloud').onclick=async()=>{try{await syncManager.refresh();toast('已检查最新清单');}catch(error){toast(error.message);}};
$('#restoreBackup').onclick=()=>{
  if(!requireAdmin())return;
  try{
    const backup=syncManager.pending?.library||JSON.parse(storage.getItem(KEY)||'null');
    if(!backup)throw new Error('未找到可恢复的本地备份');
    const entries=normalize(backup);
    if(confirm(`恢复本地备份的 ${entries.length} 个条目，并自动提交到 GitHub？建议先导出当前清单。`))save(entries);
  }catch(error){toast(error.message);}
};
$('#mergeForm').onsubmit=e=>{
  e.preventDefault();try{const choices={};$('#conflictChoices').querySelectorAll('select').forEach(select=>choices[select.dataset.conflict]=select.value);syncManager.applyConflict(choices);$('#conflictDialog').close();conflictShown=null;}catch(error){toast(error.message);}
};
$('#useRemote').onclick=()=>{
  if(!confirm('使用云端清单并放弃本次本地变更？可先点击“导出本地草稿”备份。'))return;
  try{const conflicts=syncManager.conflict;syncManager.acceptRemote(conflicts.remote);syncManager.persist();syncManager.phase='synced';syncManager.message='已采用云端清单';syncManager.emit();$('#conflictDialog').close();conflictShown=null;}catch(error){toast(error.message);}
};
$('#exportConflict').onclick=()=>$('#export').click();
$('#conflictDialog').addEventListener('cancel',e=>e.preventDefault());
window.addEventListener('online',()=>syncManager?.flush());
window.addEventListener('beforeunload',e=>{if(syncManager?.dirty){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&syncManager&&!syncManager.dirty&&!document.querySelector('dialog[open]'))syncManager.refresh().catch(()=>{});});
try {
  let config={apiBase:''};
  const configResponse=await fetch('./sync-config.json',{cache:'no-store'});
  if(configResponse.ok)config=await configResponse.json();
  if(config.apiBase){const url=new URL(config.apiBase);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('同步接口地址无效');}
  syncManager=new GitHubSync({apiBase:config.apiBase||'',storage,sessionStorage:tabStorage,onLibrary:items=>{library=items;render();},onState:paintSync});
  let callbackError;
  try{syncManager.callback(location,history);}catch(error){callbackError=error;}
  await syncManager.start(async()=>{const response=await fetch('./data/library.json',{cache:'no-store'});if(!response.ok)throw new Error('无法读取公开清单');return response.json();});
  if(callbackError)toast(callbackError.message);
}catch(error){$('#syncStatus').textContent='清单加载失败，请检查网络后刷新';toast(error.message);}
