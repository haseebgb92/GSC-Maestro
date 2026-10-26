import { createServer as createHttpServer } from "node:http";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMaestroServer } from "./server.mjs";
import {handleOAuth,isOAuthToken,challenge} from "./oauth.mjs";

const ROOT=dirname(fileURLToPath(import.meta.url));
const HOST="127.0.0.1";
const PORT=Number(process.env.GSC_MAESTRO_HTTP_PORT||8798);
const TOKEN_FILE=process.env.GSC_MAESTRO_TOKEN_FILE||join(homedir(),".local/share/com.advertpreneur.gscmaestro/mcp-http-token");
const MAX_BODY_BYTES=1024*1024;
if(!Number.isInteger(PORT)||PORT<1024||PORT>65535)throw Error("Invalid port");
mkdirSync(dirname(TOKEN_FILE),{recursive:true,mode:0o700});
if(!existsSync(TOKEN_FILE)){
  try{writeFileSync(TOKEN_FILE,randomBytes(40).toString("base64url")+"\n",{mode:0o600,flag:"wx"});}
  catch(e){if(e.code!=="EEXIST")throw e;}
}
chmodSync(TOKEN_FILE,0o600);
const secret=readFileSync(TOKEN_FILE,"utf8").trim();
if(secret.length<40)throw Error("Refusing to start with a weak authentication token");

function authorized(req){
 const h=req.headers.authorization;
 if(typeof h!=="string"||!h.startsWith("Bearer "))return false;
 const supplied=Buffer.from(h.slice(7),"utf8"),expected=Buffer.from(secret,"utf8");
 return (supplied.length===expected.length&&timingSafeEqual(supplied,expected))||isOAuthToken(h.slice(7));
}
function sendJson(res,code,detail){
 res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});
 res.end(JSON.stringify({error:detail}));
}
const counters=new Map();
const srv=createHttpServer(async(req,res)=>{
 try{
  res.setHeader("cache-control","no-store");
  res.setHeader("x-content-type-options","nosniff");
  res.setHeader("referrer-policy","no-referrer");
  if(await handleOAuth(req,res,secret))return;
  if(req.url==="/icon.png" && req.method==="GET"){
   const bundled=join(ROOT,"icon.png");
   const icon=readFileSync(existsSync(bundled)?bundled:join(ROOT,"../src-tauri/icons/icon.png"));
   res.writeHead(200,{"Content-Type":"image/png","Cache-Control":"public,max-age=86400","X-Content-Type-Options":"nosniff","Content-Length":icon.length});
   return res.end(icon);
  }
  if(req.url!=="/mcp"&&req.url!=="/mcp/")return sendJson(res,404,"Not found");
  if(!authorized(req)){
   res.setHeader("WWW-Authenticate",challenge());
   return sendJson(res,401,"Authentication required");
  }
  const origin=req.headers.origin;
  if(origin){
   let parsed;
   try{parsed=new URL(origin)}catch{return sendJson(res,403,"Invalid origin")}
   if(parsed.protocol!=="https:"||!/(^|\.)(chatgpt\.com|openai\.com)$/.test(parsed.hostname))return sendJson(res,403,"Origin not allowed");
  }
  const ip=req.socket.remoteAddress||"unknown";
  const time=Math.floor(Date.now()/60000);
  const bucket=counters.get(ip);
  if(!bucket||bucket.minute!==time)counters.set(ip,{minute:time,count:1});
  else if(++bucket.count>90)return sendJson(res,429,"Request rate exceeded");
  if(req.method!=="POST")return sendJson(res,405,"POST required");
  if(Number(req.headers["content-length"]||0)>MAX_BODY_BYTES)return sendJson(res,413,"Body too large");
  let bytes=0;
  const pieces=[];
  for await(const chunk of req){
   bytes+=chunk.length;
   if(bytes>MAX_BODY_BYTES)return sendJson(res,413,"Body too large");
   pieces.push(chunk);
  }
  let parsed;
  try{parsed=JSON.parse(Buffer.concat(pieces).toString("utf8"));}
  catch{return sendJson(res,400,"Invalid JSON");}
  const server=createMaestroServer();
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on("close",()=>{void transport.close().catch(()=>{});void server.close().catch(()=>{});});
  await server.connect(transport);
  await transport.handleRequest(req,res,parsed);
 }catch(e){if(!res.headersSent)sendJson(res,500,"MCP request failed");}
});
srv.requestTimeout=20000;
srv.headersTimeout=12000;
srv.listen(PORT,HOST,()=>{
 process.stdout.write("GSC Maestro MCP bridge listening on local loopback port "+PORT+"; Bearer authorization enforced.\n");
});
process.on("SIGTERM",()=>srv.close(()=>process.exit(0)));
process.on("SIGINT",()=>srv.close(()=>process.exit(0)));
