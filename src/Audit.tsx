import {useEffect,useMemo,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {Activity,AlertTriangle,ArrowRight,CheckCircle2,Download,ExternalLink,FileSearch,Globe2,Search,ShieldCheck} from "lucide-react";
import {AuditVisuals} from "./AuditVisuals";

export type AuditIssue={code:string;severity:"critical"|"high"|"medium"|"low"|"info";message:string;weight:number;url?:string};
export type AuditedPage={url:string;status:number;title:string;titleLength:number;description:string;descriptionLength:number;h1:string;h1Count:number;words:number;canonical:string;noindex:boolean;images:number;imagesMissingAlt:number;internalLinks:number;externalLinks:number;schemaCount:number;openGraph:boolean;viewport:boolean;htmlLang:string;hreflang:number;score:number;issues:AuditIssue[];contentAnalysis?:{root:string;words:number;paragraphs:number;headings:number}};
export type PublicAudit={mode:"public";source:string;url:string;domain:string;auditedAt:string;requestedPages:number;robots:{status:number;disallowedPathsHonored:boolean};summary:{score:number;pagesAudited:number;critical:number;high:number;medium:number;low:number;issueCount:number;missingTitles:number;missingDescriptions:number;nonIndexable:number;imagesMissingAlt:number;totalImages:number;withStructuredData:number;issues:AuditIssue[]};extraction?:{network:string;scraplingAvailable:boolean;scraplingPages:number};pages:AuditedPage[];failures:{url:string;error:string}[];limits:string[]};
type GscResult={mode:"gsc";siteUrl:string;report:unknown};
type History={id:number;domain:string;url:string;auditedAt:string;score:number;pages:number};
const severityOrder=["critical","high","medium","low","info"];
const formatDate=(date:string)=>{try{return new Date(date).toLocaleString()}catch{return date}};
function exportAudit(report:PublicAudit){
 const headings=["Page URL","Score","Status","Title","Words","H1 count","Missing image alt","Schema count","Issue count"];
 const esc=(v:unknown)=>`"${String(v).replaceAll('"','""')}"`;
 const rows=report.pages.map(page=>[page.url,page.score,page.status,page.title,page.words,page.h1Count,page.imagesMissingAlt,page.schemaCount,page.issues.filter(i=>i.severity!=="info").length]);
 const csv=[headings,...rows].map(row=>row.map(esc).join(",")).join("\r\n");
 const link=document.createElement("a"),blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
 link.href=URL.createObjectURL(blob);link.download=`maestro-public-audit-${report.domain}.csv`;link.click();
 setTimeout(()=>URL.revokeObjectURL(link.href),800);
}
export function SiteAudit({onConnected}:{onConnected:(siteUrl:string,report:unknown)=>void}){
 const [url,setUrl]=useState(""),[pageCount,setPageCount]=useState(8),[busy,setBusy]=useState(false),[error,setError]=useState(""),[result,setResult]=useState<PublicAudit|null>(null);
 const [history,setHistory]=useState<History[]>([]),[filter,setFilter]=useState("all");
 const [q,setQ]=useState("");
 useEffect(()=>{invoke<History[]>("get_public_audit_history").then(setHistory).catch(()=>{})},[]);
 const filtered=useMemo(()=>result?.pages.filter(p=>(filter==="all"||p.issues.some(x=>x.severity===filter))&&(p.url.toLowerCase().includes(q.toLowerCase())||p.title.toLowerCase().includes(q.toLowerCase())))||[],[result,filter,q]);
 const analyze=async(input=url)=>{
  if(!input.trim())return;
  setBusy(true);setError("");
  try{
   const output=await invoke<PublicAudit|GscResult>("analyze_website",{url:input,maxPages:pageCount});
   if(output.mode==="gsc"){onConnected(output.siteUrl,output.report);return;}
   setResult(output);setFilter("all");setQ("");
   const recent=await invoke<History[]>("get_public_audit_history");setHistory(recent);
  }catch(e){setError(String(e).replace(/^Error:\s*/,""))}finally{setBusy(false)}
 };
 return <div className="public-workspace">
  <section className="card audit-intro"><div className="audit-heading">
    <div className="audit-icon"><Globe2 size={23}/></div><div><h2>Analyze any website</h2><p>Verified properties use Google Search Console. Other domains get a respectful public crawl.</p></div>
    <span className="audit-pill"><ShieldCheck size={13}/> AUTOMATIC SOURCE</span>
   </div>
   <form className="audit-input-form" onSubmit={e=>{e.preventDefault();void analyze()}}>
    <div className="audit-url"><Globe2 size={18}/><input aria-label="Website to analyze" value={url} onChange={e=>setUrl(e.target.value)} placeholder="Enter a domain or website URL, e.g. example.com" autoComplete="off"/></div>
    <label className="audit-count-label">Crawl depth <select value={pageCount} onChange={e=>setPageCount(Number(e.target.value))} aria-label="Maximum public crawl pages">{[1,3,5,8,12].map(n=><option key={n} value={n}>{n} {n===1?"page":"pages"}</option>)}</select></label>
    <button type="submit" className="button button-primary" disabled={busy||!url.trim()}><Search size={16}/>{busy?"Analyzing…":"Analyze website"}</button>
   </form>
   <div className="audit-sources"><span><CheckCircle2 size={15}/> Connected &amp; verified → real GSC report</span><span><Globe2 size={15}/> Unconnected → public on-page audit only</span></div>
   {error&&<div className="audit-error" role="alert"><AlertTriangle size={16}/>{error}</div>}
   {busy&&<div className="audit-running" role="status"><Activity size={17}/> Fetching robots.txt, checking public HTML and internal links. Public audits may take several seconds.</div>}
  </section>
  {result&&<section className="audit-report">
   <div className="audit-report-header"><div><div className="audit-overline"><span className="audit-data-dot"/> PUBLIC CRAWL · NOT GOOGLE SEARCH CONSOLE</div><h2>{result.domain}</h2><p>{result.pages.length} public HTML pages inspected · {formatDate(result.auditedAt)}</p></div><button className="outline-button compact" onClick={()=>exportAudit(result)}><Download size={15}/> Export CSV</button></div>
   <div className="audit-summary-grid">
    <div className="card audit-grade"><span>ON-PAGE CHECK SCORE</span><strong>{result.summary.score}<small>/100</small></strong><div className="audit-score-progress"><span style={{width:result.summary.score+"%"}}/></div><p>Heuristic score for crawled pages only</p></div>
    {[
     {label:"Pages analyzed",value:result.summary.pagesAudited,sub:"Bounded public crawl"},
     {label:"Detected issues",value:result.summary.issueCount,sub:"Critical to low severity"},
     {label:"Missing alt text",value:result.summary.imagesMissingAlt,sub:result.summary.totalImages+" images sampled"},
     {label:"Schema present",value:result.summary.withStructuredData,sub:"Pages with JSON-LD"}
    ].map(k=><div className="card audit-stat" key={k.label}><span>{k.label}</span><strong>{k.value}</strong><p>{k.sub}</p></div>)}
   </div>
   <AuditVisuals report={result}/><section className="card audit-findings">
    <div className="card-header"><div><h2>Severity breakdown</h2><p>Observed on-page conditions, not estimates of search rankings</p></div></div>
    <div className="audit-severity-bars">{(["critical","high","medium","low"] as const).map(s=>{const count=result.summary[s];return <button key={s} onClick={()=>setFilter(filter===s?"all":s)} className={"audit-severity "+(filter===s?"chosen":"")}><strong>{s}</strong><span>{count}</span><div className={"severity-track severity-"+s}><i style={{width:Math.max(3,Math.min(100,count/(result.summary.issueCount||1)*100))+"%"}}/></div></button>})}</div>
   </section>
   <section className="card audit-table-card">
    <div className="card-header"><div><h2>Audited pages and findings</h2><p>URLs, indexability, metadata, headings and schema</p></div><div className="searchbox"><Search size={15}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search pages" aria-label="Filter audited pages"/></div></div>
    {filter!=="all"&&<button className="audit-clear" onClick={()=>setFilter("all")}>Showing {filter} issues · Clear filter</button>}
    <div className="audit-table-scroll"><table className="audit-pages"><thead><tr><th>Page</th><th>Score</th><th>Status</th><th>Words</th><th>H1</th><th>Schema</th><th>Issues</th></tr></thead><tbody>{filtered.map(p=><tr key={p.url}><td><strong title={p.url}>{p.title||"Untitled page"}</strong><a href={p.url} target="_blank" rel="noopener noreferrer">{new URL(p.url).pathname}<ExternalLink size={12}/></a></td><td><span className={"audit-score "+(p.score<60?"poor":p.score<80?"fair":"good")}>{p.score}</span></td><td>{p.status}</td><td>{p.words}</td><td>{p.h1Count}</td><td>{p.schemaCount?"Yes":"—"}</td><td>{p.issues.filter(i=>i.severity!=="info").length}</td></tr>)}</tbody></table></div>
    {!filtered.length&&<p className="audit-empty">No matching pages.</p>}
    {result.summary.issues.filter(i=>i.severity!=="info").slice(0,14).length>0&&<div className="audit-issue-detail"><h3>Priority findings</h3>{result.summary.issues.filter(i=>i.severity!=="info").sort((a,b)=>severityOrder.indexOf(a.severity)-severityOrder.indexOf(b.severity)).slice(0,14).map((i,n)=><div className="audit-issue" key={i.url+i.code+n}><span className={"audit-sev-pill "+i.severity}>{i.severity}</span><div><strong>{i.message}</strong><small>{i.url}</small></div></div>)}</div>}
   </section>
   <div className="audit-disclaimer"><ShieldCheck size={15}/><div>Public audit only. Score is a diagnostic checklist for sampled pages, not a Google ranking or traffic score. Google Search Console clicks, impressions, actual keywords and indexing status require property authorization. Robots rules are respected; private network targets are blocked. {result.failures.length?result.failures.length+" URLs were skipped due to network/format errors.":""}</div></div>
  </section>}
  {!result&&history.length>0&&<section className="card audit-history"><div className="card-header"><div><h2>Recent public audits</h2><p>Stored locally on this machine</p></div></div>{history.slice(0,8).map(h=><div className="audit-history-row" key={h.id}><span>{h.domain}</span><small>{h.pages} pages · score {h.score} · {formatDate(h.auditedAt)}</small><button onClick={()=>{setUrl(h.url);void analyze(h.url)}} disabled={busy}>Re-audit <ArrowRight size={13}/></button></div>)}</section>}
 </div>;
}
