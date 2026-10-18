import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubSync, mergeLibraries, resolveMerge } from '../sync.mjs';

const entry=(id,note='')=>({id,title:'作品 '+id,original:'',cover:'',studio:'',year:2020,season:'winter',date:'2020-01-01',note,addedAt:'2026-10-18T08:00:00.000Z'});
const memory=()=>{const data=new Map();return{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
test('default fetch keeps the browser global receiver',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=function(){assert.equal(this,globalThis);return Promise.resolve(json({ok:true}));};
  try{
    const sync=new GitHubSync({apiBase:'https://sync.example',storage:memory(),sessionStorage:memory()});
    assert.deepEqual(await sync.api('/health'),{ok:true});
  }finally{globalThis.fetch=original;}
});
function setup(t,fetcher){
  const storage=memory(),sessionStorage=memory();
  const sync=new GitHubSync({apiBase:'https://sync.example',storage,sessionStorage,fetcher,delay:1000000});
  sync.user={id:113842800};sync.token='sealed-token';sync.sha='a'.repeat(40);sync.library=[entry(1)];sync.baseLibrary=[entry(1)];
  t.after(()=>clearTimeout(sync.timer));return{sync,storage,sessionStorage};
}

test('merge preserves independent changes on the same entry',()=>{
  const base=[entry(1)],local=[{...entry(1),note:'我的短评'}],remote=[{...entry(1),studio:'新公司'}];
  const merge=mergeLibraries(base,local,remote);assert.equal(merge.conflicts.length,0);
  const resolved=resolveMerge(merge);assert.equal(resolved[0].note,'我的短评');assert.equal(resolved[0].studio,'新公司');
});

test('conflicting fields and delete-vs-edit require an explicit choice',()=>{
  const base=[entry(1)],merge=mergeLibraries(base,[entry(1,'local')],[entry(1,'remote')]);
  assert.equal(merge.conflicts.length,1);assert.equal(resolveMerge(merge,{1:'local'})[0].note,'local');assert.equal(resolveMerge(merge,{1:'remote'})[0].note,'remote');
  const deletion=mergeLibraries(base,[],[entry(1,'remote')]);assert.equal(deletion.conflicts[0].wholeEntry,true);
  assert.equal(resolveMerge(deletion,{1:'local'}).length,0);assert.equal(resolveMerge(deletion,{1:'remote'}).length,1);
});

test('guests load public data rather than a dirty or legacy browser copy',async()=>{
  const storage=memory();storage.setItem('anime-shelf-v1',JSON.stringify([entry(99)]));storage.setItem('anime-shelf-sync-v1',JSON.stringify({dirty:true,library:[entry(98)],accountId:113842800}));
  const sync=new GitHubSync({storage,sessionStorage:memory(),fetcher:()=>{throw new Error('no API needed');}});
  await sync.start(async()=>[entry(1)]);assert.equal(sync.library[0].id,1);assert.equal(sync.canEdit,false);assert.equal(sync.state().hasBackup,true);
  assert.throws(()=>sync.setLibrary([entry(2)]));
});

test('edits during an in-flight save are queued against its new revision',async t=>{
  const writes=[];let release;
  const {sync}=setup(t,async(url,options)=>{
    writes.push(JSON.parse(options.body));if(writes.length===1)return new Promise(resolve=>{release=()=>resolve(json({sha:'b'.repeat(40)}));});
    return json({sha:'c'.repeat(40)});
  });
  sync.setLibrary([entry(1,'first')]);const first=sync.flush();
  sync.setLibrary([entry(1,'second')]);release();await first;
  assert.equal(sync.dirty,true);assert.equal(sync.baseLibrary[0].note,'first');assert.equal(sync.library[0].note,'second');
  await sync.flush();assert.equal(writes[1].sha,'b'.repeat(40));assert.equal(writes[1].library[0].note,'second');assert.equal(sync.dirty,false);
});

test('network failure retains the local draft without reporting success',async t=>{
  const {sync,storage}=setup(t,async()=>{throw new Error('offline');});sync.setLibrary([entry(1,'unsaved')]);await sync.flush();
  assert.equal(sync.phase,'error');assert.equal(sync.dirty,true);assert.equal(JSON.parse(storage.getItem(sync.key)).library[0].note,'unsaved');assert.equal(sync.sha,'a'.repeat(40));
});

test('409 blocks writes until cloud differences are reviewed and merged',async t=>{
  let puts=0;
  const {sync}=setup(t,async(url,options)=>{
    if(options.method==='PUT'){puts++;return json({message:'冲突',error:'conflict'},409);}
    return json({sha:'b'.repeat(40),library:[entry(1,'cloud')]});
  });
  sync.setLibrary([entry(1,'local')]);await sync.flush();assert.equal(sync.phase,'conflict');assert.equal(sync.canEdit,false);
  await sync.flush();assert.equal(puts,1);
  sync.applyConflict({1:'local'});assert.equal(sync.sha,'b'.repeat(40));assert.equal(sync.library[0].note,'local');assert.equal(sync.canEdit,true);
});

test('a storage failure rolls back an edit before it can be submitted',t=>{
  const {sync}=setup(t,()=>{throw new Error('must not submit');});sync.storage.setItem=()=>{throw new Error('quota exceeded');};
  assert.throws(()=>sync.setLibrary([entry(1,'lost')]),/草稿/);assert.equal(sync.library[0].note,'');assert.equal(sync.dirty,false);
});

test('callback removes credentials from the URL before validating state',()=>{
  const order=[],storage=memory();const sync=new GitHubSync({apiBase:'https://sync.example',storage:memory(),sessionStorage:storage});
  storage.setItem(sync.sessionKey+':login','expected');
  sync.callback({hash:'#sync_session=encrypted&login_state=expected',pathname:'/AnimeList/',search:''},{replaceState:()=>order.push('cleared')});
  assert.deepEqual(order,['cleared']);assert.equal(storage.getItem(sync.sessionKey),'encrypted');
  assert.throws(()=>sync.callback({hash:'#sync_session=evil&login_state=forged',pathname:'/AnimeList/',search:''},{replaceState:()=>{}}));assert.equal(storage.getItem(sync.sessionKey),'encrypted');
});
