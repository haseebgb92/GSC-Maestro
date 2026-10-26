import{randomBytes,createHash,timingSafeEqual}from"node:crypto";
import{existsSync,readFileSync,writeFileSync,renameSync,mkdirSync,chmodSync}from"node:fs";
import{join,dirname}from"node:path";import{homedir}from"node:os";
// Each installation must explicitly configure its own public HTTPS OAuth URL.
const rawBase=(process.env.GSC_MAESTRO_PUBLIC_BASE_URL||"").trim();
if(rawBase && (!rawBase.startsWith("https://") || !/^https:\/\/[^/?#@]+(?:\/[^?#]*)?$/.test(rawBase)))
 throw Error("Set GSC_MAESTRO_PUBLIC_BASE_URL to your own HTTPS base URL");
const BASE=rawBase.replace(/\/+$/,"");
const RESOURCE=BASE+"/mcp",SCOPE="gsc:read";
const FILE=join(homedir(),".local/share/com.advertpreneur.gscmaestro/oauth-state.json");
const CID="https://chatgpt.com/oauth/client.json",REDIRECT="https://chatgpt.com/connector_platform_oauth_redirect";
const TTL={pending:600000,code:300000,access:3600000,refresh:2592000000};
const digest=s=>createHash("sha256").update(s).digest("base64url");
const random=()=>randomBytes(32).toString("base64url");
const records=(()=>{try{const s=JSON.parse(readFileSync(FILE,"utf8"));return{pending:s.pending||{},codes:s.codes||{},access:s.access||{},refresh:s.refresh||{}}}catch{return{pending:{},codes:{},access:{},refresh:{}}}})();
function save(){const now=Date.now();for(const kind of ["pending","codes","access","refresh"])for(const [k,x]of Object.entries(records[kind]))if(x.expiresAt<now)delete records[kind][k];mkdirSync(dirname(FILE),{recursive:true,mode:0o700});const tmp=FILE+".tmp";writeFileSync(tmp,JSON.stringify(records),{mode:0o600});renameSync(tmp,FILE);chmodSync(FILE,0o600)}
function json(res,status,body){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(JSON.stringify(body))}
function redirect(res,target){res.writeHead(302,{"Location":target,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"});res.end()}
function page(res,status,message){res.writeHead(status,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"});res.end('<!doctype html><meta http-equiv="refresh" content="2"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GSC Maestro authorization</title><style>body{max-width:460px;margin:10vh auto;padding:22px;background:#f5f8fc;color:#1f3e5f;font-family:system-ui}.card{background:#fff;padding:28px;border:1px solid #dce8f3;border-radius:16px}h1{color:#176ca7}p{line-height:1.7;color:#5f7590}</style><div class="card"><h1>GSC Maestro</h1><p>'+message+'</p><p>Read-only access. Approval is required from the owner on the Linux machine.</p></div>')}
async function textBody(req){let s="";for await(const p of req){s+=p.toString("utf8");if(s.length>8192)throw Error("Oversized request")}return s}
function localOwner(req,secret){const h=req.headers.authorization||"";if(!h.startsWith("Bearer "))return false;const provided=Buffer.from(h.slice(7)),expected=Buffer.from(secret);return provided.length===expected.length&&timingSafeEqual(provided,expected)}
export function isOAuthToken(token){const record=records.access[digest(token||"")];return Boolean(record&&record.expiresAt>Date.now()&&record.resource===RESOURCE&&record.scope===SCOPE&&record.clientId===CID)}
export function challenge(){return BASE ? ('Bearer resource_metadata="'+BASE+'/.well-known/oauth-protected-resource", scope="'+SCOPE+'"') : 'Bearer realm="GSC Maestro"';}
function issue(entry){const access=random(),refresh=random(),now=Date.now();records.access[digest(access)]={resource:RESOURCE,clientId:entry.clientId,scope:SCOPE,expiresAt:now+TTL.access};records.refresh[digest(refresh)]={resource:RESOURCE,clientId:entry.clientId,scope:SCOPE,expiresAt:now+TTL.refresh};save();return{access_token:access,refresh_token:refresh,token_type:"Bearer",expires_in:3600,scope:SCOPE}}
const protectedResource={resource:RESOURCE,authorization_servers:[BASE],scopes_supported:[SCOPE],resource_name:"GSC Maestro"};
const metadata={issuer:BASE,authorization_endpoint:BASE+"/oauth/authorize",token_endpoint:BASE+"/oauth/token",authorization_response_iss_parameter_supported:true,client_id_metadata_document_supported:true,token_endpoint_auth_methods_supported:["none"],response_types_supported:["code"],grant_types_supported:["authorization_code","refresh_token"],code_challenge_methods_supported:["S256"],scopes_supported:[SCOPE]};
export async function handleOAuth(req,res,secret){
 if(!BASE)return false; // OAuth routes are disabled until a private owner configures HTTPS.
 const u=new URL(req.url,"http://127.0.0.1"),path=u.pathname;
 if(req.method==="GET"&&["/.well-known/oauth-protected-resource","/.well-known/oauth-protected-resource/mcp"].includes(path)){json(res,200,protectedResource);return true}
 if(req.method==="GET"&&["/.well-known/oauth-authorization-server","/.well-known/oauth-authorization-server/gsc-maestro","/.well-known/openid-configuration"].includes(path)){json(res,200,metadata);return true}
 if(req.method==="GET"&&path==="/oauth/authorize"){
  const id=u.searchParams.get("client_id"),redir=u.searchParams.get("redirect_uri"),challenge=u.searchParams.get("code_challenge"),method=u.searchParams.get("code_challenge_method"),scope=u.searchParams.get("scope")||SCOPE,resource=u.searchParams.get("resource")||RESOURCE;
  if(id!==CID||redir!==REDIRECT||method!=="S256"||!/^[a-zA-Z0-9_-]{43,128}$/.test(challenge||"")||resource!==RESOURCE||scope!==SCOPE||u.searchParams.get("response_type")!=="code"){page(res,400,"Unsupported authorization request.");return true}
  const key=random();records.pending[key]={clientId:id,redirect:redir,challenge,resource,scope,state:u.searchParams.get("state")||"",expiresAt:Date.now()+TTL.pending,approved:false};save();redirect(res,BASE+"/oauth/wait?id="+encodeURIComponent(key));return true;
 }
 if(req.method==="GET"&&path==="/oauth/wait"){
  const id=u.searchParams.get("id"),x=records.pending[id];
  if(!x||x.expiresAt<Date.now()){page(res,410,"Authorization expired. Please reconnect from ChatGPT.");return true}
  if(!x.approved){page(res,200,"ChatGPT is requesting access to the local SEO analytics. Awaiting secure owner approval…");return true}
  if(!x.code){const code=random();x.code=code;records.codes[digest(code)]={...x,expiresAt:Date.now()+TTL.code};save()}
  const target=new URL(x.redirect);target.searchParams.set("code",x.code);if(x.state)target.searchParams.set("state",x.state);target.searchParams.set("iss",BASE);redirect(res,target.href);return true;
 }
 if(req.method==="GET"&&path==="/oauth/pending"){
  if(!localOwner(req,secret)){json(res,403,{error:"Forbidden"});return true}
  json(res,200,{pending:Object.entries(records.pending).filter(([_,x])=>!x.approved&&x.expiresAt>Date.now()).map(([id,x])=>({id,clientId:x.clientId,redirect:x.redirect,expiresAt:x.expiresAt}))});return true;
 }
 if(req.method==="POST"&&path==="/oauth/approve"){
  if(!localOwner(req,secret)){json(res,403,{error:"Forbidden"});return true}
  let data;try{data=JSON.parse(await textBody(req))}catch{json(res,400,{error:"Invalid JSON"});return true}
  const x=records.pending[data.id];if(!x||x.approved||x.expiresAt<Date.now()){json(res,404,{error:"Not pending"});return true}
  x.approved=true;save();json(res,200,{approved:true});return true;
 }
 if(req.method==="POST"&&path==="/oauth/token"){
  const params=new URLSearchParams(await textBody(req)),clientId=params.get("client_id"),resource=params.get("resource")||RESOURCE;
  if(clientId!==CID||resource!==RESOURCE){json(res,400,{error:"invalid_client"});return true}
  if(params.get("grant_type")==="authorization_code"){
   const code=params.get("code"),entry=records.codes[digest(code||"")],verifier=params.get("code_verifier");
   if(!entry||entry.expiresAt<Date.now()||!verifier||digest(verifier)!==entry.challenge||entry.redirect!==params.get("redirect_uri")){json(res,400,{error:"invalid_grant"});return true}
   delete records.codes[digest(code)];for(const [key,x]of Object.entries(records.pending))if(x.code===code)delete records.pending[key];json(res,200,issue(entry));return true;
  }
  if(params.get("grant_type")==="refresh_token"){
   const rt=params.get("refresh_token"),entry=records.refresh[digest(rt||"")];
   if(!entry||entry.expiresAt<Date.now()){json(res,400,{error:"invalid_grant"});return true}
   delete records.refresh[digest(rt)];json(res,200,issue(entry));return true;
  }
  json(res,400,{error:"unsupported_grant_type"});return true;
 }
 return false;
}
