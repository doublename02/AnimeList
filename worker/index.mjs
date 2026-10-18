import { MAX_BYTES, validateLibrary } from '../library.mjs';

const FILE='data/library.json';
const COOKIE='__Host-anime-oauth';
const encoder=new TextEncoder(),decoder=new TextDecoder();
const now=()=>Math.floor(Date.now()/1000);
class HttpError extends Error { constructor(status,message,code='request_failed'){super(message);this.status=status;this.code=code;} }

function base64(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
function unbase64(text){return Uint8Array.from(atob(text),char=>char.charCodeAt(0));}
const base64url=bytes=>base64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unbase64url=text=>unbase64(text.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(text.length/4)*4,'='));
const random=()=>base64url(crypto.getRandomValues(new Uint8Array(32)));
const audience=env=>`${env.FRONTEND_URL}|${env.GITHUB_REPOSITORY_ID}|${env.GITHUB_BRANCH}|${FILE}|${env.GITHUB_CLIENT_ID}`;

async function key(env){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode(env.SESSION_SECRET)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function seal(payload,env){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(audience(env))},await key(env),encoder.encode(JSON.stringify(payload)));
  return `${base64url(iv)}.${base64url(new Uint8Array(cipher))}`;
}
export async function unseal(value,env,purpose){
  try{
    if(typeof value!=='string'||value.length>12000)throw new Error();
    const parts=value.split('.');if(parts.length!==2)throw new Error();
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64url(parts[0]),additionalData:encoder.encode(audience(env))},await key(env),unbase64url(parts[1]));
    const payload=JSON.parse(decoder.decode(plain));
    if(payload.purpose!==purpose||!Number.isInteger(payload.exp)||payload.exp<=now())throw new Error();
    return payload;
  }catch{throw new HttpError(401,'登录已过期，请重新登录','unauthorized');}
}

