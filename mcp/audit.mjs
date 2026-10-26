import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import {DatabaseSync} from "node:sqlite";
import {join} from "node:path";
import {homedir} from "node:os";
import {load} from "cheerio";
import robotsParser from "robots-parser";
import ipaddr from "ipaddr.js";
import {extractMainContent,availableScrapling} from "./scrapling.mjs";

const UA="GSCMaestroAudit/0.5 (+https://advertpreneur.com; respectful SEO crawler)";
const MAX_PAGES=12;
const LIMIT=1250_000;
const TIMEOUT_MS=9500;
const DELAY_MS=500;
const DB_PATH=process.env.GSC_MAESTRO_DB||join(homedir(),".local/share/com.advertpreneur.gscmaestro/maestro.sqlite3");
const skipExt=/\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|jpe?g|png|gif|webp|svg|ico|mp4|mp3|webm|css|js|json|xml|txt|woff2?|ttf|eot)(?:$|\?)/i;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

export function canonicalInput(input){
 if(typeof input!=="string"||input.length>1024)throw Error("Enter a domain or public HTTP(S) URL");
 let raw=input.trim();
 if(!raw)throw Error("Enter a website URL");
 if(!/^https?:\/\//i.test(raw))raw="https://"+raw;
 let url;
 try{url=new URL(raw)}catch{throw Error("Invalid website URL")}
 if(!["http:","https:"].includes(url.protocol))throw Error("Only HTTP(S) websites are supported");
 if(url.username||url.password)throw Error("URLs with embedded credentials are not permitted");
 if(url.port&&url.port!==(url.protocol==="https:"?"443":"80"))throw Error("Only standard web ports are permitted");
 if(!url.hostname.includes(".")||net.isIP(url.hostname)||url.hostname.endsWith(".local")||url.hostname.endsWith(".localhost"))throw Error("Enter a publicly hosted domain, not a local hostname or IP");
 if(url.hostname.length>253)throw Error("Invalid domain");
 url.hash="";
 return url;
}
async function resolvePublic(hostname){
 const addresses=await dns.lookup(hostname,{all:true,verbatim:true});
 if(!addresses.length)throw Error("Site does not resolve to an IP address");
 for(const item of addresses){
  const ip=ipaddr.parse(item.address);
  const normalized=ip.kind()==="ipv6"&&ip.isIPv4MappedAddress()?ip.toIPv4Address():ip;
  if(normalized.range()!=="unicast")throw Error("Refusing to contact a non-public network address");
 }
 return addresses.find(x=>x.family===4)||addresses[0];
}
async function request(url,{maxBytes=LIMIT}={}){
 const target=canonicalInput(url.toString());
 const pinned=await resolvePublic(target.hostname);
 const client=target.protocol==="https:"?https:http;
 return new Promise((resolve,reject)=>{
  const req=client.request(target,{method:"GET",timeout:TIMEOUT_MS,maxHeaderSize:16384,
   lookup:(_host,opts,cb)=>opts.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family),
   headers:{"User-Agent":UA,"Accept":"text/html,application/xhtml+xml,text/plain;q=0.7,*/*;q=0.1","Accept-Encoding":"identity","Connection":"close"}
  },res=>{
   const chunks=[];let bytes=0;
   res.on("data",chunk=>{bytes+=chunk.length;if(bytes>maxBytes){req.destroy(new Error("Page exceeded bounded download limit"));return}chunks.push(chunk)});
   res.on("end",()=>resolve({status:res.statusCode||0,headers:res.headers,body:Buffer.concat(chunks).toString("utf8"),url:target.href}));
   res.on("error",reject);
  });
  req.on("timeout",()=>req.destroy(new Error("Site request timed out")));
  req.on("error",reject);
  req.end();
 });
}
function sameWebsite(current,next){const a=current.hostname.replace(/^www\./,""),b=next.hostname.replace(/^www\./,"");return a===b;}
async function fetchSafe(url,{maxBytes=LIMIT,onRedirect}={}){
 let dest=canonicalInput(url.toString());
 for(let i=0;i<=5;i++){
  const res=await request(dest,{maxBytes});
  if([301,302,303,307,308].includes(res.status)){
   if(i===5)throw Error("Too many redirects");
   const location=res.headers.location;if(!location)throw Error("Redirect without Location");
   const next=canonicalInput(new URL(location,dest).href);
   if(!sameWebsite(dest,next))throw Error("External redirect blocked by bounded crawler");
   if(next.origin!==dest.origin&&onRedirect)await onRedirect(next);
   dest=next;continue;
  }
  return {...res,finalUrl:dest};
 }
 throw Error("Too many redirects");
}
function compactUrl(href){
 const u=new URL(href);u.hash="";
 for(const key of [...u.searchParams.keys()])if(/^utm_|^gclid$|^fbclid$|^msclkid$/i.test(key))u.searchParams.delete(key);
 return u.href;
}
function scorePage(page){
 const issues=[];
 const add=(code,severity,message,weight)=>issues.push({code,severity,message,weight});
 if(page.status>=400)add("http_error","critical","Page returns HTTP "+page.status,40);
 if(page.noindex)add("noindex","critical","Page declares noindex; search engines should not index it",35);
 if(!page.title)add("missing_title","high","Missing HTML title",16);
 else if(page.titleLength>65||page.titleLength<20)add("title_length","medium","Title outside typical 20–65 character editorial range",5);
 if(!page.description)add("missing_description","medium","Missing meta description",8);
 else if(page.descriptionLength>165)add("long_description","low","Meta description exceeds 165 characters",3);
 if(page.h1Count===0)add("missing_h1","high","Missing H1 heading",12);
 if(page.h1Count>1)add("multiple_h1","low","Multiple H1 headings: "+page.h1Count,3);
 if(!page.canonical)add("missing_canonical","medium","No canonical link declared",7);
 if(page.images>0&&page.imagesMissingAlt>0)add("alt_text","medium",page.imagesMissingAlt+" of "+page.images+" images missing descriptive alt text",Math.min(14,page.imagesMissingAlt*2));
 if(!page.viewport)add("missing_viewport","high","Mobile viewport tag missing",10);
 if(page.words<150)add("limited_text","low","Limited visible text ("+page.words+" words); may be valid for specialized pages",4);
 if(!page.schemaCount)add("no_structured_data","info","No JSON-LD structured data detected",0);
 if(!page.openGraph)add("no_open_graph","info","Open Graph metadata not found",0);
 return {score:Math.max(0,100-issues.reduce((a,x)=>a+x.weight,0)),issues};
}
function parsePage(res,rootHost){
 const $=load(res.body);
 const jsonLd=$('script[type="application/ld+json"]').length;
 const openGraph=!!$('meta[property^="og:"]').length;
 const viewport=!!$('meta[name="viewport"]').attr("content");
 const hreflang=$('link[hreflang]').length;
 const htmlLang=$("html").attr("lang")||"";
 $("script,style,noscript,svg,template").remove();
 const words=$("body").text().replace(/\s+/g," ").trim().split(/\s+/).filter(Boolean).length;
 const title=$("title").first().text().replace(/\s+/g," ").trim().slice(0,500);
 const description=($('meta[name="description"]').attr("content")||"").trim().slice(0,500);
 const h1=$("h1").first().text().replace(/\s+/g," ").trim().slice(0,250);
 const canonical=($('link[rel="canonical"]').attr("href")||"").trim().slice(0,800);
 const noindex=/\bnoindex\b/i.test(($('meta[name="robots"]').attr("content")||"")+" "+(res.headers["x-robots-tag"]||""));
 const images=$("img").length,imagesMissingAlt=$("img").filter((_i,x)=>!$(x).attr("alt")?.trim()).length;
 const links=[];let internalLinks=0,externalLinks=0;
 $('a[href]').each((_i,el)=>{
  const href=$(el).attr("href")||"";
  if(!href||/^(?:mailto:|tel:|javascript:|#)/i.test(href))return;
  try{const link=canonicalInput(new URL(href,res.finalUrl).href);
   if(sameWebsite(link,new URL(res.finalUrl))){internalLinks++;if(links.length<200&&!skipExt.test(link.pathname))links.push(compactUrl(link.href));}else externalLinks++;
  }catch{/* Ignore unsupported links, including non-standard ports */}
 });
 const page={url:res.finalUrl.href,status:res.status,title,titleLength:title.length,description,descriptionLength:description.length,
  h1,h1Count:$("h1").length,words,canonical,noindex,images,imagesMissingAlt,internalLinks,externalLinks,
  schemaCount:jsonLd,openGraph,viewport,htmlLang,hreflang};
 const score=scorePage(page);
 return {...page,...score,links};
}
export function scoreReport(pages){
 const all=pages.flatMap(p=>p.issues.map(i=>({...i,url:p.url})));
 return {score:pages.length?Math.round(pages.reduce((s,p)=>s+p.score,0)/pages.length):0,
  pagesAudited:pages.length,critical:all.filter(i=>i.severity==="critical").length,high:all.filter(i=>i.severity==="high").length,
  medium:all.filter(i=>i.severity==="medium").length,low:all.filter(i=>i.severity==="low").length,
  issueCount:all.filter(i=>i.severity!=="info").length,
  missingTitles:pages.filter(p=>!p.title).length,missingDescriptions:pages.filter(p=>!p.description).length,
  nonIndexable:pages.filter(p=>p.noindex||p.status>=400).length,
  imagesMissingAlt:pages.reduce((s,p)=>s+p.imagesMissingAlt,0),
  totalImages:pages.reduce((s,p)=>s+p.images,0),
  withStructuredData:pages.filter(p=>p.schemaCount>0).length,issues:all};
}
export async function auditPublicSite(input,{maxPages=8,dbPath=DB_PATH,persist=true}={}){
 const url=canonicalInput(input);
 const limit=Math.max(1,Math.min(MAX_PAGES,Math.floor(Number(maxPages)||8)));
 const base=url.origin;
 const robotsCache=new Map();
 async function robotsFor(origin){
  if(robotsCache.has(origin))return robotsCache.get(origin);
  const result=await fetchSafe(new URL("/robots.txt",origin),{maxBytes:550_000});
  if(result.status>=500)throw Error("robots.txt unreachable for "+origin+"; crawl stopped");
  const robot=robotsParser(new URL("/robots.txt",origin).href,result.status<400?result.body:"");
  const crawlDelay=Math.max(DELAY_MS,1000*(Number(robot.getCrawlDelay(UA))||0));
  if(crawlDelay>25000&&limit>1)throw Error("Robots crawl-delay exceeds bounded audit time budget");
  const rules={robot,status:result.status,crawlDelay};robotsCache.set(origin,rules);return rules;
 }
 const initial=await robotsFor(base);
 if(initial.robot.isAllowed(url.href,UA)===false)throw Error("robots.txt disallows crawling this URL");
 const queue=[url.href],seen=new Set(),pages=[],failures=[];
 let enhancedPages=0;
 const deadline=Date.now()+110_000;
 while(queue.length&&pages.length<limit&&seen.size<limit*5&&Date.now()<deadline){
  const next=queue.shift();if(!next||seen.has(next))continue;
  seen.add(next);
  const candidate=canonicalInput(next);
  if(!sameWebsite(url,candidate))continue;
  let currentRules;
  try{currentRules=await robotsFor(candidate.origin)}catch(e){failures.push({url:next,error:String(e.message||e)});continue}
  if(currentRules.robot.isAllowed(candidate.href,UA)===false)continue;
  if(seen.size>1)await sleep(currentRules.crawlDelay);
  try{
   const res=await fetchSafe(candidate,{onRedirect:async target=>{
    const rules=await robotsFor(target.origin);
    if(rules.robot.isAllowed(target.href,UA)===false)throw Error("Destination robots.txt forbids redirected page");
   }});
   if(!String(res.headers["content-type"]||"").match(/text\/html|application\/xhtml/i)){
    failures.push({url:next,error:"Not an HTML page"});continue;
   }
   const page=parsePage(res,url.hostname);
   const {links,...publicPage}=page;
   // Feed only the already-approved HTML to Scrapling; never hand it a URL.
   const contentAnalysis=await extractMainContent(res.body);
   if(contentAnalysis){publicPage.contentAnalysis=contentAnalysis;enhancedPages++;}
   pages.push(publicPage);
   for(const link of links)if(queue.length<60&&!seen.has(link)&&!queue.includes(link))queue.push(link);
  }catch(e){failures.push({url:next,error:String(e.message||e).slice(0,180)});}
 }
 if(!pages.length)throw Error("No public HTML pages could be fetched: "+(failures[0]?.error||"blocked by robots.txt or time budget"));
 const duplicates=new Map();
 for(const page of pages){if(!page.title)continue;const existing=duplicates.get(page.title.toLowerCase());if(existing){page.issues.push({code:"duplicate_title",severity:"medium",message:"Title duplicated with "+existing,weight:5});page.score=Math.max(0,page.score-5)}else duplicates.set(page.title.toLowerCase(),page.url)}
 const report={mode:"public",source:"Public HTTP crawl (not Google Search Console)",url:url.href,domain:url.hostname,auditedAt:new Date().toISOString(),requestedPages:limit,
  robots:{status:initial.status,disallowedPathsHonored:true,originsChecked:[...robotsCache.keys()]},
  extraction:{network:"GSC Maestro bounded public HTTP",scraplingAvailable:availableScrapling(),scraplingPages:enhancedPages},
  summary:scoreReport(pages),pages,failures,
  limits:["Public pages only; no verified Google clicks, search queries or rankings","Bounded crawl, not a full-site census","No external backlinks, organic traffic estimates, or performance lab metrics"]};
 if(persist){
  const db=new DatabaseSync(dbPath);
  try{
   db.exec("CREATE TABLE IF NOT EXISTS public_audits(id INTEGER PRIMARY KEY AUTOINCREMENT,domain TEXT NOT NULL,url TEXT NOT NULL,audited_at TEXT NOT NULL,score INTEGER NOT NULL,pages INTEGER NOT NULL,report_json TEXT NOT NULL)");
   db.prepare("INSERT INTO public_audits(domain,url,audited_at,score,pages,report_json) VALUES(?,?,?,?,?,?)").run(report.domain,report.url,report.auditedAt,report.summary.score,pages.length,JSON.stringify(report));
   db.exec("DELETE FROM public_audits WHERE id NOT IN (SELECT id FROM public_audits ORDER BY id DESC LIMIT 100)");
  }finally{db.close();}
 }
 return report;
}
export function publicAuditHistory(dbPath=DB_PATH,limit=20){
 const db=new DatabaseSync(dbPath,{readOnly:true});
 try{return db.prepare("SELECT id,domain,url,audited_at AS auditedAt,score,pages FROM public_audits ORDER BY id DESC LIMIT ?").all(Math.max(1,Math.min(50,limit)))}
 catch(e){if(/no such table/.test(String(e)))return [];throw e}finally{db.close()}
}
export function savedPublicAudit(id,dbPath=DB_PATH){
 const db=new DatabaseSync(dbPath,{readOnly:true});
 try{const row=db.prepare("SELECT report_json FROM public_audits WHERE id=?").get(id);return row?JSON.parse(row.report_json):null}
 catch(e){if(/no such table/.test(String(e)))return null;throw e}finally{db.close()}
}
