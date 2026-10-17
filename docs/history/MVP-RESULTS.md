# MVP Run Evidence — 2026-10-14

## Actual environment
- Mac: Tests-MacBook-Air, aarch64-darwin.
- Temporal OSS Server 1.32.1: CLI health `SERVING`.
- Temporal TypeScript SDK: installed with npm and built successfully (lockfile committed).
- Repo Harness CLI 0.20.0, installed globally on MacBook.
- Oracle globally 0.21.3, which fails this Repo Harness browser doctor's exact 0.20.0 requirement. **No live Oracle/ChatGPT browser submission** performed.
- Jev OpenCode Zen `jev-1.13-free` reused from Nix-Config, credential resolved on Mac only, not copied into this repository.
- The Worker service is `org.drunkod.temporal-harness-mvp-worker` (GUI launchd).

## Verified workflows

| Workflow ID | Result | Evidence |
|---|---|---|
| `mvp-78ca5ea0-dcf` | COMPLETED, 2 verified repo tasks | SHA-256, two Git commits, Jev low/confidence=1; browser dry-run was blocked by file policy |
| `mvp-a0eaedc4-53a` | COMPLETED, 2 verified repo tasks | SHA-256, two Git commits, Jev low/confidence=1; initial LaunchAgent lacked Repo Harness in PATH |
| `mvp-79d5bce9-1c5` | **COMPLETED, 2 verified tasks and 2 browser dry-run session records** | Full test below |

### Final proof: `mvp-79d5bce9-1c5`

- Project **alpha**: verified commit `d7cf77860921de1007ba62fea55f10113892d760`; browser session `chgpt_20261014_172437_mvp-alpha-greeting`.
- Project **beta**: verified commit `6a6028c093cc5f3efac19b8dae88ff7df81ec419`; browser session `chgpt_20261014_172438_mvp-beta-greeting`.
- Both Jev evaluations returned `OpenCode Zen Jev low confidence=1`.
- Worktree execution used an exact immutable packet; only `OUTPUT.md` was changed in the worktree, verified by independent SHA-256 and staged diff scope, then promoted into each disposable Git repo.
- Both `TASKS.md` checkboxes were marked complete and committed after successful verification.
- Repo Harness dry-run session `meta.json` files were verified to have `status: dry_run`; **this does not imply a website response**.
- A separate CLI invocation queried the persisted Temporal Workflow and got `temporal: COMPLETED` with the same per-project receipts.

## How to inspect

```bash
cd ~/Documents/work/temporal-harness-mvp
npm run status -- mvp-79d5bce9-1c5
npm run list
(cd .state/third-pilot && node ../../dist/verify.js)
repo-harness chatgpt browser-list --repo .state/third-pilot/examples/projects/alpha
repo-harness chatgpt browser-list --repo .state/third-pilot/examples/projects/beta
launchctl print gui/$(id -u)/org.drunkod.temporal-harness-mvp-worker
```

## Limitations to be clear about during the presentation

This MVP proves **Temporal Worker → task selection → spec packet → Jev classification → Repo Harness browser dry-run record → isolated Git execution → verifier → next project**. It does **not** claim actual AI planning, live browser consultation, Codex execution, ChatGPT Website conversation resume, or RemoteMCP-Jazz custom orchestration MCP tools. Commands are currently available through the existing Remote Desktop Commander plugin, which can run local CLI/status queries. The Worker survives closing the browser, but macOS login/session availability and Temporal service availability still matter.

## Next enhancement

Keep this new repository independent. Add a ChatGPT-facing thin MCP control adapter and a real model-backed immutable spec compiler only after the live browser version/profile and independent planner questions are resolved.
