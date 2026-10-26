import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {syncBing,bingDashboard} from "../mcp/bing.mjs";

test("Bing recent-window totals include latest 90 days, not first hundred rows",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"maestro-bing-window-"));
 const dbPath=join(dir,"audit.sqlite3");
 const start=Date.parse("2026-05-01T00:00:00Z");
 const daily=Array.from({length:180},(_,i)=>({
   Date:new Date(start+i*86400000).toISOString().slice(0,10),
   Clicks:i>=90?1:2,
   Impressions:i>=90?10:100
 }));
 const mock=async url=>{
   const name=new URL(url).pathname.split("/").at(-1);
   let d;
   if(name==="GetUserSites")d=[{Url:"https://example.com/",IsVerified:true}];
   else if(name==="GetRankAndTrafficStats")d=daily;
   else if(name==="GetQueryStats")d=[{Query:"historic query",Date:"2026-05-01",Clicks:1,Impressions:999,AvgImpressionPosition:8}];
   else if(name==="GetPageStats")d=[];
   else throw Error("Unexpected method: "+name);
   return {ok:true,json:async()=>({d})};
 };
 try{
   const result=await syncBing({apiKey:"ABCD".repeat(8),dbPath,fetchImpl:mock});
   assert.equal(result.successes,1);
   const report=bingDashboard("https://example.com/",dbPath);
   assert.equal(report.daily.length,90);
   assert.equal(report.startDate,daily[90].Date);
   assert.equal(report.endDate,daily[179].Date);
   assert.equal(report.kpis.clicks,90);
   assert.equal(report.kpis.impressions,900);
   assert.equal(report.limits.reportWindowDays,90);
   assert.equal(report.topQueries[0].impressions,999);
   assert.equal(report.kpis.averagePosition,null);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
