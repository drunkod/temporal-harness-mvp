import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { nextTask, compilePacket, executeVerifyPromote, browserDryRun } from '../dist/activities.js';

const base = resolve(process.cwd());
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'flowdeck-fixture-'));
  const result = spawnSync(process.execPath, [join(base, 'dist', 'seed.js')], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  return root;
}

test('executes two real Git tasks with verified receipts and no work remaining', async () => {
  const root = await fixture();
  try {
    const processed = [];
    for (const expected of ['alpha','beta']) {
      const task = await nextTask(root);
      assert.equal(task?.project, expected);
      const packet = await compilePacket(root, task);
      assert.match(packet.contentSha256, /^[a-f0-9]{64}$/);
      const browser = await browserDryRun(packet);
      assert.match(browser, /^dry-run session saved:/);
      const receipt = await executeVerifyPromote(root, packet, 'disabled', browser);
      assert.equal(receipt.verdict, 'verified');
      assert.equal((await readFile(join(task.repo,'OUTPUT.md'),'utf8')), packet.content);
      assert.match(await readFile(join(task.repo,'TASKS.md'),'utf8'), /- \[x\]/);
      processed.push(receipt);
    }
    assert.equal(processed.length,2);
    assert.equal(await nextTask(root),null);
    // A repeated execution of an already-recorded packet returns the old receipt,
    // not a new cherry-pick or duplicate commit.
    const first = processed[0];
    const packetDirectory = join(root,'.state','packets');
    const alphaPacket = (await readdir(packetDirectory)).find(x=>x.startsWith('alpha-'));
    assert.ok(alphaPacket);
    const savedPacket = JSON.parse(await readFile(join(packetDirectory,alphaPacket),'utf8'));
    const repeated = await executeVerifyPromote(root,savedPacket,'disabled',first.browser);
    assert.equal(repeated.gitCommit,first.gitCommit);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('preexisting activity claim is indeterminate and never reruns writes', async () => {
  const root = await fixture();
  try {
    const task=await nextTask(root);
    assert.ok(task);
    const packet=await compilePacket(root,task);
    const claims=join(root,'.state','claims');
    await mkdir(claims,{recursive:true});
    await writeFile(join(claims,packet.taskId+'.json'),'{"started":"unknown"}');
    const receipt=await executeVerifyPromote(root,packet,'disabled','disabled');
    assert.equal(receipt.verdict,'indeterminate');
    const todo=await readFile(join(task.repo,'TASKS.md'),'utf8');
    assert.ok(todo.includes('- [ ] '+task.taskId+':'));
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('dashboard status GET is read-only, never creates workflow',async(t)=>{
  let before, after;
  try {before=await fetch('http://127.0.0.1:4319/api/runs');}
  catch {t.skip('Dashboard not started');return;}
  assert.equal(before.status,200);
  const initial=(await before.json()).runs.length;
  const h=await fetch('http://127.0.0.1:4319/api/health');
  assert.equal(h.status,200);
  const result=await fetch('http://127.0.0.1:4319/api/runs');
  after=(await result.json()).runs.length;
  assert.equal(after,initial);
});
