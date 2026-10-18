import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execStage,stageCommands,runCheck,verifySyntheticTemporalSafety} from '../scripts/flowdeck-check.mjs';

async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'flowdeck-check-unit-')));
 t.after(()=>rm(root,{recursive:true,force:true}));
 return root;
}
test('stage execution receives closed stdin, not an interactive approval stream',async t=>{
 const cwd=await fixture(t);
 const stage={stage:'stdin_eof',command:process.execPath,
  args:['-e',"process.stdin.on('end',()=>process.stdout.write('EOF\\n'));process.stdin.resume();"]};
 const result=await execStage(stage,{cwd,timeoutMs:3000});
 assert.equal(result.exitCode,0);
 assert.match(result.outputTail,/EOF/);
});
test('a hanging child times out and only its owned process group is killed',async t=>{
 const cwd=await fixture(t);
 const result=await execStage({stage:'hung_test_only',command:process.execPath,
  args:['-e','setInterval(()=>{},1000)']},{cwd,timeoutMs:150});
 assert.equal(result.exitCode,4);
 assert.equal(result.timedOut,true);
});
test('required test stage refuses a skipped or missing case despite exit zero',async t=>{
 const cwd=await fixture(t),path=join(cwd,'case.test.mjs');
 await writeFile(path,"import test from 'node:test';test('ok',()=>{});test('skipped',{skip:true},()=>{});\n");
 const stage={stage:'required_matrix',command:process.execPath,args:['--test',path],
  expectedTests:2,requiresNoSkips:true};
 const skipped=await execStage(stage,{cwd,timeoutMs:3000});
 assert.equal(skipped.exitCode,3);
 assert.equal(skipped.error,'required_test_matrix_incomplete');
 assert.deepEqual(skipped.tests,{executed:2,passed:1,skipped:1,failed:0});
 await writeFile(path,"import test from 'node:test';test('ok',()=>{});\n");
 const missing=await execStage(stage,{cwd,timeoutMs:3000});
 assert.equal(missing.exitCode,3);
 assert.equal(missing.tests.executed,1);
 await writeFile(path,"import test from 'node:test';test('ok',()=>{});test('second',()=>{});\n");
 const complete=await execStage(stage,{cwd,timeoutMs:3000});
 assert.equal(complete.exitCode,0);
 assert.deepEqual(complete.tests,{executed:2,passed:2,skipped:0,failed:0});
});
test('synthetic acceptance includes the mandatory real-Temporal production composition',()=>{
 const stages=stageCommands('synthetic');
 const required=stages.filter(x=>x.stage==='production_composition');
 assert.equal(required.length,1);
 assert.equal(required[0].requiresNoSkips,true);
 assert.equal(required[0].expectedTests,4);
 assert.ok(stages.every(x=>x.stage!=='browser_composer_no_send'));
});
test('synthetic preflight rejects implicit/default/remote addresses before connection',async()=>{
 let attempts=0;
 const connect=async()=>{attempts++};
 for(const address of ['','127.0.0.1:7233','localhost:17433','10.0.0.1:17433','127.0.0.1:99999']){
  await assert.rejects(verifySyntheticTemporalSafety({address,connect,attested:true}),
   /synthetic_test_only_temporal_address_required/);
 }
 assert.equal(attempts,0);
 await assert.rejects(verifySyntheticTemporalSafety({
  address:'127.0.0.1:17433',connect,attested:false}),/attestation_required/);
 assert.equal(attempts,0);
 assert.equal(await verifySyntheticTemporalSafety({
  address:'127.0.0.1:17433',connect,attested:true}),'127.0.0.1:17433');
 assert.equal(attempts,1);
});
test('failed unattended stages always produce classified, redacted manifest',async()=>{
 const seen=[];
 const report=await runCheck(['--non-interactive'],{
  stageCommands:()=>[{stage:'one'},{stage:'two'}],
  execStage:async stage=>{seen.push(stage.stage);return{
   stage:stage.stage,exitCode:3,elapsedMs:1,outputTail:'SECRET BODY',timedOut:false,
   tests:{executed:1,passed:0,failed:1,skipped:0}};}
 });
 assert.equal(report.schema,'flowdeck.check-result/v2');
 assert.equal(report.outcome,'failed');
 assert.deepEqual(report.expectedStages,['one','two']);
 assert.deepEqual(report.executedStages,['one']);
 assert.equal(JSON.stringify(report).includes('SECRET BODY'),false);
 assert.ok(report.artifactDigests.runnerSha256);
});

test('empty stage manifest cannot become an unattended pass',async()=>{
 const result=await runCheck(['--non-interactive'],{stageCommands:()=>[]});
 assert.equal(result.outcome,'blocked');
 assert.equal(result.classification,'setup-blocked');
 assert.equal(result.reason,'required_test_stages_missing');
});
