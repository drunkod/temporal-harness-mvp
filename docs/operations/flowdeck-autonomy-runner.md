# Flowdeck autonomy runner — developer reference

**Status:** Offline and synthetic checks are available. Autonomous production execution is **blocked**: the ordinary live CLI has no production composition wired in. This document describes working-tree implementation and test commands, not a runtime release; some implementations may not yet be committed.

## Commands

Run from the repository root with dependencies installed. These commands do not contact the live sender or click Send:

```sh
npm run build
node scripts/flowdeck-check.mjs --profile offline --non-interactive
node scripts/flowdeck-check.mjs --profile synthetic --non-interactive
```

`offline` runs fixture checks. `synthetic` exercises isolated local Temporal/fake integrations. Reports are written under `.state/verification-runs/autonomy-checks/`.

The actual production-composition test command is:

```sh
npm run build && node --test tests/flowdeck-autonomy-production-composition.test.mjs
```

It uses isolated temporary state and synthetic adapters; it is not live acceptance. Other focused suites remain runnable with `node --test tests/<suite>.test.mjs` after building.

Do not rebuild mutable live `dist` as part of these checks or use it as deployment/release evidence. Do not run a live workflow from this reference.

## Current implementation boundary

The codebase includes a durable controller and production-shaped components, including production source cursor storage, process identity/witness checks, ownership, inbox/follower wiring, Temporal adapters, production activities and evidence/closeout helpers. Their focused tests and the composition test use synthetic/local fixtures. Presence of these modules does not establish a usable production launch path.

**Same-composition coverage remains missing.** Cursor and process implementations exist, but the production composition test does not yet prove one integrated composition using those implementations end-to-end. Do not describe component tests or the synthetic composition as live readiness.

The ordinary `scripts/flowdeck-run.mjs` CLI remains fail-closed because the production composition is missing; it reports blockers rather than launching autonomous work. No valid policy or preflight result removes that blocker. Existing attended/manual workflows are separate and are not substitutes for autonomous launch or validation.

## References

- Canonical MVP plan (being rewritten): [FLOWDECK_AUTONOMOUS_MVP_PROGRAMMER_GUIDE.md](../plans/FLOWDECK_AUTONOMOUS_MVP_PROGRAMMER_GUIDE.md)
- Manual Mac testing: [manual-mac-testing/README.md](manual-mac-testing/README.md)

Offline, synthetic, and composition checks are not production acceptance. This documentation change does not release runtime code.
