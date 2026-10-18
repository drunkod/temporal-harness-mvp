# Flowdeck — Attended Temporal MVP demonstration

**Demonstration date:** October 18, 2026  
**Scope:** An attended, bounded two-task implementation workflow.  
**Result:** End-to-end implementation-level acceptance **passed**; independent review is pending.

## What Flowdeck demonstrates

Flowdeck uses a Temporal supervisor to coordinate a human-initiated task in a ChatGPT Project with bounded automated follow-ups. The owner sends the first P1 prompt. The supervisor watches a real work-session event stream, correlates task and browser identity, and—only after the correct evidence appears—may send one continuation in the same conversation and one next task in a different Project conversation. It preserves durable dispatch journals and treats missing or conflicting identity as a reason to wait or refuse, not to retry blindly.

The demonstration used Helium Profile 4 and the installed Probe RemoteMCP2 connector. It did **not** claim fully unattended reliability or independent artifact approval.

## Demonstrated sequence

| Step | Demonstrated outcome |
|---|---|
| Owner manually submitted approved P1 once | Correlated to its prepared empty Project tab and exact first-message seal |
| P1 stage-one work session | Reported partial and wrote the intended checkpoint |
| Supervisor's P1 continuation | Exactly one authorized same-chat submission, reconciled |
| Continued P1 work | Reported success; checkpoint acquired its Completion section |
| Supervisor's P2 task submission | Exactly one authorized new-chat submission, reconciled |
| P2 work session | Reported success; standalone glossary created |
| Workflow terminal state | **COMPLETED / approved_cycle_finished / implementation_done_review_pending** |

The execution used **exactly two of two permitted automated sends**, three genuine source work sessions, and six delivered source events. Temporal history contained **977 events, 98 scheduled activities, and no unresolved or failed activities**. Both implementations ended `implementation_done`; both external reviews remain `review_pending`. The browser launcher, worker, and event follower were shut down cleanly after completion.

## Deliverable outcomes

**P1 — two-turn checkpoint:** The first turn wrote a Stage 1 checkpoint, leaving Stage 2 pending. One automated continuation appended a Completion section stating Stage 2 finished and external review pending. The earlier checkpoint remains present.

**P2 — independent glossary:** A separate Project conversation produced concise definitions distinguishing an ended work session, `implementation_done`, and `review_pending`. It does not confuse a session report with independent approval.

Both outputs were checksum-verified against private pilot evidence. The private report contains the full artifact hashes, original source events, authoritative workflow/run identity, and journal reconciliation. These sensitive operational details should not accompany a public hand-in.

## Tested source and build identification

- Sashai worktree base commit: `7d2cc6818afe837119e0c171928506b1c4967269`.
- Temporal workflow compiled SHA-256: `544c2aa1d8496484b2177f74566a17b0f09139ad5595a766c4ddab12ba87e076`.
- Supervisor activities compiled SHA-256: `91cbfe608d35e7b075df3a6f84caf9366bf3583e5be3b569f0136458711b41c8`.
- Initial manual-start guard compiled SHA-256: `0fa8e87f3869c36dfb33741a2d0b1a3d662e1418588d6070be07cd91094afb01`.

These are **artifact identifications, not a claim of a clean or published Git release**. The harness contains local/uncommitted work; promoting a reproducible release requires explicit source review and versioning.

## Reproducing the verified checks

In an authorized checkout with the project's locked Node dependencies and compatible Node/Temporal tooling, the **offline fixture and documentation checks** can be reproduced without opening ChatGPT or sending a message:

```sh
npm ci
npm run build
node --test tests/flowdeck-manual-start.test.mjs \
  tests/flowdeck-supervisor-activities.test.mjs \
  tests/flowdeck-successful-cycle-closeout.test.mjs \
  tests/flowdeck-launch.test.mjs
node scripts/check-docs.mjs --all
```

This command sequence validates bounded safety behavior through fixtures; it does **not** replay or re-execute the historical successful live run. Reproducing a **new** attended live run additionally requires a separately authorized and enrolled project, its actual Temporal/source-event infrastructure, an authenticated supported Project browser profile, a verified empty prepared tab, and an installed connector. The owner must manually submit the initial P1 once after combined launcher readiness. The completed pilot's task IDs, reservations and send journals are **not reusable**. Keep operator configuration, tokens, browser data and raw `.state` evidence private.

## Safety controls demonstrated

The human owns initial P1 Send. A separately prepared browser target must show a hydrated empty Project surface and no draft. Initial adoption matches the prepared tab, Project, task, worktree, and connector-inclusive hash of the first user message. Automated dispatches require a finished task decision and durable event/phase claims, preserve dispatch journals, and refuse uncertain or conflicting sends without blindly resubmitting. The two-message budget prevents an unapproved third automated submission.

## What the result does **not** prove

- Independent content quality review or acceptance, production deployment, or merge.
- Unattended, long-running reliability across arbitrary browsers, accounts, tasks, networks, or platform UI changes.
- Complete recovery from crashes, event loss, browser unavailability, cancellation, or ambiguous partially executed Sends.
- Repeatability across multiple fresh live trials; this hand-in documents **one** successful attended cycle.

Operational closeout **was subsequently applied and verified** for this exact successful execution. The independently reconciled claim was archived under a durable one-time receipt, its original browser-owner scope is no longer occupied, and the successful Temporal history, both send journals, and output hashes remain preserved. This completed archival does not authorize replay of this execution or establish unattended production readiness.

## Suggested external review

A reviewer should inspect the P1 checkpoint and P2 glossary for intended meaning, verify that implementation status was not misrepresented as approval, inspect the terminal Temporal result and budget evidence privately, and audit the completed closeout receipt and refusal tests. Operational claim release is complete; independent artifact acceptance is still pending.

**Hand-in statement:** Flowdeck successfully completed one bounded attended two-task Temporal pilot: it adopted a human-started P1, issued one same-chat continuation, submitted one independent P2 in a separate Project chat, and recorded both tasks as implementation complete with external review pending. This proves the attended MVP demonstration boundary, not unattended production readiness.

---

*Sanitized summary. Private run IDs, chat URLs, user/device/account identifiers, connector configuration, work-session IDs, and raw event/journal records are intentionally omitted.*
