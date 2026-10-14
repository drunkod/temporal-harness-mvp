# Temporal × Repo Harness × Jev — runnable MVP

**Created:** 2026-10-14 · **MacBook:** Tests-MacBook-Air · **deadline demo:** next morning.

A small, independent Git repository under `~/Documents/work/temporal-harness-mvp`. Its purpose is to prove a **real Temporal-controlled loop**, rather than merely draw a diagram.

## Proven stages

```
Temporal Server 1.32.1 (installed in Nix-Config, loopback only)
   ↕ Temporal TypeScript Worker, taskQueue=repo-harness-mvp
   → discover TODO across two disposable Git repositories
   → independently compile a full exact-output spec packet with SHA-256
   → optional OpenCode Zen Jev reasoning-risk classification (advisory)
   → Repo Harness ChatGPT browser-consult --dry-run (no Web submission)
   → isolated Git worktree → exact packet application (Codex substitute)
   → independently check file hash + changed-file allowlist
   → verified Git commit promotion → check off TODO
   → durable receipt → next repo
```

**Important scope:** This is an intentionally narrow proof. The spec compiler is **deterministic**, not an autonomous AI planner. The executor applies an exact file, not a real Codex model invocation. The browser stage generates local **dry-run** sessions; it is not proof of a completed ChatGPT consultation. Temporal is real and persistent, but retry recovery of arbitrary side effects is not yet production-hardened. No real project repositories are modified.

## Quick start on MacBook

```bash
cd ~/Documents/work/temporal-harness-mvp
npm install
npm run build
npm run seed                       # two distinct disposable Git repositories
npm run worker                     # terminal A: real Temporal Worker
npm run start -- --wait            # terminal B: real two-repo Temporal Workflow
npm run verify                     # checks final files, receipts, and TODO completion
npm run list                       # list workflow IDs and statuses
npm run status -- <workflow-id>    # inspect one workflow
npm test
```

The server must respond `SERVING` to:
```bash
~/.local/share/temporal-server/nix-cli/bin/temporal --address 127.0.0.1:7233 operator cluster health
```

The worker can run without ChatGPT.com being open. A running Workflow is queryable by `mvpStatus`. To query from anywhere with access to the Mac, run `npm run status -- <id>` via Remote Desktop Commander.

## Evidence and paths

| Location | Contents |
|---|---|
| `examples/projects/alpha`, `beta` | Two independent seed Git repositories with TASKS.md and generated OUTPUT.md |
| `.state/packets/` | Frozen spec packet JSON, hashes, base Git HEAD |
| `.state/claims/` | Claim-before-effect; uncertain attempts are not blindly replayed |
| `.state/worktrees/` | Disposable isolated execution worktrees |
| `.state/receipts/` | One verification receipt per task |
| `examples/projects/*/.ai/harness/chatgpt/sessions/` | Repo Harness browser dry-run records |
| `.state/worker.log` | Background Temporal Worker log (when launched via nohup) |

No new public endpoints, OAuth bypass, Chrome profile access, or modifications to RemoteMCP-Jazz/Nix-Config are required for this test.

## Jev compatibility

The system reuses `/Users/test/nix-config/ai-tools/opencode/plugin/jev-core.mjs`; it uses **OpenCode Zen** model `jev-1.13-free`, with the existing SOPS runtime credential. No secrets are placed in source or logged. The Jev result is advisory for these two pre-approved fixtures. `--no-jev` disables this optional network call.

## Browser compatibility

Installed `repo-harness` is 0.20.0, but the global `oracle` binary is 0.21.3 whereas its doctor requires **exactly 0.20.0**. We do not downgrade or change the global binary. The dry-run exercises prompt packaging/session persistence without opening Chrome. To test actual ChatGPT browser submission later, install a pinned 0.20.0 Oracle locally and pass an explicit `--oracle-bin`, then repeat `browser-doctor` and confirm the approved browser profile.

## What remains for product MVP

A model-backed planner that creates independently checkable specs, real Codex typewriter adapter, asynchronous device dispatch through RemoteMCP-Jazz, protected MCP control tools, live browser consult/follow-up with compatible Oracle, safe replay/reconciliation for crashes, and dashboard. The existing 26 RemoteMCP executor tool schemas remain untouched.

## Stop and reset

Stop Worker only: `kill $(cat .state/worker.pid)` (if background PID exists).
The Temporal server is independent and remains running. To repeat the demo, delete only the **two disposable** `examples/projects/alpha` and `beta` folders and `.state`, then run `npm run seed`; never delete real repos or Temporal's SQLite storage.
