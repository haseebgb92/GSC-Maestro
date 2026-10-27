import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('Glama GSC Maestro public container has only metrics tools and accurate calculations',{timeout:30000},async()=>{
  const transport=new StdioClientTransport({
    command:'docker',
    args:['run','--rm','-i','--network=none','--read-only','--cap-drop=ALL',
      '--security-opt=no-new-privileges','gsc-maestro:glama-public'],
    stderr:'pipe'
  });
  const client=new Client({name:'gsc-glama-smoke',version:'1.0.0'},{capabilities:{}});
  const call=async(name,args={})=>{
    const v=await client.callTool({name,arguments:args});
    return {error:v.isError===true,data:JSON.parse(v.content[0].text)};
  };
  try{
    await client.connect(transport);
    const tools=(await client.listTools()).tools;
    assert.deepEqual(tools.map(t=>t.name).sort(),[
      'maestro_public_capabilities','maestro_calculate_ctr',
      'maestro_compare_periods','maestro_explain_search_metrics'
    ].sort());
    for(const tool of tools){
      assert.equal(tool.annotations?.readOnlyHint,true);
      assert.ok(tool.description?.length>75);
      for(const param of Object.values(tool.inputSchema?.properties||{})) assert.ok(param.description?.length>35);
    }
    const capabilities=await call('maestro_public_capabilities');
    assert.equal(capabilities.data.liveConnected,false);
    assert.equal(capabilities.data.hasCredentials,false);
    const result=await call('maestro_calculate_ctr',{clicks:50,impressions:2000});
    assert.equal(result.data.ctrPercent,2.5);
    assert.equal(result.data.source,'user_supplied');
    const empty=await call('maestro_calculate_ctr',{clicks:0,impressions:0});
    assert.equal(empty.data.ctrPercent,null);
    const comparison=await call('maestro_compare_periods',{previousClicks:80,previousImpressions:4000,currentClicks:150,currentImpressions:5000});
    assert.equal(comparison.data.difference.ctrPercentagePoints,1);
    assert.equal(comparison.data.difference.clicks,70);
    const invalid=await call('maestro_calculate_ctr',{clicks:100,impressions:50});
    assert.equal(invalid.error,true);
    const definitions=await call('maestro_explain_search_metrics');
    assert.match(definitions.data.caveat,/Google and Bing/);
  }finally{await client.close().catch(()=>{});}
});
