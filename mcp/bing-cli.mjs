import{syncBing,bingStatus,bingDashboard}from"./bing.mjs";
const cmd=process.argv[2]||"status",site=process.argv[3];
try{
 let result;
 if(cmd==="status")result=bingStatus();
 else if(cmd==="sync"){const status=bingStatus();result=!status.apiConnected?{skipped:true,message:"Bing API key is not configured yet"}:await syncBing();}
 else if(cmd==="report")result=bingDashboard(site);
 else throw Error("Unsupported Bing command");
 process.stdout.write(JSON.stringify(result)+"\n");
 if(cmd==="sync"&&result.failures>0)process.exitCode=2;
}catch(e){process.stderr.write("Bing Maestro error: "+String(e.message||e).slice(0,300)+"\n");process.exitCode=1}
