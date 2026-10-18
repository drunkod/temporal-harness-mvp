/** Durable, independently readable provenance for an autonomous send. */
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { composerPayloadFor, normalizeComposerText } from './sashai-dispatch-evidence.js';

export type AutonomousSendKind = 'initial_p1' | 'continue_p1' | 'initial_p2';
export type SendPhase = 'staged' | 'click_attempted' | 'submitted';
type JournalPhase = SendPhase | 'reconciled';
export interface SendIntentV1 {
 schema: 'flowdeck.send-intent/v1'; dispatchId: string; workflowId: string; runId: string;
 campaignId: string; campaignRunId: string; projectId: string; taskId: string; kind: AutonomousSendKind;
 policyDigest: string; reservationId: string; promptHash: string; tabId: string; projectUrl: string;
 priorChatUrl: string | null; priorUserTurns: number;
}
export interface SendObservationV1 {
 schema: 'flowdeck.send-observation/v1'; dispatchId: string; intentSha256: string;
 observedPromptHash: string; tabId: string; chatUrl: string; userTurnId: string; observedUserTurns: number;
}
export interface ReconciledSendV1 {
 schema: 'flowdeck.reconciled-send/v1'; dispatchId: string; intentSha256: string;
 observationSha256: string; phaseRecordsSha256: string;
}
export interface VerifiedSendProvenance { intent: SendIntentV1; observation: SendObservationV1; receipt: ReconciledSendV1 }

const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const digest=/^[a-f0-9]{64}$/;
const identifier=/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const kinds:AutonomousSendKind[]=['initial_p1','continue_p1','initial_p2'];
const phases:JournalPhase[]=['staged','click_attempted','submitted','reconciled'];
const keys=(v:unknown,expected:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 JSON.stringify(Object.keys(v).sort())===JSON.stringify([...expected].sort());
const canonicalProject=(v:string)=>{
 try{const u=new URL(v);return u.protocol==='https:'&&u.hostname==='chatgpt.com'&&u.port===''&&u.search===''&&u.hash===''&&
  /^\/g\/[A-Za-z0-9_-]+\/project$/.test(u.pathname)&&u.pathname===v.slice('https://chatgpt.com'.length)?v:null}catch{return null}
};
const projectForChat=(v:string)=>{
 try{const u=new URL(v);const m=u.pathname.match(/^\/g\/([A-Za-z0-9_-]+)\/c\/([A-Za-z0-9_-]+)$/);
  if(u.protocol!=='https:'||u.hostname!=='chatgpt.com'||u.port||u.search||u.hash||!m||u.pathname!==v.slice('https://chatgpt.com'.length))return null;
  return {project:`https://chatgpt.com/g/${m[1]}/project`,chat:v};
 }catch{return null}
};
function validateIntent(v:any):asserts v is SendIntentV1 {
 const fields=['schema','dispatchId','workflowId','runId','campaignId','campaignRunId','projectId','taskId','kind','policyDigest','reservationId','promptHash','tabId','projectUrl','priorChatUrl','priorUserTurns'];
 if(!keys(v,fields)||v.schema!=='flowdeck.send-intent/v1'||!identifier.test(v.dispatchId)||
  ![v.workflowId,v.runId,v.campaignId,v.campaignRunId,v.projectId,v.taskId,v.reservationId].every(x=>typeof x==='string'&&identifier.test(x))||
  !kinds.includes(v.kind)||!digest.test(v.policyDigest)||!digest.test(v.promptHash)||
  !/^[A-Z0-9]{16,128}$/i.test(v.tabId)||!canonicalProject(v.projectUrl)||
  !Number.isSafeInteger(v.priorUserTurns)||v.priorUserTurns<0||
  (v.kind==='continue_p1'?(!projectForChat(v.priorChatUrl)||projectForChat(v.priorChatUrl)!.project!==v.projectUrl):
   v.priorChatUrl!==null||(v.kind==='initial_p2'&&v.priorUserTurns!==0)))
  throw Error('send intent schema/identity invalid: quarantine');
}
function validateObservation(v:any):asserts v is SendObservationV1 {
 if(!keys(v,['schema','dispatchId','intentSha256','observedPromptHash','tabId','chatUrl','userTurnId','observedUserTurns'])||
  v.schema!=='flowdeck.send-observation/v1'||!identifier.test(v.dispatchId)||!digest.test(v.intentSha256)||
  !digest.test(v.observedPromptHash)||!/^[A-Z0-9]{16,128}$/i.test(v.tabId)||
  typeof v.userTurnId!=='string'||!v.userTurnId||v.userTurnId.length>512||!projectForChat(v.chatUrl)||
  !Number.isSafeInteger(v.observedUserTurns)||v.observedUserTurns<1)
  throw Error('send observation schema/identity invalid: quarantine');
}
function validateReceipt(v:any):asserts v is ReconciledSendV1 {
 if(!keys(v,['schema','dispatchId','intentSha256','observationSha256','phaseRecordsSha256'])||v.schema!=='flowdeck.reconciled-send/v1'||
  !identifier.test(v.dispatchId)||![v.intentSha256,v.observationSha256,v.phaseRecordsSha256].every(x=>digest.test(x)))
  throw Error('reconciled send receipt schema invalid: quarantine');
}
const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)+'\n','utf8');
/** Seal the same normalized connector-inclusive payload that the browser sees. */
export const autonomousSendPromptHash=(prompt:string)=>hash(normalizeComposerText(composerPayloadFor(prompt)));

