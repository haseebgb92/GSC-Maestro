import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getContentResearch} from '../mcp/content-research.mjs';
const allowed=['sc-domain:coocoobabys.com','sc-domain:advertpreneur.com'];

test('only verified properties and explicit channels can access saved research',()=>{
 const d=mkdtempSync(join(tmpdir(),'maestro-evidence-'));
 const old=process.env.TYRION_CONTENT_RESEARCH_DIR;
 process.env.TYRION_CONTENT_RESEARCH_DIR=d;
 try{
  writeFileSync(join(d,'coocoobabys.json'),JSON.stringify({version:1,track:'coocoobabys',generatedAt:'2026-10-26T10:00:00Z',name:'CooCoo',topic:'monitor',searchConsole:{source:'GSC',queries:[{keyword:'baby monitor no wifi',impressions:180}],pages:[{url:'https://coocoobabys.com/blog/best-non-wifi-baby-monitors/',impressions:1136}]},recentDiscussions:{available:true,source:'Last30Days',evidence:'2026 discussion'},keywordSeeds:['monitor'],keywordPlanner:{status:'awaiting_e92_keyword_explorer'},editorialOpportunities:[{title:'Check non-Wi-Fi monitors',recommendedAction:'refresh_existing_page'}]}));
  const x=getContentResearch({siteUrl:allowed[0]},allowed);
  assert.equal(x.gscQueries[0].impressions,180);
  assert.equal(x.keywordPlanner.status,'awaiting_e92_keyword_explorer');
  assert.equal(x.gscPages[0].impressions,1136);
  assert.equal(x.editorialOpportunities[0].recommendedAction,'refresh_existing_page');
  assert.equal(x.recentDiscussions.available,true);
  assert.throws(()=>getContentResearch({siteUrl:'sc-domain:unapproved.com'},allowed),/verified/);
  assert.throws(()=>getContentResearch({siteUrl:allowed[0],channel:'linkedin'},allowed),/configured/);
  assert.throws(()=>getContentResearch({siteUrl:allowed[0]},[]),/verified/);
 } finally {
   if(old===undefined)delete process.env.TYRION_CONTENT_RESEARCH_DIR;
   else process.env.TYRION_CONTENT_RESEARCH_DIR=old;
   rmSync(d,{recursive:true,force:true});
 }
});
