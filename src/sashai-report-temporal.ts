import {condition,defineQuery,defineSignal,proxyActivities,setHandler} from '@temporalio/workflow';
import type * as activities from './sashai-report-temporal-activities.js';
import type {ReportBinding} from './sashai-report-binding.js';

export interface ReportLifecycleInput {taskId:string;contractSha256:string;pauseBeforeReverification:boolean}
export interface ReportLifecycleState {
 taskId:string;stage:string;chat:string|null;attemptId:string|null;
 boundArtifactSha256:string|null;sendObserved:boolean;
 correctionObserved:boolean;acceptance:string;blockers:string[];
 runMode:'read_only_adoption';dispatchPermitted:false;nextTaskPermitted:false;
}
const taskId='sashai-architecture-report-2026-10-15';
const a=proxyActivities<typeof activities>({startToCloseTimeout:'35 seconds',retry:{maximumAttempts:1}});
export const reportLifecycleQuery=defineQuery<ReportLifecycleState>('sashaiReportLifecycleStatus');
export const resumeReportReview=defineSignal('resumeReportReview');
/** Durable adoption of existing browser report attempt.
 *  NO activity can submit a prompt, trigger a correction or start next work.
 */
export async function sashaiReportLifecycle(input:ReportLifecycleInput):Promise<ReportLifecycleState>{
 if(input.taskId!==taskId||!/^[a-f0-9]{64}$/.test(input.contractSha256))
   throw Error('Invalid or unapproved Sashai report input');
 const s:ReportLifecycleState={taskId,stage:'initial',chat:null,attemptId:null,
  boundArtifactSha256:null,sendObserved:false,
  correctionObserved:false,acceptance:'not_checked',blockers:[],
  runMode:'read_only_adoption',dispatchPermitted:false,nextTaskPermitted:false};
 let signaled=false;
 setHandler(reportLifecycleQuery,()=>({...s,blockers:[...s.blockers]}));
 setHandler(resumeReportReview,()=>{signaled=true});
 s.stage='reconcile_persisted_claim';
 const claim=await a.inspectReportEvidence(input.contractSha256);
 s.chat=claim.chat;
 s.sendObserved=claim.sendClaim;
 s.correctionObserved=claim.correctionClaim;
 s.blockers=claim.blockers;
 if(!claim.ready||!claim.binding){s.stage='blocked_claim';return s;}
 const sealed:ReportBinding=claim.binding;
 s.attemptId=sealed.attemptId;
 s.boundArtifactSha256=sealed.artifactSha256;
 if(sealed.chat!==s.chat||sealed.contractSha256!==input.contractSha256){
  s.blockers.push('original_task_chat_contract_binding_invalid');
  s.stage='blocked_claim';return s;
 }
 s.stage='observing_preexisting_report';
 if(input.pauseBeforeReverification){
  s.stage='waiting_for_durable_resume';
  await condition(()=>signaled); // survives worker restarts; never resubmits
 }
 s.stage='reverifying_independently';
 const result=await a.reverifyReportEvidence(sealed);
 s.acceptance=result.reportStatus;
 s.blockers=[...result.unmet];
 if(!result.identityMatched||!result.binding||!result.identity||
    result.binding.attemptId!==sealed.attemptId||
    result.identity.taskId!==sealed.taskId||
    result.identity.attemptId!==sealed.attemptId||result.identity.chatUrl!==sealed.chat||
    result.identity.taskContractSha256!==sealed.contractSha256||
    result.identity.reportPath!==sealed.artifactPath||
    result.identity.reportSha256!==sealed.artifactSha256){
  s.blockers.push('post_resume_or_receipt_identity_mismatch');
 }
 s.stage=result.verified&&s.blockers.length===0?'verified_approval_boundary':'blocked_acceptance';
 // Always STOP. Next task approval is separate even if this report passes.
 return s;
}
