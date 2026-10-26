import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema,CallToolRequestSchema,ListResourcesRequestSchema,ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { DatabaseSync } from "node:sqlite";
import { readFileSync,existsSync } from "node:fs";
import { join,dirname,resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import {spawnSync} from "node:child_process";
import {auditPublicSite,publicAuditHistory,savedPublicAudit,canonicalInput} from "./audit.mjs";
import {getContentResearch} from "./content-research.mjs";
import {buildKeywordMap} from "./keyword-map.mjs";
import {bingStatus,bingSites,bingDashboard} from "./bing.mjs";
import {yandexStatus,yandexSites,yandexDashboard} from "./yandex.mjs";

const ROOT=dirname(fileURLToPath(import.meta.url));
const PUBLIC_BASE=(process.env.GSC_MAESTRO_PUBLIC_BASE_URL||"").trim().replace(/\/+$/,"");
const ICON_META=PUBLIC_BASE?[{src:PUBLIC_BASE+"/icon.png",mimeType:"image/png",sizes:["512x512"]}]:[];
const DB_PATH=process.env.GSC_MAESTRO_DB||join(homedir(),".local/share/com.advertpreneur.gscmaestro/maestro.sqlite3");
const URI="ui://gsc-maestro/overview";
const resources=[{uri:URI,name:"GSC Maestro Search Dashboard",title:"GSC Maestro · Visual Search Intelligence",description:"Interactive Google Bing and Yandex verified search performance, technical audit evidence, Google indexing, AI citation history, and sortable queries and pages",mimeType:"text/html;profile=mcp-app",icons:ICON_META}];
const tools=[
 {name:"maestro_yandex_status",title:"Yandex Webmaster Connection & Sync",description:"Read Yandex OAuth configuration status, verified site list, last API snapshot, automatic sync job and freshness. No Google/Bing values substituted.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"maestro_yandex_sites",title:"List Verified Yandex Websites",description:"List Yandex Webmaster sites returned by that account, including verified flags and last successful sync dates.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"maestro_yandex_dashboard",title:"Yandex Search and Indexing Dashboard",description:"Official Yandex Webmaster API search clicks, impressions, query history, Yandex quality index, indexed/excluded page counts, technical diagnostics and saved sitemap data; absent fields remain null.",inputSchema:{type:"object",properties:{siteUrl:{type:"string",description:"Exact verified and synchronized Yandex site URL"}},required:["siteUrl"],additionalProperties:false},_meta:{ui:{resourceUri:URI},"openai/outputTemplate":URI}},
 {name:"maestro_yandex_sync_now",title:"Refresh Yandex Webmaster Metrics",description:"Queue read-only authorized Yandex Webmaster API synchronization. Requires Yandex OAuth token configured in the desktop app.",inputSchema:{type:"object",properties:{},additionalProperties:false}},

 {name:"maestro_indexing_inspect_url",title:"Inspect a Verified Google URL",description:"Fetch Google's current URL Inspection API response for ONE URL within an authorized Search Console property, save it to the local inspection history, and show the actual Google index status. No URL submission or changes.",inputSchema:{type:"object",properties:{siteUrl:{type:"string",description:"Exact verified GSC property, e.g. sc-domain:example.com"},inspectionUrl:{type:"string",description:"Absolute HTTP(S) page URL belonging to that property"}},required:["siteUrl","inspectionUrl"],additionalProperties:false}},
 {name:"maestro_indexing_history",title:"Recent Google URL Inspection Records",description:"Read the latest stored Google URL Inspection responses, actual indexed/coverage status, crawl dates and canonicals for one authorized property. Does not perform live inspection.",inputSchema:{type:"object",properties:{siteUrl:{type:"string"}},required:["siteUrl"],additionalProperties:false}},
 {name:"maestro_indexing_sitemaps",title:"Google Sitemap Status",description:"Retrieve live submitted sitemap status from the Search Console API for an authorized site. Requires existing read-only Google OAuth.",inputSchema:{type:"object",properties:{siteUrl:{type:"string"}},required:["siteUrl"],additionalProperties:false}},
 {name:"maestro_ai_search_report",title:"Bing AI Performance Citation Report",description:"Read source-labeled manual Bing AI Performance CSV imports for one website (citation trends, grounding queries, cited pages). Distinct from Google/Bing organic clicks and rankings; never infer AI citations.",inputSchema:{type:"object",properties:{siteUrl:{type:"string"}},required:["siteUrl"],additionalProperties:false}},
 {name:"maestro_pages_report",title:"Landing Page Performance by Engine",description:"Retrieve landing-page rows from real Google Search Console or Bing Webmaster snapshots. Keep reporting periods and API row coverage distinct.",inputSchema:{type:"object",properties:{engine:{type:"string",enum:["google","bing"]},siteUrl:{type:"string"},limit:{type:"integer",minimum:1,maximum:100}},required:["engine","siteUrl"],additionalProperties:false}},

 {name:"maestro_bing_status",title:"Bing Connection & Sync Health",description:"Check whether Bing Webmaster Tools is connected, list locally verified sites and last real Bing API data dates. No Google data is substituted.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"maestro_bing_sites",title:"List Bing Webmaster Sites",description:"List the Bing Webmaster account properties discovered by authenticated Bing API calls, including verification and synchronization timestamps.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"maestro_bing_dashboard",title:"Open Bing Search Performance Dashboard",description:"Show authenticated Bing Webmaster Search Performance: actual daily clicks and impressions, Bing queries and pages, with proper data freshness and visual charts. Bing sitewide average position is unavailable.",inputSchema:{type:"object",properties:{siteUrl:{type:"string",description:"Exact Bing property URL, e.g. https://example.com/"}},required:["siteUrl"],additionalProperties:false},_meta:{ui:{resourceUri:URI},"openai/outputTemplate":URI}},
 {name:"maestro_bing_sync_now",title:"Refresh Bing Search Data",description:"Queue read-only Bing Webmaster JSON API synchronization via the local systemd user service. Requires Bing API authorization first.",inputSchema:{type:"object",properties:{},additionalProperties:false}},

 {name:"maestro_sync_status",title:"Sync Health and Freshness",description:"Check GSC Maestro automatic Google Search Console sync status, last successful run, next scheduled time, connection health and latest per-property data. Read-only.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"maestro_sync_now",title:"Synchronize Google Data Now",description:"Queue a read-only Google Search Console API update for all verified sites via the existing safe systemd job. Returns immediately; check maestro_sync_status for progress. Does not modify websites or Google Search Console settings.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"maestro_refresh_properties",title:"Refresh Connected Property List",description:"Queue a fresh discovery of Google Search Console properties authorized to the existing desktop OAuth account; adds/removes nothing in Google, updates local property list. Does not reconnect Google accounts.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"maestro_audit_report",title:"Open Saved Public SEO Audit",description:"Open the complete saved public crawling report, including its observations, per-page findings and visual charts, by ID from maestro_audit_history. Does not recrawl.",inputSchema:{type:"object",properties:{id:{type:"integer",minimum:1,description:"Saved public audit id from maestro_audit_history"}},required:["id"],additionalProperties:false},_meta:{ui:{resourceUri:URI},"openai/outputTemplate":URI}},

 {name:"maestro_analyze_site",title:"Analyze Any Website",description:"Automatically route authorized Search Console properties to real GSC performance reports; otherwise respectfully crawl public pages for technical/on-page SEO findings. Never invent organic traffic or rankings for an unauthorized domain.",inputSchema:{type:"object",properties:{url:{type:"string",description:"Website domain or http(s) URL"},maxPages:{type:"integer",minimum:1,maximum:12,description:"Maximum public pages to crawl if not authorized (default 8)"}},required:["url"],additionalProperties:false},_meta:{ui:{resourceUri:URI},"openai/outputTemplate":URI}},
 {name:"maestro_audit_history",title:"Recent Public Audits",description:"List up to 20 locally cached public website audit summaries, without recrawling",inputSchema:{type:"object",properties:{},additionalProperties:false}},

 {name:"maestro_dashboard",title:"Open GSC Maestro Dashboard",description:"Open the branded interactive GSC Maestro dashboard in chat. Choose any connected site to see its real Search Console trends, clicks, impressions, position, query and page tables. No demo data.",inputSchema:{type:"object",properties:{siteUrl:{type:"string",description:"Optional exact authorized property name. Omit to open the default synced property."}},additionalProperties:false},_meta:{ui:{resourceUri:URI},"openai/outputTemplate":URI}},

 {name:"maestro_list_properties",description:"List GSC Maestro's authorized/cached Google Search Console property names. Read-only, no live Google request.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"maestro_overview",description:"Display the latest synchronized Search Console property performance summary with a visual chart and query table. Data sourced from GSC Maestro's local, read-only Google sync; never simulated.",inputSchema:{type:"object",properties:{siteUrl:{type:"string",description:"Exact site URL as listed by maestro_list_properties"}},required:["siteUrl"],additionalProperties:false},_meta:{ui:{resourceUri:URI},"openai/outputTemplate":URI}},
 {name:"maestro_content_research",title:"Content Opportunity Research",description:"Read evidence-based Last30Days discussions, verified GSC queries and keyword-research status for an authorized Advertpreneur or CooCoo Babys property. Nothing is published or invented.",inputSchema:{type:"object",properties:{siteUrl:{type:"string",description:"Exact verified GSC property URL"},channel:{type:"string",enum:["seo","instagram","linkedin"]}},required:["siteUrl"],additionalProperties:false}},
 {name:"maestro_top_queries",description:"Top Google search queries for a synced property; columns: query, clicks, impressions, CTR %, average position. Does not invent hidden/anonymized queries.",inputSchema:{type:"object",properties:{siteUrl:{type:"string"},limit:{type:"integer",minimum:1,maximum:100}},required:["siteUrl"],additionalProperties:false}},
 {name:"maestro_top_pages",description:"Top Google search pages from the latest GSC Maestro sync, with clicks, impressions, CTR %, average position.",inputSchema:{type:"object",properties:{siteUrl:{type:"string"},limit:{type:"integer",minimum:1,maximum:100}},required:["siteUrl"],additionalProperties:false}},
 {name:"maestro_daily_performance",description:"Day-by-day Google Search Console clicks, impressions, CTR and average position, suitable for charts.",inputSchema:{type:"object",properties:{siteUrl:{type:"string"}},required:["siteUrl"],additionalProperties:false}},
 {name:"maestro_keyword_map",title:"Search Opportunity Keyword Clusters",description:"Read-only OpenSEO-inspired keyword clusters and tentative existing-page matches from a verified property's directly synced GSC query and page snapshots. Groups related search terms, highlights near-ranking opportunities, flags possible page overlap, and never invents Google Ads volumes or query-page attribution.",inputSchema:{type:"object",properties:{siteUrl:{type:"string",description:"Exact verified and synchronized Google Search Console property"},minImpressions:{type:"integer",minimum:1,maximum:10000},limit:{type:"integer",minimum:1,maximum:50}},required:["siteUrl"],additionalProperties:false}},
 {name:"maestro_opportunities",description:"Deterministic potential quick wins from Google Search Console query rows with positions 4-20, sorted by impressions; not a guarantee of ranking gains.",inputSchema:{type:"object",properties:{siteUrl:{type:"string"},limit:{type:"integer",minimum:1,maximum:100}},required:["siteUrl"],additionalProperties:false}}
 ];
for(const tool of tools){tool.icons=ICON_META;}
let db;
function getDb(){
 if(!existsSync(DB_PATH))throw Error("No GSC Maestro database yet. Open the desktop application first.");
 if(!db)db=new DatabaseSync(DB_PATH,{readOnly:true});
 return db;
}
function clamp(n,min=1,max=100){return Number.isInteger(n)?Math.max(min,Math.min(max,n)):20}
function properties(){
 return getDb().prepare("SELECT s.site_url AS siteUrl,s.permission,s.updated_at AS updatedAt,MAX(g.synced_at) AS lastSync FROM gsc_sites s LEFT JOIN gsc_syncs g ON s.site_url=g.site_url GROUP BY s.site_url ORDER BY s.site_url").all();
}
function snapshot(siteUrl){
 if(!siteUrl||typeof siteUrl!=="string"||siteUrl.length>1000)throw Error("Supply a valid property URL");
 const s=getDb().prepare("SELECT id,site_url AS siteUrl,start_date AS startDate,end_date AS endDate,synced_at AS syncedAt,query_rows_limited AS queryRowsLimited,page_rows_limited AS pageRowsLimited FROM gsc_syncs WHERE site_url=? ORDER BY id DESC LIMIT 1").get(siteUrl);
 if(!s)throw Error("No synchronized Google data for this property. Use the GSC Maestro desktop Sync action.");
 return s;
}
function metrics(id,dimension,limit){
 const order=dimension==="date"?"key ASC":"clicks DESC";
 const sql=`SELECT key,clicks,impressions,ctr AS ctrPercent,position FROM gsc_metrics WHERE sync_id=? AND dimension=? ORDER BY ${order}${limit?" LIMIT "+clamp(limit):""}`;
 return getDb().prepare(sql).all(id,dimension);
}
function avg(rows){const clicks=rows.reduce((sum,r)=>sum+r.clicks,0),impressions=rows.reduce((sum,r)=>sum+r.impressions,0);return{clicks,impressions,ctrPercent:impressions?clicks/impressions*100:0,averagePosition:impressions?rows.reduce((sum,r)=>sum+r.position*r.impressions,0)/impressions:0};}
function provenance(s){return{source:"GSC Maestro SQLite cache of directly authorized Google Search Console API",siteUrl:s.siteUrl,startDate:s.startDate,endDate:s.endDate,syncedAt:s.syncedAt,limits:{queryRowsLimited:!!s.queryRowsLimited,pageRowsLimited:!!s.pageRowsLimited,anonymizedQueriesMayBeOmitted:true,finalizedDataLags:true}};}
function siteForUrl(raw){
 const url=canonicalInput(raw);
 const candidates=properties().filter(p=>p.permission!=="siteUnverifiedUser"&&p.lastSync&&(
 p.siteUrl.startsWith("sc-domain:")?(()=>{
  const d=p.siteUrl.slice(10).toLowerCase();return url.hostname.toLowerCase()===d||url.hostname.toLowerCase().endsWith("."+d);
 })():url.href.startsWith(p.siteUrl)));
 // Prefer domain property, then the longest URL prefix.
 return candidates.sort((a,b)=>(a.siteUrl.startsWith("sc-domain:")?0:1)-(b.siteUrl.startsWith("sc-domain:")?0:1)||b.siteUrl.length-a.siteUrl.length)[0]||null;
}
function userBusEnv(){
 const runtime=process.env.XDG_RUNTIME_DIR||`/run/user/${process.getuid()}`;
 return {...process.env,XDG_RUNTIME_DIR:runtime,DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS||`unix:path=${runtime}/bus`};
}
function systemdUnit(unit) {
 const result=spawnSync("systemctl",["--user","show",unit,"-p","ActiveState","-p","Result","-p","ExecMainStatus","-p","ExecMainStartTimestamp","-p","ExecMainExitTimestamp","-p","NextElapseUSecRealtime","-p","LastTriggerUSec","-p","UnitFileState"],{encoding:"utf8",timeout:3000,maxBuffer:12000,env:userBusEnv()});
 if(result.error||result.status!==0)return{error:String(result.error?.message||result.stderr).slice(0,250)};
 return Object.fromEntries(result.stdout.split("\n").filter(Boolean).map(x=>[x.slice(0,x.indexOf("=")),x.slice(x.indexOf("=")+1)]));
}
function syncStatus(){
 const sites=properties();
 const timer=systemdUnit("gsc-maestro-sync.timer"),service=systemdUnit("gsc-maestro-sync.service");
 const discovery=systemdUnit("gsc-maestro-discover.service");
 const bySite=sites.map(x=>{
  const record=getDb().prepare("SELECT start_date AS startDate,end_date AS endDate,synced_at AS syncedAt FROM gsc_syncs WHERE site_url=? ORDER BY id DESC LIMIT 1").get(x.siteUrl);
  return{siteUrl:x.siteUrl,permission:x.permission,latestRecord:record||null};
 });
 return{source:"Local systemd user scheduler and GSC Maestro SQLite snapshots",syncedAt:new Date().toISOString(),mcpServer:"active",autoSyncEnabled:timer.UnitFileState==="enabled",timerActive:timer.ActiveState==="active",nextScheduledRun:timer.NextElapseUSecRealtime||null,lastScheduledTrigger:timer.LastTriggerUSec||null,jobActive:service.ActiveState==="activating"||service.ActiveState==="active",jobResult:service.Result||null,jobExitStatus:service.ExecMainStatus||null,lastJobStarted:service.ExecMainStartTimestamp||null,lastJobFinished:service.ExecMainExitTimestamp||null,discoveryActive:discovery.ActiveState==="activating"||discovery.ActiveState==="active",verifiedProperties:bySite.filter(x=>x.permission!=="siteUnverifiedUser").length,propertyCount:bySite.length,sites:bySite,note:"A successfully completed sync is a fresh API fetch; GSC finalized reporting dates may still lag 2–3 days."};
}
function queueUnit(unit){
 const service=systemdUnit(unit);
 if(service.ActiveState==="active"||service.ActiveState==="activating")return{queued:false,alreadyRunning:true,unit,message:"Job already running; check maestro_sync_status."};
 const result=spawnSync("systemctl",["--user","start","--no-block",unit],{encoding:"utf8",timeout:5000,maxBuffer:8000,env:userBusEnv()});
 if(result.error||result.status!==0)throw Error("Could not queue user systemd job: "+String(result.error?.message||result.stderr).slice(0,350));
 return{queued:true,unit,startedAt:new Date().toISOString(),message:"Background job queued; check maestro_sync_status for completion and the latest synchronized dates."};
}
function cliReadOnly(args){
 const executable=join(homedir(),".local/opt/gsc-maestro/gsc-maestro");
 if(!existsSync(executable))throw Error("GSC Maestro native URL Inspection worker is not installed");
 const res=spawnSync(executable,args,{encoding:"utf8",timeout:43000,maxBuffer:1500000,env:userBusEnv()});
 if(res.error||res.status!==0)throw Error(("Google request failed: "+String(res.error?.message||res.stderr||"Unexpected inspection response")).slice(0,380));
 try{return JSON.parse(res.stdout)}catch{throw Error("Google returned invalid JSON")}
}
function inspectionRecords(siteUrl){
 if(typeof siteUrl!=="string"||siteUrl.length>1000)throw Error("Provide an authorized GSC property");
 if(!properties().some(p=>p.siteUrl===siteUrl&&p.permission!=="siteUnverifiedUser"))throw Error("Google property is not verified in GSC Maestro");
 try{
  const rows=getDb().prepare("SELECT id,inspection_url AS inspectionUrl,inspected_at AS inspectedAt,result_json AS result FROM index_inspections WHERE site_url=? ORDER BY id DESC LIMIT 80").all(siteUrl);
  return rows.map(r=>({id:r.id,inspectionUrl:r.inspectionUrl,inspectedAt:r.inspectedAt,inspection:JSON.parse(r.result)}));
 }catch(e){if(String(e).includes("no such table"))return[];throw e}
}
function aiRecords(siteUrl){
 if(typeof siteUrl!=="string"||siteUrl.length>512)throw Error("Select a Bing property");
 if(!bingSites().some(s=>s.siteUrl===siteUrl&&s.verified))throw Error("Bing property not verified in local account");
 let imports;try{imports=getDb().prepare("SELECT id,dimension,filename,imported_at AS importedAt FROM ai_imports WHERE site_url=? AND engine='bing' ORDER BY id DESC LIMIT 30").all(siteUrl)}
 catch(e){if(String(e).includes("no such table"))return{siteUrl,source:"No Bing AI Performance CSV imports",imports:[],series:[]};throw e}
 const found=new Set(),series=[];
 for(const record of imports){if(found.has(record.dimension))continue;found.add(record.dimension);
  const rows=getDb().prepare("SELECT metric_key AS key,citations FROM ai_metrics WHERE import_id=? ORDER BY citations DESC LIMIT 300").all(record.id);
  series.push({dimension:record.dimension,importedAt:record.importedAt,source:"Bing AI Performance manual CSV export, NOT Bing Webmaster JSON API",rows});
 }
 return{siteUrl,imports,series,limits:["Imported citation records only; different from organic search impressions, clicks or rankings","Bing source may be aggregated or sampled. Per-dimension time windows can differ."]};
}
function call(name,args){
 if(name==="maestro_yandex_status"){
  const t=systemdUnit("gsc-maestro-yandex-sync.timer"),j=systemdUnit("gsc-maestro-yandex-sync.service");
  return{...yandexStatus(),autoSyncEnabled:t.UnitFileState==="enabled",timerActive:t.ActiveState==="active",nextScheduledRun:t.NextElapseUSecRealtime||null,lastJobResult:j.Result||null,jobActive:j.ActiveState==="active"||j.ActiveState==="activating"};
 }
 if(name==="maestro_yandex_sites")return{engine:"yandex",sites:yandexSites(),connection:yandexStatus()};
 if(name==="maestro_yandex_dashboard")return{...yandexDashboard(args.siteUrl),properties:yandexSites().filter(s=>s.verified&&s.lastSync)};
 if(name==="maestro_yandex_sync_now"){
  const status=yandexStatus();
  if(!status.tokenConfigured)throw Error("Yandex not connected. Open GSC Maestro desktop -> Yandex and authorize a read-only Yandex Webmaster OAuth token.");
  return queueUnit("gsc-maestro-yandex-sync.service");
 }

 if(name==="maestro_indexing_history")return{engine:"google",siteUrl:args.siteUrl,source:"Saved authorized Google URL Inspection API",rows:inspectionRecords(args.siteUrl)};
 if(name==="maestro_indexing_inspect_url"){
  if(typeof args.siteUrl!=="string"||typeof args.inspectionUrl!=="string"||args.inspectionUrl.length>2048)throw Error("Provide a valid property and URL");
  return{engine:"google",siteUrl:args.siteUrl,inspectionUrl:args.inspectionUrl,source:"Live official Google URL Inspection API",result:cliReadOnly(["--inspect-url",args.siteUrl,args.inspectionUrl])};
 }
 if(name==="maestro_indexing_sitemaps"){
  if(typeof args.siteUrl!=="string")throw Error("Provide a verified property");
  return{engine:"google",siteUrl:args.siteUrl,source:"Live Google Search Console Sitemaps API",result:cliReadOnly(["--list-sitemaps",args.siteUrl])};
 }
 if(name==="maestro_ai_search_report")return{engine:"bing",...aiRecords(args.siteUrl)};
 if(name==="maestro_pages_report"){
  if(args.engine==="bing"){const report=bingDashboard(args.siteUrl);return{engine:"bing",siteUrl:report.siteUrl,source:report.source,period:"Bing historical page data may exceed latest 90-day daily-KPI window",syncedAt:report.syncedAt,rows:report.topPages.slice(0,clamp(args.limit)),limits:report.limits}}
  if(args.engine==="google"){const snap=snapshot(args.siteUrl);return{engine:"google",...provenance(snap),rows:metrics(snap.id,"page",args.limit)}}
  throw Error("Select google or bing");
 }

 if(name==="maestro_bing_status"){
  const t=systemdUnit("gsc-maestro-bing-sync.timer"),j=systemdUnit("gsc-maestro-bing-sync.service");
  return{...bingStatus(),autoSyncEnabled:t.UnitFileState==="enabled",timerActive:t.ActiveState==="active",nextScheduledRun:t.NextElapseUSecRealtime||null,lastJobResult:j.Result||null,jobActive:j.ActiveState==="activating"||j.ActiveState==="active"};
 }
 if(name==="maestro_bing_sites")return{engine:"bing",sites:bingSites(),connection:bingStatus()};
 if(name==="maestro_bing_dashboard")return{...bingDashboard(args.siteUrl),properties:bingSites().filter(x=>x.verified&&x.lastSync)};
 if(name==="maestro_bing_sync_now"){
  const status=bingStatus();
  if(!status.apiConnected)throw Error("Bing API not connected. Open the desktop app → Bing Webmaster → enter your existing Bing Webmaster API key first.");
  return queueUnit("gsc-maestro-bing-sync.service");
 }

 if(name==="maestro_sync_status")return syncStatus();
 if(name==="maestro_sync_now")return queueUnit("gsc-maestro-sync.service");
 if(name==="maestro_refresh_properties")return queueUnit("gsc-maestro-discover.service");
 if(name==="maestro_audit_report"){
  const id=args.id;
  if(!Number.isSafeInteger(id)||id<1)throw Error("Supply a valid saved audit ID");
  const report=savedPublicAudit(id,DB_PATH);
  if(!report)throw Error("Public audit not found or no longer retained");
  return report;
 }
 if(name==="maestro_content_research")return getContentResearch(args,properties().filter(p=>p.permission!=="siteUnverifiedUser"&&p.lastSync).map(p=>p.siteUrl));
 if(name==="maestro_list_properties")return{source:"GSC Maestro local cache",properties:properties()};
 if(name==="maestro_audit_history")return{mode:"public_history",audits:publicAuditHistory(DB_PATH)};

 if(name==="maestro_dashboard"){
  const prop=properties().filter(p=>p.lastSync && p.permission!=="siteUnverifiedUser");
  if(!prop.length)throw Error("No Google Search Console snapshots yet. Open the GSC Maestro desktop app and synchronize a verified property.");
  const preferred=prop.find(p=>p.siteUrl==="sc-domain:example.com")||prop.find(p=>p.siteUrl==="sc-domain:advertpreneur.com")||prop[0];
  const siteUrl=args.siteUrl||preferred.siteUrl;
  if(!prop.some(p=>p.siteUrl===siteUrl))throw Error("Choose a synchronized verified Search Console property from the list");
  const snapshotRecord=snapshot(siteUrl);
  return {...provenance(snapshotRecord),kpis:avg(metrics(snapshotRecord.id,"date")),daily:metrics(snapshotRecord.id,"date"),topQueries:metrics(snapshotRecord.id,"query",100),topPages:metrics(snapshotRecord.id,"page",100),properties:prop};
 }
 const s=snapshot(args.siteUrl);
 const meta=provenance(s);
 if(name==="maestro_overview"){
  const daily=metrics(s.id,"date");
  return {...meta,kpis:avg(daily),daily,topQueries:metrics(s.id,"query",12),topPages:metrics(s.id,"page",8)};
 }
 if(name==="maestro_top_queries")return{...meta,rows:metrics(s.id,"query",args.limit)};
 if(name==="maestro_top_pages")return{...meta,rows:metrics(s.id,"page",args.limit)};
 if(name==="maestro_daily_performance")return{...meta,daily:metrics(s.id,"date")};
 function keywordMapFor(siteUrl, minImpressions=20, limit=20){
   if(!properties().some(p=>p.siteUrl===siteUrl&&p.permission!=="siteUnverifiedUser"&&p.lastSync))throw Error("Choose a verified synchronized Google Search Console property");
   const snap=snapshot(siteUrl);
   const queries=getDb().prepare("SELECT key,clicks,impressions,ctr AS ctrPercent,position FROM gsc_metrics WHERE sync_id=? AND dimension='query' AND impressions>0 ORDER BY impressions DESC LIMIT 1500").all(snap.id);
   const pages=getDb().prepare("SELECT key,clicks,impressions,ctr AS ctrPercent,position FROM gsc_metrics WHERE sync_id=? AND dimension='page' AND impressions>0 ORDER BY impressions DESC LIMIT 400").all(snap.id);
   return buildKeywordMap({siteUrl,queries,pages,minImpressions,limit,...snap});
 }
 if(name==="maestro_keyword_map")return keywordMapFor(args.siteUrl,args.minImpressions??20,args.limit??20);
 if(name==="maestro_opportunities"){
  const rows=getDb().prepare("SELECT key,clicks,impressions,ctr AS ctrPercent,position FROM gsc_metrics WHERE sync_id=? AND dimension='query' AND position>=4 AND position<=20 ORDER BY impressions DESC LIMIT ?").all(s.id,clamp(args.limit));
  return{...meta,method:"Potential opportunities based only on position 4-20 and impressions; no forecast of actual gains",rows,keywordMap:keywordMapFor(args.siteUrl,20,8)};
 }
 throw Error("Unknown tool");
}
export function createMaestroServer(){
const server=new Server({name:"gsc-maestro",title:"GSC Maestro",version:"1.0.0",description:"Advertpreneur read-only visual Google Search Console analytics",icons:ICON_META},{capabilities:{tools:{},resources:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools}));
server.setRequestHandler(ListResourcesRequestSchema,async()=>({resources}));
server.setRequestHandler(ReadResourceRequestSchema,async req=>{
 if(req.params.uri!==URI)throw Error("Unknown MCP App resource");
 return{contents:[{uri:URI,mimeType:"text/html;profile=mcp-app",text:readFileSync(join(ROOT,"maestro-overview.html"),"utf8"),_meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}}}}]};
});
server.setRequestHandler(CallToolRequestSchema,async req=>{
 try{
  const name=req.params.name;
  if(!tools.some(tool=>tool.name===name))throw Error("Unrecognized tool name");
  let result;
  if(name==="maestro_analyze_site"){
   const args=req.params.arguments||{};
   const connected=siteForUrl(args.url);
   if(connected){
    result={...call("maestro_dashboard",{siteUrl:connected.siteUrl}),mode:"gsc",requestedUrl:args.url};
   }else result=await auditPublicSite(args.url,{maxPages:args.maxPages,dbPath:DB_PATH});
  }else result=call(name,req.params.arguments||{});

  const summary=name==="maestro_yandex_status" ? "Yandex OAuth: "+(result.apiConnected?"connected":result.tokenConfigured?"token stored but unverified":"not connected")+". "+result.verifiedSites+" verified websites. Auto-sync "+(result.autoSyncEnabled?"enabled":"disabled")+"."
  :name==="maestro_yandex_sites" ? "Yandex Webmaster: "+result.sites.length+" cached site entries. Authorization is required for live reports."
  :name==="maestro_yandex_dashboard" ? "Yandex verified "+result.siteUrl+"; search clicks "+result.kpis.clicks+", impressions "+result.kpis.impressions+", searchable pages "+result.kpis.searchablePages+". Official source details attached."
  :name==="maestro_yandex_sync_now" ? result.message
  :name==="maestro_indexing_inspect_url" ? `Official Google URL Inspection completed for ${result.inspectionUrl}. Structured index evidence attached.`
  :name==="maestro_indexing_history" ? `Found ${result.rows.length} saved Google URL Inspection records for ${result.siteUrl}.`
  :name==="maestro_indexing_sitemaps" ? `Google submitted sitemap response retrieved for ${result.siteUrl}.`
  :name==="maestro_ai_search_report" ? `Found ${result.imports.length} source-attributed Bing AI citation CSV imports for ${result.siteUrl}. No search-traffic data substituted.`
  :name==="maestro_pages_report" ? `Found ${result.rows.length} ${result.engine} landing-page rows for ${result.siteUrl}. Source date limitations attached.`
  :name==="maestro_bing_status" ? `Bing Webmaster API: ${result.apiConnected?"connected":"not connected"}. ${result.verifiedSites} verified sites, automatic sync ${result.autoSyncEnabled?"enabled":"disabled"}. Full status attached.`
  :name==="maestro_bing_sites" ? `Found ${result.sites.length} Bing Webmaster properties from the authorized local cache.`
  :name==="maestro_bing_dashboard" ? `Bing Webmaster ${result.siteUrl}: ${result.kpis.clicks} clicks and ${result.kpis.impressions} impressions, for ${result.startDate} through ${result.endDate}. Query/page data may refresh weekly; dashboard attached.`
  :name==="maestro_bing_sync_now" ?result.message
  :name==="maestro_sync_status"
  ?`Automatic sync: ${result.autoSyncEnabled&&result.timerActive?"enabled":"disabled"}. Last service result: ${result.jobResult||"unknown"}. Next: ${result.nextScheduledRun||"not scheduled"}. ${result.verifiedProperties} verified properties. Detailed status attached.`
  :name==="maestro_sync_now"||name==="maestro_refresh_properties" ?result.message
  :name==="maestro_audit_report" ?`Saved audit #${req.params.arguments.id} for ${result.domain}: ${result.pages.length} pages, heuristic score ${result.summary.score}/100. Full report attached.`
  :name==="maestro_analyze_site"&&result.mode==="public"
  ?`GSC Maestro public audit of ${result.domain}: ${result.pages.length} crawled pages, heuristic on-page score ${result.summary.score}/100, ${result.summary.issueCount} issues. No verified search traffic/rankings are available. Structured report attached.`
  :name==="maestro_audit_history" ? `Found ${result.audits.length} saved public website audits.`
  :name==="maestro_keyword_map" ? `GSC keyword map for ${result.siteUrl}: ${result.clusters.length} lexical clusters and existing-page candidates. First-party impressions only; URL matches are hypotheses requiring verification. No website changes.`
  :name==="maestro_content_research" ? `Content research for ${result.siteUrl}: ${result.gscQueries.length} GSC queries and ${result.recentDiscussions.available?"saved public community research":"no recent public research"}; Google Ads Keyword Planner status: ${result.keywordPlanner.status}. No posts were created.`
  :name==="maestro_list_properties"
  ?`Found ${result.properties.length} locally cached GSC properties.`
  :`GSC Maestro data for ${result.siteUrl}; reporting period ${result.startDate} to ${result.endDate}; synchronized ${result.syncedAt}. Source: direct Google Search Console API snapshot, not realtime. Additional structured data attached.`;
  return{content:[{type:"text",text:summary}],structuredContent:result};
 }catch(e){return{isError:true,content:[{type:"text",text:String(e.message||e)}]};}
});
return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const server=createMaestroServer();
 const transport=new StdioServerTransport();
 await server.connect(transport);
}
