import { normalizeLibrary } from './library.mjs';

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clone=value=>JSON.parse(JSON.stringify(value));
export function mergeLibraries(base,local,remote){
  const before=new Map(base.map(x=>[x.id,x])),mine=new Map(local.map(x=>[x.id,x])),theirs=new Map(remote.map(x=>[x.id,x]));
  const ids=[...new Set([...remote.map(x=>x.id),...local.map(x=>x.id),...base.map(x=>x.id)])];
  const library=[],conflicts=[];
  for(const id of ids){
    const b=before.get(id),l=mine.get(id),r=theirs.get(id);
    let merged;
    if(equal(l,b))merged=r;
    else if(equal(r,b)||equal(l,r))merged=l;
    else if(!b||!l||!r){merged=r;conflicts.push({id,title:l?.title||r?.title||b.title,local:l,remote:r,wholeEntry:true,fields:[]});}
    else{
      merged={};const fields=[];
      for(const field of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){
        if(equal(l[field],b[field]))merged[field]=r[field];
        else if(equal(r[field],b[field])||equal(l[field],r[field]))merged[field]=l[field];
        else{fields.push(field);merged[field]=r[field];}
      }
      if(fields.length)conflicts.push({id,title:l.title,local:l,remote:r,wholeEntry:false,fields});
    }
    if(merged)library.push(merged);
  }
  return {library,conflicts};
}

export function resolveMerge(merge,choices={}){
  const records=new Map(merge.library.map(x=>[x.id,{...x}]));
  for(const conflict of merge.conflicts){
    const selected=choices[conflict.id]==='local'?conflict.local:conflict.remote;
    if(conflict.wholeEntry){if(selected)records.set(conflict.id,{...selected});else records.delete(conflict.id);}
    else{const record=records.get(conflict.id);for(const field of conflict.fields){if(selected[field]===undefined)delete record[field];else record[field]=selected[field];}}
  }
  return normalizeLibrary([...records.values()]);
}

