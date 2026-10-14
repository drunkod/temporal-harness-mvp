import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {captureReportBinding,compareReportBindings,receiptMatchesBinding}
  from '../dist/sashai-report-binding.js';
import {reverifyReportEvidence} from '../dist/sashai-report-temporal-activities.js';

test('post-resume report acceptance identity includes original attempt, chat, contract, artifact and send claim',async()=>{
 const root=resolve('.');
 const binding=await captureReportBinding(root);
 const old=JSON.parse(await readFile(join(root,'.state/report-review-dispatch/attempt.json'),'utf8'));
 assert.equal(binding.attemptId,old.nonce);
 const receipt={
  taskId:binding.taskId,attemptId:binding.attemptId,chatUrl:binding.chat,
  taskContractSha256:binding.contractSha256,reportPath:binding.artifactPath,
  reportSha256:binding.artifactSha256
 };
 assert.equal(receiptMatchesBinding(binding,receipt).matches,true);
 const keyCases=[
  ['taskId','unrelated-task'],['attemptId','00000000-0000-0000-0000-000000000000'],
  ['chat','https://chatgpt.com/wrong-chat'],['contractSha256','f'.repeat(64)],
  ['artifactPath','/tmp/other.md'],['artifactSha256','f'.repeat(64)],
  ['sendClaimSha256','0'.repeat(64)]
 ];
 for(const [key,value] of keyCases){
  const bad={...binding,[key]:value};
  const result=compareReportBindings(binding,bad);
  assert.equal(result.matches,false,'change to '+key+' must be rejected');
  assert.ok(result.differences.includes(key));
 }
 for(const [key,value] of [
  ['taskId','other'],['attemptId','00000000-0000-0000-0000-000000000000'],
  ['chatUrl','https://chatgpt.com/other'],
  ['taskContractSha256','f'.repeat(64)],['reportPath','/tmp/other.md'],
  ['reportSha256','f'.repeat(64)]
 ]){
  const result=receiptMatchesBinding(binding,{...receipt,[key]:value});
  assert.equal(result.matches,false,'receipt change to '+key+' must be rejected');
 }
});
test('read-only real verifier rejects swapped attempt ID after resume, without altering historical evidence',async()=>{
 const original=await captureReportBinding(resolve('.'));
 const good=await reverifyReportEvidence(original);
 assert.equal(good.verified,true);
 assert.equal(good.identity?.attemptId,original.attemptId);
 for(const [field,value] of [
  ['attemptId','00000000-0000-0000-0000-000000000000'],
  ['contractSha256','e'.repeat(64)],['chat','https://chatgpt.com/changed'],
  ['artifactSha256','f'.repeat(64)]
 ]){
  const failed=await reverifyReportEvidence({...original,[field]:value});
  assert.equal(failed.verified,false,'mismatch '+field+' cannot be accepted');
  assert.equal(failed.identityMatched,false);
  assert.ok(failed.unmet.some(u=>u.includes(field)));
 }
});
