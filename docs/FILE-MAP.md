# MVP file map and compatibility exceptions

The active documentation has one operator path and one implementation plan:

- `operations/manual-mac-testing/` — eight stage files plus their start page.
- `plans/FLOWDECK_AUTONOMOUS_MVP_PROGRAMMER_GUIDE.md` — consolidated MVP scope, delivery order and completion criteria.
- `architecture/overview.md` — system/source map.
- `operations/flowdeck-autonomy-runner.md` — developer commands and current integration limits.
- `operations/FLOWDECK-WORK-EVENTS.md` and `operations/browser-observation-diagnostics.md` — focused operational references.
- `FLOWDECK_ATTENDED_MVP_HANDIN_2026-10-18.md` — one retained historical demonstration summary, not current launch instructions.

## Stable paths retained intentionally

| File | Why it remains |
|---|---|
| `SASHAI-ARCHITECTURE-REVIEW-TASK.md` | Runtime/test contract; bytes are hashed by report/binding code. |
| `SASHAI-LIVE-TEMPORAL-REPORT-TASK.md` | Live-report activity contract and test input. |
| `SASHAI-BROWSER-ARCHITECTURE-REVIEW-2026-10-15.md` | Established report output named by workflow/tests and repair tooling. |
| `FLOWDECK_FRESH_ATTENDED_PILOT_PROPOSAL_2026-10-16.json` | Exact preflight fixture read and hashed by scripts/tests. |
| `FLOWDECK_FRESH_MANUAL_PILOT_*.json` | Retained historical configuration/task specifications associated with existing dated tools; not fresh enrollment. |
| `FLOWDECK-SUPERVISOR-RUNBOOK.md` | CLI help destination; replaced dated recovery recipes with current reference. |
| `FLOWDECK_HUMAN_RUNBOOK_2026-10-16.md` | Compatibility redirect to current manual instructions. |

Do not edit contract bytes merely to remove dated headings. Moving these files requires a separate consumer/fixture migration. Some checkpoint paths named by historical tooling belong to external worktrees, not this checkout; this cleanup does not fabricate or remove those artifacts.

## Removed material and recovery

The active tree no longer carries `history/`, `research/`, obsolete architecture handoffs, old launch/prepared-pilot Markdown recipes, or competing plans. MVP requirements were consolidated rather than treating all historical proposals as current obligations.

For tracked documents, inspect the parent of the cleanup commit with `git show` to recover a historical version. A pre-cleanup copy of the entire docs tree and navigation files is also stored locally at `.state/documentation-cleanup/before-mvp-cleanup-20261018.tar.gz`; it includes documents that had never been committed. The archive is ignored, not uploaded, and not a runnable release artifact.

Historical path/hash manifests were not rewritten. Documentation cleanup changes document hashes and must not be represented as the original verified bundle. Source, tests, package files, runtime journals, enrollment and browser data were left outside this cleanup.
