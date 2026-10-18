import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPinnedProductionInbox,createProductionSourceFollower,createProductionRuntimeEffects} from '../dist/flowdeck-autonomy-production-runtime.js';
import {createProductionSourceCursorStore} from '../dist/flowdeck-autonomy-production-cursor.js';

const event=(eventId,kind,revision,at)=>({schema:'remote-mcp.work-event/v1',source:'remote-mcp-jazz',eventId,workId:'work-exact-01',ownerId:'owner-exact-01',deviceId:'device-exact-01',kind,revision,sourceCommittedAt:at,startedAt:'2026-01-01T00:00:00.000Z',...(kind==='work_reported'?{reportedAt:at,outcome:'success'}:{}),timestampEvidence:'recorded_in_source_transaction',completionEvidence:kind==='work_started'?'none':'agent_report_only',executionVerified:false,backgroundProcesses:'unknown',origin:'event'});

test('source follower pins exact run before opening source, admits later duplicate/out-of-order events, then checkpoints',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'flowdeck-prod-runtime-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const order=[],signals=[],cursors=[];let inbox;
 const target={workflowId:'workflow-exact-01',runId:'run-exact-01'};
 inbox=createPinnedProductionInbox({directory:dir,ownerId:'owner-exact-01',deviceId:'device-exact-01',...target,signal:async(t,e)=>{assert.deepEqual(t,target);assert.equal(e.ownerId,'owner-exact-01');signals.push(e.eventId);}});
 const identity={source:'remote-mcp-jazz',ownerId:'owner-exact-01',deviceId:'device-exact-01'};
 const cursor={bindExact:async x=>{order.push('bind');assert.deepEqual(x,{...identity,...target});},readExact:async()=>{order.push('read');return{cursor:'cursor-0'};},advanceExact:async(_x,c)=>{cursors.push(c);}};
 const source={async catchUp({after}){assert.equal(after,'cursor-0');order.push('catchUp');return{complete:true,events:[]};},async *follow({after}){order.push('source');assert.equal(after,'cursor-0');await Promise.resolve();yield{event:event('report-late','work_reported',2,'2026-01-01T00:00:02.000Z'),cursor:'cursor-2'};yield{event:event('start-late','work_started',1,'2026-01-01T00:00:01.000Z'),cursor:'cursor-3'};yield{event:event('report-late','work_reported',2,'2026-01-01T00:00:02.000Z'),cursor:'cursor-4'};}};
 const follower=createProductionSourceFollower({source,inbox,cursor,signalExact:async()=>{throw Error('inbox wake is the sole signal adapter');}});
 await follower.startOrAdoptExact(target,identity);
 for(let i=0;i<200&&(await follower.status())==='running';i++)await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(order,['bind','read','catchUp','source']);assert.deepEqual(signals,['report-late','start-late']);assert.deepEqual(cursors,['cursor-2','cursor-3','cursor-4']);
 const status=await inbox.status();assert.equal(status.pending,0);assert.equal(Object.keys(status.events).length,2);
 await follower.stopAndDrain();assert.equal(await follower.status(),'stopped');
});

test('source follower cancellation aborts the adapter signal and drains its iterator',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'flowdeck-prod-cancel-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let receivedSignal,finished=false;
 const source={catchUp:async()=>({complete:true,events:[]}),async *follow({signal}){receivedSignal=signal;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));finished=true;}};
 const inbox={ingest:async()=>({disposition:'accepted'}),retryPending:async()=>({pending:0,blocked:0}),status:async()=>({events:{},pending:0})};
 const cursor={bindExact:async()=>{},readExact:async()=>({cursor:null}),advanceExact:async()=>{}};
 const follower=createProductionSourceFollower({source,inbox,cursor,signalExact:async()=>{}});
 await follower.startOrAdoptExact({workflowId:'workflow-exact-01',runId:'run-exact-01'},{source:'remote-mcp-jazz',ownerId:'owner-exact-01',deviceId:'device-exact-01'});
 for(let i=0;i<100&&!receivedSignal;i++)await new Promise(resolve=>setTimeout(resolve,1));
 assert(receivedSignal);await follower.stopAndDrain();assert.equal(receivedSignal.aborted,true);assert.equal(finished,true);assert.equal(await follower.status(),'stopped');
});

