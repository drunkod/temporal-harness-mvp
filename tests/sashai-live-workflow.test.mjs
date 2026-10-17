import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute only the transpiled workflow. Runtime imports other than this shim fail
// closed, so neither browser activities nor a Temporal client can be loaded.
const filename = new URL('../src/sashai-live-report-workflow.ts', import.meta.url);
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  fileName: filename.pathname,
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const CONTRACT = 'a'.repeat(64);
const ORIGINAL = 'b'.repeat(64);
const CORRECTED = 'c'.repeat(64);
const SOURCE = 'd'.repeat(64);
const INITIAL_CLAIM = '1'.repeat(64);
const CORRECTION_CLAIM = '2'.repeat(64);
const CHAT = 'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111';
const TASK = 'sashai-task-routing-report-live-v1';
const OUTPUT = '/Users/test/Documents/work/temporal-harness-mvp/docs/SASHAI-BROWSER-TASK-ROUTING-REVIEW-2026-10-15.md';
const plain = value => JSON.parse(JSON.stringify(value));

function fixtureAttempt() {
  return {
    taskId: TASK, attemptId: '22222222-2222-4222-8222-222222222222',
    project: 'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project',
    tabId: 'fake-owned-tab', chatUrl: null, approval: 'report-only',
    contractSha256: CONTRACT, source: {fingerprintSha256: SOURCE},
    sourceFactsSha256: SOURCE, output: OUTPUT, marker: 'fake-marker',
    prompt: 'fake prompt, never sent', promptSha256: ORIGINAL,
    preparedAt: '2026-10-15T00:00:00.000Z',
  };
}

async function run(overrides = {}, expectedContract = CONTRACT) {
  const attempt = fixtureAttempt();
  const calls = [];
  const sleeps = [];
  const snapshots = [];
  const proxyOptions = [];
  let handler;
  const context = {attempt, corrected: false, observations: {initial: 0, correction: 0}};
  const sample = () => { if (handler) snapshots.push(plain(handler())); };
  const receipt = corrected => ({
    taskId: TASK, attemptId: attempt.attemptId, chat: CHAT, contractSha256: CONTRACT,
    artifactPath: OUTPUT, artifactSha256: corrected ? CORRECTED : ORIGINAL,
    sourceFingerprint: SOURCE, accepted: corrected,
    missing: corrected ? [] : ['evidence_index_missing'],
    evidence: 'structural_only', observedConnector: true,
    initialClaimSha256: INITIAL_CLAIM,
    correctionClaimSha256: corrected ? CORRECTION_CLAIM : null,
    initialArtifactSha256: corrected ? ORIGINAL : null,
  });
  const defaults = {
    prepareLiveAttempt: async () => attempt,
    submitLiveOnce: async () => ({state: 'clicked', claimSha256: INITIAL_CLAIM}),
    observeLive: async () => {
      const phase = context.corrected ? 'correction' : 'initial';
      const count = ++context.observations[phase];
      return {
        chat: CHAT, turn: 'turn_finished', artifactExists: true,
        artifactSha256: context.corrected ? CORRECTED : ORIGINAL,
        stable: count >= 2, toolVisible: true, replyVisible: true,
        sourceVisible: true, markerVisible: true,
      };
    },
    verifyLiveReport: async () => receipt(context.corrected),
    correctLiveOnce: async () => {
      context.corrected = true;
      return {state: 'clicked', claimSha256: CORRECTION_CLAIM};
    },
    reconcileLiveSend: async () => ({claimed: true, claimMatched: true, chat: CHAT}),
    recordLiveAcceptance: async () => {},
  };
  const activities = Object.fromEntries(Object.keys(defaults).map(name => [name, async (...args) => {
    const claimsIndex = ['correctLiveOnce', 'recordLiveAcceptance'].includes(name) ? 2 : 1;
    calls.push({name, args: plain(args), claimsFrozen: Object.isFrozen(args[claimsIndex])});
    sample();
    try {
      const result = overrides[name]
        ? await overrides[name](context, ...args, defaults[name])
        : await defaults[name](...args);
      return result;
    } finally {
      sample();
    }
  }]));
  const shim = {
    defineQuery: name => name,
    proxyActivities: options => { proxyOptions.push(plain(options)); return activities; },
    setHandler: (name, callback) => {
      assert.equal(name, 'liveSashaiReportStatus');
      assert.equal(handler, undefined);
      handler = callback;
      sample();
    },
    sleep: async duration => { sleeps.push(duration); sample(); },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: name => {
      assert.equal(name, '@temporalio/workflow', 'workflow must not import activities at runtime');
      return shim;
    },
  }, {filename: filename.pathname, timeout: 1000});
  const state = plain(await exports.liveSashaiReportLifecycle(expectedContract));
  sample();
  assert.equal(exports.liveReportQuery, 'liveSashaiReportStatus');
  assert.equal(proxyOptions.length, 1);
  assert.equal(proxyOptions[0].retry.maximumAttempts, 1);
  assert.equal(proxyOptions[0].startToCloseTimeout, '2 minutes');
  assert.equal(proxyOptions[0].scheduleToCloseTimeout, '2 minutes');
  for (const snapshot of [...snapshots, state]) {
    assert.equal(snapshot.dispatchPermitted, false, snapshot.stage);
    assert.equal(snapshot.nextTaskPermitted, false, snapshot.stage);
  }
  for (const duration of sleeps) assert.equal(duration, '5 seconds');
  const named = name => calls.filter(call => call.name === name);
  for (const name of ['submitLiveOnce', 'correctLiveOnce', 'reconcileLiveSend', 'recordLiveAcceptance']) {
    assert.ok(named(name).length <= 1, name + ' must never replay');
  }
  const prepared = named('prepareLiveAttempt');
  if (prepared.length) assert.deepEqual(prepared[0].args, [expectedContract]);
  for (const call of calls.filter(call => call.name !== 'prepareLiveAttempt')) {
    assert.deepEqual(call.args[0], attempt, 'immutable attempt passed to ' + call.name);
    if (['observeLive', 'verifyLiveReport', 'correctLiveOnce', 'recordLiveAcceptance'].includes(call.name)) {
      const index = ['correctLiveOnce', 'recordLiveAcceptance'].includes(call.name) ? 2 : 1;
      const expected = call.name === 'recordLiveAcceptance' || call.args[index]?.correction !== undefined
        ? {initial: INITIAL_CLAIM, correction: CORRECTION_CLAIM} : {initial: INITIAL_CLAIM};
      assert.deepEqual(call.args[index], expected, 'bound claim digests passed to ' + call.name);
      assert.equal(call.claimsFrozen, true, 'claims must be immutable at ' + call.name);
    }
  }
  for (const snapshot of snapshots) {
    if (snapshot.initialClaimSha256 !== null) assert.equal(snapshot.initialClaimSha256, INITIAL_CLAIM);
    if (snapshot.correctionClaimSha256 !== null) assert.equal(snapshot.correctionClaimSha256, CORRECTION_CLAIM);
  }
  assert.deepEqual(plain(handler()), state);
  return {state, calls, named, sleeps, snapshots};
}

