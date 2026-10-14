# SashAI Browser Architecture Review — 2026-10-15

**Task marker:** SASHAI_ARCHITECTURE_BROWSER_REPORT_20261014  
**Review type:** Source/architecture and local-history checkpoint; report-only.  
**Repository:** /Users/test/Documents/work/sashai  
**Reviewed branch:** main  
**Reviewed SHA:** 7d2cc6818afe837119e0c171928506b1c4967269  
**Output:** /Users/test/Documents/work/temporal-harness-mvp/docs/SASHAI-BROWSER-ARCHITECTURE-REVIEW-2026-10-15.md  
**Device:** Tests-MacBook-Air, via selected Remote Desktop Commander MCP.  
**Evidence cutoff:** Repository working tree as observed 2026-10-15; no fetch or live application validation.

## Executive checkpoint

SashAI currently has a BB-derived browser/server/host-daemon agent workbench, SashAI branding/localization, and a **committed thin MVP-1 four-area navigation shell**. The latest committed delivery is the shell closeout on 2026-09-30. Community and Modules are explicitly informational placeholders; My Assistant and Projects lead back to the existing workbench. There is no verified shipped first-turn experience classifier, mentor-escalation workflow, SashAI module-install lifecycle, or decentralized community implementation in this review.

The strongest next-product proposal, present in **uncommitted research**, is Guided / Builder / Expert experience profiles with a capability-aware first-turn classifier and deterministic permission-preserving resolver, followed by safe self-building extension experiments. This proposal precedes founder-assisted zero-config pilots in the modified local roadmap. It is **a proposed direction, not a shipped feature or a recorded active-plan authorization**.

**Key recommendation:** Reconcile planning authority and approve a bounded first-turn-gateway contract before changing source. Preserve the existing BB execution/workbench architecture and add personalization via small, inspectable extension seams.

## 1. Scope, method and non-mutation contract

- Read first: AGENTS.md, CLAUDE.md, .ai/harness/policy.json, .ai/context/context-map.json, .ai/context/capabilities.json, docs/spec.md, docs/README.md and CONTRIBUTING.md.
- The repository's authority model states: docs/spec.md = product truth; tasks/current.md = derived local read model; tasks/todos.md = deferred ledger; work is tracked in an active plan's Task Breakdown. Documentation language = English (policy.json).
- Inspected local Git HEAD, status, last 12 commits, selected commit stats, remote names, archived sprint, accepted-upstream manifest, source paths and the existing Codegraph SQLite index using **sqlite3 -readonly**.
- No source edit, Git fetch, checkout, index/sync, build, test, browser/app launch, server restart, dependency installation, daemon change, marker creation, or Git-history mutation was attempted.
- The only authorized write is this new Markdown report at the output path. The output was verified absent before writing. The previously existing SASHAI-ARCHITECTURE-REVIEW-2026-10-15.md was left untouched.
- Conclusions about implementation are source-backed; claims in the untracked 2026-10-06 UI audit are historical supporting context, **not fresh browser-test evidence**.

## 2. Git checkpoint — last 12 local commits

All dates below come from local Git commit metadata (+05:00); neither remote freshness nor upstream currency was checked.

| # | Commit | Date (+05:00) | Evidence / interpretation |
|---:|---|---|---|
| 1 | 7d2cc6818 | 2026-09-30 05:19 | docs: reconcile MVP-1 shell closeout; sprint artifact only |
| 2 | ccdb11551 | 2026-09-30 05:18 | feat: close MVP-1 four-area shell; app routes, navigation, localized views/tests and workstream evidence |
| 3 | 2f779098e | 2026-09-30 04:46 | freeze shell plan |
| 4 | 6b7502bad | 2026-09-30 04:39 | approve shell plan |
| 5 | fdb022489 | 2026-09-30 04:27 | reconcile W7 closeout |
| 6 | bbba3992e | 2026-09-30 04:24 | close W7 operational localization handoff |
| 7 | e4de32fd4 | 2026-09-30 04:04 | freeze W7 plan |
| 8 | ba1b3a0de | 2026-09-30 03:58 | approve W7 plan |
| 9 | 520164480 | 2026-09-30 03:48 | reconcile W6 closeout |
| 10 | 54aa1bcdf | 2026-09-30 03:07 | close W6 upstream rehearsal |
| 11 | c6dd519b2 | 2026-09-30 01:19 | freeze W6 plan |
| 12 | 731595cf2 | 2026-09-30 01:12 | approve W6 plan |

