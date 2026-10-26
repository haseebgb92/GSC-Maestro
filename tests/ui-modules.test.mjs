import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
const project=process.cwd();
async function compiled(path,target){
  const dest=resolve(project,"tests",target);
  await build({entryPoints:[resolve(project,path)],outfile:dest,bundle:true,platform:"node",format:"esm",target:"node22",jsx:"automatic",packages:"external",logLevel:"silent"});
  return import(pathToFileURL(dest).href+"?fresh="+Date.now());
}
test("Bing Reports retain real Bing landing pages rather than assuming GSC field names",async()=>{
 const {normalizeSearchReport}=await compiled("src/Reports.tsx",".report-generator-smoke.mjs");
 const bing={startDate:"2026-07-26",endDate:"2026-10-23",syncedAt:"2026-10-25T10:00:00Z",
  daily:[{key:"2026-10-23",clicks:4,impressions:125,ctrPercent:3.2,position:null}],
  topPages:[{key:"https://example.com/article/",clicks:2,impressions:75,ctrPercent:2.666,position:8.5}],
  topQueries:[{key:"article query",clicks:1,impressions:50,ctrPercent:2,position:9}]};
 const out=normalizeSearchReport("Bing","https://example.com/",bing);
 assert.equal(out.pages.length,1);assert.equal(out.queries.length,1);assert.equal(out.pages[0].key,"https://example.com/article/");
 assert.equal(out.totalImpressions,125);assert.equal(out.totalClicks,4);assert.equal(out.ctr,3.2);
 assert.equal(out.period,"2026-07-26 to 2026-10-23");
});
test("Google Reports use official GSC field names and retain row positions",async()=>{
 const {normalizeSearchReport}=await compiled("src/Reports.tsx",".report-generator-smoke.mjs");
 const out=normalizeSearchReport("Google","sc-domain:example.com",{
  start_date:"2026-09-25",end_date:"2026-10-22",synced_at:"2026-10-25T10:00:00Z",
  daily:[{key:"2026-10-22",clicks:5,impressions:100,ctr:5,position:13}],
  pages:[{key:"https://example.com/",clicks:2,impressions:30,ctr:6.666,position:9.1}],
  queries:[{key:"example",clicks:4,impressions:70,ctr:5.71,position:5.4}]});
 assert.equal(out.totalImpressions,100);assert.equal(out.pages[0].position,9.1);assert.equal(out.queries[0].ctr,5.71);
});
test("Bing AI CSV importer accepts exact official US dates and rejects search-clicks substitution",async()=>{
 const {asRows}=await compiled("src/AISearch.tsx",".ai-csv-parser-smoke.mjs");
 const rows=asRows('\uFEFF"Date","Citations","Cited Pages"\n"7/25/2026 12:00:00 AM","0","0"\n"10/24/2026 12:00:00 AM","131","12"',"date");
 assert.deepEqual(rows,[{key:"2026-07-25",citations:0},{key:"2026-10-24",citations:131}]);
 const page=asRows('"Page","Citations"\n"https://example.com/","29"',"page");
 assert.equal(page[0].citations,29);
 const queries=asRows('"Grounding Query","Intent","Topic","Citations","Citation Share"\n"baby monitor","Commercial","Baby Care","26","13.83%"',"query");
 assert.equal(queries[0].key,"baby monitor");
 assert.throws(()=>asRows('Query,Clicks\ntest,30',"query"),/Expected/);
 assert.throws(()=>asRows('Date,Citations\n13/44/2026,20',"date"),/Invalid/);
});

test("Yandex Reports keep Yandex dates and index counts separate",async()=>{
 const {normalizeSearchReport}=await compiled("src/Reports.tsx",".report-generator-smoke.mjs");
 const source={startDate:"2026-10-21",endDate:"2026-10-22",syncedAt:"2026-10-25T10:00:00Z",
  daily:[{key:"2026-10-21",clicks:3,impressions:90,ctrPercent:3.33,position:10},{key:"2026-10-22",clicks:null,impressions:50,ctrPercent:null,position:null}],
  topQueries:[{key:"yandex phrase",clicks:1,impressions:30,ctrPercent:3.33,position:11}],topPages:[],
  kpis:{searchablePages:38,excludedPages:7,sqi:109}};
 const out=normalizeSearchReport("Yandex","https://example.com/",source);
 assert.equal(out.engine,"Yandex");assert.equal(out.totalClicks,3);assert.equal(out.totalImpressions,90);assert.equal(out.daily.length,1);
 assert.equal(out.pages.length,0);assert.equal(out.queries.length,1);assert.equal(out.indexing.searchablePages,38);assert.equal(out.indexing.excludedPages,7);
 assert.match(out.sourceNote,/Yandex Webmaster/);
});
