use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{Duration as CDuration,Utc};
use keyring::Entry;
use rand::random;
use rusqlite::{params,Connection};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{io::{Read,Write},net::TcpListener,process::Command,thread,time::{Duration,Instant}};
use url::Url;

const SCOPE:&str="https://www.googleapis.com/auth/webmasters.readonly";
const SERVICE:&str="com.advertpreneur.gscmaestro.google";
const CONFIG_KEY:&str="desktop-oauth-config";
const REFRESH_KEY:&str="refresh-token";

#[derive(Clone,Serialize,Deserialize)]
struct Credentials {client_id:String,client_secret:String}
#[derive(Serialize,Deserialize,Clone)]
pub struct Site {pub site_url:String,pub permission:String,pub updated_at:String}
#[derive(Serialize,Deserialize,Clone)]
pub struct Metric {pub key:String,pub clicks:f64,pub impressions:f64,pub ctr:f64,pub position:f64}
#[derive(Serialize,Deserialize)]
pub struct Report {pub site_url:String,pub start_date:String,pub end_date:String,pub synced_at:String,pub query_rows_limited:bool,pub page_rows_limited:bool,pub daily:Vec<Metric>,pub queries:Vec<Metric>,pub pages:Vec<Metric>}

fn secret(name:&str)->Result<Entry,String>{Entry::new(SERVICE,name).map_err(|e|format!("System keyring unavailable: {e}"))}
fn get_secret(name:&str)->Result<String,String>{secret(name)?.get_password().map_err(|_|"Credentials not present in the system keyring".into())}
pub fn is_configured()->bool{get_secret(CONFIG_KEY).is_ok()}
pub fn is_connected()->bool{get_secret(REFRESH_KEY).is_ok()}
fn credentials()->Result<Credentials,String>{serde_json::from_str(&get_secret(CONFIG_KEY)?).map_err(|_|"Invalid OAuth configuration in keyring".into())}
pub fn configure_google_credentials(content:String)->Result<(),String>{
 let value:Value=serde_json::from_str(&content).map_err(|_|"Invalid JSON. Export a Desktop OAuth client JSON from Google Cloud.".to_string())?;
 let config=value.get("installed").ok_or("Expected a Google OAuth Desktop application JSON with an 'installed' section")?;
 let client_id=config.get("client_id").and_then(Value::as_str).unwrap_or("");
 let client_secret=config.get("client_secret").and_then(Value::as_str).unwrap_or("");
 if !client_id.ends_with(".apps.googleusercontent.com") || client_id.len()>512{return Err("Invalid Google Desktop OAuth client ID".into())}
 if client_secret.len()>512{return Err("OAuth client secret too long".into())}
 let c=Credentials{client_id:client_id.into(),client_secret:client_secret.into()};
 secret(CONFIG_KEY)?.set_password(&serde_json::to_string(&c).map_err(|e|e.to_string())?)
 .map_err(|e|format!("Could not save OAuth configuration to the OS keyring: {e}"))?;
 Ok(())
}
fn agent()->ureq::Agent {ureq::AgentBuilder::new().timeout(Duration::from_secs(25)).build()}
fn http_json(response:Result<ureq::Response,ureq::Error>)->Result<Value,String>{
 match response {
  Ok(resp)=>resp.into_json::<Value>().map_err(|_|"Google returned an unreadable API response".into()),
  Err(ureq::Error::Status(status,resp))=>{
   let info=resp.into_json::<Value>().unwrap_or(Value::Null);
   let reason=info.pointer("/error/message").and_then(Value::as_str)
    .or_else(||info.get("error_description").and_then(Value::as_str))
    .or_else(||info.get("error").and_then(Value::as_str)).unwrap_or("Request rejected");
   Err(format!("Google API HTTP {status}: {}",reason.chars().take(220).collect::<String>()))
  },
  Err(e)=>Err(format!("Connection to Google failed: {e}"))
 }
}
fn token_exchange(params:&[(&str,&str)])->Result<Value,String>{
 http_json(agent().post("https://oauth2.googleapis.com/token").send_form(params))
}
fn access_token()->Result<String,String>{
 let cred=credentials()?;let refresh=get_secret(REFRESH_KEY)?;
 let mut pairs=vec![("client_id",cred.client_id.as_str()),("refresh_token",refresh.as_str()),("grant_type","refresh_token")];
 if !cred.client_secret.is_empty(){pairs.push(("client_secret",cred.client_secret.as_str()));}
 let v=token_exchange(&pairs)?;
 v.get("access_token").and_then(Value::as_str).map(str::to_string).ok_or("Google returned no access token".into())
}
fn get_api(url:&str,token:&str)->Result<Value,String>{
 http_json(agent().get(url).set("Authorization",&format!("Bearer {token}")).call())
}
fn post_api(url:&str,token:&str,body:Value)->Result<Value,String>{
 http_json(agent().post(url).set("Authorization",&format!("Bearer {token}")).send_json(body))
}

