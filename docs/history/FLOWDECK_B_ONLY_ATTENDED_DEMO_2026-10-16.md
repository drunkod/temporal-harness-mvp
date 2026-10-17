# Flowdeck B-only attended successor demonstration — stopped safely

**Date:** 2026-10-16 (Mac clock +05:00; event times stored UTC).  
**Disposition:** **STOPPED SAFELY / NOT DEMONSTRATED**. Exactly one successor authorization and one successor execution were issued following an in-chat user message stating approval. **Explicit owner approval not established in the available record.** A user-message approval phrase appears in this conversation context, but no independently verified owner-grant record is associated with the execution. Classify the incident as an **authorization/provenance gap**, not verified owner consent. The single release succeeded, but the send activity failed at a predecessor browser-tab identity check before the new authorization was consumed or any successor send phase was journaled. The in-chat statement grants no further recovery generation or resend; none is authorized now.

## Authority and preflight

The recorded source was an in-chat user message: **“I approve exactly one attended B-only successor generation under the documented safeguards.”** Its scope was one attended B-only successor generation, not any retry, renewal, or unattended operation. This text is explicit approval wording, but the incident evidence does **not** independently authenticate the speaker as the project owner. No separate owner approval record was verified. Review owner authority before treating any subsequent request as execution permission. Before issuance, the existing frozen source/build manifest in `docs/FLOWDECK_P0_BROWSER_READINESS_VERIFICATION_2026-10-16.md` passed 10/10 SHA-256 checks. The production authority loader accepted project `sashai-probe-pilot`, approved Task B `sashai-flowdeck-probe-b-20261015`, unchanged instruction hash `82e1f18adbc6da33592da990e97381f84a1ddd232ab93647dec1f61e4f8e3d86`, and worktree `/Users/test/Documents/work/sashai-flowdeck-probe-pilot`. Temporal visibility showed zero running workflows, all three old pilot executions `COMPLETED`, and no Flowdeck sender process or tagged browser target. The exact B-only preview returned `eligible=true`, `receiptPresent=false`, `taskBindingPresent=false`, `writes=false`.

## Exactly one issued generation

| Identity | Exact value |
|---|---|
| Failed predecessor dispatch | `007175b7-99b6-4c66-9e73-2726f49986b4` |
| New authorization | `64c3fa86-b7b0-4fe3-895e-34f797237c2f` |
| New (reserved) successor dispatch | `71cc408a-16d9-4466-8bf6-550951bcb1a5` |
| Parent authorization | `0aecf95c-fa48-4221-a5b0-28f8e24d1fd2` |
| Immutable recovery request | `.state/flowdeck-supervisor/send-recovery/resume-64c3fa86-b7b0-4fe3-895e-34f797237c2f.json` |
| Workflow ID | `flowdeck-supervisor-sashai-probe-pilot--probe-b-successor-20261015-02` |
| Temporal run ID | `01a14128-2689-77fe-887f-537e74545e83` |
| Workflow type | `flowdeckRecoverSend` |

The recovery CLI returned `mode=successor-apply`, `writes=true` only once. The B-only resume request preview returned `physicalSends=0`, `releaseRequired=true`. The worker reported `READY`; the workflow query showed `waiting_for_manual_start`. The attempt-isolated event follower reported `flowdeck.work-events.ready`, `pending=0`, `blocked=0`. The exact run was released **once**, returning `released=true`.

## Exact blocker and send boundary

The worker's `recoverPreSendOnce` activity failed on its first attempt (reported `durationMs: 49`) at `dist/sashai-live-browser.js` `requireTab`:

```text
Original owned ChatGPT tab changed: requireTab/tab_missing
expected=https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/6ad0e53a-3544-83eb-a251-42d9266131a1
observed=[unavailable]
```

In the frozen `src/flowdeck-supervisor-activities.ts`, `send()` calls `browser().requireTab(previous.tabId, previous.chatUrl)` **before** consuming a successor authorization, generating successor send claims, opening a new owned project tab, staging the B prompt, or clicking Send. The missing predecessor tab caused a fail-closed precondition error.

Reconciled durable evidence for the **new** dispatch `71cc408a-16d9-4466-8bf6-550951bcb1a5`:
- **Last durable successor send phase: none** (zero phase journal entries; even `claimed` was not recorded).
- The new successor authorization remains **unconsumed**. Its issuance slot and the one exact run release-intent file remain preserved. Do **not** infer permission to reuse it.
- **No** successor `staged`, `click_attempted`, `submitted` or `reconciled` record exists.
- B sent receipt, B task binding, and B artifact `task-b.md`: all absent on read-only inspection.
- No Flowdeck-owned browser target was found. Follower recorded readiness but no B work-start/work-report event.