test('runtime effects require owned actors and prove shutdown through actor status',async()=>{
 const calls=[];const actor=(name)=>{let state='running';return{startOrAdoptExact:async()=>calls.push(`${name}:start`),status:async()=>state,stopAndDrain:async()=>{calls.push(`${name}:stop`);state='stopped';}};};
 const worker=actor('worker'),follower=actor('follower');
 const passthrough={authorize:async()=>({allowed:true,policyDigest:'a'.repeat(64)}),checkExisting:async()=>({status:'running',runId:'run-exact-01',policyDigest:'a'.repeat(64)}),startExistingIdentity:async()=>({runId:'run-exact-01',policyDigest:'a'.repeat(64)}),status:async()=>({}),verify:async()=>({terminal:false,status:'blocked',reason:'pending'}),cancelWorkflow:async()=>{},assertNoOutstandingEffects:async()=>{},verifyCloseoutReceipt:async()=>{}};
 let predecessorAlive=false,processProofChecks=0;
 assert.throws(()=>createProductionRuntimeEffects({effects:passthrough,worker,follower}),/predecessor termination proof/);
 const effects=createProductionRuntimeEffects({effects:passthrough,worker,follower,predecessors:{assertStoppedExact:async()=>{processProofChecks++;assert.equal(await worker.status(),'stopped');if(predecessorAlive)throw Error('predecessor_sender_termination_unproven:running');}},signalEvent:async()=>{},source:{follow:async function*(){}},inbox:{},cursor:{},evidence:async()=>{throw Error('not needed');},inspectExactRun:async()=>({activeActivities:0,browserCallsInFlight:0,unresolvedDispatches:[]})});
 await effects.checkExisting({workflowId:'workflow-exact-01',runId:null});await effects.stopWorker();await effects.stopFollower();
 await effects.assertNoOutstandingEffects({workflowId:'workflow-exact-01',runId:'run-exact-01'});
 assert.equal(processProofChecks,1);
 predecessorAlive=true;
 await assert.rejects(effects.assertNoOutstandingEffects({workflowId:'workflow-exact-01',runId:'run-exact-01'}),/predecessor_sender_termination_unproven:running/);
 assert.deepEqual(calls,['worker:stop','follower:stop']);
});


test('stop during source startup waits for catch-up and prevents later admissions/cursor advancement',async()=>{
 let reached,release;
 const entered=new Promise(r=>{reached=r;});
 const barrier=new Promise(r=>{release=r;});
 let admissions=0,advances=0,sourceFollowing=0;
 const source={
  async catchUp({signal}){reached(signal);await barrier;return {complete:true,events:[{event:event('late-start','work_started',1,'2026-01-01T00:00:01.000Z'),cursor:'late-cursor'}]};},
  async *follow(){sourceFollowing++;}
 };
 const inbox={ingest:async()=>{admissions++;return{disposition:'accepted'};},retryPending:async()=>({pending:0,blocked:0}),status:async()=>({pending:0,events:{}})};
 const cursor={bindExact:async()=>{},readExact:async()=>({cursor:null}),advanceExact:async()=>{advances++;}};
 const actor=createProductionSourceFollower({source,inbox,cursor,signalExact:async()=>{}});
 const start=actor.startOrAdoptExact({workflowId:'workflow-exact-01',runId:'run-exact-01'},{source:'remote-mcp-jazz',ownerId:'owner-exact-01',deviceId:'device-exact-01'});
 const signal=await entered;
 const draining=actor.stopAndDrain();
 assert.equal(signal.aborted,true);
 // A stop request cannot declare success while a source operation is pending.
 let finished=false;void draining.then(()=>{finished=true;});
 await Promise.resolve();assert.equal(finished,false);
 release();
 await assert.rejects(start,/source_follower_cancelled/);
 await draining;
 assert.equal(await actor.status(),'stopped');
 assert.equal(admissions,0);assert.equal(advances,0);assert.equal(sourceFollowing,0);
});

