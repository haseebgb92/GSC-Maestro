// GSC-only keyword/page hypothesis mapping, inspired by OpenSEO keyword clustering.
// No network calls, paid metrics, writes, or implied query+page join.
const STOP=new Set('best top good great nice cheap affordable price prices cost buy shopping review reviews 2026 2025 guide to for in on of the a an and or from with is are what how do does can you your my i we near'.split(' '));
const GENERIC=new Set(['blog','blogs','post','posts','pages','page','product','products','article','articles','category','categories','shop','website']);

function tokens(value){
 const canonical=String(value).toLowerCase().replace(/\b(?:non[- ]?wifi|no[- ]?wifi|without[- ]?wi[- ]?fi)\b/g,' nowifi ').replace(/\bwi[- ]?fi\b/g,' wifi ');
 return [...new Set(canonical.match(/[a-z0-9]{2,}/g)||[])].map(w=>{
  if(['monitors','strollers','carriers','warmers','humidifiers','bassinets','cameras'].includes(w))return w.slice(0,-1);
  return w;
 }).filter(w=>!STOP.has(w)&&!GENERIC.has(w));
}
function clusterKey(query){
 const list=tokens(query),qualifier=list.includes('nowifi')?'nowifi':'';
 const base=list.filter(w=>w!=='nowifi'&&w!=='wifi');
 if(!base.length)return null;
 const pair=base.slice(0,3).sort();
 return [...pair,...(qualifier?['nowifi']:[])].join(' ');
}
function safePage(raw,property){
 try{
  const u=new URL(String(raw));if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.hash)return null;
  if(property.startsWith('sc-domain:')){
   const dom=property.slice(10).toLowerCase();if(u.hostname!==dom&&!u.hostname.endsWith('.'+dom))return null;
  }else if(!u.href.startsWith(property))return null;
  return {url:u.href,tokens:tokens(decodeURIComponent(u.pathname).replace(/[\/_-]/g,' '))};
 }catch{return null}
}
function bestPageMatches(group, pages, property){
 const wanted=new Set(tokens(group));
 const matches=[];
 for(const page of pages){
  const parsed=safePage(page.key,property);if(!parsed)continue;
  const overlapping=parsed.tokens.filter(t=>wanted.has(t));
  const coverage=overlapping.length / wanted.size;
  if(coverage < (wanted.size===1?1:0.66))continue;
  matches.push({url:parsed.url,coverage:Number(coverage.toFixed(2)),pageImpressions:page.impressions,
   pageClicks:page.clicks,averagePosition:page.position,matchBasis:'URL path token overlap only (not Google query/page attribution)'});
 }
 matches.sort((a,b)=>b.coverage-a.coverage||b.pageImpressions-a.pageImpressions);
 return matches.slice(0,3);
}
/** Rank previously observed Google queries without inventing volume or SERP joins. */
export function buildKeywordMap({siteUrl,queries=[],pages=[],minImpressions=20,limit=20,
  startDate=null,endDate=null,syncedAt=null,queryRowsLimited=false,pageRowsLimited=false}={}){
 if(typeof siteUrl!=='string'||siteUrl.length<6)throw Error('Verified GSC property required');
 if(!Number.isInteger(minImpressions)||minImpressions<1||minImpressions>10000)throw Error('minImpressions must be 1–10,000');
 if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('limit must be 1–50');
 const groups=new Map();
 for(const r of queries.slice(0,2000)){
  if(!r||typeof r.key!=='string'||r.key.length>120||!Number.isFinite(r.impressions)||r.impressions<minImpressions||!Number.isFinite(r.position)||r.position<4||r.position>20)continue;
  const key=clusterKey(r.key);if(!key)continue;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(r);
 }
 const clusters=[...groups].map(([key,rows])=>{
  rows.sort((a,b)=>b.impressions-a.impressions);
  const impressions=rows.reduce((s,x)=>s+x.impressions,0),clicks=rows.reduce((s,x)=>s+(Number.isFinite(x.clicks)?x.clicks:0),0);
  const matches=bestPageMatches(key,pages,siteUrl);
  const close=rows.filter(x=>x.position>=4&&x.position<=15);
  return {cluster:key,primaryQuery:rows[0].key,
   queryVariants:rows.slice(0,12).map(x=>({query:x.key,impressions:x.impressions,clicks:x.clicks,ctrPercent:x.ctrPercent,position:x.position})),
   impressionsSum:impressions,clicksSum:clicks,weightedAveragePosition:Number((rows.reduce((s,x)=>s+x.impressions*x.position,0)/impressions).toFixed(2)),
   observedQueryCount:rows.length,existingPageCandidates:matches,
   recommendedAction:matches.length?'review_existing_page':'inspect_existing_content_before_new_page',
   potentialOverlap:matches.length>1?'multiple_similar_page_slugs_unverified':'none_identified',
   priority:close.length && impressions>=100 && clicks/impressions < .015?'high':'review',
   evidenceLevel:'first_party_GSC_query_rows_plus_unverified_URL_token_match'};
 }).sort((a,b)=>(a.priority==='high'?-1:1)-(b.priority==='high'?-1:1)||b.impressionsSum-a.impressionsSum).slice(0,limit);
 return {siteUrl,source:'GSC Maestro authorized local Google Search Console snapshot',startDate,endDate,syncedAt,
  method:'Group lexical close-variant Google queries at average position 4–20; suggest existing pages only from same-property URL slugs',
  filters:{minImpressions,positionMin:4,positionMax:20},clusters,
  limits:{queryRowsLimited:!!queryRowsLimited,pageRowsLimited:!!pageRowsLimited,anonymizedQueriesMissing:true,
   noQueryPageDimension:true,URLMatchingIsUnverified:true,
   impressionSumsNotUniqueSearchUsers:true,noGoogleAdsKeywordVolumes:true,
   potentialOverlapNotProvenCannibalization:true},
  nextStep:'Verify page-query attribution, SERP intent and existing content manually before changing or creating any URL.'};
}
