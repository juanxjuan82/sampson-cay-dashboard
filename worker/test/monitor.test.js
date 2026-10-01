import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{roleFor} from '../src/monitor/index.js';
import {classify,canonical,canPublish} from '../src/monitor/rules.js';
import {boundedFetch,robotsAllowed,allowed,SOURCES,discoveryMatch} from '../src/monitor/collector.js';
const id='a'.repeat(64);
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001_monitor.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../migrations/0002_item_collection_status.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../migrations/0003_discovery_attempts.sql',import.meta.url),'utf8'));
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
 sql.prepare("UPDATE items SET review_status='reviewed' WHERE id=?").run(id);
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
 assert.equal(canPublish({draft:'x',edited:1,version:1,basis_hash:'old'},1,'new','reviewed'),false);
});
test('AI generation stays private, requires editing, and rejects stale requests', async()=>{
 const {env,sql}=setup();env.OPENAI_API_KEY='test-key';env.OPENAI_MODEL='test-model';
 const originalFetch=globalThis.fetch;let calls=0;const path='/editor/items/'+id;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');const payload=JSON.parse(options.body);assert.equal(payload.model,'test-model');assert.equal(payload.store,false);return Response.json({status:'completed',output:[{content:[{type:'output_text',text:'Private AI words'}]}]});};
 try {
  assert.equal((await call(env,path+'/analyse','POST',{version:0})).status,200);
  let feed=await (await call(env,'/feed','GET',null,'client-secret')).json();assert.equal(feed.items[0].recommendation,null);assert.ok(!JSON.stringify(feed).includes('Private AI words'));
  await call(env,path+'/review','POST',{status:'reviewed',basisHash:'hash1'});
  assert.equal((await call(env,path+'/publish','POST',{version:1})).status,409);
  await call(env,path+'/draft','PUT',{text:'My edited recommendation',version:1,basisHash:'hash1'});
  assert.equal((await call(env,path+'/publish','POST',{version:2})).status,200);
  assert.equal((await call(env,path+'/analyse','POST',{version:1,replace:true})).status,409);assert.equal(calls,1);
  assert.equal((await call(env,path+'/analyse','POST',{version:2})).status,409);assert.equal(calls,1);
  assert.equal((await call(env,path+'/analyse','POST',{version:2,replace:true})).status,200);
  feed=await (await call(env,'/feed','GET',null,'client-secret')).json();assert.equal(feed.items[0].recommendation,'My edited recommendation');
  globalThis.fetch=async()=>{sql.prepare("UPDATE items SET content_hash='hash2' WHERE id=?").run(id);return Response.json({status:'completed',output:[{content:[{type:'output_text',text:'Stale AI draft'}]}]});};
  assert.equal((await call(env,path+'/analyse','POST',{version:3,replace:true})).status,409);
  assert.equal(sql.prepare('SELECT draft FROM recommendations WHERE item_id=?').get(id).draft,'Private AI words');
 } finally {globalThis.fetch=originalFetch;}
});


test('feed preserves independent source and advisor publication timestamps',async()=>{
 const {env,sql}=setup();
 sql.prepare('UPDATE items SET published_at=? WHERE id=?').run('2026-09-28T12:00:00.000Z',id);
 let feed=await (await call(env,'/feed','GET',null,'client-secret')).json();
 assert.equal(feed.items[0].source_published_at,'2026-09-28T12:00:00.000Z');assert.equal(feed.items[0].recommendation_published_at,null);
 sql.prepare('INSERT INTO recommendations(item_id,published,published_at) VALUES(?,?,?)').run(id,'Published advisor response','2026-10-01T16:00:00.000Z');
 feed=await (await call(env,'/feed','GET',null,'client-secret')).json();
 assert.equal(feed.items[0].source_published_at,'2026-09-28T12:00:00.000Z');assert.equal(feed.items[0].recommendation_published_at,'2026-10-01T16:00:00.000Z');
});

