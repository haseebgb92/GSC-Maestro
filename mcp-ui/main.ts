import { App } from "@modelcontextprotocol/ext-apps";
import logo from "../public/maestro.svg?raw";
import "./styles.css";
import {drawVisual,renderPublicVisuals} from "./visuals";

type Datum={key:string;clicks:number;impressions:number;ctrPercent:number;position:number|null};
type Property={siteUrl:string;permission?:string;verified?:boolean;updatedAt?:string;lastSync?:string|null};
type Report={engine?:"google"|"bing"|"yandex";siteUrl:string;startDate:string|null;endDate:string|null;syncedAt:string;properties?:Property[];
kpis:{clicks:number;impressions:number;ctrPercent:number;averagePosition:number|null};
daily:Datum[];topQueries:Datum[];topPages:Datum[];
limits?:{queryRowsLimited?:boolean;pageRowsLimited?:boolean;anonymizedQueriesMayBeOmitted?:boolean}};
type Tab="queries"|"pages"|"opportunities";
type Metric="dual"|"clicks"|"impressions"|"ctrPercent"|"position";
const $=<T extends HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const app=new App({name:"GSC Maestro",version:"1.0.0"});
const compact=new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1});
const number=new Intl.NumberFormat("en-US",{maximumFractionDigits:0});
const decimal=new Intl.NumberFormat("en-US",{maximumFractionDigits:2});
const state:{engine:"google"|"bing"|"yandex";data:Report|null;properties:Property[];tab:Tab;metric:Metric;sort:keyof Datum;desc:boolean;page:number;filter:string;loading:boolean}
={engine:"google",data:null,properties:[],tab:"queries",metric:"dual",sort:"impressions",desc:true,page:0,filter:"",loading:false};
const PAGE=12;
$("#maestro-mark").innerHTML=logo;
function setNotice(message:string,error=false){const el=$("#notice");el.textContent=message;el.classList.toggle("error",error);el.hidden=!message}
function dataset(){const d=state.data;if(!d)return [] as Datum[];if(state.tab==="pages")return d.topPages;if(state.tab==="opportunities")return d.topQueries.filter(r=>r.position!==null&&r.position>=4&&r.position<=20);return d.topQueries}
function filtered(){
 const q=state.filter.trim().toLowerCase();
 const list=dataset().filter(d=>!q||d.key.toLowerCase().includes(q));
 const order=state.desc?-1:1;
 list.sort((a,b)=>{const k=state.sort;if(k==="key")return String(a.key).localeCompare(String(b.key))*order;return (Number(a[k])-Number(b[k]))*order});
 return list;
}
function cell(tr:HTMLTableRowElement,val:string,css=""){const td=document.createElement("td");td.textContent=val;td.className=css;tr.appendChild(td)}
function drawRows(){
 const d=state.data;if(!d)return;$("#qcount").textContent=String(d.topQueries.length);$("#pcount").textContent=String(d.topPages.length);
 $("#ocount").textContent=String(d.topQueries.filter(r=>r.position!==null&&r.position>=4&&r.position<=20).length);
 const list=filtered(),totalPages=Math.max(1,Math.ceil(list.length/PAGE));state.page=Math.min(state.page,totalPages-1);
 const rows=$("#rows");rows.replaceChildren();
 for(const r of list.slice(state.page*PAGE,(state.page+1)*PAGE)){const tr=document.createElement("tr");
 cell(tr,r.key,"first");cell(tr,r.clicks===null?"—":number.format(r.clicks),"num");cell(tr,r.impressions===null?"—":number.format(r.impressions),"num");
 cell(tr,r.ctrPercent===null?"—":decimal.format(r.ctrPercent)+"%","num");cell(tr,r.position==null?"—":decimal.format(r.position),"num");rows.appendChild(tr);}
 if(!list.length){const tr=document.createElement("tr");const td=document.createElement("td");td.colSpan=5;td.className="empty-row";td.textContent="No matching records";tr.appendChild(td);rows.appendChild(tr)}
 $("#row-count").textContent=String(list.length)+" matching rows · "+(state.page*PAGE+Math.min(PAGE,list.length-state.page*PAGE)===0?"0":(state.page*PAGE+1))+"–"+Math.min((state.page+1)*PAGE,list.length)+" shown";
 $("#page").textContent=(state.page+1)+"/"+totalPages;
 ($("#prev") as HTMLButtonElement).disabled=state.page<=0;($("#next") as HTMLButtonElement).disabled=state.page>=totalPages-1;
 $("#row-description").textContent=state.tab==="opportunities"?"Query positions 4–20, ranked by impressions · not guaranteed gains":state.tab==="pages"?"Top landing pages from the last synchronized snapshot":"Top queries from the last synchronized snapshot";
}
function drawChart(){if(state.data)drawVisual(state.data,state.metric,($("#smooth") as HTMLInputElement).checked);}
function showPublic(report:any){
 if(!report||report.mode!=="public"||!report.summary||!Array.isArray(report.pages))throw Error("Invalid public audit response");
 ( $("#dashboard") as HTMLElement).hidden=true;
 ( $("#public-dashboard") as HTMLElement).hidden=false;
 const set=(id:string,value:unknown)=>{$("#"+id).textContent=String(value)};
 set("public-domain",report.domain);set("public-score",report.summary.score);set("public-meta",report.pages.length+" public pages · "+new Date(report.auditedAt).toLocaleString());
 set("public-pages",report.pages.length);set("public-issues",report.summary.issueCount);
 set("public-alt",report.summary.imagesMissingAlt);set("public-schema",report.summary.withStructuredData);
 set("public-count",report.pages.length+" pages sampled");
 const select=$("#site-select") as HTMLSelectElement;select.replaceChildren();
 const option=document.createElement("option");option.textContent=report.domain+" · Public crawl";select.appendChild(option);select.disabled=true;
 set("date-range","Public crawl · "+new Date(report.auditedAt).toLocaleDateString());
 const bars=$("#public-bars");bars.replaceChildren();
 for(const name of ["critical","high","medium","low"]){const count=Number(report.summary[name]||0),card=document.createElement("div");card.className="public-bar";
 const label=document.createElement("strong");label.textContent=name;const value=document.createElement("span");value.textContent=String(count);const track=document.createElement("div");track.className="public-bar-track";
 const fill=document.createElement("i");fill.style.width=Math.max(3,100*count/Math.max(1,report.summary.issueCount))+"%";
 fill.style.background=({critical:"#e3645e",high:"#e9a24b",medium:"#8a79da",low:"#26ae9b"} as Record<string,string>)[name];track.appendChild(fill);card.append(label,value,track);bars.appendChild(card)}
 const table=$("#public-table");table.replaceChildren();
 for(const page of report.pages){const tr=document.createElement("tr");for(const [idx,value] of [page.title||page.url,page.score,page.status,page.words,page.h1Count,page.issues.filter((i:any)=>i.severity!=="info").length].entries()){
  const td=document.createElement("td");td.textContent=String(value);if(idx===0)td.className="public-table-first";tr.appendChild(td)}table.appendChild(tr)}
 const findings=$("#public-findings");findings.replaceChildren();
 const priority={critical:0,high:1,medium:2,low:3,info:4} as Record<string,number>;
 for(const issue of [...report.summary.issues].filter((x:any)=>x.severity!=="info").sort((a:any,b:any)=>priority[a.severity]-priority[b.severity]).slice(0,15)){
  const box=document.createElement("div");box.className="finding";const tag=document.createElement("span");tag.className="finding-badge";tag.textContent=issue.severity;
  const content=document.createElement("div"),headline=document.createElement("strong"),small=document.createElement("small");headline.textContent=issue.message;small.textContent=issue.url;content.append(headline,small);box.append(tag,content);findings.appendChild(box)}
 renderPublicVisuals(report);
 setNotice("");
}
function showReport(d:Report){
 state.engine=d.engine==="yandex"?"yandex":d.engine==="bing"?"bing":"google";
 $("#engine-name").textContent=state.engine==="yandex"?"YANDEX WEBMASTER":state.engine==="bing"?"BING WEBMASTER TOOLS":"GOOGLE SEARCH CONSOLE";
 $("#engine-google").classList.toggle("chosen",state.engine==="google");
 $("#engine-bing").classList.toggle("chosen",state.engine==="bing");
 $("#engine-yandex").classList.toggle("chosen",state.engine==="yandex");
 document.querySelectorAll<HTMLButtonElement>('.chart-filter[data-metric="position"]').forEach(b=>{b.disabled=state.engine==="bing"||state.engine==="yandex"&&d.kpis.averagePosition===null;b.title=b.disabled?"Position unavailable for this source":""});
 if((state.engine==="bing"||state.engine==="yandex"&&d.kpis.averagePosition===null)&&state.metric==="position")state.metric="dual";
 ( $("#public-dashboard") as HTMLElement).hidden=true;
 if(!d||!Array.isArray(d.daily)||!d.kpis)throw Error("The MCP tool returned no valid snapshot");
 if(state.engine==="yandex"){
  const missing=d.daily.filter(r=>r.clicks===null||r.impressions===null).length;
  d.daily=d.daily.filter(r=>r.clicks!==null&&r.impressions!==null);
  if(missing)setNotice("Yandex omitted "+missing+" incomplete daily data point(s), not interpreted as zero.");
 }
 state.data=d;
 if(d.properties?.length)state.properties=d.properties.filter(s=>s.permission!=="siteUnverifiedUser");
 const select=$("#site-select") as HTMLSelectElement;
 if(state.properties.length){const current=d.siteUrl;select.replaceChildren();
 for(const p of state.properties){const option=document.createElement("option");option.value=p.siteUrl;option.textContent=p.siteUrl;select.appendChild(option)}
 select.value=current;select.disabled=false;}
 $("#date-range").textContent=(d.startDate||"—")+" — "+(d.endDate||"—");
 $("#kpi-clicks").textContent=d.kpis.clicks===null?"—":number.format(d.kpis.clicks);
 $("#kpi-impressions").textContent=d.kpis.impressions===null?"—":number.format(d.kpis.impressions);
 $("#kpi-ctr").textContent=d.kpis.ctrPercent===null?"—":decimal.format(d.kpis.ctrPercent)+"%";
 $("#kpi-position").textContent=d.kpis.averagePosition===null?"Not supplied":decimal.format(d.kpis.averagePosition);
 $("#freshness").textContent="Synced "+new Date(d.syncedAt).toLocaleString();
 $("#caveat").textContent=state.engine==="yandex"?"Yandex all-query daily history and top-500 popular queries · index counts are Yandex-specific · landing-page performance unavailable":state.engine==="bing"?"Bing KPIs: latest 90 days · query/page records may cover longer history · sitewide position unavailable":"Google may omit anonymized queries and data is delayed";
 ($("#dashboard") as HTMLElement).hidden=false;setNotice("");drawChart();drawRows();
}
async function load(siteUrl?:string){
 if(state.loading)return;state.loading=true;($("#refresh") as HTMLButtonElement).disabled=true;setNotice("Reading synchronized Search Console data…");
 try{const result=await app.callServerTool({name:state.engine==="yandex"?"maestro_yandex_dashboard":state.engine==="bing"?"maestro_bing_dashboard":"maestro_dashboard",arguments:siteUrl?{siteUrl}:{}});
 if(result.isError)throw Error(result.content?.find(x=>x.type==="text")?.text||"MCP request failed");
 showReport(result.structuredContent as Report);
 }catch(e){setNotice(e instanceof Error?e.message:String(e),true)}
 finally{state.loading=false;($("#refresh") as HTMLButtonElement).disabled=false}
}
app.ontoolresult=(result)=>{try{
 const d=result.structuredContent as any;
 if(d?.mode==="public")showPublic(d);
 else if(d&&"daily" in d)showReport(d as Report);
 }catch(e){setNotice(String(e),true)}};
