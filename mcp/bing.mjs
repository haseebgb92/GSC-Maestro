import {DatabaseSync} from "node:sqlite";
import {readFileSync,existsSync,statSync} from "node:fs";
import {join} from "node:path";
import {homedir} from "node:os";
const DIR=join(homedir(),".local/share/com.advertpreneur.gscmaestro");
export const BING_KEY_FILE=join(DIR,"bing-api-key");
export const DB_PATH=join(DIR,"maestro.sqlite3");
const ROOT="https://ssl.bing.com/webmaster/api.svc/json/";
const ALLOWED=new Set(["GetUserSites","GetRankAndTrafficStats","GetQueryStats","GetPageStats"]);
const count=x=>{const n=Number(x);return Number.isFinite(n)&&n>=0?n:0;};
export function bingCredentialStatus(){
 if(!existsSync(BING_KEY_FILE))return{connected:false,reason:"Bing API key not configured"};
 const stat=statSync(BING_KEY_FILE);
 if(stat.mode&0o077)return{connected:false,reason:"Bing key file needs private permissions (0600)"};
 const key=readFileSync(BING_KEY_FILE,"utf8").trim();
 return key.length>=24&&key.length<=256?{connected:true,authType:"Bing Webmaster API key"}:{connected:false,reason:"Invalid Bing key"};
}
function credential(){const status=bingCredentialStatus();if(!status.connected)throw Error(status.reason);return readFileSync(BING_KEY_FILE,"utf8").trim();}
export function bingDate(s){
 if(typeof s!=="string")return null;
 const match=s.match(/\/Date\((-?\d+)/);
 const d=new Date(match?Number(match[1]):s);
 return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);
}
export async function apiCall(method,params={},options={}){
 if(!ALLOWED.has(method))throw Error("Bing API method is not allowed in read-only Maestro");
 const key=options.apiKey||credential(),url=new URL(ROOT+method);
 url.searchParams.set("apikey",key);
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
 for(let attempt=0;attempt<2;attempt++){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),14000);
  try{
   const res=await(options.fetchImpl||fetch)(url.href,{headers:{Accept:"application/json"},signal:controller.signal,redirect:"error"});
   if(!res.ok){if(attempt===0&&[429,502,503,504].includes(res.status))continue;throw Error("Bing returned HTTP "+res.status);}
   const json=await res.json();
   if(json?.d===undefined)throw Error("Unexpected Bing response structure");
   return json.d;
  }catch(e){
   if(attempt===0&&/abort|fetch failed|network|timeout/i.test(String(e)))continue;
   throw Error(method+": "+String(e?.message||e).replace(/(?:api[_-]?key|apikey)=\S+/gi,"[redacted]").slice(0,220));
  }finally{clearTimeout(timeout)}
 }
 throw Error("Bing API failed after retry");
}
export function ensureTables(db){
 db.exec([
 "CREATE TABLE IF NOT EXISTS bing_sites(site_url TEXT PRIMARY KEY,verified INTEGER NOT NULL,discovered_at TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS bing_syncs(id INTEGER PRIMARY KEY AUTOINCREMENT,site_url TEXT NOT NULL,synced_at TEXT NOT NULL,first_date TEXT,last_date TEXT,daily_count INTEGER NOT NULL,query_count INTEGER NOT NULL,page_count INTEGER NOT NULL)",
 "CREATE TABLE IF NOT EXISTS bing_metrics(sync_id INTEGER NOT NULL,dimension TEXT NOT NULL,metric_key TEXT NOT NULL,clicks REAL NOT NULL,impressions REAL NOT NULL,ctr REAL NOT NULL,position REAL,dates_included INTEGER NOT NULL)",
 "CREATE INDEX IF NOT EXISTS bing_metrics_idx ON bing_metrics(sync_id,dimension)",
 "CREATE INDEX IF NOT EXISTS bing_sync_idx ON bing_syncs(site_url,id DESC)"
 ].join(";")+";");
}
function aggregate(rows,dimension){
 const map=new Map();
 for(const raw of rows){
  const key=dimension==="date"?bingDate(raw.Date):String(raw.Query||raw.Url||"").trim();
  if(!key||key.length>2048)continue;
  const clicks=count(raw.Clicks),impressions=count(raw.Impressions);
  const position=raw.AvgImpressionPosition==null?null:count(raw.AvgImpressionPosition);
  const p=map.get(key)||{key,clicks:0,impressions:0,weighted:0,weight:0,dates:new Set()};
  p.clicks+=clicks;p.impressions+=impressions;
  if(position!==null&&impressions){p.weighted+=position*impressions;p.weight+=impressions;}
  const dt=bingDate(raw.Date);if(dt)p.dates.add(dt);map.set(key,p);
 }
 return [...map.values()].map(p=>({key:p.key,clicks:p.clicks,impressions:p.impressions,ctrPercent:p.impressions?100*p.clicks/p.impressions:0,position:p.weight?p.weighted/p.weight:null,datesIncluded:Math.max(1,p.dates.size)}))
  .sort((a,b)=>dimension==="date"?a.key.localeCompare(b.key):b.impressions-a.impressions);
}
export function normalizeBing(d,q,p){
 const daily=aggregate(d,"date"),queries=aggregate(q,"query"),pages=aggregate(p,"page");
 return{daily,queries,pages,firstDate:daily[0]?.key||null,lastDate:daily.at(-1)?.key||null};
}
export async function syncBing({dbPath=DB_PATH,apiKey,fetchImpl}={}){
 const call=(name,params)=>apiCall(name,params,{apiKey,fetchImpl});
 const sites=await call("GetUserSites");
 if(!Array.isArray(sites))throw Error("Bing returned invalid site list");
 const db=new DatabaseSync(dbPath);ensureTables(db);
 const now=new Date().toISOString(),verified=sites.filter(s=>s.IsVerified===true&&typeof s.Url==="string"&&/^https?:\/\//.test(s.Url));
 const result={engine:"bing",syncedAt:now,verifiedSites:verified.length,successes:0,failures:0,sites:[]};
 try{
  const storeSite=db.prepare("INSERT OR REPLACE INTO bing_sites(site_url,verified,discovered_at) VALUES(?,?,?)");
  for(const site of sites)if(typeof site.Url==="string"&&/^https?:\/\//.test(site.Url))storeSite.run(site.Url,site.IsVerified===true?1:0,now);
  for(const site of verified){
   try{
    const [d,q,p]=await Promise.all([call("GetRankAndTrafficStats",{siteUrl:site.Url}),call("GetQueryStats",{siteUrl:site.Url}),call("GetPageStats",{siteUrl:site.Url})]);
    if(![d,q,p].every(Array.isArray))throw Error("Bing returned an incomplete stats dataset");
    const data=normalizeBing(d,q,p);
    db.exec("BEGIN IMMEDIATE");
    try{
     const id=db.prepare("INSERT INTO bing_syncs(site_url,synced_at,first_date,last_date,daily_count,query_count,page_count) VALUES(?,?,?,?,?,?,?)")
      .run(site.Url,new Date().toISOString(),data.firstDate,data.lastDate,data.daily.length,data.queries.length,data.pages.length).lastInsertRowid;
     const ins=db.prepare("INSERT INTO bing_metrics(sync_id,dimension,metric_key,clicks,impressions,ctr,position,dates_included) VALUES(?,?,?,?,?,?,?,?)");
     for(const [dim,rows] of [["date",data.daily],["query",data.queries],["page",data.pages]])for(const item of rows)
      ins.run(id,dim,item.key,item.clicks,item.impressions,item.ctrPercent,item.position,item.datesIncluded);
     for(const old of db.prepare("SELECT id FROM bing_syncs WHERE site_url=? ORDER BY id DESC LIMIT -1 OFFSET 12").all(site.Url)){
      db.prepare("DELETE FROM bing_metrics WHERE sync_id=?").run(old.id);db.prepare("DELETE FROM bing_syncs WHERE id=?").run(old.id);
     }
     db.exec("COMMIT");
    }catch(e){db.exec("ROLLBACK");throw e}
    result.successes++;result.sites.push({siteUrl:site.Url,success:true,firstDate:data.firstDate,lastDate:data.lastDate,dailyRows:data.daily.length,queryRows:data.queries.length,pageRows:data.pages.length});
   }catch(e){result.failures++;result.sites.push({siteUrl:site.Url,success:false,error:String(e?.message||e).slice(0,220)})}
  }
 }finally{db.close()}
 return result;
}
export function bingSites(dbPath=DB_PATH){
 if(!existsSync(dbPath))return[];
 const db=new DatabaseSync(dbPath,{readOnly:true});
 try{return db.prepare("SELECT s.site_url AS siteUrl,s.verified,s.discovered_at AS discoveredAt,(SELECT max(synced_at) FROM bing_syncs WHERE site_url=s.site_url) AS lastSync FROM bing_sites s ORDER BY s.site_url").all().map(x=>({...x,verified:!!x.verified}));}
 catch(e){if(String(e).includes("no such table"))return[];throw e}
 finally{db.close()}
}
export function bingStatus(dbPath=DB_PATH){
 const auth=bingCredentialStatus(),sites=bingSites(dbPath);
 return{engine:"bing",apiConnected:auth.connected,authType:auth.connected?auth.authType:null,reason:auth.reason||null,verifiedSites:sites.filter(x=>x.verified).length,sites,source:"Bing Webmaster JSON/REST API + local SQLite",lastSync:sites.map(x=>x.lastSync).filter(Boolean).sort().at(-1)||null};
}
export function bingDashboard(siteUrl,dbPath=DB_PATH){
 if(typeof siteUrl!=="string"||siteUrl.length>1000)throw Error("Provide a valid Bing property URL");
 if(!existsSync(dbPath))throw Error("No Bing data database");
 const db=new DatabaseSync(dbPath,{readOnly:true});
 try{
  let s;try{s=db.prepare("SELECT * FROM bing_syncs WHERE site_url=? ORDER BY id DESC LIMIT 1").get(siteUrl)}catch(e){if(String(e).includes("no such table"))throw Error("Bing synchronization not configured");throw e}
  if(!s)throw Error("No Bing API snapshot for that property. Connect Bing and sync first.");
  const rows=dim=>db.prepare("SELECT metric_key AS key,clicks,impressions,ctr AS ctrPercent,position,dates_included AS datesIncluded FROM bing_metrics WHERE sync_id=? AND dimension=? ORDER BY "+(dim==="date"?"metric_key ASC":"impressions DESC")+" LIMIT 100").all(s.id,dim);
  const daily=db.prepare("SELECT metric_key AS key,clicks,impressions,ctr AS ctrPercent,position,dates_included AS datesIncluded FROM bing_metrics WHERE sync_id=? AND dimension='date' AND metric_key>=date(?,'-89 days') AND metric_key<=? ORDER BY metric_key ASC").all(s.id,s.last_date,s.last_date),queries=rows("query"),pages=rows("page"),clicks=daily.reduce((sum,x)=>sum+x.clicks,0),impressions=daily.reduce((sum,x)=>sum+x.impressions,0);
  return{engine:"bing",mode:"bing",source:"Authenticated Bing Webmaster JSON/REST API snapshot",siteUrl:s.site_url,startDate:daily[0]?.key||null,endDate:daily.at(-1)?.key||null,syncedAt:s.synced_at,
   kpis:{clicks,impressions,ctrPercent:impressions?100*clicks/impressions:0,averagePosition:null},daily,topQueries:queries,topPages:pages,
   limits:{reportWindowDays:90,queryAndPagePeriod:"All available Bing query/page history, not restricted to recent 90-day KPIs",queriesNotExhaustive:true,weeklyQueryStats:true,notes:"Query/page stats have a different refresh cadence and do not necessarily sum to daily traffic. No sitewide average ranking position is provided."}};
 }finally{db.close()}
}
