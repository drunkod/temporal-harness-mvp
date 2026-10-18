import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkflowNotFoundError} from '@temporalio/client';
import {defaultPayloadConverter, WorkflowIdConflictPolicy, WorkflowIdReusePolicy} from '@temporalio/common';
import {createTemporalIdentityEffects} from '../dist/flowdeck-autonomy-temporal-adapter.js';
import {autonomyPolicyDigest} from '../dist/flowdeck-autonomy-policy.js';

const policy={schema:'flowdeck.autonomy-policy/v1',mode:'automatic-initial-send',interactive:false,
 environment:'synthetic',profile:'helium-profile-4',taskSource:'approved-active-plan',
 projectId:'project-fixture-001',projectUrl:'https://chatgpt.com/g/project-fixture-001',ownerId:'owner-fixture-001',
 deviceId:'device-fixture-001',worktree:'/tmp/work',allowedRoot:'/tmp',planSha256:'a'.repeat(64),
 enabledTaskIds:['task-fixture-001','task-fixture-002'],instructionHashes:['b'.repeat(64),'c'.repeat(64)],
 campaignId:'campaign-fixture-001',validFrom:'2030-01-01T00:00:00Z',validUntil:'2030-01-02T00:00:00Z',
 maxTasksPerRun:2,maxContinuationsPerTask:1,p2Continuations:0,maxSubmissionsPerRun:3,
 maxCampaignRuns:2,maxCampaignSubmissions:6,maxRunDurationMinutes:60,automaticSuccessfulCloseout:true,
 uncertainSend:'quarantine',identityConflict:'quarantine',reviewRequiredBeforeDependentTask:true};
const input={schema:'flowdeck.autonomous-input/v1',projectId:policy.projectId,campaignRunId:'campaign-run-001',policy,policyDigest:autonomyPolicyDigest(policy)};
const identity={workflowId:'flowdeck-autonomy-fixture-001',taskQueue:'flowdeck-autonomy-fixture-queue'};
const runId='server-run-fixture-001';
const startAttributes=(over={})=>({workflowType:{name:'flowdeckAutonomousLifecycleV1'},taskQueue:{name:identity.taskQueue},input:{payloads:[defaultPayloadConverter.toPayload(input)]},...over});
function fake(over={}){
 const calls=[];let described={workflowId:identity.workflowId,runId,type:'flowdeckAutonomousLifecycleV1',taskQueue:identity.taskQueue,status:{name:'RUNNING'}};
 let history={events:[{workflowExecutionStartedEventAttributes:startAttributes()}]};
 const client={workflow:{getHandle:(id,requestedRun)=>{calls.push(['handle',id,requestedRun]);return{
  describe:async()=>{if(over.describeError)throw over.describeError;return typeof over.description==='function'?over.description(described):over.description??described},
  fetchHistory:async()=>{if(over.historyError)throw over.historyError;return typeof over.history==='function'?over.history(history):over.history??history},
 }},start:async(type,options)=>{calls.push(['start',type,options]);if(over.startError)throw over.startError;return{firstExecutionRunId:over.startedRunId??runId}}}};
 return{client,calls,setDescription:v=>{described=v},setHistory:v=>{history=v},setHistoryError:e=>{over.historyError=e}};
}
const adapter=(x,exp=identity)=>createTemporalIdentityEffects(x.client,{...exp,input});

test('starts the pinned workflow exactly once and verifies the server-assigned run from exact history',async()=>{
 const x=fake(),effects=adapter(x);const result=await effects.startExistingIdentity({workflowId:identity.workflowId,policyDigest:input.policyDigest});
 assert.deepEqual(result,{runId,policyDigest:input.policyDigest});
 const start=x.calls.find(c=>c[0]==='start');assert.equal(start[1],'flowdeckAutonomousLifecycleV1');
 assert.equal(start[2].workflowId,identity.workflowId);assert.equal(start[2].taskQueue,identity.taskQueue);
 assert.deepEqual(start[2].args,[input]);assert.equal(start[2].workflowIdReusePolicy,WorkflowIdReusePolicy.REJECT_DUPLICATE);
 assert.equal(start[2].workflowIdConflictPolicy,WorkflowIdConflictPolicy.FAIL);assert.deepEqual(start[2].retry,{maximumAttempts:1});
 assert.equal(x.calls.filter(c=>c[0]==='start').length,1);
 await assert.rejects(effects.startExistingIdentity({workflowId:identity.workflowId,policyDigest:input.policyDigest}),/already attempted/);
 assert.equal(x.calls.filter(c=>c[0]==='start').length,1);
});

test('missing workflow is distinct from network failure and all uncertainty is unknown',async()=>{
 const absent=fake({describeError:new WorkflowNotFoundError('missing',identity.workflowId,undefined)});
 assert.deepEqual(await adapter(absent).checkExisting({workflowId:identity.workflowId,runId:null}),{status:'missing',runId:null,policyDigest:null});
 const network=fake({describeError:Error('connection unavailable')});
 assert.equal((await adapter(network).checkExisting({workflowId:identity.workflowId,runId:null})).status,'unknown');
 const historyMissing=fake({historyError:new WorkflowNotFoundError('history missing',identity.workflowId,runId)});
 assert.equal((await adapter(historyMissing).checkExisting({workflowId:identity.workflowId,runId:null})).status,'unknown');
});

