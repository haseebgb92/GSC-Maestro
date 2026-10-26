// Optional, offline Scrapling content extraction from HTML already fetched by
// GSC Maestro's DNS-pinned, robots-aware public crawler. NEVER fetch URLs here.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';

const defaultPython=join(homedir(),'.local/share/advertpreneur-skills/scrapling-venv/bin/python');
const python=()=>process.env.GSC_MAESTRO_SCRAPLING_PYTHON||defaultPython;
const code=String.raw`import json, re, sys
from scrapling import Selector
html = sys.stdin.read(1300001)
if len(html) > 1300000:
    raise ValueError('HTML limit exceeded')
doc = Selector(html)
result = None
for root_name in ('main', 'article', '[role="main"]'):
    found = doc.css(root_name)
    if found:
        root = found.first
        text = ' '.join(root.css('*::text').getall())
        words = len(re.findall(r'\S+', re.sub(r'\s+', ' ', text).strip()))
        result = {'root':root_name, 'words':words,
                  'paragraphs':len(root.css('p')),
                  'headings':len(root.css('h1,h2,h3'))}
        break
print(json.dumps(result, separators=(',', ':')))
`;

export function availableScrapling(){
 return process.env.GSC_MAESTRO_SCRAPLING!=='off'&&existsSync(python());
}
export async function extractMainContent(html){
 if(!availableScrapling()||typeof html!=='string'||Buffer.byteLength(html,'utf8')>1_250_000)return null;
 return new Promise(resolve=>{
  const worker=spawn(python(),['-I','-c',code],{stdio:['pipe','pipe','ignore'],
   env:{HOME:homedir(),PATH:'/usr/bin:/bin',PYTHONNOUSERSITE:'1',LANG:'C.UTF-8'}});
  let stdout='',closed=false;
  const finish=value=>{if(closed)return;closed=true;clearTimeout(timer);resolve(value)};
  const timer=setTimeout(()=>{worker.kill();finish(null)},3500);
  worker.on('error',()=>finish(null));
  worker.stdout.on('data',buf=>{stdout+=buf.toString('utf8');if(stdout.length>4096){worker.kill();finish(null)}});
  worker.on('close',code=>{
   if(code!==0||closed)return finish(null);
   try{
    const data=JSON.parse(stdout);
    finish(data && typeof data.words==='number' && data.words>=0 && data.words<1000000
     && ['main','article','[role="main"]'].includes(data.root) ? data : null);
   }catch{finish(null)}
  });
  worker.stdin.on('error',()=>finish(null));
  worker.stdin.end(html);
 });
}
