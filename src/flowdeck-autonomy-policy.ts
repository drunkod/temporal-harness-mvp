/** Flowdeck autonomous v1: fail-closed standing authorization, independent of attended history.
 * This module has NO browser, Temporal, network, or file side effects.
 */
import {createHash} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import type {SupervisorProject} from './flowdeck-projects.js';

export interface AutonomyPolicyV1 {
 schema:'flowdeck.autonomy-policy/v1';
 mode:'automatic-initial-send';
 interactive:false;
 environment:'local-live'|'synthetic';
 profile:'helium-profile-4';
 taskSource:'approved-active-plan';
 projectId:string;
 projectUrl:string;
 ownerId:string;
 deviceId:string;
 worktree:string;
 allowedRoot:string;
 planSha256:string;
 enabledTaskIds:[string,string];
 instructionHashes:[string,string];
 campaignId:string;
 validFrom:string;
 validUntil:string;
 maxTasksPerRun:2;
 maxContinuationsPerTask:1;
 p2Continuations:0;
 maxSubmissionsPerRun:3;
 maxCampaignRuns:2;
 maxCampaignSubmissions:6;
 maxRunDurationMinutes:60;
 automaticSuccessfulCloseout:true;
 uncertainSend:'quarantine';
 identityConflict:'quarantine';
 reviewRequiredBeforeDependentTask:true;
}
const policyKeys=[
 'schema','mode','interactive','environment','profile','taskSource','projectId',
 'projectUrl','ownerId','deviceId','worktree','allowedRoot','planSha256',
 'enabledTaskIds','instructionHashes','campaignId','validFrom','validUntil',
 'maxTasksPerRun','maxContinuationsPerTask','p2Continuations',
 'maxSubmissionsPerRun','maxCampaignRuns','maxCampaignSubmissions',
 'maxRunDurationMinutes','automaticSuccessfulCloseout','uncertainSend',
 'identityConflict','reviewRequiredBeforeDependentTask'
].sort();
export const sha256=(content:string|Buffer)=>createHash('sha256').update(content).digest('hex');
const digest=/^[0-9a-f]{64}$/;
const identifier=/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,119}$/;
const uuid=/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$/;
export function validateAutonomyPolicy(input:unknown, project?:SupervisorProject, planBytes?:Buffer|string, now=Date.now()):AutonomyPolicyV1{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('blocked_policy: expected policy object');
 const p=input as Record<string,unknown>;
 if(JSON.stringify(Object.keys(p).sort())!==JSON.stringify(policyKeys))
  throw Error('blocked_policy: missing or unknown standing-policy keys');
 if(p.schema!=='flowdeck.autonomy-policy/v1'||p.mode!=='automatic-initial-send'||
  p.interactive!==false||!['local-live','synthetic'].includes(String(p.environment))||
  p.profile!=='helium-profile-4'||p.taskSource!=='approved-active-plan'||
  p.maxTasksPerRun!==2||p.maxContinuationsPerTask!==1||p.p2Continuations!==0||
  p.maxSubmissionsPerRun!==3||p.maxCampaignRuns!==2||p.maxCampaignSubmissions!==6||
  p.maxRunDurationMinutes!==60||p.automaticSuccessfulCloseout!==true||
  p.uncertainSend!=='quarantine'||p.identityConflict!=='quarantine'||
  p.reviewRequiredBeforeDependentTask!==true)
  throw Error('blocked_policy: unsupported limits or autonomy mode');
 if(![p.projectId,p.ownerId,p.deviceId,p.campaignId].every(x=>typeof x==='string'&&uuid.test(x)))
  throw Error('blocked_policy: missing project, owner, device or campaign identity');
 if(p.projectId==='sashai-fresh-attended-20261018-08')
  throw Error('blocked_policy: historical attended run cannot be reused');
 if(typeof p.projectUrl!=='string'||!p.projectUrl.startsWith('https://chatgpt.com/g/')||
  typeof p.worktree!=='string'||typeof p.allowedRoot!=='string'||
  !isAbsolute(p.worktree)||!isAbsolute(p.allowedRoot)||
  resolve(p.worktree)!==p.worktree||resolve(p.allowedRoot)!==p.allowedRoot||
  !(p.worktree===p.allowedRoot||p.worktree.startsWith(p.allowedRoot+'/')))
  throw Error('blocked_policy: invalid Project or canonical worktree authority');
 if(!digest.test(String(p.planSha256)))throw Error('blocked_policy: plan digest required');
 if(!Array.isArray(p.enabledTaskIds)||p.enabledTaskIds.length!==2||
  !p.enabledTaskIds.every(x=>typeof x==='string'&&identifier.test(x))||
  p.enabledTaskIds[0]===p.enabledTaskIds[1]||
  !Array.isArray(p.instructionHashes)||p.instructionHashes.length!==2||
  !p.instructionHashes.every(x=>typeof x==='string'&&digest.test(x)))
  throw Error('blocked_policy: invalid task IDs or instruction seals');
 if(typeof p.validFrom!=='string'||typeof p.validUntil!=='string'||
  !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(p.validFrom)||
  !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(p.validUntil)){
  throw Error('blocked_policy: explicit validity interval required');
 }
 const start=Date.parse(p.validFrom),end=Date.parse(p.validUntil);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>7*86400_000||
  now<start||now>end)
  throw Error('blocked_policy: expired, future or overbroad validity');
 if(project){
  if(p.projectId!==project.id||p.ownerId!==project.ownerId||
   p.deviceId!==project.deviceId||p.projectUrl!==project.projectUrl||
   p.worktree!==resolve(project.repo)||project.tasks.length!==2||
   (p.enabledTaskIds as string[])[0]!==project.initialTaskId||
   project.tasks.some((t,i)=>t.id!==(p.enabledTaskIds as string[])[i]||
    sha256(t.instruction)!==(p.instructionHashes as string[])[i]||
    t.requiresReviewBeforeNext===true||(t.dependsOn?.length??0)!==0))
   throw Error('blocked_policy: enrolled task authority mismatch');
 }
 if(planBytes!==undefined&&sha256(planBytes)!==p.planSha256)
  throw Error('blocked_policy: approved active plan changed');
 return p as unknown as AutonomyPolicyV1;
}
export function autonomyPolicyDigest(p:AutonomyPolicyV1):string{
 return sha256(JSON.stringify(Object.fromEntries(Object.entries(p).sort(([a],[b])=>a.localeCompare(b)))));
}
export interface AutonomousUsage{initialP1:number;p1Continuations:number;initialP2:number;total:number}
export const emptyAutonomousUsage=():AutonomousUsage=>({initialP1:0,p1Continuations:0,initialP2:0,total:0});
export type AutonomousDispatch='initial_p1'|'continue_p1'|'initial_p2';
export function reserveAutonomousSend(p:AutonomyPolicyV1,usage:AutonomousUsage,kind:AutonomousDispatch):
 {allowed:true;usage:AutonomousUsage}|{allowed:false;reason:string}{
 if(!usage||!Object.values(usage).every(n=>Number.isSafeInteger(n)&&n>=0)||
  usage.total!==usage.initialP1+usage.p1Continuations+usage.initialP2||
  usage.initialP1>1||usage.p1Continuations>1||usage.initialP2>1)
  return {allowed:false,reason:'invalid_usage'};
 const sequence:AutonomousDispatch[]=['initial_p1','continue_p1','initial_p2'];
 if(usage.total>=p.maxSubmissionsPerRun)return {allowed:false,reason:'run_budget_exhausted'};
 if(sequence[usage.total]!==kind)return {allowed:false,reason:'dispatch_sequence_invalid'};
 const k=kind==='initial_p1'?'initialP1':kind==='continue_p1'?'p1Continuations':'initialP2';
 return {allowed:true,usage:{...usage,[k]:usage[k]+1,total:usage.total+1}};
}
export interface AutonomousEvidence{
 policyValid:boolean;scopeOwned:boolean;conflict:boolean;
 previouslyAttempted:boolean;submissionReconciled:boolean;
 observationComplete:boolean;deadlineExceeded:boolean;remainingReservations:number;
}
export type AutonomousDecision={action:'advance'|'submit_once'|'observe'}|{action:'blocked';reason:string};
export function decideAutonomousDispatch(e:AutonomousEvidence):AutonomousDecision{
 if(!e.policyValid||!e.scopeOwned)return{action:'blocked',reason:'authority_or_scope_invalid'};
 if(e.conflict)return{action:'blocked',reason:'identity_or_prompt_conflict'};
 if(e.previouslyAttempted){
  if(e.submissionReconciled)return{action:'advance'};
  return e.deadlineExceeded?{action:'blocked',reason:'submission_unresolved_no_resend'}:{action:'observe'};
 }
 if(e.submissionReconciled)return{action:'blocked',reason:'inconsistent_dispatch_evidence'};
 if(e.deadlineExceeded)return{action:'blocked',reason:'deadline_exceeded'};
 if(!Number.isSafeInteger(e.remainingReservations)||e.remainingReservations<=0)
  return{action:'blocked',reason:'budget_exhausted_or_invalid'};
 if(!e.observationComplete)return{action:'observe'};
 return{action:'submit_once'};
}
