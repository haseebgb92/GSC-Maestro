import {useMemo,useState,type MouseEvent} from "react";
import {Activity,BarChart3,Eye,MousePointer2,TrendingUp,Info} from "lucide-react";
type Daily={key:string;clicks:number;impressions:number;ctr:number;position:number};
type Mode="dual"|"clicks"|"impressions"|"ctr"|"position";
const color:{[k:string]:string}={clicks:"#1d78ef",impressions:"#8a67e8",ctr:"#059e92",position:"#df9f37"};
const n=new Intl.NumberFormat("en-US",{maximumFractionDigits:0});
const dec=new Intl.NumberFormat("en-US",{maximumFractionDigits:2});
const abbr=new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1});
const normalize=(v:Daily,field:Mode)=>field==="ctr"?v.ctr:field==="dual"?v.impressions:v[field];
const pts=(data:Daily[],key:"impressions"|"clicks"|"ctr"|"position",max:number,min:number,xa:number,xb:number,ya:number,yb:number)=>{
 const count=data.length;
 return data.map((v,i)=>({x:xa+(count===1?0:i/(count-1))*(xb-xa),y:yb-(v[key]-min)/(max-min||1)*(yb-ya),value:v[key]}));
};
const line=(data:{x:number;y:number}[])=>data.map((p,i)=>`${i?"L":"M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
function compactDelta(current:number,previous:number){
 if(previous===0)return current===0?"No change":"Previously zero";
 const diff=(current-previous)/previous*100;
 return `${diff>0?"+":""}${diff.toFixed(1)}% vs first half`;
}
export function RichPerformanceChart({daily,source="gsc"}:{daily:Daily[];source?:"gsc"|"demo"}){
 const [mode,setMode]=useState<Mode>("dual"),[hover,setHover]=useState<number|null>(null),[smooth,setSmooth]=useState(true);
 const sorted=useMemo(()=>[...daily].sort((a,b)=>a.key.localeCompare(b.key)),[daily]);
 const dailyMetrics=useMemo(()=>sorted.map(x=>({...x,ctr:x.impressions?100*x.clicks/x.impressions:0})),[sorted]);
 if(!dailyMetrics.length)return null;
 const halfway=Math.floor(dailyMetrics.length/2);
 const halves=[dailyMetrics.slice(0,halfway),dailyMetrics.slice(halfway)];
 const stats=(arr:Daily[])=>({clicks:arr.reduce((s,x)=>s+x.clicks,0),impressions:arr.reduce((s,x)=>s+x.impressions,0),ctr:arr.reduce((s,x)=>s+x.impressions,0)?arr.reduce((s,x)=>s+x.clicks,0)/arr.reduce((s,x)=>s+x.impressions,0)*100:0,
 position:arr.reduce((s,x)=>s+x.position*x.impressions,0)/(arr.reduce((s,x)=>s+x.impressions,0)||1)});
 const early=stats(halves[0]),late=stats(halves[1]);
 const maxImps=Math.max(1,...dailyMetrics.map(x=>x.impressions))*1.12;
 const maxClicks=Math.max(1,...dailyMetrics.map(x=>x.clicks))*1.2;
 const metric=mode==="dual"?"impressions":mode;
 const values=dailyMetrics.map(d=>normalize(d,metric));
 const maxVal=Math.max(1,...values)*1.12;
 const minVal=mode==="position"?Math.max(0,Math.min(...values)*0.8):0;
 const X0=54,X1=846,Y0=23,Y1=239;
 const primary=pts(dailyMetrics,metric,maxVal,minVal,X0,X1,Y0,Y1);
 const imps=pts(dailyMetrics,"impressions",maxImps,0,X0,X1,Y0,Y1);
 const clicks=pts(dailyMetrics,"clicks",maxClicks,0,X0,X1,Y0,Y1);
 const rolling=smooth&&dailyMetrics.length>=3?dailyMetrics.map((d,i)=>({key:d.key,clicks:dailyMetrics.slice(Math.max(0,i-6),i+1).reduce((s,x)=>s+x.clicks,0)/(Math.min(7,i+1)),impressions:dailyMetrics.slice(Math.max(0,i-6),i+1).reduce((s,x)=>s+x.impressions,0)/(Math.min(7,i+1)),ctr:dailyMetrics.slice(Math.max(0,i-6),i+1).reduce((s,x)=>s+x.ctr,0)/(Math.min(7,i+1)),position:dailyMetrics.slice(Math.max(0,i-6),i+1).reduce((s,x)=>s+x.position,0)/(Math.min(7,i+1))})):null;
 const trend=rolling?pts(rolling,metric,mode==="dual"?maxImps:maxVal,minVal,X0,X1,Y0,Y1):null;
 const peak=dailyMetrics.reduce((best,d)=>d.impressions>best.impressions?d:best,dailyMetrics[0]);
 const latest=dailyMetrics[dailyMetrics.length-1];
 const f=(v:number,key:string)=>key==="position"||key==="ctr"?dec.format(v)+(key==="ctr"?"%":""):n.format(v);
 const xpos=(i:number)=>X0+(dailyMetrics.length===1?0:i/(dailyMetrics.length-1))*(X1-X0);
 const tickDate=(date:string)=>{const d=new Date(date+"T12:00:00Z");return Number.isNaN(d.getTime())?date:d.toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"})};
 const trendMain=mode==="dual"?imps:primary;
 return <div className="rich-performance">
   <div className="rich-head"><div><span className="rich-eyebrow"><Activity size={14}/> INTERACTIVE SEARCH INTELLIGENCE</span><h3>Search performance over time</h3><p>{source==="gsc"?"Settled Google Search Console daily data":"Illustrative sample data"} · {dailyMetrics.length} days</p></div><div className="rich-metric-pills">{([["dual","Clicks + impressions"],["clicks","Clicks"],["impressions","Impressions"],["ctr","CTR"],["position","Position"]] as const).map(([key,label])=><button key={key} type="button" aria-pressed={mode===key} className={mode===key?"chosen":""} onClick={()=>{setMode(key);setHover(null)}}>{label}</button>)}</div></div>
   <div className="rich-legend"><span><i style={{background:color[metric]}}/> {mode==="dual"?"Impressions":metric==="ctr"?"Click-through rate":metric==="position"?"Average position":metric}</span>{mode==="dual"&&<span><i style={{background:color.clicks}}/> Clicks (right axis)</span>}{smooth&&dailyMetrics.length>=3&&mode!=="dual"&&<span><i className="dash" style={{borderColor:"#05ac9e"}}/> 7-day average</span>}<label><input type="checkbox" checked={smooth} onChange={e=>setSmooth(e.target.checked)}/> Show 7-day mean</label></div>
   <div className="rich-graph"><svg viewBox="0 0 900 290" role="img" aria-label={`Daily ${mode} chart, from ${dailyMetrics[0].key} to ${latest.key}`} onMouseLeave={()=>setHover(null)} onMouseMove={(event:MouseEvent<SVGSVGElement>)=>{const box=event.currentTarget.getBoundingClientRect();const x=(event.clientX-box.left)/box.width*900;const i=Math.round((x-X0)/(X1-X0)*(dailyMetrics.length-1));setHover(Math.max(0,Math.min(dailyMetrics.length-1,i)))}}>
    <defs><linearGradient id="rich-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color[metric]} stopOpacity=".22"/><stop offset="1" stopColor={color[metric]} stopOpacity=".005"/></linearGradient></defs>
    {[0,1,2,3,4].map(i=>{const y=Y0+i*(Y1-Y0)/4;const v=(mode==="dual"?maxImps:maxVal)-(mode==="dual"?maxImps:(maxVal-minVal))*i/4;return <g key={i}><line x1={X0} x2={X1} y1={y} y2={y} stroke="#dce5ef" strokeDasharray="4 5"/><text x={X0-11} y={y+4} textAnchor="end" fill="#8595a9" fontSize="11">{mode==="ctr"?dec.format(v)+"%":mode==="position"?dec.format(v):abbr.format(v)}</text>{mode==="dual"&&<text x={X1+12} y={y+4} fill="#3481d6" fontSize="11">{abbr.format(maxClicks-maxClicks*i/4)}</text>}</g>})}
    <path d={line(trendMain)+` L ${X1},${Y1} L ${X0},${Y1} Z`} fill="url(#rich-gradient)"/>
    <path d={line(trendMain)} fill="none" stroke={color[metric]} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"/>
    {mode==="dual"&&<path d={line(clicks)} fill="none" stroke={color.clicks} strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/>}
    {trend&&mode!=="dual"&&<path d={line(trend)} fill="none" stroke="#05ac9e" strokeWidth="2.5" strokeDasharray="6 5" strokeLinecap="round"/>}
    {hover!==null&&<g><line x1={xpos(hover)} x2={xpos(hover)} y1={Y0} y2={Y1} stroke="#3b6f9c" strokeWidth="1.2" strokeDasharray="5 5" /><circle cx={xpos(hover)} cy={trendMain[hover].y} r="6" fill={color[metric]} stroke="white" strokeWidth="3" />{mode==="dual"&&<circle cx={xpos(hover)} cy={clicks[hover].y} r="5" fill={color.clicks} stroke="white" strokeWidth="2"/>}</g>}
    {[0,Math.floor((dailyMetrics.length-1)/4),Math.floor((dailyMetrics.length-1)/2),Math.floor((dailyMetrics.length-1)*.75),dailyMetrics.length-1].map((i,k)=><text key={k} x={xpos(i)} y={267} textAnchor={k===0?"start":k===4?"end":"middle"} fill="#8093aa" fontSize="11">{tickDate(dailyMetrics[i].key)}</text>)}
   </svg>
   {hover!==null&&<div className="rich-tooltip"><strong>{tickDate(dailyMetrics[hover].key)}</strong><span><i style={{background:color.clicks}}/> Clicks <b>{n.format(dailyMetrics[hover].clicks)}</b></span><span><i style={{background:color.impressions}}/> Impressions <b>{n.format(dailyMetrics[hover].impressions)}</b></span><span>CTR <b>{f(dailyMetrics[hover].ctr,"ctr")}</b></span><span>Position <b>{f(dailyMetrics[hover].position,"position")}</b></span></div>}
   </div>
   <div className="rich-chart-footer"><span><MousePointer2 size={13}/> Hover the chart to inspect each date</span><span>Source: {source==="gsc"?"Google Search Console":"Demo series"} · Values are not estimated</span></div>
   <div className="rich-analysis-grid">
    <div><span><Eye size={14}/> Visibility trend</span><strong>{compactDelta(late.impressions,early.impressions)}</strong><small>{n.format(early.impressions)} → {n.format(late.impressions)} impressions · equal halves</small></div>
    <div><span><TrendingUp size={14}/> Click trend</span><strong>{compactDelta(late.clicks,early.clicks)}</strong><small>{n.format(early.clicks)} → {n.format(late.clicks)} clicks · equal halves</small></div>
    <div><span><BarChart3 size={14}/> Highest visibility day</span><strong>{tickDate(peak.key)}</strong><small>{n.format(peak.impressions)} impressions · {n.format(peak.clicks)} clicks</small></div>
    <div><span><Info size={14}/> Recent 7 days</span><strong>{n.format(dailyMetrics.slice(-7).reduce((s,v)=>s+v.impressions,0))} impressions</strong><small>{n.format(dailyMetrics.slice(-7).reduce((s,v)=>s+v.clicks,0))} clicks · last {Math.min(7,dailyMetrics.length)} days</small></div>
   </div>
   </div>;
}