function blocked(result, reason) {
  assert.equal(result.state.stage, 'blocked');
  assert.ok(result.state.missing.includes(reason), JSON.stringify(result.state.missing));
  assert.equal(result.named('recordLiveAcceptance').length, 0);
}

function editReceipt(phase, patch) {
  return async (context, attempt, claims, original) => {
    const result = await original(attempt, claims);
    return context.corrected === (phase === 'final') ? {...result, ...patch} : result;
  };
}

test('success sends once, corrects once, and persists acceptance after stable changed output', async () => {
  const result = await run();
  assert.equal(result.state.stage, 'verified_approval_boundary');
  assert.deepEqual(result.state.missing, []);
  assert.deepEqual(result.calls.map(call => call.name), [
    'prepareLiveAttempt', 'submitLiveOnce', 'observeLive', 'observeLive',
    'verifyLiveReport', 'correctLiveOnce', 'observeLive', 'observeLive',
    'verifyLiveReport', 'recordLiveAcceptance',
  ]);
  assert.equal(result.named('reconcileLiveSend').length, 0);
  assert.equal(result.named('submitLiveOnce').length, 1);
  assert.equal(result.named('correctLiveOnce').length, 1);
  assert.equal(result.named('recordLiveAcceptance').length, 1);
  assert.deepEqual(result.named('correctLiveOnce')[0].args[1], result.state.initialReceipt);
  assert.deepEqual(result.named('recordLiveAcceptance')[0].args[1], result.state.finalReceipt);
  assert.equal(result.state.initialReceipt.artifactSha256, ORIGINAL);
  assert.equal(result.state.finalReceipt.artifactSha256, CORRECTED);
  assert.equal(result.state.finalReceipt.initialArtifactSha256, ORIGINAL);
  assert.equal(result.state.initialClaimSha256, INITIAL_CLAIM);
  assert.equal(result.state.correctionClaimSha256, CORRECTION_CLAIM);
  assert.deepEqual(result.named('correctLiveOnce')[0].args[2], {initial: INITIAL_CLAIM});
  assert.deepEqual(result.named('recordLiveAcceptance')[0].args[2], {
    initial: INITIAL_CLAIM, correction: CORRECTION_CLAIM,
  });
  assert.deepEqual(result.state.polls, {initial: 2, correction: 2});
  assert.equal(result.sleeps.length, 2);
});