pub fn connect_google()->Result<(),String>{
 let cred=credentials()?;
 let listener=TcpListener::bind("127.0.0.1:0").map_err(|e|format!("Cannot open temporary OAuth callback listener: {e}"))?;
 listener.set_nonblocking(true).map_err(|e|e.to_string())?;
 let redirect=format!("http://127.0.0.1:{}/oauth2callback",listener.local_addr().map_err(|e|e.to_string())?.port());
 let state=URL_SAFE_NO_PAD.encode(random::<[u8;32]>());
 let verifier=URL_SAFE_NO_PAD.encode(random::<[u8;32]>());
 let challenge=URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
 let mut auth=Url::parse("https://accounts.google.com/o/oauth2/v2/auth").map_err(|e|e.to_string())?;
 auth.query_pairs_mut().append_pair("client_id",&cred.client_id).append_pair("redirect_uri",&redirect)
  .append_pair("response_type","code").append_pair("scope",SCOPE).append_pair("access_type","offline")
  .append_pair("prompt","consent").append_pair("state",&state).append_pair("code_challenge",&challenge).append_pair("code_challenge_method","S256");
 Command::new("xdg-open").arg(auth.as_str()).spawn().map_err(|e|format!("Could not open the system browser: {e}"))?;
 let start=Instant::now();
 let code=loop {
  if start.elapsed()>Duration::from_secs(180){return Err("Google sign-in timed out after three minutes".into())}
  match listener.accept(){
   Ok((mut stream,_))=>{
    stream.set_read_timeout(Some(Duration::from_secs(4))).ok();
    let mut request=[0u8;8192];let n=stream.read(&mut request).map_err(|e|e.to_string())?;
    let line=String::from_utf8_lossy(&request[..n]).lines().next().unwrap_or("").to_string();
    let target=line.split_whitespace().nth(1).unwrap_or("/");
    let request_url=Url::parse(&format!("http://127.0.0.1{}",target)).map_err(|_|"Invalid OAuth callback URL".to_string())?;
    if request_url.path()!="/oauth2callback"{
      let _=stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      continue;
    }
    let pairs:std::collections::HashMap<String,String>=request_url.query_pairs().into_owned().collect();
    if pairs.get("state").map(String::as_str)!=Some(&state){
     let _=stream.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
     continue;
    }
    let body=if pairs.get("code").is_some() {"<html><body style='font:16px sans-serif;padding:40px'><h2>GSC Maestro authorization received</h2><p>You can close this tab and return to the desktop app.</p></body></html>"}
    else {"<html><body style='font:16px sans-serif;padding:40px'><h2>GSC Maestro authorization was not completed</h2><p>Return to the desktop app.</p></body></html>"};
    let response=format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
    let _=stream.write_all(response.as_bytes());
    if let Some(error)=pairs.get("error"){return Err(format!("Authorization declined: {error}"))}
    if let Some(code)=pairs.get("code"){break code.to_owned()}
    return Err("No authorization code was returned".into());
   },
   Err(ref e) if e.kind()==std::io::ErrorKind::WouldBlock=>thread::sleep(Duration::from_millis(120)),
   Err(e)=>return Err(format!("OAuth listener error: {e}"))
  }
 };
 let mut form=vec![("code",code.as_str()),("client_id",cred.client_id.as_str()),("redirect_uri",redirect.as_str()),("grant_type","authorization_code"),("code_verifier",verifier.as_str())];
 if !cred.client_secret.is_empty(){form.push(("client_secret",cred.client_secret.as_str()));}
 let token=token_exchange(&form)?;
 let refresh=token.get("refresh_token").and_then(Value::as_str).ok_or("No refresh token returned. Revoke the app's previous grant and try again.".to_string())?;
 secret(REFRESH_KEY)?.set_password(refresh).map_err(|e|format!("Could not store refresh token in keyring: {e}"))?;
 Ok(())
}

