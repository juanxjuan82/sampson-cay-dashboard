import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {collect} from '../src/monitor/collector.js';
test('lease renews across requests; a displaced collector cannot release its successor',async()=>{
 const sql=new DatabaseSync(':memory:');
 for(const file of ['0001_monitor.sql','0002_item_collection_status.sql','0003_discovery_attempts.sql','0004_collection_lock_owner.sql','0005_redirect_history.sql'])sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const DB={prepare(query){const stmt=sql.prepare(query);let params=[];return {bind(...p){params=p;return this;},async run(){return {meta:{changes:Number(stmt.run(...params).changes)}};},async all(){return {results:stmt.all(...params)};}};}};
 const original=globalThis.fetch;let mode='renew',calls=0;let successorLease;
 globalThis.fetch=async()=>{
  calls++;
  const lock=sql.prepare("SELECT * FROM locks WHERE id='collect'").get();
  assert.ok(lock.expires_at>Date.now());
  if(mode==='renew')sql.prepare("UPDATE locks SET expires_at=1 WHERE id='collect'").run();
  else {successorLease=Date.now()+900000;sql.prepare("UPDATE locks SET owner='successor',expires_at=? WHERE id='collect'").run(successorLease);}
  return new Response('Failed',{status:503});
 };
 try {
  await collect({DB});assert.equal(calls,4);
  assert.equal(sql.prepare("SELECT owner FROM locks WHERE id='collect'").get().owner,null);
  sql.prepare("UPDATE locks SET expires_at=0").run();mode='displace';
  await assert.rejects(()=>collect({DB}),/Collection lock lost/);
  const lock=sql.prepare("SELECT * FROM locks WHERE id='collect'").get();assert.equal(lock.owner,'successor');assert.equal(lock.expires_at,successorLease);
  assert.equal((await collect({DB})).busy,true);
 }finally{globalThis.fetch=original;sql.close();}
});
