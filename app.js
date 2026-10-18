import { discoverSeasons, isSeasonSubject, organizeEntries, sortByAdded } from './series.mjs';
const $ = s => document.querySelector(s);
const seasons = {winter:'冬',spring:'春',summer:'夏',autumn:'秋'};
const KEY = 'anime-shelf-v1';
let library = [], editing = null, searchController, pendingAdditions = [];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeCover(value) {
  if (typeof value !== 'string') return '';
  if (/^https:\/\//i.test(value)) return value;
  if (/^AnimeList\/Covers\/[\w\-\u0080-\uffff/.]+$/.test(value) && !value.includes('..')) return value;
  return '';
}
function normalize(items) {
  if (!Array.isArray(items) || items.length > 10000) throw new Error('清单应为作品数组，最多 10000 条');
  const ids = new Set();
  return items.map(x => {
    if (!x || !Number.isSafeInteger(Number(x.id)) || Number(x.id) <= 0 || typeof x.title !== 'string' || !x.title.trim() || ids.has(Number(x.id))) throw new Error('作品 ID、名称无效，或存在重复作品');
    ids.add(Number(x.id));
    const group=Number.isSafeInteger(Number(x.seriesId))&&Number(x.seriesId)>0?{seriesId:Number(x.seriesId),seriesTitle:String(x.seriesTitle||'').slice(0,200),seriesOrder:Math.max(1,Math.min(10000,Number(x.seriesOrder)||1)),sourceTitle:String(x.sourceTitle||x.title).slice(0,200)}:{};
    return {id:Number(x.id),title:x.title.slice(0,200),original:String(x.original || '').slice(0,200),cover:safeCover(x.cover),studio:String(x.studio || '').slice(0,200),year:Number(x.year)>=1900 && Number(x.year)<=2200 ? Number(x.year) : '',season:seasons[x.season]?x.season:'',date:String(x.date || ''),note:String(x.note || '').slice(0,2000),addedAt:Number.isFinite(Date.parse(x.addedAt))?x.addedAt:new Date().toISOString(),...group};
  });
}
function toast(message) { $('#toast').textContent=message; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4000); }
function save(next) {
  try { localStorage.setItem(KEY,JSON.stringify(next)); library=next; render(); return true; }
  catch { toast('浏览器无法保存，请先导出清单备份后重试'); return false; }
}
function render() {
  const previous = $('#year').value;
  $('#year').innerHTML='<option value="">所有年份</option>'+[...new Set(library.map(x=>x.year).filter(Boolean))].sort((a,b)=>b-a).map(y=>`<option>${y}</option>`).join('');
  $('#year').value=previous;
  $('#stats').innerHTML=`<div><b>${library.length.toString().padStart(2,'0')}</b><span>部作品</span></div><div><b>${new Set(library.map(x=>x.year).filter(Boolean)).size.toString().padStart(2,'0')}</b><span>个放送年份</span></div>`;
  const query=$('#filter').value.trim().toLowerCase();
  const list=library.filter(x=>(!$('#year').value||String(x.year)===$('#year').value)&&(!$('#season').value||x.season===$('#season').value)&&[x.title,x.original,x.studio,x.sourceTitle].join(' ').toLowerCase().includes(query));
  if($('#sort').value==='added')sortByAdded(list);
  else list.sort((a,b)=>$('#sort').value==='title'?a.title.localeCompare(b.title,'zh-CN'):String(b.date||b.year).localeCompare(String(a.date||a.year)));
  $('#count').textContent=list.length;
  $('#grid').innerHTML=list.length?list.map(x=>`<article class="card"><button class="cover-button" data-edit="${x.id}" aria-label="编辑 ${escape(x.title)}"><img class="poster" src="${escape(x.cover)}" alt="${escape(x.title)}封面" loading="lazy" referrerpolicy="no-referrer"></button><h3 title="${escape(x.title)}">${escape(x.title)}</h3><p class="original">${escape(x.original)}</p><div class="meta"><span>${escape(x.studio||'制作公司待补充')}</span><span>${x.year||'未知'}${seasons[x.season]?' · '+seasons[x.season]:''}</span></div></article>`).join(''):'<div class="empty">书架在等下一个故事。<br><br>添加一部作品，或调整筛选条件。</div>';
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
  $('#delete').hidden=!existing;
  $('#editTitle').textContent=existing?'编辑作品':'确认作品资料';
  $('#seriesSummary').hidden=!additions.length;
  $('#seriesSummary').textContent=additions.length?`保存后将整理 ${additions.length} 个条目（新增 ${additions.filter(x=>!library.some(y=>y.id===x.id)).length} 个）：${additions.map(x=>x.title).join('、')}`:'';
  $('#editDialog').showModal();
}
$('#add').onclick=()=>{$('#searchDialog').showModal();$('#query').focus();};
document.querySelectorAll('.close').forEach(button=>button.onclick=()=>button.closest('dialog').close());
$('#searchDialog').addEventListener('close',()=>searchController?.abort());
for(const selector of ['#filter','#year','#season','#sort']) $(selector).addEventListener(selector==='#filter'?'input':'change',render);
$('#grid').onclick=e=>{const button=e.target.closest('[data-edit]');if(button)edit(library.find(x=>x.id===Number(button.dataset.edit)),true);};
$('#searchForm').onsubmit=async e=>{
  e.preventDefault(); const query=$('#query').value.trim(); if(!query)return;
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
  const button=e.target.closest('[data-subject]');if(!button)return;
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
$('#editForm').onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.target));const item=normalize([{...editing,...values}])[0];const changes=normalize(pendingAdditions.length?pendingAdditions.map(x=>x.id===item.id?item:x):[item]);const ids=new Set(changes.map(x=>x.id));const next=[...library.filter(x=>!ids.has(x.id)),...changes];if(save(next)){$('#editDialog').close();toast(`已保存 ${changes.length} 个条目到当前浏览器`);}};
$('#delete').onclick=()=>{if(confirm('确定从书架移除这部作品？')){if(save(library.filter(x=>x.id!==editing.id))){$('#editDialog').close();toast('已移除作品');}}};
$('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(library,null,2)+'\n'],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='library.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('清单已导出，可替换仓库中的 data/library.json');};
$('#import').onclick=()=>$('#file').click();
$('#file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>10000000)throw new Error('文件不能超过 10 MB');const entries=normalize(JSON.parse(await file.text()));if(confirm(`将用文件中的 ${entries.length} 部作品替换当前清单。是否继续？`)&&save(entries))toast('已导入清单');}catch(error){toast('导入失败：'+error.message);}finally{e.target.value='';}};
try {
  let saved=null;
  try{saved=localStorage.getItem(KEY);}catch{toast('浏览器存储不可用，修改前请导出备份');}
  if(saved!==null){library=normalize(JSON.parse(saved));try{localStorage.setItem(KEY,JSON.stringify(library));}catch{toast('浏览器无法保存，清理旧数据前请导出备份');}}
  else{const response=await fetch('./data/library.json');if(!response.ok)throw new Error('无法读取清单文件');library=normalize(await response.json());}
  render();
}catch(error){$('#grid').innerHTML='<p class="empty">清单加载失败，请检查 data/library.json，或使用“导入清单”恢复备份。</p>';toast(error.message);}