test('publishing requires review of the current source, including after unchanged advice is resaved',async()=>{
 const {env,sql}=setup();
 const path='/editor/items/'+id;
 assert.equal((await call(env,path+'/draft','PUT',{text:'Manual recommendation',version:0,basisHash:'hash1'})).status,200);
 assert.equal((await call(env,path+'/publish','POST',{version:1})).status,409);
 assert.equal((await call(env,path+'/review','POST',{status:'counsel',basisHash:'hash1'})).status,200);
 assert.equal((await call(env,path+'/publish','POST',{version:1})).status,409);
 assert.equal((await call(env,path+'/review','POST',{status:'reviewed',basisHash:'hash1'})).status,200);
 assert.equal((await call(env,path+'/publish','POST',{version:1})).status,200);
 sql.prepare("UPDATE items SET content_hash='hash2',review_status='unreviewed' WHERE id=?").run(id);
 assert.equal((await call(env,path+'/draft','PUT',{text:'Manual recommendation',version:1,basisHash:'hash2'})).status,200);
 assert.equal((await call(env,path+'/publish','POST',{version:2})).status,409);
 assert.equal((await call(env,path+'/review','POST',{status:'reviewed',basisHash:'hash1'})).status,409);
 assert.equal((await call(env,path+'/review','POST',{status:'reviewed',basisHash:'hash2'})).status,200);
 assert.equal((await call(env,path+'/publish','POST',{version:2})).status,200);
 // Invalidate review after the handler has read the source, before the publication write.
 const prepare=env.DB.prepare.bind(env.DB);
 env.DB.prepare=query=>{const statement=prepare(query);if(query.startsWith('UPDATE recommendations SET published=draft')) {const run=statement.run.bind(statement);statement.run=async()=>{sql.prepare("UPDATE items SET review_status='unreviewed' WHERE id=?").run(id);return run();};}return statement;};
 assert.equal((await call(env,path+'/publish','POST',{version:2})).status,409);
});
test('feed pagination retrieves all 601 tied-date items and preserves access to older advice',async()=>{
 const {env,sql}=setup();
 const insert=sql.prepare('INSERT INTO items(id,source_id,url,title,first_seen,changed_at,last_seen,content_hash,text,tags) VALUES(?,?,?,?,?,?,?,?,?,?)');
 for(let i=0;i<600;i++)insert.run(i.toString(16).padStart(64,'0'),'turtlegrass','https://www.turtlegrassresort.com/blog/'+i,'Sampson Cay '+i,'2026-10-01','2026-10-01','2026-10-01','hash','source','[]');
 const oldest='0'.repeat(64);
 sql.prepare('INSERT INTO recommendations(item_id,published,published_at) VALUES(?,?,?)').run(oldest,'Older published advice','2026-09-29');
 for(const token of ['client-secret','editor-secret']) {
  const items=[];let cursor=null,pages=0;
  do {const path='/feed'+(cursor?'?cursor='+encodeURIComponent(JSON.stringify(cursor)):'');const response=await call(env,path,'GET',null,token);assert.equal(response.status,200);const feed=await response.json();assert.ok(feed.items.length<=100);items.push(...feed.items);cursor=feed.nextCursor;pages++;}while(cursor);
  assert.equal(items.length,601);assert.equal(new Set(items.map(i=>i.id)).size,601);assert.equal(pages,7);assert.equal(items.at(-1).recommendation,'Older published advice');
 }
 assert.equal((await call(env,'/editor/items/'+oldest)).status,200);
 assert.equal((await call(env,'/editor/items/'+oldest+'/unpublish','POST')).status,200);
 assert.equal((await call(env,'/feed?cursor=invalid')).status,400);
});

test('discovery ignores publisher hosts and malformed encoding',()=>{assert.equal(discoveryMatch('https://www.turtlegrassresort.com/blog/general-travel'),false);assert.equal(discoveryMatch('https://www.turtlegrassresort.com/blog/sampson-cay-report'),true);assert.equal(discoveryMatch('https://www.turtlegrassresort.com/blog/sampson-cay-%E0%A4%A'),false);});
