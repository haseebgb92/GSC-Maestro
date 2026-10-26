mod google;
use rusqlite::{params,Connection};
use serde::{Serialize,Deserialize};
use std::{fs,path::PathBuf,sync::Mutex};
use tauri::{Manager,State};

struct Db(Mutex<Connection>);
#[derive(Serialize,Deserialize)]struct QueryRow{query:String,clicks:f64,impressions:f64,ctr:f64,position:f64}
#[derive(Serialize)]struct ImportState{filename:String,imported_at:String,rows:Vec<QueryRow>}
#[derive(Serialize)]struct AppStatus{app:String,version:String,storage:String,google_configured:bool,google_connected:bool,background_sync_enabled:bool,backend:String}
fn db_path(app:&tauri::AppHandle)->Result<PathBuf,String>{let dir=app.path().app_data_dir().map_err(|e|e.to_string())?;fs::create_dir_all(&dir).map_err(|e|e.to_string())?;Ok(dir.join("maestro.sqlite3"))}
#[tauri::command]fn get_status(app:tauri::AppHandle)->Result<AppStatus,String>{Ok(AppStatus{app:"GSC Maestro".into(),version:env!("CARGO_PKG_VERSION").into(),storage:db_path(&app)?.to_string_lossy().to_string(),google_configured:google::is_configured(),google_connected:google::is_connected(),background_sync_enabled:timer_enabled(),backend:"Direct Google Search Console + local SQLite (OAuth read-only)".into()})}
#[tauri::command]fn get_import_data(db:State<'_,Db>)->Result<Option<ImportState>,String>{let guard=db.0.lock().map_err(|e|e.to_string())?;let import=guard.query_row("SELECT id,filename,imported_at FROM imports ORDER BY id DESC LIMIT 1",[],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)));let(id,filename,imported_at)=match import {Ok(v)=>v,Err(rusqlite::Error::QueryReturnedNoRows)=>return Ok(None),Err(e)=>return Err(e.to_string())};let mut stmt=guard.prepare("SELECT query,clicks,impressions,ctr,position FROM query_rows WHERE import_id=?1 ORDER BY clicks DESC LIMIT 50000").map_err(|e|e.to_string())?;let rows=stmt.query_map(params![id],|r|Ok(QueryRow{query:r.get(0)?,clicks:r.get(1)?,impressions:r.get(2)?,ctr:r.get(3)?,position:r.get(4)?})).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;Ok(Some(ImportState{filename,imported_at,rows}))}
#[tauri::command]fn import_query_csv(db:State<'_,Db>,filename:String,rows:Vec<QueryRow>)->Result<usize,String>{if rows.is_empty()||rows.len()>50000{return Err("Import must have between 1 and 50,000 rows".into())}if filename.len()>255{return Err("Filename too long".into())}if rows.iter().any(|r|r.query.len()>1000||!r.clicks.is_finite()||!r.impressions.is_finite()||!r.ctr.is_finite()||!r.position.is_finite()||r.clicks<0.||r.impressions<0.||r.ctr<0.||r.position<0.){return Err("Invalid numerical or query values".into())}let mut conn=db.0.lock().map_err(|e|e.to_string())?;let tx=conn.transaction().map_err(|e|e.to_string())?;tx.execute("INSERT INTO imports(filename,imported_at) VALUES(?1,?2)",params![filename,chrono::Utc::now().to_rfc3339()]).map_err(|e|e.to_string())?;let id=tx.last_insert_rowid();{let mut stmt=tx.prepare("INSERT INTO query_rows(import_id,query,clicks,impressions,ctr,position)VALUES(?1,?2,?3,?4,?5,?6)").map_err(|e|e.to_string())?;for r in &rows{stmt.execute(params![id,r.query,r.clicks,r.impressions,r.ctr,r.position]).map_err(|e|e.to_string())?;}}tx.commit().map_err(|e|e.to_string())?;Ok(rows.len())}
#[tauri::command]fn configure_google(config:String)->Result<(),String>{google::configure_google_credentials(config)}
#[tauri::command]async fn connect_google()->Result<(),String>{tauri::async_runtime::spawn_blocking(google::connect_google).await.map_err(|e|e.to_string())?}
#[tauri::command]fn disconnect_google()->Result<(),String>{google::disconnect_google()}
#[tauri::command]fn list_cached_sites(db:State<'_,Db>)->Result<Vec<google::Site>,String>{let guard=db.0.lock().map_err(|e|e.to_string())?;google::list_cached_sites(&guard)}
#[tauri::command]async fn refresh_google_sites(app:tauri::AppHandle)->Result<Vec<google::Site>,String>{
 tauri::async_runtime::spawn_blocking(move||{let db=app.state::<Db>();let mut guard=db.0.lock().map_err(|e|e.to_string())?;google::refresh_sites(&mut guard)}).await.map_err(|e|e.to_string())?
}
#[tauri::command]async fn sync_google_site(app:tauri::AppHandle,site_url:String)->Result<google::Report,String>{
 tauri::async_runtime::spawn_blocking(move||{let db=app.state::<Db>();let mut guard=db.0.lock().map_err(|e|e.to_string())?;google::sync_site(&mut guard,&site_url)}).await.map_err(|e|e.to_string())?
}
#[tauri::command]fn get_site_report(db:State<'_,Db>,site_url:String)->Result<Option<google::Report>,String>{let guard=db.0.lock().map_err(|e|e.to_string())?;google::get_site_report(&guard,&site_url)}


