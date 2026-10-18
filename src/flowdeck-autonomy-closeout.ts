/** Idempotent, success-only owner-claim archival transaction.
 * Purely a reusable primitive: a separate authoritative collector must verify
 * Temporal, session, browser, journal and output evidence before invocation.
 * An uncertain run or competing sender must never call this.
 */
import {readFile,open,rename,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {sha256} from './flowdeck-autonomy-policy.js';
export interface AutonomousCloseoutEvidence {
 workflowId:string;runId:string;projectId:string;claimSha256:string;evidenceDigest:string;
 terminalSuccess:true;allSendsReconciled:true;allSessionsReported:true;allEventsDelivered:true;
 promptSealsMatch:true;artifactsVerified:true;noSenders:true;
}
export interface AutonomousCloseoutPaths{
 claim:string;intent:string;archive:string;receipt:string;lock:string;
}
const hex=/^[0-9a-f]{64}$/;
const ids=/^[a-zA-Z0-9_-]{2,200}$/;
const read=async(path:string):Promise<any|null>=>{
 try{return JSON.parse(await readFile(path,'utf8'))}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e}
};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const required=(condition:unknown,reason:string)=>{if(!condition)throw Error('autonomous closeout blocked: '+reason)};
export function validateAutonomousSuccessEvidence(e:AutonomousCloseoutEvidence){
 required(e&&[e.workflowId,e.runId,e.projectId].every(x=>typeof x==='string'&&ids.test(x)),
  'exact workflow/run/project required');
 required(hex.test(e.claimSha256)&&hex.test(e.evidenceDigest),'missing claim/evidence digest');
 for(const k of ['terminalSuccess','allSendsReconciled','allSessionsReported','allEventsDelivered',
  'promptSealsMatch','artifactsVerified','noSenders'] as const)
  required(e[k]===true,'success evidence incomplete: '+k);
 return e;
}
async function durable(path:string,value:unknown){
 const f=await open(path,'wx',0o600);
 try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync()}
 finally{await f.close()}
 const d=await open(dirname(path),'r');try{await d.sync()}finally{await d.close()}
}
const retireRecord=(e:AutonomousCloseoutEvidence)=>({schema:'flowdeck.autonomy-closeout/v1',
 workflowId:e.workflowId,runId:e.runId,projectId:e.projectId,
 claimSha256:e.claimSha256,evidenceDigest:e.evidenceDigest});
const verifyRecord=(record:any,e:AutonomousCloseoutEvidence)=>{
 required(record&&same(Object.entries(retireRecord(e)),Object.entries(Object.fromEntries(
  Object.keys(retireRecord(e)).map(k=>[k,record[k]])))),'retirement belongs to another run');
};
/** resume=true is only for an operator/controller that independently proved the
 * old sender process has stopped. Never infer this from a stale lock alone.
 */
export async function archiveAutonomousSuccess(e:AutonomousCloseoutEvidence,paths:AutonomousCloseoutPaths,{
 verify, resume=false, afterPhase=async (_phase:string)=>{}
}:{
 verify:()=>Promise<AutonomousCloseoutEvidence>,resume?:boolean,
 afterPhase?:(phase:string)=>Promise<void>
}):Promise<{state:'retired';recovered:boolean}>{
 validateAutonomousSuccessEvidence(e);
 const pathsArray=Object.values(paths).map(x=>resolve(x));
 required(new Set(pathsArray).size===5&&pathsArray.every((x,i)=>x===Object.values(paths)[i]),
  'invalid or noncanonical closeout paths');
 const existingLock=await read(paths.lock);
 if(existingLock){
  required(resume===true,'existing durable lock; explicit same-run recovery required');
  verifyRecord(existingLock,e);
 }else{
  required(resume===false,'recovery requested without matching existing lock');
  await durable(paths.lock,retireRecord(e));
  await afterPhase('locked');
 }
 const fresh=await verify();
 validateAutonomousSuccessEvidence(fresh);
 required(same(fresh,e),'evidence changed during locked closeout');
 const receipt=await read(paths.receipt),archiveBytes=await readFile(paths.archive).catch(err=>{
  if((err as NodeJS.ErrnoException).code==='ENOENT')return null;throw err
 });
 if(receipt){
  verifyRecord(receipt,e);
  required(receipt.state==='retired'&&archiveBytes&&sha256(archiveBytes)===e.claimSha256,
   'receipt or archived claim changed');
  return{state:'retired',recovered:true};
 }
 const intent=await read(paths.intent);
 if(intent)verifyRecord(intent,e);
 else{required(archiveBytes===null,'claim archived without durable intent');
  await durable(paths.intent,{...retireRecord(e),state:'validated'});
  await afterPhase('intent');
 }
 if(!archiveBytes){
  const current=await readFile(paths.claim).catch(err=>{
   if((err as NodeJS.ErrnoException).code==='ENOENT')return null;throw err
  });
  required(current&&sha256(current)===e.claimSha256,'claim missing or changed before archive');
  await rename(paths.claim,paths.archive);
  const dir=await open(dirname(paths.archive),'r');try{await dir.sync()}finally{await dir.close()}
  await afterPhase('archive');
 }else required(sha256(archiveBytes)===e.claimSha256,'archived claim changed');
 required(sha256(await readFile(paths.archive))===e.claimSha256,'archived bytes changed');
 await durable(paths.receipt,{...retireRecord(e),state:'retired'});
 await afterPhase('receipt');
 return{state:'retired',recovered:Boolean(existingLock)};
}