test('lost start acknowledgment can be reconciled by exact history without another Start',async()=>{
 const x=fake({startError:Error('acknowledgment lost')});const effects=adapter(x);
 await assert.rejects(effects.startExistingIdentity({workflowId:identity.workflowId,policyDigest:input.policyDigest}),/acknowledgment lost/);
 x.calls.length=0;
 assert.deepEqual(await effects.checkExisting({workflowId:identity.workflowId,runId:null}),{status:'running',runId,policyDigest:input.policyDigest});
 assert.equal(x.calls.some(c=>c[0]==='start'),false);
 await assert.rejects(effects.startExistingIdentity({workflowId:identity.workflowId,policyDigest:input.policyDigest}),/already attempted/);
});

test('wrong workflow type, queue, payload, or failed execution never binds',async()=>{
 const changedPolicy={...policy,planSha256:'e'.repeat(64)};
 const changedPolicyInput={...input,policy:changedPolicy,policyDigest:autonomyPolicyDigest(changedPolicy)};
 const changedProjectInput={...input,projectId:'project-other-001',policy:{...policy,projectId:'project-other-001'}};
 changedProjectInput.policyDigest=autonomyPolicyDigest(changedProjectInput.policy);
 const cases=[
  {history:{events:[{workflowExecutionStartedEventAttributes:startAttributes({workflowType:{name:'otherWorkflow'}})}]}},
  {history:{events:[{workflowExecutionStartedEventAttributes:startAttributes({taskQueue:{name:'other-queue'}})}]}},
  {history:{events:[{workflowExecutionStartedEventAttributes:startAttributes({input:{payloads:[defaultPayloadConverter.toPayload({...input,campaignRunId:'campaign-run-changed'})]}})}]}},
  {history:{events:[{workflowExecutionStartedEventAttributes:startAttributes({input:{payloads:[defaultPayloadConverter.toPayload(changedPolicyInput)]}})}]}},
  {history:{events:[{workflowExecutionStartedEventAttributes:startAttributes({input:{payloads:[defaultPayloadConverter.toPayload(changedProjectInput)]}})}]}},
  {description:{workflowId:identity.workflowId,runId,type:'flowdeckAutonomousLifecycleV1',taskQueue:identity.taskQueue,status:{name:'FAILED'}}},
 ];
 for(const scenario of cases){const x=fake(scenario);const result=await adapter(x).checkExisting({workflowId:identity.workflowId,runId:null});assert.equal(result.status,'unknown');assert.equal(result.runId,null);assert.equal(result.policyDigest,null);}
});

test('missing server run ID is an uncertain one-time start failure',async()=>{
 const x=fake({startedRunId:''}),effects=adapter(x);
 await assert.rejects(effects.startExistingIdentity({workflowId:identity.workflowId,policyDigest:input.policyDigest}),/server-assigned/);
 await assert.rejects(effects.startExistingIdentity({workflowId:identity.workflowId,policyDigest:input.policyDigest}),/already attempted/);
 assert.equal(x.calls.filter(c=>c[0]==='start').length,1);
});

test('changed project or policy and malformed start history fail closed',async()=>{
 for(const badInput of [{...input,projectId:'different-project-001'}, {...input,policy:{...policy,planSha256:'d'.repeat(64)}}])
  assert.throws(()=>createTemporalIdentityEffects(fake().client,{...identity,input:badInput}),/digest|binding/);
 const scenarios=[
  {history:{events:[]}},
  {history:{events:[{workflowExecutionStartedEventAttributes:startAttributes()}, {workflowExecutionStartedEventAttributes:startAttributes()}]}},
  {history:{events:[{workflowExecutionStartedEventAttributes:startAttributes({input:{payloads:[]}})}]}},
 ];
 for(const scenario of scenarios)assert.equal((await adapter(fake(scenario)).checkExisting({workflowId:identity.workflowId,runId:null})).status,'unknown');
});

test('a bound run never adopts a different run and refuses invalid identity requests',async()=>{
 const x=fake();x.setDescription({...{workflowId:identity.workflowId,runId:'server-run-other-001',type:'flowdeckAutonomousLifecycleV1',taskQueue:identity.taskQueue,status:{name:'RUNNING'}}});
 assert.equal((await adapter(x).checkExisting({workflowId:identity.workflowId,runId}).then(v=>v.status)),'unknown');
 assert.equal((await adapter(fake()).checkExisting({workflowId:'other-workflow-001',runId:null})).status,'unknown');
 await assert.rejects(adapter(fake()).startExistingIdentity({workflowId:'other-workflow-001',policyDigest:input.policyDigest}),/pinned identity/);
});
