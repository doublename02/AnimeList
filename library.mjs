export const MAX_ENTRIES = 10000;
export const MAX_BYTES = 10 * 1024 * 1024;
const seasons = new Set(['winter','spring','summer','autumn']);

// Imported timestamps or a changed device clock must not place a new addition
// behind entries already on the shelf. Use one timestamp for the whole batch.
export function nextAddedAt(entries, now=Date.now()) {
  const latest=entries.reduce((max,entry)=>Math.max(max,Date.parse(entry.addedAt)||0),0);
  return new Date(Math.max(now,latest+1)).toISOString();
}

export function safeCover(value) {
  if (typeof value !== 'string') return '';
  if (/^https:\/\//i.test(value)) {
    try { const url=new URL(value); return url.username||url.password?'':url.href; } catch { return ''; }
  }
  return /^AnimeList\/Covers\/[\w\-\u0080-\uffff/.]+$/.test(value)&&!value.includes('..')?value:'';
}

export function normalizeLibrary(items) {
  if(!Array.isArray(items)||items.length>MAX_ENTRIES)throw new Error('清单应为作品数组，最多 10000 条');
  const ids=new Set();
  const normalized=items.map(x=>{
    if(!x||!Number.isSafeInteger(Number(x.id))||Number(x.id)<=0||typeof x.title!=='string'||!x.title.trim()||ids.has(Number(x.id)))throw new Error('作品 ID、名称无效，或存在重复作品');
    ids.add(Number(x.id));
    const group=Number.isSafeInteger(Number(x.seriesId))&&Number(x.seriesId)>0?{seriesId:Number(x.seriesId),seriesTitle:String(x.seriesTitle||'').slice(0,200),seriesOrder:Math.max(1,Math.min(10000,Number(x.seriesOrder)||1)),sourceTitle:String(x.sourceTitle||x.title).slice(0,200)}:{};
    return {id:Number(x.id),title:x.title.slice(0,200),original:String(x.original||'').slice(0,200),cover:safeCover(x.cover),studio:String(x.studio||'').slice(0,200),year:Number.isInteger(Number(x.year))&&Number(x.year)>=1900&&Number(x.year)<=2200?Number(x.year):'',season:seasons.has(x.season)?x.season:'',date:String(x.date||''),note:String(x.note||'').slice(0,2000),addedAt:Number.isFinite(Date.parse(x.addedAt))?x.addedAt:new Date().toISOString(),...group};
  });
  // Bangumi may split Steel Ball Run from the older animation relationship
  // graph. Keep JOJO's named arcs in one shelf group without renaming them.
  const jojo=normalized.filter(x=>/(?:JOJO的奇妙冒险|ジョジョの奇妙な冒険)/i.test([x.title,x.original,x.sourceTitle].join(' ')));
  jojo.sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||a.id-b.id);
  const anchor=jojo.reduce((latest,x)=>Date.parse(x.addedAt)>Date.parse(latest||0)?x.addedAt:latest,'');
  jojo.forEach((x,index)=>Object.assign(x,{seriesId:43558,seriesTitle:'JOJO的奇妙冒险',seriesOrder:index+1,sourceTitle:x.sourceTitle||x.title,addedAt:anchor}));
  return normalized;
}

// Reject invalid writes rather than silently truncating a server-side request.
export function validateLibrary(items) {
  if(!Array.isArray(items)||items.length>MAX_ENTRIES)throw new Error('清单格式或作品数量无效');
  for(const x of items){
    if(!x||!Number.isSafeInteger(x.id)||x.id<=0)throw new Error('作品 ID 必须为正整数');
    for(const [key,max] of Object.entries({title:200,original:200,cover:2048,studio:200,note:2000,date:10,addedAt:40,seriesTitle:200,sourceTitle:200})){
      if(x[key]!==undefined&&(typeof x[key]!=='string'||x[key].length>max))throw new Error(`作品字段 ${key} 无效`);
    }
    if(typeof x.title!=='string'||!x.title.trim())throw new Error('作品名称不能为空');
    if(x.cover&&!safeCover(x.cover))throw new Error('封面地址无效');
    if(x.year!==undefined&&x.year!==''&&(!Number.isInteger(x.year)||x.year<1900||x.year>2200))throw new Error('作品年份无效');
    if(x.season&&!seasons.has(x.season))throw new Error('作品季度无效');
    if(x.date&&!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(x.date))throw new Error('放送日期格式无效');
    if(x.addedAt&&!Number.isFinite(Date.parse(x.addedAt)))throw new Error('添加日期无效');
    if(x.seriesId!==undefined&&(!Number.isSafeInteger(x.seriesId)||x.seriesId<=0))throw new Error('系列 ID 无效');
    if(x.seriesOrder!==undefined&&(!Number.isInteger(x.seriesOrder)||x.seriesOrder<1||x.seriesOrder>10000))throw new Error('系列顺序无效');
  }
  return normalizeLibrary(items);
}
