import test from 'node:test';
import assert from 'node:assert/strict';
import {availableScrapling,extractMainContent} from '../mcp/scrapling.mjs';

const html='<html><header><p>Nav is excluded</p></header><body><main><h1>Services</h1><p>We build reliable ecommerce websites.</p><p>We analyze search results.</p></main></body></html>';
test('Scrapling performs bounded offline main-content extraction when installed',async()=>{
 if(!availableScrapling())return;
 const data=await extractMainContent(html);
 assert.equal(data.root,'main');
 assert.equal(data.words,10);
 assert.equal(data.paragraphs,2);
 assert.equal(data.headings,1);
});
test('Optional Scrapling enrichment is disabled without affecting existing crawler',async()=>{
 const prior=process.env.GSC_MAESTRO_SCRAPLING;
 try{process.env.GSC_MAESTRO_SCRAPLING='off';assert.equal(availableScrapling(),false);assert.equal(await extractMainContent(html),null)}
 finally{if(prior===undefined)delete process.env.GSC_MAESTRO_SCRAPLING;else process.env.GSC_MAESTRO_SCRAPLING=prior}
});
test('Scrapling never accepts a page URL as substitute for fetched HTML',async()=>{
 if(!availableScrapling())return;
 assert.equal(await extractMainContent('https://example.com/'),null);
});
