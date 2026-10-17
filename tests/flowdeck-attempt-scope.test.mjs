import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {claimAttemptScope,inspectAttemptScope,attemptScopePath,assertNoRunningFlowdeck,assertAttemptScopeOwner} from '../scripts/flowdeck-attempt-scope.mjs';

const owner={projectId:'pilot',ownerId:'owner',deviceId:'profile-device',
 workflowId:'flowdeck-supervisor-pilot--attempt-one'};
async function base(t){const p=await mkdtemp(join(tmpdir(),'flowdeck-scope-test-'));
 t.after(()=>rm(p,{recursive:true,force:true}));return p;}

test('exclusive device/profile claim permits only one of concurrent different attempt IDs',async t=>{
 const root=await base(t);
 assert.deepEqual((await inspectAttemptScope(root,owner)).occupied,false);
 const options=[{...owner},{...owner,projectId:'another-project',ownerId:'other-owner',
    workflowId:'flowdeck-supervisor-another-project--attempt-two'}];
 const results=await Promise.allSettled(options.map(v=>claimAttemptScope(root,v)));
 assert.equal(results.filter(v=>v.status==='fulfilled').length,1);
 assert.equal(results.filter(v=>v.status==='rejected').length,1);
 assert.match(String(results.find(v=>v.status==='rejected').reason),/already claimed/);
 const occupied=await inspectAttemptScope(root,owner);
 assert.equal(occupied.occupied,true);
 assert.equal(occupied.writes,false);
 assert.ok(options.some(v=>v.workflowId===occupied.record.workflowId));
 assert.equal(occupied.record.disposition,'unresolved_until_audited_reconciliation');
 const files=await readdir(join(root,'.state/flowdeck-supervisor'));
 assert.equal(files.length,1,'no duplicate claim or mutable lock entries');
 assert.match(await readFile(attemptScopePath(root,owner),'utf8'),/flowdeck.attempt-scope\/v1/);
 await assert.rejects(claimAttemptScope(root,{...owner,workflowId:'flowdeck-supervisor-pilot--later'}),/already claimed/);
});
test('scope marker does not expire when its writer process is gone or old run is terminal',async t=>{
 const root=await base(t);
 await claimAttemptScope(root,owner);
 // No liveness inference, PID lease or destructive stale-lock takeover.
 await assert.rejects(claimAttemptScope(root,{...owner,workflowId:'flowdeck-supervisor-pilot--new'}),/already claimed/);
});
test('scope inspection is pure; corrupted evidence and changed browser profile fail closed',async t=>{
 const root=await base(t);
 assert.equal((await inspectAttemptScope(root,owner)).writes,false);
 await claimAttemptScope(root,owner);
 await assert.rejects(inspectAttemptScope(root,{...owner,profile:'other-profile'}),/Invalid device\/browser scope/);
 await assert.rejects(claimAttemptScope(root,{...owner,deviceId:'../bad'}),/Invalid device\/browser scope|Invalid Flowdeck attempt identity/);
 const onDisk=await readFile(attemptScopePath(root,owner),'utf8');
 assert.equal(JSON.parse(onDisk).workflowId,owner.workflowId);
});
test('running Flowdeck workflows from either activity type block fresh attempts',async()=>{
 for(const type of ['flowdeckSupervisor','flowdeckRecoverSend']){
  const values=[{type:'other',status:{name:'RUNNING'},workflowId:'other'},
   {type,taskQueue:'flowdeck-supervisor',workflowId:'flowdeck-supervisor-pilot--old',status:{name:'RUNNING'}}];
  let query;
  await assert.rejects(assertNoRunningFlowdeck(async function*(opts){query=opts.query;yield* values;}),/Existing running Flowdeck/);
  assert.equal(query,"ExecutionStatus = 'Running'");
 }
});
test('only terminal or unrelated workflow visibility is eligible; unavailable visibility refuses',async()=>{
 const results=[{type:'flowdeckSupervisor',status:{name:'COMPLETED'}},
 {type:'other',status:{name:'RUNNING'}}];
 await assertNoRunningFlowdeck(async function*(){yield* results;});
 await assert.rejects(assertNoRunningFlowdeck(async function*(){throw Error('visibility unavailable');}),/visibility unavailable/);
});

test('recovery release requires the exact recorded owner/project/device/workflow fence',async t=>{
 const root=await base(t);
 await assert.rejects(assertAttemptScopeOwner(root,owner),/absent or belongs/);
 await claimAttemptScope(root,owner);
 assert.equal((await assertAttemptScopeOwner(root,owner)).workflowId,owner.workflowId);
 for(const override of [{workflowId:'flowdeck-supervisor-pilot--other'}, {projectId:'other'}, {ownerId:'other'}])
  await assert.rejects(assertAttemptScopeOwner(root,{...owner,...override}),/absent or belongs/);
});

test('two independent Node processes cannot both claim the browser owner scope',async t=>{
 const root=await base(t);
 const source=new URL('../scripts/flowdeck-attempt-scope.mjs',import.meta.url).href;
 const expression=`import {claimAttemptScope} from ${JSON.stringify(source)};await claimAttemptScope(process.argv[1],JSON.parse(process.argv[2]));`;
 const execute=promisify(execFile);
 const contenders=[owner,{...owner,workflowId:'flowdeck-supervisor-pilot--parallel'}];
 const outcomes=await Promise.allSettled(contenders.map(scope=>
  execute(process.execPath,['--input-type=module','--eval',expression,root,JSON.stringify(scope)],{timeout:5000})));
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
 assert.match(String(outcomes.find(r=>r.status==='rejected').reason),/already claimed/);
 const claim=await inspectAttemptScope(root,owner);
 assert.ok(claim.occupied);
 assert.ok(contenders.some(c=>c.workflowId===claim.record.workflowId));
});