/**
 * Every record is exclusive, fsynced and followed by a directory sync. A failed
 * write is deliberately left in place for readExact() to quarantine.
 */
export function createAutonomySendProvenanceStore(rootPath:string){
 const root=resolve(rootPath);
 const file=(dispatchId:string,name:string)=>join(root,`${dispatchId}.${name}.json`);
 async function ensure(){await mkdir(root,{recursive:true,mode:0o700});const st=await lstat(root);if(st.isSymbolicLink()||!st.isDirectory())throw Error('send provenance root is not a real directory: quarantine');}
 async function durable(path:string,value:unknown){
  const fd=await open(path,'wx',0o600);try{await fd.writeFile(encode(value));await fd.sync()}finally{await fd.close()}
  const dir=await open(root,'r');try{await dir.sync()}finally{await dir.close()}
 }
 async function raw(path:string){const st=await lstat(path);if(st.isSymbolicLink()||!st.isFile())throw Error('send provenance record is not a regular file: quarantine');return readFile(path)}
 async function readJson(path:string){const bytes=await raw(path);let value:any;try{value=JSON.parse(bytes.toString('utf8'))}catch{throw Error('partial/unreadable send provenance record: quarantine')};return{value,bytes};}
 async function putIntent(intent:SendIntentV1){validateIntent(intent);await ensure();await durable(file(intent.dispatchId,'intent'),intent);}
 async function recordPhase(dispatchId:string,phase:SendPhase){
  if(!identifier.test(dispatchId)||!phases.includes(phase))throw Error('invalid send phase identity');
  const current=await readExact(dispatchId,false);const index=phases.indexOf(phase);
  if(current.phases.length!==index)throw Error('send phase out of order, duplicate, or ambiguous: quarantine');
  await durable(file(dispatchId,phase),{schema:'flowdeck.send-phase/v1',dispatchId,phase,intentSha256:current.intentSha256});
 }
 async function putObservation(obs:SendObservationV1){
  validateObservation(obs);const current=await readExact(obs.dispatchId,false);
  if(current.phases.at(-1)?.phase!=='click_attempted'||obs.intentSha256!==current.intentSha256)throw Error('observation lacks matching click-attempted intent: quarantine');
  await durable(file(obs.dispatchId,'observation'),obs);
 }
 async function reconcile(dispatchId:string){
  const current=await readExact(dispatchId,false);
  if(current.phases.at(-1)?.phase!=='submitted'||!current.observation)throw Error('send cannot reconcile without submitted phase and observation: quarantine');
  verifyLinked(current.intent,current.intentBytes,current.observation,current.observationBytes,current.phases,current.phaseBytes);
  await durable(file(dispatchId,'reconciled'),{schema:'flowdeck.send-phase/v1',dispatchId,phase:'reconciled',intentSha256:current.intentSha256});
  const complete=await readExact(dispatchId,false);
  await durable(file(dispatchId,'receipt'),{schema:'flowdeck.reconciled-send/v1',dispatchId,
   intentSha256:current.intentSha256,observationSha256:hash(current.observationBytes),phaseRecordsSha256:phaseDigest(complete.phaseBytes)} satisfies ReconciledSendV1);
  return readExact(dispatchId);
 }
 async function readExact(dispatchId:string,requireReconciled=true):Promise<any>{
  if(!identifier.test(dispatchId))throw Error('invalid dispatch ID');
  await ensure();const names=await readdir(root);
  const prefix=dispatchId+'.';const relevant=names.filter(n=>n.startsWith(prefix));
  const allowed=new Set(['intent','observation','receipt',...phases].map(x=>`${dispatchId}.${x}.json`));
  if(relevant.some(n=>!allowed.has(n))||[...allowed].some(n=>relevant.filter(x=>x===n).length>1))throw Error('duplicate or unknown dispatch records: quarantine');
  const intentPath=file(dispatchId,'intent');let intentRecord:{value:any;bytes:Buffer};
  try{intentRecord=await readJson(intentPath)}catch(e:any){if(e?.code==='ENOENT')throw Error('send intent absent: quarantine');throw e}
  const {value:intent,bytes:intentBytes}=intentRecord;validateIntent(intent);
  if(intent.dispatchId!==dispatchId)throw Error('intent dispatch ID mismatch: quarantine');
  const intentSha256=hash(intentBytes);const phaseRecords:any[]=[],phaseBytes:Buffer[]=[];
  for(let i=0;i<phases.length;i++){
   const path=file(dispatchId,phases[i]);let bytes:Buffer;
   try{bytes=await raw(path)}catch(e:any){if(e?.code==='ENOENT')break;throw e}
   const value=JSON.parse(bytes.toString('utf8'));
   if(!keys(value,['schema','dispatchId','phase','intentSha256'])||value.schema!=='flowdeck.send-phase/v1'||value.dispatchId!==dispatchId||
    value.phase!==phases[i]||value.intentSha256!==intentSha256)throw Error('send phase linkage mismatch: quarantine');
   phaseRecords.push(value);phaseBytes.push(bytes);
  }
  const phaseNames=relevant.filter(n=>phases.some(p=>n===`${dispatchId}.${p}.json`));
  if(phaseNames.length!==phaseRecords.length)throw Error('send phase journal has a gap or duplicate: quarantine');
  let observation:any=null,observationBytes:Buffer|null=null;
  try{const x=await readJson(file(dispatchId,'observation'));observation=x.value;observationBytes=x.bytes;validateObservation(observation)}catch(e:any){if(e?.code!=='ENOENT')throw e}
  let receipt:any=null;
  try{receipt=(await readJson(file(dispatchId,'receipt'))).value;validateReceipt(receipt)}catch(e:any){if(e?.code!=='ENOENT')throw e}
  if(requireReconciled&&!receipt)throw Error('reconciled send receipt absent: quarantine');
  if(receipt){
   if(!observation||!observationBytes||phaseRecords.length!==phases.length||phaseRecords.at(-1)?.phase!=='reconciled')throw Error('receipt lacks full observation and phase journal: quarantine');
   verifyLinked(intent,intentBytes,observation,observationBytes,phaseRecords,phaseBytes);
   if(receipt.dispatchId!==dispatchId||receipt.intentSha256!==intentSha256||receipt.observationSha256!==hash(observationBytes)||receipt.phaseRecordsSha256!==phaseDigest(phaseBytes))
    throw Error('reconciled receipt hash linkage mismatch: quarantine');
  }
  return{intent,observation,receipt,intentBytes,intentSha256,observationBytes,phases:phaseRecords,phaseBytes};
 }
 return{root,putIntent,recordPhase,putObservation,reconcile,readExact:async(id:string)=>readExact(id,true)};
}
function phaseDigest(bytes:Buffer[]){return hash(Buffer.concat(bytes.map(b=>Buffer.concat([Buffer.from(String(b.length)+':'),b]))));}
function verifyLinked(intent:SendIntentV1,intentBytes:Buffer,obs:SendObservationV1,obsBytes:Buffer,phaseRecords:any[],phaseBytes:Buffer[]){
 if(hash(intentBytes)!==phaseRecords[0]?.intentSha256||obs.dispatchId!==intent.dispatchId||obs.intentSha256!==hash(intentBytes)||
  obs.observedPromptHash!==intent.promptHash||obs.tabId!==intent.tabId||obs.observedUserTurns!==intent.priorUserTurns+1||
  (phaseRecords.length!==3&&phaseRecords.length!==phases.length)||phaseRecords.some((x,i)=>x.phase!==phases[i])||phaseBytes.length!==phaseRecords.length)
  throw Error('send intent/observation/phase linkage mismatch: quarantine');
 const observed=projectForChat(obs.chatUrl);
 if(!observed||observed.project!==intent.projectUrl)throw Error('observed chat is outside canonical Project: quarantine');
 if(intent.kind==='continue_p1'&&obs.chatUrl!==intent.priorChatUrl)throw Error('continuation changed its prior chat: quarantine');
 // Enforce that promptHash was produced from the shared connector-inclusive composer payload.
 if(!digest.test(intent.promptHash)||!obsBytes.length)throw Error('invalid linked prompt evidence: quarantine');
}