test('stop during inbox admission holds drain and forbids all post-cancellation cursor effects',async()=>{
 let admitStarted,release;
 const entered=new Promise(r=>{admitStarted=r;});
 const barrier=new Promise(r=>{release=r;});
 let retries=0,advances=0;
 const source={catchUp:async()=>({complete:true,events:[{event:event('late-report','work_reported',2,'2026-01-01T00:00:02.000Z'),cursor:'cursor-new'}]}),async *follow(){}};
 const inbox={ingest:async()=>{admitStarted();await barrier;return{disposition:'accepted'};},retryPending:async()=>{retries++;return{pending:0,blocked:0};},status:async()=>({pending:0,events:{}})};
 const cursor={bindExact:async()=>{},readExact:async()=>({cursor:null}),advanceExact:async()=>{advances++;}};
 const actor=createProductionSourceFollower({source,inbox,cursor,signalExact:async()=>{}});
 const start=actor.startOrAdoptExact({workflowId:'workflow-exact-01',runId:'run-exact-01'},{source:'remote-mcp-jazz',ownerId:'owner-exact-01',deviceId:'device-exact-01'});
 await entered;
 const draining=actor.stopAndDrain();
 release();
 await assert.rejects(start,/source_follower_cancelled/);
 await draining;
 assert.equal(retries,0);assert.equal(advances,0);
 assert.equal(await actor.status(),'stopped');
});

test('real persisted cursor backs source follower catch-up and restart without re-seeding live notices',async t=>{
 const {realpath}=await import('node:fs/promises');
 const dir=await mkdtemp(join(await realpath(tmpdir()),'flowdeck-source-disk-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const scope={source:'remote-mcp-jazz',ownerId:'owner-exact-01',deviceId:'device-exact-01',
   workflowId:'workflow-exact-01',runId:'run-exact-01'};
 const path=join(dir,'cursor.json');
 const cursor=createProductionSourceCursorStore(path);
 await cursor.initializeExact(scope,'upstream-head-001');
 const admitted=[];
 const inbox={ingest:async e=>{admitted.push(e.eventId);return{disposition:'accepted'};},
  retryPending:async()=>({pending:0,blocked:0}),status:async()=>({pending:0,events:{}})};
 const source={
  catchUp:async({after})=>{assert.equal(after,'upstream-head-001');return{complete:true,events:[
   {event:event('disk-start','work_started',1,'2026-01-01T00:00:01.000Z'),cursor:'event-cursor-002'}
  ]};},
  async *follow({after}){assert.equal(after,'event-cursor-002');
   yield{event:event('disk-report','work_reported',2,'2026-01-01T00:00:02.000Z'),cursor:'event-cursor-003'};
  },
 };
 const actor=createProductionSourceFollower({source,inbox,cursor,signalExact:async()=>{}});
 await actor.startOrAdoptExact({workflowId:scope.workflowId,runId:scope.runId},
  {source:scope.source,ownerId:scope.ownerId,deviceId:scope.deviceId});
 for(let i=0;i<100 && await actor.status()!=='stopped';i++)await new Promise(r=>setTimeout(r,2));
 await actor.stopAndDrain();
 assert.deepEqual(admitted,['disk-start','disk-report']);
 const restarted=createProductionSourceCursorStore(path);
 await restarted.bindExact(scope);
 assert.deepEqual(await restarted.readExact(scope),{cursor:'event-cursor-003'});
 await assert.rejects(restarted.initializeExact(scope,'different-head-004'),/cannot be reseeded/);
});
