#!/usr/bin/env node
import {readFileSync,existsSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {extname} from "node:path";

// Reject credentials and private runtime state before publishing.
// Heuristic scanning complements (not replaces) hosted secret scanning.
const paths=execFileSync("git",["ls-files","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
const badPaths=/(^|\/)(?:\.env(?!\.example$)|yandex-oauth-app\.json|reports|ai-exports|node_modules|dist|mcp-dist|target|resources|\.gradle|private-data)(?:\/|$)|\.(?:sqlite3?|db|p12|pfx|pem|keystore|jks|log|pid)$/i;
const secrets=[
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:github_pat_[a-zA-Z0-9_]{25,}|gh[pousr]_[a-zA-Z0-9]{25,})/,
  /(?:sk-(?:proj-)?[a-zA-Z0-9_-]{35,}|ya29\.[a-zA-Z0-9._-]{18,})/,
  /AIza[a-zA-Z0-9_-]{30,}/,
  /[0-9]{7,}-[a-zA-Z0-9_-]{18,}\.apps\.googleusercontent\.com/,
  /https:\/\/[a-z0-9-]+\.tail[a-z0-9]+\.ts\.net/i,
  /\/home\/haseeb\//i,
];
const textual=new Set([".js",".mjs",".ts",".tsx",".rs",".json",".md",".toml",".html",".svg",".css",".yml",".yaml",".txt",".example",".xml"]);
const findings=[];
for(const name of paths){
 if(badPaths.test(name)||/oauth.*(?:client|app).*\.json$/i.test(name))findings.push(`Forbidden filename: ${name}`);
 if(!existsSync(name)||!textual.has(extname(name)))continue;
 const content=readFileSync(name,"utf8");
 for(const pattern of secrets)if(pattern.test(content))findings.push(`Potential secret/private-machine data: ${name} (${pattern.source.slice(0,24)}...)`);
}
if(findings.length){for(const x of findings)console.error(x);process.exit(1)}
console.log(`Security gate passed: ${paths.length} tracked files; no blocked credentials or runtime files detected.`);
