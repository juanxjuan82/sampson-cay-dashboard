import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
test('Cloudflare runtime collects once, preserves raw capture, tags and reports partial failures',async()=>{
 let revision='First consultation account';
 const html=()=>`<html><head><title>Sampson Cay report</title><meta property="article:published_time" content="2026-09-28T12:00:00Z"></head><body><nav>irrelevant navigation</nav><main><h1>Yntegra at Sampson Cay</h1><p>${revision}. Solar farm, salami slicing, and mangrove consultation form this attributed report. ${'Additional factual source material. '.repeat(12)}</p></main><script>unsafe()</script></body></html>`;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:[{type:'ESModule',path:'src/index.js',contents:readFileSync(new URL('../src/index.js',import.meta.url),'utf8')},...['index.js','collector.js','rules.js'].map(name=>({type:'ESModule',path:'src/monitor/'+name,contents:readFileSync(new URL('../src/monitor/'+name,import.meta.url),'utf8')}))],compatibilityDate:'2026-10-01',d1Databases:['DB'],bindings:{DASHBOARD_AI_TOKEN:'editor',MONITOR_CLIENT_TOKEN:'client'},outboundService:async request=>{
 const url=new URL(request.url);
 if(url.pathname==='/robots.txt')return new Response('User-agent: *\nAllow: /');
 if(url.hostname==='ewnews.com')return new Response('Unavailable',{status:503});
 return new Response(html(),{headers:{'Content-Type':'text/html'}});
 }}));
 try{
 const {DB}=await mf.getBindings();
 await DB.exec(readFileSync(new URL('../migrations/0001_monitor.sql',import.meta.url),'utf8').replace(/\n/g,' '));
 const call=(path,method='GET')=>mf.dispatchFetch('https://monitor.example'+path,{method,headers:{Authorization:'Bearer editor'}});
 let r=await (await call('/refresh','POST')).json();assert.equal(r.newItems,3);assert.equal(r.failures.length,1);
 let feed=await (await call('/feed')).json();assert.equal(feed.items.length,3);assert.ok(feed.items[0].tags.some(t=>t.theme==='Solar farm'));assert.equal(feed.sources.find(s=>s.id==='ewn').error,'HTTP 503');
 const item=await DB.prepare('SELECT * FROM items LIMIT 1').first();assert.ok(!item.text.includes('unsafe'));assert.ok(!item.text.includes('irrelevant navigation'));assert.equal(item.published_at,'2026-09-28T12:00:00.000Z');
 assert.ok((await DB.prepare('SELECT raw_html FROM captures LIMIT 1').first()).raw_html.includes('unsafe()'));
 r=await (await call('/refresh','POST')).json();assert.equal(r.busy,true);
 await DB.prepare('UPDATE locks SET expires_at=0').run();r=await (await call('/refresh','POST')).json();assert.equal(r.newItems,0);assert.equal(r.changedItems,0);
 revision='Updated consultation account';await DB.prepare('UPDATE locks SET expires_at=0').run();r=await (await call('/refresh','POST')).json();assert.equal(r.changedItems,3);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM captures').first()).n,6);
 }finally{await mf.dispose();}
});
