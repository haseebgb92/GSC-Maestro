import {useMemo,useState} from "react";
import type {PublicAudit} from "./Audit";
import {Activity,BarChart3,CheckCircle2,ChevronDown,Layers,AlertCircle} from "lucide-react";
const names:Record<string,string>={missing_description:"Meta descriptions",alt_text:"Image alt attributes",title_length:"Title length",missing_canonical:"Canonical links",missing_h1:"Missing headings",multiple_h1:"Multiple H1s",noindex:"Noindex directive",missing_title:"Missing titles",missing_viewport:"Viewport settings",limited_text:"Low visible word count",duplicate_title:"Duplicated page titles",http_error:"HTTP response errors",no_open_graph:"Open Graph metadata",no_structured_data:"JSON-LD structured data"};
const metricFields=[
 {key:"title",label:"Title",test:(p:PublicAudit["pages"][number])=>Boolean(p.title)},
 {key:"description",label:"Meta",test:(p:PublicAudit["pages"][number])=>Boolean(p.description)},
 {key:"canonical",label:"Canonical",test:(p:PublicAudit["pages"][number])=>Boolean(p.canonical)},
 {key:"h1",label:"H1",test:(p:PublicAudit["pages"][number])=>p.h1Count===1},
 {key:"alt",label:"Alt text",test:(p:PublicAudit["pages"][number])=>p.images===0||p.imagesMissingAlt===0},
 {key:"schema",label:"JSON-LD",test:(p:PublicAudit["pages"][number])=>p.schemaCount>0},
 {key:"viewport",label:"Mobile",test:(p:PublicAudit["pages"][number])=>p.viewport}
];
export function AuditVisuals({report}:{report:PublicAudit}){
 const [selected,setSelected]=useState<string|null>(null);
 const issues=useMemo(()=>{
  const counts=new Map<string,{count:number;pages:Set<string>;severity:string}>();
  for(const p of report.pages)for(const issue of p.issues){
   const info=counts.get(issue.code)||{count:0,pages:new Set<string>(),severity:issue.severity};info.count++;info.pages.add(p.url);counts.set(issue.code,info);
  }
  return [...counts].map(([code,x])=>({code,label:names[code]||code.replaceAll("_"," "),...x,affected:x.pages.size})).sort((a,b)=>b.affected-a.affected||b.count-a.count);
 },[report]);
 const maximum=Math.max(1,...issues.map(i=>i.affected));
 const scoreRange=report.pages.map(p=>p.score);
 const min=Math.min(...scoreRange),max=Math.max(...scoreRange);
 const avg=Math.round(scoreRange.reduce((s,n)=>s+n,0)/Math.max(1,scoreRange.length));
 const detail=selected?report.pages.find(p=>p.url===selected):null;
 return <section className="audit-data-insights" aria-label="Detailed on-page audit charts">
  <div className="audit-insights-head"><div><span>CRAWL INTELLIGENCE</span><h2>How healthy is each page?</h2><p>Visual breakdown of observed on-page SEO signals · {report.pages.length} audited pages</p></div><div className="audit-insight-badge"><Activity size={15}/> {report.summary.issueCount} scored issues</div></div>
  <div className="audit-insight-stats">
   <div><span>Average page score</span><strong>{avg}<small>/100</small></strong><p>Across {report.pages.length} sampled URLs</p></div>
   <div><span>Weakest page</span><strong>{min}<small>/100</small></strong><p>Lowest observed diagnostic result</p></div>
   <div><span>Strongest page</span><strong>{max}<small>/100</small></strong><p>Highest observed diagnostic result</p></div>
   <div><span>Image alt coverage</span><strong>{report.summary.totalImages?Math.round((report.summary.totalImages-report.summary.imagesMissingAlt)/report.summary.totalImages*100):100}<small>%</small></strong><p>{report.summary.totalImages-report.summary.imagesMissingAlt} / {report.summary.totalImages} image occurrences</p></div>
  </div>
  <div className="audit-insight-charts">
   <section className="card audit-issue-card"><header><h3>Most frequent issues</h3><p>Number of sampled pages affected · includes advisory notices</p></header><div className="audit-issue-bars">
    {issues.slice(0,8).map((issue,index)=><div className="audit-issue-bar" key={issue.code}><div className="audit-issue-name"><span className="audit-rank-number">{String(index+1).padStart(2,"0")}</span><span>{issue.label}</span><strong>{issue.affected}/{report.pages.length}</strong></div><div className="audit-issue-track"><span style={{width:100*issue.affected/maximum+"%",background:issue.severity==="critical"?"#d95155":issue.severity==="high"?"#e79445":issue.severity==="medium"?"#6676de":issue.severity==="info"?"#a9b8cc":"#12a99b"}}/></div></div>)}
    {!issues.length&&<div className="audit-issue-empty"><CheckCircle2 size={19}/> No flagged checklist issues on these pages</div>}
   </div></section>
   <section className="card audit-page-score-card"><header><h3>Page quality distribution</h3><p>Each dot represents one audited page · click to inspect</p></header><div className="audit-dotplot" aria-label="Page quality scores, out of 100">
    <div className="audit-score-guides"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
    <div className="audit-dot-area">
     <div className="audit-score-zones"><span/><span/><span/><span/></div>
     {report.pages.map((p,i)=><button type="button" aria-label={p.title+" score "+p.score} key={p.url} title={p.title+": "+p.score+"/100"} className={"audit-score-dot "+(selected===p.url?"selected":"")} onClick={()=>setSelected(selected===p.url?null:p.url)} style={{left:`calc(${p.score}% - 7px)`,top:(10+i*31)+"px",background:p.score>=85?"#13aa91":p.score>=70?"#3899da":"#e69d4f"}}><span>{p.score}</span></button>)}
    </div>
   </div><small className="audit-chart-help">{selected?"Page selected below":"Click a score dot to inspect its metadata"}</small></section>
  </div>
  <section className="card audit-coverage-card"><header><div><h3>On-page signal coverage</h3><p>Per-page checklist, observed in the returned HTML · green = present / passes this check</p></div><div className="audit-heatmap-key"><span className="pass"/> Good <span className="fail"/> Check</div></header>
  <div className="audit-coverage-scroll"><table><thead><tr><th>Audited URL</th>{metricFields.map(m=><th key={m.key}>{m.label}</th>)}<th>Score</th></tr></thead><tbody>{report.pages.map((p,i)=><tr key={p.url} onClick={()=>setSelected(selected===p.url?null:p.url)} className={selected===p.url?"selected":""}><td title={p.url}><span className="audit-row-index">{String(i+1).padStart(2,"0")}</span>{new URL(p.url).pathname||"/"}</td>{metricFields.map(m=><td key={m.key}><span className={"audit-signal "+(m.test(p)?"pass":"fail")} title={m.test(p)?m.label+": present":m.label+": check needed"}>{m.test(p)?"✓":"—"}</span></td>)}<td><strong>{p.score}</strong></td></tr>)}</tbody></table></div>
  {detail&&<div className="audit-selected-page"><div><strong>{detail.title||detail.url}</strong><small>{detail.url}</small></div><button onClick={()=>setSelected(null)} aria-label="Close page detail"><ChevronDown size={16}/></button><div className="audit-detail-meta"><span>{detail.words} visible words</span>{detail.contentAnalysis&&<span>{detail.contentAnalysis.words} main-content words (Scrapling)</span>}<span>{detail.internalLinks} internal links</span><span>{detail.externalLinks} external links</span><span>{detail.images} images</span><span>{detail.schemaCount} JSON-LD blocks</span></div>{detail.issues.length?<ul>{detail.issues.map((issue,i)=><li key={issue.code+i}><AlertCircle size={13}/><span>{issue.message}</span></li>)}</ul>:<p>No issue codes on this sampled page.</p>}</div>}
  </section>
  <p className="audit-chart-disclosure"><Layers size={14}/> These are on-page diagnostic checks, not search traffic, search rankings, or Google's own quality assessment. Repeated global images and menus may appear on multiple crawled pages.</p>
 </section>;
}
