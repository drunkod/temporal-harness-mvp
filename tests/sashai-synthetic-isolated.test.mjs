import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const adapter=pathToFileURL(resolve('dist/sashai-synthetic-report-activities.js')).href;

// The adapter resolves its fixture store at import time. A separate process with
// a disposable cwd exercises fresh attempts without touching saved Temporal proofs.
async function isolated(body) {
 const root=await mkdtemp(join(tmpdir(),'sashai-synthetic-unit-'));
 try {
  const script=`import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {prepareFixture,dispatchFixtureOnce,reconcileFixtureSend,verifyFixture,repairFixtureOnce}
 from ${JSON.stringify(adapter)};
${body}`;
  const run=spawnSync(process.execPath,['--input-type=module','-e',script],{
   cwd:root,encoding:'utf8',timeout:15000,
  });
  assert.equal(run.error,undefined,run.error?.message);
  assert.equal(run.status,0,run.stderr||run.stdout);
 }finally{await rm(root,{recursive:true,force:true});}
}

test('fresh isolated repair sends once, rejects, corrects once and accepts without Temporal history',async()=>{
 await isolated(`
const b=await prepareFixture('repair');
assert.equal((await prepareFixture('repair')).attemptId,b.attemptId);
const sent=await dispatchFixtureOnce(b);
assert.equal(sent.state,'sent');
const rejected=await verifyFixture(b);
assert.equal(rejected.accepted,false);
assert.deepEqual(rejected.unmet,['required_marker_missing']);
await repairFixtureOnce(b,rejected);
const accepted=await verifyFixture(b);
assert.equal(accepted.accepted,true);
assert.equal(accepted.attemptId,b.attemptId);
assert.equal(accepted.chat,b.chat);
assert.deepEqual(accepted.unmet,[]);
const before=await readFile(b.artifactPath,'utf8');
await assert.rejects(dispatchFixtureOnce(b),e=>e.code==='EEXIST');
await assert.rejects(repairFixtureOnce(b,rejected),/Report changed after initial rejection/);
assert.equal(await readFile(b.artifactPath,'utf8'),before);
`);
});

test('fresh isolated timeout preserves claim and artifact, prevents resend and forbids correction',async()=>{
 await isolated(`
const b=await prepareFixture('uncertain');
await assert.rejects(dispatchFixtureOnce(b),/SYNTHETIC_TIMEOUT_AFTER_SEND_CLAIM/);
const folder=join(process.cwd(),'.state','sashai-synthetic-report','uncertain');
const claim=await readFile(join(folder,'SEND_ATTEMPTED'),'utf8');
const artifact=await readFile(b.artifactPath,'utf8');
assert.deepEqual(await reconcileFixtureSend(b),{claimed:true,artifactPresent:true,claimMatched:true});
await assert.rejects(dispatchFixtureOnce(b),e=>e.code==='EEXIST');
await assert.rejects(repairFixtureOnce(b,await verifyFixture(b)),/Cannot repair an uncertain send/);
assert.equal(await readFile(join(folder,'SEND_ATTEMPTED'),'utf8'),claim);
assert.equal(await readFile(b.artifactPath,'utf8'),artifact);
await assert.rejects(stat(join(folder,'CORRECTION_ATTEMPTED')),e=>e.code==='ENOENT');
`);
});

test('changed durable attempt blocks correction before a claim or artifact edit',async()=>{
 await isolated(`
const b=await prepareFixture('repair');
await dispatchFixtureOnce(b);
const rejected=await verifyFixture(b);
const before=await readFile(b.artifactPath,'utf8');
const folder=join(process.cwd(),'.state','sashai-synthetic-report','repair');
await writeFile(join(folder,'attempt.json'),JSON.stringify({...b,attemptId:'00000000-0000-4000-8000-000000000000'}));
await assert.rejects(repairFixtureOnce(b,rejected),/pre-correction attempt identity changed/);
assert.equal(await readFile(b.artifactPath,'utf8'),before);
await assert.rejects(stat(join(folder,'CORRECTION_ATTEMPTED')),e=>e.code==='ENOENT');
`);
});

test('changed rejected artifact blocks correction before creating its claim',async()=>{
 await isolated(`
const b=await prepareFixture('repair');
await dispatchFixtureOnce(b);
const rejected=await verifyFixture(b);
const modified=(await readFile(b.artifactPath,'utf8')).replace('STATUS: INCOMPLETE','STATUS: MODIFIED');
await writeFile(b.artifactPath,modified);
await assert.rejects(repairFixtureOnce(b,rejected),/Report changed after initial rejection/);
assert.equal(await readFile(b.artifactPath,'utf8'),modified);
await assert.rejects(stat(join(process.cwd(),'.state','sashai-synthetic-report','repair','CORRECTION_ATTEMPTED')),e=>e.code==='ENOENT');
`);
});
