type Row={key:string;clicks:number;impressions:number;ctrPercent:number;position:number|null};
type Snapshot={daily:Row[];topQueries:Row[];topPages:Row[]};
type PublicPage={url:string;title:string;score:number;issues:{code:string;severity:string;message:string}[];images:number;imagesMissingAlt:number;description:string;canonical:string;h1Count:number;schemaCount:number;viewport:boolean};
type Public={pages:PublicPage[];summary:{issueCount:number}};
const SVG="http://www.w3.org/2000/svg";
const number=new Intl.NumberFormat("en-US",{maximumFractionDigits:0});
const compact=new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1});
const dec=new Intl.NumberFormat("en-US",{maximumFractionDigits:2});
const palette:{[k:string]:string}={clicks:"#227def",impressions:"#8766df",ctrPercent:"#069f92",position:"#dda144"};
function el<K extends keyof HTMLElementTagNameMap>(tag:K,className?:string,text?:string){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e}
function svg(tag:string,attrs:Record<string,string|number>){const e=document.createElementNS(SVG,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,String(v)));return e}
function fmt(value:number|null,key:string){if(value===null)return "—";return key==="ctrPercent"?dec.format(value)+"%":key==="position"?dec.format(value):number.format(value)}
function date(date:string){const d=new Date(date+"T12:00:00Z");return Number.isNaN(d.valueOf())?date:d.toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"})}
function addText(parent:Element,tag:string,text:string,cls?:string){const item=el(tag as "span",cls,text);parent.appendChild(item);return item}
function pctDelta(a:number,b:number){if(b===0)return a===0?"No change":"Baseline zero";return (a>=b?"+":"")+((a-b)/b*100).toFixed(1)+"%"}
export function drawVisual(report:Snapshot,metric:string,smooth:boolean){
 const data=[...report.daily].sort((a,b)=>a.key.localeCompare(b.key));
 const root=document.getElementById("trend") as unknown as SVGSVGElement;root.replaceChildren();
 if(!data.length)return;
 const dual=metric==="dual",key=dual?"impressions":metric;
 const xa=48,xb=733,ya=18,yb=204;
 const max=Math.max(1,...data.map(d=>Number(d[key as keyof Row])))*1.12;
 const maxClicks=Math.max(1,...data.map(d=>d.clicks))*1.12;
 const points=(k:string,maxValue:number,array:Row[]=data)=>array.map((d,i)=>({x:xa+(data.length===1?0:i/(data.length-1))*(xb-xa),y:yb-(Number(d[k as keyof Row]||0)/maxValue)*(yb-ya)}));
 const a=points(key,max),b=points("clicks",maxClicks);
 const path=(points:{x:number;y:number}[])=>points.map((p,i)=>(i?"L":"M")+p.x.toFixed(1)+","+p.y.toFixed(1)).join(" ");
 const col=palette[key];
 const defs=svg("defs",{}),grad=svg("linearGradient",{id:"gsc-v6-area",x1:0,y1:0,x2:0,y2:1});grad.append(svg("stop",{offset:0,"stop-color":col,"stop-opacity":.2}),svg("stop",{offset:1,"stop-color":col,"stop-opacity":0}));defs.appendChild(grad);root.appendChild(defs);
 for(let i=0;i<5;i++){const y=ya+(yb-ya)*i/4;root.appendChild(svg("line",{x1:xa,x2:xb,y1:y,y2:y,stroke:"currentColor","stroke-opacity":.09,"stroke-dasharray":"3 5"}));
 const left=svg("text",{x:xa-9,y:y+4,"text-anchor":"end",fill:"currentColor","fill-opacity":.5,"font-size":11});left.textContent=key==="ctrPercent"?dec.format(max*(1-i/4))+"%":key==="position"?dec.format(max*(1-i/4)):compact.format(max*(1-i/4));root.appendChild(left);
 if(dual){const right=svg("text",{x:xb+9,y:y+4,fill:palette.clicks,"font-size":11});right.textContent=compact.format(maxClicks*(1-i/4));root.appendChild(right)}}
 root.appendChild(svg("path",{d:path(a)+` L${xb},${yb} L${xa},${yb} Z`,fill:"url(#gsc-v6-area)"}));
 root.appendChild(svg("path",{d:path(a),fill:"none",stroke:col,"stroke-width":3,"stroke-linejoin":"round","stroke-linecap":"round"}));
 if(dual)root.appendChild(svg("path",{d:path(b),fill:"none",stroke:palette.clicks,"stroke-width":2.6,"stroke-linejoin":"round","stroke-linecap":"round"}));
 if(smooth&&!dual&&data.length>=3){const smoothed=data.map((d,i)=>({...d,[key]:data.slice(Math.max(0,i-6),i+1).reduce((sum,row)=>sum+Number(row[key as keyof Row]),0)/(Math.min(7,i+1))}));root.appendChild(svg("path",{d:path(points(key,max,smoothed)),fill:"none",stroke:"#0cb8a8","stroke-width":2.2,"stroke-dasharray":"6 5"}))}
 for(const [j,i] of [0,Math.floor((data.length-1)/4),Math.floor((data.length-1)/2),Math.floor((data.length-1)*.75),data.length-1].entries()){const t=svg("text",{x:a[i].x,y:236,fill:"currentColor","fill-opacity":.55,"text-anchor":j===0?"start":j===4?"end":"middle","font-size":11});t.textContent=date(data[i].key);root.appendChild(t)}
 const focus=svg("line",{x1:0,x2:0,y1:ya,y2:yb,stroke:"#506b8a","stroke-dasharray":"5 5","stroke-opacity":.8});focus.style.display="none";root.appendChild(focus);
 const marker=svg("circle",{r:5,fill:col,stroke:"white","stroke-width":2.5});marker.style.display="none";root.appendChild(marker);
 const tooltip=document.getElementById("hover-card")!;root.onmousemove=evt=>{
  const bounds=root.getBoundingClientRect(),x=(evt.clientX-bounds.left)/bounds.width*780,i=Math.max(0,Math.min(data.length-1,Math.round((x-xa)/(xb-xa)*(data.length-1)))),p=a[i],d=data[i];
  if(x<xa-10||x>xb+10){tooltip.hidden=true;focus.style.display="none";marker.style.display="none";return}
  tooltip.replaceChildren();addText(tooltip,"strong",date(d.key));for(const [label,value,k] of [["Clicks",d.clicks,"clicks"],["Impressions",d.impressions,"impressions"],["CTR",d.ctrPercent,"ctrPercent"],["Position",d.position,"position"]] as const){const line=el("div","hover-line");addText(line,"span",label);addText(line,"b",fmt(value,k));tooltip.appendChild(line)}
  tooltip.hidden=false;focus.style.display="";marker.style.display="";focus.setAttribute("x1",String(p.x));focus.setAttribute("x2",String(p.x));marker.setAttribute("cx",String(p.x));marker.setAttribute("cy",String(p.y));
 };root.onmouseleave=()=>{tooltip.hidden=true;focus.style.display="none";marker.style.display="none"};
 const legend=document.getElementById("chart-legend")!;legend.replaceChildren();
 const addLegend=(label:string,c:string)=>{const tag=el("span","legend-entry"),dot=el("i");dot.style.background=c;tag.append(dot,document.createTextNode(label));legend.appendChild(tag)};
 addLegend(dual?"Impressions":key==="ctrPercent"?"CTR":key==="position"?"Average position":key,palette[key]);if(dual)addLegend("Clicks · right axis",palette.clicks);
 if(smooth&&!dual)addLegend("7-day running mean","#0cb8a8");
 const first=data.slice(0,Math.floor(data.length/2)),last=data.slice(Math.floor(data.length/2));
 const totals=(arr:Row[])=>({clicks:arr.reduce((s,d)=>s+d.clicks,0),impressions:arr.reduce((s,d)=>s+d.impressions,0)});
 const early=totals(first),later=totals(last),peak=data.reduce((a,d)=>d.impressions>a.impressions?d:a,data[0]);
 const cards=[["Impression movement",pctDelta(later.impressions,early.impressions),number.format(early.impressions)+" → "+number.format(later.impressions)+" · equal halves"],["Click movement",pctDelta(later.clicks,early.clicks),number.format(early.clicks)+" → "+number.format(later.clicks)+" · equal halves"],["Peak visibility day",date(peak.key),number.format(peak.impressions)+" impressions"],["Last 7 days",number.format(totals(data.slice(-7)).impressions)+" impressions",number.format(totals(data.slice(-7)).clicks)+" clicks"]];
 const summary=document.getElementById("comparison-summary")!;summary.replaceChildren();for(const [title,value,detail] of cards){const card=el("div","comparison-item");addText(card,"span",title);addText(card,"strong",value);addText(card,"small",detail);summary.appendChild(card)}
 const footer=document.getElementById("chart-summary")!;footer.textContent="Hover for daily detail · "+data.length+" days · "+(dual?"dual axis · clicks and impressions each use a separate scale":"single metric · "+(smooth?"running average shown":"raw daily values"));
 renderDistribution(report);
}
function renderDistribution(report:Snapshot){
 const target=document.getElementById("ranking-heatmap")!;target.replaceChildren();
 const queries=report.topQueries||[],pages=report.topPages||[];
 const buckets=[["Top 3",1,3,"#1ba891"],["4–10",3,10,"#258bf0"],["11–20",10,20,"#9170dd"],["21–50",20,50,"#efa750"],["51+",50,9999,"#9baabc"]] as const;
 const left=el("div","distribution-panel");addText(left,"h3","Ranking position · returned queries");const row=el("div","distribution-bars");
 for(const [label,lo,hi,color] of buckets){const count=queries.filter(d=>d.position!==null&&d.position>lo-(lo===1?1:0)&&d.position<=hi).length;const slot=el("div","distribution-bar");addText(slot,"span",label);const track=el("div","distribution-track"),fill=el("i");fill.style.background=color;fill.style.width=Math.round(100*count/Math.max(1,queries.length))+"%";track.appendChild(fill);slot.append(track);addText(slot,"strong",String(count));row.append(slot)}left.appendChild(row);addText(left,"small","Based on "+queries.length+" returned query rows (potentially longer history than daily Bing KPIs); excluded/anonymized queries are not counted.");
 const right=el("div","distribution-panel");addText(right,"h3","Most visible landing pages · returned rows");const sum=pages.reduce((s,p)=>s+p.impressions,0);
 for(const p of pages.slice(0,5)){const item=el("div","visibility-item");const head=el("div","visibility-item-head");let label=p.key;try{label=new URL(p.key).pathname||"/"}catch{}addText(head,"span",label);addText(head,"strong",number.format(p.impressions));const track=el("div","distribution-track"),fill=el("i");fill.style.background="#32a8d8";fill.style.width=Math.min(100,100*p.impressions/(sum||1))+"%";track.appendChild(fill);item.append(head,track);right.appendChild(item)}
 addText(right,"small","Share is relative to retrieved page rows, not necessarily all GSC impressions.");
 target.append(left,right);
}
export function renderPublicVisuals(report:Public){
 const root=document.getElementById("public-insights")!;root.replaceChildren();
 const left=el("div","public-issue-trends"),right=el("div","public-page-health");
 addText(left,"h3","Issue recurrence");addText(right,"h3","Page-score distribution");
 const map=new Map<string,{count:number;affected:Set<string>;severity:string}>();
 for(const page of report.pages)for(const i of page.issues){const x=map.get(i.code)||{count:0,affected:new Set<string>(),severity:i.severity};x.count++;x.affected.add(page.url);map.set(i.code,x)}
 const list=[...map].map(([code,x])=>({code,...x,affected:x.affected.size})).sort((a,b)=>b.affected-a.affected).slice(0,7);
 const max=Math.max(1,...list.map(i=>i.affected));
 for(const i of list){const block=el("div","public-issue-line");const head=el("div","public-item-head");addText(head,"span",i.code.replaceAll("_"," "));addText(head,"b",i.affected+"/"+report.pages.length+" pages");const bar=el("div","distribution-track"),fill=el("i");fill.style.width=100*i.affected/max+"%";fill.style.background=i.severity==="info"?"#b1bfd0":i.severity==="medium"?"#8a76da":"#e7a651";bar.appendChild(fill);block.append(head,bar);left.appendChild(block)}
 for(const p of report.pages){const block=el("div","public-page-line"),head=el("div","public-item-head");let label=p.url;try{label=new URL(p.url).pathname||"/"}catch{}addText(head,"span",label);addText(head,"b",p.score+"/100");const track=el("div","distribution-track"),fill=el("i");fill.style.width=Math.max(1,p.score)+"%";fill.style.background=p.score>=85?"#12b39b":p.score>=70?"#378deb":"#e5a14b";track.appendChild(fill);block.append(head,track);right.appendChild(block)}
 root.append(left,right);
}
