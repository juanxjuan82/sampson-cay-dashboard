import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
test('Cloudflare runtime collects once, preserves raw capture, tags and reports partial failures',async()=>{
 let revision='First consultation account', linkPresent=true, articleMissing=false, landingMissing=false, redirectTarget=null, includePublished=true;
 const articleURL='https://www.turtlegrassresort.com/blog/sampson-cay-review';
 const html=()=>`<html><head><title>Sampson Cay report</title>${includePublished?'<meta property="article:published_time" content="2026-09-28T12:00:00Z">':''}</head><body><nav>irrelevant navigation</nav><main><h1>Yntegra at Sampson Cay</h1><p>${revision}. Solar farm, salami slicing, and mangrove consultation form this attributed report. ${'Additional factual source material. '.repeat(12)}</p></main><script>unsafe()</script></body></html>`;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:[{type:'ESModule',path:'src/index.js',contents:readFileSync(new URL('../src/index.js',import.meta.url),'utf8')},...['index.js','collector.js','rules.js'].map(name=>({type:'ESModule',path:'src/monitor/'+name,contents:readFileSync(new URL('../src/monitor/'+name,import.meta.url),'utf8')}))],compatibilityDate:'2026-10-01',d1Databases:['DB'],bindings:{MONITOR_EDITOR_TOKEN:'editor',MONITOR_CLIENT_TOKEN:'client'},outboundService:async request=>{
 const url=new URL(request.url);
 if(url.pathname==='/robots.txt')return new Response('User-agent: *\nAllow: /');
 if(url.hostname==='ewnews.com')return new Response('Unavailable',{status:503});
 if(url.pathname==='/defending-sampson-cay' && landingMissing)return new Response('Landing missing',{status:503});
 if(redirectTarget && (url.href===articleURL || url.pathname==='/blog/sampson-cay-duplicate'))return new Response(null,{status:301,headers:{Location:redirectTarget}});
 if(url.href===articleURL && articleMissing)return new Response('Not found',{status:404});
 const raw=html().replace('</main>',linkPresent && url.hostname==='www.turtlegrassresort.com' && url.href!==articleURL?'<a href="/blog/sampson-cay-review">Sampson Cay report</a></main>':'</main>');
 return new Response(raw,{headers:{'Content-Type':'text/html'}});
 }}));
 try{
 const {DB}=await mf.getBindings();
 await DB.exec(readFileSync(new URL('../migrations/0001_monitor.sql',import.meta.url),'utf8').replace(/\n/g,' '));
 await DB.exec(readFileSync(new URL('../migrations/0002_item_collection_status.sql',import.meta.url),'utf8').replace(/\n/g,' '));
 await DB.exec(readFileSync(new URL('../migrations/0003_discovery_attempts.sql',import.meta.url),'utf8').replace(/\n/g,' '));
 await DB.exec(readFileSync(new URL('../migrations/0004_collection_lock_owner.sql',import.meta.url),'utf8').replace(/\n/g,' '));
 await DB.exec(readFileSync(new URL('../migrations/0005_redirect_history.sql',import.meta.url),'utf8').replace(/\n/g,' '));
 const call=(path,method='GET')=>mf.dispatchFetch('https://monitor.example'+path,{method,headers:{Authorization:'Bearer editor'}});
 let r=await (await call('/refresh','POST')).json();assert.equal(r.newItems,4);assert.equal(r.failures.length,1);
 const firstRun=JSON.parse((await DB.prepare("SELECT detail FROM audit WHERE action='collection_run' ORDER BY id DESC LIMIT 1").first()).detail);assert.deepEqual(firstRun,{successfulSources:3,totalSources:4});
 let feed=await (await call('/feed')).json();assert.equal(feed.items.length,4);assert.ok(feed.items[0].tags.some(t=>t.theme==='Solar farm'));assert.equal(feed.sources.find(s=>s.id==='ewn').error,'1 page(s) could not be collected');
 const item=await DB.prepare('SELECT * FROM items LIMIT 1').first();assert.ok(!item.text.includes('unsafe'));assert.ok(!item.text.includes('irrelevant navigation'));assert.equal(item.published_at,'2026-09-28T12:00:00.000Z');
 assert.ok((await DB.prepare('SELECT raw_html FROM captures LIMIT 1').first()).raw_html.includes('unsafe()'));
 r=await (await call('/refresh','POST')).json();assert.equal(r.busy,true);
 includePublished=false;await DB.prepare('UPDATE locks SET expires_at=0').run();r=await (await call('/refresh','POST')).json();assert.equal(r.newItems,0);assert.equal(r.changedItems,0);
 assert.equal((await DB.prepare('SELECT published_at FROM items LIMIT 1').first()).published_at,'2026-09-28T12:00:00.000Z');
 const metadataCaptureCount=(await DB.prepare('SELECT COUNT(*) AS n FROM captures').first()).n;
 await DB.prepare("UPDATE items SET review_status='reviewed'").run();
 linkPresent=false;revision='Updated consultation account';await DB.prepare('UPDATE locks SET expires_at=0').run();r=await (await call('/refresh','POST')).json();assert.equal(r.changedItems,4);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM captures').first()).n,metadataCaptureCount+4);
 const changedArticle=await DB.prepare('SELECT * FROM items WHERE url=?').bind(articleURL).first();assert.ok(changedArticle.text.includes('Updated consultation account'));assert.equal(changedArticle.review_status,'unreviewed');
 await DB.prepare("UPDATE items SET review_status='reviewed'").run();
 await DB.prepare('UPDATE locks SET expires_at=0').run();await call('/refresh','POST');
 assert.equal((await DB.prepare('SELECT review_status FROM items WHERE url=?').bind(articleURL).first()).review_status,'reviewed');
 articleMissing=true;await DB.prepare('UPDATE locks SET expires_at=0').run();await call('/refresh','POST');
 const missing=await DB.prepare('SELECT * FROM items WHERE url=?').bind(articleURL).first();assert.equal(missing.collection_error,'HTTP 404');assert.equal(missing.content_hash,changedArticle.content_hash);

 const prior=await DB.prepare('SELECT id FROM items WHERE url=?').bind(articleURL).first();
 await DB.prepare('INSERT INTO recommendations(item_id,published,published_at,published_hash) VALUES(?,?,?,?)').bind(prior.id,'Prior URL advice',new Date().toISOString(),changedArticle.content_hash).run();
 const priorCaptures=(await DB.prepare('SELECT COUNT(*) AS n FROM captures WHERE item_id=?').bind(prior.id).first()).n;
 articleMissing=false;redirectTarget='https://www.turtlegrassresort.com/blog/sampson-cay-moved';
 await DB.prepare('UPDATE locks SET expires_at=0').run();await call('/refresh','POST');
 const destination=await DB.prepare('SELECT id FROM items WHERE url=?').bind(redirectTarget).first();assert.ok(destination);
 assert.equal((await DB.prepare('SELECT superseded_by FROM items WHERE id=?').bind(prior.id).first()).superseded_by,destination.id);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM captures WHERE item_id=?').bind(prior.id).first()).n,priorCaptures);
 feed=await (await call('/feed')).json();assert.ok(!feed.items.some(item=>item.id===prior.id));assert.equal(feed.items.find(item=>item.id===destination.id).recommendation,null);
 const history=await (await call('/editor/items/'+destination.id)).json();assert.equal(history.redirectHistory[0].id,prior.id);
 assert.equal((await DB.prepare('SELECT published FROM recommendations WHERE item_id=?').bind(prior.id).first()).published,'Prior URL advice');
 assert.equal((await mf.dispatchFetch('https://monitor.example/editor/items/'+prior.id+'/analyse',{method:'POST',headers:{Authorization:'Bearer editor'}})).status,409);
 // When the redirected destination already exists, the alias must also retire.
 const alias='b'.repeat(64);
 await DB.prepare('INSERT INTO items(id,source_id,url,title,first_seen,changed_at,last_seen,content_hash,text,tags) SELECT ?,source_id,?,title,first_seen,changed_at,last_seen,content_hash,text,tags FROM items WHERE id=?').bind(alias,'https://www.turtlegrassresort.com/blog/sampson-cay-duplicate',destination.id).run();
 await DB.prepare('UPDATE locks SET expires_at=0').run();await call('/refresh','POST');
 assert.equal((await DB.prepare('SELECT superseded_by FROM items WHERE id=?').bind(alias).first()).superseded_by,destination.id);
 feed=await (await call('/feed')).json();assert.ok(!feed.items.some(item=>item.id===alias));assert.equal(feed.items.filter(item=>item.url===redirectTarget).length,1);
 landingMissing=true;await DB.prepare('UPDATE locks SET expires_at=0').run();await call('/refresh','POST');
 const missingLanding=await DB.prepare('SELECT collection_error,checked_at FROM items WHERE url=?').bind('https://www.turtlegrassresort.com/defending-sampson-cay').first();assert.equal(missingLanding.collection_error,'HTTP 503');assert.ok(missingLanding.checked_at);
 }finally{await mf.dispose();}
});

