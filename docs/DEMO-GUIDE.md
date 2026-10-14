> **HISTORICAL FIXTURE DEMO.** The primary live UI is the Oracle-only Sashai supervisor at http://127.0.0.1:4319/. New fixture dispatch via POST /api/start is intentionally disabled. For the current Sashai plan use [ORACLE-SASHAI-SUPERVISOR-PLAN.md](ORACLE-SASHAI-SUPERVISOR-PLAN.md).

# Tomorrow-Morning Demo — Flowdeck MVP

## Open the presentation dashboard

The dashboard and Worker are supervised by macOS launchd; they continue running independently from ChatGPT:

```bash
cd ~/Documents/work/temporal-harness-mvp
scripts/open-helium-profile4.sh
```

Verified URL: **http://127.0.0.1:4319/**. This opens a **new window in Helium Profile 4** (`drunkod gpt`) through the already running Helium process; it does not duplicate or reset Profile 4 or navigate the authenticated ChatGPT window.

## Show the live loop

1. Click **Start fresh demo**. A new Workflow ID appears, with two disposable repository fixtures.
2. Watch statuses progress from **Scanning tasks → Writing spec → Jev routing → Browser record → Git execution → Verified**.
3. Both project cards eventually show **Verified**, while separate Jev and browser record labels show their actual outcomes.
4. Open **Recent demonstrations** and select a prior run. The saved workflow history is read back without launching anything.
5. Refresh the page and confirm it keeps displaying the same Workflow ID.

The backend exposes `GET /api/health`, `GET /api/runs`, `GET /api/status?id=<id>`, and `POST /api/start`, all bound only to localhost. A GET or refresh **never** creates a Workflow.

## Quick troubleshooting

```bash
cd ~/Documents/work/temporal-harness-mvp
curl -fsS http://127.0.0.1:4319/api/health
~/.local/share/temporal-server/nix-cli/bin/temporal --address 127.0.0.1:7233 operator cluster health
launchctl print gui/$(id -u)/org.drunkod.temporal-harness-mvp-dashboard
launchctl print gui/$(id -u)/org.drunkod.temporal-harness-mvp-worker
tail -30 .state/dashboard.error.log .state/worker.error.log
```

After editing TypeScript code:

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/org.drunkod.temporal-harness-mvp-worker
launchctl kickstart -k gui/$(id -u)/org.drunkod.temporal-harness-mvp-dashboard
```

For the hand-in, avoid describing the browser record as a real ChatGPT response. It is intentionally a **Repo Harness dry-run session**; the browser here is the **live progress dashboard**. The exact Codex and model-backed planner work remains a later feature.
