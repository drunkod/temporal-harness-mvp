/** Autonomous first-send transaction core. Supports fake-browser fault injection.
 * No dependency here is a production browser or worker. External effects require
 * an explicit injected adapter and a previously validated standing policy.
 */
import{mkdir,open,readFile,readdir}from'node:fs/promises';
import{resolve,join}from'node:path';
import{sha256}from'./flowdeck-autonomy-policy.js';

export interface InitialDispatchScope{
 campaignId:string;runId:string;projectId:string;taskId:string;
 tabId:string;projectUrl:string;worktree:string;promptHash:string;policyDigest:string;
}
export type InitialDispatchPhase='claimed'|'staged'|'click_attempted'|'submitted'|'reconciled';
export interface InitialAdapter {
 stage:(scope:InitialDispatchScope)=>Promise<void>;
 verify: (scope:InitialDispatchScope)=>Promise<boolean>;
 checkFence:(scope:InitialDispatchScope)=>Promise<void>;
 click:(scope:InitialDispatchScope)=>Promise<unknown>;
}
const phases:InitialDispatchPhase[]=['claimed','staged','click_attempted','submitted','reconciled'];
const exact=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const valid=(s:InitialDispatchScope)=>{
 if(!s||!s.campaignId||!s.runId||!s.projectId||!s.taskId||
 !/^[A-Z0-9]{16,128}$/i.test(s.tabId)||!s.worktree.startsWith('/')||
 !s.projectUrl.startsWith('https://chatgpt.com/g/')||
 !/^[a-f0-9]{64}$/.test(s.promptHash)||!/^[a-f0-9]{64}$/.test(s.policyDigest))
 throw Error('initial dispatch missing immutable authorized identity');
};
export function initialDispatchKey(s:InitialDispatchScope){
 valid(s);return sha256(JSON.stringify([s.campaignId,s.runId,s.projectId,s.taskId]));
}
export function createAutonomousInitialJournal(base:string){
 const root=resolve(base);
 const path=(s:InitialDispatchScope,phase:InitialDispatchPhase)=>join(root,initialDispatchKey(s)+'-'+phase+'.json');
 async function writeOnce(s:InitialDispatchScope,phase:InitialDispatchPhase){
  const fd=await open(path(s,phase),'wx',0o600);
  try{await fd.writeFile(JSON.stringify({schema:'flowdeck.autonomous-dispatch/v1',phase,scope:s})+'\n');await fd.sync()}
  finally{await fd.close()}
  const dir=await open(root,'r');try{await dir.sync()}finally{await dir.close()}
 }
 async function current(s:InitialDispatchScope){
  valid(s);
  const list=await readdir(root).catch(e=>{if(e.code==='ENOENT')return [];throw e});
  const matching=list.filter(n=>n.startsWith(initialDispatchKey(s)+'-'));
  let state:InitialDispatchPhase|null=null;
  for(const phase of phases){
   const filename=initialDispatchKey(s)+'-'+phase+'.json';
   if(!matching.includes(filename))break;
   const content=JSON.parse(await readFile(join(root,filename),'utf8'));
   if(content.schema!=='flowdeck.autonomous-dispatch/v1'||content.phase!==phase||!exact(content.scope,s))
    throw Error('initial dispatch journal changed: quarantine');
   state=phase;
  }
  if(matching.length!==stateIndexCount(state))
   throw Error('initial dispatch journal has missing or extra phases: quarantine');
  return state;
 }
 const stateIndexCount=(s:InitialDispatchPhase|null)=>s===null?0:phases.indexOf(s)+1;
 async function reserve(s:InitialDispatchScope){
  valid(s);await mkdir(root,{recursive:true,mode:0o700});
  if(await current(s)!==null)throw Error('dispatch already reserved; never restart');
  await writeOnce(s,'claimed');
 }
 async function next(s:InitialDispatchScope,phase:Exclude<InitialDispatchPhase,'claimed'>){
  const currentPhase=await current(s),idx=phases.indexOf(phase);
  if(currentPhase!==phases[idx-1])throw Error('initial dispatch phase advanced, missing or ambiguous: quarantine');
  await writeOnce(s,phase);
 }
 return {reserve,next,current,path};
}
/** NOT safe to call automatically after a controller crash: callers must first
 * inspect the durable phase and reconcile. Never invoke twice for a dispatch.
 */
export async function submitAutonomousInitialOnce(
 journal:ReturnType<typeof createAutonomousInitialJournal>,scope:InitialDispatchScope,
 adapter:InitialAdapter):Promise<{status:'submitted_unreconciled'}>{
 await journal.reserve(scope);
 await adapter.checkFence(scope);
 await adapter.stage(scope);
 await journal.next(scope,'staged');
 await adapter.checkFence(scope);
 if(!await adapter.verify(scope))
  throw Error('initial staged composer or identity mismatch: quarantine');
 await adapter.checkFence(scope);
 // This durable marker is irreversible. Crash here => uncertain; NO second click.
 await journal.next(scope,'click_attempted');
 await adapter.checkFence(scope);
 await adapter.click(scope);
 await journal.next(scope,'submitted');
 return {status:'submitted_unreconciled'};
}
export async function reconcileAutonomousInitial(
 journal:ReturnType<typeof createAutonomousInitialJournal>,scope:InitialDispatchScope,
 evidence:{matchedFirstTurn:boolean;reportedSession:boolean;conflict:boolean}){
 if(evidence.conflict)throw Error('conflicting initial message: quarantine');
 if(await journal.current(scope)!=='submitted')throw Error('initial click not durably submitted: quarantine');
 if(!evidence.matchedFirstTurn||!evidence.reportedSession)
  return{status:'pending' as const};
 await journal.next(scope,'reconciled');
 return{status:'reconciled' as const};
}
