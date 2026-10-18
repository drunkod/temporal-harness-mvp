/** Strict, one-time initial human Send binding. This module never operates the browser. */
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {composerPayloadFor} from './sashai-dispatch-evidence.js';
import type {SupervisorProject,ApprovedTask} from './flowdeck-projects.js';

export type PreparedManualStart={
 schema:'flowdeck.prepared-manual-start/v1';
 projectId:string;ownerId:string;deviceId:string;projectUrl:string;worktree:string;
 taskId:string;tabId:string;expectedPromptHash:string;
 originalTargetIds:string[];hydratedEmpty:true;readyAt:string;
};
export type FirstMessageEvidence={tabId:string;chatUrl:string;projectUrl:string;
 taskId:string|null;worktree:string|null;userTurns:number;firstUserHash:string|null;
 observedUserTurns:number};
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
// ChatGPT adds the selected Probe RemoteMCP2 mention before the approved task.
// Seal the actual full composer payload, consistent with supervised sends.
export const approvedFirstPromptHash=(instruction:string)=>digest(composerPayloadFor(instruction));
export function manualStartPath(base:string,projectId:string){
 if(!/^sashai-fresh-attended-[0-9]{8}-[0-9]{2}$/.test(projectId))
  throw Error('Manual-start gate is only for fresh attended projects');
 return join(resolve(base),'.state/flowdeck-supervisor','manual-start-'+digest(projectId)+'.json');
}
export function validatePreparedManualStart(p:SupervisorProject,t:ApprovedTask,record:unknown):PreparedManualStart{
 const r=record as Partial<PreparedManualStart>|null;
 if(!r||r.schema!=='flowdeck.prepared-manual-start/v1'||r.projectId!==p.id||
  r.ownerId!==p.ownerId||r.deviceId!==p.deviceId||r.projectUrl!==p.projectUrl||
  r.worktree!==p.repo||r.taskId!==t.id||t.id!==p.initialTaskId||
  !/^[A-Z0-9]{16,128}$/i.test(r.tabId??'')||r.hydratedEmpty!==true||
  r.expectedPromptHash!==approvedFirstPromptHash(t.instruction)||
  !Array.isArray(r.originalTargetIds)||r.originalTargetIds.length<1||
  new Set(r.originalTargetIds).size!==r.originalTargetIds.length||
  r.originalTargetIds.includes(r.tabId!)||
  !Number.isFinite(Date.parse(r.readyAt??'')))
  throw Error('Initial manual-start preparation absent, wrong, or changed');
 return r as PreparedManualStart;
}
export async function readPreparedManualStart(base:string,p:SupervisorProject,t:ApprovedTask){
 let record:unknown;
 try{record=JSON.parse(await readFile(manualStartPath(base,p.id),'utf8'))}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')
   throw Error('Fresh initial Send has no prepared distinct empty Project tab');
  throw e}
 return validatePreparedManualStart(p,t,record);
}
function projectEquals(a:string,b:string){
 try{
  const key=(v:string)=>{const u=new URL(v);return u.origin+u.pathname.replace(/\/project\/?$/,'').replace(/-dr-sashai$/i,'')};
  return key(a)===key(b);
 }catch{return false}
}
export function inspectPreparedFirstMessage(prep:PreparedManualStart,p:SupervisorProject,t:ApprovedTask,
 e:FirstMessageEvidence):'pending'|'matched'{
 if(e.tabId!==prep.tabId||!e.chatUrl.startsWith('https://chatgpt.com/')||
    !/^\/g\/g-p-6ab28bdd7fbc8191b581316ff09da79d(?:-[a-z0-9-]+)?\/c\/[0-9a-f-]{36}$/i.test(new URL(e.chatUrl).pathname)||
    (e.projectUrl!==''&&!projectEquals(e.projectUrl,p.projectUrl)))
   throw Error('Prepared manual-start destination/tab/Project conflict');
 if(e.userTurns>1||e.observedUserTurns>1)
   throw Error('Prepared manual-start chat has extra user turns');
 if(e.taskId!==null&&e.taskId!==t.id||
   e.worktree!==null&&resolve(e.worktree)!==resolve(p.repo))
   throw Error('Prepared manual-start first task/worktree conflict');
 if(e.userTurns===0||e.observedUserTurns===0||e.taskId===null||
   e.worktree===null||!e.projectUrl||!e.firstUserHash)
   return 'pending';
 if(e.userTurns!==1||e.observedUserTurns!==1||e.firstUserHash!==prep.expectedPromptHash)
   throw Error('Prepared manual-start first user message does not match approved prompt seal');
 return 'matched';
}