export class GitHubSync {
  constructor({apiBase='',onLibrary=()=>{},onState=()=>{},storage=globalThis.localStorage,sessionStorage=globalThis.sessionStorage,fetcher=(...args)=>globalThis.fetch(...args),delay=700}={}){
    this.apiBase=apiBase.replace(/\/$/,'');this.onLibrary=onLibrary;this.onState=onState;this.storage=storage;this.sessionStorage=sessionStorage;this.fetcher=fetcher;this.delay=delay;
    this.key='anime-shelf-sync-v1';this.sessionKey=this.key+':'+this.apiBase;this.version=0;this.phase='loading';this.user=null;this.library=[];this.baseLibrary=[];this.sha=null;this.dirty=false;this.saving=false;this.conflict=null;this.message='正在读取清单…';this.lastCommitUrl='';
    try{this.token=sessionStorage.getItem(this.sessionKey)||'';}catch{this.token='';}
    try{const pending=JSON.parse(storage.getItem(this.key)||'null');if(pending?.dirty&&Array.isArray(pending.library))this.pending=pending;}catch{this.backupWarning=true;}
  }
  get canEdit(){return !!(this.user&&this.sha&&!this.conflict);}
  state(){return {phase:this.phase,message:this.message,canEdit:this.canEdit,user:this.user,dirty:this.dirty,configured:!!this.apiBase,hasBackup:!!this.pending||this.backupWarning,conflict:this.conflict,lastCommitUrl:this.lastCommitUrl};}
  emit(){this.onState(this.state());}
  async api(path,options={}){
    const response=await this.fetcher(this.apiBase+path,{...options,headers:{...(this.token?{Authorization:'Bearer '+this.token}:{}),...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},cache:'no-store',signal:AbortSignal.timeout(25000)});
    let result;try{result=await response.json();}catch{throw new Error('同步服务返回了无效响应');}
    if(!response.ok){const error=new Error(result.message||'同步失败，请稍后重试');error.status=response.status;error.code=result.error;throw error;}
    return result;
  }
  callback(location,history){
    const hash=new URLSearchParams(location.hash.slice(1));
    if(!hash.has('sync_session')&&!hash.has('sync_error'))return;
    // Remove the short-lived encrypted session from the address before any I/O.
    history.replaceState(null,'',location.pathname+location.search);
    let expected;try{expected=this.sessionStorage.getItem(this.sessionKey+':login');this.sessionStorage.removeItem(this.sessionKey+':login');}catch{throw new Error('浏览器无法保存登录状态，请允许此网站使用存储');}
    if(!expected||hash.get('login_state')!==expected)throw new Error('登录验证失败，请重新点击管理员登录');
    if(hash.has('sync_error'))throw new Error(hash.get('sync_error')==='not_owner'?'此账号没有编辑权限，请使用 doublename02 登录':'GitHub 授权未完成，请确认 App 已安装并重新登录');
    this.token=hash.get('sync_session');this.sessionStorage.setItem(this.sessionKey,this.token);
  }
  async start(publicLoader){
    this.publicLoader=publicLoader;
    // Public browsing always loads the published library, never an old local edit.
    this.library=normalizeLibrary(await publicLoader());this.onLibrary(this.library);
    if(this.apiBase&&this.token){
      try{
        this.user=await this.api('/auth/session');
        const remote=await this.api('/library');this.acceptRemote(remote);
        if(this.pending){
          if(String(this.pending.accountId)===String(this.user.id)){
            this.library=normalizeLibrary(this.pending.library);this.baseLibrary=normalizeLibrary(this.pending.baseLibrary||[]);this.sha=this.pending.sha;this.dirty=true;this.version++;this.onLibrary(this.library);
            if(this.sha!==remote.sha){this.prepareConflict(remote);return;}
            this.phase='pending';this.message='发现未同步草稿，正在重试…';this.emit();this.schedule();return;
          }
        }
        this.phase='synced';this.message='已连接 GitHub，修改后自动保存';
      }catch(error){this.handleError(error);return;}
    }else{this.phase='readonly';this.message=this.apiBase?'访客模式 · 登录后可编辑并自动同步':'访客模式 · 自动同步尚未配置';}
    this.emit();
  }
  acceptRemote(remote){
    this.library=normalizeLibrary(remote.library);this.baseLibrary=clone(this.library);this.sha=remote.sha;this.dirty=false;this.conflict=null;this.onLibrary(this.library);
  }
  async login(location=globalThis.location){
    if(!this.apiBase)throw new Error('自动同步尚未配置，请先完成 Cloudflare 部署');
    const health=await this.api('/health');if(!health.ready)throw new Error('同步服务尚未配置 GitHub App，请先完成部署设置');
    const state=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    this.sessionStorage.setItem(this.sessionKey+':login',state);
    location.assign(this.apiBase+'/auth/login?client_state='+encodeURIComponent(state));
  }
  persist(){
    const pending={sha:this.sha,baseLibrary:this.baseLibrary,library:this.library,dirty:this.dirty,accountId:this.user?.id,updatedAt:new Date().toISOString()};
    this.storage.setItem(this.key,JSON.stringify(pending));this.pending=this.dirty?pending:null;
  }
  setLibrary(items){
    if(!this.canEdit)throw new Error('请先登录管理员账号；存在冲突时需要先处理差异');
    const next=normalizeLibrary(items),previous=this.library,wasDirty=this.dirty;
    this.library=next;this.dirty=true;
    try{this.persist();}catch{this.library=previous;this.dirty=wasDirty;throw new Error('浏览器无法保存草稿，请先导出备份后重试');}
    this.version++;this.phase='pending';this.message='已保存本地草稿，等待同步…';this.onLibrary(this.library);this.emit();this.schedule();
  }
  schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),this.delay);}
  handleError(error){
    this.phase='error';this.message=error.message||'网络暂时不可用，草稿已保留';
    if(error.status===401||error.status===403){this.user=null;this.token='';try{this.sessionStorage.removeItem(this.sessionKey);}catch{};}
    this.emit();
  }
  prepareConflict(remote){
    const merge=mergeLibraries(this.baseLibrary,this.library,normalizeLibrary(remote.library));
    this.conflict={...merge,remote};this.phase='conflict';this.message=`云端有新修改，需合并差异（${merge.conflicts.length} 项冲突）`;this.emit();
  }
  async flush(){
    clearTimeout(this.timer);
    if(!this.canEdit||!this.dirty||this.saving)return;
    const version=this.version,snapshot=clone(this.library),sha=this.sha;
    this.saving=true;this.phase='saving';this.message='正在保存到 GitHub…';this.emit();
    try{
      const result=await this.api('/library',{method:'PUT',body:JSON.stringify({sha,library:snapshot})});
      this.sha=result.sha;this.baseLibrary=snapshot;this.lastCommitUrl=result.commitUrl||'';this.dirty=this.version!==version;
      // The remote write succeeded even if browser backup storage becomes full.
      try{this.persist();}catch{this.message='GitHub 已保存；浏览器备份失败，请导出备份';}
      this.phase=this.dirty?'pending':'synced';this.message=this.dirty?'新修改等待同步…':'已提交 GitHub，公开网页正在自动更新';this.emit();
    }catch(error){
      if(error.status===409){try{this.prepareConflict(await this.api('/library'));}catch(readError){this.handleError(readError);}}
      else this.handleError(error);
    }finally{this.saving=false;if(this.dirty&&this.phase==='pending')this.schedule();}
  }
  applyConflict(choices={}){
    if(!this.conflict||!this.user)throw new Error('请先登录并读取云端差异');
    const current=this.conflict;
    const previous={library:this.library,baseLibrary:this.baseLibrary,sha:this.sha,dirty:this.dirty,conflict:this.conflict,version:this.version};
    this.library=resolveMerge(current,choices);this.baseLibrary=normalizeLibrary(current.remote.library);this.sha=current.remote.sha;this.dirty=!equal(this.library,this.baseLibrary);this.conflict=null;this.version++;
    try{this.persist();}catch{Object.assign(this,previous);throw new Error('浏览器无法保存合并草稿，请先导出备份');}
    this.onLibrary(this.library);this.phase=this.dirty?'pending':'synced';this.message=this.dirty?'差异已合并，准备同步…':'已采用云端清单';this.emit();if(this.dirty)this.schedule();
  }
  async refresh(){
    if(this.saving)return;
    if(!this.user){this.library=normalizeLibrary(await this.publicLoader());this.onLibrary(this.library);return;}
    const remote=await this.api('/library');
    if(this.dirty){if(remote.sha!==this.sha)this.prepareConflict(remote);return;}
    this.acceptRemote(remote);this.phase='synced';this.message='已读取 GitHub 最新清单';this.emit();
  }
  async logout(){
    clearTimeout(this.timer);
    if(this.saving)throw new Error('正在保存，请等待保存完成后再退出');
    // Revoke the GitHub user token so the sealed session is unusable elsewhere.
    if(this.token)await this.api('/auth/logout',{method:'POST'});
    this.user=null;this.token='';this.sha=null;this.sessionStorage.removeItem(this.sessionKey);this.conflict=null;
    this.library=normalizeLibrary(await this.publicLoader());this.dirty=false;this.onLibrary(this.library);this.phase='readonly';this.message='已退出管理员，访客模式只读';this.emit();
  }
}
