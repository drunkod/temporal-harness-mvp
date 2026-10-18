# 04 — Automatic initial Send: implementation gate and test

**Current status: BLOCKED pending executable wiring.** The attended run in 01–03 proves manual first Send plus observation. It does not prove automatic startup. Do not run another attended test and label it automatic.

The reviewed `scripts/flowdeck-run.mjs` requires a concrete injected production runtime; its ordinary CLI path is still fail-closed when that runtime is absent. There is no honest current live command in this guide that completes this stage.

## 1. Check the current boundary without starting a campaign

From the checkout:

```sh
node --input-type=module <<'NODE'
import {readFile} from 'node:fs/promises';
console.log(await readFile('scripts/flowdeck-run.mjs','utf8'));
NODE
```

Give this file and the prior test results to your programmer. Ask for this specific delivery:

> Wire the supported entrypoint to the existing production automatic-initial-send implementation. Provide a fresh, explicitly bounded test policy, the exact command, pinned workflow/run status command, and an enforced single-task stop boundary. Do not change the attended launcher or just remove its manual wait. Do not run the full multi-send campaign and rely on us stopping it in time.

The documented command shape is `node scripts/flowdeck-run.mjs --policy /absolute/local-standing-policy.json --non-interactive`, but the path is illustrative and the command is not a working live procedure until wiring is complete. Do not invent a policy from an old example JSON schema.

## 2. Manual acceptance after that delivery

Use a fresh scope AFTER the attended run has been reconciled. Do not reuse its workflow or prepared records.

1. Open the enrolled Project/browser profile and a status terminal.
2. Record the programmer's exact command, policy scope and build identity.
3. Start the supplied automatic entrypoint once.
4. Do not copy a prompt, click Send, type Enter in the composer or touch the browser.
5. Observe preparation, one initial message, exact work-session adoption and result.
6. Check the workflow/run identity and the durable initial dispatch record supplied by the status/evidence output.
7. Wait for the explicit bounded terminal state. No P2 or continuation may occur if this is configured as a single-task test.

## Pass conditions

- Zero manual browser input after start.
- Exactly one initial submission attempt, reconciled to the intended user turn.
- Correct task/worktree/profile/chat.
- Task observed through the real source and supervisor.
- Bounded terminal result and no unexpected follow-up sends.
- Missing policy or missing adapter produces a structured error, not an interactive question.

If any condition fails, capture the first error and stop using file 07's distinctions. Do not add launchd/background auto-restart yet; it could repeat an incomplete start path.

Record BLOCKED rather than FAIL until an executable implementation exists. Once this passes, the programmer can enable and re-test continuation and P2 in automatic mode using 05–07 with the autonomous runner's actual status command and three-send budget. The attended CLI/status is not interchangeable with a different autonomous workflow type.
