import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {assessCompletedCloseout,closeout} from '../scripts/flowdeck-completed-closeout.mjs';
import {attemptScopePath,claimAttemptScope,inspectAttemptScope} from '../scripts/flowdeck-attempt-scope.mjs';

const scope={projectId:'pilot',ownerId:'owner',deviceId:'device',initialTaskId:'p1',workflowId:'flowdeck-supervisor-pilot'};
const runId='01a14951-e9f7-7864-b3ba-ef8af1ef20c5';
const good=()=>({
 claim:{schema:'flowdeck.attempt-scope/v1',disposition:'unresolved_until_audited_reconciliation',
  ...scope,profile:'helium-profile-4'},
 scope,runId,
 description:{workflowId:scope.workflowId,runId,type:'flowdeckSupervisor',status:{name:'COMPLETED'}},
 result:{projectId:scope.projectId,phase:'needs_attention',status:'paused',taskId:'p1',
  workId:'work-one',lastEvent:{kind:'work_started'},
  pilotBudget:{usage:{p1Continuations:0,nextChatSubmissions:0,totalAutomatedSubmissions:0}}},
 events:[{workflowExecutionStartedEventAttributes:{}},
  {activityTaskScheduledEventAttributes:{activityType:{name:'adoptStartedWork'}}},
  {workflowExecutionCompletedEventAttributes:{}}],
 journal:[{modifiedSinceClaim:false,referencesAttempt:false}],active:[],processes:[],
});
test('exact terminal P1 zero-send proof passes conservatively',()=>{
 const x=assessCompletedCloseout(good());
 assert.equal(x.ready,true);assert.deepEqual(x.activityKinds,['adoptStartedWork']);
});
test('wrong owner, changed execution/run, running and nonterminal all refuse',()=>{
 for(const change of [
  {claim:{...good().claim,workflowId:'other'}},
  {description:{...good().description,runId:'different'}},
  {description:{...good().description,status:{name:'RUNNING'}}},
  {description:{...good().description,type:'flowdeckRecoverSend'}},
  {result:{...good().result,phase:'approved_cycle_finished'}},
  {result:{...good().result,taskId:'p2'}},
  {result:{...good().result,workId:''}},
  {active:[{id:'other'}]}, {processes:['sender']},
 ]){
  const x=assessCompletedCloseout({...good(),...change});assert.equal(x.ready,false,JSON.stringify(change));
 }
});
test('any scheduled send, reconciliation, unknown activity or missing history refuses',()=>{
 for(const name of ['sendContinuationOnce','startNextTaskOnce','recoverPreSendOnce','reconcileSubmittedTurn','unknownFutureBrowserAction']){
  const g=good();g.events.splice(1,0,{activityTaskScheduledEventAttributes:{activityType:{name}}});
  assert.equal(assessCompletedCloseout(g).ready,false,name);
 }
 assert.equal(assessCompletedCloseout({...good(),events:[]}).ready,false);
});
test('any ambiguous or recently modified journal entry refuses',()=>{
 assert.equal(assessCompletedCloseout({...good(),journal:[{modifiedSinceClaim:true,referencesAttempt:false}]}).ready,false);
 assert.equal(assessCompletedCloseout({...good(),journal:[{modifiedSinceClaim:false,referencesAttempt:true}]}).ready,false);
 assert.equal(assessCompletedCloseout({...good(),journal:null}).ready,false);
});
test('zero budget alone cannot authorize closeout',()=>{
 for(const usage of [{p1Continuations:1,nextChatSubmissions:0,totalAutomatedSubmissions:1},
 {p1Continuations:0,nextChatSubmissions:0,totalAutomatedSubmissions:undefined}]){
  const g=good();g.result.pilotBudget.usage=usage;
  assert.equal(assessCompletedCloseout(g).ready,false);
 }
});
async function fixture(t){
 const base=await mkdtemp(join(tmpdir(),'closeout-test-'));
 t.after(()=>rm(base,{recursive:true,force:true}));
 await claimAttemptScope(base,scope);
 const path=attemptScopePath(base,scope),bytes=await readFile(path);
 const claim=JSON.parse(bytes);
 const digest=createHash('sha256').update(bytes).digest('hex');
 const evidence=()=>({claimSha256:digest,claim,assessment:assessCompletedCloseout(good()),
  digest:'evidence-unchanged',journal:[],desc:good().description,result:good().result});
 return {base,path,bytes,digest,evidence};
}
test('preview never mutates claim or writes closeout files',async t=>{
 const f=await fixture(t);
 const x=await closeout({base:f.base,scope,runId,inspect:f.evidence});
 assert.equal(x.ready,true);assert.equal(x.state,'preview');
 assert.deepEqual(await readFile(f.path),f.bytes);
 assert.deepEqual(await readdir(join(f.base,'.state/flowdeck-supervisor')),[join(f.path).split('/').at(-1)]);
});
test('commit requires exact sha, atomically archives old claim and preserves immutable closeout record',async t=>{
 const f=await fixture(t);
 await assert.rejects(closeout({base:f.base,scope,runId,commit:true,inspect:f.evidence}),/claim-sha256/);
 const x=await closeout({base:f.base,scope,runId,commit:true,expectedClaimSha256:f.digest,inspect:f.evidence});
 assert.equal(x.state,'released');assert.equal(x.ready,true);
 assert.equal((await inspectAttemptScope(f.base,scope)).occupied,false);
 assert.deepEqual(await readFile(x.archivedClaim),f.bytes);
 const record=JSON.parse(await readFile(x.closeoutReceipt));
 assert.equal(record.state,'released');assert.equal(record.claimSha256,f.digest);
 assert.equal(record.zeroAutomatedSendActivities,true);
 await assert.rejects(closeout({base:f.base,scope,runId,commit:true,expectedClaimSha256:f.digest,inspect:f.evidence}),/EEXIST/);
});
test('changed claim sha refuses before archive and preserves the old fence',async t=>{
 const f=await fixture(t);
 await assert.rejects(closeout({base:f.base,scope,runId,commit:true,
  expectedClaimSha256:'f'.repeat(64),inspect:f.evidence}),/Scope claim changed/);
 assert.deepEqual(await readFile(f.path),f.bytes);
});
test('concurrent closeout writers cannot both archive or release the same claim',async t=>{
 const f=await fixture(t);
 const both=await Promise.allSettled([0,1].map(()=>closeout({base:f.base,scope,runId,
  commit:true,expectedClaimSha256:f.digest,inspect:f.evidence})));
 assert.equal(both.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(both.filter(x=>x.status==='rejected').length,1);
 assert.equal((await inspectAttemptScope(f.base,scope)).occupied,false);
});
test('evidence changes in second inspection deny release while old claim stays',async t=>{
 const f=await fixture(t);let calls=0;
 const inspect=()=>{calls++;const e=f.evidence();if(calls===2)e.digest='evidence changed';return e;};
 await assert.rejects(closeout({base:f.base,scope,runId,commit:true,
  expectedClaimSha256:f.digest,inspect}),/evidence changed/);
 assert.equal((await inspectAttemptScope(f.base,scope)).occupied,true);
});
