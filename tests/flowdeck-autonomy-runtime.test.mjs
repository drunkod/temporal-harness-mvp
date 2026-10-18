import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { parseArgs, runSynthetic, validateManifest } from '../scripts/flowdeck-autonomy-runtime.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const taskIds = ['fixture-task-p1', 'fixture-task-p2'];

async function fixture(t) {
  const tempRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(tempRoot, 'flowdeck-autonomy-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const now = Date.now();
  const policy = {
    schema: 'flowdeck.autonomy-policy/v1', mode: 'automatic-initial-send', interactive: false,
    environment: 'synthetic', profile: 'helium-profile-4', taskSource: 'approved-active-plan',
    projectId: randomUUID(), projectUrl: 'https://chatgpt.com/g/fixture-project/project',
    ownerId: randomUUID(), deviceId: randomUUID(), worktree: root, allowedRoot: root,
    planSha256: hash('isolated synthetic plan'), enabledTaskIds: taskIds,
    instructionHashes: [hash('p1 fixture instruction'), hash('p2 fixture instruction')], campaignId: randomUUID(),
    validFrom: new Date(now - 60_000).toISOString(), validUntil: new Date(now + 3_600_000).toISOString(),
    maxTasksPerRun: 2, maxContinuationsPerTask: 1, p2Continuations: 0, maxSubmissionsPerRun: 3,
    maxCampaignRuns: 2, maxCampaignSubmissions: 6, maxRunDurationMinutes: 60,
    automaticSuccessfulCloseout: true, uncertainSend: 'quarantine', identityConflict: 'quarantine',
    reviewRequiredBeforeDependentTask: true,
  };
  const manifest = { schema: 'flowdeck.autonomy-runtime-manifest/v1', fixtureRoot: root,
    workflowId: randomUUID(), campaignRunId: randomUUID(), policy,
    tasks: [{ id: taskIds[0], prompt: 'Implement synthetic P1 fixture.' },
      { id: taskIds[1], prompt: 'Implement synthetic P2 fixture.' }], deadlineMs: 20_000 };
  const path = join(root, 'fixture-manifest.json');
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { root, path, manifest };
}

function temporalAvailable(address = '127.0.0.1', port = 7233) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: address, port });
    const timer = setTimeout(() => { socket.destroy(); reject(Error('Temporal port probe timed out')); }, 1000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

test('runtime CLI accepts only the bounded synthetic invocation', () => {
  const path = '/tmp/isolated-manifest.json';
  assert.deepEqual(parseArgs(['--mode=synthetic', `--manifest=${path}`, '--non-interactive']),
    { mode: 'synthetic', manifest: path, nonInteractive: true });
  for (const argv of [
    ['--mode=live', `--manifest=${path}`, '--non-interactive'],
    ['--mode=synthetic', `--manifest=${path}`],
    ['--mode=synthetic', '--manifest=relative.json', '--non-interactive'],
    ['--mode=synthetic', `--manifest=${path}`, '--non-interactive', '--browser=cdp'],
    ['--mode=synthetic', `--manifest=${path}`, '--non-interactive', '--mode=synthetic'],
  ]) assert.throws(() => parseArgs(argv));
});

test('manifest requires an isolated temporary fixture and synthetic policy', async t => {
  const { root, path, manifest } = await fixture(t);
  assert.equal(validateManifest(manifest, path), manifest);
  assert.throws(() => validateManifest({ ...manifest, fixtureRoot: resolve('/Users/test/.state') }, path), /temporary|home|\.state/);
  assert.throws(() => validateManifest({ ...manifest, policy: { ...manifest.policy, environment: 'local-live' } }, path), /synthetic/);
  assert.throws(() => validateManifest({ ...manifest, tasks: manifest.tasks.slice(0, 1) }, path), /exactly two/);
  assert.ok(root.startsWith(await realpath(tmpdir())));
});

test('runner source has no live browser import and exposes no live mode', async () => {
  const source = await readFile(new URL('../scripts/flowdeck-autonomy-runtime.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /createLiveBrowser|chrome-remote-interface|playwright|puppeteer|CDP/);
  assert.match(source, /only --mode=synthetic is supported/);
  assert.match(source, /fake-process-reader|fakeProcessReader/);
});

test('real Temporal synthetic workflow runs when local Temporal is reachable and otherwise fails closed', async t => {
  try { await temporalAvailable(); }
  catch (error) {
    if (error.code === 'ECONNREFUSED') { t.skip('local Temporal is genuinely absent at 127.0.0.1:7233'); return; }
    if (error.code === 'EPERM') {
      const { path } = await fixture(t);
      await assert.rejects(runSynthetic(path), /local Temporal is unavailable|execution environment \(EPERM\); synthetic run did not start/);
      return;
    }
    throw error;
  }
  const { root, path } = await fixture(t);
  const first = await runSynthetic(path);
  assert.equal(first.temporalStatus, 'COMPLETED');
  assert.equal(first.submissions, 3);
  assert.deepEqual(first.clickCounts, { initial_p1: 1, continue_p1: 1, initial_p2: 1 });
  assert.equal(first.reservations, 3);
  assert.deepEqual(first.eventOutcomes, ['partial', 'success', 'success']);
  assert.equal(first.senderStopped, true);
  assert.ok(first.receipt.receiptSha256);
  const restarted = await runSynthetic(path);
  assert.equal(restarted.restarted, true);
  assert.equal(restarted.runId, first.runId);
  assert.equal(restarted.receipt.receiptSha256, first.receipt.receiptSha256);
  assert.deepEqual(restarted.clickCounts, { initial_p1: 1, continue_p1: 1, initial_p2: 1 });
  for (const kind of ['initial_p1', 'continue_p1', 'initial_p2']) {
    const click = JSON.parse(await readFile(join(root, 'fake-browser', `${kind}.click.json`), 'utf8'));
    assert.equal(click.count, 1);
    assert.equal(click.fake, true);
  }
});