- Local branch: main. Locally stored origin/main resolved to the same 7d2cc6818... SHA; **not evidence of remote server state**.
- Working tree: **six modified tracked documents**, **61 untracked files** with porcelain -uall, **zero staged changes**. The tracked diff stat is 169 insertions, 13 deletions.
- Modified tracked paths: docs/00-project-vision.md; docs/03-architecture.md; docs/05-reference-implementation-notes.md; docs/06-project-roadmap.md; docs/08-current-mvp-build-prompt.md; docs/README.md.
- Untracked work includes docs/10 through docs/20 (goal, founder assistance, mentor escalation, local-first infrastructure, first-turn classifier, self-building), docs/roadmap-visuals-2026-10-06 and its ZIP, and docs/ui-audit-2026-10-06 and its ZIP. **File existence is not proof of an implemented feature or approved milestone.**
- Both .ai/harness/active-plan and .ai/harness/active-worktree were absent. tasks/current.md reports Idle, but is explicitly an ignored derived read model; tasks/todos.md records no deferred goals.
- plans/sprints/20260930-0438-mvp1-four-area-shell.sprint.md has Status: Done and stops before member/module data models and module lifecycle. Last code change in the reviewed 12 commits is ccdb11551.

## 3. Actual source architecture

The implementation remains a modular TypeScript/pnpm workspace with application shells in apps/, domain/runtime/contracts in packages/, and installed/bundled plugin surfaces in plugins/. Root package.json specifies pnpm@9.15.0, Node >=22.19.0, React/Vite browser app and turbo build tooling. Internal @bb/* and @get-bb/plugin-sdk names remain in the source and manifests, consistent with the controlled-fork policy; they are not evidence that the SashAI UI rebrand failed.

**Browser:** apps/app/src/App.tsx owns app route composition and calls useWebSocket/usePluginFrontendBoot; apps/app/src/components/sidebar/AppSidebar.tsx includes SashAiProductNavigation. SashAI-owned route constants are app-local in apps/app/src/lib/sashai-shell-routes.ts. Four routes lazy-render SashAiShellView. The catch-all route renders SplitWorkspaceRoute, preserving the inherited BB workbench. Both Assistant/Projects shell actions use getRootComposeRoutePath().

**Server:** apps/server/src/server.ts creates the Hono app and Node WebSocket bridge, registering projects, threads, hosts, files, terminals, plugins and other APIs. The client and daemon socket protocols are distinct under apps/server/src/ws/. The server imports typed contracts from packages/server-contract and related packages; backend persistence is represented by packages/db/src/schema.ts.

**Host execution:** apps/host-daemon/src/start-host-daemon.ts resolves configuration, host identity and authenticated connection to server; apps/host-daemon/src/app.ts assembles RuntimeManager and PluginHostManager. apps/host-daemon/src/runtime-manager.ts instantiates the agent runtime using createAgentRuntime. packages/agent-runtime/src/runtime.ts and provider bridge packages back provider execution. The host-daemon boundary is not replaced by the thin SashAI shell.

**Extensibility:** packages/plugin-sdk/src/app-contract.ts defines plugin UI/localization contracts including registerCatalog; packages/client-core/src/prompt/create-resource-prompts.ts and the bb-guide/authoring skill are documented prompt-to-extension seams. Plugin scaffolding does not by itself prove a safe autonomous capability-builder flow.

### Diagram A — source-backed browser / runtime topology

~~~mermaid
flowchart TD
  B["Browser / React-Vite app — apps/app/src/App.tsx"] --> R["App router + sidebar"]
  R --> S["SashAI routes — community / assistant / projects / modules"]
  R --> W["Inherited SplitWorkspaceRoute — thread composer, diffs, files, terminal"]
  S -->|Assistant or Projects action| W
  W <-->|HTTP + client WebSocket| H["Hono server — apps/server/src/server.ts"]
  H <--> DB["Persistence — packages/db"]
  H <--> PLUG["Plugin services + SDK contracts"]
  H <-->|authenticated daemon protocol| D["Host daemon — apps/host-daemon"]
  D --> RM["RuntimeManager — host daemon"]
  RM --> AR["Agent runtime — packages/agent-runtime"]
  AR --> PB["Provider bridge / provider process"]
  D --> PH["PluginHostManager"]
  H --> CT["Server + host typed contracts"]
~~~

This diagram depicts traced source responsibilities, not proof that every network or provider operation succeeded during this review.

### Diagram B — product navigation: delivered versus intended

~~~mermaid
flowchart TD
  ROOT["/ root: inherited composer/workbench"] --> WS["Threads / projects / plugins / skills"]
  NAV["SashAI sidebar: four delivered routes"] --> C["/community — placeholder"]
  NAV --> A["/assistant — intro and workbench link"]
  NAV --> P["/projects — intro and workbench link"]
  NAV --> M["/modules — placeholder"]
  A --> ROOT
  P --> ROOT
  C -.-> FUTURE["Future real community / reusable modules"]
  M -.-> FUTURE
  NAV -. "product goal, not delivered home" .-> HOME["Community-first welcome / guided gateway"]
  HOME -.-> WS
~~~

Evidence: apps/app/src/App.tsx lines 278–297 and 401–424; apps/app/src/views/SashAiShellView.tsx lines 17–50, 57–101; apps/app/src/components/sidebar/SashAiProductNavigation.tsx lines 17–100; apps/app/src/components/sidebar/AppSidebar.tsx line 207; packages/client-core/src/routes/route-paths.ts line 72. The shell tests explicitly verify placeholder pages have no fake links and Assistant/Projects return to root (SashAiShellView.test.tsx).

## 4. Codegraph evidence and limitations

A Codegraph binary exists at /etc/profiles/per-user/test/bin/codegraph, and /Users/test/Documents/work/sashai/.codegraph/codegraph.db was present. To avoid index refresh or daemon changes, this review queried its database with sqlite3 -readonly, not Codegraph init/index/sync or daemon management.

- Indexed files = **5,453**; nodes = **84,212**; edges = **334,597**.
- Edge types included calls (145,074), contains (78,678), imports (55,692), references (52,749), instantiates (2,350), implements (36), extends (18).
- Node anchors: SashAiProductNavigation at apps/app/src/components/sidebar/SashAiProductNavigation.tsx:56; SashAiShellView at apps/app/src/views/SashAiShellView.tsx:57; useLocalization at apps/app/src/lib/localization.tsx:235; getRootComposeRoutePath at packages/client-core/src/routes/route-paths.ts:72.
- Codegraph call edges for SashAiShellView include getRootComposeRoutePath, useLocalization, localizedMessage and translate. Navigation graph edges include useLocalization, SidebarMenu/Button/Item and PRODUCT_AREAS.
- **Freshness caveat:** project_metadata updated_at for index_state=complete reads 2026-09-23 15:17:18 UTC, although the index contains shell symbols whose delivery was committed 2026-09-30. Treat graph relationships as supportive, verify critical claims against current source, and do not assume fully fresh indexing.

## 5. Evidence-backed findings

| Priority | Finding | Current evidence | Decision consequence |
|---|---|---|---|
| P1 | **Four-area shell is real but thin.** | ccdb11551 feature commit; App.tsx, SashAiProductNavigation.tsx, SashAiShellView.tsx and its tests. | Preserve it as a scaffold; do not report Community/Modules as functional product modules. |
| P1 | **Root experience still leads with the workbench.** | App.tsx catch-all SplitWorkspaceRoute; root compose path; source shell actions. Untracked 2026-10-06 UI audit independently describes this older running experience. | Decide intentional landing and progressive disclosure before broadening onboarding. |
| P1 | **Planning authority drift.** | docs/spec.md still says MVP-0 Foundation Preview, with MVP-1 excluded; committed sprint says MVP-1 thin shell Done; modified roadmap adds a 2026-10-06 first-turn priority override; no active-plan marker. | Ratify product spec, roadmap priority and bounded active plan, explicitly distinguishing research from accepted delivery. |
| P1 | **Guided/Builder/Expert and FirstTurnPlan are proposed, not established in inspected product source.** | Untracked docs/17–20 and modified docs/06-project-roadmap.md define profiles, CapabilitySnapshot/classifier/resolver; targeted non-test source scan of apps/app/src, apps/server/src and packages found no FirstTurnPlan, CapabilitySnapshot, ExperienceProfile, AskMentor, mentorEscalation or CapabilityBuilder identifier. | Build a contract-first vertical slice only after approval; the absence result is bounded, not proof across every plugin. |
| P1 | **Self-building must mean tested extensions, not silent core mutation.** | Untracked docs/20 describes upstream prompt-built skill/plugin precedent, verification, consent, resume and compatibility trials. packages/plugin-sdk/app-contract.ts exposes extension API. | Require an isolated skill -> visible UI plugin -> original-task-resume experiment, plus upstream rehearsal, before permanent CapabilityBuilder. |
| P1 | **Mentor/share and module lifecycle are not part of the committed shell.** | Sprint explicit non-goals; shell placeholder copy; untracked docs/11–16 research. | Schedule these as separate, security-reviewed milestones; do not infer implementation from technical BB Connect/plugin primitives. |
| P2 | **Localization ownership has a workable seam.** | SashAiShellView uses localizedMessage/useLocalization and data-bb-localization-skip; translated shell messages included in ccdb11551; docs/spec.md requires authored resources over derived catalogues. | New Guided UI must use render-time localization and preserve user prompt/code/terminal content without DOM translation. |
| P2 | **Upstream maintenance discipline must survive new UX.** | sashai/upstream.json acceptedUpstreamSha=94d77da09568d7f0f7cdb23b84686e743acfb0ad; docs/upstream-sync.md forbids advancing on product main without isolated rehearsal/review. | Prefer extension seams and test representative generated extensions against approved candidate upstream in an authorized later worktree. |
| P2 | **Verification is historical, not reproduced today.** | Archived sprint records green tests/build; untracked UI audit reports earlier working browser; this review only reads Git/files/graph. | Do not call current HEAD regression-tested or packaged-user-approved based on this read-only review. |
| P2 | **Codegraph freshness is ambiguous.** | 2026-09-23 metadata vs indexed 2026-09-30 shell symbols. | Preserve source-level verification until authorized reindex; no index changes here. |

## 6. Ordered next decisions (not authorized implementation)

1. **Ratify the next slice and planning authority.** Reconcile docs/spec.md's MVP-0 language with the committed MVP-1 shell, then explicitly approve or defer the uncommitted 2026-10-06 priority: Guided/Builder/Expert gateway **before** founder assistance. Create/approve a bounded active plan only in a separately authorized implementation task; do not modify user research while deciding.
2. **Freeze an experience-profile and first-turn contract.** Use configurable stable IDs guided/builder/expert with a future two-mode migration path, original visible prompt unchanged, explicit user override and safe default. Adopt a versioned CapabilitySnapshot and FirstTurnPlan independent of agent prose.
3. **Pick the trust boundary:** classifier suggests intent and capability IDs; deterministic resolver checks installed/enabled capabilities, permissions, prerequisites/conflicts and available models before any agent input is augmented. Make rejection reasons inspectable; do not allow classifier output to expand authority.
4. **Define bounded acceptance before coding.** Test schema/timeout fallback, no capability escalation, invisible agent-only orchestration block, visible message preservation, low-confidence clarification, mode toggling, localization, and no regression in the inherited workbench; compare both three- and two-profile routing.
5. **Decide extension proof sequence.** In a separately approved disposable environment: create a skill from a prompt, a visible plugin from a prompt, resume the original need, confirm consent/rollback and validate compatibility with an accepted BB candidate. Do not implement a permanent self-modifying core pipeline before evidence.
6. **Decide landing hierarchy and progressive disclosure.** Choose whether root should become an ordinary-language Guided/Community entry, while retaining a stable expert workbench route and all existing project/thread context. Keep Community/Modules honestly labeled until real data and actions exist.
7. **Resume zero-config / founder-help as next gated product phase.** First validate supported BB Connect sharing and permission boundaries; then design a narrowly scoped Get help from Sasha, mentor escalation, audited handoff/resume and an actual member pilot.
8. **Only then prove the personal-need -> skill/module -> private use -> independent community reuse/update loop.** Start with a minimal versioned module data contract and one concrete domain test, not distributed infrastructure or a marketplace. Retain the local-first/member-owned infrastructure direction as a design constraint, not a currently deployed claim.
9. **Keep upstream integration separate.** No production-main fetch/merge; preserve acceptedUpstreamSha until a candidate has isolated integration-seam review, scoped tests, browser acceptance and explicit human sign-off.

### Diagram C — decision dependencies and roadmap gates

~~~mermaid
flowchart LR
  DONE["Committed: MVP-0 + localized four-area shell"] --> PLAN["Decision: reconcile spec + approve next active plan"]
  PLAN --> PROF["Gateway contract + experience profiles"]
  PROF --> ROUTE["Classifier + policy resolver + audited first turn"]
  ROUTE --> EXP["Extension self-building experiments"]
  EXP --> GATE{"Safe/reproducible proof?"}
  GATE -->|yes| ADAPT["Optional CapabilityBuilder via extension APIs"]
  GATE -->|no| FIX["Document failure + smallest seam improvement"]
  ADAPT --> PILOT["Zero-config founder-help + mentor pilot"]
  FIX --> PILOT
  PILOT --> MOD["Module definition, install, real personal use"]
  MOD --> SHARE["Consent-based community sharing / versioned reuse"]
  SHARE --> SCALE["Later local-first exchange and advanced infrastructure"]
~~~

These are future decisions and proposed gates, not a claim that the middle/right nodes are shipped.

## 7. Completed review checklist and remaining work

### Completed during this read-only review
- [x] Remote Desktop Commander connector invoked successfully and device online.
- [x] Read AGENTS.md and policy/guide/spec before Git inspection.
- [x] Captured full reviewed HEAD SHA and last 12 local commits.
- [x] Distinguished committed shell code from six modified documentation files and 61 untracked working-tree files.
- [x] Inspected absent active-plan and active-worktree markers without creating them.
- [x] Traced browser routing, sidebar, product shell, server WebSockets/APIs, host-daemon/runtime, plugin SDK and localization.
- [x] Queried the existing Codegraph index **read-only**, reported coverage and freshness limitation.
- [x] Produced three Mermaid diagrams, evidence-backed findings, checkpoint and ordered next decisions.
- [x] Wrote only the separately authorized new MVP docs report, with no overwrite.

### Remaining product/verification work (not performed)
- [ ] Product owner decides and ratifies the next milestone against docs/spec.md.
- [ ] Approve a new scoped active plan with acceptance criteria, test matrix and rollback.
- [ ] Implement and independently test the first-turn gateway if approved.
- [ ] Prove safe prompt-to-skill/plugin adaptation and upstream compatibility if approved.
- [ ] Design and test founder share, scoped mentor escalation and real-member pilot.
- [ ] Deliver module lifecycle/community reuse in subsequent bounded slices.
- [ ] Run current build/typecheck/test/browser/packaged acceptance under separate authorization.
- [ ] Assess Codegraph index freshness/reindex only when authorized.

## 8. Tool evidence ledger

- Connector: selected Remote Desktop Commander on Tests-MacBook-Air, device ID 438b0f0c-378d-4c75-9699-68668c405a79, online.
- Read-only Git: git rev-parse HEAD; git status --short --branch; git status --porcelain=v1 -uall; git log -12 --format=... --date=iso-strict; git diff --stat; git diff --cached --stat; git show --stat ccdb11551; git show --stat HEAD; git rev-parse origin/main. Executed with GIT_OPTIONAL_LOCKS=0.
- File reads: AGENTS/CLAUDE, policy/context/spec, tasks/current and todos, sprint, roadmap/priorities, research, upstream manifest/policy, app shell/router/tests, server app, host daemon, runtime and package manifests.
- Codegraph database queries: sqlite3 -readonly .codegraph/codegraph.db for .tables, indexed file/node/edge counts, node symbol/line anchors, call-edge joins and project_metadata.
- Source scans: rg and find restricted to local source/known files; one exploratory rg regular expression was malformed and produced a parse error, then equivalent route structure was confirmed by direct file reads. It did not affect repository state.
- Target report preflight: exact output path absent (file-info returned ENOENT; shell test confirmed ABSENT); parent docs directory existed.
- **No application launch, browser inspection, full code audit, Codegraph reindex, provider execution, network fetch, service manipulation, dependency change, SashAI file edit, or Git history change occurred.**

## 9. Blockers / limits

1. **Planning blocker:** no active-plan/worktree markers and no approved post-shell execution contract; research priorities need explicit ratification.
2. **Evidence limitation:** current live UX, runtime safety, builds and tests were not verified because this task expressly forbade launches or changes.
3. **Graph freshness:** Codegraph metadata timestamp does not establish an up-to-date full reindex.
4. **Source scope:** bounded source and graph trace, not an exhaustive security/data-flow audit of all 5,453 indexed files.
5. **Remote freshness:** local origin/main/upstream refs are not newly fetched; no claim about current remote branch heads.

**Final reviewer status:** Read-only architectural review complete at SHA 7d2cc6818afe837119e0c171928506b1c4967269. Next engineering action is a planning/contract decision, not an implicit coding task.
