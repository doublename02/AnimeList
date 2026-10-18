import test from 'node:test';
import assert from 'node:assert/strict';
import { nextAddedAt } from '../library.mjs';
import { sortByAdded } from '../series.mjs';

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
