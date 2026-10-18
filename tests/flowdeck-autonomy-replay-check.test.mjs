import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const command = fileURLToPath(new URL('../scripts/flowdeck-autonomy-replay-check.mjs', import.meta.url));
const base = [
  '--address', '127.0.0.1:7233', '--namespace', 'default',
  '--workflow-id', 'flowdeck-autonomous-fixture-0001',
  '--run-id', '01a14db2-4e29-7c15-a572-1ec2851fec3c',
];
const run = args => spawnSync(process.execPath, [command, ...args], {encoding:'utf8',timeout:4500});

test('autonomous replay help requires an exact workflow and server run ID', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  for (const field of ['--workflow-id', '--run-id', '--namespace', '--address'])
    assert.ok(result.stdout.includes(field));
});
test('autonomous replay refuses missing, ambiguous, or non-exact identity before networking', () => {
  for (const args of [
    [], base.slice(0, -2), [...base, '--run-id', 'other'],
    [...base, '--unexpected', 'x'], [...base.slice(0, -1), 'latest'],
  ]) {
    const result = run(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage:/);
  }
});
test('autonomous replay rejects unbounded watchdog values', () => {
  for (const value of ['0', '9999', '180001', 'NaN', '1.5']) {
    const result = run([...base, '--deadline-ms', value]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Replay watchdog must be between/);
  }
});
