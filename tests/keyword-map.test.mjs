import test from 'node:test';
import assert from 'node:assert/strict';
import {buildKeywordMap} from '../mcp/keyword-map.mjs';
const base={siteUrl:'sc-domain:coocoobabys.com',startDate:'2026-09-26',endDate:'2026-10-23',
 queries:[
  {key:'best baby monitor without wifi',impressions:180,clicks:0,position:10.24,ctrPercent:0},
  {key:'best baby monitor no wifi',impressions:111,clicks:0,position:9.37,ctrPercent:0},
  {key:'non wifi baby monitor',impressions:128,clicks:0,position:27.25,ctrPercent:0},
  {key:'stroller for travel',impressions:53,clicks:0,position:24.36,ctrPercent:0},
 ],pages:[
  {key:'https://coocoobabys.com/blog/best-non-wifi-baby-monitors/',impressions:1136,clicks:1,position:18.08},
  {key:'https://coocoobabys.com/blog/best-baby-monitors-for-new-parents/',impressions:68,clicks:0,position:10.3},
  {key:'https://evil.test/best-non-wifi-baby-monitors/',impressions:10000,clicks:100,position:1}
 ]};
test('closely related non-wifi queries map to one provisional same-property existing article',()=>{
 const out=buildKeywordMap(base);assert.equal(out.clusters.length,1);
 const [c]=out.clusters;
 assert.equal(c.cluster,'baby monitor nowifi');
 assert.equal(c.queryVariants.length,2);
 assert.equal(c.impressionsSum,291);
 assert.equal(c.priority,'high');
 assert.equal(c.recommendedAction,'review_existing_page');
 assert.equal(c.existingPageCandidates[0].url,'https://coocoobabys.com/blog/best-non-wifi-baby-monitors/');
 assert.ok(c.existingPageCandidates.every(x=>x.url.startsWith('https://coocoobabys.com/')));
 assert.equal(out.limits.noQueryPageDimension,true);
 assert.equal(out.limits.impressionSumsNotUniqueSearchUsers,true);
});
test('no query-to-page attribution or fake cannibalization is inferred',()=>{
 const out=buildKeywordMap({...base,pages:[base.pages[1]]});
 assert.equal(out.clusters[0].recommendedAction,'review_existing_page');
 assert.match(out.clusters[0].existingPageCandidates[0].matchBasis,/not Google query\/page attribution/);
 assert.equal(out.clusters[0].potentialOverlap,'none_identified');
});
test('missing candidate pages explicitly ask to inspect existing content',()=>{
 const out=buildKeywordMap({...base,pages:[]});
 assert.equal(out.clusters[0].recommendedAction,'inspect_existing_content_before_new_page');
 assert.equal(out.clusters[0].existingPageCandidates.length,0);
});
test('invalid filters, malicious URLs, irrelevant or low-impression queries do not pass',()=>{
 assert.throws(()=>buildKeywordMap({...base,minImpressions:-1}),/minImpressions/);
 assert.throws(()=>buildKeywordMap({...base,limit:500}),/limit/);
 const out=buildKeywordMap({...base,minImpressions:180, pages:[{key:'https://coocoobabys.com@evil.test/x',impressions:20}]});
 assert.equal(out.clusters[0].queryVariants.length,1);
 assert.equal(out.clusters[0].existingPageCandidates.length,0);
});
