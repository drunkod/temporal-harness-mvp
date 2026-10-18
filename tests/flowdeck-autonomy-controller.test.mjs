import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAutonomyController } from '../dist/flowdeck-autonomy-controller.js';
import { createAutonomyEventDelivery } from '../dist/flowdeck-autonomy-event-delivery.js';
import { autonomyPolicyDigest } from '../dist/flowdeck-autonomy-policy.js';

const execFileAsync=promisify(execFile);
const policy = { schema:'flowdeck.autonomy-policy/v1', campaignId:'campaign-fixture-001', ownerId:'owner-fixture-001', deviceId:'device-fixture-001', worktree:'/tmp/root', allowedRoot:'/tmp' };
const config = (over={}) => ({ schema:'flowdeck.autonomy-controller-config/v1', policy, workflowId:'workflow-fixture-001', runId:null, ownerScope:{ownerId:policy.ownerId,deviceId:policy.deviceId,worktree:policy.worktree}, follower:{schema:'flowdeck.event-follower/v1',source:'fixture-events',ownerId:policy.ownerId,deviceId:policy.deviceId,cursorPath:'/tmp/events.cursor'}, deadlineAt:'2030-01-01T00:00:00Z', stopGraceMs:100, ...over });
const receipt = { receiptPath:'/tmp/fixture-receipt.json', receiptSha256:'a'.repeat(64) };
async function setup(t, patch={}) {
  const root=await mkdtemp(join(tmpdir(),'flowdeck-controller-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const calls=[]; let workflow='missing', workflowRunId=null, worker='stopped', follower='missing'; const policyDigest=autonomyPolicyDigest(policy);
  const effects={
    authorize:async()=>({allowed:true,policyDigest}),
    checkExisting:async id=>{calls.push(['check',id]);return{status:workflow,runId:workflowRunId,policyDigest:workflow==='missing'?null:policyDigest};},
    startExistingIdentity:async id=>{calls.push(['startWorkflow',id]);workflow='running';workflowRunId='run-fixture-001';return{runId:workflowRunId,policyDigest};},
    ensureFollower:async(c,on)=>{calls.push(['ensureFollower',c]);follower='running';if(patch.event)await on('event-1');},
    followerStatus:async()=>follower, stopFollower:async()=>{calls.push(['stopFollower']);follower='stopped';},
    ensureWorker:async()=>{calls.push(['ensureWorker']);worker='running';}, workerStatus:async()=>worker, stopWorker:async()=>{calls.push(['stopWorker']);worker='stopped';},
    deliverEvent:async(id,target)=>calls.push(['event',id,target]), status:async()=>({readonly:true}),
    verify:async()=>({terminal:true,status:'completed',reason:'fixture_success'}),
    cancelWorkflow:async id=>calls.push(['cancel',id]),
    assertNoOutstandingEffects:async target=>calls.push(['noOutstanding',target]),
    finalizeOrResumeCloseout:async target=>{calls.push(['finalize',target]);return receipt;},
    verifyCloseoutReceipt:async(r,target)=>calls.push(['verifyReceipt',r,target]),
    ...patch.effects,
  };
  return {root,calls,effects,setWorkflow:(status,id)=>{workflow=status;workflowRunId=id;},setWorker:value=>{worker=value;}, controller:createAutonomyController(join(root,'run.json'),effects,join(root,'owners'))};
}

test('follower readiness and run binding precede worker polling',async t=>{
  const x=await setup(t); const r=await x.controller.execute(config());
  assert.equal(r.manifest.state,'retired'); assert.equal(r.manifest.runId,'run-fixture-001');
  assert(x.calls.findIndex(c=>c[0]==='ensureFollower')<x.calls.findIndex(c=>c[0]==='ensureWorker'));
  assert(x.calls.findIndex(c=>c[0]==='startWorkflow')<x.calls.findIndex(c=>c[0]==='ensureFollower'));
});

test('worker is not started when follower readiness cannot be proven',async t=>{
  const x=await setup(t,{effects:{followerStatus:async()=> 'missing'}}); const r=await x.controller.execute(config());
  assert.equal(r.manifest.state,'active'); assert.equal(r.manifest.retryCount,1);
  assert.equal(x.calls.filter(c=>c[0]==='ensureWorker').length,0);
});

test('a ready follower and worker are adopted on active restart without a second workflow start',async t=>{
  const x=await setup(t,{effects:{verify:async()=>({terminal:false,status:'blocked',reason:'still_running'})}});
  const first=await x.controller.execute(config()); assert.equal(first.manifest.state,'active');
  x.calls.length=0; const second=await x.controller.execute(config({runId:'run-fixture-001'}));
  assert.equal(second.manifest.state,'active'); assert.equal(x.calls.filter(c=>c[0]==='startWorkflow').length,0);
  assert.deepEqual(x.calls.find(c=>c[0]==='check')[1],{workflowId:'workflow-fixture-001',runId:'run-fixture-001'});
});

test('startup retry exhaustion remains durable and never retries uncertain Temporal start',async t=>{
  const x=await setup(t,{effects:{startExistingIdentity:async()=>{x.calls.push(['startWorkflow']);throw Error('start response lost');}}});
  const first=await x.controller.execute(config()); assert.equal(first.manifest.state,'starting');
  x.setWorkflow('missing',null);
  const second=await x.controller.execute(config()); assert.equal(second.manifest.retryCount,2);
  assert.equal(x.calls.filter(c=>c[0]==='startWorkflow').length,1);
});

test('retrying an event delivery keeps the same ID and checkpoints only after effect resolves',async t=>{
  let fail=true; const x=await setup(t,{event:true,effects:{deliverEvent:async id=>{x.calls.push(['eventAttempt',id]);if(fail){fail=false;throw Error('ack unavailable');}}}});
  const first=await x.controller.execute(config()); assert.deepEqual(first.manifest.checkpointedEventIds,[]);
  const second=await x.controller.execute(config()); assert.deepEqual(second.manifest.checkpointedEventIds,['event-1']);
  assert.deepEqual(x.calls.filter(c=>c[0]==='eventAttempt').map(c=>c[1]),['event-1','event-1']);
});

test('restart after business completion drains and closes without restarting worker or follower',async t=>{
  let release; const gate=new Promise(r=>release=r);
  const x=await setup(t,{effects:{stopWorker:async()=>{await gate; x.calls.push(['stopWorker']);x.setWorker('stopped');},verify:async()=>({terminal:true,status:'completed',reason:'success'})}});
  const first=x.controller.execute(config()); await new Promise(r=>setTimeout(r,5));
  release(); const done=await first; assert.equal(done.manifest.state,'retired');
  x.calls.length=0; const again=await x.controller.execute(config({runId:'run-fixture-001'}));
  assert.equal(again.manifest.state,'retired');
  assert.equal(x.calls.filter(c=>c[0]==='ensureWorker'||c[0]==='ensureFollower').length,0);
  assert.equal(x.calls.filter(c=>c[0]==='finalize').length,0);
  assert.equal(x.calls.filter(c=>c[0]==='verifyReceipt').length,1);
});

test('closeout crash is resumable and preserves run and policy identity',async t=>{
  const x=await setup(t,{effects:{finalizeOrResumeCloseout:async()=>{x.calls.push(['finalizeCrash']);throw Error('simulated archive response loss');}}});
  const first=await x.controller.execute(config());
  assert.equal(first.manifest.state,'closeout_blocked'); assert.equal(first.manifest.runId,'run-fixture-001');
  assert.equal(first.manifest.policyDigest,autonomyPolicyDigest(policy));
  x.effects.finalizeOrResumeCloseout=async target=>{x.calls.push(['resumeFinalize',target]);return receipt;};
  const second=await x.controller.execute(config({runId:'run-fixture-001'}));
  assert.equal(second.manifest.state,'retired'); assert.equal(x.calls.filter(c=>c[0]==='ensureWorker').length,1);
});

test('staged shutdown persists uncertainty and resumes draining before closeout',async t=>{
  let stopCalls=0; const x=await setup(t,{effects:{stopWorker:async()=>{stopCalls++;if(stopCalls===1)throw Error('worker did not drain');}}});
  const first=await x.controller.execute(config()); assert.equal(first.manifest.state,'shutdown_uncertain');
  assert.equal(first.manifest.businessResult.status,'completed'); assert.equal(first.manifest.runId,'run-fixture-001');
  x.effects.stopWorker=async()=>{stopCalls++;x.setWorker('stopped');};
  const second=await x.controller.execute(config({runId:'run-fixture-001'}));
  assert.equal(second.manifest.state,'retired'); assert.equal(stopCalls,2);
  assert.equal(x.calls.filter(c=>c[0]==='ensureWorker').length,1); assert.equal(x.calls.filter(c=>c[0]==='ensureFollower').length,1);
});

test('wrong run or policy identity fails closed before worker or sender startup',async t=>{
  const x=await setup(t,{effects:{checkExisting:async()=>({status:'running',runId:'run-wrong-001',policyDigest:autonomyPolicyDigest(policy)})}});
  const r=await x.controller.execute(config({runId:'run-fixture-001'})); assert.equal(r.manifest.retryCount,1);
  assert.equal(x.calls.filter(c=>c[0]==='ensureWorker').length,0); assert.equal(x.calls.filter(c=>c[0]==='startWorkflow').length,0);
});

test('explicit stop cancels the bound execution and drains both lifecycle components',async t=>{
  const x=await setup(t,{effects:{verify:async()=>({terminal:false,status:'blocked',reason:'pending'})}});
  await x.controller.execute(config()); const stopped=await x.controller.stop();
  assert.equal(stopped.state,'cancelled'); assert.equal(stopped.businessResult.status,'cancelled');
  assert(x.calls.some(c=>c[0]==='cancel')); assert(x.calls.some(c=>c[0]==='stopWorker')); assert(x.calls.some(c=>c[0]==='stopFollower'));
});

test('exact event delivery checkpoints only after signal acknowledgement and retries same event ID',async()=>{
  const event={schema:'remote-mcp.work-event/v1',source:'remote-mcp-jazz',eventId:'event-1',workId:'work-1',ownerId:'owner-1',deviceId:'device-1',kind:'work_started',revision:1,sourceCommittedAt:'2026-01-01T00:00:00Z',startedAt:'2026-01-01T00:00:00Z',timestampEvidence:'recorded_in_source_transaction',completionEvidence:'none',executionVerified:false,backgroundProcesses:'unknown',origin:'event'};
  const calls=[]; let loseAck=true; const delivery=createAutonomyEventDelivery({target:{workflowId:'workflow-1',runId:'run-1'},ownerId:'owner-1',deviceId:'device-1',inbox:{readPending:async id=>{assert.equal(id,'event-1');return event;},markDelivered:async(...args)=>calls.push(['ack',...args])},workflow:{signal:async(...args)=>{calls.push(['signal',...args]);if(loseAck){loseAck=false;throw Error('signal acknowledgment lost');}}}});
  await assert.rejects(delivery('event-1',{workflowId:'workflow-1',runId:'run-1'}),/lost/); assert.equal(calls.filter(c=>c[0]==='ack').length,0);
  await delivery('event-1',{workflowId:'workflow-1',runId:'run-1'}); assert.equal(calls.filter(c=>c[0]==='signal').length,2); assert.equal(calls.filter(c=>c[0]==='ack').length,1);
  await assert.rejects(delivery('event-2',{workflowId:'workflow-1',runId:'run-other'}),/target mismatch/);
});

test('legacy v1 manifest is explicitly migrated to resumable v2 closeout',async t=>{
  const x=await setup(t); const result=await x.controller.execute(config());
  assert.equal(result.manifest.state,'retired');
  const path=join(x.root,'run.json'); const current=JSON.parse(await readFile(path,'utf8'));
  const old={...current,schema:'flowdeck.autonomy-controller-manifest/v1',version:1,state:'completed',lastEventId:'old-event',terminalResult:{status:'completed',reason:'legacy_success',workflowId:current.workflowId,runId:current.runId,finishedAt:current.updatedAt}};
  for(const key of ['checkpointedEventIds','businessResult','closeoutReceipt','failureReason']) delete old[key];
  await writeFile(path,JSON.stringify(old));
  x.effects.verifyCloseoutReceipt=async(r,target)=>x.calls.push(['legacyReceipt',r,target]);
  const migrated=await x.controller.read(); assert.equal(migrated.schema,'flowdeck.autonomy-controller-manifest/v2');
  assert.equal(migrated.state,'business_completed'); assert.deepEqual(migrated.checkpointedEventIds,['old-event']);
});

test('uncertain owner claim survives process lock release and blocks another manifest',async t=>{
  const x=await setup(t,{effects:{stopWorker:async()=>{throw Error('uncertain sender')}}});
  const result=await x.controller.execute(config()); assert.equal(result.manifest.state,'shutdown_uncertain');
  const other=createAutonomyController(join(x.root,'other.json'),x.effects,join(x.root,'owners'));
  await assert.rejects(other.execute(config()),/owner claim exists/);
});

test('dead process lock can be reclaimed without deleting the durable owner claim',async t=>{
  const x=await setup(t); await writeFile(join(x.root,'run.json.lock'),'99999999');
  const result=await x.controller.execute(config()); assert.equal(result.manifest.state,'retired');
  assert.equal(x.calls.filter(c=>c[0]==='startWorkflow').length,1);
});

test('stop deadline persists shutdown_uncertain while an external cancellation remains unresolved',async t=>{
  const x=await setup(t,{effects:{verify:async()=>({terminal:false,status:'blocked',reason:'running'}),cancelWorkflow:async()=>new Promise(()=>{})}});
  await x.controller.execute(config());
  const before=Date.now(),stopped=await x.controller.stop();
  assert(Date.now()-before<1000); assert.equal(stopped.state,'shutdown_uncertain');
  assert.match(stopped.failureReason,/workflow_cancel_deadline_exceeded/);
  assert.equal((await x.controller.read()).state,'shutdown_uncertain');
});

test('child-process crash releases only process locks and successor adopts the durable workflow identity',async t=>{
  const root=await mkdtemp(join(tmpdir(),'flowdeck-crash-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const manifest=join(root,'run.json'),owners=join(root,'owners');
  await execFileAsync(process.execPath,[join(process.cwd(),'tests/fixtures/autonomy-shutdown/crash-controller-child.mjs'),manifest,owners]);
  const durable=JSON.parse(await readFile(manifest,'utf8'));
  assert.equal(durable.state,'active'); assert.equal(durable.runId,'run-fixture-001');
  const calls=[],digest=autonomyPolicyDigest(policy);
  const effects={authorize:async()=>({allowed:true,policyDigest:digest}),checkExisting:async id=>{calls.push(['check',id]);return{status:'running',runId:'run-fixture-001',policyDigest:digest};},startExistingIdentity:async()=>{calls.push(['start']);throw Error('must adopt');},ensureFollower:async()=>{calls.push(['adoptFollower']);},followerStatus:async()=> 'running',stopFollower:async()=>{},ensureWorker:async()=>{calls.push(['adoptWorker']);},workerStatus:async()=> 'running',stopWorker:async()=>{},deliverEvent:async()=>{},status:async()=>({}),verify:async()=>({terminal:false,status:'blocked',reason:'still_running'}),cancelWorkflow:async()=>{},assertNoOutstandingEffects:async()=>{},finalizeOrResumeCloseout:async()=>({receiptPath:'/tmp/unused',receiptSha256:'a'.repeat(64)}),verifyCloseoutReceipt:async()=>{}};
  const controller=createAutonomyController(manifest,effects,owners);
  const adopted=await controller.execute(config({runId:'run-fixture-001'}));
  assert.equal(adopted.manifest.state,'active');
  assert.deepEqual(calls.filter(c=>c[0]==='check')[0][1],{workflowId:'workflow-fixture-001',runId:'run-fixture-001'});
  assert.equal(calls.filter(c=>c[0]==='start').length,0);
  assert.equal(calls.filter(c=>c[0]==='adoptWorker').length,0);
  assert.equal(calls.filter(c=>c[0]==='adoptFollower').length,0);
  const claimFile=(await readdir(owners)).find(name=>name.endsWith('.claim'));
  assert(claimFile); assert.equal(JSON.parse(await readFile(join(owners,claimFile),'utf8')).runId,'run-fixture-001');
});


test('hung worker-status after drain is bounded, persists shutdown uncertainty and releases process locks',async t=>{
 const x=await setup(t,{effects:{workerStatus:async()=>new Promise(()=>{})}});
 // A terminal existing execution avoids the initial startup workerStatus call.
 x.setWorkflow('completed','run-fixture-001');
 const before=Date.now();
 const r=await x.controller.execute(config({runId:'run-fixture-001',stopGraceMs:80}));
 assert(Date.now()-before<1500);
 assert.equal(r.manifest.state,'shutdown_uncertain');
 assert.match(r.manifest.failureReason,/sender_status_deadline_exceeded/);
 assert.equal(r.manifest.businessResult.status,'completed');
 assert.equal(x.calls.filter(c=>c[0]==='finalize').length,0);
 assert.equal((await x.controller.read()).state,'shutdown_uncertain');
 // The controller process lock is gone; the durable owner claim remains.
 await assert.rejects(readFile(join(x.root,'run.json.lock')),/ENOENT/);
 assert((await readdir(join(x.root,'owners'))).some(name=>name.endsWith('.claim')));
});

test('hung outstanding-effect inspection cannot certify senders drained',async t=>{
 const x=await setup(t,{effects:{assertNoOutstandingEffects:async()=>new Promise(()=>{})}});
 x.setWorkflow('completed','run-fixture-001');
 const before=Date.now();
 const r=await x.controller.execute(config({runId:'run-fixture-001',stopGraceMs:80}));
 assert(Date.now()-before<1500);
 assert.equal(r.manifest.state,'shutdown_uncertain');
 assert.match(r.manifest.failureReason,/sender_effects_deadline_exceeded/);
 assert.equal(x.calls.filter(c=>c[0]==='finalize').length,0);
});

test('hung finalizer cannot retire a claim or hold process ownership indefinitely',async t=>{
 const x=await setup(t,{effects:{finalizeOrResumeCloseout:async()=>new Promise(()=>{})}});
 x.setWorkflow('completed','run-fixture-001');
 const before=Date.now();
 const r=await x.controller.execute(config({runId:'run-fixture-001',stopGraceMs:80}));
 assert(Date.now()-before<3500);
 assert.equal(r.manifest.state,'closeout_blocked');
 assert.match(r.manifest.failureReason,/closeout_finalize_deadline_exceeded/);
 assert.equal(r.manifest.closeoutReceipt,null);
 assert((await readdir(join(x.root,'owners'))).some(name=>name.endsWith('.claim')));
});
