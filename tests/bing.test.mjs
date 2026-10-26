import test from "node:test";
import assert from "node:assert/strict";
import{mkdtempSync,rmSync}from"node:fs";import{join}from"node:path";import{tmpdir}from"node:os";
import{bingDate,normalizeBing,apiCall,syncBing,bingSites,bingDashboard}from"../mcp/bing.mjs";
test("Bing dates, position and aggregation are not fabricated",()=>{
 assert.equal(bingDate("/Date(1792800000000+0000)/"),"2026-10-24");
 const result=normalizeBing(
 [{Date:"2026-10-23",Clicks:1,Impressions:100},{Date:"2026-10-24",Clicks:2,Impressions:50}],
 [{Date:"2026-10-17",Query:"natural dog snacks",Clicks:1,Impressions:20,AvgImpressionPosition:7},{Date:"2026-10-24",Query:"natural dog snacks",Clicks:2,Impressions:30,AvgImpressionPosition:8}],
 []);
 assert.equal(result.daily.length,2);assert.equal(result.queries.length,1);assert.equal(result.queries[0].impressions,50);
 assert.equal(result.queries[0].position,7.6);assert.equal(result.daily[0].position,null);
});
test("Bing API rejects write methods",async()=>{
 await assert.rejects(()=>apiCall("SubmitUrl",{}, {apiKey:"test".repeat(8),fetchImpl:async()=>{throw Error("must not fetch")}}),/read-only/);
});
test("Two authorized Bing sites are persisted and returned without fake search positions",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"maestro-bing-test-"));const dbPath=join(dir,"test.sqlite3");
 let requests=0;const mock=async url=>{
  requests++;
  const parsed=new URL(url);
  const method=parsed.pathname.split("/").at(-1);
  const site=parsed.searchParams.get("siteUrl");
  assert.equal(parsed.searchParams.get("apikey"),"ABCD".repeat(8));
  let d;
  if(method==="GetUserSites")d=[{Url:"https://coocoobabys.com/",IsVerified:true},{Url:"https://advertpreneur.com/",IsVerified:true}];
  else if(method==="GetRankAndTrafficStats")d=[{Date:"2026-10-23",Clicks:1,Impressions:120},{Date:"2026-10-24",Clicks:0,Impressions:88}];
  else if(method==="GetQueryStats")d=[{Query:"test keyword",Date:"2026-10-17",Clicks:1,Impressions:100,AvgImpressionPosition:9.2}];
  else if(method==="GetPageStats")d=[{Query:site+"article/",Date:"2026-10-17",Clicks:1,Impressions:84,AvgImpressionPosition:6.2}];
  else throw Error("Unexpected endpoint "+method);
  return {ok:true,json:async()=>({d})};
 };
 try{
  const data=await syncBing({apiKey:"ABCD".repeat(8),dbPath,fetchImpl:mock});
  assert.equal(data.successes,2);assert.equal(data.failures,0);assert.equal(requests,7);
  const sites=bingSites(dbPath);assert.equal(sites.length,2);assert(sites.every(s=>s.verified));
  const report=bingDashboard("https://coocoobabys.com/",dbPath);
  assert.equal(report.engine,"bing");assert.equal(report.kpis.impressions,208);assert.equal(report.kpis.clicks,1);
  assert.equal(report.kpis.averagePosition,null);assert.equal(report.topQueries[0].position,9.2);
  assert.equal(report.topPages[0].key,"https://coocoobabys.com/article/");
 }finally{rmSync(dir,{recursive:true,force:true})}
});
