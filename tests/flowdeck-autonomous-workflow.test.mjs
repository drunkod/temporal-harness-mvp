import test from'node:test';
import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import vm from'node:vm';
import ts from'typescript';
const filename=new URL('../src/flowdeck-autonomous-workflow.ts',import.meta.url);
const compiled=ts.transpileModule(readFileSync(filename,'utf8'),{
 fileName:filename.pathname,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const input=()=>({
 schema:'flowdeck.autonomous-input/v1',
 projectId:'fixture-autonomous-01',campaignRunId:'campaign-fixture-run01',
 policyDigest:'a'.repeat(64),policy:{schema:'flowdeck.autonomy-policy/v1',
 mode:'automatic-initial-send',projectId:'fixture-autonomous-01',ownerId:'owner-fixture',deviceId:'device-fixture',maxRunDurationMinutes:60}
});
const signal=(id,kind='work_started',patch={})=>({
 schema:'remote-mcp.work-event/v1',source:'remote-mcp-jazz',ownerId:'owner-fixture',
 deviceId:'device-fixture',eventId:id,workId:'work-'+id,kind,
 revision:kind==='work_started'?1:2,sourceCommittedAt:'2026-10-18T10:00:00.000Z',
 startedAt:'2026-10-18T10:00:00.000Z',timestampEvidence:'recorded_in_source_transaction',
 completionEvidence:kind==='work_started'?'none':'agent_report_only',executionVerified:false,
 backgroundProcesses:'unknown',origin:'event',
 ...(kind==='work_reported'?{reportedAt:'2026-10-18T10:01:00.000Z',outcome:'partial'}:{}),...patch
});
async function run({overrides={},pendingInitial=0,inject=false,durable=false,injectSessionSignal=false}={}){
 const activityCalls=[],handlers=new Map(),opts=[],sleeps=[];
 let initialPoll=0,emissions=0,sessionPoll=0,clock=Date.now();
 const defaults={
  validateAndClaim:async()=>({valid:true}),
  submitInitialP1:async()=>({status:'submitted'}),
  reconcileInitialP1:async()=>{
   if(initialPoll++<pendingInitial)return{status:'pending'};
   return{status:'reconciled'};
  },
  awaitP1Events:async()=>({status:'reported'}),
  continueP1:async()=>({status:'submitted'}),
  reconcileContinuation:async()=>({status:'reconciled'}),
  awaitP1Completion:async()=>({status:'implementation_done'}),
  submitP2:async()=>({status:'submitted'}),
  reconcileP2:async()=>({status:'reconciled'}),
  awaitP2Completion:async()=>({status:'implementation_done'}),
  closeout:async()=>({status:'closed'})
 };
 const activities=new Proxy(defaults,{get(target,name){
  if(!(name in target))throw Error('Unexpected autonomous activity: '+String(name));
  return async ctx=>{
   activityCalls.push({name,ctx});
   return (overrides[name]??target[name])(ctx);
  };
 }});
 const shim={
  defineQuery:n=>n,defineSignal:n=>n,
  patched:()=>durable,
  setHandler:(n,cb)=>{if(handlers.has(n))throw Error('duplicate handler');handlers.set(n,cb)},
  workflowInfo:()=>({workflowId:'flowdeck-autonomy-fixture',runId:'01a14fff-0000-0000-0000-ffffffffffff'}),
  proxyActivities:settings=>{opts.push(settings);return activities},
  condition:async(predicate,deadline)=>{
   sleeps.push(deadline);
   if(inject&&emissions++===0){
    handlers.get('flowdeckAutonomousWorkEventV1')(signal('event-one'));
    handlers.get('flowdeckAutonomousWorkEventV1')(signal('event-one'));
    handlers.get('flowdeckAutonomousWorkEventV1')(signal('fake-outside',{kind:'work_started'}, {ownerId:'wrong'}));
   }
   if(durable&&typeof deadline==='number'){
    clock+=deadline;
    if(injectSessionSignal&&emissions++===0)handlers.get('flowdeckAutonomousWorkEventV1')(signal('late-report','work_reported'));
   }
   return predicate();
  }
 };
 const ClockDate=class extends Date{static now(){return clock}};
 const exports={};
 vm.runInNewContext(compiled,{exports,Date:ClockDate,require:name=>{
  assert.equal(name,'@temporalio/workflow');
  return shim;
 }},{filename:filename.pathname,timeout:1000});
 const result=JSON.parse(JSON.stringify(await exports.flowdeckAutonomousLifecycleV1(input())));
 const calls=activityCalls.map(x=>x.name);
 return{result,calls,opts,sleeps,query:handlers.get('flowdeckAutonomousStatusV1')};
}
test('separate autonomous contract issues three supervised calls and closes out',async()=>{
 const r=await run();
 assert.equal(r.result.status,'completed');
 assert.equal(r.result.submissions,3);
 assert.deepEqual(r.calls,['validateAndClaim','submitInitialP1','reconcileInitialP1',
  'awaitP1Events','continueP1','reconcileContinuation','awaitP1Completion',
  'submitP2','reconcileP2','awaitP2Completion','closeout']);
 assert.equal(r.result.runId,'01a14fff-0000-0000-0000-ffffffffffff');
 assert.equal(r.query().status,'completed');
 assert.deepEqual(JSON.parse(JSON.stringify(r.opts)),[{startToCloseTimeout:'2 minutes',retry:{maximumAttempts:1}}]);
});
test('a waiting first-message reconciliation consumes its signal once',async()=>{
 const r=await run({pendingInitial:1,inject:true});
 assert.equal(r.result.status,'completed');
 assert.equal(r.calls.filter(x=>x==='reconcileInitialP1').length,2);
 assert.deepEqual(r.sleeps,['10 minutes']);
});
test('unobservable first user message times out, no second click or continuation',async()=>{
 const r=await run({pendingInitial:100,inject:false});
 assert.equal(r.result.status,'blocked');
 assert.equal(r.result.reason,'initial_p1_observation_timeout');
 assert.equal(r.result.submissions,1);
 assert.equal(r.calls.filter(x=>x==='submitInitialP1').length,1);
 assert.equal(r.calls.includes('continueP1'),false);
});
test('validation refusal performs zero send activities',async()=>{
 const r=await run({overrides:{validateAndClaim:async()=>({valid:false,reason:'scope_conflict'})}});
 assert.equal(r.result.reason,'scope_conflict');
 assert.equal(r.result.submissions,0);
 assert.deepEqual(r.calls,['validateAndClaim']);
});
test('uncertain initial send never schedules continuation',async()=>{
 const r=await run({overrides:{submitInitialP1:async()=>({status:'blocked',reason:'click_attempted_unresolved'})}});
 assert.equal(r.result.reason,'click_attempted_unresolved');
 assert.equal(r.result.submissions,0);
 assert.deepEqual(r.calls,['validateAndClaim','submitInitialP1']);
});
test('conflicting initial identity cannot be treated as missing hydration',async()=>{
 const r=await run({overrides:{reconcileInitialP1:async()=>({status:'blocked',reason:'identity_conflict'})}});
 assert.equal(r.result.reason,'identity_conflict');
 assert.equal(r.calls.includes('continueP1'),false);
});
test('P1 not completed blocks P2 and preserves already spent allowance',async()=>{
 const r=await run({overrides:{awaitP1Completion:async()=>({status:'blocked',reason:'review_gate'})}});
 assert.equal(r.result.status,'blocked');
 assert.equal(r.result.reason,'review_gate');
 assert.equal(r.result.submissions,2);
 assert.equal(r.calls.includes('submitP2'),false);
});
test('uncertain P2 reconciliation never authorizes successful closeout',async()=>{
 const r=await run({overrides:{reconcileP2:async()=>({status:'blocked',reason:'uncertain_p2'})}});
 assert.equal(r.result.status,'blocked');
 assert.equal(r.result.submissions,3);
 assert.equal(r.calls.includes('closeout'),false);
});
test('closeout uncertain leaves business result blocked, with three spent submits',async()=>{
 const r=await run({overrides:{closeout:async()=>({status:'blocked',reason:'claim_dispute'})}});
 assert.equal(r.result.status,'blocked');
 assert.equal(r.result.reason,'claim_dispute');
 assert.equal(r.result.submissions,3);
});

test('patched session wait keeps probing until a delayed report appears; V1 path remains one-shot',async()=>{
 let sessionPoll=0;
 const durable=await run({durable:true,overrides:{awaitP1Events:async()=>
  sessionPoll++<3?{status:'pending'}:{status:'reported'}}});
 assert.equal(durable.result.status,'completed');
 assert.equal(durable.calls.filter(x=>x==='awaitP1Events').length,4);
 assert.ok(durable.sleeps.every(x=>typeof x==='number'&&x<=5000));
 const legacy=await run();
 assert.equal(legacy.calls.filter(x=>x==='awaitP1Events').length,1);
 assert.deepEqual(legacy.sleeps,[]);
});

test('patched session wait wakes on a unique late source event and deduplicates repeats',async()=>{
 let sessionPoll=0;
 const r=await run({durable:true,injectSessionSignal:true,overrides:{awaitP1Events:async()=>
  sessionPoll++===0?{status:'pending'}:{status:'reported'}}});
 assert.equal(r.result.status,'completed');
 assert.equal(r.calls.filter(x=>x==='awaitP1Events').length,2);
 assert.equal(r.sleeps.length,1);
});

test('patched session wait blocks at its bounded stage deadline without scheduling later sends',async()=>{
 const r=await run({durable:true,overrides:{awaitP1Events:async()=>({status:'pending'})}});
 assert.equal(r.result.status,'blocked');
 assert.equal(r.result.reason,'initial_p1_session_deadline_exceeded');
 assert.equal(r.result.submissions,1);
 assert.equal(r.calls.includes('continueP1'),false);
 assert.equal(r.sleeps.at(-1),5000);
});

test('patched dispatch reconciliation uses short timer probes within a stage bound',async()=>{
 const r=await run({durable:true,overrides:{reconcileInitialP1:async()=>({status:'pending'})}});
 assert.equal(r.result.status,'blocked');
 assert.equal(r.result.reason,'initial_p1_observation_timeout');
 assert.equal(r.calls.filter(x=>x==='reconcileInitialP1').length,120);
 assert.ok(r.sleeps.every(x=>typeof x==='number'&&x<=5000));
 assert.equal(r.calls.includes('awaitP1Events'),false);
});
