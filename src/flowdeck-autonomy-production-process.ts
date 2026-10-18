/** Durable, process-exact predecessor evidence. A missing witness is NOT a stopped sender.
 * Intended for dedicated send-capable child processes; in-process actors must
 * additionally prove SDK completion and every outstanding browser call.
 */
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {open,readFile,lstat,realpath,mkdir} from 'node:fs/promises';
import {dirname,isAbsolute,resolve} from 'node:path';

const exec=promisify(execFile);
const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
export type SenderRole='worker'|'follower';
export interface SenderProcessIdentity {workflowId:string;runId:string;role:SenderRole;pid:number}
export type ProcessObservation =
 | {state:'alive';startedAt:string;commandSha256:string}
 | {state:'gone'} | {state:'unknown'};
export type ProcessObserver=(pid:number)=>Promise<ProcessObservation>;
interface Witness extends SenderProcessIdentity {
 schema:'flowdeck.sender-process-witness/v1';startedAt:string;commandSha256:string;
}
const fields=['schema','workflowId','runId','role','pid','startedAt','commandSha256'];
function validate(i:SenderProcessIdentity){
 if(!i||!idPattern.test(i.workflowId)||!idPattern.test(i.runId)||
    !['worker','follower'].includes(i.role)||!Number.isSafeInteger(i.pid)||i.pid<2)
  throw Error('sender process witness identity invalid');
}
function parseWitness(value:unknown):Witness {
 const w=value as Witness;
 if(!w||typeof w!=='object'||Array.isArray(w)||JSON.stringify(Object.keys(w).sort())!==JSON.stringify([...fields].sort())||
    w.schema!=='flowdeck.sender-process-witness/v1')throw Error('sender process witness malformed');
 validate(w);
 if(typeof w.startedAt!=='string'||!w.startedAt||
   typeof w.commandSha256!=='string'||!/^[a-f0-9]{64}$/.test(w.commandSha256))
   throw Error('sender process witness seal invalid');
 return w;
}
function same(a:SenderProcessIdentity,b:SenderProcessIdentity){
 return a.workflowId===b.workflowId&&a.runId===b.runId&&a.role===b.role&&a.pid===b.pid;
}
/** macOS process observation. Never infers absence from a failed ps command. */
export async function observeDarwinProcess(pid:number):Promise<ProcessObservation>{
 if(process.platform!=='darwin'||!Number.isSafeInteger(pid)||pid<2)return{state:'unknown'};
 try {
  const {stdout}=await exec('/bin/ps',['-p',String(pid),'-o','lstart=','-o','command='],{timeout:2000,maxBuffer:16_384});
  const match=stdout.trim().match(/^(.{24})\s+([\s\S]+)$/);
  if(!match||!match[2].trim())return{state:'unknown'};
  return{state:'alive',startedAt:match[1].trim(),commandSha256:sha(match[2].trim())};
 }catch {
  // Only ESRCH proves nonexistence; permission errors and transient ps
  // failures are unknown, never proof of shutdown.
  try{process.kill(pid,0);return{state:'unknown'};}
  catch(error:any){return error?.code==='ESRCH'?{state:'gone'}:{state:'unknown'};}
 }
}
export function createSenderProcessFence(path:string,observer:ProcessObserver=observeDarwinProcess){
 if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||typeof observer!=='function')
  throw Error('sender witness requires an absolute path and observer');
 async function read():Promise<Witness>{
  const st=await lstat(path);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||await realpath(path)!==path)
   throw Error('sender witness path changed or is unsafe');
  return parseWitness(JSON.parse(await readFile(path,'utf8')));
 }
 async function ensure(input:SenderProcessIdentity):Promise<Witness>{
  validate(input);
  const witness=await read();
  if(!same(witness,input))throw Error('sender witness execution/process identity mismatch');
  return witness;
 }
 return {
  /** Register an observed live PID exactly once, before allowing it to send.
   * Never overwrites/adopts an unrelated predecessor after a restart.
   */
  async registerExact(input:SenderProcessIdentity){
   validate(input);
   const seen=await observer(input.pid);
   if(seen.state!=='alive'||!seen.startedAt||!/^[a-f0-9]{64}$/.test(seen.commandSha256))
    throw Error('sender process could not be independently identified before activation');
   const row:Witness={schema:'flowdeck.sender-process-witness/v1',...input,
    startedAt:seen.startedAt,commandSha256:seen.commandSha256};
   await mkdir(dirname(path),{recursive:true,mode:0o700});
   let handle;
   try{
    handle=await open(path,'wx',0o600);
    await handle.writeFile(JSON.stringify(row)+'\n');
    await handle.sync();
    await handle.close();handle=undefined;
    const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}
   }catch(error:any){
    if(handle)await handle.close();
    if(error?.code!=='EEXIST')throw error;
    const prior=await ensure(input);
    if(prior.startedAt!==row.startedAt||prior.commandSha256!==row.commandSha256)
     throw Error('existing sender witness differs from observed process: quarantine');
   }
  },
  async inspectExact(input:SenderProcessIdentity):Promise<'running'|'stopped'|'unresponsive'>{
   const row=await ensure(input);
   const observed=await observer(row.pid);
   if(observed.state==='gone')return 'stopped';
   if(observed.state==='alive'&&observed.startedAt===row.startedAt&&observed.commandSha256===row.commandSha256)return 'running';
   return 'unresponsive'; // PID reuse, clock/command change or unknown visibility
  },
  async assertStoppedExact(input:SenderProcessIdentity){
   const status=await this.inspectExact(input);
   if(status!=='stopped')throw Error('predecessor_sender_termination_unproven:'+status);
  }
 };
}