for (const phase of ['initial', 'correction']) {
  for (const reconciliation of ['matched', 'mismatched', 'throws']) {
    test(phase + ' send uncertain: ' + reconciliation + ' reconciliation always blocks without replay', async () => {
      const result = await run({
        [phase === 'initial' ? 'submitLiveOnce' : 'correctLiveOnce']: async () => { throw Error('unknown click outcome'); },
        reconcileLiveSend: async () => {
          if (reconciliation === 'throws') throw Error('reconciliation unavailable');
          return {claimed: true, claimMatched: reconciliation === 'matched', chat: CHAT};
        },
      });
      blocked(result, phase + '_send_outcome_indeterminate');
      assert.equal(result.named('submitLiveOnce').length, 1);
      assert.equal(result.named('correctLiveOnce').length, phase === 'initial' ? 0 : 1);
      assert.equal(result.named('reconcileLiveSend').length, 1);
      assert.equal(result.named('reconcileLiveSend')[0].args[1], phase);
      assert.equal(result.named('verifyLiveReport').length, phase === 'initial' ? 0 : 1);
      if (phase === 'initial') assert.equal(result.named('observeLive').length, 0);
      if (reconciliation === 'mismatched') assert.ok(result.state.missing.includes('send_claim_identity_mismatch'));
      if (reconciliation === 'throws') assert.ok(result.state.missing.includes('reconciliation_failed'));
    });
  }
}

for (const phase of ['initial', 'final']) {
  for (const [field, wrong] of Object.entries({
    taskId: 'unapproved-task', attemptId: 'wrong-attempt', chat: CHAT + '-other',
    contractSha256: 'e'.repeat(64), artifactPath: OUTPUT + '.other',
    sourceFingerprint: 'e'.repeat(64), artifactSha256: 'f'.repeat(64),
    observedConnector: false, initialClaimSha256: '3'.repeat(64),
    correctionClaimSha256: '4'.repeat(64),
  })) {
    test(phase + ' receipt rejects wrong ' + field, async () => {
      const result = await run({verifyLiveReport: editReceipt(phase, {[field]: wrong})});
      blocked(result, phase + '_receipt_identity_or_evidence_mismatch');
      assert.equal(result.named('correctLiveOnce').length, phase === 'initial' ? 0 : 1);
    });
  }
}

for (const patch of [
  {accepted: true, missing: []},
  {accepted: true, missing: ['evidence_index_missing']},
  {accepted: false, missing: []},
  {accepted: false, missing: ['another_failure']},
  {accepted: false, missing: ['evidence_index_missing', 'another_failure']},
  {accepted: false, missing: ['evidence_index_missing', 'evidence_index_missing']},
]) {
  test('initial correction gate rejects ' + JSON.stringify(patch), async () => {
    const result = await run({verifyLiveReport: editReceipt('initial', patch)});
    blocked(result, 'initial_verifier_unexpected_state');
    assert.equal(result.named('correctLiveOnce').length, 0);
  });
}

for (const patch of [{accepted: false, missing: []}, {accepted: true, missing: ['still_missing']}]) {
  test('final acceptance gate rejects ' + JSON.stringify(patch), async () => {
    const result = await run({verifyLiveReport: editReceipt('final', patch)});
    blocked(result, 'final_report_not_accepted');
  });
}

test('stable finished but unchanged old correction artifact cannot finish', async () => {
  const result = await run({
    observeLive: async (context, attempt, claims, original) => ({...await original(attempt, claims), artifactSha256: ORIGINAL}),
  });
  blocked(result, 'correction_observation_limit_reached');
  assert.deepEqual(result.state.polls, {initial: 2, correction: 60});
  assert.equal(result.named('verifyLiveReport').length, 1);
  assert.equal(result.named('correctLiveOnce').length, 1);
  assert.equal(result.sleeps.length, 60);
});