fn timer_enabled()->bool{std::process::Command::new("systemctl").args(["--user","is-enabled","gsc-maestro-sync.timer"]).output().map(|o|o.status.success()&&String::from_utf8_lossy(&o.stdout).trim()=="enabled").unwrap_or(false)}
#[tauri::command]
fn set_background_sync(app:tauri::AppHandle,enabled:bool)->Result<bool,String>{
 if enabled{
  if !google::is_connected(){return Err("Connect a Google account first, before enabling the scheduler".into());}
  let state=app.state::<Db>();let guard=state.0.lock().map_err(|e|e.to_string())?;
  if google::list_cached_sites(&guard)?.is_empty(){return Err("Refresh the list of authorized GSC properties before enabling background sync".into());}
 }
 let home=std::env::var("HOME").map_err(|_|"HOME is unavailable".to_string())?;
 let user_systemd=PathBuf::from(home).join(".config/systemd/user");
 fs::create_dir_all(&user_systemd).map_err(|e|e.to_string())?;
 if enabled{
  let bin=std::env::current_exe().map_err(|e|e.to_string())?;
  let escaped=bin.display().to_string().replace('%',"%%");
  if escaped.contains(' ') {return Err("The installed binary path contains spaces; scheduler path quoting is not configured".into())}
  let service=format!("[Unit]\nDescription=GSC Maestro scheduled Search Console sync\nAfter=network-online.target\nWants=network-online.target\n[Service]\nType=oneshot\nExecStartPre=-{escaped} --refresh-sites\nExecStart={escaped} --sync-all\nNice=10\nIOSchedulingClass=idle\nNoNewPrivileges=true\nTimeoutStartSec=5min\n");
  fs::write(user_systemd.join("gsc-maestro-sync.service"),service).map_err(|e|e.to_string())?;
  fs::write(user_systemd.join("gsc-maestro-sync.timer"),"[Unit]\nDescription=GSC Maestro twice-daily background sync\n[Timer]\nOnCalendar=*-*-* 03,15:00:00\nOnStartupSec=10min\nPersistent=true\nRandomizedDelaySec=10min\nUnit=gsc-maestro-sync.service\n[Install]\nWantedBy=timers.target\n").map_err(|e|e.to_string())?;
 }
 let run=|args:&[&str]|->Result<(),String>{let output=std::process::Command::new("systemctl").arg("--user").args(args).output().map_err(|e|e.to_string())?;if !output.status.success(){return Err(String::from_utf8_lossy(&output.stderr).chars().take(400).collect())}Ok(())};
 run(&["daemon-reload"])?;
 if enabled{run(&["enable","--now","gsc-maestro-sync.timer"])?}else{let _=run(&["disable","--now","gsc-maestro-sync.timer"]);}
 Ok(timer_enabled())
}
pub fn sync_all_cli()->Result<String,String>{
 if !google::is_connected(){return Err("No authorized Google account; launch the desktop app to connect Google".into());}
 let home=std::env::var("HOME").map_err(|_|"HOME is unavailable".to_string())?;
 let path=PathBuf::from(home).join(".local/share/com.advertpreneur.gscmaestro/maestro.sqlite3");
 if !path.exists(){return Err("GSC Maestro database not found".into())}
 let mut conn=Connection::open(path).map_err(|e|e.to_string())?;
 let sites=google::list_cached_sites(&conn)?;
 if sites.is_empty(){return Err("No authorized properties have been discovered".into())}
 let mut succeeded=0;let mut failed=0;
 for site in sites.iter().take(25){
  if site.permission=="siteUnverifiedUser"{continue}
  let first=google::sync_site(&mut conn,&site.site_url);
  let outcome=match first{
   Err(ref error) if ["network error","timeout","429","503","502","tls","temporarily"].iter().any(|term|error.to_lowercase().contains(term))=>{
    eprintln!("Transient Search Console error for {}, retrying once: {}",site.site_url,error);
    std::thread::sleep(std::time::Duration::from_secs(2));
    google::sync_site(&mut conn,&site.site_url)
   },
   other=>other
  };
  match outcome{Ok(report)=>{succeeded+=1;println!("Synced {} through {}",site.site_url,report.end_date)},Err(err)=>{failed+=1;eprintln!("{}: {}",site.site_url,err)}}
 }
 if succeeded==0{return Err(format!("No properties synchronized; {failed} failed"))}
 if failed>0{return Err(format!("Partial synchronization: {succeeded} succeeded, {failed} failed; a retry is needed"))}
 Ok(format!("Completed: {succeeded} properties synced, {failed} failed; site cap 25"))
}