Temporal's exact successor result is `COMPLETED` with business `needs_attention / paused` and blocker `Recovery may have been submitted; reconcile claims before any further send`. Its B task entry remains `approved / not_started`. This generic conservative blocker must not be read as proof that a click occurred; the activity error and inspected call ordering plus empty successor journal demonstrate the attempt failed before the browser side-effect path. The older historical B `claimed → preparing → pre_send_failed` journal remains distinct and untouched.

## Stop and cleanup

After confirming the successor workflow was terminal and the receipt, B binding, artifact, consumption marker and new send-phase journal were absent, the worker (PID 69780) and isolated follower (PID 70959) **started for this run** were sent SIGTERM and exited. No other Flowdeck sender was started. Historical claims, authorizations, recovery request, release intent, and Temporal histories were preserved. Task A was not repeated.

**Follow-up requires a new, separately scoped, owner-verified decision.** Do not automatically restore the old browser tab, rerun `--apply`, reuse the released workflow, start a different successor, or resend B. First review this prerequisite failure and the original tab ownership/lifetime protocol. The still-outstanding activity cancellation/deadline hardening remains a separate engineering packet.

## Read-only predecessor-readiness design and prototype checks

**Design status:** proposed; **not integrated into the production recovery CLI or sender**. The existing read-only `successor-preview` previously validated journal lineage but did **not** inspect the predecessor browser tab. After issuance, the existing successor slot means the old lineage is **no longer eligible for another fresh issuance**, independent of the predecessor check.

A future pre-issuance check must return separate typed values:

```json
{
  "lineageEligible": false,
  "predecessorTabPresent": false,
  "predecessorEvidenceVerified": false,
  "readyForExecution": false,
  "writes": false
}
```

The values above are **current-state interpretations**, not an implemented command output: `lineageEligible=false` because the one allowed successor authorization already occupies the immutable slot; the earlier **pre-issuance** preview returned `eligible=true`. During a hypothetical fresh clean lineage the fields could instead read `lineageEligible=true` with `predecessorTabPresent=false` and `readyForExecution=false`.

Required predicate: `readyForExecution` only when the lineage is eligible and unused, the exact approved project/task/worktree and predecessor binding/active task binding are unchanged, the **same CDP tab ID** still resolves to the **same recorded conversation URL** with the required page/WebSocket identity, and a fresh **read-only** ChatGPT observation verifies the bound user-turn count, original task/worktree/project identity, finished latest assistant response and `implementation_done` marker. Where a sealed expected prompt hash exists, require the exact latest-user-message hash too. Where this evidence is absent, do not silently claim it; require a defined and audited evidence policy. A historical `record.observation.decision=implementation_done` is useful context but **not fresh browser proof**. The historical `record.ready=false` was changed by prior recovery preparation and must not, on its own, serve as a completion verdict.

The check must use read-only CDP target enumeration, the existing strict `requireTab` identity predicate, and read-only structured DOM/observer calls. It must **not** open a replacement tab, select a connector, stage text, click, acquire send authority or change a journal. A missing/mismatched tab, conflicting identities, running or incomplete response, DOM unavailability, or insufficient sealed evidence must fail closed with a reason. Repeat the check just before any separately authorized future apply/release; it is a preflight, not a replacement for the worker's identity and click barriers. Any rebind needs its own authorization and immutable audit trail.

**Observed read-only probe of the real incident:** original predecessor tab ID `ACB6805EA3C4F499DF93FE39243CEDCE` had **zero matching CDP targets**. Production `createLiveBrowser().requireTab` returned `tab_missing`. The stored predecessor binding and active task binding still matched, and historical observation recorded a finished `implementation_done` response, but no fresh predecessor evidence could be verified. Consequently `predecessorTabPresent=false`, `predecessorEvidenceVerified=false`, `readyForExecution=false`, `writes=false`.

**Historical prototype milestone:** a read-only, in-memory decision matrix executed against 16 cases, passing 16/16 (valid exact identity; missing, duplicate and replacement targets; mismatched route/WebSocket; binding drift; missing completion record; worktree, task, project, sealed-message, turn-count, marker and response-state changes; unavailable observation). This was **not** used to authorize a send. **Superseded for engineering status** by `docs/FLOWDECK_PREDECESSOR_READINESS_PRODUCTION_GATE_2026-10-16.md`: the production successor preview now includes the fail-closed predecessor gate and permanent regressions. Neither milestone authorizes another recovery execution.
