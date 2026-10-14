import {condition,defineQuery,defineSignal,proxyActivities,setHandler} from '@temporalio/workflow';
import type * as activities from './sashai-report-temporal-activities.js';

export interface ReportLifecycleInput {taskId:string;contractSha256:string;pauseBeforeReverification:boolean}
export interface ReportLifecycleState {
 taskId:string;stage:string;chat:string|null;sendObserved:boolean;
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
 const s:ReportLifecycleState={taskId,stage:'initial',chat:null,sendObserved:false,
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
 if(!claim.ready){s.stage='blocked_claim';return s;}
 s.stage='observing_preexisting_report';
 if(input.pauseBeforeReverification){
  s.stage='waiting_for_durable_resume';
  await condition(()=>signaled); // survives worker restarts; never resubmits
 }
 s.stage='reverifying_independently';
 const result=await a.reverifyReportEvidence();
 s.acceptance=result.reportStatus;
 s.blockers=result.unmet;
 s.stage=result.verified?'verified_approval_boundary':'blocked_acceptance';
 // Always STOP. Next task approval is separate even if this report passes.
 return s;
}
