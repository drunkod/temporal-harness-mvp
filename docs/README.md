# Documentation index

This directory contains current navigation, engineering records, plans, and retained evidence. **Moving or editing documents invalidates historical document manifests** that recorded their paths or hashes; manifests under `.state/` are intentionally not updated. File organization is not sanitization: historical records may include local paths, service identifiers, conversation/project IDs, or run IDs. Review each historical document before any public release. Nothing in this index approves publication.

## Current entry points

- [Architecture overview](architecture/overview.md) — concise description of the current implementation.
- [Work-event contract](operations/FLOWDECK-WORK-EVENTS.md) — event semantics.
- [Fresh attended pilot runbook](operations/FLOWDECK_FRESH_ATTENDED_PILOT_RUNBOOK_2026-10-16.md) — proposal only; not authorization.
- [Human runbook](FLOWDECK_HUMAN_RUNBOOK_2026-10-16.md) — stable human-facing operational reference; verify current state before acting.
- [Publishing review](publishing.md) — publication guidance.
- [File map](FILE-MAP.md) — relocation ledger and stable-path exceptions.

## Historical and non-authorizing records

`history/` preserves dated implementation notes, reviews, incident/recovery records, handoffs, test evidence, and superseded procedures. `plans/` retains design and roadmap material, including proposals that are not current authority. These records are historical context, not authorization to run a workflow, send a message, or perform a live operation. The stable-path task contracts and artifacts listed in [FILE-MAP](FILE-MAP.md) remain at their original locations for code/test compatibility and are also historical records.

## Local-only evidence and research

`research/` retains source research and its existing provenance records. Historical evidence may refer to ignored `.state/` artifacts or local-only resources that are not part of a public checkout. Their presence or a historical test result does not establish current readiness. Do not publish without a separate content and privacy review.

## Publication review

All moved/edited historical documentation requires review before public release. This organization preserves evidence and does not remove private details. In particular, check for local filesystem paths, identifiers, and references to local `.state/` data. See [publishing.md](publishing.md) for the separate publication process.

## Current status note

The latest P1 attempt is paused. The isolated null-task-identity fix is not deployed. Do not infer unattended or live end-to-end success from earlier test results or pilot records.
