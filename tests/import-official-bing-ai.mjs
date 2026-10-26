import {DatabaseSync} from "node:sqlite";
import {readFileSync,existsSync,mkdirSync,copyFileSync} from "node:fs";
import {join} from "node:path";
import {homedir} from "node:os";
import {asRows} from "./.ai-csv-parser-smoke.mjs";
const root=join(homedir(),"Documents/GSC-Maestro");
const dbPath=join(homedir(),".local/share/com.advertpreneur.gscmaestro/maestro.sqlite3");
const host=process.argv[2]||"coocoobabys.com";
if(!["coocoobabys.com","advertpreneur.com"].includes(host))throw Error("Only configured downloaded Bing export sites are accepted");
const site="https://"+host+"/";
const files={
  date:host+"_AIPerformanceOverviewStats_10_25_2026.csv",
  page:host+"_AIPageStatsReport_10_25_2026.csv",
  query:host+"_AISearchQueriesReport_10_25_2026.csv"
};
const db=new DatabaseSync(dbPath);
try{
 const authorized=db.prepare("SELECT verified FROM bing_sites WHERE site_url=?").get(site);
 if(authorized?.verified!==1)throw Error("This website is not a verified connected Bing property");
 db.exec("CREATE TABLE IF NOT EXISTS ai_imports(id INTEGER PRIMARY KEY AUTOINCREMENT,engine TEXT NOT NULL,site_url TEXT NOT NULL,dimension TEXT NOT NULL,filename TEXT NOT NULL,imported_at TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS ai_metrics(import_id INTEGER NOT NULL,metric_key TEXT NOT NULL,citations REAL NOT NULL)");
 db.exec("CREATE INDEX IF NOT EXISTS idx_ai_site ON ai_imports(site_url,dimension,id DESC)");
 const dest=join(root,"ai-exports");mkdirSync(dest,{recursive:true});
 for(const [dimension,filename] of Object.entries(files)){
  const src=join(homedir(),"Downloads",filename),dst=join(dest,filename);
  if(!existsSync(src)){console.log(dimension,"official export not available; skipped");continue}
  const source=readFileSync(src,"utf8"),rows=asRows(source,dimension);
  const existing=db.prepare("SELECT id FROM ai_imports WHERE site_url=? AND dimension=? AND filename=? LIMIT 1").get(site,dimension,filename);
  if(existing){console.log(dimension,"already imported",existing.id);continue}
  db.exec("BEGIN IMMEDIATE");
  try{
   const id=db.prepare("INSERT INTO ai_imports(engine,site_url,dimension,filename,imported_at) VALUES('bing',?,?,?,?)")
    .run(site,dimension,filename,new Date().toISOString()).lastInsertRowid;
   const st=db.prepare("INSERT INTO ai_metrics(import_id,metric_key,citations) VALUES(?,?,?)");
   for(const row of rows)st.run(id,row.key,row.citations);
   db.exec("COMMIT");
   if(!existsSync(dst))copyFileSync(src,dst);
   console.log(dimension,"saved rows",rows.length,"citations",rows.reduce((sum,r)=>sum+r.citations,0),"import",id);
  }catch(e){db.exec("ROLLBACK");throw e}
 }
 console.log("DB integrity",db.prepare("PRAGMA integrity_check").get().integrity_check);
}finally{db.close()}
