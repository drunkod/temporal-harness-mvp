# Flowdeck F4: status projection failure isolation

**Date:** 2026-10-16  
**Scope:** source changes and isolated tests only. No production workflow start, signal, recovery authorization, claim repair, browser action or Task B submission. Existing incident remains blocked.

## Review of preceding work

- F3: the shared exclusive `wx` scope claim and its cross-process regression provide mutual exclusion for the same checkout/device/profile. The claim is synced and retained after uncertain outcomes. Normal and recovery starts use it; recovery release checks its owner/project/device/workflow identity. This is **not** a host-wide lock across cloned roots, differently configured device IDs or namespaces. README wording now states that limit. Keep the MVP to one configured checkout/profile scope.
- F6: strict final marker interpretation is retained. The targeted activity test confirms marker-less completion does not authorize advancement.
- F5: current entrypoints and protected-state warnings precede the historical README material. Historical commands remain available and must not be mistaken for current product entrypoints.
- Existing forward seal preservation, predecessor readiness, authorization lineage and cancellation guards were not weakened.

## Implemented F4 behavior

`src/flowdeck-supervisor-workflow.ts` evaluates and memoizes:

```ts
patched('flowdeck-status-projection-isolation-v1')
```

For the new branch, only `publishSupervisorState` uses a dedicated proxy:

- Start-to-close: 5 seconds.
- Schedule-to-close: 15 seconds, including queueing and retries.
- Maximum attempts: 2; initial retry interval 1 second, maximum interval 2 seconds.

Publication is still awaited, but is bounded rather than an indefinitely required success. A publication failure updates queryable workflow state and does not itself abort the business loop. There is no unawaited background publisher and no extra recovery/scheduler service.

Every other activity keeps the original two-minute start-to-close timeout and one-attempt policy. In particular, send failures, claims/journal failures, missing authority and recovery release gates remain fail-closed. A cancellation recognized by `isCancellation()` is rethrown at the publication boundary, not converted to an ordinary projection outage; surrounding legacy workflow error handling is otherwise unchanged.

### Authoritative publication health

The existing `flowdeckSupervisorStatus` query and workflow result include an optional field on new executions:

```json
{
  "projection": {
    "status": "degraded",
    "consecutiveFailures": 1,
    "lastPublishedAt": null
  }
}
```

- Failure counts are failed publication calls after their activity retry policy, not individual retry attempts.
- `lastPublishedAt` identifies the last acknowledged published snapshot's workflow timestamp, not filesystem completion wall-clock time.
- A subsequent acknowledged publication resets the consecutive failure count.
- Raw filesystem/transport error messages are not copied into health state.
- Queries return a copy of nested health state.
- Health fields survive the activity projection allowlist; other unapproved/private fields remain excluded.

The failed disk projection cannot be relied on to report its own failure. Operators must use the Temporal query/result for authoritative health. The dashboard now displays the saved snapshot timestamp and explicitly says live workflow freshness is unconfirmed, rather than labeling an SSE delivery as a live workflow update.

The snapshot remains disposable. Activity timeout does not forcibly terminate filesystem code; a late write can leave an older snapshot on disk. This does not authorize dispatch, and the UI must not treat it as authoritative. A revision-fenced independent projector is a possible future improvement, not part of this packet.

## Replay compatibility design and limits

The patch decision is made once at workflow entry. Histories without the marker retain the **original activity options, payload shape and publication-error behavior**. They do not silently acquire new failure semantics midway through replay. New executions use the marker and bounded publication branch. Both `flowdeckSupervisor` and `flowdeckRecoverSend` flow through this decision.

Do not remove the legacy branch or rename the patch ID. Do not advertise this as migrated behavior for already-running unpatched executions.

The tests exercise both branches using the existing workflow shim. **No real Temporal history replay was performed.** Before deploying this workflow bundle to a live task queue, replay representative captured legacy histories offline with the installed SDK, including normal and recovery executions. Also validate a marker-bearing synthetic history using a separately approved isolated Temporal test session. The shim does not implement Temporal history matching, activity retries or real timer expiry; it asserts the selected policies and workflow decisions.

## Validation performed

1. `npm run build` — passed.
2. `node --test tests/flowdeck-supervisor-workflow.test.mjs tests/flowdeck-attempt-scope.test.mjs tests/flowdeck-predecessor-readiness.test.mjs` — **74 passed, 0 failed, 0 skipped**.
3. Targeted activity/dashboard tests selected with `--test-name-pattern='projection|strict|marker|interpret|continuation sends exactly once|next task starts in a NEW|adopts one running project'` — **9 passed, 0 failed, 0 skipped**.

**83 selected tests passed** in the final validation run. The full repository suite was not rerun for this packet; the prior reported 311-pass baseline is not a post-change full-suite result.

New coverage includes persistent and transient publication failures, failed final publication, failed enrollment and journal/send behavior during an outage, missing recovery release, cancellation propagation at publication, defensive query copies, old-branch behavior, projection field filtering and UI timestamp labeling.

The dashboard integration test starts a disposable local dashboard with temporary state and uses the existing Temporal connection; it does not start or signal workflows. Scope tests spawn temporary Node processes. Other selected tests use injected activities/browser readers or workflow shims. No live incident preview or historical state digest was rechecked here.

## Changed files

- `src/flowdeck-supervisor-workflow.ts`
- `src/flowdeck-supervisor-activities.ts` (projection allowlist only for this packet)
- `public/supervisor-status.js`
- `tests/flowdeck-supervisor-workflow.test.mjs`
- `tests/flowdeck-supervisor-activities.test.mjs`
- `tests/flowdeck-dashboard.test.mjs`
- `README.md` (scope-claim guarantee wording)
- This handoff.

Build output was regenerated. The earlier frozen-build manifest must not be used to certify the revised workflow/activity build. No commits or archives were made.

## Next steps

1. Offline historical replay and isolated real-Temporal projection-failure testing before live deployment.
2. Run the full regression suite in its documented environment, distinguishing skips and local-service tests.
3. Optionally decouple dashboard startup from its eager legacy Temporal connection; that remains an availability issue, but no longer needs to be confused with business workflow authority.
4. Resolve the historical missing-tab/message-seal/occupied-authorization incident only through a separately approved audited decision. This patch grants no retry, rebind or authorization reuse.