app.onhostcontextchanged=(context)=>{if(context?.theme)document.documentElement.dataset.theme=context.theme};
$("#website-form").addEventListener("submit",async e=>{e.preventDefault();
 const url=($("#website-input") as HTMLInputElement).value.trim();if(!url)return;
 setNotice("Checking GSC authorization or crawling public pages…");
 try{
  const r=await app.callServerTool({name:"maestro_analyze_site",arguments:{url,maxPages:8}});
  if(r.isError)throw Error(r.content?.find(x=>x.type==="text")?.text||"Website analysis failed");
  const d=r.structuredContent as any;
  if(d?.mode==="public")showPublic(d);
  else if(d?.mode==="gsc")showReport(d as Report);
  else throw Error("Unexpected website analysis response");
 }catch(err){setNotice(String(err),true)}
});
async function checkSyncHealth(){
 try{
  const res=await app.callServerTool({name:state.engine==="yandex"?"maestro_yandex_status":state.engine==="bing"?"maestro_bing_status":"maestro_sync_status",arguments:{}});
  if(res.isError)throw Error(res.content?.find(x=>x.type==="text")?.text||"Could not read sync status");
  const d=res.structuredContent as any;
  const label=state.engine==="yandex"?(d.apiConnected?"Yandex API synced · "+d.verifiedSites+" verified sites":d.tokenConfigured?"Yandex token configured · sync pending":"Yandex OAuth connection needed · open GSC Maestro desktop → Yandex"):state.engine==="bing"?(d.apiConnected?(d.jobActive?"Bing synchronization in progress":d.autoSyncEnabled?"Bing auto-sync active · next "+(d.nextScheduledRun||"scheduled run"):"Bing connected; automatic sync disabled"):"Bing authorization needed · connect in GSC Maestro desktop"):(d.jobActive?"Google API synchronization in progress":d.autoSyncEnabled&&d.timerActive?"Automatic Google sync active · next "+(d.nextScheduledRun||"scheduled run"):"Automatic Google sync disabled");
  $("#sync-health").textContent=label;
  $("#sync-health").parentElement?.classList.toggle("sync-running",Boolean(d.jobActive));
  $("#sync-health").parentElement?.classList.toggle("sync-warning",!d.autoSyncEnabled||d.jobResult==="failed");
 }catch(e){$("#sync-health").textContent="Sync status unavailable: "+String(e)}
}
$("#sync-check").addEventListener("click",()=>void checkSyncHealth());
$("#sync-now").addEventListener("click",async()=>{
 const btn=$("#sync-now") as HTMLButtonElement;btn.disabled=true;
 setNotice("Queuing fresh "+(state.engine==="yandex"?"Yandex":state.engine==="bing"?"Bing":"Google Search Console")+" sync…");
 try{
  const r=await app.callServerTool({name:state.engine==="yandex"?"maestro_yandex_sync_now":state.engine==="bing"?"maestro_bing_sync_now":"maestro_sync_now",arguments:{}});
  if(r.isError)throw Error(r.content?.find(x=>x.type==="text")?.text||"Sync could not start");
  const d=r.structuredContent as any;setNotice(d?.message||"Sync requested. Check status then reload saved data.");
  await checkSyncHealth();
 }catch(e){setNotice(String(e),true)}finally{btn.disabled=false}
});
$("#engine-google").addEventListener("click",()=>{state.engine="google";void checkSyncHealth();state.data=null;($("#dashboard") as HTMLElement).hidden=true;($("#public-dashboard") as HTMLElement).hidden=true;void load()});
$("#engine-bing").addEventListener("click",async()=>{
 state.engine="bing";void checkSyncHealth();state.data=null;($("#dashboard") as HTMLElement).hidden=true;($("#public-dashboard") as HTMLElement).hidden=true;
 $("#engine-name").textContent="BING WEBMASTER TOOLS";$("#engine-bing").classList.add("chosen");$("#engine-google").classList.remove("chosen");
 setNotice("Checking Bing Webmaster authorization and local reports…");
 try{
  const result=await app.callServerTool({name:"maestro_bing_sites",arguments:{}});
  if(result.isError)throw Error(result.content?.find(x=>x.type==="text")?.text||"Bing sites unavailable");
  const d=result.structuredContent as any,ready=d.sites?.filter((x:any)=>x.verified&&x.lastSync)||[];
  if(!ready.length){setNotice(d.connection?.apiConnected?"Bing is connected but has no synchronized reports yet. Use Sync Bing then reload.":"Bing needs one-time API authorization. Open GSC Maestro desktop → Bing and connect your existing API key.");return}
  await load(ready[0].siteUrl);
 }catch(e){setNotice(String(e),true)}
});
$("#engine-yandex").addEventListener("click",async()=>{
 state.engine="yandex";state.data=null;($("#dashboard") as HTMLElement).hidden=true;($("#public-dashboard") as HTMLElement).hidden=true;
 $("#engine-yandex").classList.add("chosen");$("#engine-bing").classList.remove("chosen");$("#engine-google").classList.remove("chosen");
 $("#engine-name").textContent="YANDEX WEBMASTER";
 void checkSyncHealth();setNotice("Checking Yandex Webmaster OAuth and verified properties…");
 try{
  const r=await app.callServerTool({name:"maestro_yandex_sites",arguments:{}});
  if(r.isError)throw Error(r.content?.find(x=>x.type==="text")?.text||"Yandex property list unavailable");
  const v=r.structuredContent as any,ready=v.sites?.filter((x:any)=>x.verified&&x.lastSync)||[];
  if(!ready.length){setNotice(v.connection?.tokenConfigured?"Yandex token saved, no confirmed verified-site data yet. Run sync in desktop app.":"Connect Yandex OAuth in GSC Maestro desktop → Yandex, then sync your verified properties.");return}
  await load(ready[0].siteUrl);
 }catch(e){setNotice(String(e),true)}
});
$("#site-select").addEventListener("change",e=>{const site=(e.target as HTMLSelectElement).value;state.page=0;state.filter="";($("#filter") as HTMLInputElement).value="";void load(site)});
$("#refresh").addEventListener("click",()=>void load(state.data?.siteUrl));
$("#smooth").addEventListener("change",()=>drawChart());
document.querySelectorAll<HTMLButtonElement>(".chart-filter").forEach(b=>b.addEventListener("click",()=>{state.metric=b.dataset.metric as Metric;document.querySelectorAll(".chart-filter").forEach(x=>x.classList.toggle("active",x===b));drawChart()}));
document.querySelectorAll<HTMLButtonElement>(".tab").forEach(b=>b.addEventListener("click",()=>{state.tab=b.dataset.tab as Tab;state.page=0;document.querySelectorAll(".tab").forEach(x=>{x.classList.toggle("active",x===b);x.setAttribute("aria-selected",String(x===b))});drawRows()}));
$("#filter").addEventListener("input",e=>{state.filter=(e.target as HTMLInputElement).value;state.page=0;drawRows()});
document.querySelectorAll<HTMLButtonElement>("th [data-sort]").forEach(b=>b.addEventListener("click",()=>{const sort=b.dataset.sort as keyof Datum;state.desc=state.sort===sort?!state.desc:sort!=="key";state.sort=sort;state.page=0;drawRows()}));
$("#prev").addEventListener("click",()=>{state.page=Math.max(0,state.page-1);drawRows()});
$("#next").addEventListener("click",()=>{state.page++;drawRows()});
$("#export").addEventListener("click",()=>{const rows=filtered();const esc=(x:unknown)=>'"'+String(x).replaceAll('"','""')+'"';const csv=[["Query / page","Clicks","Impressions","CTR percent","Average position"].map(esc).join(","),...rows.map(d=>[d.key,d.clicks,d.impressions,d.ctrPercent,d.position].map(esc).join(","))].join("\r\n");const obj=new Blob([csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(obj);const a=document.createElement("a");a.href=url;a.download="gsc-maestro-"+state.tab+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
void app.connect().then(()=>checkSyncHealth()).catch(e=>setNotice("MCP host connection failed: "+String(e),true));

import "./visual-charts.css";
