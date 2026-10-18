# Script catalog

Run scripts from the repository root after installing the locked dependencies. Most runtime CLIs import `dist/`; they do not necessarily rebuild it. Do not change a frozen build during a live attempt.

## Documentation / local checks

| Script | Purpose |
|---|---|
| `check-docs.mjs` | Check inline local Markdown links in current entry docs; `--all` includes historical docs |
| `flowdeck-fresh-pilot-preflight.mjs` | Read-only preparation proposal checks; does not authorize launch |
| `flowdeck-replay-check.mjs` | Fetch an exact Temporal history and replay locally; does not start that workflow |
| `flowdeck-autonomy-replay-check.mjs` | Read-only exact autonomous Temporal history replay; no workflow starts, signals or browser actions |
| `flowdeck-predecessor-readiness.mjs` | Read-only predecessor evidence evaluator used by reconciliation |
| `flowdeck-observation-probe.mjs` | Read-only exact-tab rendering diagnostics; no raw conversation text, scrolling, refresh, adoption or Send |

## Active runtime (side-effecting)

| Script | Purpose / caution |
|---|---|
| `flowdeck-launch.mjs` | Coordinated real worker + workflow + follower; can lead to browser submissions |
| `flowdeck-supervisor.mjs` | `status` reads projection; `workflow-status` reads Temporal; `worker`/`start` are live operations |
| `flowdeck-work-events.mjs` | `status` reads inbox; `once` reads source; only `follow` writes checkpoints/inbox and signals workflows |
| `flowdeck-reconcile-events.mjs` | Reconciliation tooling; inspect its mode before use, do not assume all modes read-only |
| `flowdeck-reconcile-send.mjs` | Send recovery preview/apply tooling; applying is not a dry run |
| `flowdeck-resume-send.mjs` | Separate recovery path, not a normal restart button |
| `flowdeck-attempt-scope.mjs` | Shared persistent sender-scope helper; never manually clear its claims |

Start with `--help` where supported and the [human runbook](../docs/FLOWDECK_HUMAN_RUNBOOK_2026-10-16.md), not a guessed argument list. Stopping a process does not remove its durable Temporal execution.

## Controlled test harnesses

- `flowdeck-pilot-budget-smoke.mjs`: real Temporal, unique queues, fake browser activities. Scenario names are documented in the human runbook.
- `flowdeck-supervisor-smoke.mjs`: real Temporal synthetic scenarios, including publication outages.
- `flowdeck-autonomy-runtime.mjs`: **synthetic only**, real Temporal and autonomous workflow with isolated fake-browser and fake-source effects, durable provenance, closeout and same-run restart. Use `--mode=synthetic --manifest=ABSOLUTE_TEMP_FILE --non-interactive` or `node --test tests/flowdeck-autonomy-runtime.test.mjs`; it is not a live sender.
- `flowdeck-browser-check.mjs`: **real browser mutation without Send**; creates an owned tab, stages/clears its transport draft, and closes it. Never run alongside a live sender.
- `flowdeck-browser-test-draft.mjs`: owned transport-draft cleanup helper, not a general owner-draft deletion tool.

## Legacy and environment-specific tools

`sashai-*`, `oracle-sashai.mjs`, `ui-sashai-plugin-smoke.mjs`, `verify-sashai-browser-report.mjs`, and `diagnose-oracle.mjs` support historical pilots or environment-specific integrations. Some can send messages or write evidence. They are not interchangeable with the current coordinated launcher.

`install-dashboard.sh`, `install-worker.sh`, `manage-sashai-watcher.sh`, and `open-helium-profile4.sh` manage the established local environment. Inspect before running; do not install background services just to browse a public clone.

`prepare-oracle-local.mjs` prepares the pinned Oracle dependency and may require network access. The optional widget build is under `widgets/jazz-status/`.

Paths remain stable intentionally: runtime scripts, old evidence and operator commands refer to them. This catalog organizes their purpose without breaking those interfaces.
