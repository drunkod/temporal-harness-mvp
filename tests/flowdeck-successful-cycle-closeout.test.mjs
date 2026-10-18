import test from 'node:test';
import assert from 'node:assert/strict';
import{mkdtemp,mkdir,readFile,writeFile,stat}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{createHash}from'node:crypto';
import{assessSuccessfulCycleCloseout,requireMatchingSuccessfulPreview,archiveValidatedSuccessfulClaim}
 from'../scripts/flowdeck-successful-cycle-closeout-20261018-08.mjs';
const SHA='0de1c4b90d280e2211262a2f2a413c53ba677d2d40b0f75618e6d164df62fd97';
const ok=()=>({
 scopeValid:true,
 terminal:{exact:true,success:true,budgetExact:true,bothImplementationDone:true,reviewPending:true},
 history:{closed:true,eventCount:977,signals:6,activityCount:98,unresolved:0,unknown:0,
  p1SentActivities:1,p2SentActivities:1,recoveryActivities:0,allDispatchesCompleted:true},
 journals:{dispatches:2,p1Reconciled:true,p2Reconciled:true,fullSealsMatch:true,
  noExtraAttemptDispatches:true,noExtraAttemptSendClaims:true},
 source:{count:3,workIdsExact:true,outcomesExact:true,taskAndWorktreeMatch:true,withinAttemptWindow:true},
 inbox:{exactSix:true,allSixDelivered:true,outcomesMatch:true,noPending:true},
 browser:{bothExactTabs:true,taskAndWorktreeMatch:true,userCountsMatch:true,sealedPromptsMatch:true,
  initialManualSealMatch:true,distinctChats:true},
 outputs:{bothHashesMatch:true,contentsTaskMatched:true,intendedStructure:true},
 operations:{runningWorkflows:0,localSenders:0}
});
test('terminal successful two-send attempt passes only with all evidence',()=>{
 assert.deepEqual(assessSuccessfulCycleCloseout(ok()),{ready:true,blockers:[]});
});
test('wrong run, pause, extra send, unreconciled journal, missing seals and sender refuse',()=>{
 const mutations=[
  ['scopeValid',null,false],
  ['terminal','exact',false],['terminal','success',false],['terminal','budgetExact',false],
  ['terminal','bothImplementationDone',false],['terminal','reviewPending',false],
  ['history','closed',false],['history','eventCount',976],['history','signals',5],
  ['history','activityCount',97],['history','unresolved',1],['history','unknown',1],
  ['history','p1SentActivities',0],['history','p1SentActivities',2],
  ['history','p2SentActivities',0],['history','p2SentActivities',2],
  ['history','recoveryActivities',1],['history','allDispatchesCompleted',false],
  ['journals','dispatches',1],['journals','dispatches',3],
  ['journals','p1Reconciled',false],['journals','p2Reconciled',false],
  ['journals','fullSealsMatch',false],['journals','noExtraAttemptDispatches',false],
  ['journals','noExtraAttemptSendClaims',false],
  ['source','count',2],['source','count',4],['source','workIdsExact',false],
  ['source','outcomesExact',false],['source','taskAndWorktreeMatch',false],
  ['source','withinAttemptWindow',false],
  ['inbox','exactSix',false],['inbox','allSixDelivered',false],
  ['inbox','outcomesMatch',false],['inbox','noPending',false],
  ['browser','bothExactTabs',false],['browser','taskAndWorktreeMatch',false],
  ['browser','userCountsMatch',false],['browser','sealedPromptsMatch',false],
  ['browser','initialManualSealMatch',false],['browser','distinctChats',false],
  ['outputs','bothHashesMatch',false],['outputs','contentsTaskMatched',false],
  ['outputs','intendedStructure',false],
  ['operations','runningWorkflows',1],['operations','localSenders',1]
 ];
 for(const [family,field,value] of mutations){
  const x=ok();if(field===null)x[family]=value;else x[family][field]=value;
  const result=assessSuccessfulCycleCloseout(x);
  assert.equal(result.ready,false,family+'.'+field+'='+value);
  assert.ok(result.blockers.length>0,family+'.'+field);
 }
});
test('missing categories and incomplete evidence always refuse',()=>{
 for(const key of Object.keys(ok())){const x=ok();delete x[key];
  assert.equal(assessSuccessfulCycleCloseout(x).ready,false,key)}
 assert.equal(assessSuccessfulCycleCloseout(undefined).ready,false);
 assert.equal(assessSuccessfulCycleCloseout({}).ready,false);
});
test('only exact same ready preview claim and evidence hashes permit apply',()=>{
 const before={assessment:{ready:true},claimSha256:'1'.repeat(64),digest:'2'.repeat(64)};
 assert.equal(requireMatchingSuccessfulPreview(before,before.claimSha256,before.digest),true);
 for(const [a,b]of [['0'.repeat(64),before.digest],[before.claimSha256,'0'.repeat(64)]]){
  assert.throws(()=>requireMatchingSuccessfulPreview(before,a,b),/claim\/evidence differs/)}
 assert.throws(()=>requireMatchingSuccessfulPreview({...before,assessment:{ready:false}},
  before.claimSha256,before.digest),/evidence not reconciled/);
});
async function fixture(t){
 const base=await mkdtemp(join(tmpdir(),'flowdeck-successful-closeout-'));
 t.after(async()=>{const{rm}=await import('node:fs/promises');await rm(base,{recursive:true,force:true})});
 const folder=join(base,'completed-closeouts');await mkdir(folder);
 const claimPath=join(base,'occupied-claim.json'),bytes=Buffer.from('exact scope owner claim\n');
 await writeFile(claimPath,bytes);
 const suffix='fixture';
 return {claimPath,claimSha256:createHash('sha256').update(bytes).digest('hex'),
  lock:join(base,'owner-locked-'+suffix+'.lock'),folder,
  intent:join(folder,'intent-'+suffix+'.json'),archive:join(folder,'archived-'+suffix+'.json'),
  receipt:join(folder,'receipt-'+suffix+'.json'),
  record:{schema:'flowdeck.successful-cycle-retirement/v1',workflowId:'exact-fixture-workflow',
   runId:'exact-fixture-run',projectId:'fixture',usedAutomatedBudget:2},verifyLocked:async()=>true,
  bytes};
}
async function exists(file){try{await stat(file);return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
test('valid fixture apply locks, durably archives only exact claim and writes final receipt',async t=>{
 const x=await fixture(t);
 const result=await archiveValidatedSuccessfulClaim(x);
 assert.equal(result.state,'retired');
 assert.equal(await exists(x.claimPath),false);
 assert.deepEqual(await readFile(x.archive),x.bytes);
 const receipt=JSON.parse(await readFile(x.receipt,'utf8'));
 assert.equal(receipt.state,'retired');
 assert.equal(receipt.workflowId,'exact-fixture-workflow');
 assert.equal(receipt.runId,'exact-fixture-run');
 assert.equal(await exists(x.lock),true);
 assert.equal(await exists(x.intent),true);
 await assert.rejects(archiveValidatedSuccessfulClaim(x),/EEXIST/);
 assert.deepEqual(await readFile(x.archive),x.bytes);
});
test('changed claim after preview refuses to archive and retains durable lock',async t=>{
 const x=await fixture(t);
 await writeFile(x.claimPath,'changed after preview\n');
 await assert.rejects(archiveValidatedSuccessfulClaim(x),/claim changed before rename/);
 assert.equal(await exists(x.claimPath),true);
 assert.equal(await exists(x.archive),false);
 assert.equal(await exists(x.receipt),false);
 assert.equal(await exists(x.lock),true);
});
test('recheck mismatch under lock refuses without writing intent or archive',async t=>{
 const x=await fixture(t);
 x.verifyLocked=async()=>false;
 await assert.rejects(archiveValidatedSuccessfulClaim(x),/evidence changed during locked validation/);
 assert.equal(await exists(x.claimPath),true);
 assert.equal(await exists(x.intent),false);
 assert.equal(await exists(x.archive),false);
 assert.equal(await exists(x.receipt),false);
 assert.equal(await exists(x.lock),true);
});
