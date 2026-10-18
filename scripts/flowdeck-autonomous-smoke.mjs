#!/usr/bin/env node
/** Isolated Temporal synthetic autonomous workflow, fake activities ONLY.
 * No imports of production browser, sender, owner-scope, event follower, or config.
 */
import assert from'node:assert/strict';
import{randomUUID,createHash}from'node:crypto';
import{readFile}from'node:fs/promises';
import{fileURLToPath}from'node:url';
import{Client,Connection}from'@temporalio/client';
import{Worker,NativeConnection}from'@temporalio/worker';

const temporalAddress=process.env.TEMPORAL_ADDRESS??'127.0.0.1:7233';
const scenario=process.argv[2]??'happy';
if(!['happy','initial-uncertain','review-gate','p2-uncertain','duplicate-event'].includes(scenario))
 throw Error('Unsupported synthetic scenario; no real browser mode exists here');
const nonce=randomUUID(),taskQueue='flowdeck-autonomy-synthetic-'+nonce,workflowId=taskQueue;
const workflowsPath=fileURLToPath(new URL('../dist/flowdeck-autonomous-workflow.js',import.meta.url));
const projectId='synthetic-project-'+nonce;
const input={schema:'flowdeck.autonomous-input/v1',projectId,
 campaignRunId:'synthetic-run-'+nonce,policyDigest:'a'.repeat(64),
 policy:{schema:'flowdeck.autonomy-policy/v1',mode:'automatic-initial-send',
 projectId,ownerId:'fixture-owner',deviceId:'fixture-device',maxRunDurationMinutes:60}};
const calls=[],count=n=>calls.filter(x=>x===n).length;
let client,conn,nativeConn,worker,handle,complete=false,polls=0;
const wrap=(name,fn)=>async(...args)=>{calls.push(name);return fn(...args)};
const event={schema:'remote-mcp.work-event/v1',source:'remote-mcp-jazz',
 ownerId:'fixture-owner',deviceId:'fixture-device',
 eventId:nonce+'-started',workId:nonce+'-work',kind:'work_started'};
const activities={
 validateAndClaim:wrap('validateAndClaim',async()=>({valid:true})),
 submitInitialP1:wrap('submitInitialP1',async()=>scenario==='initial-uncertain'?
  {status:'blocked',reason:'click_may_have_happened'}:{status:'submitted'}),
 reconcileInitialP1:wrap('reconcileInitialP1',async()=>{
  if(scenario==='duplicate-event'&&polls++===0){
   await handle.signal('flowdeckAutonomousWorkEventV1',event);
   await handle.signal('flowdeckAutonomousWorkEventV1',event);
   return{status:'pending'};
  }
  return{status:'reconciled'};
 }),
 awaitP1Events:wrap('awaitP1Events',async()=>({status:'reported'})),
 continueP1:wrap('continueP1',async()=>({status:'submitted'})),
 reconcileContinuation:wrap('reconcileContinuation',async()=>({status:'reconciled'})),
 awaitP1Completion:wrap('awaitP1Completion',async()=>scenario==='review-gate'?
  {status:'blocked',reason:'dependent_review_needed'}:{status:'implementation_done'}),
 submitP2:wrap('submitP2',async()=>({status:'submitted'})),
 reconcileP2:wrap('reconcileP2',async()=>scenario==='p2-uncertain'?
  {status:'blocked',reason:'p2_uncertain'}:{status:'reconciled'}),
 awaitP2Completion:wrap('awaitP2Completion',async()=>({status:'implementation_done'})),
 closeout:wrap('closeout',async()=>({status:'closed'}))
};
const maxDuration=setTimeout(()=>{console.error('AUTONOMY_SYNTHETIC_TIMEOUT');process.exit(4)},60_000);
try{
 const sourceSha=createHash('sha256').update(await readFile(workflowsPath)).digest('hex');
 conn=await Connection.connect({address:temporalAddress,connectTimeout:'5 seconds'});
 nativeConn=await NativeConnection.connect({address:temporalAddress});
 client=new Client({connection:conn,namespace:'default'});
 worker=await Worker.create({connection:nativeConn,namespace:'default',taskQueue,
  workflowsPath,activities,maxConcurrentActivityTaskExecutions:1,
  maxConcurrentWorkflowTaskExecutions:2,shutdownGraceTime:'2 seconds',shutdownForceTime:'5 seconds'});
 await worker.runUntil(async()=>{
  try{
   handle=await client.workflow.start('flowdeckAutonomousLifecycleV1',{
    workflowId,taskQueue,args:[input],workflowExecutionTimeout:'50 seconds',retry:{maximumAttempts:1}});
   const result=await handle.result();complete=true;
   const desc=await handle.describe();assert.equal(desc.status.name,'COMPLETED');
   const expected={
    happy:{status:'completed',submissions:3,p2:1,closeout:1},
    'duplicate-event':{status:'completed',submissions:3,p2:1,closeout:1},
    'initial-uncertain':{status:'blocked',submissions:0,p2:0,closeout:0},
    'review-gate':{status:'blocked',submissions:2,p2:0,closeout:0},
    'p2-uncertain':{status:'blocked',submissions:3,p2:1,closeout:0},
   }[scenario];
   assert.equal(result.status,expected.status);
   assert.equal(result.submissions,expected.submissions);
   assert.equal(count('submitInitialP1'),1);
   assert.equal(count('submitP2'),expected.p2);
   assert.equal(count('closeout'),expected.closeout);
   const history=await handle.fetchHistory();
   const invoked=history.events.filter(e=>e.activityTaskScheduledEventAttributes).map(e=>e.activityTaskScheduledEventAttributes.activityType.name);
   assert.equal(invoked.filter(x=>x==='submitInitialP1').length,1);
   assert.equal(invoked.filter(x=>x==='submitP2').length,expected.p2);
   assert(!invoked.includes('sendContinuationOnce')&&!invoked.includes('startNextTaskOnce'));
   console.log(JSON.stringify({ok:true,scenario,workflowId,runId:desc.runId,
    workflowSha256:sourceSha,historyEvents:history.events.length,
    businessStatus:result.status,submissions:result.submissions,
    activities:invoked,proof:{realBrowserSends:0,productionActivitiesImported:false,
     durableHistoricalWorkflowTouched:false}},null,2));
  }finally{
   if(handle&&!complete)await handle.terminate('Synthetic fixture cleanup').catch(()=>undefined)
  }
 });
}catch(e){console.error('SYNTHETIC_AUTONOMY_FAILED',e);process.exitCode=1}
finally{
 clearTimeout(maxDuration);
 if(worker&&['RUNNING','INITIALIZED'].includes(worker.getState()))worker.shutdown();
 await nativeConn?.close().catch(()=>undefined);
 await conn?.close().catch(()=>undefined);
 console.error('Synthetic autonomous worker and connections stopped');
}
