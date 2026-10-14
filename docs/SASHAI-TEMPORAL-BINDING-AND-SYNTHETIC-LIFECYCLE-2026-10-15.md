# Temporal identity binding and fresh synthetic report lifecycle

Date: 2026-10-15

Scope: **Oracle-only Sashai supervisor**, with real local Temporal workflows and a **disposable synthetic report fixture**. No new ChatGPT or Desktop Commander prompt was submitted in this milestone, and no Sashai product implementation was approved.

## 1. Post-resume review binding — fixed and exercised in real Temporal

The historical report-review workflow now saves an immutable binding **before** `waiting_for_durable_resume`:

- Task ID: `sashai-architecture-report-2026-10-15`
- Attempt ID (nonce): `26c92478-b148-4a02-87c1-0ea7969b68c9`
- Original Sashai project conversation: `6acfe3ee-ad30-83eb-b92e-fa069ac9ee6e`
- Task-contract SHA-256: `8f64480c627c2605c58f6e4cd61705b30e566e7c556f6cca9a9c191c307acaed`
- Report path: `docs/SASHAI-BROWSER-ARCHITECTURE-REVIEW-2026-10-15.md`
- Artifact SHA-256: `4637e824aa9b2b2ac865c93b1a9040a1b21f86e539e3253a00cb4ece36f14ba0`
- Hash of the original write-ahead send claim and `report-only` approval.

After the durable wait, `reverifyReportEvidence(expectedBinding)` **re-reads** the persisted attempt, current contract, original send claim and artifact. The independent report verifier now returns **task ID, attempt ID, chat URL, contract SHA, artifact path and artifact SHA**. The activity compares all receipt identities to the pre-wait binding, reruns the immutable binding check after verification, and returns any differences as acceptance failures. The workflow also checks the returned identity before entering the accepted state. It cannot start any next task.

**Live v2 Temporal proof:** workflow `sashai-report-binding-v2-8f64480c627c2605c58f` started against the already accepted report, reached `waiting_for_durable_resume`, survived its dedicated worker shutdown/restart, and completed after `resumeReportReview` at `verified_approval_boundary`, with `dispatchPermitted=false` and `nextTaskPermitted=false`. It **did not** send a new prompt. A read-only negative test provided a changed expected attempt ID; the verifier rejected it at pre-verification, receipt, and post-verification comparisons. No historical acceptance files were modified.

## 2. Fresh report lifecycle — real Temporal, synthetic transport

Separate queue: `oracle-sashai-synthetic-report`. No browser-send activities are registered; all output is restricted to ignored `.state/sashai-synthetic-report/` fixture folders. The synthetic contract explicitly specifies `approved: disposable_fixture_only` and `SYNTHETIC_REPORT_ONLY_NO_BROWSER`. Synthetic conversation IDs use `synthetic://`, **not** ChatGPT project URLs.

**Repair run:** `sashai-synthetic-temporal-v1-repair`.

1. Temporal persisted a **new** task/attempt ID and paused at `waiting_before_send_boundary`.
2. Stopped the dedicated worker; Temporal retained the run. Restarted the worker and confirmed the **same attempt ID** and pre-send state.
3. Sent `resumeSyntheticReport`. A simulated, idempotency-guarded send wrote an intentionally incomplete fixture report **once**.
4. Independent verification returned `required_marker_missing`; a specifically scoped single correction replaced `STATUS: INCOMPLETE` with `STATUS: COMPLETE` and the required acceptance marker.
5. Verification returned `verified_report` and the workflow finished at `verified_approval_boundary`, with both dispatch and next-task permissions set to false.

**Indeterminate-run proof:** `sashai-synthetic-temporal-v1-uncertain`.

The simulated sender wrote the **write-ahead send claim and artifact**, then raised `SYNTHETIC_TIMEOUT_AFTER_SEND_CLAIM` before returning. Temporal did **not** retry the activity. It read the persisted claim, recorded `send_outcome_indeterminate`, and completed in **`blocked_indeterminate_send`**, without requesting an automatic correction or selecting a next task. Duplicate invocation of the sender fails with `EEXIST`. No synthetic correction claim exists for this run.

## 3. Proven versus still required

| Capability | Evidence |
| --- | --- |
| Revalidate exact identity after a Temporal wait | Proven by the real bound-v2 read-only workflow and mismatch tests |
| Durable worker recovery at the pre-send boundary | Proven by actual worker stop/start in the synthetic repair run |
| First send, verifier rejection, scoped same-chat correction, re-verification | Proven **only using simulated transport and a synthetic chat identity** |
| Lost response after an already-persisted send claim | Proven **using injected failure**; no automatic retry |
| Real connector-selected fresh ChatGPT task **driven by Temporal** | **Not tested or authorized** in this pass |
| Real Desktop Commander corrective continuation **driven by Temporal** | **Not tested**; prior browser-operated one-off correction remains separate |
| Production exactly-once browser delivery or end-to-end reliability | **Not established**; write-ahead claims provide at-most-once attempt behavior, with uncertainty requiring reconciliation |
| Sashai product implementation | **Not authorized; no active execution plan** |

The two synthetic run IDs plus the bound v2 run ID are stored in local Temporal history. Synthetic attempts and sealed write/correction claims are under ignored `.state/sashai-synthetic-report/`. The tests deliberately fail if any of the run identities, attempt identities, receipt fields, or approval boundaries deviate.

## 4. Next approval boundary

The next useful live test is a **new explicitly approved report-only browser task** with a specific contract, new attempt ID, non-overwriting output and acceptance criteria. Only then should Temporal use a connector-preserving UI sender, observe the report, and—if a controlled, harmless acceptance condition fails—send a one-time same-conversation correction and reverify. The workflow must reconcile uncertain sends rather than retry them.

**Do not** promote this fixture proof to permission for autonomous Sashai product tasks. The existing Sashai active-plan/worktree markers remain absent; deferred research and already completed localization tasks are not an execution queue.

Reproduction (read-only):
```bash
cd ~/Documents/work/temporal-harness-mvp
node scripts/sashai-binding-proof.mjs status
node scripts/sashai-synthetic-temporal.mjs status repair
node scripts/sashai-synthetic-temporal.mjs status uncertain
npm test
```
