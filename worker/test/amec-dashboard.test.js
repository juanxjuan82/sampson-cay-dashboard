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
 socialExportRanges={ig:[{start:'2026-09-01',end:'2026-09-14'}],fb:[{start:'2026-09-01',end:'2026-09-14'}]};
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
test('TV and media shows use editorial category, with paid format precedence',()=>{
 const c=context();c.types=['TV Show','Media Show','TV, Online, Youtube','Paid TV Show'];
 const result=vm.runInContext('types.map(coverageCategory)',c);
 assert.deepEqual(Array.from(result),['Editorial coverage','Editorial coverage','Editorial coverage','Paid placement']);
});
test('plain strategy export includes each card heading once and the same narrative as rich export',()=>{
 for(const file of ['index.html','report.html']) {
  const markup=readFileSync(new URL('../../'+file,import.meta.url),'utf8');
  const fn=markup.match(/function buildStrategyDocExport\(\) \{[\s\S]*?\n\}/)[0];
  const field={dataset:{editKey:'public-narrative'},innerText:'Approved narrative',innerHTML:'Approved narrative',closest:()=>{throw new Error('Card evidence must not be copied');}};
  const summary={querySelectorAll:()=>[],contains:()=>false};
  const c=vm.createContext({document:{getElementById:id=>id==='exec-summary-body'?summary:null,querySelector:()=>null,querySelectorAll:()=>[field]},stripDocEmoji:String,normalizeCopyText:String,cleanDocHTML:String,escapeHTML:String});
  vm.runInContext(fn,c);const result=vm.runInContext('buildStrategyDocExport()',c);
  assert.equal(result.text.match(/What needs attention/g).length,1);
  assert.match(result.text,/What needs attention\nApproved narrative/);
  assert.match(result.html,/>What needs attention<\/h2><p>Approved narrative<\/p>/);
 }
});
test('Instagram investment examples account for saves alongside shares',()=>{
 const c=context();vm.runInContext(`reportWindow={start:'2026-09-01',end:'2026-09-14'};
 allPosts=[{platform:'ig',dateStr:'09/02/2026',caption:'Saved',reach:100,shares:0,saves:20},{platform:'ig',dateStr:'09/03/2026',caption:'Shared',reach:500,shares:5,saves:0},{platform:'ig',dateStr:'09/04/2026',caption:'Third',reach:1000,shares:4,saves:0}];`,c);
 const result=vm.runInContext('socialAMECEvidence()',c);
 assert.equal(result.platforms[0].examples[0].caption,'Saved');assert.equal(result.platforms[0].examples[0].saves,20);
 assert.equal(result.platforms[0].examples[1].caption,'Shared');
 assert.equal(vm.runInContext("audienceResponseScore({shares:3,saves:50},'fb')",c),3);
});
test('supporting audit describes reach outliers without inferring paid status',()=>{
 for(const file of ['index.html','report.html']) {
  const markup=readFileSync(new URL('../../'+file,import.meta.url),'utf8');
  const fn=markup.match(/function renderAnalystNotes\(posts\) \{[\s\S]*?\n\}/)[0];
  const elements={};const c=vm.createContext({document:{getElementById:id=>elements[id]??=( {style:{},innerHTML:''} )},fmt:String,fmtPct:String,igPosts:[{reach:10000}],fbPosts:[{reach:20000}]});
  vm.runInContext(fn,c);c.posts=[1,1,1,10].map((reach,i)=>({platform:'ig',type:'Image',reach,engRate:1,interactions:1,date:null,hour:null,dateStr:'09/0'+(i+1)+'/2026'}));
  vm.runInContext('renderAnalystNotes(posts)',c);
  const notes=elements['boost-caveat-note'].innerHTML+elements['analyst-notes-body'].innerHTML;
  assert.match(notes,/paid status is unverified/);
  assert.match(notes,/Reach split:<\/strong> IG 13 · FB 0/);
  assert.doesNotMatch(markup,/Likely Paid Posts/);
  assert.match(markup,/Reach Outliers: Reach by Format/);
  assert.doesNotMatch(notes,/consistent with paid|reflects? a paid audience|note it was paid distribution|organic baseline/i);
 }
});
test('captionless posts keep IDs during both Meta parsers and remain distinct',()=>{
 const rows=[{'Post ID':'123','Reach':'10','Publish time':'09/02/2026 10:00'},{'Post ID':'456','Reach':'10','Publish time':'09/02/2026 10:00'}];
 const c=context();c.Papa={parse:()=>({data:rows})};c.n=v=>Number(v)||0;c.parseDate=()=>new Date('2026-09-02');c.publishHour=()=>10;
 for(const name of ['parseIG','parseFB'])vm.runInContext(html.match(new RegExp('function '+name+'\\(csvArr\\) \\{[\\s\\S]*?\\n\\}'))[0],c);
 const posts=vm.runInContext("[...parseIG('csv'),...parseFB('csv')]",c);
 assert.deepEqual(Array.from(posts,p=>p.id),['123','456','123','456']);
 c.allPosts=posts;vm.runInContext("reportWindow={start:'2026-09-01',end:'2026-09-14'}",c);
 assert.equal(vm.runInContext('socialAMECEvidence().contentItems',c),4);
 posts.forEach(p=>delete p.id);assert.equal(vm.runInContext('socialAMECEvidence().contentItems',c),4);
});
test('Instagram investment evidence displays the saves used to rank examples',()=>{
 const c=context();assert.equal(vm.runInContext("socialExampleResponseText('ig',{shares:0,saves:20})",c),'0 shares · 20 saves');
 assert.equal(vm.runInContext("socialExampleResponseText('fb',{shares:2,saves:null})",c),'2 shares');
});
test('same-day reused captions preserve platform publication counts while pairing copies',()=>{
 const c=context();c.posts=[{platform:'ig',id:'ig1'},{platform:'ig',id:'ig2'},{platform:'fb',id:'fb1'}].map(p=>({...p,dateStr:'09/02/2026',caption:'Same caption'}));
 assert.equal(vm.runInContext('countSocialContentItems(posts)',c),2);
 c.posts.push({platform:'fb',id:'fb2',dateStr:'09/02/2026',caption:'Same caption'});
 assert.equal(vm.runInContext('countSocialContentItems(posts)',c),2);
 c.posts.push({platform:'fb',id:'fb3',dateStr:'09/02/2026',caption:'Same caption'});
 assert.equal(vm.runInContext('countSocialContentItems(posts)',c),3);
});
test('historical comparison receives platform history while current charts receive reporting slice',()=>{
 for(const file of ['index.html','report.html']) {
  const markup=readFileSync(new URL('../../'+file,import.meta.url),'utf8');
  const c=context();c.currentFilter='ig';c.igPosts=[{dateStr:'01/01/2026'},{dateStr:'09/02/2026'}];c.fbPosts=[];c.allPosts=c.igPosts;
  vm.runInContext(markup.match(/function platformHistory\(\)[^\n]+/)[0],c);
  vm.runInContext(markup.match(/function filtered\(\) \{[\s\S]*?\n\}/)[0],c);
  vm.runInContext("reportWindow={start:'2026-09-01',end:'2026-09-14'}",c);
  assert.equal(vm.runInContext('filtered().length',c),1);
  assert.equal(vm.runInContext('platformHistory().length',c),2);
  assert.match(markup.match(/function renderAll\(\) \{[\s\S]*?\n\}/)[0],/renderComparison\(platformHistory\(\)\)/);
  assert.match(markup,/comparison: buildAlignedComparisonEvidence\(allPosts\)/);
 }
});
test('combined AI historical comparison stays combined under either platform display filter',()=>{
 for(const file of ['index.html','report.html']) {
  const markup=readFileSync(new URL('../../'+file,import.meta.url),'utf8');
  const c=context();c.allPosts=['ig','fb'].map(platform=>({platform,date:new Date('2026-09-02'),dateStr:'09/02/2026',caption:platform,reach:10,interactions:1,views:10,shares:0}));
  c.igPosts=c.allPosts.slice(0,1);c.fbPosts=c.allPosts.slice(1);c.DASHBOARD_VERSION='test';c.THEME_MIN_SAMPLE=5;
  c.isLikelyBoostedPost=()=>false;c.getThemeStats=()=>({totalContentItems:0,unclassifiedCount:0,rows:[]});
  c.buildAlignedComparisonEvidence=posts=>({platforms:posts.map(p=>p.platform)});
  vm.runInContext(markup.match(/function platformHistory\(\)[^\n]+/)[0],c);
  vm.runInContext(markup.match(/function buildAISummaryEvidence\(posts=selectedSocialPosts\(\)\) \{[\s\S]*?\n\}/)[0],c);
  for(const filter of ['ig','fb','all']) {
   c.currentFilter=filter;
   const r=vm.runInContext('buildAISummaryEvidence(allPosts)',c);
   assert.deepEqual(Array.from(r.comparison.platforms),['ig','fb']);
  }
 }
});
test('bereavement phrasing stays in performance totals but never in investment candidates',()=>{
 const c=context();c.captions=['Our condolences','The passing of a neighbour','She passed away','In memory of John','In loving memory of John','We mourn our friend','Rest in peace','Memorial service','Death of a neighbour','Deepest sympathy to the family','Bereavement support'];
 vm.runInContext(`reportWindow={start:'2026-09-01',end:'2026-09-14'};
 allPosts=[...captions.map((caption,i)=>({platform:'ig',id:String(i),dateStr:'09/02/2026',caption,reach:500,shares:100,saves:100})),{platform:'ig',id:'community',dateStr:'09/03/2026',caption:'Community roof completed',reach:100,shares:1,saves:1}];`,c);
 const r=vm.runInContext('socialAMECEvidence()',c);
 assert.equal(r.platformObservations,12);assert.equal(r.platforms[0].examples.length,1);
 assert.equal(r.platforms[0].examples[0].caption,'Community roof completed');
 assert.equal(vm.runInContext("isBereavementPost({caption:'Passing our school examinations'})",c),false);
});
test('outlier classification follows the selected period independently of old high-reach history',()=>{
 for(const file of ['index.html','report.html']) {
  const markup=readFileSync(new URL('../../'+file,import.meta.url),'utf8');const c=context();
  const selected=[10,10,10,100].map(reach=>({platform:'ig',reach,dateStr:'09/02/2026'}));
  const older=Array(10).fill(null).map(()=>({platform:'ig',reach:1000,dateStr:'01/01/2026'}));
  c.igPosts=[...older,...selected];c.fbPosts=[];c.allPosts=c.igPosts;c.currentFilter='all';c.selected=selected;
  vm.runInContext(markup.match(/function platformHistory\(\)[^\n]+/)[0],c);
  vm.runInContext(markup.match(/function filtered\(\) \{[\s\S]*?\n\}/)[0],c);
  vm.runInContext(markup.match(/function isLikelyBoostedPost\(p, baselinePosts=filtered\(\)\) \{[\s\S]*?\n\}/)[0],c);
  vm.runInContext("reportWindow={start:'2026-09-01',end:'2026-09-14'}",c);
  assert.equal(vm.runInContext('isLikelyBoostedPost(selected[3])',c),true);
  assert.equal(vm.runInContext('isLikelyBoostedPost(selected[3],allPosts)',c),false);
  assert.equal(vm.runInContext('isLikelyBoostedPost(selected[0])',c),false);
  assert.match(markup,/\$\{isLikelyBoostedPost\(p,posts\) \?/);
  assert.match(markup.match(/function renderBoostReach\(posts\) \{[\s\S]*?\n\}/)[0],/const isBoosted = p => isLikelyBoostedPost\(p,posts\)/);
 }
});
test('legacy AI responses preserve changed-evidence review gate until every card refreshes',()=>{
 for(const file of ['index.html','report.html']) {
  const markup=readFileSync(new URL('../../'+file,import.meta.url),'utf8');const c=context();
  const fields={};c.document={querySelector:selector=>fields[selector]??=({textContent:'Saved old card'})};
  c.currentFilter='all';c.captureSharedEditableContent=()=>{};c.summaryMode='deterministic';
  vm.runInContext(markup.match(/function applyAISummary\(summary\) \{[\s\S]*?\n\}/)[0],c);
  c.summary={executiveRead:'New read',goalProgress:'New goals',publicNarrative:'New narrative',socialDirection:'New plan',historicalPrecedent:'New history'};
  vm.runInContext('editorialReviewNeeded=true;applyAISummary(summary)',c);
  assert.equal(vm.runInContext('editorialReviewNeeded',c),true);
  Object.assign(c.summary,{recommendedResponse:'New response',socialPerformance:'New performance',socialInvestment:'New investment',decisionsNeeded:'New decisions'});
  vm.runInContext('applyAISummary(summary)',c);
  assert.equal(vm.runInContext('editorialReviewNeeded',c),false);
  assert.match(markup,/applyAISummary\(payload.summary\);\s*document.getElementById\('amec-review-needed'\).hidden = !editorialReviewNeeded/);
 }
});
test('current AI totals use selected all-platform dates while historical comparison retains history',()=>{
 const c=context();c.allPosts=[{platform:'ig',dateStr:'01/01/2026',date:new Date('2026-01-01'),caption:'Old',reach:1000,interactions:100,views:1000},{platform:'fb',dateStr:'09/02/2026',date:new Date('2026-09-02'),caption:'Current',reach:10,interactions:1,views:10}];
 c.currentFilter='ig';c.DASHBOARD_VERSION='test';c.THEME_MIN_SAMPLE=5;c.isLikelyBoostedPost=()=>false;c.getThemeStats=posts=>({totalContentItems:posts.length,classifiedCount:posts.length,unclassifiedCount:0,rows:[]});
 c.buildAlignedComparisonEvidence=posts=>({posts:posts.length});
 vm.runInContext(html.match(/function buildAISummaryEvidence\(posts=selectedSocialPosts\(\)\) \{[\s\S]*?\n\}/)[0],c);
 vm.runInContext("reportWindow={start:'2026-09-01',end:'2026-09-14'}",c);
 const r=vm.runInContext('buildAISummaryEvidence()',c);
 assert.equal(r.overall.posts,1);assert.equal(r.overall.totalReach,10);assert.equal(r.comparison.posts,2);
 assert.equal(r.period.start,'2026-09-02');assert.equal(r.amecSocial.platformObservations,1);
 assert.match(html,/evidence: buildAISummaryEvidence\(\)/);
});
test('zero-reach periods render unavailable engagement instead of NaN while genuine zero engagement stays zero',()=>{
 for(const file of ['index.html','report.html']) {
  const markup=readFileSync(new URL('../../'+file,import.meta.url),'utf8');const elements={};
  const c=vm.createContext({document:{getElementById:id=>elements[id]??=({textContent:''})},fmt:String,fmtPct:value=>value+'%',currentFilter:'all'});
  vm.runInContext(markup.match(/function renderKPIs\(posts\) \{[\s\S]*?\n\}/)[0],c);
  c.posts=[{platform:'ig',reach:0,views:0,follows:0,engRate:0}];vm.runInContext('renderKPIs(posts)',c);
  assert.equal(elements['kpi-eng'].textContent,'N/A');assert.equal(elements['kpi-reach'].textContent,'0');
  c.posts[0].reach=10;vm.runInContext('renderKPIs(posts)',c);assert.equal(elements['kpi-eng'].textContent,'0%');
 }
});
test('partial or unknown current-period coverage cannot establish zero publishing cadence',()=>{
 const c=context();vm.runInContext(`reportWindow={start:'2026-09-01',end:'2026-09-30'};
 socialExportRanges={ig:[{start:'2026-09-15',end:'2026-09-30'}],fb:[{start:'2026-09-01',end:'2026-09-30'}]};allPosts=[];`,c);
 let r=vm.runInContext('socialAMECEvidence()',c);
 assert.equal(r.coverageComplete,false);assert.equal(r.feedPostsPerWeek,null);assert.equal(r.contentItems,0);
 assert.equal(r.platforms[0].currentCoverageComplete,false);assert.match(r.caveats[0],/observed records only/);
 vm.runInContext("socialExportRanges.ig=[{start:'2026-09-01',end:'2026-09-30'}]",c);
 r=vm.runInContext('socialAMECEvidence()',c);assert.equal(r.coverageComplete,true);assert.equal(r.feedPostsPerWeek,0);
 vm.runInContext('socialExportRanges={ig:[],fb:[]}',c);r=vm.runInContext('socialAMECEvidence()',c);assert.equal(r.feedPostsPerWeek,null);
});
test('social coverage is accepted only after validating expected platform CSV headers',()=>{
 const c=context();const fn=html.match(/function validateSocialCSV\(csv,platform\) \{[\s\S]*?\n\}/)[0];vm.runInContext(fn,c);
 let fields=['Post ID','Reach','Publish time','Likes','Comments','Shares','Saves'];c.Papa={parse:()=>({meta:{fields},errors:[]})};
 assert.doesNotThrow(()=>vm.runInContext("validateSocialCSV('empty IG export','ig')",c));
 fields=fields.filter(f=>f!=='Reach');assert.throws(()=>vm.runInContext("validateSocialCSV('missing Reach','ig')",c),/Missing required IG columns: Reach/);
 fields=['Post ID','Reach','Publish time','Reactions','Comments','Shares'];assert.doesNotThrow(()=>vm.runInContext("validateSocialCSV('empty FB export','fb')",c));
 fields=fields.filter(f=>f!=='Post ID');assert.throws(()=>vm.runInContext("validateSocialCSV('missing ID','fb')",c),/Post ID/);
 assert.ok(html.indexOf('try { validateSocialCSV(csv,platform);')<html.indexOf('rememberExportRange(platform, file.name);'));
});
test('declared complete quiet periods and article-only evidence can produce reports',()=>{
 const c=context();vm.runInContext(`reportWindow={start:'2026-09-01',end:'2026-09-30'};allPosts=[];
 socialExportRanges={ig:[{start:'2026-09-01',end:'2026-09-30'}],fb:[{start:'2026-09-01',end:'2026-09-30'}]};`,c);
 assert.equal(vm.runInContext('hasReportEvidence()',c),true);
 vm.runInContext('socialExportRanges={ig:[],fb:[]}',c);assert.equal(vm.runInContext('hasReportEvidence()',c),false);
 vm.runInContext("articleTracker.rows=[{title:'Court hearing'}]",c);assert.equal(vm.runInContext('hasReportEvidence()',c),true);
 assert.match(html.match(/function renderExecSummary\(\) \{[\s\S]*?\n\}/)[0],/!hasReportEvidence\(\)/);
 assert.match(html,/async function generateAISummary\(\) \{\s*if \(!hasReportEvidence\(\)\)/);
});
test('valid article tracker enables the normal Load Dashboard action without social files',()=>{
 const c=context();const button={disabled:true};c.rawIG=[];c.rawFB=[];c.document={getElementById:()=>button};
 vm.runInContext('updateLoadAvailability()',c);assert.equal(button.disabled,true);
 vm.runInContext("articleTracker.rows=[{title:'Court hearing'}];updateLoadAvailability()",c);assert.equal(button.disabled,false);
 vm.runInContext('articleTracker.rows=[];updateLoadAvailability()',c);assert.equal(button.disabled,true);
 c.rawIG=['ig csv'];c.rawFB=['fb csv'];vm.runInContext('updateLoadAvailability()',c);assert.equal(button.disabled,false);
});
