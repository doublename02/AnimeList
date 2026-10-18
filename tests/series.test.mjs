import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverSeasons, isSeasonSubject, organizeEntries, sameTimeline, sortByAdded } from '../series.mjs';

const subject=(id,name,platform='TV',extra={})=>({id,type:2,name,name_cn:name,platform,total_episodes:12,...extra});
const entry=(id,title,date,addedAt='2026-10-18T08:00:00.000Z')=>({id,title,date,addedAt});

test('JOJO keeps Bangumi arc names when regrouping existing and new entries',()=>{
  const subjects=[subject(43558,'JOJO的奇妙冒险'),subject(150490,'JOJO的奇妙冒险 不灭钻石')];
  const records=[entry(43558,'JOJO的奇妙冒险 第一季','2012-10-05'),{...entry(150490,'JOJO的奇妙冒险 第三季 · 不灭钻石','2016-04-01'),sourceTitle:'JOJO的奇妙冒险 不灭钻石'}];
  const result=organizeEntries(records,subjects,[[43558,150490]]);
  assert.deepEqual(result.map(x=>x.title),subjects.map(x=>x.name_cn));
  assert.deepEqual(result.map(x=>x.seriesOrder),[1,2]);
  assert.ok(result.every(x=>x.seriesId===43558));
});

test('TV specials, recaps, films and OVA are not automatic seasons',()=>{
  assert.equal(isSeasonSubject(subject(1,'作品 第一季')),true);
  assert.equal(isSeasonSubject(subject(2,'作品 第二季','TV',{total_episodes:0})),true);
  assert.equal(isSeasonSubject(subject(3,'作品 特别篇')),false);
  assert.equal(isSeasonSubject(subject(4,'作品 回顾','TV',{total_episodes:1})),false);
  assert.equal(isSeasonSubject(subject(5,'作品','OVA')),false);
  assert.equal(isSeasonSubject(subject(6,'作品','剧场版')),false);
});

test('discover traverses a film bridge and terminates cycles',async()=>{
  const details={1:subject(1,'系列'),2:subject(2,'系列 剧场版','剧场版'),3:subject(3,'系列 第二季')};
  const related={1:[{id:2,type:2,relation:'续集'},{id:90,type:2,relation:'番外篇'}],2:[{id:1,type:2,relation:'前传'},{id:3,type:2,relation:'续集'}],3:[{id:2,type:2,relation:'前传'}]};
  const requests=[];
  const request=async path=>{requests.push(path);const match=path.match(/subjects\/(\d+)(\/subjects)?$/);return match[2]?related[match[1]]:details[match[1]];};
  const result=await discoverSeasons(details[1],request);
  assert.deepEqual(result.subjects.filter(isSeasonSubject).map(x=>x.id),[1,3]);
  assert.equal(requests.filter(x=>x==='/v0/subjects/1/subjects').length,1);
  assert.equal(requests.some(x=>x.includes('/90')),false);
});

test('prequel relationships do not merge different Fate adaptations',()=>{
  assert.equal(sameTimeline(subject(1,'Fate/Zero'),subject(2,'Fate/stay night')),false);
  assert.equal(sameTimeline(subject(1,'Fate/Zero'),subject(2,'Fate/Zero 第二季')),true);
});

test('sword art season three retains separate named parts',()=>{
  const ids=[23686,92382,225604,279457,292238];
  const titles=['刀剑神域','刀剑神域 第二季','刀剑神域 爱丽丝篇','刀剑神域 爱丽丝篇 异界战争','刀剑神域 爱丽丝篇 异界战争 -终章-'];
  const rows=ids.map((id,i)=>entry(id,titles[i],`${2012+i}-01-01`));
  const organized=organizeEntries(rows,ids.map((id,i)=>subject(id,titles[i])),ids.slice(1).map((id,i)=>[ids[i],id]));
  assert.deepEqual(organized.map(x=>x.seriesOrder),[1,2,3,4,5]);
  assert.equal(organized[0].title,'刀剑神域 第一季');
  assert.equal(organized[1].title,'刀剑神域 第二季');
  assert(organized.slice(2).every(x=>x.title.startsWith('刀剑神域 第三季')));
  assert.equal(organized[3].sourceTitle,titles[3]);
});

test('added sort reverses both series and seasons, including a filtered single series',()=>{
  const rows=[{id:1,seriesId:1,seriesOrder:1,addedAt:'2020-01-01'},{id:2,seriesId:1,seriesOrder:2,addedAt:'2026-01-01'},{id:3,addedAt:'2025-01-01'}];
  assert.deepEqual(sortByAdded([...rows].reverse()).map(x=>x.id),[2,1,3]);
  assert.deepEqual(sortByAdded([rows[1],rows[0]],'desc').map(x=>x.id),[2,1]);
  assert.deepEqual(sortByAdded([rows[1],rows[0]],'asc').map(x=>x.id),[1,2]);
  assert.deepEqual(sortByAdded([...rows],'asc').map(x=>x.id),[3,1,2]);
  assert.deepEqual(sortByAdded([...rows],'desc').map(x=>x.id),[2,1,3]);
});

test('equal addition timestamps still produce fully reversed deterministic orders',()=>{
  const rows=[{id:1,seriesId:1,seriesOrder:1,addedAt:'2026-01-01'},{id:2,seriesId:1,seriesOrder:2,addedAt:'2026-01-01'},{id:3,addedAt:'2026-01-01'}];
  const ascending=sortByAdded([...rows],'asc').map(x=>x.id);
  assert.deepEqual(sortByAdded([...rows],'desc').map(x=>x.id),ascending.reverse());
});

test('an incomplete network traversal rejects before any additions are returned',async()=>{
  await assert.rejects(()=>discoverSeasons(subject(1,'系列'),async()=>{throw new Error('network unavailable');}),/network unavailable/);
});
