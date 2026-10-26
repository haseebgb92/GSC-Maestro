import{syncYandex,yandexStatus,yandexDashboard}from"./yandex.mjs";
const command=process.argv[2]||"status";try{
 let answer;
 if(command==="status")answer=yandexStatus();
 else if(command==="sync")answer=!yandexStatus().tokenConfigured?{engine:"yandex",skipped:true,message:"Yandex OAuth token not configured. Sign in to Yandex Webmaster and connect OAuth in desktop app."}:await syncYandex();
 else if(command==="report")answer=yandexDashboard(process.argv[3]);
 else throw Error("Unsupported Yandex command");
 process.stdout.write(JSON.stringify(answer)+"\n");
 if(command==="sync"&&answer.failures>0)process.exitCode=2;
}catch(e){process.stderr.write("Yandex Maestro: "+String(e.message||e).slice(0,250)+"\n");process.exitCode=1}
