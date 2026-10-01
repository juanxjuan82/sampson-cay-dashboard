import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{roleFor} from '../src/monitor/index.js';
import {classify,canonical,canPublish} from '../src/monitor/rules.js';
import {boundedFetch,robotsAllowed,allowed,SOURCES} from '../src/monitor/collector.js';
const id='a'.repeat(64);
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001_monitor.sql',import.meta.url),'utf8'));
 const DB={prepare(query){let params=[];const stmt=sql.prepare(query);return {bind(...values){params=values;return this;},async first(){return stmt.get(...params)||null;},async all(){return {results:stmt.all(...params)};},async run(){const r=stmt.run(...params);return {meta:{changes:Number(r.changes)}};}};},async batch(statements){return Promise.all(statements.map(s=>s.run()));}};
 sql.prepare('INSERT INTO sources(id,label,url) VALUES(?,?,?)').run('turtlegrass','Turtlegrass','https://www.turtlegrassresort.com/');
 sql.prepare('INSERT INTO items(id,source_id,url,title,first_seen,changed_at,last_seen,content_hash,text,tags) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'turtlegrass','https://www.turtlegrassresort.com/blog/example','Sampson Cay consultation','2026-10-01','2026-10-01','2026-10-01','hash1','Original source statement','[]');
 return {sql,env:{DB,EDITOR_TOKEN:'editor-secret',CLIENT_TOKEN:'client-secret',ALLOWED_ORIGINS:'https://example.com'}};
}
const req=(path,token='editor-secret',method='GET',body)=>new Request('https://monitor.example'+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
const call=(env,path,method='GET',body,token='editor-secret')=>worker.fetch(req(path,token,method,body),env);
test('project qualification, exact phrase tags, punctuation variants and URL normalization',()=>{
 assert.deepEqual(classify('A solar farm somewhere else'),[]);
 assert.equal(classify('Sampson Cay: salami–slicing claims')[0].theme,'Solar farm');
 assert.deepEqual(classify('Yntegra has ideal ideas'),[]);
 assert.equal(canonical('https://ewnews.com/story/?utm_source=x#comments'),'https://ewnews.com/story/');
 assert.equal(canonical('javascript:alert(1)'),null);
});
test('robots longest rule, wildcard and source boundary',()=>{
 assert.equal(robotsAllowed('User-agent: *\nDisallow: /blog\nAllow: /blog/public','/blog/private'),false);
 assert.equal(robotsAllowed('User-agent: *\nDisallow: /blog\nAllow: /blog/public','/blog/public/a'),true);
 assert.equal(robotsAllowed('User-agent: *\nDisallow: /*?','/article?private'),false);
 assert.equal(allowed('https://evil.example/blog/a',SOURCES[0]),false);
});
test('fetch rejects cross-host redirect and oversized capture',async()=>{
 await assert.rejects(()=>boundedFetch('https://ewnews.com/',async()=>new Response('',{status:302,headers:{Location:'https://evil.example/'}})),/outside/);
 await assert.rejects(()=>boundedFetch('https://ewnews.com/',async()=>new Response('x'.repeat(1_000_001))),/limit/);
});
test('client cannot access editorial routes; missing/equal tokens fail closed',async()=>{
 const {env}=setup();
 for(const action of ['','/draft','/analyse','/publish','/captures']) assert.equal((await call(env,'/editor/items/'+id+action,'GET',null,'client-secret')).status,403);
 assert.equal(roleFor(req('/feed',''),env),null);
 assert.equal(roleFor(req('/feed','same'),{EDITOR_TOKEN:'same',CLIENT_TOKEN:'same'}),null);
});
test('human edit gate; only published snapshot enters client feed; revisions remain private',async()=>{
 const {env,sql}=setup();
 sql.prepare('INSERT INTO recommendations(item_id,ai_text,draft,version,edited,basis_hash) VALUES(?,?,?,?,?,?)').run(id,'Private AI words','Private AI words',1,0,'hash1');
 assert.equal((await call(env,'/editor/items/'+id+'/publish','POST',{version:1})).status,409);
 assert.equal((await call(env,'/editor/items/'+id+'/draft','PUT',{text:'Private AI words',version:1,basisHash:'hash1'})).status,200);
 assert.equal((await call(env,'/editor/items/'+id+'/publish','POST',{version:2})).status,409);
 assert.equal((await call(env,'/editor/items/'+id+'/draft','PUT',{text:'Edited recommendation for client',version:2,basisHash:'hash1'})).status,200);
 let feed=await (await call(env,'/feed','GET',null,'client-secret')).json();
 assert.equal(feed.items[0].recommendation,null);assert.ok(!JSON.stringify(feed).includes('Private AI words'));assert.ok(!Object.keys(feed.items[0]).includes('draft'));
 assert.equal((await call(env,'/editor/items/'+id+'/publish','POST',{version:3})).status,200);
 assert.equal((await call(env,'/editor/items/'+id+'/draft','PUT',{text:'New private revision',version:3,basisHash:'hash1'})).status,200);
 feed=await (await call(env,'/feed','GET',null,'client-secret')).json();assert.equal(feed.items[0].recommendation,'Edited recommendation for client');assert.ok(!JSON.stringify(feed).includes('New private revision'));
 assert.equal((await call(env,'/editor/items/'+id+'/publish','POST',{version:3})).status,409);
 sql.prepare('UPDATE items SET content_hash=? WHERE id=?').run('hash2',id);
 assert.equal((await call(env,'/editor/items/'+id+'/publish','POST',{version:4})).status,409);
 assert.equal((await call(env,'/editor/items/'+id+'/unpublish','POST')).status,200);
 feed=await (await call(env,'/feed','GET',null,'client-secret')).json();assert.equal(feed.items[0].recommendation,null);
});
test('CORS, stale editor saves and unconfigured AI preserve draft',async()=>{
 const {env}=setup();
 assert.equal((await worker.fetch(new Request('https://m/feed',{headers:{Origin:'https://evil.example',Authorization:'Bearer editor-secret'}}),env)).status,403);
 assert.equal((await call(env,'/editor/items/'+id+'/draft','PUT',{text:'Manual recommendation',version:0,basisHash:'hash1'})).status,200);
 assert.equal((await call(env,'/editor/items/'+id+'/draft','PUT',{text:'Overwrite',version:0,basisHash:'hash1'})).status,409);
 assert.equal((await call(env,'/editor/items/'+id+'/analyse','POST',{version:1})).status,503);
 assert.equal(canPublish({draft:'x',edited:1,version:1,basis_hash:'old'},1,'new'),false);
});
test('AI drafting stays disabled even when API credentials exist', async()=>{
 const {env}=setup();env.OPENAI_API_KEY='test-key';env.OPENAI_MODEL='test-model';
 assert.equal((await call(env,'/editor/items/'+id+'/analyse','POST',{version:0})).status,503);
 const feed=await (await call(env,'/feed','GET',null,'client-secret')).json();
 assert.equal(feed.items[0].recommendation,null);
});
