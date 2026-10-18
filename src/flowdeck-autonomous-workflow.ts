import{condition,defineQuery,defineSignal,patched,proxyActivities,setHandler,workflowInfo}from'@temporalio/workflow';
import type{WorkEventV1}from'./flowdeck-work-events.js';
import type{AutonomyPolicyV1}from'./flowdeck-autonomy-policy.js';

/** New workflow type only. Never register this until its production activities
 * implement exact-send journals, policy/scope fencing, and proof-based closeout.
 * The successful historical attended workflow is deliberately unchanged.
 */
export interface AutonomousLifecycleInputV1 {
 schema:'flowdeck.autonomous-input/v1';
 projectId:string;
 campaignRunId:string;
 policy:AutonomyPolicyV1;
 policyDigest:string;
}
export interface AutonomousExecutionContext extends AutonomousLifecycleInputV1{
 workflowId:string;runId:string;
}
export interface AutonomousLifecycleResultV1{
 schema:'flowdeck.autonomous-result/v1';
 workflowId:string;runId:string;
 status:'blocked'|'completed';reason:string;submissions:number;
}
export type LifecycleVerdict={status:'blocked'|'pending'|'reconciled'|'submitted'|'reported'|'implementation_done'|'closed';reason?:string};
type Verdict=LifecycleVerdict;
export interface AutonomousLifecycleActivities {
 validateAndClaim(input:AutonomousExecutionContext):Promise<{valid:boolean;reason?:string}>;
 submitInitialP1(input:AutonomousExecutionContext):Promise<Verdict>;
 reconcileInitialP1(input:AutonomousExecutionContext):Promise<Verdict>;
 awaitP1Events(input:AutonomousExecutionContext):Promise<Verdict>;
 continueP1(input:AutonomousExecutionContext):Promise<Verdict>;
 reconcileContinuation(input:AutonomousExecutionContext):Promise<Verdict>;
 awaitP1Completion(input:AutonomousExecutionContext):Promise<Verdict>;
 submitP2(input:AutonomousExecutionContext):Promise<Verdict>;
 reconcileP2(input:AutonomousExecutionContext):Promise<Verdict>;
 awaitP2Completion(input:AutonomousExecutionContext):Promise<Verdict>;
 closeout(input:AutonomousExecutionContext):Promise<Verdict>;
}
const activities=proxyActivities<AutonomousLifecycleActivities>({
 startToCloseTimeout:'2 minutes',retry:{maximumAttempts:1},
});
export const autonomousWorkEvent=defineSignal<[WorkEventV1]>('flowdeckAutonomousWorkEventV1');
export const autonomousStatus=defineQuery<AutonomousLifecycleResultV1>('flowdeckAutonomousStatusV1');

