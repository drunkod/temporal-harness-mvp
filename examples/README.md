# Configuration examples

[flowdeck-supervisor.example.json](flowdeck-supervisor.example.json) documents the enrollment shape. Its placeholder identities, placeholder URL, and empty task list deliberately **cannot authorize a launch**. Do not copy it over an existing `.state/flowdeck-supervisor/projects.json`.

The current loader supports a specific Project URL; an arbitrary URL is rejected. Multi-project configurability is not implemented merely by changing this example. Real enrollment must match the supported adapter, installed connector owner/device, approved worktree and exact active-plan task titles.

For an attended two-task pilot, the project also needs this policy, with IDs matching its actual ordered task list:

```json
{
  "attendedPilotBudget": {
    "schema": "flowdeck.attended-pilot-budget/v1",
    "initialTaskId": "P1",
    "nextTaskId": "P2"
  }
}
```

This restricts sends; it does not grant approval. Complete runtime instructions are in the [human runbook](../docs/FLOWDECK_HUMAN_RUNBOOK_2026-10-16.md). Its live identities and machine paths are local operator references, not portable public defaults.

`projects/` contains generated historical fixture repositories. It is ignored and must not be added to GitHub. Fixture seeding can create Git repositories/commits; it is not a harmless status command.