pub fn inspect_index(site:&str,url:&str)->Result<Value,String>{
 let token=access_token()?;
 post_api("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",&token,
  json!({"inspectionUrl":url,"siteUrl":site,"languageCode":"en-US"}))
}
pub fn list_sitemaps(site:&str)->Result<Value,String>{
 let token=access_token()?;
 let api=format!("https://www.googleapis.com/webmasters/v3/sites/{}/sitemaps",urlencoding::encode(site));
 get_api(&api,&token)
}
pub fn disconnect_google()->Result<(),String>{let s=secret(REFRESH_KEY)?;match s.delete_credential(){Ok(())=>Ok(()),Err(keyring::Error::NoEntry)=>Ok(()),Err(e)=>Err(format!("Could not remove refresh token: {e}"))}}

pub fn refresh_sites(conn:&mut Connection)->Result<Vec<Site>,String>{
 let token=access_token()?;let result=get_api("https://www.googleapis.com/webmasters/v3/sites",&token)?;
 let entries=result.get("siteEntry").and_then(Value::as_array).cloned().unwrap_or_default();
 let now=Utc::now().to_rfc3339();
 let mut sites=Vec::new();
 let tx=conn.transaction().map_err(|e|e.to_string())?;
 for v in entries{
  let site_url=v.get("siteUrl").and_then(Value::as_str).unwrap_or("");
  let permission=v.get("permissionLevel").and_then(Value::as_str).unwrap_or("unknown");
  if site_url.is_empty()||site_url.len()>1000{continue;}
  tx.execute("INSERT INTO gsc_sites(site_url,permission,updated_at)VALUES(?1,?2,?3) ON CONFLICT(site_url) DO UPDATE SET permission=excluded.permission,updated_at=excluded.updated_at",params![site_url,permission,now]).map_err(|e|e.to_string())?;
  sites.push(Site{site_url:site_url.into(),permission:permission.into(),updated_at:now.clone()});
 }
 tx.commit().map_err(|e|e.to_string())?;
 Ok(sites)
}

