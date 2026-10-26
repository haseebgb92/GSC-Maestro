import{DatabaseSync}from"node:sqlite";
import{existsSync,readFileSync,statSync}from"node:fs";import{join}from"node:path";import{homedir}from"node:os";
export const DB_PATH=join(homedir(),".local/share/com.advertpreneur.gscmaestro/maestro.sqlite3");
export const TOKEN_PATH=join(homedir(),".local/share/com.advertpreneur.gscmaestro/yandex-oauth-token");
const ROOT="https://api.webmaster.yandex.net/v4/";
export function credentialStatus(){
 if(!existsSync(TOKEN_PATH))return{configured:false,reason:"Yandex OAuth token not configured"};
 if(statSync(TOKEN_PATH).mode&0o077)return{configured:false,reason:"Yandex token requires private 0600 file permissions"};
 const value=readFileSync(TOKEN_PATH,"utf8").trim();
 return /^[a-zA-Z0-9_.~-]{20,1024}$/.test(value)?{configured:true}:{configured:false,reason:"Invalid OAuth token format"};
}
function token(){const c=credentialStatus();if(!c.configured)throw Error(c.reason);return readFileSync(TOKEN_PATH,"utf8").trim()}
const safeErr=e=>String(e?.message||e).replace(/(?:OAuth|Bearer) +[\w._~-]+/gi,"[REDACTED]").slice(0,200);
export function route(uid,host="",endpoint=""){
 if(!/^\d+$/.test(String(uid)))throw Error("Invalid user identifier");
 if(host&&!/^[a-z]+:[^/?#\s]+:\d{1,5}$/.test(host))throw Error("Invalid Yandex verified host identifier");
 const allowed=["summary","diagnostics","sitemaps","search-queries/all/history","search-queries/popular"];
 if(endpoint&&!allowed.includes(endpoint))throw Error("Only read-only Yandex API paths are allowed");
 return "user/"+uid+"/hosts"+(host?"/"+encodeURIComponent(host):"")+(endpoint?"/"+endpoint:"");
}
export async function yandexGet(path,params={},options={}){
 if(path!=="user"&&!/^user\/\d+\/hosts(?:\/[a-zA-Z0-9%_.:~-]+(?:\/(?:summary|diagnostics|sitemaps|search-queries\/(?:all\/history|popular)))?)?$/.test(path))throw Error("Yandex API path blocked");
 const address=new URL(path,ROOT);
 for(const [k,v]of Object.entries(params)){
  if(!["query_indicator","date_from","date_to","order_by","limit","offset"].includes(k))throw Error("Yandex API query option blocked");
  for(const x of(Array.isArray(v)?v:[v]))address.searchParams.append(k,String(x));
 }
 const oauth=options.token||token();let last;
 for(let attempt=0;attempt<2;attempt++){
  const ctrl=new AbortController(),stop=setTimeout(()=>ctrl.abort(),14000);
  try{
   const res=await(options.fetchImpl||fetch)(address,{method:"GET",redirect:"error",signal:ctrl.signal,headers:{Authorization:"OAuth "+oauth,Accept:"application/json"}});
   if(!res.ok){if(attempt===0&&[429,500,502,503,504].includes(res.status))continue;throw Error("Yandex API HTTP "+res.status)}
   const doc=await res.json();if(!doc||typeof doc!=="object"||Array.isArray(doc))throw Error("Unexpected Yandex API data");
   if(doc.error_code)throw Error("Yandex API "+String(doc.error_code).slice(0,60));return doc;
  }catch(e){last=e;if(attempt===0&&/fetch failed|network|abort/i.test(String(e)))continue;break}
  finally{clearTimeout(stop)}
 }
 throw Error(safeErr(last));
}
const num=x=>typeof x==="number"&&Number.isFinite(x)&&x>=0?x:null;
export function normalizeHistory(doc){
 if(!doc?.indicators||typeof doc.indicators!=="object")throw Error("Missing Yandex daily indicators");
 const map=new Map();
 for(const [code,field]of [["TOTAL_SHOWS","impressions"],["TOTAL_CLICKS","clicks"],["AVG_SHOW_POSITION","position"]]){
  for(const p of(Array.isArray(doc.indicators[code])?doc.indicators[code]:[])){
   const d=String(p.date||"").slice(0,10);if(!/^\d{4}-\d\d-\d\d$/.test(d))continue;
   const row=map.get(d)||{key:d,clicks:null,impressions:null,position:null};
   row[field]=num(p.value);map.set(d,row)
  }
 }
 return[...map.values()].sort((a,b)=>a.key.localeCompare(b.key)).map(x=>({...x,ctrPercent:x.impressions>0&&x.clicks!==null?100*x.clicks/x.impressions:null}));
}
export function normalizeQueries(doc){
 if(!Array.isArray(doc?.queries))throw Error("Invalid Yandex query response");
 return doc.queries.filter(x=>typeof x.query_text==="string"&&x.query_text.trim()).map(x=>{
  const a=x.indicators||{},clicks=num(a.TOTAL_CLICKS),impressions=num(a.TOTAL_SHOWS);
  return{key:x.query_text.trim().slice(0,2000),clicks,impressions,position:num(a.AVG_SHOW_POSITION),ctrPercent:impressions>0&&clicks!==null?100*clicks/impressions:null};
 }).sort((a,b)=>(b.impressions||0)-(a.impressions||0));
}
function tables(db){
 db.exec([
 "CREATE TABLE IF NOT EXISTS yandex_sites(host_id TEXT PRIMARY KEY,site_url TEXT NOT NULL,verified INTEGER NOT NULL,discovered_at TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS yandex_syncs(id INTEGER PRIMARY KEY AUTOINCREMENT,host_id TEXT NOT NULL,site_url TEXT NOT NULL,synced_at TEXT NOT NULL,first_date TEXT,last_date TEXT,query_date_from TEXT,query_date_to TEXT,searchable_pages INTEGER,excluded_pages INTEGER,sqi INTEGER,diagnostics_json TEXT,sitemaps_json TEXT)",
 "CREATE TABLE IF NOT EXISTS yandex_metrics(sync_id INTEGER NOT NULL,dimension TEXT NOT NULL,metric_key TEXT NOT NULL,clicks REAL,impressions REAL,ctr REAL,position REAL)",
 "CREATE INDEX IF NOT EXISTS idx_ya_sync ON yandex_syncs(host_id,id DESC)",
 "CREATE INDEX IF NOT EXISTS idx_ya_metrics ON yandex_metrics(sync_id,dimension)"
 ].join(";")+";");
}
export async function syncYandex({dbPath=DB_PATH,oauthToken,fetchImpl,now=new Date()}={}){
 const call=(p,q)=>yandexGet(p,q,{token:oauthToken,fetchImpl});
 const user=await call("user");if(!/^\d+$/.test(String(user.user_id)))throw Error("Yandex user ID missing");
 const uid=String(user.user_id),listing=await call(route(uid));
 if(!Array.isArray(listing.hosts))throw Error("Yandex verified site list missing");
 const sites=listing.hosts.filter(x=>x.verified===true&&typeof x.host_id==="string"&&typeof x.ascii_host_url==="string");
 const db=new DatabaseSync(dbPath);tables(db);
 const result={engine:"yandex",fetchedAt:now.toISOString(),authorizedSites:sites.length,successes:0,failures:0,sites:[]};
 try{
  const saveSite=db.prepare("INSERT INTO yandex_sites(host_id,site_url,verified,discovered_at) VALUES(?,?,?,?) ON CONFLICT(host_id) DO UPDATE SET site_url=excluded.site_url,verified=excluded.verified,discovered_at=excluded.discovered_at");
  for(const s of listing.hosts)if(typeof s.host_id==="string"&&typeof s.ascii_host_url==="string")saveSite.run(s.host_id,s.ascii_host_url,s.verified===true?1:0,now.toISOString());
  for(const site of sites){
   try{
    const base=route(uid,site.host_id);
    const from=new Date(now.getTime()-31*86400000).toISOString().slice(0,10);
    const to=new Date(now.getTime()-2*86400000).toISOString().slice(0,10);
    const query={query_indicator:["TOTAL_SHOWS","TOTAL_CLICKS","AVG_SHOW_POSITION"],date_from:from,date_to:to};
    const [hist,top,summary]=await Promise.all([call(base+"/search-queries/all/history",query),call(base+"/search-queries/popular",{...query,order_by:"TOTAL_SHOWS",limit:500}),call(base+"/summary")]);
    const [diagnostics,sitemaps]=await Promise.allSettled([call(base+"/diagnostics"),call(base+"/sitemaps")]);
    const daily=normalizeHistory(hist),queries=normalizeQueries(top);
    db.exec("BEGIN IMMEDIATE");
    try{
     const id=db.prepare("INSERT INTO yandex_syncs(host_id,site_url,synced_at,first_date,last_date,query_date_from,query_date_to,searchable_pages,excluded_pages,sqi,diagnostics_json,sitemaps_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
       .run(site.host_id,site.ascii_host_url,new Date().toISOString(),daily[0]?.key||null,daily.at(-1)?.key||null,top.date_from||from,top.date_to||to,num(summary.searchable_pages_count),num(summary.excluded_pages_count),num(summary.sqi),
       diagnostics.status==="fulfilled"?JSON.stringify(diagnostics.value):null,sitemaps.status==="fulfilled"?JSON.stringify(sitemaps.value):null).lastInsertRowid;
     const insert=db.prepare("INSERT INTO yandex_metrics(sync_id,dimension,metric_key,clicks,impressions,ctr,position) VALUES(?,?,?,?,?,?,?)");
     for(const [dim,rows]of [["date",daily],["query",queries]])for(const row of rows)insert.run(id,dim,row.key,row.clicks,row.impressions,row.ctrPercent,row.position);
     for(const old of db.prepare("SELECT id FROM yandex_syncs WHERE host_id=? ORDER BY id DESC LIMIT -1 OFFSET 12").all(site.host_id)){db.prepare("DELETE FROM yandex_metrics WHERE sync_id=?").run(old.id);db.prepare("DELETE FROM yandex_syncs WHERE id=?").run(old.id)}
     db.exec("COMMIT");
    }catch(e){db.exec("ROLLBACK");throw e}
    result.successes++;result.sites.push({siteUrl:site.ascii_host_url,success:true,days:daily.length,queries:queries.length});
   }catch(e){result.failures++;result.sites.push({siteUrl:site.ascii_host_url,success:false,error:safeErr(e)})}
  }
 }finally{db.close()}
 return result;
}
function readDb(path,fn){if(!existsSync(path))return fn(null);const db=new DatabaseSync(path,{readOnly:true});try{return fn(db)}finally{db.close()}}
export function yandexSites(path=DB_PATH){
 return readDb(path,db=>{if(!db)return[];try{return db.prepare("SELECT host_id AS hostId,site_url AS siteUrl,verified,discovered_at AS discoveredAt,(SELECT max(synced_at) FROM yandex_syncs WHERE host_id=s.host_id) AS lastSync FROM yandex_sites s ORDER BY site_url").all().map(x=>({...x,verified:!!x.verified}))}catch(e){if(String(e).includes("no such table"))return[];throw e}});
}
export function yandexStatus(path=DB_PATH){
 const c=credentialStatus(),sites=yandexSites(path);
 return{engine:"yandex",tokenConfigured:c.configured,apiConnected:c.configured&&sites.some(s=>s.verified&&s.lastSync&&Date.parse(s.lastSync)>=statSync(TOKEN_PATH).mtimeMs-5000),reason:c.reason||null,verifiedSites:sites.filter(s=>s.verified).length,
 sites,lastSync:sites.map(s=>s.lastSync).filter(Boolean).sort().at(-1)||null,source:"Official Yandex Webmaster API v4 (OAuth) + local SQLite"};
}
export function yandexDashboard(siteUrl,path=DB_PATH){
 if(typeof siteUrl!=="string"||siteUrl.length>1000)throw Error("Provide a Yandex property URL");
 return readDb(path,db=>{
  if(!db)throw Error("Yandex database unavailable");
  let snap;try{snap=db.prepare("SELECT * FROM yandex_syncs WHERE site_url=? ORDER BY id DESC LIMIT 1").get(siteUrl)}catch(e){if(String(e).includes("no such table"))throw Error("Yandex account not yet connected");throw e}
  if(!snap)throw Error("No authorized Yandex performance snapshot available");
  const rows=dim=>db.prepare("SELECT metric_key AS key,clicks,impressions,ctr AS ctrPercent,position FROM yandex_metrics WHERE sync_id=? AND dimension=? ORDER BY "+(dim==="date"?"metric_key ASC":"impressions DESC")+" LIMIT 500").all(snap.id,dim);
  const daily=rows("date"),topQueries=rows("query"),validRows=daily.filter(d=>d.clicks!==null&&d.impressions!==null);
  const clicks=validRows.reduce((a,b)=>a+b.clicks,0),impressions=validRows.reduce((a,b)=>a+b.impressions,0);
  const positionWeight=validRows.filter(d=>d.position!==null&&d.impressions>0).reduce((a,b)=>a+b.impressions,0);
  const weightedPosition=validRows.filter(d=>d.position!==null&&d.impressions>0).reduce((a,b)=>a+b.position*b.impressions,0);
  const diagnostics=snap.diagnostics_json?JSON.parse(snap.diagnostics_json).problems||{}:null;
  return{engine:"yandex",siteUrl:snap.site_url,hostId:snap.host_id,startDate:snap.first_date,endDate:snap.last_date,syncedAt:snap.synced_at,
   kpis:{clicks:validRows.length?clicks:null,impressions:validRows.length?impressions:null,ctrPercent:impressions>0?100*clicks/impressions:null,
   averagePosition:positionWeight?weightedPosition/positionWeight:null,searchablePages:snap.searchable_pages,excludedPages:snap.excluded_pages,sqi:snap.sqi},
   daily,topQueries,topPages:[],sitemaps:snap.sitemaps_json?JSON.parse(snap.sitemaps_json):null,
   problems:diagnostics?Object.entries(diagnostics).filter(([,v])=>v.state==="PRESENT").map(([code,v])=>({code,severity:v.severity,state:v.state})):[],
   limits:{queryDateFrom:snap.query_date_from,queryDateTo:snap.query_date_to,queryTopLimit:500,
    notes:"Yandex all-query daily history and top popular queries. No Yandex landing-page performance rows claimed. Yandex search includes dynamic placements; cross-engine averages must not be combined."}};
 });
}
