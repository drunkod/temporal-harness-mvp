import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const root=resolve(process.cwd());
const base=join(root,'.state','sashai-synthetic-report');
const hash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
export type FixtureMode='repair'|'uncertain';
export interface FixtureBinding {
 mode:FixtureMode;taskId:string;attemptId:string;
 contractSha256:string;chat:string;artifactPath:string;
 composerSha256:string;
}
export interface FixtureReceipt{
 taskId:string;attemptId:string;contractSha256:string;chat:string;
 artifactPath:string;artifactSha256:string;accepted:boolean;unmet:string[];
}
const contract=(mode:FixtureMode)=>({
 kind:'SYNTHETIC_REPORT_ONLY_NO_BROWSER',
 approved:'disposable_fixture_only',
 taskId:'synthetic-report-'+mode,
 chat:'synthetic://sashai-report/'+mode,
 instruction:'Create a disposable report containing its task/attempt identity and marker.',
 requiredMarker:'ACCEPTANCE: VERIFIED',
});
function directory(mode:FixtureMode){
 if(mode!=='repair'&&mode!=='uncertain')throw Error('Unapproved synthetic fixture ID');
 return join(base,mode);
}
function fixtureHash(mode:FixtureMode):string{return hash(JSON.stringify(contract(mode)));}
export async function prepareFixture(mode:FixtureMode):Promise<FixtureBinding>{
 const folder=directory(mode);
 await mkdir(folder,{recursive:true,mode:0o700});
 const data=contract(mode);
 const out=join(folder,'report.md');
 const b:FixtureBinding={mode,taskId:data.taskId,attemptId:randomUUID(),
  contractSha256:fixtureHash(mode),chat:data.chat,artifactPath:out,
  composerSha256:hash('Remote Desktop Commander '+data.instruction)};
 const file=join(folder,'attempt.json');
 try{await writeFile(file,JSON.stringify(b,null,2)+'\n',{flag:'wx',mode:0o600});}
 catch(e){if((e as NodeJS.ErrnoException)?.code!=='EEXIST')throw e;}
 const saved=JSON.parse(await readFile(file,'utf8')) as FixtureBinding;
 if(saved.mode!==mode||saved.taskId!==b.taskId||saved.chat!==b.chat||
   saved.contractSha256!==b.contractSha256||saved.artifactPath!==out||
   saved.composerSha256!==b.composerSha256||!/^[0-9a-f-]{36}$/.test(saved.attemptId))
  throw Error('Synthetic approved attempt identity mismatch');
 return saved;
}
async function readAttempt(mode:FixtureMode):Promise<FixtureBinding>{
 const b=JSON.parse(await readFile(join(directory(mode),'attempt.json'),'utf8')) as FixtureBinding;
 if(b.mode!==mode||b.contractSha256!==fixtureHash(mode)||
    b.taskId!==contract(mode).taskId||b.chat!==contract(mode).chat||
    b.artifactPath!==join(directory(mode),'report.md'))throw Error('Fixture attempt changed');
 return b;
}
const same=(a:FixtureBinding,b:FixtureBinding)=>JSON.stringify(a)===JSON.stringify(b);
export async function dispatchFixtureOnce(binding:FixtureBinding):Promise<{state:'sent'|'uncertain';claimDigest:string}>{
 const current=await readAttempt(binding.mode);
 if(!same(binding,current))throw Error('Fixture pre-send identity changed');
 const folder=directory(binding.mode);
 const claim=join(folder,'SEND_ATTEMPTED');
 const payload=JSON.stringify({taskId:binding.taskId,attemptId:binding.attemptId,
  chat:binding.chat,contractSha256:binding.contractSha256,
  composerSha256:binding.composerSha256});
 // A write-ahead claim is created before *any* artifact side effect.
 await writeFile(claim,payload+'\n',{flag:'wx',mode:0o600});
 const text='# Synthetic report — not a real ChatGPT conversation\n\n'
  +'Task: '+binding.taskId+'\nAttempt: '+binding.attemptId
  +'\nConversation: '+binding.chat+'\n'
  +'STATUS: INCOMPLETE\n';
 await writeFile(binding.artifactPath,text,{flag:'wx',mode:0o600});
 // Simulate a response lost AFTER the side effect and durable claim.
 // Temporal must reconcile and BLOCK; this activity is never retried.
 if(binding.mode==='uncertain')throw Error('SYNTHETIC_TIMEOUT_AFTER_SEND_CLAIM');
 return {state:'sent',claimDigest:hash(payload+'\n')};
}
export async function reconcileFixtureSend(binding:FixtureBinding):Promise<{claimed:boolean;artifactPresent:boolean;claimMatched:boolean}>{
 const dir=directory(binding.mode);
 const claim=await readFile(join(dir,'SEND_ATTEMPTED'),'utf8').catch(()=>null);
 const body=await readFile(binding.artifactPath,'utf8').catch(()=>null);
 let match=false;
 try{const j=JSON.parse(claim||'null');match=j.taskId===binding.taskId&&
  j.attemptId===binding.attemptId&&j.chat===binding.chat&&
  j.contractSha256===binding.contractSha256&&j.composerSha256===binding.composerSha256;
 }catch{}
 return {claimed:claim!==null,artifactPresent:body!==null,claimMatched:match};
}
export async function verifyFixture(binding:FixtureBinding):Promise<FixtureReceipt>{
 const current=await readAttempt(binding.mode);
 if(!same(binding,current))throw Error('Synthetic verifier attempt differs from original');
 const text=await readFile(binding.artifactPath,'utf8').catch(()=>null);
 const unmet:string[]=[];
 if(!text)unmet.push('missing_artifact');
 if(text&&!text.includes('Task: '+binding.taskId))unmet.push('task_mismatch');
 if(text&&!text.includes('Attempt: '+binding.attemptId))unmet.push('attempt_mismatch');
 if(text&&!text.includes('Conversation: '+binding.chat))unmet.push('chat_mismatch');
 if(text&&!text.includes(contract(binding.mode).requiredMarker))unmet.push('required_marker_missing');
 const claim=await reconcileFixtureSend(binding);
 if(!claim.claimMatched)unmet.push('send_claim_mismatch');
 return {taskId:binding.taskId,attemptId:binding.attemptId,contractSha256:binding.contractSha256,
  chat:binding.chat,artifactPath:binding.artifactPath,
  artifactSha256:text?hash(text):'',accepted:unmet.length===0,unmet};
}
export async function repairFixtureOnce(binding:FixtureBinding,failed:FixtureReceipt):Promise<void>{
 const current=await readAttempt(binding.mode);
 if(!same(binding,current))throw Error('Synthetic pre-correction attempt identity changed');
 if(binding.mode!=='repair')throw Error('Cannot repair an uncertain send');
 if(failed.accepted||failed.unmet.join(',')!=='required_marker_missing')throw Error('Unapproved correction scope');
 if(failed.taskId!==binding.taskId||failed.attemptId!==binding.attemptId||
    failed.chat!==binding.chat||failed.contractSha256!==binding.contractSha256||
    failed.artifactPath!==binding.artifactPath)throw Error('Correction receipt identity mismatch');
 const source=await readFile(binding.artifactPath,'utf8');
 if(hash(source)!==failed.artifactSha256||!source.endsWith('STATUS: INCOMPLETE\n'))
  throw Error('Report changed after initial rejection');
 // This guard prevents a duplicate correction even after a workflow crash.
 await writeFile(join(directory(binding.mode),'CORRECTION_ATTEMPTED'),
  JSON.stringify({attemptId:binding.attemptId,chat:binding.chat,
   originalSha256:failed.artifactSha256})+'\n',{flag:'wx',mode:0o600});
 const updated=source.replace('STATUS: INCOMPLETE\n',
   'STATUS: COMPLETE\n'+contract(binding.mode).requiredMarker+'\n');
 await writeFile(binding.artifactPath,updated,{flag:'w',mode:0o600});
}
