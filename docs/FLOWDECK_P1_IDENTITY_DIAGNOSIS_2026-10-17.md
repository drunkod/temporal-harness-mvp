# P1 identity failure: diagnosis and reproducible check

> **UPDATE — 2026-10-17:** The regression patch has now been promoted to the local production `dist/` build. The compiled activity SHA-256 is `21496df4e6f6e4232270f47d8a51a28a146feb6848c23d4ad11806ee909366e6`; the compiled workflow remains unchanged. The promoted activity suite passed **45/45**, and the closed P1, legacy pilot, and bounded synthetic histories replayed **3/3**. See `.state/verification-runs/p1-identity-promotion-20261017/RESULTS.md` and its new 103-file manifest. Commands below that describe expected failure against the *old production dist* are historical reproduction steps only: they will **not** fail on the newly promoted build. The original P1 workflow remains closed and blocked; do not resend or retry it.

## Verdict

The launch command was correct. Worker, workflow and event follower reached readiness. The failure was later in `adoptStartedWork`, not webpack, the launcher, or connector startup.

Exact incident run: `01a14951-e9f7-7864-b3ba-ef8af1ef20c5`.

The saved report records Temporal COMPLETED with business `needs_attention / paused`, zero automated reservations, and no scheduled continuation/next/recovery send activities. This investigation read that report; it did not independently fetch the historical server events again.

A fresh read-only CDP check of the preserved ORIGINAL target `71D34F52E313D8B4419FECDFBCFD140F` returned:

- task ID `sashai-fresh-attended-p1-20261016-03`;
- expected worktree match true;
- one user turn;
- original user text length 1479;
- zero mutations/submissions.

This is current evidence, not a reconstruction of the failing observation.

## Confirmed code defect, historical cause still uncertain

The original check treated `identity.taskId === null` as a different approved task because `null !== expectedTaskId`. A DOM identity object can exist with no extracted Task ID. The code therefore conflated unavailable evidence with conflicting evidence.

A new regression fixture reproduced the exact error on the existing production compiled build:

```
Pinned chat has the wrong approved task identity
```

The historical error did not record the extracted task ID, so it is not proven that this live incident had a null task ID. UI hydration, collapsed message layout, or another extraction condition remains a hypothesis. Do not claim the complete incident fixed merely because the missing-ID case is now covered.

## Narrow patch

Changed `src/flowdeck-supervisor-activities.ts`, inside the already-pinned finished-chat adoption path:

1. Verify known tab/Project/worktree evidence does not conflict.
2. If the task ID is null, do not claim/adopt or send; return through the existing waiting path with the same binding.
3. If a different non-null task ID is observed, still throw immediately.
4. Only fully matching task/worktree evidence can proceed to adoption.

The existing workflow bounds adoption waiting by poll count and deadline; this change adds no unbounded retry. It does not expand Send retries. Running-chat adoption, prompt seals, task approval, send budget, recovery rules and workflow code are unchanged.

Patch excerpt:

```typescript
if (intended && item.tab.id === intended.tabId &&
    parseSashaiChatUrl(item.tab.url).url === intended.chatUrl) {
  if (identity.tabId !== item.tab.id ||
      !sameProject(identity.projectUrl, p.projectUrl) ||
      (identity.worktree !== null &&
       (!identity.worktree.startsWith('/') ||
        resolve(identity.worktree) !== resolve(p.repo)))) {
    throw new SupervisorAmbiguityError(
      'Pinned chat has conflicting tab/project/worktree identity'
    );
  }
  if (identity.taskId === null) continue;
  if (identity.taskId !== t.id) {
    throw new SupervisorAmbiguityError(
      'Pinned chat has the wrong approved task identity'
    );
  }
}
```

`continue` here continues the candidate inspection loop, not the ChatGPT conversation. The activity then returns waiting without writing a binding. It does not select a replacement tab.

## Validation actually performed

- Original compiled build plus new targeted regression: 4 passes, 1 failure. The missing-ID case failed with the exact incident error.
- TypeScript compile to an isolated verification directory: passed.
- Patched isolated build, complete supervisor activity test file: **45 passed, 0 failed**.
- Tests cover repeated missing-ID observations with no claims/sends, later adoption on the same tab, and refusal of wrong task/worktree/Project/tab evidence.
- Existing activity tests cover adoption seals, send/cancellation guards and identity behavior.
- No full suite or historical replay rerun in this investigation. No workflow source edits.
- No production build promotion, worker/follower launch, workflow signal/restart, or browser send.