export async function flowdeckAutonomousLifecycleV1(input:AutonomousLifecycleInputV1):Promise<AutonomousLifecycleResultV1>{
 const info=workflowInfo();
 const result:AutonomousLifecycleResultV1={schema:'flowdeck.autonomous-result/v1',
  workflowId:info.workflowId,runId:info.runId,status:'blocked',reason:'not_started',submissions:0};
 const signals:WorkEventV1[]=[],seen=new Set<string>();
 const signalBodies=new Map<string,string>();
 let signalRevision=0,signalConflict=false;
 setHandler(autonomousStatus,()=>({...result}));
 setHandler(autonomousWorkEvent,event=>{
  if(!event||event.schema!=='remote-mcp.work-event/v1'||event.source!=='remote-mcp-jazz'||
   event.ownerId!==input?.policy?.ownerId||event.deviceId!==input?.policy?.deviceId||
   !['work_started','work_reported'].includes(event.kind)||
   !event.eventId?.trim()||!event.workId?.trim()||!['event','snapshot'].includes(event.origin)||
   event.executionVerified!==false||event.backgroundProcesses!=='unknown'||
   event.timestampEvidence!=='recorded_in_source_transaction'||
   !Number.isFinite(Date.parse(event.startedAt))||!Number.isFinite(Date.parse(event.sourceCommittedAt))||
   (event.kind==='work_started'?
    event.revision!==1||event.completionEvidence!=='none'||event.outcome!==undefined||event.reportedAt!==undefined:
    event.revision!==2||event.completionEvidence!=='agent_report_only'||
    !['success','partial','failed'].includes(event.outcome??'')||
    typeof event.reportedAt!=='string'||!Number.isFinite(Date.parse(event.reportedAt))))return;
  const key=JSON.stringify([event.source,event.ownerId,event.deviceId,event.eventId]);
  const body=JSON.stringify(event);
  if(seen.has(key)){if(signalBodies.get(key)!==body)signalConflict=true;return}
  seen.add(key);signalBodies.set(key,body);signals.push(event);signalRevision++;
 });
 const block=(reason:string)=>{result.reason=reason.slice(0,150);return result};
 if(!input||input.schema!=='flowdeck.autonomous-input/v1'||
  input.projectId==='sashai-fresh-attended-20261018-08'||
  input.policy?.schema!=='flowdeck.autonomy-policy/v1'||
  input.policy?.mode!=='automatic-initial-send'||
  input.policy?.projectId!==input.projectId||
  !/^[a-zA-Z0-9._-]{8,128}$/.test(input.campaignRunId)||
  !/^[a-f0-9]{64}$/.test(input.policyDigest))
  return block('invalid_autonomous_input');
 const context:AutonomousExecutionContext={...input,workflowId:info.workflowId,runId:info.runId};
 const durableSessionWaits=patched('flowdeck-autonomous-durable-session-waits-v1');
 const policyRunMinutes=input.policy.maxRunDurationMinutes;
 if(!Number.isSafeInteger(policyRunMinutes)||policyRunMinutes<1||policyRunMinutes>60)
  return block('invalid_autonomous_wait_policy');
 const runDeadline=Date.now()+policyRunMinutes*60_000;
 const start=await activities.validateAndClaim(context);
 if(!start.valid)return block(start.reason??'authority_or_scope_invalid');

 async function submit(stage:string,call:()=>Promise<Verdict>){
  if(result.submissions>=3)return{status:'blocked',reason:'run_budget_exhausted'} as Verdict;
  const verdict=await call();
  if(verdict.status==='submitted')result.submissions++;
  return verdict;
 }
 async function reconcile(stage:string,call:()=>Promise<Verdict>){
  if(durableSessionWaits){
   const deadline=Math.min(runDeadline,Date.now()+10*60_000);
   while(Date.now()<deadline){
    if(signalConflict)return{status:'blocked',reason:'conflicting_duplicate_work_event'} as Verdict;
    const before=signalRevision;
    const v=await call();
    if(v.status!=='pending')return v;
    if(Date.now()>=deadline)break;
    await condition(()=>signalRevision!==before,Math.min(5_000,deadline-Date.now()));
   }
   return{status:'blocked',reason:stage+'_observation_timeout'} as Verdict;
  }
  // Each physical source signal can cause at most one extra reconciliation read.
  // A stale queue entry is consumed, not reused to busy-loop indefinitely.
  for(let observed=0;observed<30;observed++){
   const v=await call();
   if(v.status!=='pending')return v;
   if(!signals.length){
    const woke=await condition(()=>signals.length>0,'10 minutes');
    if(!woke)return{status:'blocked',reason:stage+'_observation_timeout'} as Verdict;
   }
   signals.shift();
  }
  return{status:'blocked',reason:stage+'_signal_limit'} as Verdict;
 }
 async function awaitSession(stage:string,call:()=>Promise<Verdict>,expected:'reported'|'implementation_done'){
  // The unpatched branch deliberately preserves the V1 command schedule for old histories.
  if(!durableSessionWaits)return call();
  const deadline=Math.min(runDeadline,Date.now()+10*60_000);
  while(Date.now()<deadline){
   if(signalConflict)return{status:'blocked',reason:'conflicting_duplicate_work_event'} as Verdict;
   const before=signalRevision;
   const verdict=await call();
   if(Date.now()>=deadline)return{status:'blocked',reason:stage+'_session_deadline_exceeded'} as Verdict;
   if(verdict.status===expected||verdict.status==='blocked')return verdict;
   if(verdict.status!=='pending')return{status:'blocked',reason:'unexpected_session_verdict'} as Verdict;
   const remaining=Math.min(5_000,deadline-Date.now());
   if(remaining<=0)break;
   await condition(()=>signalRevision!==before,remaining);
  }
  return{status:'blocked',reason:stage+'_session_deadline_exceeded'} as Verdict;
 }
 const initial=await submit('initial_p1',()=>activities.submitInitialP1(context));
 if(initial.status!=='submitted')return block(initial.reason??'initial_submission_blocked');
 const r1=await reconcile('initial_p1',()=>activities.reconcileInitialP1(context));
 if(r1.status!=='reconciled')return block(r1.reason??'initial_reconciliation_blocked');
 const session1=await awaitSession('initial_p1',()=>activities.awaitP1Events(context),'reported');
 if(session1.status!=='reported')return block(session1.reason??'initial_session_unresolved');
 const continued=await submit('continue_p1',()=>activities.continueP1(context));
 if(continued.status!=='submitted')return block(continued.reason??'continuation_submission_blocked');
 const rc=await reconcile('continue_p1',()=>activities.reconcileContinuation(context));
 if(rc.status!=='reconciled')return block(rc.reason??'continuation_reconciliation_blocked');
 const p1=await awaitSession('continue_p1',()=>activities.awaitP1Completion(context),'implementation_done');
 if(p1.status!=='implementation_done')return block(p1.reason??'p1_incomplete_or_review_blocked');
 // The validated policy/approved task authority and submitP2 activity must
 // establish P2 independence or completed external review before dispatch.
 const next=await submit('initial_p2',()=>activities.submitP2(context));
 if(next.status!=='submitted')return block(next.reason??'p2_submission_blocked');
 const rn=await reconcile('initial_p2',()=>activities.reconcileP2(context));
 if(rn.status!=='reconciled')return block(rn.reason??'p2_reconciliation_blocked');
 const p2=await awaitSession('initial_p2',()=>activities.awaitP2Completion(context),'implementation_done');
 if(p2.status!=='implementation_done')return block(p2.reason??'p2_incomplete');
 // This in-workflow activity is a READINESS gate only. It must not archive
 // the browser-owner claim: this workflow has not yet reached COMPLETED.
 // The external controller must independently verify the completed Temporal
 // result and perform the locked success-only retirement afterwards.
 const closeout=await activities.closeout(context);
 if(closeout.status!=='closed')return block(closeout.reason??'closeout_quarantined');
 if(result.submissions!==3)return block('three_send_budget_not_reconciled');
 result.status='completed';result.reason='successfully_reconciled';
 return result;
}
