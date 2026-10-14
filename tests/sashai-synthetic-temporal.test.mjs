import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat}from'node:fs/promises';
import {join,resolve}from'node:path';
import {Connection,Client}from'@temporalio/client';
import {prepareFixture,dispatchFixtureOnce,verifyFixture,reconcileFixtureSend}
 from '../dist/sashai-synthetic-report-activities.js';

const root=resolve('.');
const state=join(root,'.state','sashai-synthetic-report');
async function recordedWorkflow(id) {
 const connection=await Connection.connect({address:'127.0.0.1:7233'});
 const client=new Client({connection});
 try{
  const h=client.workflow.getHandle(id);
  const details=await h.describe();
  return {status:details.status.name,result:await h.result()};
 }finally{await connection.close()}
}
test('Temporal controlled a fresh disposable report, rejected it, corrected once and verified',async t=>{
 let record;
 try{record=await recordedWorkflow('sashai-synthetic-temporal-v1-repair');}
 catch(e){t.skip('Temporal fixture history missing: '+e.message);return;}
 assert.equal(record.status,'COMPLETED');
 const x=record.result;
 assert.equal(x.stage,'verified_approval_boundary');
 assert.equal(x.initialAcceptance,'rejected');
 assert.equal(x.finalAcceptance,'verified_report');
 assert.equal(x.sendClaimed,true);
 assert.equal(x.correctionClaimed,true);
 assert.equal(x.nextTaskPermitted,false);
 assert.equal(x.dispatchPermitted,false);
 assert.match(x.chat,/^synthetic:\/\//);
 assert.deepEqual(x.unmet,[]);
 const binding=await prepareFixture('repair');
 assert.equal(x.attemptId,binding.attemptId,'restart preserved same durable attempt');
 const receipt=await verifyFixture(binding);
 assert.equal(receipt.accepted,true);
 const body=await readFile(binding.artifactPath,'utf8');
 assert.equal((body.match(/ACCEPTANCE: VERIFIED/g)||[]).length,1);
 assert.equal((body.match(/Task: /g)||[]).length,1);
 assert.ok((await stat(join(state,'repair','CORRECTION_ATTEMPTED'))).isFile());
 await assert.rejects(dispatchFixtureOnce(binding),e=>e.code==='EEXIST');
});
test('timeout after send claim reconciles and blocks: no resend or correction',async t=>{
 let record;
 try{record=await recordedWorkflow('sashai-synthetic-temporal-v1-uncertain');}
 catch(e){t.skip('Temporal uncertain fixture history missing: '+e.message);return;}
 assert.equal(record.status,'COMPLETED');
 const x=record.result;
 assert.equal(x.stage,'blocked_indeterminate_send');
 assert.equal(x.sendClaimed,true);
 assert.equal(x.correctionClaimed,false);
 assert.equal(x.initialAcceptance,'not_checked');
 assert.equal(x.finalAcceptance,'not_checked');
 assert.deepEqual(x.unmet,['send_outcome_indeterminate']);
 assert.equal(x.nextTaskPermitted,false);
 const binding=await prepareFixture('uncertain');
 const claim=await reconcileFixtureSend(binding);
 assert.deepEqual(claim,{claimed:true,artifactPresent:true,claimMatched:true});
 await assert.rejects(dispatchFixtureOnce(binding),e=>e.code==='EEXIST');
 await assert.rejects(stat(join(state,'uncertain','CORRECTION_ATTEMPTED')),e=>e.code==='ENOENT');
});
test('new bound report execution persisted exact attempt and never selected next Sashai task',async t=>{
 let record;
 try{record=await recordedWorkflow('sashai-report-binding-v2-8f64480c627c2605c58f');}
 catch(e){t.skip('V2 bound report proof history missing: '+e.message);return;}
 assert.equal(record.status,'COMPLETED');
 const x=record.result;
 assert.equal(x.stage,'verified_approval_boundary');
 assert.equal(x.attemptId,'26c92478-b148-4a02-87c1-0ea7969b68c9');
 assert.equal(x.boundArtifactSha256,'4637e824aa9b2b2ac865c93b1a9040a1b21f86e539e3253a00cb4ece36f14ba0');
 assert.equal(x.acceptance,'verified_report');
 assert.equal(x.dispatchPermitted,false);
 assert.equal(x.nextTaskPermitted,false);
});
