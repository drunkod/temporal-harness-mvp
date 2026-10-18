# Diagnose a conversation that becomes readable only after interaction

## What is known

The reviewed attended pilot delivered its two allowed automated messages: a P1 continuation and P2's initial prompt. It paused while reconciling P2; the P2 agent later finished, after the Temporal execution had closed. Artifact existence does not retroactively update the workflow result or approve external review.

Two issues must remain separate:

1. **Post-send identity hydration:** the promoted activity now treats absent task/worktree/Project fields as pending rather than a different task. Observed conflicts still refuse. The historical failed field was not logged, so the fix reproduces a defect category, not a proven reconstruction of that exact observation.
2. **P1 answer visibility:** the earlier observation had little rendered text and no readable answer. Manual interaction preceded content becoming available. That does not prove scroll, refresh, focus, elapsed time, or any one operation was the cause.

Do not add blind refreshes, automatic scrolling, or a `textContent` fallback for completion authority without a controlled reproduction. `textContent` can expose hidden, stale, duplicate, or unrelated text. It is useful diagnostic evidence, not a substitute for bound visible conversation evidence.

## Read-only probe

`scripts/flowdeck-observation-probe.mjs` samples exactly one specified CDP target and supported conversation URL. It does not:

- scroll, focus, activate, reload, navigate or click;
- stage or submit messages;
- invoke an activity or write a binding, claim, inbox, or workflow;
- return prompt/answer text, cookies, HTML, debugger URLs, or credentials.

It returns timestamps, text lengths, role/heading counts, identity-field presence, document visibility/focus, busy/stop signals and scroll-container geometry. Parsing occurs inside the page; only the diagnostic summary is returned. Reading `innerText` can cause browser layout work; a passive sample is not a promise of zero rendering impact.

From the repository root:

```sh
node scripts/flowdeck-observation-probe.mjs --help
```

Command template — substitute the exact values from your local attempt evidence, not a similar tab:

```sh
node scripts/flowdeck-observation-probe.mjs \
  --tab EXACT_CDP_TARGET_ID \
  --url EXACT_SUPPORTED_PROJECT_CONVERSATION_URL \
  --samples 3 \
  --interval-ms 1000
```

Samples are bounded to 1–10, with intervals 250–5000 ms. The CDP transport also has a bounded timeout. A missing/changed/ambiguous target stops the command; it never selects a replacement tab. Query/fragment parameters are not accepted in the expected URL.

To save output, redirect it into a new private ignored evidence file, not a committed document. The probe itself does not write a file. A shell redirection is a separate local write. Record the deployed activity hash and the tab's ownership alongside the samples.

## Interpreting output

| Evidence | Possible interpretation | Next step |
|---|---|---|
| Both main text lengths very small | Content not present or not exposed by this DOM surface | Capture readiness/visibility; observe without intervention first |
| `textContent` much larger than `innerText` | Hidden/offscreen/render-skipped content may exist | Inspect visibility/layout on a non-live reproduction; do not authorize from hidden text |
| Main/assistant text exists but `parsedAssistantLength` is zero | Extraction logic or a deliberately incomplete latest turn | Reproduce exact message/heading structure in a parser fixture |
| Zero author-role elements but nonzero heading counts | Work-layout fallback, not necessarily an empty conversation | Inspect the existing heading-based path |
| `generationStopVisible:true` | Generation may still be running | Wait; do not classify completion |
| `pageBusy:true` but no visible stop control | Some node anywhere on the page has `aria-busy=true` | Treat as a hint; identify whether it belongs to the conversation before changing policy |
| Identity missing | Not enough evidence yet | Bounded wait on the same pinned target |
| Identity actually conflicts | Wrong destination/content or unexpected change | Immediate refusal and reconciliation |

`lastAssistant*` fields describe the author-role selector path. They can be zero/false on the Work layout even when `parsedAssistantLength` is positive through the heading fallback. Neither `documentFocused` nor `visibilityState` alone proves the operator selected the correct macOS window.

## Current review measurements

Three passive samples per preserved tab were stable during the review:

| Metric | P1 | P2 |
|---|---:|---:|
| Main `innerText` characters | 5,855 | 3,363 |
| Parsed assistant characters | 711 | 747 |
| User turns from identity reader | 2 | 1 |
| Author-role user/assistant nodes | 0 / 0 | 0 / 0 |
| Task/worktree fields present | Yes | Yes |
| Visible generation stop control | No | No |
| Broad page busy hint | False | True |

Both tabs were readable in these initial samples. This review did not reproduce the earlier stall, refresh/scroll either tab, start a worker, or send messages. P2's broad busy hint deserves investigation, not automatic removal of the busy safety check.

