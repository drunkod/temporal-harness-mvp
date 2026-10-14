import {condition,defineQuery,defineSignal,proxyActivities,setHandler} from '@temporalio/workflow';
import type * as acts from './sashai-synthetic-report-activities.js';
import type {FixtureBinding,FixtureReceipt,FixtureMode} from './sashai-synthetic-report-activities.js';

export interface SyntheticState {
 mode:FixtureMode;stage:string;taskId:string;attemptId:string|null;chat:string|null;
 initialAcceptance:string;finalAcceptance:string;sendClaimed:boolean;
 correctionClaimed:boolean;unmet:string[];dispatchPermitted:false;
 nextTaskPermitted:false;note:string;
}
const a=proxyActivities<typeof acts>({startToCloseTimeout:'20 seconds',retry:{maximumAttempts:1}});
export const syntheticQuery=defineQuery<SyntheticState>('syntheticReportStatus');
export const resumeSynthetic=defineSignal('resumeSyntheticReport');
const matches=(b:FixtureBinding,r:FixtureReceipt)=>b.taskId===r.taskId&&
 b.attemptId===r.attemptId&&b.chat===r.chat&&b.contractSha256===r.contractSha256&&
 b.artifactPath===r.artifactPath;

/** Disposable Temporal-controlled report lifecycle.
 *  NO browser adapter, Oracle send, Sashai modification or real task permission.
 */
export async function syntheticReportLifecycle(mode:FixtureMode,pauseBeforeSend:boolean):Promise<SyntheticState>{
 if(mode!=='repair'&&mode!=='uncertain')throw Error('Unapproved synthetic workflow mode');
 const s:SyntheticState={mode,stage:'starting',taskId:'synthetic-report-'+mode,
  attemptId:null,chat:null,initialAcceptance:'not_checked',finalAcceptance:'not_checked',
  sendClaimed:false,correctionClaimed:false,unmet:[],dispatchPermitted:false,
  nextTaskPermitted:false,note:'synthetic_fixture_only_no_browser'};
 let resume=false;
 setHandler(syntheticQuery,()=>({...s,unmet:[...s.unmet]}));
 setHandler(resumeSynthetic,()=>{resume=true});
 s.stage='preparing_durable_attempt';
 const b=await a.prepareFixture(mode);
 s.attemptId=b.attemptId;s.chat=b.chat;
 if(pauseBeforeSend){
  s.stage='waiting_before_send_boundary';
  await condition(()=>resume);
 }
 s.stage='claiming_send_once';
 try{
  await a.dispatchFixtureOnce(b);
  s.sendClaimed=true;
 }catch{
  s.stage='reconciling_unknown_send';
  const reconciled=await a.reconcileFixtureSend(b);
  s.sendClaimed=reconciled.claimed;
  s.unmet=['send_outcome_indeterminate'];
  if(!reconciled.claimMatched)s.unmet.push('send_claim_does_not_match');
  s.stage='blocked_indeterminate_send';
  // Crucially no retry or correction despite any observed artifact.
  return s;
 }
 s.stage='verifying_incomplete_artifact';
 const first=await a.verifyFixture(b);
 s.initialAcceptance=first.accepted?'unexpected_pass':'rejected';
 if(!matches(b,first)||first.accepted||first.unmet.length!==1||
    first.unmet[0]!=='required_marker_missing'){
  s.unmet=['initial_verifier_unexpected_state',...first.unmet];
  s.stage='blocked_acceptance';return s;
 }
 s.stage='correcting_targeted_failure';
 try{await a.repairFixtureOnce(b,first);s.correctionClaimed=true;}
 catch{s.unmet=['correction_uncertain_no_retry'];s.stage='blocked_correction';return s;}
 s.stage='reverifying_after_correction';
 const final=await a.verifyFixture(b);
 s.finalAcceptance=final.accepted?'verified_report':'rejected';
 if(!matches(b,final))s.unmet.push('final_receipt_identity_mismatch');
 s.unmet.push(...final.unmet);
 s.stage=final.accepted&&s.unmet.length===0?'verified_approval_boundary':'blocked_acceptance';
 return s;
}
