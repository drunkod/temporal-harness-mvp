import test from 'node:test';
import assert from 'node:assert/strict';
import{validateAutonomyPolicy,autonomyPolicyDigest,sha256,
 emptyAutonomousUsage,reserveAutonomousSend,decideAutonomousDispatch}from'../dist/flowdeck-autonomy-policy.js';
import{parseCheckArgs,runCheck,stageCommands}from'../scripts/flowdeck-check.mjs';
const now=Date.parse('2026-10-18T12:00:00Z');
const project=()=>({id:'sashai-autonomous-fixture-01',ownerId:'fixture-owner-001',
 deviceId:'fixture-device-001',repo:'/tmp/flowdeck-test/approved-root',
 projectUrl:'https://chatgpt.com/g/g-p-fixture/project',
 initialTaskId:'fixture-p1',tasks:[
 {id:'fixture-p1',title:'P1',instruction:'first'},
 {id:'fixture-p2',title:'P2',instruction:'second'}
 ]});
const policy=()=>{
 const p=project();
 return{schema:'flowdeck.autonomy-policy/v1',mode:'automatic-initial-send',
 interactive:false,environment:'synthetic',profile:'helium-profile-4',
 taskSource:'approved-active-plan',projectId:p.id,projectUrl:p.projectUrl,
 ownerId:p.ownerId,deviceId:p.deviceId,worktree:p.repo,
 allowedRoot:'/tmp/flowdeck-test',
 planSha256:sha256('approved plan fixture'),
 enabledTaskIds:p.tasks.map(t=>t.id),
 instructionHashes:p.tasks.map(t=>sha256(t.instruction)),
 campaignId:'campaign-fixture-001',
 validFrom:'2026-10-18T11:00:00Z',validUntil:'2026-10-18T14:00:00Z',
 maxTasksPerRun:2,maxContinuationsPerTask:1,p2Continuations:0,maxSubmissionsPerRun:3,
 maxCampaignRuns:2,maxCampaignSubmissions:6,maxRunDurationMinutes:60,
 automaticSuccessfulCloseout:true,uncertainSend:'quarantine',identityConflict:'quarantine',
 reviewRequiredBeforeDependentTask:true};
};
test('fully scoped policy accepts exactly approved synthetic authority',()=>{
 const p=policy(),v=validateAutonomyPolicy(p,project(),'approved plan fixture',now);
 assert.equal(v,p);assert.match(autonomyPolicyDigest(v),/^[0-9a-f]{64}$/);
 assert.equal(validateAutonomyPolicy(structuredClone(p),project(),'approved plan fixture',now).projectId,p.projectId);
});
test('all unsafe changes fail closed',()=>{
 const changes=[
  ['schema','bogus'],['mode','manual-initial-send'],['interactive',true],
  ['environment','production'],['profile','not-owner'],['taskSource','prompt'],
  ['maxTasksPerRun',4],['maxContinuationsPerTask',2],['p2Continuations',1],
  ['maxSubmissionsPerRun',4],['maxCampaignRuns',3],['maxCampaignSubmissions',7],
  ['maxRunDurationMinutes',600],['automaticSuccessfulCloseout',false],
  ['uncertainSend','retry'],['identityConflict','accept'],
  ['reviewRequiredBeforeDependentTask',false],
  ['projectId','sashai-fresh-attended-20261018-08'],['worktree','/tmp/elsewhere'],
  ['planSha256','abc'],['validFrom','2026-10-19T00:00:00Z'],
  ['validUntil','2026-10-18T11:00:00Z'],
  ['enabledTaskIds',['fixture-p1','fixture-p1']],['instructionHashes',['a'.repeat(64),'x']],
  ['campaignId','']
 ];
 for(const [key,value]of changes){
  const p=policy();p[key]=value;
  assert.throws(()=>validateAutonomyPolicy(p,project(),'approved plan fixture',now),undefined,key);
 }
 const p=policy();p.unapproved=true;
 assert.throws(()=>validateAutonomyPolicy(p,project(),'approved plan fixture',now),/unknown/);
 delete p.unapproved;delete p.ownerId;
 assert.throws(()=>validateAutonomyPolicy(p,project(),'approved plan fixture',now),/missing/);
});
test('approved task, prompt, plan, scope and identity are externally sealed',()=>{
 for(const mismatch of [
  q=>q.tasks[1].instruction+=' mutated',
  q=>q.tasks[0].dependsOn=['another-task'],
  q=>q.tasks[0].requiresReviewBeforeNext=true,
  q=>q.ownerId='different',
  q=>q.deviceId='different',
  q=>q.repo='/tmp/not-approved',
  q=>q.initialTaskId='fixture-p2',
  q=>q.projectUrl='https://chatgpt.com/g/other/project',
 ]){
  const q=project();mismatch(q);
  assert.throws(()=>validateAutonomyPolicy(policy(),q,'approved plan fixture',now));
 }
 assert.throws(()=>validateAutonomyPolicy(policy(),project(),'changed plan',now),/plan changed/);
});
test('autonomous three-send ordering counts attempts and never refunds',()=>{
 const p=validateAutonomyPolicy(policy(),project(),'approved plan fixture',now);
 let usage=emptyAutonomousUsage();
 assert.deepEqual(reserveAutonomousSend(p,usage,'initial_p2'),{allowed:false,reason:'dispatch_sequence_invalid'});
 for(const kind of ['initial_p1','continue_p1','initial_p2']){
  const result=reserveAutonomousSend(p,usage,kind);
  assert.equal(result.allowed,true);
  usage=result.usage;
 }
 assert.deepEqual(usage,{initialP1:1,p1Continuations:1,initialP2:1,total:3});
 assert.deepEqual(reserveAutonomousSend(p,usage,'initial_p1'),{allowed:false,reason:'run_budget_exhausted'});
 assert.equal(reserveAutonomousSend(p,{...usage,total:2},'initial_p1').allowed,false);
});
test('conflicts outrank missing identity and attempted send never clicks twice',()=>{
 const e={policyValid:true,scopeOwned:true,conflict:false,previouslyAttempted:false,
  submissionReconciled:false,observationComplete:true,deadlineExceeded:false,remainingReservations:3};
 assert.deepEqual(decideAutonomousDispatch(e),{action:'submit_once'});
 assert.deepEqual(decideAutonomousDispatch({...e,conflict:true,observationComplete:false}),{action:'blocked',reason:'identity_or_prompt_conflict'});
 assert.deepEqual(decideAutonomousDispatch({...e,observationComplete:false}),{action:'observe'});
 assert.deepEqual(decideAutonomousDispatch({...e,previouslyAttempted:true}),{action:'observe'});
 assert.deepEqual(decideAutonomousDispatch({...e,previouslyAttempted:true,deadlineExceeded:true}),{action:'blocked',reason:'submission_unresolved_no_resend'});
 assert.deepEqual(decideAutonomousDispatch({...e,previouslyAttempted:true,submissionReconciled:true}),{action:'advance'});
 assert.equal(decideAutonomousDispatch({...e,remainingReservations:0}).action,'blocked');
 assert.equal(decideAutonomousDispatch({...e,policyValid:false}).action,'blocked');
});
test('noninteractive runner defaults to offline and rejects live without policy',async()=>{
 const opts=parseCheckArgs(['--non-interactive']);
 assert.equal(opts.profile,'offline');
 assert.throws(()=>parseCheckArgs(['--profile','live','--non-interactive']),/scoped_policy_required/);
 assert.throws(()=>parseCheckArgs(['--profile','bad','--non-interactive']));
 assert.throws(()=>parseCheckArgs(['--profile','offline']),/non_interactive_required/);
 assert.equal(stageCommands('offline')[0].stage,'fixtures');
 const blocked=await runCheck(['--profile','live','--non-interactive']);
 assert.equal(blocked.code,2);assert.equal(blocked.outcome,'blocked');
});
test('runner stops on first failing stage; never escalates or logs raw child output',async()=>{
 const seen=[];
 const r=await runCheck(['--non-interactive'],{
  stageCommands:()=>[{stage:'one'},{stage:'two'}],
  execStage:async x=>{seen.push(x.stage);return{stage:x.stage,exitCode:3,timedOut:false,elapsedMs:5,outputTail:'sensitive'};}
 });
 assert.deepEqual(seen,['one']);assert.equal(r.code,3);
 assert.equal(JSON.stringify(r).includes('sensitive'),false);
 const pass=await runCheck(['--non-interactive'],{
  stageCommands:()=>[{stage:'offline fixture'}],
  execStage:async x=>({stage:x.stage,exitCode:0,timedOut:false,elapsedMs:1,outputTail:'ok'})
 });
 assert.equal(pass.outcome,'passed');
});