A later passive P2 sample at 20:53:08 UTC still returned 747 parsed assistant characters and complete task/worktree fields, but `pageBusy:false` and zero busy nodes. Main rendered text measured 3,377 characters and the viewport/scroll geometry differed from the initial samples. No cause for that environmental change is inferred. The probe itself performed no scrolling or refresh. This later sample does not support treating P2 as permanently busy.

## Controlled no-send experiment

Do not disturb the preserved incident tabs. Use a separate non-live test view of a completed conversation only after verifying no sender is active. A new view/tab is diagnostic-only and must never replace a pinned workflow binding. Do not launch a supervisor while duplicate diagnostic views exist.

1. **Baseline:** when the symptom naturally occurs, collect at least three untouched samples. Record elapsed time since page load and whether the answer appears visually.
2. **Wait-only control:** wait another short interval and sample again. Content appearing now suggests time/hydration, not a demonstrated need for scrolling.
3. **Focus-only trial:** on a separate reproducible occurrence, bring the test window forward without scrolling or refreshing. Sample again.
4. **Scroll-only trial:** on a separate reproducible occurrence, scroll only the conversation container. Record the action/time and collect before/after samples.
5. **Refresh-only trial:** use another comparable occurrence and refresh without first scrolling. Record the action/time and sample after the same observation interval.
6. Stop once the distinction is supported. If the blank state cannot be reproduced, report that; do not keep opening live tasks to manufacture a test.

Sequentially waiting, focusing, scrolling and refreshing one page does not isolate causation: earlier operations and elapsed time contaminate later comparisons. A no-send completed-chat experiment may also fail to reproduce streaming/live-turn behavior; state that limitation.

## Fix according to the evidence

- **Parser defect:** add a fixture for the exact Work layout and use one structured conversation snapshot for counts, identity and answer classification. Never infer task identity from assistant prose.
- **Render/visibility dependency:** evaluate a bounded, pinned-target observation-preparation operation separately. It must preserve identity and never interact with the composer or Send. Do not ship it merely because a manual refresh once helped.
- **Unrelated busy indicator:** first identify which node is busy; then test whether busy detection should be scoped to the conversation rather than the entire document.
- **Missing identity:** retain pending-with-deadline. Do not turn unavailable data into a successful match.

### Reconciliation extra-user-turn precedence — source hardening (2026-10-18)

A dedicated combined-condition regression reproduced the remaining issue against the **original production `dist/` activity**: when identity was still missing but either the identity reader or the independent observer already counted an extra user turn, the activity returned `pending`. This could delay a correct refusal but could not authorize a new Send.

The source-level activity now checks **positively observed extra user turns before missing-field waiting**. Identity hydration without an extra turn still returns `pending`; real task/worktree/Project/tab conflicts, unexpected user turns, and sealed-prompt mismatches remain refusals. The new regression covers both readers and asserts no duplicate send.

The patch first compiled into **`.state/verification-runs/observation-extra-turn-20261018/dist/`** and passed **53/53 isolated activity-plus-probe tests** (47 activity tests, 6 probe tests). **Promotion update, 2026-10-18:** After confirming no launcher, worker or follower was active, `npm run build` promoted the exact same compiled activity to production `dist/` (SHA-256 `82d42c8cceb6ffc5645b70cb580186561f0fdab44810a2f5a8aba022fe7f7f51`). Its focused production tests passed **53/53** and the workflow JS remained unchanged (SHA-256 `544c2aa1d8496484b2177f74566a17b0f09139ad5595a766c4ddab12ba87e076`). This does **not** resume any closed pilot or recreate spent send reservations.

A further read-only sample of each original pinned tab at 20:58 UTC on October 17 remained stable across three measurements: P1 `main.innerText` 5,869 chars / parsed assistant 711, P2 3,377 / 747; all identity fields readable, no busy or stop controls. The P1 scroll offset differed from an earlier review despite **no scroll performed by this probe**; the environment can change independently, and no cause should be inferred. The historical blank symptom remains **not reproduced**.

## Tests and boundaries

```sh
node --test tests/flowdeck-observation-probe.test.mjs \
  tests/flowdeck-supervisor-activities.test.mjs
```

The review run passed all 52 tests (6 probe tests plus 46 existing activity tests). Fixtures cover output redaction, pinned-route changes, missing/duplicate/replacement targets, bounded arguments, and rendered-versus-DOM text. No full build or workflow change is required for the probe; it imports the existing compiled read-only helpers.

The closed live workflow and exhausted send budget remain unchanged. Closeout must reconcile all three genuine work sessions and both send journals, preserving the distinction between P2's eventual real work and its unobserved completion in Temporal. A no-send probe is not a recovery or relaunch command.