#[derive(Serialize)]
struct McpBridgeStatus {local_running:bool,public_route:bool,endpoint:Option<String>,chatgpt_connected:bool}
#[tauri::command]
fn get_mcp_bridge_status()->McpBridgeStatus {
 let local_running=std::net::TcpStream::connect_timeout(&"127.0.0.1:8798".parse().unwrap(),std::time::Duration::from_millis(300)).is_ok();
 let mut public_route=false;
 let mut endpoint=None;
 if let Ok(output)=std::process::Command::new("tailscale").args(["funnel","status"]).output(){
  let value=String::from_utf8_lossy(&output.stdout);
  public_route=value.lines().any(|line|line.contains("/gsc-maestro")&&line.contains("127.0.0.1:8798"));
  if public_route{
   let root=value.lines().filter_map(|line|line.trim().strip_prefix("https://")).find_map(|line|line.split_whitespace().next());
   if let Some(domain)=root{endpoint=Some(format!("https://{}/gsc-maestro/mcp",domain.trim_end_matches('/')));}
  }
 }
 let chatgpt_connected=std::env::var("HOME").ok().and_then(|home|{
  let path=PathBuf::from(home).join(".local/share/com.advertpreneur.gscmaestro/oauth-state.json");
  fs::read_to_string(path).ok().and_then(|data|serde_json::from_str::<serde_json::Value>(&data).ok())
 }).and_then(|doc|doc.get("refresh").cloned()).and_then(|tokens|tokens.as_object().cloned())
  .map(|tokens|tokens.values().any(|row|row.get("expiresAt").and_then(|v|v.as_i64()).map(|t|t>chrono::Utc::now().timestamp_millis()).unwrap_or(false)))
  .unwrap_or(false);
 McpBridgeStatus{local_running,public_route,endpoint,chatgpt_connected}
}

pub fn import_google_oauth_cli(filename:&str)->Result<(),String>{
 let path=std::path::Path::new(filename);
 let meta=std::fs::metadata(path).map_err(|e|e.to_string())?;
 if meta.len()>25000{return Err("OAuth file size exceeds 25KB".into())}
 let data=std::fs::read_to_string(path).map_err(|e|e.to_string())?;
 google::configure_google_credentials(data)
}
pub fn connect_google_cli()->Result<(),String>{google::connect_google()}
pub fn refresh_sites_cli()->Result<usize,String>{
 let home=std::env::var("HOME").map_err(|_|"Missing HOME".to_string())?;
 let db=std::path::PathBuf::from(home).join(".local/share/com.advertpreneur.gscmaestro/maestro.sqlite3");
 let mut conn=Connection::open(db).map_err(|e|e.to_string())?;
 Ok(google::refresh_sites(&mut conn)?.len())
}


