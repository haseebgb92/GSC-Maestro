import {auditPublicSite} from "./audit.mjs";
const url=process.argv[2],pages=Number(process.argv[3]||8);
try{const report=await auditPublicSite(url,{maxPages:pages});process.stdout.write(JSON.stringify(report)+"\n");}
catch(e){process.stderr.write("Audit error: "+String(e.message||e)+"\n");process.exitCode=1}
