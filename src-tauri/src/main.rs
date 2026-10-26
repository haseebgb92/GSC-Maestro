#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main(){
 let args:Vec<String>=std::env::args().collect();
 if args.iter().any(|a|a=="--import-google-oauth"){
  let target=args.iter().position(|a|a=="--import-google-oauth").and_then(|i|args.get(i+1));
  let result=match target{
   Some(filename)=>gsc_maestro_lib::import_google_oauth_cli(filename),
   None=>Err("Missing path after --import-google-oauth".into())
  };
  match result{Ok(())=>println!("Google Desktop OAuth client stored in OS keyring"),Err(e)=>{eprintln!("OAuth import failed: {e}");std::process::exit(1)}}
  return;
 }
 if args.iter().any(|a|a=="--connect-google"){
  match gsc_maestro_lib::connect_google_cli(){Ok(())=>println!("Google OAuth authorized; credentials stored in keyring"),Err(e)=>{eprintln!("OAuth connection failed: {e}");std::process::exit(1)}}
  return;
 }
 if args.iter().any(|a|a=="--refresh-sites"){
  match gsc_maestro_lib::refresh_sites_cli(){Ok(n)=>println!("Authorized Google properties found: {n}"),Err(e)=>{eprintln!("GSC discovery failed: {e}");std::process::exit(1)}}
  return;
 }
 if let Some(i)=args.iter().position(|a|a=="--inspect-url"){
  let site=args.get(i+1).map(String::as_str).unwrap_or("");let url=args.get(i+2).map(String::as_str).unwrap_or("");
  match gsc_maestro_lib::inspect_index_cli(site,url){Ok(v)=>println!("{}",v),Err(e)=>{eprintln!("Google inspection failed: {e}");std::process::exit(1)}}
  return;
 }
 if let Some(i)=args.iter().position(|a|a=="--list-sitemaps"){
  let site=args.get(i+1).map(String::as_str).unwrap_or("");
  match gsc_maestro_lib::sitemaps_cli(site){Ok(v)=>println!("{}",v),Err(e)=>{eprintln!("Google sitemaps failed: {e}");std::process::exit(1)}}
  return;
 }
 if args.iter().any(|a|a=="--sync-all"){
  match gsc_maestro_lib::sync_all_cli(){Ok(msg)=>println!("{msg}"),Err(e)=>{eprintln!("GSC Maestro sync failed: {e}");std::process::exit(1)}}
  return;
 }
 gsc_maestro_lib::run()
}
