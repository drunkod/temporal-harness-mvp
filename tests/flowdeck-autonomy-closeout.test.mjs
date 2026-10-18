import test from'node:test';
import assert from'node:assert/strict';
import{mkdtemp,rm,writeFile,readFile,stat}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{sha256}from'../dist/flowdeck-autonomy-policy.js';
import{archiveAutonomousSuccess,validateAutonomousSuccessEvidence}from'../dist/flowdeck-autonomy-closeout.js';
const e=()=>({workflowId:'flowdeck-autonomous-new-fixture',runId:'run-autonomous-01',
 projectId:'project-autonomous-01',claimSha256:sha256('claim-fixture'),
 evidenceDigest:sha256('verified-evidence'),terminalSuccess:true,allSendsReconciled:true,
 allSessionsReported:true,allEventsDelivered:true,promptSealsMatch:true,
 artifactsVerified:true,noSenders:true});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'flowdeck-autonomous-closeout-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const paths=Object.fromEntries(['claim','intent','archive','receipt','lock'].map(k=>[k,join(dir,k+'.json')]));
 await writeFile(paths.claim,'claim-fixture');
 const evidence=e();
 return{paths,evidence,verify:async()=>evidence};
}
async function exists(path){try{await stat(path);return true}catch(x){if(x.code==='ENOENT')return false;throw x}}
test('exact successful evidence archives one claim; repeat returns the same receipt',async t=>{
 const x=await fixture(t);
 const a=await archiveAutonomousSuccess(x.evidence,x.paths,{verify:x.verify});
 assert.deepEqual(a,{state:'retired',recovered:false});
 assert.equal(await exists(x.paths.claim),false);
 assert.equal(sha256(await readFile(x.paths.archive)),x.evidence.claimSha256);
 const receiptBefore=await readFile(x.paths.receipt);
 const repeated=await archiveAutonomousSuccess(x.evidence,x.paths,{verify:x.verify,resume:true});
 assert.deepEqual(repeated,{state:'retired',recovered:true});
 assert.deepEqual(await readFile(x.paths.receipt),receiptBefore);
 assert.equal(await exists(x.paths.lock),true);
});
test('crash after intent is resumable with same evidence; never a second claim',async t=>{
 const x=await fixture(t);
 await assert.rejects(archiveAutonomousSuccess(x.evidence,x.paths,{
  verify:x.verify,afterPhase:async p=>{if(p==='intent')throw Error('simulated crash')}
 }),/simulated crash/);
 assert.equal(await exists(x.paths.claim),true);
 assert.equal(await exists(x.paths.intent),true);
 assert.equal(await exists(x.paths.archive),false);
 await assert.rejects(archiveAutonomousSuccess(x.evidence,x.paths,{verify:x.verify}),/existing durable lock/);
 assert.deepEqual(await archiveAutonomousSuccess(x.evidence,x.paths,{verify:x.verify,resume:true}),
  {state:'retired',recovered:true});
});
test('crash after archive is resumable without a second rename',async t=>{
 const x=await fixture(t);
 await assert.rejects(archiveAutonomousSuccess(x.evidence,x.paths,{
  verify:x.verify,afterPhase:async p=>{if(p==='archive')throw Error('simulated crash after archive')}
 }),/after archive/);
 assert.equal(await exists(x.paths.claim),false);
 assert.equal(await exists(x.paths.archive),true);
 assert.equal(await exists(x.paths.receipt),false);
 assert.deepEqual(await archiveAutonomousSuccess(x.evidence,x.paths,{verify:x.verify,resume:true}),
  {state:'retired',recovered:true});
});
test('unknown sender, failed workflow, unverified sends, or changed claim always blocks',async t=>{
 for(const field of ['terminalSuccess','allSendsReconciled','allSessionsReported',
  'allEventsDelivered','promptSealsMatch','artifactsVerified','noSenders']){
  const e2=e();e2[field]=false;
  assert.throws(()=>validateAutonomousSuccessEvidence(e2),/evidence incomplete/);
 }
 const x=await fixture(t);
 await writeFile(x.paths.claim,'changed claim after preview');
 await assert.rejects(archiveAutonomousSuccess(x.evidence,x.paths,{verify:x.verify}),/claim missing or changed/);
 assert.equal(await exists(x.paths.archive),false);
 assert.equal(await exists(x.paths.lock),true);
});
test('changed evidence under lock remains quarantined and no receipt appears',async t=>{
 const x=await fixture(t);
 await assert.rejects(archiveAutonomousSuccess(x.evidence,x.paths,{
  verify:async()=>({...x.evidence,evidenceDigest:sha256('different')})
 }),/evidence changed/);
 assert.equal(await exists(x.paths.claim),true);
 assert.equal(await exists(x.paths.receipt),false);
 assert.equal(await exists(x.paths.lock),true);
});
test('resuming different workflow or changed evidence is refused',async t=>{
 const x=await fixture(t);
 await assert.rejects(archiveAutonomousSuccess(x.evidence,x.paths,{
  verify:x.verify,afterPhase:async p=>{if(p==='locked')throw Error('crashed')}
 }),/crashed/);
 await assert.rejects(archiveAutonomousSuccess({...x.evidence,runId:'another-run'},x.paths,{
  verify:x.verify,resume:true
 }),/another run/);
 await assert.rejects(archiveAutonomousSuccess({...x.evidence,evidenceDigest:sha256('new')},x.paths,{
  verify:x.verify,resume:true
 }),/another run/);
});
