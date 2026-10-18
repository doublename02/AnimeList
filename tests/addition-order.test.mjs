import test from 'node:test';
import assert from 'node:assert/strict';
import { nextAddedAt, normalizeLibrary } from '../library.mjs';
import { sortByAdded } from '../series.mjs';

test('JOJO and Steel Ball Run form one group without changing Bangumi titles',()=>{
  const items=[
    {id:43558,title:'JOJO的奇妙冒险',date:'2012-10-05',addedAt:'2026-10-18T01:00:00Z'},
    {id:99,title:'其他作品',date:'2020-01-01',addedAt:'2026-10-18T02:00:00Z'},
    {id:551918,title:'飙马野郎 JOJO的奇妙冒险 第一赛段',date:'2026-01-01',addedAt:'2026-10-18T03:00:00Z'},
  ];
  const result=normalizeLibrary(items);
  assert.deepEqual(result.map(x=>x.title),items.map(x=>x.title));
  assert.deepEqual(sortByAdded([...result],'asc').map(x=>x.id),[99,43558,551918]);
  assert.deepEqual(sortByAdded([...result],'desc').map(x=>x.id),[551918,43558,99]);
  assert.equal(result[2].seriesId,43558);
  assert.equal(result[0].addedAt,result[2].addedAt);
  assert.deepEqual(normalizeLibrary(result),result);
});

test('a new addition sorts first even when imported entries are ahead of the device clock',()=>{
  const imported=[{id:1,addedAt:'2026-10-18T08:09:28.000Z'}];
  const addedAt=nextAddedAt(imported,Date.parse('2026-10-18T07:09:04.233Z'));
  const entries=[...imported,{id:2,addedAt},{id:3,seriesId:2,seriesOrder:2,addedAt}];
  assert.equal(addedAt,'2026-10-18T08:09:28.001Z');
  assert.deepEqual(sortByAdded([...entries]).map(x=>x.id),[3,2,1]);
  assert.deepEqual(sortByAdded([...entries],'asc').map(x=>x.id),[1,2,3]);
});

test('normal additions retain the current time and tolerate missing timestamps',()=>{
  const now=Date.parse('2026-10-18T10:00:00Z');
  assert.equal(nextAddedAt([{addedAt:'invalid'}],now),'2026-10-18T10:00:00.000Z');
  assert.equal(nextAddedAt([],now),'2026-10-18T10:00:00.000Z');
});
