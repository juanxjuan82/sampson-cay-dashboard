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