Production `dist/` was deliberately left untouched. Source and this test file have changed, so a prior manifest containing them will no longer fully match. Do not overwrite historical manifests to hide this change.

## Run the fixture checks yourself

From the supervisor repository:

```sh
cd /Users/test/Documents/work/temporal-harness-mvp
```

### 1. Reproduce against the original production build (expected failure)

While `dist/` remains the original build:

```sh
node --test --test-name-pattern='pinned finished' tests/flowdeck-supervisor-activities.test.mjs
```

Expected: the missing-ID case fails with `Pinned chat has the wrong approved task identity`. The four genuine-conflict cases pass. These fixtures use temporary files and fake browser implementations; no live ChatGPT interaction.

### 2. Compile the patch separately

```sh
./node_modules/.bin/tsc -p tsconfig.json \
  --outDir .state/verification-runs/p1-identity-regression-20261017/dist
```

This writes verification build files only, not the production `dist/` directory.

### 3. Test the patched activity

```sh
FLOWDECK_TEST_DIST=/Users/test/Documents/work/temporal-harness-mvp/.state/verification-runs/p1-identity-regression-20261017/dist \
  node --test tests/flowdeck-supervisor-activities.test.mjs
```

Expected for this revision: 45 tests pass. Do not run `npm run build` just to execute this example: that would replace the production compiled build.

## Read the preserved tab yourself without adopting or sending

This command only enumerates CDP targets and evaluates the existing read-only DOM identity expression. It does NOT call `adoptStartedWork`, which can persist claims/bindings. It refuses a missing/replaced original target. It prints metadata, not the full prompt.

```sh
node --input-type=module <<'NODE'
import {browserPages, browserEvaluate} from './dist/sashai-live-browser.js';
import {supervisorIdentityExpression} from './dist/flowdeck-supervisor-activities.js';

const url = 'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/6ad34958-4f84-83eb-8ea3-be51a250a98e';
const tabId = '71D34F52E313D8B4419FECDFBCFD140F';
const expectedTask = 'sashai-fresh-attended-p1-20261016-03';
const expectedWorktree = '/Users/test/Documents/work/sashai-flowdeck-fresh-attended-20261016-03';
const tabs = (await browserPages()).filter(
  t => t.id === tabId && t.url.split('?')[0] === url
);
if (tabs.length !== 1) {
  throw new Error('Original pinned target unavailable; no replacement selected');
}
const identity = await browserEvaluate(tabs[0], supervisorIdentityExpression(url));
const taskMatches = identity?.taskId === expectedTask;
const worktreeMatches = identity?.worktree === expectedWorktree;
console.log(JSON.stringify({
  taskId: identity?.taskId ?? null,
  taskMatches,
  worktreeMatches,
  userTurns: identity?.latestUserTurns ?? 0,
  originalTextLength: identity?.originalUserText?.length ?? 0,
  writes: false,
  browserSubmissions: 0,
}, null, 2));
if (!taskMatches || !worktreeMatches) process.exitCode = 2;
NODE
```

Expected current result: taskMatches/worktreeMatches true and userTurns 1. This means identity is readable NOW; it is not permission to resend and does not prove the earlier read matched.

## What next, without losing the partial result

1. Keep the P1 tab, checkpoint and closed execution evidence.
2. Review/test this narrow source patch before promoting it to production; freeze new source/build evidence when promoted.
3. If a future read still reports unavailable identity, collect redacted task-present/task-matches/worktree-matches/tab-matches diagnostics at observation time. Do not loosen identity matching or read assistant prose as user identity.
4. The existing workflow already completed. Updating activities or starting a worker cannot make it resume automatically.
5. Do not relaunch the same pilot, change its attempt name, delete claims, or resend P1. There is no supported bounded-pilot resume command demonstrated by this fix. Any continued live test must reconcile existing P1 work and define a separate bounded execution path or use a genuinely fresh test, without pretending the old checkpoint never happened.

The quickest useful result today is a reproducible code defect and an isolated tested correction—not another live attempt to see whether it happens again.
