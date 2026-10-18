#!/usr/bin/env node
/** Supported noninteractive autonomous entrypoint. Production execution remains
 * fail-closed until every lifecycle capability is registered and proven.
 * Never translate this request into the attended launcher.
 */
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkPolicy,CheckError} from './flowdeck-check.mjs';
export async function prepareAutonomousRun(args=process.argv.slice(2),deps={}){
 let policyFile,nonInteractive=false;
 for(let i=0;i<args.length;i++){
  const a=args[i];
  if(a==='--non-interactive')nonInteractive=true;
  else if(a==='--policy'&&args[i+1])policyFile=args[++i];
  else return{schema:'flowdeck.autonomous-result/v1',status:'blocked',reason:'invalid_argument',exitCode:2};
 }
 if(!nonInteractive)return{schema:'flowdeck.autonomous-result/v1',status:'blocked',reason:'non_interactive_required',exitCode:2};
 if(!policyFile)return{schema:'flowdeck.autonomous-result/v1',status:'blocked',reason:'scoped_policy_required',exitCode:2};
 try{
  const r=await(deps.checkPolicy||checkPolicy)(policyFile);
  if(r.policy?.environment!=='local-live')
   return{schema:'flowdeck.autonomous-result/v1',status:'blocked',reason:'live_requires_local_live_policy',exitCode:2};
  // A composed, verified production runtime is an executable capability.
  // Capability flags alone never authorize workflow or browser side effects.
  // The direct CLI supplies NO runtime until concrete local-live adapters are
  // installed, exact source identity is pinned and authorized preflight passes.
  if (deps.productionRuntime !== undefined) {
   if (typeof deps.productionRuntime !== 'function')
    return {schema:'flowdeck.autonomous-result/v1',status:'blocked',reason:'production_runtime_not_registered',exitCode:2};
   try {
    const composed=await deps.productionRuntime({policy:r.policy,policyDigest:r.hash,policyFile:resolve(policyFile)});
    if (!composed || typeof composed.runToRetired !== 'function')
     return {schema:'flowdeck.autonomous-result/v1',status:'blocked',reason:'production_composition_incomplete',exitCode:2};
    const result=await composed.runToRetired();
    const m=result?.manifest;
    if (m?.state!=='retired'||m.policyDigest!==r.hash||m.campaignId!==r.policy.campaignId||
        !m.workflowId||!m.runId||m.businessResult?.status!=='completed'||
        !m.closeoutReceipt?.receiptSha256||!/^[a-f0-9]{64}$/.test(m.closeoutReceipt.receiptSha256))
     return {schema:'flowdeck.autonomous-result/v1',status:'blocked',reason:'production_run_not_retired',exitCode:2};
    return {schema:'flowdeck.autonomous-result/v1',status:'completed',reason:'production_cycle_retired',
      workflowId:m.workflowId,runId:m.runId,receiptSha256:m.closeoutReceipt.receiptSha256,
      policyDigest:m.policyDigest,exitCode:0};
   } catch {
    // Failure details live in durable controller/journals; never create a
    // replacement run or enter an attended pilot as a fallback.
    return {schema:'flowdeck.autonomous-result/v1',status:'blocked',reason:'production_composition_failed',exitCode:2};
   }
  }
  // Never translate a policy into an attended/manual-start launch command.
  // That would silently begin an execution without the new 3-send contract.
  const capabilities=deps.capabilities??{
   productionActivities:false,
   machineWideBrowserOwnership:false,
   durableRunController:false,
   sourceEventReconciliation:false,
   restartAndCancellationFencing:false,
   evidenceBackedAutomaticCloseout:false,
   historyReplayValidated:false,
  };
  const blockers=Object.entries(capabilities).filter(([,ready])=>ready!==true).map(([name])=>name);
  return{schema:'flowdeck.autonomous-result/v1',status:'blocked',
   reason:'autonomous_preconditions_incomplete',blockers: blockers.length?blockers:['durableController'],
   policyDigest:r.hash,exitCode:2};
 }catch(e){
  return{schema:'flowdeck.autonomous-result/v1',status:'blocked',
   reason:e instanceof CheckError?e.message:'policy_or_approved_task_authority_invalid',exitCode:2};
 }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const r=await prepareAutonomousRun();
 console.log(JSON.stringify(r,null,2));process.exitCode=r.exitCode;
}
