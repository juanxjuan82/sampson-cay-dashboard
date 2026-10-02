import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const source=html.match(/<script>\s*(\/\/ AMEC-guided[\s\S]*?)<\/script>/)[1];
function context(){const c=vm.createContext({Date,URL,console,allPosts:[],medianValue:xs=>{const a=xs.slice().sort((a,b)=>a-b);return !a.length?0:a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;}});vm.runInContext(source,c);return c;}
test('tracker imports real records, separates placements, deduplicates, and never maps actor to sentiment',()=>{
 const c=context();const input=[
 {'Publication Name':'The Tribune','Article Title & URL':'Court update','Publish Date':'2026-10-02','Coverage Type':'Article','Reference':'Turtlegrass'},
 {'Publication Name':'Tribune','Article Title & URL':'Court update','Publish Date':'2026-10-02','Coverage Type':'Article'},
 {'Publication Name':'The Tribune','Article Title & URL':'Save the bay','Publish Date':'2026-10-01','Coverage Type':'Print Ad','__url':'javascript:alert(1)'},
 {'Mention ID':8},
 {'Publication Name':'Outlet','Article Title & URL':'Bad date','Publish Date':'2026-02-30'}];
 c.input=input;const result=vm.runInContext('normalizeArticleRows(input)',c);
 assert.equal(result.rows.length,2);assert.equal(result.duplicates,1);assert.equal(result.rejected,1);
 assert.equal(result.rows[0].reference,'Turtlegrass');assert.equal(result.rows[0].sentiment,undefined);
 assert.equal(result.rows[1].category,'Paid placement');assert.equal(result.rows[1].url,'');
});
test('equal social windows require known continuous export coverage and per-platform samples',()=>{
 const c=context();vm.runInContext(`reportWindow={start:'2026-08-25',end:'2026-09-30'};
 socialExportRanges={ig:[{start:'2026-05-27',end:'2026-08-24'},{start:'2026-08-25',end:'2026-09-30'}],fb:[]};
 allPosts=['ig','fb'].flatMap(platform=>[...Array(5)].flatMap((_,i)=>[{platform,date:new Date('2026-09-'+(10+i)),reach:50,caption:'new'+i,shares:0},{platform,date:new Date('2026-08-'+(10+i)),reach:100,caption:'old'+i,shares:0}]));`,c);
 const result=vm.runInContext('socialAMECEvidence()',c);
 assert.equal(result.days,37);assert.equal(result.priorStart,'2026-07-19');assert.equal(result.priorEnd,'2026-08-24');
 assert.equal(result.platforms[0].comparable,true);assert.equal(result.platforms[0].changePercent,-50);
 assert.equal(result.platforms[1].comparable,false);assert.equal(result.platforms[1].changePercent,null);
 assert.equal(result.contentItems,5);assert.equal(result.platformObservations,10);
});
test('article time windows are independent of social exports and topic matches may overlap',()=>{
 const c=context();vm.runInContext(`articleTracker.rows=[{date:'2026-10-02',title:'Court challenge to environmental approval',outlet:'The Tribune',category:'Editorial coverage',url:''},{date:'2026-09-10',title:'Paid notice',outlet:'Outlet',category:'Paid placement',url:''}];`,c);
 const result=vm.runInContext('articleAMECEvidence()',c);
 assert.equal(result.start,'2026-09-19');assert.equal(result.currentItems,1);assert.equal(result.previousItems,1);
 assert.equal(result.currentCategories['Paid placement'],0);
 assert.equal(result.topics.filter(t=>t.currentItems===1).length,2);
});
test('worksheet links retain physical row indexes across blank rows in both dashboards',()=>{
 for(const file of ['index.html','report.html']) for(const titleHeader of ['Article Title & URL','Article Title','Title']) {
  const c=vm.createContext({Date,URL,console,titleHeader});
  vm.runInContext(readFileSync(new URL('../../vendor/xlsx.full.min.js',import.meta.url),'utf8'),c);
  vm.runInContext(readFileSync(new URL('../../'+file,import.meta.url),'utf8').match(/<script>\s*(\/\/ AMEC-guided[\s\S]*?)<\/script>/)[1],c);
  const result=vm.runInContext(`(() => {
   const s=XLSX.utils.aoa_to_sheet([['Publication Name',titleHeader,'Publish Date','Coverage Type'],['Outlet','Court update','2026-10-02','Article'],[],['Outlet','School update','2026-10-01','Article'],['Outlet','Unlinked','2026-09-30','Article']]);
   s.B2.l={Target:'https://example.com/court'};s.B4.l={Target:'https://example.com/school'};
   return normalizeArticleRows(articleWorksheetRecords(s));
  })()`,c);
  assert.equal(result.rows.length,3,file);
  assert.equal(result.rows[0].url,'https://example.com/court',file);
  assert.equal(result.rows[1].url,'https://example.com/school',file);
  assert.equal(result.rows[2].url,'',file);
 }
});
test('narrative topics exclude paid placements, notices, releases and unclassified items',()=>{
 const c=context();vm.runInContext(`articleTracker.rows=[
 {date:'2026-10-02',title:'Court hearing',outlet:'Outlet',category:'Editorial coverage'},
 ...['Paid placement','Public notice','Press release','Other / unclassified'].map(category=>({date:'2026-10-01',title:'School marine environment',outlet:'Outlet',category})),
 {date:'2026-09-10',title:'School opening',outlet:'Outlet',category:'Editorial coverage'},
 {date:'2026-09-09',title:'Court approval',outlet:'Outlet',category:'Paid placement'}];`,c);
 const r=vm.runInContext('articleAMECEvidence()',c);
 assert.equal(r.currentItems,5);assert.equal(r.previousItems,2);
 assert.equal(r.currentCategories['Paid placement'],1);
 assert.equal(r.topicCategory,'Editorial coverage');
 assert.equal(r.topics[0].label,'Approvals & court proceedings');
 assert.equal(r.topics[0].currentItems,1);assert.equal(r.topics[0].previousItems,0);
 assert.equal(r.topics.find(t=>t.label==='Community & local benefits').currentItems,0);
 assert.equal(r.topics.find(t=>t.label==='Community & local benefits').previousItems,1);
});
test('social calendar boundaries and example dates use the original date string',()=>{
 const c=context();vm.runInContext(`reportWindow={start:'2026-08-25',end:'2026-09-30'};
 allPosts=[{platform:'ig',date:new Date('2026-08-24T23:00:00Z'),dateStr:'08/25/2026',caption:'Boundary',reach:20,shares:1},{platform:'ig',date:new Date('2026-09-30T23:00:00Z'),dateStr:'10/01/2026',caption:'Outside',reach:500,shares:2}];`,c);
 const r=vm.runInContext('socialAMECEvidence()',c);
 assert.equal(r.platformObservations,1);assert.equal(r.platforms[0].currentMedianReach,20);
 assert.equal(r.platforms[0].examples[0].date,'2026-08-25');
});
test('headline narrative names all tied leaders and reserves leads for a unique maximum',()=>{
 const c=context();c.topics=[{label:'Court',currentItems:2},{label:'Environment',currentItems:2},{label:'Community',currentItems:1}];
 const tied=vm.runInContext('articleTopicSummary(topics)',c);
 assert.match(tied,/Court; Environment are tied/);assert.doesNotMatch(tied,/ leads /);
 c.topics[1].currentItems=1;assert.match(vm.runInContext('articleTopicSummary(topics)',c),/^Court leads/);
 c.topics.forEach(t=>t.currentItems=0);assert.match(vm.runInContext('articleTopicSummary(topics)',c),/^Review/);
});
test('tracker replacement redraws executive read before restoring saved overrides',async()=>{
 const c=context();const events=[];const notice={textContent:''};
 c.document={querySelectorAll:()=>[notice],getElementById:()=>null};
 c.Papa={parse:()=>({data:[{'Outlet':'Outlet','Title':'Court hearing','Date':'2026-10-02','Type':'Article'}],errors:[]})};
 c.captureSharedEditableContent=()=>events.push('capture');c.sharedEditableContent={'executive-read':'Edited read'};c.strategyRequestVersion=0;
 c.renderExecSummary=()=>events.push('exec');c.restoreSharedEditableContent=()=>events.push('restore');
 vm.runInContext('renderAMEC=()=>{}',c);
 c.input={files:[{name:'tracker.csv',size:100,text:async()=>''}],value:'chosen'};
 await vm.runInContext('uploadArticleTracker(input)',c);
 assert.deepEqual(events,['capture','exec','restore']);
 assert.equal(vm.runInContext('articleTracker.rows.length',c),1);
 assert.equal(c.sharedEditableContent['executive-read'],'Edited read');
 assert.equal(vm.runInContext('editorialReviewNeeded',c),true);
});
test('native Excel publication dates preserve calendar days in western time zones',()=>{
 const oldZone=process.env.TZ;process.env.TZ='America/Los_Angeles';
 try {
  const c=context();vm.runInContext(readFileSync(new URL('../../vendor/xlsx.full.min.js',import.meta.url),'utf8'),c);
  const r=vm.runInContext(`(() => {
   const s=XLSX.utils.aoa_to_sheet([['Outlet','Title','Date','Type'],['Outlet','Boundary','2026-10-02','Article']]);
   // Excel serial: whole UTC days from its 1899-12-30 epoch.
   s.C2={t:'n',v:(Date.UTC(2026,9,2)-Date.UTC(1899,11,30))/86400000,z:'mm/dd/yyyy'};
   const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,s,'Media Mentions');
   const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'});
   const numeric=XLSX.read(bytes,{type:'array',cellDates:false});
   const native=XLSX.read(bytes,{type:'array',cellDates:true});
   return [normalizeArticleRows(articleWorksheetRecords(numeric.Sheets['Media Mentions'])).rows[0].date,normalizeArticleRows(articleWorksheetRecords(native.Sheets['Media Mentions'])).rows[0].date];
  })()`,c);
  assert.equal(r[0],'2026-10-02');assert.equal(r[1],'2026-10-02');
 } finally {if(oldZone===undefined)delete process.env.TZ;else process.env.TZ=oldZone;}
});
test('repeated captions on separate dates count separately while same-day platform copies group',()=>{
 const c=context();vm.runInContext(`reportWindow={start:'2026-09-01',end:'2026-09-14'};
 allPosts=['ig','fb'].flatMap(platform=>['09/02/2026','09/09/2026'].map(dateStr=>({platform,dateStr,date:new Date(),caption:'Same caption',reach:10,shares:0})));`,c);
 const r=vm.runInContext('socialAMECEvidence()',c);
 assert.equal(r.contentItems,2);assert.equal(r.platformObservations,4);assert.equal(r.feedPostsPerWeek,1);
});
test('1904 workbook date system survives real XLSX upload conversion',()=>{
 const c=context();vm.runInContext(readFileSync(new URL('../../vendor/xlsx.full.min.js',import.meta.url),'utf8'),c);
 const result=vm.runInContext(`(() => {
  const s=XLSX.utils.aoa_to_sheet([['Outlet','Title','Publish Date','Type'],['Outlet','Court hearing',0,'Article']]);
  s.C2={t:'n',v:(Date.UTC(2026,9,2)-Date.UTC(1904,0,1))/86400000,z:'mm/dd/yyyy'};
  const book=XLSX.utils.book_new();book.Workbook={WBProps:{date1904:true}};XLSX.utils.book_append_sheet(book,s,'Media Mentions');
  const parsed=XLSX.read(XLSX.write(book,{type:'array',bookType:'xlsx'}),{type:'array',cellDates:false});
  return normalizeArticleRows(articleWorksheetRecords(parsed.Sheets['Media Mentions'],Boolean(parsed.Workbook?.WBProps?.date1904)));
 })()`,c);
 assert.equal(result.rows[0].date,'2026-10-02');
});
test('editorials, opinion and letters count as editorial coverage while paid types stay paid',()=>{
 const c=context();c.types=['Editorial','Opinion','Letter to the editor','Commentary','Paid editorial'];
 const r=vm.runInContext("normalizeArticleRows(types.map((type,i)=>({Outlet:'Outlet',Title:'Court '+i,Date:'2026-10-02',Type:type})))",c);
 assert.equal(r.rows.filter(r=>r.category==='Editorial coverage').length,4);
 assert.equal(r.rows.filter(r=>r.category==='Paid placement').length,1);
});
test('empty platforms expose unavailable medians, while measured zero reach stays zero',()=>{
 const c=context();c.fmt=String;
 vm.runInContext(`reportWindow={start:'2026-09-01',end:'2026-09-14'};allPosts=[{platform:'ig',dateStr:'09/02/2026',date:new Date(),caption:'Zero reach',reach:0,shares:0}];`,c);
 const r=vm.runInContext('socialAMECEvidence()',c);
 assert.equal(r.platforms[0].currentMedianReach,0);assert.equal(r.platforms[1].currentMedianReach,null);
 assert.equal(r.platforms[0].previousMedianReach,null);assert.equal(r.platforms[1].changePercent,null);
 assert.equal(vm.runInContext('socialMedianText(null)',c),'median reach unavailable (no posts)');
 assert.equal(vm.runInContext('socialMedianText(0)',c),'median reach 0 per post');
});
