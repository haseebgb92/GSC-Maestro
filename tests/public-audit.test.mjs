import test from "node:test";
import assert from "node:assert/strict";
import {canonicalInput,scoreReport} from "../mcp/audit.mjs";

test("Public crawler accepts normal HTTPS websites and upgrades bare domains",()=>{
 assert.equal(canonicalInput("example.com").href,"https://example.com/");
 assert.equal(canonicalInput("https://www.example.com/service#section").href,"https://www.example.com/service");
});
test("Crawler rejects local, private IP, non-HTTP and credentialed targets",()=>{
 for(const target of ["localhost","127.0.0.1","192.168.0.7","169.254.169.254","[::1]","file:///etc/passwd","http://example.com:8080","https://user:pass@example.com"]){
  assert.throws(()=>canonicalInput(target),undefined,target);
 }
});
test("Public audit score is a deterministic heuristic, not simulated GSC data",()=>{
 const report=scoreReport([{
 url:"https://example.com",score:75,title:"Example",description:"",noindex:false,status:200,
 images:2,imagesMissingAlt:1,schemaCount:0,
 issues:[{code:"missing_description",severity:"medium",weight:8,message:"Missing description"}]
 }]);
 assert.equal(report.pagesAudited,1);
 assert.equal(report.score,75);
 assert.equal(report.issueCount,1);
 assert.equal(report.imagesMissingAlt,1);
 assert.equal(Object.hasOwn(report,"clicks"),false);
 assert.equal(Object.hasOwn(report,"impressions"),false);
});
