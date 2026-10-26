import test from"node:test";import assert from"node:assert/strict";
import{mkdtempSync,rmSync}from"node:fs";import{join}from"node:path";import{tmpdir}from"node:os";
import{route,yandexGet,normalizeHistory,normalizeQueries,syncYandex,yandexDashboard,yandexSites}from"../mcp/yandex.mjs";
test("Yandex blocks write routes and external API origins",async()=>{
 assert.throws(()=>route("5","https:example.com:443","recrawl/queue"),/read-only/);
 await assert.rejects(()=>yandexGet("https://evil.example/hijack",{}, {token:"testToken",fetchImpl:async()=>{throw Error("should not fetch")}}),/blocked/);
});
test("Yandex history uses real daily values and no inferred missing ranking",()=>{
 const x=normalizeHistory({indicators:{
  TOTAL_SHOWS:[{date:"2026-10-22T00:00:00+03:00",value:30},{date:"2026-10-23T00:00:00+03:00",value:40}],
  TOTAL_CLICKS:[{date:"2026-10-23T00:00:00+03:00",value:2}],
  AVG_SHOW_POSITION:[{date:"2026-10-23T00:00:00+03:00",value:12}]
 }});
 assert.equal(x.length,2);assert.equal(x[0].clicks,null);assert.equal(x[1].ctrPercent,5);
 const q=normalizeQueries({queries:[{query_text:"baby snacks",indicators:{TOTAL_SHOWS:22,TOTAL_CLICKS:2,AVG_SHOW_POSITION:9}}]});
 assert.equal(q[0].position,9);assert.equal(q[0].impressions,22);
});
test("Yandex sync fetches only official read methods, preserves property identity, and stores index stats",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"maestro-yandex-"));const dbPath=join(dir,"test.sqlite3");
 const paths=[];
 const mock=async(request,init)=>{
  const u=new URL(request);paths.push(u.pathname);assert.equal(u.host,"api.webmaster.yandex.net");assert.equal(init.headers.Authorization,"OAuth TOKEN_TEST_123456789123456789");
  const path=decodeURIComponent(u.pathname);
  let body;
  if(path==="/v4/user")body={user_id:55};
  else if(path==="/v4/user/55/hosts")body={hosts:[{host_id:"https:example.com:443",ascii_host_url:"https://example.com/",verified:true},{host_id:"https:unverified.com:443",ascii_host_url:"https://unverified.com/",verified:false}]};
  else if(path.endsWith("/summary"))body={sqi:120,searchable_pages_count:39,excluded_pages_count:4};
  else if(path.endsWith("/diagnostics"))body={problems:{NO_SITEMAPS:{severity:"POSSIBLE_PROBLEM",state:"PRESENT"}}};
  else if(path.endsWith("/sitemaps"))body={sitemaps:[]};
  else if(path.endsWith("/search-queries/all/history"))body={indicators:{TOTAL_SHOWS:[{date:"2026-10-22T00:00:00.000+03:00",value:100}],TOTAL_CLICKS:[{date:"2026-10-22T00:00:00.000+03:00",value:3}],AVG_SHOW_POSITION:[{date:"2026-10-22T00:00:00.000+03:00",value:15}]}};
  else if(path.endsWith("/search-queries/popular"))body={date_from:"2026-09-24",date_to:"2026-10-22",queries:[{query_id:"test",query_text:"baby food",indicators:{TOTAL_SHOWS:21,TOTAL_CLICKS:2,AVG_SHOW_POSITION:11}}]};
  else throw Error("Unexpected route: "+path);
  return{ok:true,json:async()=>body};
 };
 try{
  const r=await syncYandex({dbPath,oauthToken:"TOKEN_TEST_123456789123456789",fetchImpl:mock,now:new Date("2026-10-25T00:00:00Z")});
  assert.equal(r.successes,1);assert.equal(r.failures,0);assert.equal(r.authorizedSites,1);
  assert.equal(paths.length,7);assert(paths.every(x=>!x.includes("recrawl")));
  assert.equal(yandexSites(dbPath).length,2);
  const report=yandexDashboard("https://example.com/",dbPath);
  assert.equal(report.kpis.searchablePages,39);assert.equal(report.kpis.excludedPages,4);assert.equal(report.kpis.sqi,120);
  assert.equal(report.kpis.clicks,3);assert.equal(report.kpis.impressions,100);
  assert.equal(report.topQueries[0].key,"baby food");assert.equal(report.topPages.length,0);
  assert.equal(report.problems[0].code,"NO_SITEMAPS");
 }finally{rmSync(dir,{recursive:true,force:true})}
});