function configured(env){return !!(env.GITHUB_CLIENT_ID&&env.GITHUB_CLIENT_SECRET&&env.SESSION_SECRET?.length>=43&&env.ALLOWED_USER_ID&&env.GITHUB_REPOSITORY_ID&&env.FRONTEND_URL);}
function headers(request,env){
  const output=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'});
  if(request.headers.get('Origin')===new URL(env.FRONTEND_URL).origin){
    output.set('Access-Control-Allow-Origin',new URL(env.FRONTEND_URL).origin);
    output.set('Access-Control-Allow-Methods','GET, PUT, POST, OPTIONS');
    output.set('Access-Control-Allow-Headers','Authorization, Content-Type');
    output.set('Access-Control-Max-Age','600');
  }
  return output;
}
function json(request,env,value,status=200){const result=headers(request,env);result.set('Content-Type','application/json; charset=utf-8');return new Response(JSON.stringify(value),{status,headers:result});}
function redirect(request,env,target,cookie){const result=headers(request,env);result.set('Location',target);if(cookie)result.set('Set-Cookie',cookie);return new Response(null,{status:302,headers:result});}
function requireOrigin(request,env){if(request.headers.get('Origin')!==new URL(env.FRONTEND_URL).origin)throw new HttpError(403,'不允许此网站访问保存接口','origin_denied');}
function cookieValue(request){return request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);}
const oauthCookie=(value,maxAge=600)=>`${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function github(path,token,options={},fetcher=fetch){
  try{return await fetcher('https://api.github.com'+path,{...options,headers:{'Accept':'application/vnd.github+json','User-Agent':'AnimeShelfSync/1.0','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{}),...options.headers},signal:AbortSignal.timeout(20000)});}
  catch{throw new HttpError(503,'暂时无法连接 GitHub，请稍后重试','github_unavailable');}
}
function githubError(response){
  if(response.status===401)throw new HttpError(401,'GitHub 授权已失效，请重新登录','unauthorized');
  if(response.status===409||response.status===422)throw new HttpError(409,'云端清单已更新，请先合并差异','conflict');
  if(response.status===403||response.status===404)throw new HttpError(403,'请确认 GitHub App 已安装到 AnimeList 仓库，并拥有 Contents 读写权限','permission_denied');
  throw new HttpError(503,'GitHub 暂时无法保存，请稍后重试','github_unavailable');
}
function owner(user,env){if(String(user.id)!==String(env.ALLOWED_USER_ID)||user.login?.toLowerCase()!==env.ALLOWED_LOGIN.toLowerCase())throw new HttpError(403,'只有网站所有者可以编辑清单','not_owner');}
async function authenticate(request,env,fetcher){
  const authorization=request.headers.get('Authorization')||'';
  if(!authorization.startsWith('Bearer '))throw new HttpError(401,'请先使用 GitHub 登录','unauthorized');
  const session=await unseal(authorization.slice(7),env,'session');
  if(String(session.id)!==String(env.ALLOWED_USER_ID))throw new HttpError(403,'此账号没有编辑权限','not_owner');
  const response=await github('/user',session.token,{},fetcher);
  if(!response.ok)githubError(response);
  const user=await response.json();owner(user,env);
  return {...session,login:user.login};
}
const contents=env=>`/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/${FILE}`;
async function readLibrary(session,env,fetcher){
  const url=contents(env)+`?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`;
  const response=await github(url,session.token,{},fetcher);
  if(!response.ok)githubError(response);
  const file=await response.json();
  if(file.type!=='file'||!file.sha||file.size>MAX_BYTES)throw new HttpError(502,'仓库清单文件无效或超过 10 MB','invalid_remote');
  let text;
  if(file.encoding==='base64')text=decoder.decode(unbase64(file.content.replace(/\s/g,'')));
  else{const raw=await github(url,session.token,{headers:{Accept:'application/vnd.github.raw+json'}},fetcher);if(!raw.ok)githubError(raw);text=await raw.text();}
  if(encoder.encode(text).byteLength>MAX_BYTES)throw new HttpError(502,'仓库清单超过 10 MB','invalid_remote');
  try{return {sha:file.sha,library:validateLibrary(JSON.parse(text))};}
  catch{throw new HttpError(502,'仓库清单格式无效，请先修复 JSON 文件','invalid_remote');}
}
async function limitedJson(request){
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw new HttpError(415,'请提交 JSON 格式','invalid_request');
  if(Number(request.headers.get('Content-Length'))>MAX_BYTES)throw new HttpError(413,'清单不能超过 10 MB','too_large');
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'提交内容不能为空','invalid_request');
  const chunks=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BYTES){await reader.cancel();throw new HttpError(413,'清单不能超过 10 MB','too_large');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(decoder.decode(bytes));}catch{throw new HttpError(400,'JSON 格式无效','invalid_request');}
}

export async function handle(request,env,fetcher=fetch){
  const url=new URL(request.url);
  try{
    if(url.pathname==='/health'&&request.method==='GET')return json(request,env,{ready:configured(env)});
    if(!configured(env))throw new HttpError(503,'自动同步尚未完成部署配置','not_configured');
    if(request.method==='OPTIONS'){requireOrigin(request,env);return new Response(null,{status:204,headers:headers(request,env)});}
    if(url.pathname==='/auth/login'&&request.method==='GET'){
      const clientState=url.searchParams.get('client_state');
      if(!/^[A-Za-z0-9_-]{43}$/.test(clientState||''))throw new HttpError(400,'登录请求无效，请从网站重新登录','invalid_state');
      const state=random(),verifier=random();
      const encrypted=await seal({purpose:'oauth',state,verifier,clientState,exp:now()+600},env);
      const authorize=new URL('https://github.com/login/oauth/authorize');
      const callback=new URL('/auth/callback',url).href;
      const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(verifier))));
      for(const [name,value]of Object.entries({client_id:env.GITHUB_CLIENT_ID,redirect_uri:callback,state,code_challenge:challenge,code_challenge_method:'S256',login:env.ALLOWED_LOGIN,allow_signup:'false'}))authorize.searchParams.set(name,value);
      return redirect(request,env,authorize.href,oauthCookie(encrypted));
    }
    if(url.pathname==='/auth/callback'&&request.method==='GET'){
      let state;
      try{
        state=await unseal(cookieValue(request),env,'oauth');
        if(url.searchParams.get('state')!==state.state)throw new HttpError(400,'登录验证失败，请重试','invalid_state');
        if(url.searchParams.has('error')||!url.searchParams.get('code'))throw new HttpError(403,'GitHub 授权未完成','authorization_denied');
        const tokenResponse=await fetcher('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code:url.searchParams.get('code'),code_verifier:state.verifier,redirect_uri:new URL('/auth/callback',url).href,repository_id:String(env.GITHUB_REPOSITORY_ID)}),signal:AbortSignal.timeout(20000)});
        const token=await tokenResponse.json();
        if(!tokenResponse.ok||!token.access_token)throw new HttpError(401,'GitHub 授权失败，请重新登录','authorization_failed');
        const identity=await github('/user',token.access_token,{},fetcher);if(!identity.ok)githubError(identity);
        const user=await identity.json();owner(user,env);
        const repository=await github(`/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}`,token.access_token,{},fetcher);if(!repository.ok)githubError(repository);
        const repo=await repository.json();
        if(String(repo.id)!==String(env.GITHUB_REPOSITORY_ID)||!repo.permissions?.push)throw new HttpError(403,'该账号或 GitHub App 没有目标仓库的写入权限','permission_denied');
        const exp=now()+Math.min(3600,Number(token.expires_in)||3600);
        const session=await seal({purpose:'session',id:user.id,login:user.login,token:token.access_token,exp},env);
        const target=new URL(env.FRONTEND_URL);target.hash=new URLSearchParams({sync_session:session,login_state:state.clientState}).toString();
        return redirect(request,env,target.href,oauthCookie('',0));
      }catch(error){
        const target=new URL(env.FRONTEND_URL);target.hash=new URLSearchParams({sync_error:error instanceof HttpError?error.code:'authorization_failed',...(state?.clientState?{login_state:state.clientState}:{})}).toString();
        return redirect(request,env,target.href,oauthCookie('',0));
      }
    }
    requireOrigin(request,env);
    const session=await authenticate(request,env,fetcher);
    if(url.pathname==='/auth/session'&&request.method==='GET')return json(request,env,{login:session.login,id:session.id,expiresAt:session.exp*1000});
    if(url.pathname==='/auth/logout'&&request.method==='POST'){
      const response=await github(`/applications/${encodeURIComponent(env.GITHUB_CLIENT_ID)}/token`,null,{method:'DELETE',headers:{Authorization:'Basic '+btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`),'Content-Type':'application/json'},body:JSON.stringify({access_token:session.token})},fetcher);
      if(!response.ok&&response.status!==404)githubError(response);
      return json(request,env,{ok:true});
    }
    if(url.pathname==='/library'&&request.method==='GET')return json(request,env,await readLibrary(session,env,fetcher));
    if(url.pathname==='/library'&&request.method==='PUT'){
      const body=await limitedJson(request);
      if(typeof body.sha!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/i.test(body.sha))throw new HttpError(400,'缺少云端版本，请先读取清单','invalid_revision');
      let library;try{library=validateLibrary(body.library);}catch(error){throw new HttpError(400,error.message,'invalid_library');}
      const text=JSON.stringify(library,null,2)+'\n';
      if(encoder.encode(text).byteLength>MAX_BYTES)throw new HttpError(413,'清单不能超过 10 MB','too_large');
      const response=await github(contents(env),session.token,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Update anime collection from website',branch:env.GITHUB_BRANCH,sha:body.sha,content:base64(encoder.encode(text))})},fetcher);
      if(!response.ok)githubError(response);
      const result=await response.json();
      return json(request,env,{sha:result.content.sha,commit:result.commit.sha,commitUrl:result.commit.html_url});
    }
    throw new HttpError(404,'接口不存在','not_found');
  }catch(error){return json(request,env,{error:error instanceof HttpError?error.code:'internal_error',message:error instanceof HttpError?error.message:'同步服务暂时不可用，请稍后重试'},error instanceof HttpError?error.status:500);}
}

const defaults={FRONTEND_URL:'https://doublename02.github.io/AnimeList/',GITHUB_OWNER:'doublename02',GITHUB_REPO:'AnimeList',GITHUB_BRANCH:'main',GITHUB_REPOSITORY_ID:'1423929539',ALLOWED_USER_ID:'113842800',ALLOWED_LOGIN:'doublename02'};
export default {fetch(request,env){return handle(request,{...defaults,...env});}};