for (const [label, patch] of [
  ['unstable', {stable: false}],
  ['stability absent', {stable: undefined}],
  ['unfinished', {turn: 'running'}],
  ['no chat', {chat: null}],
  ['no artifact', {artifactExists: false, artifactSha256: null}],
]) {
  test('initial observations bounded when ' + label, async () => {
    const result = await run({
      observeLive: async (context, attempt, claims, original) => ({...await original(attempt, claims), ...patch}),
    });
    blocked(result, 'initial_observation_limit_reached');
    assert.deepEqual(result.state.polls, {initial: 60, correction: 0});
    assert.equal(result.named('observeLive').length, 60);
    assert.equal(result.sleeps.length, 59);
    assert.equal(result.named('verifyLiveReport').length, 0);
    assert.equal(result.named('correctLiveOnce').length, 0);
  });
}

for (const chat of [CHAT + '-changed', null]) {
  test('bound observation chat cannot change to ' + chat, async () => {
    const result = await run({
      observeLive: async (context, attempt, claims, original) => {
        const observed = await original(attempt, claims);
        return context.corrected ? {...observed, chat} : observed;
      },
    });
    blocked(result, 'observed_chat_identity_changed');
    assert.equal(result.named('verifyLiveReport').length, 1);
  });
}

test('preparation failure blocks before any send', async () => {
  const result = await run({prepareLiveAttempt: async () => { throw Error('approval/preparation failed'); }});
  blocked(result, 'prepare_failed_no_send');
  assert.deepEqual(result.calls.map(call => call.name), ['prepareLiveAttempt']);
});

test('changed prepared contract blocks before any send', async () => {
  const result = await run({prepareLiveAttempt: async context => ({...context.attempt, contractSha256: ORIGINAL})});
  blocked(result, 'attempt_identity_mismatch');
  assert.equal(result.named('submitLiveOnce').length, 0);
});

test('invalid explicit contract hash blocks before preparation', async () => {
  const result = await run({}, 'not-a-sha256');
  blocked(result, 'invalid_expected_contract_sha256');
  assert.equal(result.calls.length, 0);
});

for (const phase of ['initial', 'correction']) {
  for (const invalid of [
    {state: 'clicked', claimSha256: 'invalid'},
    {state: 'clicked', claimSha256: null},
    {state: 'clicked'},
    {state: 'unknown', claimSha256: INITIAL_CLAIM},
  ]) {
    test(phase + ' send receipt with invalid state/digest reconciles then blocks: ' + JSON.stringify(invalid), async () => {
      const result = await run({
        [phase === 'initial' ? 'submitLiveOnce' : 'correctLiveOnce']: async () => invalid,
      });
      blocked(result, phase + '_send_outcome_indeterminate');
      assert.equal(result.named('reconcileLiveSend').length, 1);
      assert.equal(result.named('reconcileLiveSend')[0].args[1], phase);
      assert.equal(result.state.correctionClaimSha256, null);
      if (phase === 'initial') {
        assert.equal(result.state.initialClaimSha256, null);
        assert.equal(result.named('correctLiveOnce').length, 0);
        assert.equal(result.named('observeLive').length, 0);
      } else {
        assert.equal(result.state.initialClaimSha256, INITIAL_CLAIM);
        assert.equal(result.named('verifyLiveReport').length, 1);
      }
    });
  }
}

for (const initialArtifactSha256 of [CORRECTED, null, 'invalid']) {
  test('final receipt cannot rebind original artifact to ' + initialArtifactSha256, async () => {
    const result = await run({verifyLiveReport: editReceipt('final', {initialArtifactSha256})});
    blocked(result, 'final_initial_artifact_hash_mismatch');
    assert.equal(result.named('correctLiveOnce').length, 1);
    assert.equal(result.state.finalReceipt.artifactSha256, CORRECTED);
  });
}

test('final receipt must include the successful correction claim digest', async () => {
  const result = await run({verifyLiveReport: editReceipt('final', {correctionClaimSha256: null})});
  blocked(result, 'final_receipt_identity_or_evidence_mismatch');
});

test('acceptance persistence failure cannot reach approval boundary', async () => {
  const result = await run({recordLiveAcceptance: async () => { throw Error('storage unavailable'); }});
  assert.equal(result.state.stage, 'blocked');
  assert.ok(result.state.missing.includes('activity_failed_at_recording_acceptance'));
  assert.equal(result.named('recordLiveAcceptance').length, 1);
});