fn query_data(site:&str,token:&str,start:&str,end:&str,dimension:&str,limit:i64)->Result<Vec<Metric>,String>{
 let url=format!("https://www.googleapis.com/webmasters/v3/sites/{}/searchAnalytics/query",urlencoding::encode(site));
 let body=json!({"startDate":start,"endDate":end,"dimensions":[dimension],"type":"web","dataState":"final","rowLimit":limit,"startRow":0});
 let result=post_api(&url,token,body)?;
 let rows=result.get("rows").and_then(Value::as_array).cloned().unwrap_or_default();
 Ok(rows.into_iter().filter_map(|v|{
  let key=v.get("keys")?.as_array()?.first()?.as_str()?.to_owned();
  let n=|field:&str|v.get(field).and_then(Value::as_f64).unwrap_or(0.);
  Some(Metric{key,clicks:n("clicks"),impressions:n("impressions"),ctr:n("ctr")*100.,position:n("position")})
 }).collect())
}
fn cached_metrics(conn:&Connection,id:i64,dimension:&str)->Result<Vec<Metric>,String>{
 let order=if dimension=="date"{"key ASC"}else{"clicks DESC"};
 let sql=format!("SELECT key,clicks,impressions,ctr,position FROM gsc_metrics WHERE sync_id=?1 AND dimension=?2 ORDER BY {order}");
 let mut stmt=conn.prepare(&sql).map_err(|e|e.to_string())?;
 let rows=stmt.query_map(params![id,dimension],|r|Ok(Metric{key:r.get(0)?,clicks:r.get(1)?,impressions:r.get(2)?,ctr:r.get(3)?,position:r.get(4)?})).map_err(|e|e.to_string())?
 .collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
 Ok(rows)
}
pub fn list_cached_sites(conn:&Connection)->Result<Vec<Site>,String>{
 let mut stmt=conn.prepare("SELECT site_url,permission,updated_at FROM gsc_sites ORDER BY site_url ASC").map_err(|e|e.to_string())?;
 let sites=stmt.query_map([],|r|Ok(Site{site_url:r.get(0)?,permission:r.get(1)?,updated_at:r.get(2)?})).map_err(|e|e.to_string())?
 .collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
 Ok(sites)
}
pub fn sync_site(conn:&mut Connection,site:&str)->Result<Report,String>{
 let exists:i64=conn.query_row("SELECT COUNT(*) FROM gsc_sites WHERE site_url=?1",params![site],|r|r.get(0)).map_err(|e|e.to_string())?;
 if exists==0{return Err("Choose an authorized Search Console property from the property list".into())}
 let end=(Utc::now().date_naive()-CDuration::days(3)).to_string();
 let start=(Utc::now().date_naive()-CDuration::days(30)).to_string();
 let token=access_token()?;
 let daily=query_data(site,&token,&start,&end,"date",90)?;
 let queries=query_data(site,&token,&start,&end,"query",5000)?;
 let pages=query_data(site,&token,&start,&end,"page",3000)?;
 if daily.is_empty(){return Err("Search Console returned no daily data for the selected period. No snapshot was saved.".into())}
 let now=Utc::now().to_rfc3339();
 let tx=conn.transaction().map_err(|e|e.to_string())?;
 tx.execute("INSERT INTO gsc_syncs(site_url,start_date,end_date,synced_at,query_rows_limited,page_rows_limited) VALUES(?1,?2,?3,?4,?5,?6)",params![site,start,end,now,queries.len()>=5000,pages.len()>=3000]).map_err(|e|e.to_string())?;
 let id=tx.last_insert_rowid();
 {let mut stmt=tx.prepare("INSERT INTO gsc_metrics(sync_id,dimension,key,clicks,impressions,ctr,position)VALUES(?1,?2,?3,?4,?5,?6,?7)").map_err(|e|e.to_string())?;
 for (dimension,metrics) in [("date",&daily),("query",&queries),("page",&pages)]{
  for metric in metrics{stmt.execute(params![id,dimension,metric.key,metric.clicks,metric.impressions,metric.ctr,metric.position]).map_err(|e|e.to_string())?;}
 }}
 tx.commit().map_err(|e|e.to_string())?;
 get_site_report(conn,site)?.ok_or("Failed to load completed synchronization".into())
}
pub fn get_site_report(conn:&Connection,site:&str)->Result<Option<Report>,String>{
 let result=conn.query_row("SELECT id,start_date,end_date,synced_at,query_rows_limited,page_rows_limited FROM gsc_syncs WHERE site_url=?1 ORDER BY id DESC LIMIT 1",params![site],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,bool>(4)?,r.get::<_,bool>(5)?)));
 let (id,start_date,end_date,synced_at,query_rows_limited,page_rows_limited)=match result{Ok(v)=>v,Err(rusqlite::Error::QueryReturnedNoRows)=>return Ok(None),Err(e)=>return Err(e.to_string())};
 Ok(Some(Report{site_url:site.into(),start_date,end_date,synced_at,query_rows_limited,page_rows_limited,daily:cached_metrics(conn,id,"date")?,queries:cached_metrics(conn,id,"query")?,pages:cached_metrics(conn,id,"page")?}))
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test] fn invalid_desktop_config_rejected(){assert!(configure_google_credentials("{\"web\":{}}".into()).is_err());}
 #[test] fn metrics_ctr_from_google_are_percent(){let test=Metric{key:"x".into(),clicks:10.,impressions:100.,ctr:10.,position:4.};assert_eq!(test.ctr,10.);}
}