#[tauri::command]
async fn run_public_audit(app:tauri::AppHandle,url:String,max_pages:Option<u8>)->Result<serde_json::Value,String>{
 tauri::async_runtime::spawn_blocking(move||{
  let parsed=if url.contains("://"){url::Url::parse(&url)}else{url::Url::parse(&format!("https://{}",url))}.map_err(|_|"Invalid website URL".to_string())?;
  analyze_validated_url(&app,parsed,max_pages,true)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn analyze_website(app:tauri::AppHandle,url:String,max_pages:Option<u8>)->Result<serde_json::Value,String>{
 tauri::async_runtime::spawn_blocking(move||{
  let parsed=url::Url::parse(if url.contains("://"){&url}else{return analyze_input_without_scheme(&app,&url,max_pages,false)});
  let parsed=parsed.map_err(|_|"Enter a valid public website URL".to_string())?;
  analyze_validated_url(&app,parsed,max_pages,false)
 }).await.map_err(|e|e.to_string())?
}
fn analyze_input_without_scheme(app:&tauri::AppHandle,raw:&str,max_pages:Option<u8>,force_public:bool)->Result<serde_json::Value,String>{
 let u=url::Url::parse(&format!("https://{}",raw)).map_err(|_|"Enter a valid website".to_string())?;
 analyze_validated_url(app,u,max_pages,force_public)
}
fn analyze_validated_url(app:&tauri::AppHandle,parsed:url::Url,max_pages:Option<u8>,force_public:bool)->Result<serde_json::Value,String>{
 if parsed.scheme()!="http"&&parsed.scheme()!="https"{return Err("Only HTTP(S) public websites may be inspected".into())}
 if !parsed.username().is_empty()||parsed.password().is_some(){return Err("URL credentials are not permitted".into())}
 let host=parsed.host_str().ok_or("Missing website domain")?.to_lowercase();
 let database=app.state::<Db>();
 let connected={
  let guard=database.0.lock().map_err(|e|e.to_string())?;
  let sites=google::list_cached_sites(&guard)?;
  let mut candidates:Vec<String>=sites.into_iter().filter(|site|{
   if site.permission=="siteUnverifiedUser"{return false}
   if let Some(domain)=site.site_url.strip_prefix("sc-domain:"){
    host==domain.to_lowercase()||host.ends_with(&format!(".{}",domain.to_lowercase()))
   }else{parsed.as_str().starts_with(&site.site_url)}
  }).map(|site|site.site_url).collect();
  candidates.sort_by_key(|x|if x.starts_with("sc-domain:"){0}else{1});
  let mut match_site=None;
  for site in candidates{if google::get_site_report(&guard,&site)?.is_some(){match_site=Some(site);break}}
  match_site
 };
 if let Some(site)=connected.filter(|_|!force_public){
  let guard=database.0.lock().map_err(|e|e.to_string())?;
  let report=google::get_site_report(&guard,&site)?.ok_or("Authorized property has no local GSC snapshot")?;
  return Ok(serde_json::json!({"mode":"gsc","siteUrl":site,"report":report}));
 }
 let js=app.path().resolve("resources/gsc-maestro-crawl.mjs",tauri::path::BaseDirectory::Resource).ok()
  .filter(|path|path.exists()).unwrap_or_else(||{
   let home=std::env::var("HOME").unwrap_or_default();
   PathBuf::from(home).join(".local/opt/gsc-maestro/mcp/gsc-maestro-crawl.mjs")
  });
 if !js.exists(){return Err("Audit crawler runtime is missing from installation; reinstall GSC Maestro v0.5".into())}
 let count=max_pages.unwrap_or(8).clamp(1,12);
 let path=db_path(app)?;
 let output=std::process::Command::new("node")
   .arg("--no-warnings").arg("--experimental-sqlite").arg(js)
   .arg(parsed.as_str()).arg(count.to_string())
   .env("GSC_MAESTRO_DB",path)
   .output().map_err(|e|format!("Audit worker cannot start: {e}"))?;
 if !output.status.success(){
  let msg=String::from_utf8_lossy(&output.stderr);
  return Err(msg.chars().take(400).collect::<String>())
 }
 serde_json::from_slice(&output.stdout).map_err(|e|format!("Audit output invalid: {e}"))
}
#[tauri::command]
fn get_public_audit_history(db:State<'_,Db>)->Result<serde_json::Value,String>{
 let guard=db.0.lock().map_err(|e|e.to_string())?;
 let mut stmt=match guard.prepare("SELECT id,domain,url,audited_at,score,pages FROM public_audits ORDER BY id DESC LIMIT 30"){
  Ok(s)=>s,Err(rusqlite::Error::SqliteFailure(_,Some(reason))) if reason.contains("no such table")=>return Ok(serde_json::json!([])),
  Err(e)=>return Err(e.to_string())
 };
 let rows=stmt.query_map([],|r|Ok(serde_json::json!({"id":r.get::<_,i64>(0)?,"domain":r.get::<_,String>(1)?,"url":r.get::<_,String>(2)?,"auditedAt":r.get::<_,String>(3)?,"score":r.get::<_,i64>(4)?,"pages":r.get::<_,i64>(5)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
 Ok(serde_json::json!(rows))
}

#[tauri::command]
fn configure_bing_api(key:String)->Result<(),String>{
 use std::io::Write;
 use std::os::unix::fs::OpenOptionsExt;
 let clean=key.trim();
 if clean.len()<24||clean.len()>256||!clean.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_'){return Err("The Bing API key format is invalid".into())}
 let home=std::env::var("HOME").map_err(|_|"Cannot resolve HOME")?;
 let path=PathBuf::from(home).join(".local/share/com.advertpreneur.gscmaestro");
 fs::create_dir_all(&path).map_err(|e|e.to_string())?;
 let temp=path.join("bing-api-key.tmp");
 let mut f=std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&temp).map_err(|e|e.to_string())?;
 f.write_all(clean.as_bytes()).map_err(|e|e.to_string())?;
 f.sync_all().map_err(|e|e.to_string())?;
 fs::rename(temp,path.join("bing-api-key")).map_err(|e|e.to_string())?;
 Ok(())
}
#[tauri::command]
fn disconnect_bing_api()->Result<(),String>{
 let path=PathBuf::from(std::env::var("HOME").map_err(|_|"Missing HOME")?).join(".local/share/com.advertpreneur.gscmaestro/bing-api-key");
 if path.exists(){fs::remove_file(path).map_err(|e|e.to_string())?}Ok(())
}
fn bing_cli(app:&tauri::AppHandle,command:&str,site_url:Option<&str>)->Result<serde_json::Value,String>{
 let packaged=app.path().resolve("resources/gsc-maestro-bing.mjs",tauri::path::BaseDirectory::Resource).ok();
 let home=std::env::var("HOME").unwrap_or_default();
 let fallback=PathBuf::from(home).join(".local/opt/gsc-maestro/mcp/gsc-maestro-bing.mjs");
 let file=packaged.filter(|p|p.exists()).unwrap_or(fallback);
 if !file.exists(){return Err("Bing integration runtime missing".into())}
 let mut child=std::process::Command::new("node");
 child.arg("--no-warnings").arg("--experimental-sqlite").arg(file).arg(command);
 if let Some(url)=site_url{child.arg(url);}
 let output=child.output().map_err(|e|e.to_string())?;
 if !output.status.success(){return Err(String::from_utf8_lossy(&output.stderr).chars().take(280).collect())}
 serde_json::from_slice(&output.stdout).map_err(|e|e.to_string())
}
#[tauri::command]
async fn get_bing_status(app:tauri::AppHandle)->Result<serde_json::Value,String>{
 tauri::async_runtime::spawn_blocking(move||bing_cli(&app,"status",None)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn get_bing_report(app:tauri::AppHandle,site_url:String)->Result<serde_json::Value,String>{
 tauri::async_runtime::spawn_blocking(move||bing_cli(&app,"report",Some(&site_url))).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn sync_bing_now()->Result<String,String>{
 tauri::async_runtime::spawn_blocking(||{
  let uid=std::env::var("UID").unwrap_or_else(|_|"1000".into());
  let runtime=format!("/run/user/{uid}");
  let out=std::process::Command::new("systemctl").args(["--user","start","--no-block","gsc-maestro-bing-sync.service"])
  .env("XDG_RUNTIME_DIR",&runtime).env("DBUS_SESSION_BUS_ADDRESS",format!("unix:path={runtime}/bus"))
  .output().map_err(|e|e.to_string())?;
  if !out.status.success(){return Err(String::from_utf8_lossy(&out.stderr).to_string())}
  Ok("Bing sync queued; refresh the report after synchronization.".into())
 }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
fn configure_yandex_oauth(token:String)->Result<(),String>{
 use std::io::Write;
 use std::os::unix::fs::OpenOptionsExt;
 let value=token.trim();
 if value.len()<20||value.len()>1024||!value.bytes().all(|c|c.is_ascii_alphanumeric()||b"_.~-".contains(&c)){return Err("Invalid Yandex OAuth token format".into())}
 let home=std::env::var("HOME").map_err(|_|"Cannot resolve user HOME")?;
 let folder=PathBuf::from(home).join(".local/share/com.advertpreneur.gscmaestro");
 fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
 let tmp=folder.join("yandex-oauth-token.new");
 if tmp.exists(){fs::remove_file(&tmp).map_err(|e|e.to_string())?}
 let mut file=std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&tmp).map_err(|e|e.to_string())?;
 file.write_all(value.as_bytes()).map_err(|e|e.to_string())?;
 file.sync_all().map_err(|e|e.to_string())?;
 fs::rename(tmp,folder.join("yandex-oauth-token")).map_err(|e|e.to_string())?;
 Ok(())
}
#[tauri::command]
fn disconnect_yandex_oauth()->Result<(),String>{
 let path=PathBuf::from(std::env::var("HOME").map_err(|_|"Cannot resolve HOME")?).join(".local/share/com.advertpreneur.gscmaestro/yandex-oauth-token");
 if path.exists(){fs::remove_file(path).map_err(|e|e.to_string())?}Ok(())
}
fn yandex_cli(app:&tauri::AppHandle,command:&str,site:Option<&str>)->Result<serde_json::Value,String>{
 let resource=app.path().resolve("resources/gsc-maestro-yandex.mjs",tauri::path::BaseDirectory::Resource).ok();
 let home=std::env::var("HOME").unwrap_or_default();
 let fallback=PathBuf::from(home).join(".local/opt/gsc-maestro/mcp/gsc-maestro-yandex.mjs");
 let file=resource.filter(|p|p.exists()).unwrap_or(fallback);
 if !file.exists(){return Err("Yandex integration worker not installed".into())}
 let mut run=std::process::Command::new("node");
 run.arg("--no-warnings").arg("--experimental-sqlite").arg(file).arg(command);
 if let Some(site)=site{run.arg(site);}
 let output=run.output().map_err(|e|e.to_string())?;
 if !output.status.success(){return Err(String::from_utf8_lossy(&output.stderr).chars().take(300).collect())}
 serde_json::from_slice(&output.stdout).map_err(|e|e.to_string())
}
#[tauri::command]
async fn get_yandex_status(app:tauri::AppHandle)->Result<serde_json::Value,String>{
 tauri::async_runtime::spawn_blocking(move||yandex_cli(&app,"status",None)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn get_yandex_report(app:tauri::AppHandle,site_url:String)->Result<serde_json::Value,String>{
 tauri::async_runtime::spawn_blocking(move||yandex_cli(&app,"report",Some(&site_url))).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn sync_yandex_now()->Result<String,String>{
 tauri::async_runtime::spawn_blocking(||{
  let uid=std::env::var("UID").unwrap_or_else(|_|"1000".into());
  let runtime=format!("/run/user/{uid}");
  let res=std::process::Command::new("systemctl").args(["--user","start","--no-block","gsc-maestro-yandex-sync.service"])
   .env("XDG_RUNTIME_DIR",&runtime).env("DBUS_SESSION_BUS_ADDRESS",format!("unix:path={runtime}/bus")).output().map_err(|e|e.to_string())?;
  if !res.status.success(){return Err(String::from_utf8_lossy(&res.stderr).to_string())}
  Ok("Yandex authorized data synchronization queued.".into())
 }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
fn get_saved_public_audit(db:State<'_,Db>,id:i64)->Result<serde_json::Value,String>{
 if id<=0{return Err("Select a valid saved public audit".into())}
 let guard=db.0.lock().map_err(|e|e.to_string())?;
 let raw=guard.query_row("SELECT report_json FROM public_audits WHERE id=?1",[id],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
 serde_json::from_str(&raw).map_err(|e|e.to_string())
}
fn check_authorized_site(conn:&Connection,site:&str,url:Option<&str>)->Result<(),String>{
 let permission=conn.query_row("SELECT permission FROM gsc_sites WHERE site_url=?1",[site],|r|r.get::<_,String>(0)).map_err(|_|"Google Search Console property not connected".to_string())?;
 if permission=="siteUnverifiedUser"{return Err("Google verification is required for URL Inspection".into())}
 if let Some(raw)=url{
  let u=url::Url::parse(raw).map_err(|_|"Enter an absolute HTTP(S) URL".to_string())?;
  if !["http","https"].contains(&u.scheme())||u.host_str().is_none()||!u.username().is_empty()||u.password().is_some(){return Err("Invalid URL for inspection".into())}
  let allowed=if let Some(domain)=site.strip_prefix("sc-domain:"){
   let host=u.host_str().unwrap_or("").to_lowercase();host==domain.to_lowercase()||host.ends_with(&format!(".{}",domain.to_lowercase()))
  }else{
   let base=url::Url::parse(site).map_err(|_|"Invalid registered GSC property prefix".to_string())?;
   u.scheme()==base.scheme() && u.host_str()==base.host_str() && u.port_or_known_default()==base.port_or_known_default()
    && u.path().starts_with(base.path())
  };
  if !allowed{return Err("Inspection URL must belong to the selected authorized property".into())}
 }
 Ok(())
}
#[tauri::command]
async fn inspect_google_url(app:tauri::AppHandle,site_url:String,inspection_url:String)->Result<serde_json::Value,String>{
 tauri::async_runtime::spawn_blocking(move||{
  let db=app.state::<Db>();
  {
   let conn=db.0.lock().map_err(|e|e.to_string())?;
   check_authorized_site(&conn,&site_url,Some(&inspection_url))?;
  }
  let response=google::inspect_index(&site_url,&inspection_url)?;
  let conn=db.0.lock().map_err(|e|e.to_string())?;
  conn.execute_batch("CREATE TABLE IF NOT EXISTS index_inspections(id INTEGER PRIMARY KEY AUTOINCREMENT,site_url TEXT NOT NULL,inspection_url TEXT NOT NULL,inspected_at TEXT NOT NULL,result_json TEXT NOT NULL);CREATE INDEX IF NOT EXISTS idx_index_site ON index_inspections(site_url,id DESC);").map_err(|e|e.to_string())?;
  conn.execute("INSERT INTO index_inspections(site_url,inspection_url,inspected_at,result_json) VALUES(?1,?2,?3,?4)",
   params![site_url,inspection_url,chrono::Utc::now().to_rfc3339(),response.to_string()]).map_err(|e|e.to_string())?;
  Ok(response)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn google_sitemaps(app:tauri::AppHandle,site_url:String)->Result<serde_json::Value,String>{
 tauri::async_runtime::spawn_blocking(move||{
  let db=app.state::<Db>();
  {let conn=db.0.lock().map_err(|e|e.to_string())?;check_authorized_site(&conn,&site_url,None)?}
  google::list_sitemaps(&site_url)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn get_inspection_history(db:State<'_,Db>,site_url:String)->Result<Vec<serde_json::Value>,String>{
 let conn=db.0.lock().map_err(|e|e.to_string())?;check_authorized_site(&conn,&site_url,None)?;
 let mut stmt=match conn.prepare("SELECT id,site_url,inspection_url,inspected_at,result_json FROM index_inspections WHERE site_url=?1 ORDER BY id DESC LIMIT 80"){
  Ok(s)=>s,Err(rusqlite::Error::SqliteFailure(_,Some(s))) if s.contains("no such table")=>return Ok(vec![]),
  Err(e)=>return Err(e.to_string())
 };
 let result=stmt.query_map([site_url],|r|{
  let raw=r.get::<_,String>(4)?;
  Ok(serde_json::json!({"id":r.get::<_,i64>(0)?,"siteUrl":r.get::<_,String>(1)?,"inspectionUrl":r.get::<_,String>(2)?,"inspectedAt":r.get::<_,String>(3)?,"inspection":serde_json::from_str::<serde_json::Value>(&raw).unwrap_or(serde_json::Value::Null)}))
 }).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string());
 result
}
#[tauri::command]
fn save_ai_import(db:State<'_,Db>,site_url:String,dimension:String,filename:String,rows:Vec<serde_json::Value>)->Result<i64,String>{
 if site_url.len()>512||filename.len()>255||!["date","page","query"].contains(&dimension.as_str())||rows.is_empty()||rows.len()>10000{return Err("Invalid AI export metadata or row count (maximum 10,000)".into())}
 let mut normalized=Vec::new();
 for v in &rows{
  let key=v.get("key").and_then(|x|x.as_str()).unwrap_or("").trim();
  let citations=v.get("citations").and_then(|x|x.as_f64()).unwrap_or(-1.);
  if key.is_empty()||key.len()>1500||!citations.is_finite()||citations<0.||citations>1e12{return Err("Invalid citation data row".into())}
  normalized.push((key.to_string(),citations));
 }
 let mut conn=db.0.lock().map_err(|e|e.to_string())?;
 conn.execute_batch("CREATE TABLE IF NOT EXISTS ai_imports(id INTEGER PRIMARY KEY AUTOINCREMENT,engine TEXT NOT NULL,site_url TEXT NOT NULL,dimension TEXT NOT NULL,filename TEXT NOT NULL,imported_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS ai_metrics(import_id INTEGER NOT NULL,metric_key TEXT NOT NULL,citations REAL NOT NULL);CREATE INDEX IF NOT EXISTS idx_ai_site ON ai_imports(site_url,dimension,id DESC);").map_err(|e|e.to_string())?;
 let tx=conn.transaction().map_err(|e|e.to_string())?;
 tx.execute("INSERT INTO ai_imports(engine,site_url,dimension,filename,imported_at) VALUES('bing',?1,?2,?3,?4)",params![site_url,dimension,filename,chrono::Utc::now().to_rfc3339()]).map_err(|e|e.to_string())?;
 let id=tx.last_insert_rowid();
 {let mut stmt=tx.prepare("INSERT INTO ai_metrics(import_id,metric_key,citations) VALUES(?1,?2,?3)").map_err(|e|e.to_string())?;
 for (key,value) in normalized{stmt.execute(params![id,key,value]).map_err(|e|e.to_string())?;}}
 tx.commit().map_err(|e|e.to_string())?;Ok(id)
}
#[tauri::command]
fn get_ai_search_report(db:State<'_,Db>,site_url:String)->Result<serde_json::Value,String>{
 let conn=db.0.lock().map_err(|e|e.to_string())?;
 let mut meta=Vec::new();
 let mut stmt=match conn.prepare("SELECT id,engine,dimension,filename,imported_at FROM ai_imports WHERE site_url=?1 ORDER BY id DESC LIMIT 40"){
  Ok(s)=>s,Err(rusqlite::Error::SqliteFailure(_,Some(s))) if s.contains("no such table")=>return Ok(serde_json::json!({"siteUrl":site_url,"imports":[],"series":[]})),
  Err(e)=>return Err(e.to_string())};
 let imports=stmt.query_map([site_url.as_str()],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
 let mut series=Vec::new();
 let mut used=std::collections::HashSet::new();
 for (id,engine,dimension,filename,imported_at) in imports{
  meta.push(serde_json::json!({"id":id,"engine":engine,"dimension":dimension,"filename":filename,"importedAt":imported_at}));
  if !used.insert(dimension.clone()){continue}
  let mut stmt=conn.prepare("SELECT metric_key,citations FROM ai_metrics WHERE import_id=?1 ORDER BY citations DESC LIMIT 300").map_err(|e|e.to_string())?;
  let rows=stmt.query_map([id],|r|Ok(serde_json::json!({"key":r.get::<_,String>(0)?,"citations":r.get::<_,f64>(1)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
  series.push(serde_json::json!({"dimension":dimension,"source":"Bing AI Performance manual CSV export","importId":id,"importedAt":imported_at,"rows":rows}));
 }
 Ok(serde_json::json!({"siteUrl":site_url,"imports":meta,"series":series}))
}
pub fn inspect_index_cli(site:&str,url:&str)->Result<serde_json::Value,String>{
 let home=std::env::var("HOME").map_err(|_|"HOME unavailable")?;
 let path=PathBuf::from(home).join(".local/share/com.advertpreneur.gscmaestro/maestro.sqlite3");
 let conn=Connection::open(path).map_err(|e|e.to_string())?;
 check_authorized_site(&conn,site,Some(url))?;
 let result=google::inspect_index(site,url)?;
 conn.execute_batch("CREATE TABLE IF NOT EXISTS index_inspections(id INTEGER PRIMARY KEY AUTOINCREMENT,site_url TEXT NOT NULL,inspection_url TEXT NOT NULL,inspected_at TEXT NOT NULL,result_json TEXT NOT NULL);CREATE INDEX IF NOT EXISTS idx_index_site ON index_inspections(site_url,id DESC);").map_err(|e|e.to_string())?;
 conn.execute("INSERT INTO index_inspections(site_url,inspection_url,inspected_at,result_json)VALUES(?1,?2,?3,?4)",params![site,url,chrono::Utc::now().to_rfc3339(),result.to_string()]).map_err(|e|e.to_string())?;
 Ok(result)
}
pub fn sitemaps_cli(site:&str)->Result<serde_json::Value,String>{
 let home=std::env::var("HOME").map_err(|_|"HOME unavailable")?;
 let conn=Connection::open(PathBuf::from(home).join(".local/share/com.advertpreneur.gscmaestro/maestro.sqlite3")).map_err(|e|e.to_string())?;
 check_authorized_site(&conn,site,None)?;
 google::list_sitemaps(site)
}
pub fn run(){tauri::Builder::default().setup(|app|{let path=db_path(app.handle()).map_err(std::io::Error::other)?;let conn=Connection::open(path)?;conn.execute_batch("
 PRAGMA foreign_keys=ON;
 PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS imports(id INTEGER PRIMARY KEY,filename TEXT NOT NULL,imported_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS query_rows(import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,query TEXT NOT NULL,clicks REAL NOT NULL,impressions REAL NOT NULL,ctr REAL NOT NULL,position REAL NOT NULL);
 CREATE INDEX IF NOT EXISTS query_rows_import ON query_rows(import_id);
 CREATE TABLE IF NOT EXISTS gsc_sites(site_url TEXT PRIMARY KEY,permission TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS gsc_syncs(id INTEGER PRIMARY KEY,site_url TEXT NOT NULL REFERENCES gsc_sites(site_url),start_date TEXT NOT NULL,end_date TEXT NOT NULL,synced_at TEXT NOT NULL,query_rows_limited INTEGER NOT NULL DEFAULT 0,page_rows_limited INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS gsc_metrics(sync_id INTEGER NOT NULL REFERENCES gsc_syncs(id) ON DELETE CASCADE,dimension TEXT NOT NULL,key TEXT NOT NULL,clicks REAL NOT NULL,impressions REAL NOT NULL,ctr REAL NOT NULL,position REAL NOT NULL,PRIMARY KEY(sync_id,dimension,key));
 CREATE INDEX IF NOT EXISTS gsc_sync_site_idx ON gsc_syncs(site_url,id DESC);
 ")?;app.manage(Db(Mutex::new(conn)));Ok(())}).invoke_handler(tauri::generate_handler![get_status,get_import_data,import_query_csv,configure_google,connect_google,disconnect_google,list_cached_sites,refresh_google_sites,sync_google_site,get_site_report,set_background_sync,get_mcp_bridge_status,analyze_website,get_public_audit_history,configure_bing_api,disconnect_bing_api,get_bing_status,get_bing_report,sync_bing_now,configure_yandex_oauth,disconnect_yandex_oauth,get_yandex_status,get_yandex_report,sync_yandex_now,run_public_audit,get_saved_public_audit,inspect_google_url,google_sitemaps,get_inspection_history,save_ai_import,get_ai_search_report]).run(tauri::generate_context!()).expect("GSC Maestro failed to start");}
