# P0: B-only recovery repeated pre-click browser staging failure

**Date:** 2026-10-15
**Repository:** `/Users/test/Documents/work/temporal-harness-mvp`
**Worktree:** `/Users/test/Documents/work/sashai-flowdeck-probe-pilot`
**Status:** Live B-only recovery failed *before click*. Terminal workflow, worker and follower stopped. No further send authorization is available or requested.

## Exact authorized attempt and outcome

The owner explicitly approved the scoped B-only recovery, preserving Task A, all original claims and Temporal history. The recovery preview re-verified the exact legacy stage failure in run `01a1400a-4fb3-7c9e-9fa6-902bdb1addfa`, scheduled activity event `126`, `startNextTaskOnce`, `maximumAttempts=1`, no B sent receipt or binding.

Applied the **one approved** authorization using `scripts/flowdeck-reconcile-send.mjs --apply --approve-pre-send-recovery`. It generated:

- Authorization ID: `0aecf95c-fa48-4221-a5b0-28f8e24d1fd2`
- New dispatch ID: `007175b7-99b6-4c66-9e73-2726f49986b4`
- Request path: `.state/flowdeck-supervisor/send-recovery/resume-0aecf95c-fa48-4221-a5b0-28f8e24d1fd2.json`

Started the real worker and **named new B-only** workflow:

- Workflow: `flowdeck-supervisor-sashai-probe-pilot--probe-b-recovery-20261015`
- Run ID: `01a14080-d3cb-7d46-b494-6758bcaf0e1f`
- Initial state: RUNNING, `waiting_for_manual_start`, Task A `implementation_done / review_pending`, Task B `approved / not_started`.
- Fresh follower: `flowdeck.work-events.ready`, `pending=0`, `blocked=0`, target exact workflow.
- Released readiness *once* with `--approve-send` and the exact new run ID.

**Actual result:** Temporal `COMPLETED / needs_attention`, blocker:

`Recovery pre_send_failed before click: Error: Original owned ChatGPT tab changed. Explicit scoped recovery required.`

The durable new-dispatch journal contains `claimed`, `preparing`, `pre_send_failed`; there are **no `staged`, `click_attempted`, `submitted` or `reconciled` phases**. The authorization is marked consumed. There is no Task B file, no new Task B completed conversation and no evidence of a B click. **Do not replay or retry this attempt.**

## Read-only browser evidence

The new recovery-owned CDP tab is:

`B38EECECB293322C9D1EE9F9607D9724`

Observed URL after the failure:

`https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project?flowdeckAttempt=cfa8527d-d319-4fd1-9fa2-f86fbe022d7d`

The same exact tab can subsequently pass `requireTab(tab.id, projectUrl)`. Read-only DOM inspection after failure found:

- `location.pathname` equal to the expected Sashai Project path
- Visible and **empty** composer
- No stop/generation button
- Visible “Add files and more” button
- Correct ChatGPT origin and stable CDP identity.

This **suggests** a transient CDP/tab URL or SPA hydration race during `stage()`, but a post-failure snapshot does not prove which subcheck failed *at the time*. Do not fix it by ignoring wrong tabs, relaxing project identity or automatically sending again.

Source inspection points to `src/sashai-live-browser.ts` `createLiveBrowser.stage` / `requireTab` (around lines 69-146). In particular `requireTab` immediately rejects a momentary tab URL mismatch despite the outer stage loop allowing bounded retries for DOM `wrong-target`. The no-send staging script passed in Helium Profile 4 before this real attempt, so the failure is likely timing-dependent. Add specific *redacted, read-only, pre-click* diagnostics to distinguish `requireTab` mismatch, DOM route mismatch and timeout without losing exact tab/URL constraints.

## Required architect work before next live attempt

1. **Diagnose and harden owned-tab readiness** using CodeGraph and a repeated bounded **no-send** Helium Profile 4 staging test. Require the same CDP tab ID and expected project origin/path. Retry strictly transient URL/DOM readiness only within a short overall deadline. Never adopt an older tab or retry physical Send.
2. **Add regression tests** where CDP tab URL momentarily differs after `createOwnedProjectTab` but converges to the identical tagged project URL; permanently wrong route/tab identity must still fail. Test delayed composer, connector picker, and navigation identity separately.
3. **Fix repeated proven-pre-click recovery semantics.** Current `createSendRecoveryStore.authorize()` creates an exclusive `authorization-slot-${phaseHash}.json`, and `consume()` seals one authorization; after this attempt's *proven pre-click failure*, issuing another generation appears blocked by the prior phase slot. Design an explicit, audited, separately owner-approved successor authorization linked to the failed `pre_send_failed` dispatch. Never delete the old authorization, phase slot, claims, or Temporal history; never authorize retries from a missing receipt alone. Never allow successor authorization if any `click_attempted` or later marker exists in the lineage.
4. **Keep the B-only workflow** and current approved task scope unchanged. A new named attempt is needed if a future generation is independently approved.
5. Rerun TypeScript build, full test suite, no-send real Helium staging, and operator recovery preview **without** issuing authorization or clicking Send. Return a precise copy-paste command sequence for owner approval.

## Validation already achieved

- Prior to release: exact original Task B recovery eligibility `true` against old Temporal activity `126` and original claim hashes; no B receipt/binding.
- Source build: `npm run build` passed.
- Full tests: **261 passed, 2 skipped, 0 failed** before the live release.
- Real no-send Helium Profile 4 check: selected **Probe RemoteMCP2**, complete composer matched, zero submissions.
- Latest recovery run ended terminal, Task A remains `implementation_done / review_pending`, Task B remains `approved / not_started`.
- Stopped only the new recovery worker and follower after terminal state.

**MVP objective is still incomplete.** Do not claim successful A→B autonomation. The next meaningful step is the above narrow staging/authorization fix and a new explicitly approved B-only run.
