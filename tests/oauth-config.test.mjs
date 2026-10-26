import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";

const script = `
 import {challenge,handleOAuth} from "./mcp/oauth.mjs";
 const result={challenge:challenge(),handler:await handleOAuth({method:"GET",url:"/.well-known/oauth-authorization-server"},{writeHead(){},end(){}}, "dummy")};
 console.log(JSON.stringify(result));
`;

function run(env) {
 const next={...process.env};
 delete next.GSC_MAESTRO_PUBLIC_BASE_URL;
 Object.assign(next,env);
 return spawnSync(process.execPath,["--input-type=module","--eval",script],{cwd:process.cwd(),env:next,encoding:"utf8"});
}

test("unconfigured remote OAuth fails closed",()=>{
 const result=run({});
 assert.equal(result.status,0,result.stderr);
 const data=JSON.parse(result.stdout.trim());
 assert.match(data.challenge,/realm="GSC Maestro"/);
 assert.equal(data.handler,false);
});

test("configured remote OAuth uses the installer provided HTTPS hostname",()=>{
 const result=run({GSC_MAESTRO_PUBLIC_BASE_URL:"https://maestro.example.org/private/gsc-maestro/"});
 assert.equal(result.status,0,result.stderr);
 const data=JSON.parse(result.stdout.trim());
 assert.match(data.challenge,/https:\/\/maestro\.example\.org\/private\/gsc-maestro\/\.well-known/);
 assert.equal(data.handler,true);
});

test("plaintext and credential-bearing remote URLs are rejected",()=>{
 for(const value of ["http://maestro.example.org", "https://user:pass@maestro.example.org/gsc-maestro"]){
  const result=run({GSC_MAESTRO_PUBLIC_BASE_URL:value});
  assert.notEqual(result.status,0,"Unsafe public MCP URL must fail closed");
 }
});
