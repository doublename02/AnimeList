import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handle, seal, unseal } from '../worker/index.mjs';
import { validateLibrary } from '../library.mjs';

const env={FRONTEND_URL:'https://doublename02.github.io/AnimeList/',GITHUB_OWNER:'doublename02',GITHUB_REPO:'AnimeList',GITHUB_BRANCH:'main',GITHUB_REPOSITORY_ID:'1423929539',ALLOWED_USER_ID:'113842800',ALLOWED_LOGIN:'doublename02',GITHUB_CLIENT_ID:'test-client',GITHUB_CLIENT_SECRET:'test-only-secret',SESSION_SECRET:'test-session-key-not-production-01234567890123456789'};
const origin=new URL(env.FRONTEND_URL).origin;
const user={id:113842800,login:'doublename02'};
const entry={id:1,title:'测试动画',original:'テスト',studio:'动画公司',cover:'',year:2020,season:'winter',date:'2020-01-01',note:'',addedAt:'2026-10-18T08:00:00.000Z'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const session=()=>seal({purpose:'session',...user,token:'test-ghu-token',exp:Math.floor(Date.now()/1000)+3600},env);
async function request(path,options={}){const token=await session();return new Request('https://sync.example'+path,{...options,headers:{Origin:origin,Authorization:'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});}

test('published library satisfies the server write schema',async()=>{
  const library=JSON.parse(await readFile(new URL('../data/library.json',import.meta.url),'utf8'));
  assert.equal(validateLibrary(library).length,916);
});

test('unauthenticated writes and disallowed origins cannot reach GitHub',async()=>{
  const fetcher=()=>{throw new Error('unexpected upstream request');};
  const guest=await handle(new Request('https://sync.example/library',{method:'PUT',headers:{Origin:origin}}),env,fetcher);
  assert.equal(guest.status,401);
  const foreign=await handle(await request('/library',{method:'PUT',headers:{Origin:'https://evil.example'}}),env,fetcher);
  assert.equal(foreign.status,403);
  assert.equal(foreign.headers.get('Access-Control-Allow-Origin'),null);
});

test('sessions are encrypted, expire and cannot be replayed for another audience',async()=>{
  const token=await session();assert(!token.includes('test-ghu-token'));
  assert.equal((await unseal(token,env,'session')).id,user.id);
  await assert.rejects(unseal(token,{...env,GITHUB_REPOSITORY_ID:'another-repo'},'session'));
  await assert.rejects(unseal(token,env,'oauth'));
  const expired=await seal({purpose:'session',exp:1},env);await assert.rejects(unseal(expired,env,'session'));
});

test('GitHub identity must match the immutable owner ID',async()=>{
  const response=await handle(await request('/library'),env,async()=>json({id:999,login:'doublename02'}));
  assert.equal(response.status,403);
});

test('saves are confined to the fixed repository, branch and JSON path',async()=>{
  let write;
  const fetcher=async(url,options)=>{
    if(url==='https://api.github.com/user')return json(user);
    write={url,body:JSON.parse(options.body)};
    return json({content:{sha:'b'.repeat(40)},commit:{sha:'c'.repeat(40),html_url:'https://github.com/doublename02/AnimeList/commit/'+ 'c'.repeat(40)}},200);
  };
  const response=await handle(await request('/library',{method:'PUT',body:JSON.stringify({sha:'a'.repeat(40),library:[entry],path:'.github/workflows/evil.yml',repository:'other'})}),env,fetcher);
  assert.equal(response.status,200);assert.equal(write.url,'https://api.github.com/repos/doublename02/AnimeList/contents/data/library.json');
  assert.equal(write.body.branch,'main');assert.equal(write.body.sha,'a'.repeat(40));
  assert.equal(JSON.parse(Buffer.from(write.body.content,'base64').toString('utf8'))[0].title,entry.title);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});

test('GitHub CAS rejection returns a conflict without retrying or overwriting',async()=>{
  let writes=0;
  const response=await handle(await request('/library',{method:'PUT',body:JSON.stringify({sha:'a'.repeat(40),library:[entry]})}),env,async url=>{
    if(url.endsWith('/user'))return json(user);writes++;return json({message:'sha mismatch'},409);
  });
  assert.equal(response.status,409);assert.equal((await response.json()).error,'conflict');assert.equal(writes,1);
});

test('malformed and duplicate entries are rejected before a write',async()=>{
  let writes=0;
  for(const library of [[entry,entry],[{...entry,cover:'javascript:alert(1)'}],[{...entry,title:'x'.repeat(201)}]]){
    const response=await handle(await request('/library',{method:'PUT',body:JSON.stringify({sha:'a'.repeat(40),library})}),env,async url=>{if(url.endsWith('/user'))return json(user);writes++;return json({});});
    assert.equal(response.status,400);
  }
  assert.equal(writes,0);
});

test('login uses PKCE and an HttpOnly secure state cookie without broad OAuth scopes',async()=>{
  const response=await handle(new Request('https://sync.example/auth/login?client_state='+'a'.repeat(43)+'&return_to=https://evil.example'),env);
  const authorize=new URL(response.headers.get('Location'));
  assert.equal(authorize.origin,'https://github.com');assert.equal(authorize.searchParams.get('code_challenge_method'),'S256');
  assert.equal(authorize.searchParams.get('code_challenge').length,43);assert.equal(authorize.searchParams.has('scope'),false);
  assert.equal(authorize.searchParams.get('redirect_uri'),'https://sync.example/auth/callback');
  const cookie=response.headers.get('Set-Cookie');assert(cookie.includes('HttpOnly'));assert(cookie.includes('Secure'));assert(cookie.includes('SameSite=Lax'));
});

test('OAuth callback rejects state forgery before exchanging the code',async()=>{
  const state=await seal({purpose:'oauth',state:'real',clientState:'a'.repeat(43),exp:Math.floor(Date.now()/1000)+600},env);
  const response=await handle(new Request('https://sync.example/auth/callback?state=forged&code=code',{headers:{Cookie:'__Host-anime-oauth='+state}}),env,()=>{throw new Error('must not exchange');});
  const target=new URL(response.headers.get('Location'));
  assert.equal(target.origin,origin);assert.equal(new URLSearchParams(target.hash.slice(1)).get('sync_error'),'invalid_state');
});

test('OAuth callback returns only a sealed short-lived session, restricted to the repository',async()=>{
  const state=await seal({purpose:'oauth',state:'valid-state',clientState:'a'.repeat(43),verifier:'test-verifier',exp:Math.floor(Date.now()/1000)+600},env);
  let parameters;
  const fetcher=async(url,options)=>{
    if(url==='https://github.com/login/oauth/access_token'){parameters=options.body;return json({access_token:'secret-user-access-token',expires_in:28800});}
    if(url.endsWith('/user'))return json(user);
    return json({id:1423929539,permissions:{push:true}});
  };
  const response=await handle(new Request('https://sync.example/auth/callback?state=valid-state&code=code',{headers:{Cookie:'__Host-anime-oauth='+state}}),env,fetcher);
  assert.equal(parameters.get('repository_id'),'1423929539');assert.equal(parameters.get('code_verifier'),'test-verifier');
  const target=response.headers.get('Location');assert(!target.includes('secret-user-access-token'));
  const hash=new URLSearchParams(new URL(target).hash.slice(1));assert.equal(hash.get('login_state'),'a'.repeat(43));
  const session=await unseal(hash.get('sync_session'),env,'session');assert.equal(session.token,'secret-user-access-token');assert(session.exp<=Math.floor(Date.now()/1000)+3600);
});
