import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {Connection,Client} from '@temporalio/client';
import {contractBindingMatches,readReportReviewStatus} from '../dist/sashai-report-status.js';

const root=resolve('.');
const state=join(root,'.state','report-review-dispatch');
test('current status refuses stale report approval if contract or persisted attempt changes',async()=>{
 const [attempt,acceptance,contract]=await Promise.all([
  readFile(join(state,'attempt.json'),'utf8').then(JSON.parse),
  readFile(join(state,'acceptance.json'),'utf8').then(JSON.parse),
  readFile(join(root,'docs','SASHAI-ARCHITECTURE-REVIEW-TASK.md'))
 ]);
 assert.equal(contractBindingMatches(attempt,acceptance,contract),true);
 assert.equal(contractBindingMatches(attempt,acceptance,Buffer.concat([contract,Buffer.from('tampered')])),false);
 assert.equal(contractBindingMatches({...attempt,taskContractSha256:'0'.repeat(64)},acceptance,contract),false);
 assert.equal(contractBindingMatches(attempt,{...acceptance,taskContractSha256:'f'.repeat(64)},contract),false);
 const live=await readReportReviewStatus();
 assert.equal(live.currentBindingValid,true);
 assert.equal(live.historicalAcceptance,'verified_report');
 assert.equal(live.evidenceScope,'legacy_git_status_and_unstaged_diff_only');
});

test('Temporal review adoption recovered worker restart and ended without dispatch authority',async t=>{
 const contract=await readFile(join(root,'docs','SASHAI-ARCHITECTURE-REVIEW-TASK.md'));
 const workflowId='sashai-report-review-'+createHash('sha256').update(contract).digest('hex').slice(0,20);
 let connection;
 try{connection=await Connection.connect({address:'127.0.0.1:7233'});}
 catch(e){t.skip('No Temporal server: '+e.message);return;}
 try{
  const client=new Client({connection,namespace:'default'});
  let described;
  try{described=await client.workflow.getHandle(workflowId).describe();}
  catch(e){t.skip('No recorded restart proof: '+e.message);return;}
  assert.equal(described.status.name,'COMPLETED');
  const result=await client.workflow.getHandle(workflowId).result();
  assert.equal(result.stage,'verified_approval_boundary');
  assert.equal(result.acceptance,'verified_report');
  assert.equal(result.sendObserved,true);
  assert.equal(result.correctionObserved,true);
  assert.equal(result.dispatchPermitted,false);
  assert.equal(result.nextTaskPermitted,false);
  assert.equal(result.runMode,'read_only_adoption');
 }finally{await connection.close();}
});