test('autonomous lifecycle entrypoint never reuses manual launcher or sends on invalid setup',async()=>{
 const{prepareAutonomousRun}=await import('../scripts/flowdeck-run.mjs');
 const a=await prepareAutonomousRun(['--non-interactive']);
 assert.equal(a.status,'blocked');assert.equal(a.reason,'scoped_policy_required');
 const b=await prepareAutonomousRun(['--non-interactive','--policy','/tmp/policy.json'],{
  checkPolicy:async()=>({policy:{environment:'synthetic'},hash:'a'.repeat(64)})});
 assert.equal(b.reason,'live_requires_local_live_policy');
 const c=await prepareAutonomousRun(['--non-interactive','--policy','/tmp/policy.json'],{
  checkPolicy:async()=>({policy:{environment:'local-live'},hash:'b'.repeat(64)})});
 assert.equal(c.status,'blocked');assert.equal(c.reason,'autonomous_preconditions_incomplete');
 assert(c.blockers.includes('productionActivities'));
 assert(c.blockers.includes('durableRunController'));
 assert.equal(c.exitCode,2);
 assert.equal(c.policyDigest,'b'.repeat(64));
});

test('autonomous entrypoint executes only an actual injected production runtime, never capability booleans',async()=>{
 const {prepareAutonomousRun}=await import('../scripts/flowdeck-run.mjs');
 const policy={environment:'local-live',campaignId:'campaign-verified-01'};
 const digest='b'.repeat(64);let constructs=0,runs=0;
 const result=await prepareAutonomousRun(['--non-interactive','--policy','/tmp/standing.json'],{
  checkPolicy:async()=>({policy,hash:digest}),
  capabilities:{productionActivities:true,machineWideBrowserOwnership:true,durableRunController:true,
   sourceEventReconciliation:true,restartAndCancellationFencing:true,evidenceBackedAutomaticCloseout:true,historyReplayValidated:true},
  productionRuntime:async config=>{
   constructs++;assert.equal(config.policyDigest,digest);
   return {runToRetired:async()=>{runs++;return {manifest:{state:'retired',policyDigest:digest,campaignId:policy.campaignId,
    workflowId:'workflow-verified-0001',runId:'run-verified-0001',businessResult:{status:'completed'},
    closeoutReceipt:{receiptSha256:'a'.repeat(64)}}};}};
  }
 });
 assert.equal(result.status,'completed');assert.equal(result.exitCode,0);assert.equal(constructs,1);assert.equal(runs,1);
 const noRuntime=await prepareAutonomousRun(['--non-interactive','--policy','/tmp/standing.json'],{
  checkPolicy:async()=>({policy,hash:digest}),
  capabilities:{productionActivities:true,machineWideBrowserOwnership:true,durableRunController:true,
   sourceEventReconciliation:true,restartAndCancellationFencing:true,evidenceBackedAutomaticCloseout:true,historyReplayValidated:true}});
 assert.equal(noRuntime.status,'blocked');
 const malformed=await prepareAutonomousRun(['--non-interactive','--policy','/tmp/standing.json'],{
  checkPolicy:async()=>({policy,hash:digest}),productionRuntime:async()=>({})});
 assert.equal(malformed.reason,'production_composition_incomplete');
});

test('browser-no-send refuses occupied or unverifiable scope without touching browser',async()=>{
 let executions=0;
 const result=await runCheck(['--profile','browser-no-send','--policy','/tmp/unused.json','--non-interactive'],{
  checkPolicy:async()=>({policy:{environment:'local-live',deviceId:'fixture-device'},hash:'c'.repeat(64)}),
  verifyBrowserNoSendSafety:async()=>{throw Error('occupied')},
  execStage:async()=>{executions++;return{exitCode:0}}
 });
 assert.equal(result.outcome,'blocked');assert.equal(result.code,2);assert.equal(executions,0);
 const ok=await runCheck(['--profile','browser-no-send','--policy','/tmp/unused.json','--non-interactive'],{
  checkPolicy:async()=>({policy:{environment:'local-live',deviceId:'fixture-device'},hash:'c'.repeat(64)}),
  verifyBrowserNoSendSafety:async()=>{},
  stageCommands:()=>[{stage:'fake_no_send'}],
  execStage:async stage=>({stage:stage.stage,exitCode:0,elapsedMs:1,timedOut:false,signal:null,outputTail:'ok'})
 });
 assert.equal(ok.outcome,'passed');
});
