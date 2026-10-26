import{useEffect,useState}from"react";
import{invoke}from"@tauri-apps/api/core";
import{FileChartColumn,FileDown,Download,ShieldCheck,BarChart3,Database}from"lucide-react";
type Property={site_url:string;permission:string};
type BSite={siteUrl:string;verified:boolean;lastSync:string|null};
type YSite={siteUrl:string;verified:boolean;lastSync:string|null};
type Metric={key:string;clicks:number;impressions:number;ctr:number;position:number|null};
type SearchReport={site:string;engine:string;indexing?:{searchablePages:number|null;excludedPages:number|null;sqi:number|null};period:string;fetchedAt:string;daily:Metric[];pages:Metric[];queries:Metric[];totalClicks:number;totalImpressions:number;ctr:number;sourceNote:string;limited:boolean};
type History={id:number;domain:string;url:string;score:number;auditedAt:string;pages:number};
const integer=(n:number)=>new Intl.NumberFormat("en-US",{maximumFractionDigits:0}).format(n);
function saveCSV(rows:Metric[],filename:string){const lines=[["Keyword or URL","Clicks","Impressions","CTR %","Position"],...rows.map(r=>[r.key,r.clicks,r.impressions,r.ctr,r.position??""])].map(r=>r.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(",")).join("\r\n");const uri=URL.createObjectURL(new Blob([lines],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=uri;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(uri),800)}
export function normalizeSearchReport(engine:"Google"|"Bing"|"Yandex",site:string,x:any):SearchReport {
 const g=engine==="Google";const daily:Metric[]=(x.daily||[]).filter((r:any)=>engine!=="Yandex"||(r.clicks!==null&&r.impressions!==null)).map((r:any)=>({...r,ctr:g?r.ctr:r.ctrPercent,position:r.position??null}));
 const pages:Metric[]=(g?x.pages:x.topPages||[]).map((r:any)=>({...r,ctr:g?r.ctr:r.ctrPercent,position:r.position??null}));
 const queries:Metric[]=(g?x.queries:x.topQueries||[]).map((r:any)=>({...r,ctr:g?r.ctr:r.ctrPercent,position:r.position??null}));
 const clicks=daily.reduce((s,r)=>s+r.clicks,0),impressions=daily.reduce((s,r)=>s+r.impressions,0);
 return {site,engine,indexing:engine==="Yandex"?{searchablePages:x.kpis?.searchablePages??null,excludedPages:x.kpis?.excludedPages??null,sqi:x.kpis?.sqi??null}:undefined,period:(g?x.start_date:x.startDate||"—")+" to "+(g?x.end_date:x.endDate||"—"),fetchedAt:g?x.synced_at:x.syncedAt,daily,pages,queries,totalClicks:clicks,totalImpressions:impressions,ctr:impressions?100*clicks/impressions:0,sourceNote:g?"Google Search Console finalized web analytics for the selected synchronized window":engine==="Yandex"?"Yandex Webmaster all-query history with Yandex-specific index counts; only days with reported clicks and impressions are counted. Page performance is not provided by this connector. Popular queries may be incomplete.":"Bing daily KPIs cover the latest 90 days ending on the last reported day. Query/page data can span a longer period",limited:g?x.page_rows_limited||x.query_rows_limited:pages.length>=100||queries.length>=100};
}

export async function generatePDF(r:SearchReport,history:History[]){
 const {jsPDF}=await import("jspdf");const pdf=new jsPDF({unit:"pt",format:"a4"}),W=pdf.internal.pageSize.getWidth(),M=41;
 let y=0,page=1;const cyan=[21,120,180] as const;
 const header=()=>{pdf.setFillColor(244,248,252);pdf.rect(0,0,W,100,"F");pdf.setTextColor(24,65,99);pdf.setFont("helvetica","bold");pdf.setFontSize(20);pdf.text("ADVERTPRENEUR",M,43);pdf.setFontSize(10);pdf.text("SEARCH INTELLIGENCE  /  GSC MAESTRO",M,63);pdf.setTextColor(85,112,139);pdf.setFont("helvetica","normal");pdf.text("Prepared: "+new Date().toLocaleString("en-PK"),M,83);y=119};
 const footer=()=>{pdf.setFont("helvetica","normal");pdf.setFontSize(8);pdf.setTextColor(120,145,164);pdf.text("Source: "+r.engine+"  |  "+r.period, M, pdf.internal.pageSize.getHeight()-30);pdf.text("Page "+page,W-M-35,pdf.internal.pageSize.getHeight()-30)};
 const pageBreak=(height=22)=>{if(y+height>pdf.internal.pageSize.getHeight()-64){footer();pdf.addPage();page++;header()}};
 const section=(name:string)=>{pageBreak(38);pdf.setTextColor(...cyan);pdf.setFont("helvetica","bold");pdf.setFontSize(13);pdf.text(name,M,y);y+=21};
 const line=(title:string,value:string)=>{pageBreak(21);pdf.setTextColor(48,83,113);pdf.setFont("helvetica","normal");pdf.setFontSize(10);pdf.text(title,M,y);pdf.setFont("helvetica","bold");pdf.text(value,W-M,y,{align:"right"});y+=20};
 const wrapped=(text:string)=>{pdf.setFont("helvetica","normal");pdf.setFontSize(9);const lines=pdf.splitTextToSize(text,W-M*2);for(const l of lines){pageBreak(15);pdf.setTextColor(83,111,133);pdf.text(l,M,y);y+=14}};
 const row=(key:string,clicks:number,imps:number,position:number|null)=>{pdf.setFontSize(8.5);pdf.setFont("helvetica","normal");const label=key.length>102?key.slice(0,99)+"...":key;const lines=pdf.splitTextToSize(label,W-M*2-175).slice(0,2);pageBreak(lines.length*11+11);pdf.setTextColor(38,72,103);pdf.text(lines,M,y);pdf.setTextColor(70,100,128);pdf.text(integer(clicks),W-M-143,y,{align:"right"});pdf.text(integer(imps),W-M-68,y,{align:"right"});pdf.text(position==null?"N/A":position.toFixed(1),W-M,y,{align:"right"});y+=Math.max(17,lines.length*12)+4;pdf.setDrawColor(235,239,244);pdf.line(M,y-7,W-M,y-7)};
 header();pdf.setFont("helvetica","bold");pdf.setFontSize(18);pdf.setTextColor(27,67,108);pdf.text("Search performance report",M,y);y+=24;
 wrapped("Property: "+r.site);wrapped("Reporting period: "+r.period);wrapped("Last synchronized: "+new Date(r.fetchedAt).toLocaleString("en-PK"));
 section("Executive snapshot");line("Total clicks",integer(r.totalClicks));line("Total impressions",integer(r.totalImpressions));line("Click-through rate",r.ctr.toFixed(2)+" %");line("Daily data points",String(r.daily.length));line("Returned query rows",String(r.queries.length));line("Returned landing-page rows",String(r.pages.length));
 section("Visibility and traffic");
 wrapped("Engine: "+r.engine+". "+r.sourceNote.replace(/\.+$/,"")+". These are real data rows for the stated scope; returned query/page rows may not sum to daily totals.");
 if(r.indexing){section("Yandex indexing overview");line("Pages in Yandex Search",r.indexing.searchablePages===null?"Not returned":integer(r.indexing.searchablePages));line("Excluded pages",r.indexing.excludedPages===null?"Not returned":integer(r.indexing.excludedPages));line("Yandex Site Quality Index",r.indexing.sqi===null?"Not returned":integer(r.indexing.sqi))}
 const best=[...r.pages].sort((a,b)=>b.impressions-a.impressions).slice(0,12);
 section("Page visibility chart");
 const peaks=[...r.pages].sort((a,b)=>b.impressions-a.impressions).slice(0,6);
 const maxPeak=Math.max(1,...peaks.map(v=>v.impressions));
 for(const v of peaks){pageBreak(38);pdf.setFont("helvetica","normal");pdf.setFontSize(8);pdf.setTextColor(64,101,132);
  const label=v.key.length>64?v.key.slice(0,61)+"...":v.key;
  pdf.text(label,M,y);y+=9;pdf.setFillColor(232,241,249);pdf.roundedRect(M,y,W-2*M,10,4,4,"F");
  pdf.setFillColor(28,140,192);pdf.roundedRect(M,y,Math.max(3,(W-2*M)*(v.impressions/maxPeak)),10,4,4,"F");y+=19;}
 section("Leading landing pages");pdf.setFont("helvetica","bold");pdf.setFontSize(8);pdf.setTextColor(100,130,156);pdf.text("PAGE",M,y);pdf.text("CLICKS",W-M-143,y,{align:"right"});pdf.text("IMPR.",W-M-68,y,{align:"right"});pdf.text("POS.",W-M,y,{align:"right"});y+=15;for(const v of best)row(v.key,v.clicks,v.impressions,v.position);
 section("Top search queries");const queries=[...r.queries].sort((a,b)=>b.impressions-a.impressions).slice(0,15);for(const v of queries)row(v.key,v.clicks,v.impressions,v.position);
 const recent=history.filter(h=>{try{const u=new URL(r.site.startsWith("sc-domain:")?"https://"+r.site.slice(10):r.site);return h.domain.replace(/^www\./,"")===u.hostname.replace(/^www\./,"")}catch{return false}}).slice(0,3);
 if(recent.length){section("Technical evidence");for(const a of recent){line("Crawl "+new Date(a.auditedAt).toLocaleDateString("en-PK"),"Score "+a.score+"/100 ("+a.pages+" pages)")}}
 section("Priority follow-ups");
 if(r.pages.some(p=>p.impressions>=100&&p.clicks===0))wrapped("Review high-impression pages with no clicks: improve title/description clarity, query intent match and SERP attractiveness after inspecting specific URLs.");
 if(r.queries.some(p=>p.position!==null&&p.position>=4&&p.position<=20))wrapped("Review search queries in positions 4–20, prioritizing those with verified impressions and existing relevant content.");
 if(recent.length)wrapped("Review detailed saved Site Audit observations before making technical fixes.");
 if(!r.pages.length)wrapped("No landing-page rows were returned for this selected engine and reporting scope.");
 if(!r.queries.length)wrapped("No query-level observations were returned for this selected engine and reporting scope.");
 wrapped("Search engine reporting may exclude anonymized queries and sample data. Indexing status is not inferred from search traffic. Query/page aggregates may cover a different window from the daily KPIs. This report is not a forecast.");
 footer();
 pdf.save("advertpreneur-"+r.engine.toLowerCase().replaceAll(" ","-")+"-"+new Date().toISOString().slice(0,10)+".pdf");
}
export default function Reports(){
 const[engine,setEngine]=useState<"Google"|"Bing"|"Yandex">("Google"),[google,setGoogle]=useState<Property[]>([]),[bing,setBing]=useState<BSite[]>([]),[yandex,setYandex]=useState<YSite[]>([]),[site,setSite]=useState(""),[report,setReport]=useState<SearchReport|null>(null),[history,setHistory]=useState<History[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{void Promise.all([invoke<Property[]>("list_cached_sites"),invoke<{sites:BSite[]}>("get_bing_status"),invoke<{sites:YSite[]}>("get_yandex_status"),invoke<History[]>("get_public_audit_history")]).then(([g,b,y,h])=>{setGoogle(g.filter(x=>x.permission!=="siteUnverifiedUser"));setBing(b.sites);setYandex(y.sites);setHistory(h)}).catch(e=>setError(String(e)))},[]);
 const sites=engine==="Google"?google.map(p=>p.site_url):engine==="Bing"?bing.filter(s=>s.verified&&s.lastSync).map(s=>s.siteUrl):yandex.filter(s=>s.verified&&s.lastSync).map(s=>s.siteUrl);
 useEffect(()=>{setSite(sites[0]||"");setReport(null)},[engine,google.length,bing.length,yandex.length]);
 useEffect(()=>{if(!site)return;let active=true;setBusy(true);setError("");
 (engine==="Google"?invoke<any>("get_site_report",{siteUrl:site}):engine==="Bing"?invoke<any>("get_bing_report",{siteUrl:site}):invoke<any>("get_yandex_report",{siteUrl:site})).then(x=>{
 if(!active)return;if(!x){setReport(null);setError("No real Search Console snapshot available");return}
 const result=normalizeSearchReport(engine,site,x);if(!result.daily.length){setReport(null);setError("No complete daily clicks/impressions returned for this Yandex report period");return}setReport(result);
 }).catch(e=>{if(active)setError(String(e))}).finally(()=>{if(active)setBusy(false)});return()=>{active=false}},[site,engine]);
 const download=async()=>{if(!report)return;setBusy(true);setError("");try{await generatePDF(report,history)}catch(e){setError(String(e))}finally{setBusy(false)}};
 return <div className="maestro-module">
 <section className="card mod-intro"><div><span className="mod-overline">ADVERTPRENEUR · CLIENT READY REPORTING</span><h2>Generate evidence-backed search reports</h2><p>Branded PDF executive summaries and CSV exports from synchronized Google/Bing metrics, with source periods and caveats clearly disclosed.</p></div><FileChartColumn size={29}/></section>
 <section className="card mod-form"><header><div><h3>Report configuration</h3><p>Select a verified property, review its source dates, then export. No fictional traffic numbers or outside API fees.</p></div></header><div className="mod-toolbar"><label className="mod-field">Search engine<select value={engine} onChange={e=>setEngine(e.target.value as typeof engine)}><option value="Google">Google Search Console</option><option value="Bing">Bing Webmaster</option><option value="Yandex">Yandex Webmaster</option></select></label><label className="mod-field">Verified website<select value={site} onChange={e=>setSite(e.target.value)}>{sites.map(s=><option key={s} value={s}>{s}</option>)}</select></label></div>{error&&<p className="mod-error">{error}</p>}</section>
 {report?<><div className="mod-metric-grid">{[{label:"Total clicks",value:integer(report.totalClicks)},{label:"Total impressions",value:integer(report.totalImpressions)},{label:"CTR",value:report.ctr.toFixed(2)+"%"},{label:"Reporting period",value:report.period}].map(x=><section className="card mod-metric" key={x.label}><span>{x.label}</span><strong>{x.value}</strong></section>)}</div>
 <section className="card mod-chart"><header><div><h3>Included in your report</h3><p>{report.engine} · last synchronized {new Date(report.fetchedAt).toLocaleString()}</p></div></header><div className="mod-report-sections">{[{icon:<BarChart3 size={20}/>,title:"Executive snapshot",sub:"Clicks, impressions, CTR and history"},{icon:<FileChartColumn size={20}/>,title:"Top queries and pages",sub:"Rankings where available; no fake positions"},{icon:<Database size={20}/>,title:"Technical evidence",sub:"Matching saved public crawl summaries"}].map(x=><div key={x.title}>{x.icon}<strong>{x.title}</strong><small>{x.sub}</small></div>)}</div><p className="mod-info">{report.sourceNote}. {report.limited?"Some query/page data was limited by the source API.":""}</p></section>
 <section className="card mod-form"><header><div><h3>Download report</h3><p>PDF contains source/date details and action-oriented findings; CSV outputs contain exact query or landing-page rows.</p></div></header><div className="mod-toolbar"><button onClick={()=>void download()} disabled={busy}><FileDown size={16}/>{busy?"Preparing…":"Download branded PDF"}</button><button onClick={()=>saveCSV(report.pages,"maestro-"+engine.toLowerCase()+"-pages.csv")}><Download size={16}/> Page CSV</button><button onClick={()=>saveCSV(report.queries,"maestro-"+engine.toLowerCase()+"-queries.csv")}><Download size={16}/> Query CSV</button></div></section></>:<section className="card mod-empty"><h3>{busy?"Loading source data…":"No report source selected"}</h3><p>Choose a verified and synchronized website above.</p></section>}
 <div className="mod-provenance"><ShieldCheck size={16}/> Reports are local, source-attributed exports. Google and Bing periods cannot be combined into one ranking average. Google AI and Bing AI citation data are not silently mixed with organic search metrics.</div>
 </div>
}