test('rejected and failed candidates rotate so later valid links are discovered',async()=>{
 const links=['ordinary-travel-one','ordinary-travel-two','ordinary-travel-three','sampson-cay-%E0%A4%A','sampson-cay-category','sampson-cay-short','sampson-cay-missing','sampson-cay-valid'];
 const attempted=[];
 const mf=new Miniflare(convertV4MiniflareOptions({modules:[{type:'ESModule',path:'src/index.js',contents:readFileSync(new URL('../src/index.js',import.meta.url),'utf8')},...['index.js','collector.js','rules.js'].map(name=>({type:'ESModule',path:'src/monitor/'+name,contents:readFileSync(new URL('../src/monitor/'+name,import.meta.url),'utf8')}))],compatibilityDate:'2026-10-01',d1Databases:['DB'],bindings:{MONITOR_EDITOR_TOKEN:'editor',MONITOR_CLIENT_TOKEN:'client'},outboundService:async request=>{
  const url=new URL(request.url);
  if(url.pathname==='/robots.txt')return new Response('User-agent: *\nAllow: /');
  if(url.hostname!=='www.turtlegrassresort.com')return new Response('Unavailable',{status:503});
  let content='';
  if(url.pathname==='/defending-sampson-cay')content=links.map(slug=>`<a href="/blog/${slug}">Read article</a>`).join('');
  else {
   attempted.push(url.pathname);
   if(url.pathname.endsWith('old-slug'))return new Response(null,{status:301,headers:{Location:'/blog/sampson-cay-valid'}});
   if(url.pathname.endsWith('-missing'))return new Response('Missing',{status:404});
   content=url.pathname.endsWith('-valid')?'Sampson Cay consultation. '+ 'Detailed public source information. '.repeat(10):url.pathname.endsWith('-short')?'Sampson Cay':'Generic unrelated article. '.repeat(10);
  }
  return new Response(`<html><head><title>Public news</title></head><body><main>${content}</main></body></html>`,{headers:{'Content-Type':'text/html'}});
 }}));
 try {
  const {DB}=await mf.getBindings();
  for(const migration of ['0001_monitor.sql','0002_item_collection_status.sql','0003_discovery_attempts.sql','0004_collection_lock_owner.sql','0005_redirect_history.sql'])await DB.exec(readFileSync(new URL('../migrations/'+migration,import.meta.url),'utf8').replace(/\n/g,' '));
  const call=()=>mf.dispatchFetch('https://monitor.example/refresh',{method:'POST',headers:{Authorization:'Bearer editor'}});
  assert.equal((await call()).status,200);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM items').first()).n,0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM discovery_attempts').first()).n,3);
  assert.ok(!attempted.includes('/blog/sampson-cay-valid'));
  await DB.prepare('UPDATE locks SET expires_at=0').run();assert.equal((await call()).status,200);
  assert.ok(attempted.includes('/blog/sampson-cay-valid'));
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM items WHERE url LIKE '%sampson-cay-valid'").first()).n,1);
  const rejection=await DB.prepare("SELECT outcome FROM discovery_attempts WHERE url LIKE '%sampson-cay-category'").first();assert.equal(rejection.outcome,'not_relevant');assert.ok(!attempted.some(path=>path.includes('ordinary-travel')));
 links.splice(0,links.length,'sampson-cay-valid','sampson-cay-old-slug');
 await DB.prepare('UPDATE locks SET expires_at=0').run();assert.equal((await call()).status,200);
 assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM items WHERE source_id='turtlegrass'").first()).n,1);
 }finally {await mf.dispose();}
});
