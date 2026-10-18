# Flowdeck MVP documentation

## Start here

| Need | Document |
|---|---|
| Test the app on your Mac, step by step | [Manual Mac testing](operations/manual-mac-testing/README.md) |
| Know the MVP goal and next implementation work | [Single MVP implementation plan](plans/FLOWDECK_AUTONOMOUS_MVP_PROGRAMMER_GUIDE.md) |
| Understand the existing system | [Architecture overview](architecture/overview.md) |
| Run developer checks | [Autonomy runner reference](operations/flowdeck-autonomy-runner.md) |
| Understand source events | [Work-event contract](operations/FLOWDECK-WORK-EVENTS.md) |
| Diagnose browser observation | [Browser diagnostics](operations/browser-observation-diagnostics.md) |
| See the reported attended demonstration | [Attended MVP hand-in](FLOWDECK_ATTENDED_MVP_HANDIN_2026-10-18.md) |

## Current boundary

A bounded attended P1 → continuation → P2 cycle is documented as completed, with external review pending. That historical result is not a fresh test of the current checkout. Fully automatic initial launch and the complete unattended production composition still need executable integration and acceptance. The manual runbooks distinguish current runnable stages from missing implementation.

The delivery order is **one task → observed result → continuation → second task → automatic start → bounded unattended campaign**. No new dashboard, framework, database or multi-project scheduler is required for this MVP.

## Compatibility and maintenance

- [Supervisor reference](FLOWDECK-SUPERVISOR-RUNBOOK.md) is the stable help destination used by the CLI.
- [Legacy human-runbook entry](FLOWDECK_HUMAN_RUNBOOK_2026-10-16.md) redirects existing references to the current step files.
- [File map and retained fixtures](FILE-MAP.md) explains why a few dated contract/JSON files remain.
- [Publication checklist](publishing.md) applies when distributing the repository; it is not another manual-test stage.

Superseded research, historical handoffs, dated launch recipes and duplicate plans were removed from the active tree. Tracked versions remain in Git history. A local pre-cleanup archive also preserves untracked material; it is not part of the commit. Runtime state and executable source were not cleaned or reset.
