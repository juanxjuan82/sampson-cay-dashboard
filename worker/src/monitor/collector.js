import {canonical, classify, criticismThemes, PROJECT, normalize} from './rules.js';
export const SOURCES = [
  {id:'turtlegrass', label:'Turtlegrass · campaign & blog', url:'https://www.turtlegrassresort.com/defending-sampson-cay', host:'www.turtlegrassresort.com', path:/^\/(blog\/[^/]+\/?|defending-sampson-cay\/?)/},
  {id:'tribune', label:'The Tribune · Business', url:'https://www.tribune242.com/news/business/', host:'www.tribune242.com', path:/^\/news\/\d{4}\//},
  {id:'ewn', label:'Eye Witness News', url:'https://ewnews.com/', host:'ewnews.com', path:/^\/[a-z0-9-]+\/$/},
  {id:'project', label:'Sampson Cay Project · official website', url:'https://www.sampsoncayproject.com/', host:'www.sampsoncayproject.com', path:/^\//}
];
export const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
export function allowed(url, source) {
  const u = new URL(url);
  return u.protocol === 'https:' && u.hostname === source.host && !u.port && source.path.test(u.pathname);
}
export function discoveryMatch(url) {
  try {
    const parsed=new URL(url);
    const path=normalize(decodeURIComponent(parsed.pathname+parsed.search)).replaceAll('-',' ');
    return PROJECT.some(term=>path.includes(term));
  } catch { return false; }
}
export async function boundedFetch(url, fetcher=fetch, host=new URL(url).hostname, guard=()=>true) {
  for (let redirects=0; redirects<4; redirects++) {
    const u = new URL(url);
    if (!guard(u) || u.protocol !== 'https:' || u.hostname !== host || u.port) throw Error('Redirect outside source host');
    const r = await fetcher(url, {redirect:'manual', signal:AbortSignal.timeout(15000), headers:{'User-Agent':'SampsonMonitor/1.0 (+public-source-monitoring)'}});
    if ([301,302,303,307,308].includes(r.status)) { url=new URL(r.headers.get('location'),url).href; continue; }
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    const reader=r.body.getReader(); let size=0; const chunks=[];
    while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>1_000_000){await reader.cancel(); throw Error('Page exceeds capture limit');} chunks.push(value); }
    const bytes=new Uint8Array(size); let offset=0; for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    return {raw:new TextDecoder().decode(bytes), type:r.headers.get('content-type')||'', url};
  }
  throw Error('Too many redirects');
}
// Match longest applicable robots rule. If robots cannot be checked, fail closed.
export function robotsAllowed(raw, pathname) {
  let group=null; const groups=[];
  for(const line of raw.split(/\r?\n/)) {
    const match=line.split('#')[0].trim().match(/^([\w-]+)\s*:\s*(.*)$/); if(!match) continue;
    const key=match[1].toLowerCase(), value=match[2].trim();
    if(key==='user-agent') { if(!group || group.rules.length) {group={agents:[],rules:[]};groups.push(group);} group.agents.push(value.toLowerCase()); }
    else if(group && ['allow','disallow'].includes(key) && value) group.rules.push({allow:key==='allow',value});
  }
  const specific=groups.filter(g=>g.agents.some(a=>a!=='*' && 'sampsonmonitor'.includes(a)));
  const selected=specific.length?specific:groups.filter(g=>g.agents.includes('*'));
  const rules=selected.flatMap(g=>g.rules).filter(r=>{
    const expression=r.value.replace(/[.+?^{}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');
    return new RegExp('^'+expression).test(pathname);
  }).sort((a,b)=>b.value.length-a.value.length || Number(b.allow)-Number(a.allow));
  return rules.length ? rules[0].allow : true;
}
export async function extract(raw, url) {
  const text=[], title=[], links=[]; let published=null; let excluded=0;
  const rewrite=new HTMLRewriter()
    .on('script,style,nav,header,footer,aside,form,noscript', {element(e){excluded++;e.onEndTag(()=>{excluded--;});e.remove();}})
    .on('title', {text(t){title.push(t.text);}})
    .on('meta[property="article:published_time"],meta[name="date"]', {element(e){published=e.getAttribute('content');}})
    .on('a[href]', {element(e){const link=canonical(e.getAttribute('href'),url);if(link) links.push(link);}})
    .on('p,h1,h2,h3,h4,li,div,br', {element(e){if(!excluded) text.push(' ');}})
    .on('body', {text(t){if(!excluded) text.push(t.text);}});
  await rewrite.transform(new Response(raw,{headers:{'Content-Type':'text/html'}})).text();
  const clean=text.join('').replace(/\s+/g,' ').trim();
  const date=published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : null;
  return {text:clean,title:title.join('').trim()||url,published:date,links:[...new Set(links)]};
}
export async function collect(env) {
  if(!env.DB) throw Error('Monitor database not configured');
  const now=Date.now(), owner=crypto.randomUUID();
  const lock=await env.DB.prepare("INSERT INTO locks(id,expires_at,owner) VALUES('collect',?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at,owner=excluded.owner WHERE locks.expires_at<?").bind(now+600000,owner,now).run();
  if(!lock.meta.changes) return {busy:true,newItems:0,changedItems:0,failures:[]};
  const renew=async()=>{
    const renewed=await env.DB.prepare("UPDATE locks SET expires_at=? WHERE id='collect' AND owner=?").bind(Date.now()+600000,owner).run();
    if(!renewed.meta.changes) throw Error('Collection lock lost');
  };
  const fetchWithLease=async(...args)=>{await renew();return fetch(...args);};
  const result={busy:false,newItems:0,changedItems:0,failures:[]};
  let successfulSources=0;
  try {
    for(const source of SOURCES) {
      const at=new Date().toISOString();
      await env.DB.prepare('INSERT OR IGNORE INTO sources(id,label,url) VALUES(?,?,?)').bind(source.id,source.label,source.url).run();
      try {
        let robots='';
        const robotsUrl=new URL('/robots.txt',source.url).href;
        try { robots=(await boundedFetch(robotsUrl,fetchWithLease)).raw; } catch(e) { if(e.message!=='HTTP 404') throw e; }
        if(!robotsAllowed(robots,new URL(source.url).pathname+new URL(source.url).search)) throw Error('Collection disallowed by robots.txt');
        const guard=u=>robotsAllowed(robots,u.pathname+u.search);
        const {results:known}=await env.DB.prepare('SELECT url FROM items WHERE source_id=?').bind(source.id).all();
        const knownURLs=new Set(known.map(row=>row.url));
        const {results:revisits}=await env.DB.prepare('SELECT url FROM items WHERE source_id=? AND url!=? AND superseded_by IS NULL ORDER BY COALESCE(checked_at,last_seen),url LIMIT 3').bind(source.id,source.url).all();
        let landing=null, page=null, failures=0;
        try {
          landing=await boundedFetch(source.url,fetchWithLease,source.host,guard);
          if(!landing.type.includes('text/html')) throw Error('Source is not HTML');
          page=await extract(landing.raw,landing.url);
        } catch(e) {
          landing=null;page=null;
          failures++;result.failures.push({source:source.label,url:source.url,error:e.message});
          await env.DB.prepare('UPDATE items SET checked_at=?,collection_error=? WHERE url=?').bind(at,e.message,source.url).run();
        }
        // Previously found pages rotate independently of links on today's landing page.
        // At most three old and three new articles per source keeps collection bounded.
        const {results:attempts}=await env.DB.prepare('SELECT url,checked_at FROM discovery_attempts WHERE source_id=?').bind(source.id).all();
        const attemptTimes=new Map(attempts.map(row=>[row.url,row.checked_at]));
        const candidates=(page?.links||[]).filter(url=>allowed(url,source) && !knownURLs.has(url) && discoveryMatch(url)).sort((a,b)=>(attemptTimes.get(a)||'').localeCompare(attemptTimes.get(b)||'')).slice(0,3);
        const candidateURLs=new Set(candidates);
        const recordAttempt=(url,outcome)=>env.DB.prepare('INSERT INTO discovery_attempts(source_id,url,checked_at,outcome) VALUES(?,?,?,?) ON CONFLICT(source_id,url) DO UPDATE SET checked_at=excluded.checked_at,outcome=excluded.outcome').bind(source.id,url,at,outcome).run();
        const urls=[...new Set([...(landing?[source.url]:[]),...revisits.map(row=>row.url),...candidates])];
        for(const url of urls) {
          try {
            await renew();
            if(candidateURLs.has(url)) await recordAttempt(url,'checking');
            await env.DB.prepare('UPDATE items SET checked_at=? WHERE url=?').bind(at,url).run();
            if(!allowed(url,source) && url!==source.url) throw Error('Page outside source watchlist');
            if(!robotsAllowed(robots,new URL(url).pathname+new URL(url).search)) throw Error('Page disallowed by robots.txt');
            const captured=url===source.url?landing:await boundedFetch(url,fetchWithLease,source.host,guard);
            const identity=canonical(captured.url);
            if(!identity || (!allowed(identity,source) && identity!==source.url)) throw Error('Redirect outside source watchlist');
            if(!captured.type.includes('text/html')) throw Error('Page is not HTML');
            const parsed=url===source.url?page:await extract(captured.raw,identity);
            if(!knownURLs.has(identity) && !PROJECT.some(term=>normalize(parsed.text+' '+parsed.title).includes(term))) { if(candidateURLs.has(url)) await recordAttempt(url,'not_relevant'); continue; }
            if(parsed.text.length<(knownURLs.has(identity)?1:150)) throw Error('Insufficient readable text');
            const destination=await env.DB.prepare('SELECT id FROM items WHERE url=?').bind(identity).first();
            const prior=url!==identity?await env.DB.prepare('SELECT id FROM items WHERE url=?').bind(url).first():null;
            // Retire a moved source item without deleting its captures or advice.
            // Advice is never transferred or published on the destination automatically.
            const id=destination?.id||await hash(identity), contentHash=await hash(parsed.title+'\n'+parsed.text), rawHash=await hash(captured.raw);
            const old=await env.DB.prepare('SELECT content_hash FROM items WHERE id=?').bind(id).first();
            const baseTags=classify(parsed.title+' '+parsed.text);
            const criticalThemes=new Set(criticismThemes(source.id,baseTags,parsed.title+'. '+parsed.text));
            const tags=JSON.stringify(baseTags.map(tag=>({...tag,criticismEvidence:criticalThemes.has(tag.theme)})));
            const statements=[
              env.DB.prepare(`INSERT INTO items(id,source_id,url,title,published_at,first_seen,changed_at,last_seen,content_hash,text,tags) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,superseded_by=NULL,title=excluded.title,published_at=excluded.published_at,changed_at=CASE WHEN items.content_hash!=excluded.content_hash THEN excluded.changed_at ELSE items.changed_at END,last_seen=excluded.last_seen,checked_at=excluded.last_seen,collection_error=NULL,review_status=CASE WHEN items.content_hash!=excluded.content_hash THEN 'unreviewed' ELSE items.review_status END,content_hash=excluded.content_hash,text=excluded.text,tags=excluded.tags`).bind(id,source.id,identity,parsed.title,parsed.published,at,at,at,contentHash,parsed.text,tags),
              env.DB.prepare('INSERT OR IGNORE INTO captures(item_id,hash,captured_at,raw_html,text) VALUES(?,?,?,?,?)').bind(id,rawHash,at,captured.raw,parsed.text)
            ];
            if(prior && prior.id!==id)statements.push(env.DB.prepare("UPDATE items SET superseded_by=?,checked_at=?,collection_error=?,review_status='unreviewed' WHERE id=?").bind(id,at,'Redirected to '+identity,prior.id));
            await env.DB.batch(statements);
            knownURLs.add(identity);
            if(candidateURLs.has(url)) await recordAttempt(url,'collected');
            if(!old) result.newItems++; else if(old.content_hash!==contentHash) result.changedItems++;
          } catch(e) {if(e.message==='Collection lock lost') throw e;if(candidateURLs.has(url)) await recordAttempt(url,e.message);failures++;result.failures.push({source:source.label,url,error:e.message});await env.DB.prepare('UPDATE items SET checked_at=?,collection_error=? WHERE url=?').bind(at,e.message,url).run();}
        }
        await env.DB.prepare('UPDATE sources SET checked_at=?,success_at=CASE WHEN ?=0 THEN ? ELSE success_at END,error=? WHERE id=?').bind(at,failures,at,failures?`${failures} page(s) could not be collected`:null,source.id).run();
        if(!failures) successfulSources++;
      } catch(e) {
        if(e.message==='Collection lock lost') throw e;
        result.failures.push({source:source.label,error:e.message});
        await env.DB.prepare('UPDATE items SET checked_at=?,collection_error=? WHERE url=?').bind(at,e.message,source.url).run();
        await env.DB.prepare('UPDATE sources SET checked_at=?,error=? WHERE id=?').bind(at,e.message,source.id).run();
      }
    }
    await env.DB.prepare("INSERT INTO audit(at,item_id,action,detail) VALUES(?,NULL,'collection_run',?)").bind(new Date(now).toISOString(),JSON.stringify({successfulSources,totalSources:SOURCES.length})).run();
    return result;
  } finally {await env.DB.prepare("UPDATE locks SET expires_at=?,owner=NULL WHERE id='collect' AND owner=?").bind(Date.now()+300000,owner).run();}
}
