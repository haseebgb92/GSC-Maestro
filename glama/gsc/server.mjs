import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const info = 'This public hosted edition only processes user-supplied numeric aggregates. It has no Search Console, Bing, Yandex, OAuth, local SQLite, browser, or client data access. It does not store requests.';
const annotations = {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const metric = (description) => ({type:'integer',minimum:0,maximum:1000000000000,description});
const input = (properties,required=[]) => ({type:'object',properties,required,additionalProperties:false});
const tools = [
  {name:'maestro_public_capabilities',title:'Public GSC Maestro edition: capabilities',
   description:'Explain what this hosted metrics demo does and cannot do. It cannot access any real Google, Bing, Yandex, or local desktop data.',
   inputSchema:input({}),annotations},
  {name:'maestro_calculate_ctr',title:'Calculate CTR from supplied search aggregates',
   description:'Calculate clicks divided by impressions, as a percent. All numbers are supplied in the request and must represent the same search source, period and filters. No external queries or stored credentials.',
   inputSchema:input({
     clicks:metric('Total search-result clicks from one search source and reporting period.'),
     impressions:metric('Total search-result impressions for that exact source, period and filters.')
   },['clicks','impressions']),annotations},
  {name:'maestro_compare_periods',title:'Compare user-supplied search reporting periods',
   description:'Compare two periods using caller-provided click and impression totals and calculate CTR percentage-point changes. No saved search properties, API calls or estimated traffic.',
   inputSchema:input({
     previousClicks:metric('Nonnegative clicks in the earlier reporting period.'),
     previousImpressions:metric('Nonnegative impressions in the earlier reporting period.'),
     currentClicks:metric('Nonnegative clicks in the later reporting period.'),
     currentImpressions:metric('Nonnegative impressions in the later reporting period.')
   },['previousClicks','previousImpressions','currentClicks','currentImpressions']),annotations},
  {name:'maestro_explain_search_metrics',title:'Explain search performance metrics and caveats',
   description:'Explain clicks, impressions, CTR, and average position, including why metrics from different engines should not be combined naively. No account access or source data.',
   inputSchema:input({}),annotations}
];
const reply = obj => ({content:[{type:'text',text:JSON.stringify(obj,null,2)}]});
const fail = msg => ({isError:true,content:[{type:'text',text:msg}]});
const round = x => Math.round((x+Number.EPSILON)*100)/100;
const ctr = (clicks,impressions) => impressions===0 ? null : round(100*clicks/impressions);
const delta = (current,previous) => previous===0 ? null : round((current-previous)*100/previous);
function calculate(name,args={}) {
  const tool=tools.find(t=>t.name===name);
  if(!tool)return fail('Unknown public GSC Maestro tool.');
  if(!args || typeof args!=='object' || Array.isArray(args))return fail('Parameters must be an object.');
  for(const key of Object.keys(args)){
    if(!(key in tool.inputSchema.properties))return fail('Unexpected input field: '+key);
    if(!Number.isSafeInteger(args[key]) || args[key]<0 || args[key]>1000000000000)
      return fail('Invalid '+key+': expected a nonnegative integer up to 1 trillion.');
  }
  for(const required of tool.inputSchema.required)
    if(!(required in args))return fail('Missing input: '+required);
  if(name==='maestro_public_capabilities')
    return reply({edition:'Glama-hosted public metrics-only',liveConnected:false,hasCredentials:false,
      tools:tools.map(t=>t.name),note:info,desktop:'https://github.com/haseebgb92/GSC-Maestro'});
  if(name==='maestro_explain_search_metrics')
    return reply({source:'public_definitions_only',clicks:'Clicks recorded by the specified search engine.',
      impressions:'Search-result appearances reported by the same engine.',
      ctrPercent:'100 × clicks / impressions; undefined when impressions are zero.',
      averagePosition:'Impression-weighted GSC position, not a fixed universal rank.',
      caveat:'Google and Bing have different reporting methods. Always keep source, dates, filters and units clear.'});
  if(name==='maestro_calculate_ctr'){
    if(args.clicks>args.impressions)return fail('Clicks cannot exceed impressions in this calculator.');
    return reply({source:'user_supplied',liveConnected:false,clicks:args.clicks,
      impressions:args.impressions,ctrPercent:ctr(args.clicks,args.impressions)});
  }
  if(args.previousClicks>args.previousImpressions || args.currentClicks>args.currentImpressions)
    return fail('Clicks cannot exceed impressions within either period.');
  const pc=ctr(args.previousClicks,args.previousImpressions);
  const cc=ctr(args.currentClicks,args.currentImpressions);
  return reply({source:'user_supplied',liveConnected:false,
    previous:{clicks:args.previousClicks,impressions:args.previousImpressions,ctrPercent:pc},
    current:{clicks:args.currentClicks,impressions:args.currentImpressions,ctrPercent:cc},
    difference:{clicks:args.currentClicks-args.previousClicks,impressions:args.currentImpressions-args.previousImpressions,
      ctrPercentagePoints:pc===null || cc===null?null:round(cc-pc),
      clicksChangePercent:delta(args.currentClicks,args.previousClicks),
      impressionsChangePercent:delta(args.currentImpressions,args.previousImpressions)},
    caveat:'Both periods should use identical search engine, query dimensions, filters and comparable durations.'});
}
const server=new Server({name:'gsc-maestro-public-metrics',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools}));
server.setRequestHandler(CallToolRequestSchema,async req=>calculate(req.params.name,req.params.arguments));
await server.connect(new StdioServerTransport());
