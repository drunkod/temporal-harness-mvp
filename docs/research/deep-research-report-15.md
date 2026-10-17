# Comparable Projects and Reusable Building Blocks for the Autonomous ChatGPT Project Supervisor

## Research result and double-check

The most important conclusion is that **there is no single maintained project I found that already implements your exact product**: adopt a manually started conversation inside an existing ChatGPT.com Project, preserve a selected Remote Desktop Commander connector, observe attributable tool activity, continue unfinished work in the same conversation, independently verify repository state, and then create the next conversation inside that same ChatGPT Project under Temporal control. The closest projects each solve a **particular seam** of that lifecycle rather than the whole lifecycle. fileciteturn0file9

That is good news rather than bad news: your current architecture should remain incremental. The strongest reusable material is concentrated in four places:

1. **existing authenticated browser attachment and tab ownership** — BrowserSkill, open-browser-use, Browser Harness / Browser Harness JS, Playwright and Puppeteer;
2. **real connector evidence** — Desktop Commander's own local `tool-history.jsonl` and `get_recent_tool_calls`;
3. **durable orchestration and fault testing** — Temporal's official TypeScript samples;
4. **evaluation methodology** — BrowserGym, AgentLab, Agent-E, WebArena, WebVoyager and AgentHorizon.

This agrees with the handoff: the working-copy adapter is heavily fixture-tested, but a passing fixture is deliberately not treated as fresh browser proof. The supplied validation contains **141 passing tests, two skips and no failures**, including uncertain-send and connector-evidence tests. fileciteturn0file7

I performed the online investigation in **two passes**. The first pass searched broadly for projects matching browser attachment, durable agent supervision, real-browser reuse, browser-agent evaluation and tool attribution. The second pass rechecked candidates against their official repositories, release pages, licence files and documented APIs. That second pass matters: for example, Browser Harness JS is active but has **no tagged releases**, while Browser Harness proper has a current `v0.1.13` release; Playwright's official search surface exposed `v1.62.1` as a verified publish on 30 July 2026 while later development is already labelled `v1.63`, so I would not invent a newer stable number without resolving the package actually installed in your lockfile. citeturn16search0turn16search5turn9search4turn23search0

### Ranked comparison

| Rank | Project | Verified status / licence | Existing authenticated browser | Most useful part for us | Runtime fit | Verdict |
|---|---|---|---|---|---|---|
| **1** | **Desktop Commander MCP** | Actively maintained; MIT. Recent public issue evidence refers to Remote `0.2.52` in October 2026. | N/A — this is the executor, not browser controller. | **Local `tool-history.jsonl`**, `get_recent_tool_calls`, arguments, result previews, timestamps and durations. Remote calls still flow through the local MCP server. | Already part of your architecture. | **Adopt now: build evidence reader**. citeturn18search0turn19search7 |
| **2** | **Tencent BrowserSkill** | CLI + extension `0.3.2`, released 30 Sep 2026; MIT. | **Yes.** Explicitly reuses logged-in browser; user tabs must be deliberately borrowed and later returned. | Tab ownership, task-scoped authorisation, separate agent window, hand-back semantics, human intervention. | Rust + pnpm extension; don't replace Oracle yet. | **Investigate deeply; borrow ownership protocol.** citeturn16search7turn24search0turn24search2 |
| **3** | **open-browser-use** | macOS/Linux public preview; MIT; Rust + TypeScript. | **Yes.** WebExtension backend can drive everyday Chrome without a debug port; CDP backend also exists. | Explicit `tab.attach()`, owner-only Unix socket, capability-gated broker, backend-neutral browser API. | Architecturally very close to your browser-observer seam. | **Prototype behind adapter.** citeturn13search5turn16search1 |
| **4** | **Browser Harness JS** | Active new repository; MIT; **no tagged releases** yet. | **Yes**, through CDP. | Tiny typed CDP session, persistent WebSocket, target routing, `listPageTargets`, `session.use`, `waitFor`, `DevToolsActivePort` resolution. | TypeScript/Bun concepts translate almost directly to Node 24. | **Borrow design/source patterns now; don't depend on it yet.** citeturn13search0turn16search0turn22view0 |
| **5** | **Playwright** | Apache-2.0. Verified `v1.62.1` publish 30 Jul 2026; later work is marked v1.63. | **Yes through `chromium.connectOverCDP()`**, with important reduced-fidelity caveats. | Read-only DOM/accessibility observations, browser contract tests, selectors, snapshots and controlled CDP attachment. | Excellent Node/TS fit. | **Adopt selectively behind browser adapter.** citeturn9search1turn9search4turn25view3 |
| **6** | **Temporal TypeScript samples** | Official Temporal repository; Temporal server is MIT; samples actively maintained. | N/A. | Cancellation, heartbeats, signals, queries, Continue-As-New, worker versioning, testing and time skipping. | Direct match to your existing orchestrator. | **Adopt patterns immediately.** citeturn10search0turn10search9 |
| **7** | **Oracle `@steipete/oracle`** | Your verified line is `0.21.5`; MIT; Node 24+ in the package line you validated. | Already demonstrated against your Helium flow. | Conversation continuation and current ChatGPT-specific browser knowledge. | Already integrated. | **Keep as sender/ChatGPT specialist.** |
| **8** | **Chrome DevTools MCP** | `v1.10.1`, released 23 Sep 2026; Apache-2.0. | Can inspect/control live Chrome through DevTools/Puppeteer. | Network/console/browser introspection and examples of building higher-level evidence from DevTools. | TypeScript, but another MCP controller would duplicate Oracle. | **Reference implementation, not runtime dependency.** citeturn10search1turn14view2 |
| **9** | **Puppeteer** | `puppeteer-core v25.12.0` surfaced for Sep 2026; Apache-2.0. | **Yes**, through a connection to an existing Chrome/Firefox browser. | Lower-level target lifecycle and CDP attachment alternative. | Excellent Node/TS fit. | **Keep as alternative; choose it or Playwright, not both for the same seam.** citeturn9search0 |
| **10** | **Playwright MCP** | Active Microsoft TypeScript project; latest surfaced tag `v0.0.83`; Apache-2.0; Node 18+. | Built on Playwright and supports persistent browser contexts/configuration. | Accessibility snapshot model, element refs and deterministic tool interface. | Adds another MCP layer that your supervisor does not need. | **Read source; do not insert into runtime.** citeturn8search3turn8search4turn15search5 |
| **11** | **Stagehand** | `@browserbasehq/stagehand 3.7.3`; MIT. | Its architecture is CDP/extension-based, but attaching to *your exact Helium Profile 4* is not established by these sources. | `observe`/`act`/`extract` architecture, runtime extension and JSON-RPC-over-CDP design. | TypeScript but LLM/browser orchestration overlaps existing stack; Browserbase cloud is optional architecture around it. | **Source-reading only for now.** citeturn10search3turn13search2 |
| **12** | **BrowserGym** | `v0.14.3`; Apache-2.0. | No — research/testing environment rather than your personal browser. | Deterministic browser fixtures, task/evaluator contracts and reproducible benchmark environments. | Python; excellent testing reference, poor runtime fit. | **Borrow testing ideas, not runtime.** citeturn12search0turn25view1 |
| **13** | **AgentLab** | `v0.4.2`; Apache-2.0. | No direct fit to owner Helium session. | Experiment traces, reproducible agent evaluation and multi-benchmark execution. | Python research stack. | **Reference for trace/evaluation design.** citeturn12search1turn25view2 |
| **14** | **Agent-E** | Active open-source research implementation; Python/AG2; no dependable recent semantic release surfaced. | Browser automation yes, but it is its own agent architecture. | DOM distillation, accessibility-tree reduction, action verification and hierarchical decomposition. | Would duplicate your planner/orchestrator if adopted whole. | **Borrow algorithms/tests only.** citeturn11search0 |

The shortlist therefore contains substantially more than the requested ten, but only **four are strong candidates for code or architectural adoption in the active runtime**: Desktop Commander evidence, Playwright or a small CDP client, BrowserSkill/open-browser-use ownership ideas, and Temporal's official patterns. The rest are primarily references.

## Source code worth studying or adapting

Because most of these licences are MIT or Apache-2.0, source can generally be modified and incorporated subject to the applicable attribution/licence conditions. Apache-2.0 additionally carries explicit notice/patent provisions. Preserve upstream copyright/licence notices when copying substantial code; this report is technical rather than legal advice. The upstream licence files establish those terms for Browser Harness, Playwright, BrowserGym and AgentLab. citeturn14view0turn25view1turn25view2turn25view3

### Existing-browser ownership and target routing

**Browser Harness JS `Session` implementation**

[`sdk/session.ts`](https://github.com/browser-use/browser-harness-js/blob/main/sdk/session.ts)

This is probably the single most valuable small implementation to study. The project intentionally keeps one persistent CDP WebSocket and exposes only a few abstractions that CDP itself does not supply conveniently: target listing, target switching and event waiting. citeturn8search1turn13search4

Also examine:

[`sdk/repl.ts`](https://github.com/browser-use/browser-harness-js/blob/main/sdk/repl.ts)

[`SKILL.md`](https://github.com/browser-use/browser-harness-js/blob/main/SKILL.md)

The useful idea is **not** “let an LLM send arbitrary CDP”. For your supervisor it is:

```text
one connection
    ↓
enumerate targets
    ↓
filter to explicit automation-owned target
    ↓
bind targetId + project URL + conversation URL
    ↓
observe only that target
    ↓
refuse identity drift
```

That is exactly compatible with your existing attempt/claim/receipt model.

### BrowserSkill's borrow/return model

Study:

[`crates/bsk-protocol`](https://github.com/Tencent/BrowserSkill/tree/main/crates/bsk-protocol)

[`apps/extension`](https://github.com/Tencent/BrowserSkill/tree/main/apps/extension)

[`docs/remote-extension-connection.md`](https://github.com/Tencent/BrowserSkill/blob/main/docs/remote-extension-connection.md)

BrowserSkill has a particularly useful safety concept: a normal user tab does **not** become agent-owned merely because it exists in a suitable window. A task must explicitly borrow it; content access ends when it is returned, and opener/window relationships alone do not implicitly authorise newly opened targets. citeturn24search0turn24search2

For your project that suggests a durable record such as:

```ts
interface OwnedBrowserTarget {
  attemptId: string;
  targetId: string;
  projectUrl: string;
  conversationUrl: string | null;
  acquiredAt: string;
  acquisition: "created-by-attempt" | "explicitly-adopted";
  releasedAt: string | null;
}
```

A newly discovered ChatGPT tab should **never** silently become owned simply because its URL matches `/g/.../c/...`.

### open-browser-use's broker boundary

Study:

[`wire/methods.json`](https://github.com/open-browser-use/open-browser-use/blob/main/wire/methods.json)

[Repository architecture](https://github.com/open-browser-use/open-browser-use)

The interesting implementation is the separation between a persistent local host/broker and the agent-facing SDK. The SDK can use either a WebExtension backend or CDP while presenting the same higher-level API, and the host uses an owner-only Unix socket plus capabilities. citeturn13search5

That strongly supports your decision to define:

```ts
interface BrowserEvidenceAdapter { /* stable contract */ }
```

and hide Oracle, Playwright/CDP and future extension code behind it rather than spreading ChatGPT-specific DOM details through Temporal activities.

### Desktop Commander evidence

The upstream README now documents exactly the evidence source your earlier investigation identified. Desktop Commander keeps:

- `~/.claude-server-commander/claude_tool_call.log`, containing timestamp, tool name and arguments;
- `~/.claude-server-commander/tool-history.jsonl`, containing timestamp, tool name, arguments, duration and a bounded result;
- a `get_recent_tool_calls` tool over that recent history;
- the same local history for calls arriving through **Remote Desktop Commander**. citeturn18search0turn24search1

Useful upstream search:

[`get_recent_tool_calls` implementation search](https://github.com/wonderwhy-er/DesktopCommanderMCP/search?q=get_recent_tool_calls&type=code)

This is materially stronger than trying to infer execution solely from the ChatGPT DOM. It still **does not by itself prove which ChatGPT turn caused a call**; that correlation remains your responsibility.

The evidence contract should therefore require something like:

```text
Browser user turn
    ↓ bounded temporal interval
ChatGPT connector activity
    ↓
Desktop Commander local call
    ↓ exact operation/path/command
filesystem/git consequence
```

and return `unknown` rather than “verified” when the middle binding cannot be established.

### Playwright's existing-browser API

The documented API is:

[`BrowserType.connectOverCDP`](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)

Source:

[`browserType.ts`](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/client/browserType.ts)

Playwright explicitly states that `connectOverCDP()` attaches to an existing Chromium browser and makes its default context available. It also explicitly warns that the CDP connection is **lower fidelity** than the native Playwright protocol and that some functionality may fail when the browser was launched outside Playwright. That warning matters for Helium Profile 4. citeturn9search1

Therefore Playwright is a very good **observer/test adapter**, but it should not be allowed to displace a working Oracle sender until a fresh Helium experiment proves connector-preserving writes.

### Puppeteer's lower-level alternative

Study:

[`BrowserConnector.ts`](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/common/BrowserConnector.ts)

Puppeteer is the clean alternative if Playwright's abstraction obstructs target-level evidence. It speaks CDP directly for Chrome and exposes lower-level page/target lifecycle primitives. citeturn9search0

I would **not** ship Playwright and Puppeteer as competing controllers. Run a short evidence experiment and choose the one that makes the owned-target and ChatGPT-turn contract easiest to prove.

### Temporal reference implementations

The official TypeScript examples repository is unusually relevant to your project. It currently contains examples covering:

- cancellable activities and `cancellationSignal`;
- activity heartbeats;
- signals and queries;
- long-running workflows;
- `continueAsNew`;
- worker versioning;
- OpenTelemetry;
- test APIs and time skipping. citeturn10search0

Useful source directories:

[`activity-cancellation-heartbeating`](https://github.com/temporalio/samples-typescript/tree/main/activity-cancellation-heartbeating)

[`signals-queries`](https://github.com/temporalio/samples-typescript/tree/main/signals-queries)

[`infinite-workflows`](https://github.com/temporalio/samples-typescript/tree/main/infinite-workflows)

[`worker-versioning`](https://github.com/temporalio/samples-typescript/tree/main/worker-versioning)

[`testing`](https://github.com/temporalio/samples-typescript)

These should influence the implementation more than another agent framework.

### Stagehand's split runtime

The Stagehand architecture is worth reading even though I would not add it to production:

[`CONTRIBUTING.md`](https://github.com/browserbase/stagehand/blob/main/CONTRIBUTING.md)

Its SDK holds the browser handle while an extension-side runtime executes `act`, `observe` and `extract`; the two communicate using JSON-RPC tunnelled over CDP. citeturn13search2

That is a useful proof that a **small browser-side observation layer** can be separated from the durable orchestration layer without turning the browser library itself into the orchestrator.

### Agent-E's DOM/action verification ideas

Source search:

[`get_dom_with_content_type`](https://github.com/EmergenceAI/Agent-E/search?q=get_dom_with_content_type&type=code)

[`MutationObserver` / action verification](https://github.com/EmergenceAI/Agent-E/search?q=MutationObserver&type=code)

Agent-E distils the DOM, leans on the accessibility tree, assigns its own element identifiers, and reports natural-language action outcomes. Its roadmap also records action verification via DOM changes. citeturn11search0

Do **not** copy Agent-E's orchestration layer into Temporal. The potentially useful ideas are its DOM compression and “action happened versus action was requested” separation.

## What the research literature says about building this kind of prototype

Several studies closely mirror the problems you are now encountering.

### WebArena: verify functional outcomes, not convincing trajectories

WebArena built reproducible, fully functional sites and evaluated **functional correctness** of long-horizon tasks rather than treating plausible actions as success. Its original strongest GPT-4 baseline achieved only 14.41% end-to-end success versus 78.24% for humans, illustrating how quickly long chains of apparently reasonable actions become unreliable. citeturn20academia0

The direct lesson for your supervisor is:

> ChatGPT saying “done”, a finished assistant turn and even visible tool activity must remain separate from task acceptance.

That is already the right direction in your verifier architecture.

### WebVoyager: real websites require richer observations

WebVoyager moved evaluation from toy/snapshot environments to live popular websites and combined screenshots with textual information. Its reported task success was 59.1%, and its automatic evaluator reached 85.3% agreement with human judgement. citeturn20academia1

For your prototype, that suggests **DOM evidence alone should not automatically be assumed complete**. A collapsed connector activity panel, icon/chip state or dynamic UI element may occasionally require screenshot or accessibility evidence as a second modality.

### Agent-E: separate planning from navigation and verify state changes

Agent-E explicitly uses a hierarchical architecture and distilled browser observations, with sensing skills separate from action skills. Its implementation describes accessibility-based DOM reduction and action outcomes that help the model correct itself. citeturn11search0

The part worth borrowing is the **observation/action boundary**, not its multi-agent framework:

```text
observe → decide → act → re-observe → prove changed state
```

Your version should be even stricter:

```text
observe
→ establish exact attempt/turn identity
→ claim side effect
→ act once
→ reconcile browser evidence
→ correlate connector evidence
→ independently verify repository effect
```

### BrowserGym and AgentLab: standardise observations, actions and traces

The BrowserGym paper was motivated by fragmented benchmarks and inconsistent evaluation. It proposes standard observation/action spaces, while AgentLab adds experiment management and reproducibility across benchmarks. citeturn20academia2

That maps cleanly onto your testing taxonomy:

```text
pure state/unit tests
≠ stored historical browser evidence
≠ synthetic Temporal execution
≠ fresh Temporal integration
≠ explicitly approved real-browser test
```

You should preserve those as distinct test classes in both filenames and Flowdeck.

### Emergence WebVoyager: evaluation methodology changes reported success dramatically

The 2026 Emergence WebVoyager study specifically examined ambiguity and operational variability in browser-agent evaluation. Its revised procedure achieved 95.9% inter-annotator agreement; under the more explicit procedure, its evaluation of Operator measured 68.6% overall success, notably below an 87% previously reported figure. citeturn21academia12

This directly validates your insistence that **old live evidence, mocked tests and fresh execution cannot be combined into one “green” indicator**.

### AgentHorizon: long trajectories can look correct while violating constraints

AgentHorizon was published only days ago, on 8 October 2026. It evaluates judges over 1,373 computer-use trajectories drawn from 166 hours of human-recorded interaction, including trajectories of 100–300+ steps and adversarial negative cases. Its central problem is exactly relevant to you: a trajectory can appear successful while violating an instruction or introducing an unwanted side effect. citeturn21academia13turn21search0

A useful idea to import into your verifier tests is **adversarial negative evidence**:

```text
correct report + wrong conversation
correct tool call + wrong attempt
correct artifact + stale source revision
correct Git result + unauthorised task
correct connector + call belongs to earlier turn
successful first send + duplicate second send
```

Your present test suite already contains several cases of this form; AgentHorizon suggests systematically expanding them rather than merely adding happy-path scenarios. fileciteturn0file7

### Wuying Browser Agent: long-horizon reliability needs recovery as a first-class concern

The August 2026 Wuying-Browser-Agent paper argues that production browser tasks differ from short demonstrations because they require dozens of decisions, recovery from mistakes and difficult UI interaction. Its BrowserBench tasks average 37.9 steps, and the architecture explicitly includes structured browser primitives and recovery trajectories. citeturn21academia14

This supports your decision to make **same-chat recovery**, not autonomous planning sophistication, the next major reliability capability.

## Recommended architecture after comparing the projects

The research does **not** justify a rewrite.

```text
                    ┌──────────────────────────────┐
                    │          Temporal            │
                    │ authoritative durable state  │
                    │ budgets / waits / recovery   │
                    └──────────────┬───────────────┘
                                   │ Activities
                 ┌─────────────────┼──────────────────┐
                 │                 │                  │
                 ▼                 ▼                  ▼
      ┌──────────────────┐ ┌───────────────┐ ┌──────────────────┐
      │ Browser adapter  │ │ Repo verifier │ │ Evidence journal │
      │                  │ │               │ │                  │
      │ Oracle — sends   │ │ Git/tests     │ │ attempts/claims  │
      │ CDP/PW — observe │ │ task source   │ │ receipts/hashes  │
      └────────┬─────────┘ └───────┬───────┘ └────────┬─────────┘
               │                   │                  │
               ▼                   │                  │
       Helium Profile 4            │                  │
       owned target only           │                  │
               │                   │                  │
               ▼                   │                  │
      ChatGPT Project chat         │                  │
               │                                      │
               ▼                                      │
    Remote Desktop Commander                           │
               │                                      │
          local MacBook                               │
               │                                      │
               ├── tool-history.jsonl ────────────────┤
               │                                      │
               └── repository change ────────────────►│
```

The browser projects above support the architectural choice to put target ownership and CDP mechanics behind a narrow adapter rather than embedding those mechanics in Temporal workflow code. BrowserSkill uses explicit borrowing, open-browser-use has a broker/backend boundary, and Browser Harness JS isolates target routing in a tiny session abstraction. citeturn24search0turn13search5turn8search1

### Keep, extend, or avoid

| Current component | Recommendation | Why |
|---|---|---|
| **Temporal workflows** | **Keep and extend** | Already solves durable orchestration; official examples cover the exact missing recovery/testing mechanisms. citeturn10search0 |
| **Oracle 0.21.5 adapter** | **Keep** | It has real evidence in your environment for ChatGPT-specific conversation continuation. Do not replace working ChatGPT knowledge with a generic framework merely because one exists. |
| **Raw CDP helper** | **Refactor behind `BrowserEvidenceAdapter`** | Borrow Browser Harness JS's minimal persistent-session/target-routing concepts. citeturn13search0 |
| **Desktop Commander** | **Keep; add evidence reader** | Its own documented local history is likely the highest-value unexploited evidence source. citeturn18search0 |
| **JSON claims/receipts** | **Keep during immediate live gate** | Avoid changing persistence at the same moment as browser evidence. SQLite can follow after the live lifecycle proves out. |
| **Independent verifier** | **Keep and strengthen** | Research consistently shows execution traces alone are insufficient evidence of successful completion. citeturn20academia0turn21academia13 |
| **Flowdeck** | **Keep read-only/auxiliary** | It should visualise evidence, not become another authority. |
| **Repo Harness runtime** | **Remain excluded** | Nothing found changes the owner decision recorded in the project handoff. fileciteturn0file9 |
| Stagehand / Browser Use agent loops / Agent-E planner | **Do not integrate** | They duplicate planning/orchestration that Temporal + ChatGPT already provide. |
| BrowserGym / AgentLab | **Do not integrate into production** | Use them as design references for test fixtures and evaluation taxonomy. citeturn20academia2 |

The most plausible future browser stack is therefore:

```text
Oracle
  = ChatGPT-aware writer / continuation mechanism

Playwright-over-CDP or a tiny typed CDP client
  = observation + target identity + test surface

Desktop Commander local history
  = connector execution evidence

Git/files/tests
  = independent outcome evidence

Temporal
  = durable decision-making and recovery
```

There is no reason today to put Stagehand, browser-use, LangGraph, AutoGen or another general-purpose agent orchestrator between those layers.

## TypeScript patterns to implement

### Owned browser target with Playwright CDP

Playwright documents `chromium.connectOverCDP()` for existing Chromium instances, while warning that this mode has lower fidelity than its native protocol. That makes it suitable as a **bounded evidence adapter**, not automatically as the new writer. citeturn9search1

```ts
import { chromium, type Browser, type Page } from "playwright";

export interface OwnedTarget {
  targetKey: string;
  projectSlug: string;
  conversationId: string | null;
  page: Page;
}

export async function attachOwnedChat(
  cdpEndpoint: string,
  expectedProjectPath: string,
  expectedConversationId?: string,
): Promise<{ browser: Browser; target: OwnedTarget }> {
  const browser = await chromium.connectOverCDP(cdpEndpoint);
  const context = browser.contexts()[0];

  if (!context) {
    throw new Error("No default Chromium context visible over CDP");
  }

  const candidates = context.pages().filter((page) => {
    const url = new URL(page.url());

    if (url.hostname !== "chatgpt.com") return false;
    if (!url.pathname.startsWith(expectedProjectPath)) return false;

    return expectedConversationId
      ? url.pathname.includes(`/c/${expectedConversationId}`)
      : true;
  });

  // Ambiguity is an evidence result, not something to guess through.
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one owned ChatGPT target; found ${candidates.length}`,
    );
  }

  const page = candidates[0]!;
  const match = page.url().match(/\/c\/([^/?#]+)/);

  return {
    browser,
    target: {
      targetKey: `${expectedProjectPath}:${match?.[1] ?? "unbound"}`,
      projectSlug: expectedProjectPath,
      conversationId: match?.[1] ?? null,
      page,
    },
  };
}
```

The additional guard your implementation needs is that the page must already have been marked as **created/adopted by this attempt**. URL matching alone must never confer ownership; BrowserSkill's borrow semantics are the model to emulate. citeturn24search2

### Turn-scoped connector evidence

The browser and connector layers should return a three-state result instead of booleans:

```ts
export type EvidenceState =
  | { state: "confirmed"; evidenceId: string }
  | { state: "absent"; reason: string }
  | { state: "unknown"; reason: string };

export interface ConnectorInvocationEvidence {
  attemptId: string;
  conversationId: string;
  browserTurnId: string;
  connector: "remote-desktop-commander";
  operation: string;
  startedAt: string;
  completedAt: string;
  resultDigest: string;
  source:
    | "chatgpt-structured-activity"
    | "desktop-commander-history"
    | "correlated-both";
}
```

Then require corroboration:

```ts
export function acceptConnectorInvocation(
  browser: ConnectorInvocationEvidence | null,
  local: ConnectorInvocationEvidence | null,
): EvidenceState {
  if (!browser || !local) {
    return {
      state: "unknown",
      reason: "Both browser-turn and local connector evidence are required",
    };
  }

  const sameAttempt =
    browser.attemptId === local.attemptId &&
    browser.conversationId === local.conversationId;

  const sameOperation =
    browser.connector === local.connector &&
    browser.operation === local.operation;

  if (!sameAttempt || !sameOperation) {
    return {
      state: "absent",
      reason: "Connector evidence does not bind to the intended attempt",
    };
  }

  return {
    state: "confirmed",
    evidenceId: `${browser.browserTurnId}:${local.resultDigest}`,
  };
}
```

This is deliberately stricter than Desktop Commander's local history. The upstream history is powerful because it records the real operation and bounded result, but it is not itself a ChatGPT-turn identifier. citeturn18search0

### Read the local Desktop Commander history without modifying it

Desktop Commander documents JSONL records containing timestamp, tool name, arguments, duration and bounded result. citeturn18search0

```ts
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

interface DesktopCommanderHistoryRow {
  timestamp: string;
  toolName?: string;
  tool?: string;
  arguments?: unknown;
  duration?: number;
  result?: unknown;
}

export async function readDesktopCommanderCalls(
  historyPath: string,
  since: Date,
): Promise<DesktopCommanderHistoryRow[]> {
  const rows: DesktopCommanderHistoryRow[] = [];

  const lines = createInterface({
    input: createReadStream(historyPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (!line.trim()) continue;

    let row: DesktopCommanderHistoryRow;
    try {
      row = JSON.parse(line) as DesktopCommanderHistoryRow;
    } catch {
      // A malformed local record should degrade evidence, never crash
      // the durable workflow or be silently treated as a valid call.
      continue;
    }

    const ts = Date.parse(row.timestamp);
    if (!Number.isFinite(ts) || ts < since.getTime()) continue;

    rows.push(row);
  }

  return rows;
}
```

Do **not** use “latest call after timestamp” as sufficient attribution. Filter further by expected operation, destination path, task attempt, result, and the bounded browser-turn interval.

### Make browser sends non-retriable and reconcile uncertainty separately

Temporal's samples explicitly cover activity cancellation, heartbeats, Signals, long-running workflows and Continue-As-New. citeturn10search0

The send activity should be treated differently from ordinary retry-safe activities:

```ts
import { proxyActivities } from "@temporalio/workflow";

interface BrowserActivities {
  claimSend(input: SendInput): Promise<SendClaim>;
  clickOnce(input: ClaimedSend): Promise<SendOutcome>;
  reconcileSend(input: ReconcileInput): Promise<ReconcileResult>;
}

const { claimSend, clickOnce, reconcileSend } =
  proxyActivities<BrowserActivities>({
    startToCloseTimeout: "2 minutes",

    // Browser clicks are externally visible and may have happened even
    // when the Activity result is lost. Do not let Temporal replay them.
    retry: {
      maximumAttempts: 1,
    },
  });

export async function guardedBrowserSend(
  input: SendInput,
): Promise<ConfirmedSend> {
  const claim = await claimSend(input);

  let outcome: SendOutcome;
  try {
    outcome = await clickOnce({ ...input, claim });
  } catch {
    // "Activity failed" != "browser click did not happen".
    const reconciled = await reconcileSend({
      attemptId: input.attemptId,
      claimSha256: claim.sha256,
      expectedPromptSha256: input.promptSha256,
    });

    if (reconciled.state !== "confirmed") {
      throw new Error(
        `Send outcome is uncertain: ${reconciled.reason ?? "no proof"}`,
      );
    }

    return reconciled.confirmed;
  }

  if (outcome.state !== "confirmed") {
    throw new Error("Browser sender returned without confirmed execution");
  }

  return outcome.confirmed;
}
```

The core reliability principle is:

```text
Temporal guarantees durable knowledge that
"we attempted this activity".

It does NOT guarantee:
"the website received the prompt exactly once".
```

The write-ahead claim plus reconciliation is what bridges that gap.

### Attempt-bound acceptance receipt

```ts
import { createHash } from "node:crypto";

export interface AcceptanceReceipt {
  taskId: string;
  attemptId: string;
  projectId: string;
  conversationId: string;
  contractSha256: string;
  sourceRevision: string;
  initialSendClaimSha256: string;
  correctionSendClaimSha256: string | null;
  connectorEvidenceSha256: string;
  artifactPath: string;
  artifactSha256: string;
  acceptedAt: string;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function assertReceiptBinding(
  expected: Omit<AcceptanceReceipt, "acceptedAt">,
  actual: AcceptanceReceipt,
): void {
  for (const [key, value] of Object.entries(expected)) {
    const actualValue = actual[key as keyof AcceptanceReceipt];

    if (actualValue !== value) {
      throw new Error(
        `Acceptance receipt re-bound ${key}: expected ${String(value)}, ` +
        `got ${String(actualValue)}`,
      );
    }
  }
}
```

AgentHorizon strongly supports this kind of strict judge input: long execution traces can look plausible while containing constraint violations or unwanted side effects. citeturn21academia13

## Recommended development sequence

### Establish the browser/connector evidence contract

This should happen before adding any scheduler.

Implement a small `BrowserEvidenceAdapter` and a read-only Desktop Commander history reader. Use either Playwright-over-CDP or your existing low-level CDP code for the first version; Browser Harness JS and BrowserSkill are the most useful source references. citeturn9search1turn13search0turn24search0

The acceptance gate should be a **fresh, approved, non-destructive browser test** proving all of these identities simultaneously:

```text
approved task ID
       =
Temporal attempt ID
       =
owned Helium target
       =
exact ChatGPT Project
       =
exact conversation
       =
exact newly submitted user turn
       =
structured Remote Desktop Commander invocation
       =
matching local Desktop Commander history call
       =
expected repository/file result
```

A missing link must produce:

```text
evidence: unknown
dispatch permitted: false
```

not a heuristic success.

This is where BrowserSkill's explicit borrow/return semantics and Desktop Commander's local history provide the biggest immediate leverage. citeturn24search2turn18search0

### Run the fresh Temporal-controlled lifecycle

Only after the evidence contract works should you execute the already-approved report pilot.

The measurable gate is:

```text
Temporal starts fresh attempt
        ↓
one guarded initial browser send
        ↓
correct connector invocation proven
        ↓
artifact appears
        ↓
independent verifier rejects controlled omission
        ↓
one same-chat correction
        ↓
correct connector invocation proven again
        ↓
artifact independently accepted
        ↓
worker restarted during experiment
        ↓
history/replay recovers unchanged identity
        ↓
verified_approval_boundary

dispatchPermitted = false
nextTaskPermitted = false
```

Then separately inject uncertain-send failures using the synthetic/browser fixture rather than repeatedly generating risky real-world duplicate sends.

Temporal's official samples already contain the mechanisms necessary for cancellation, heartbeats, durable signals, testing and long-lived workflows; another durable orchestration framework would provide little value here. citeturn10search0

### Generalise only after one complete owner journey is proven

The third gate should test the actual product rather than another report-specific variant:

```text
Owner manually starts ChatGPT Project task
              ↓
Supervisor passively adopts it
              ↓
No replay of initial instruction
              ↓
Observe until checkpoint
              ↓
Continue unfinished work in SAME conversation
              ↓
Verify Desktop Commander + repository outcome
              ↓
Update authoritative plan item
              ↓
Resolve next explicitly approved task
              ↓
Create NEW conversation in SAME ChatGPT Project
              ↓
Select Remote Desktop Commander
              ↓
Submit exactly once
```

Only after this succeeds should you introduce multi-project fairness, scheduling and longer autonomy budgets.

That sequencing is consistent with both the supplied project handoff and the external research: real-world browser-agent work is difficult primarily because of **identity, observation, recovery and truthful evaluation**, not because the system lacks another planner. fileciteturn0file9 WebArena, BrowserGym, Emergence WebVoyager, AgentHorizon and Wuying all reinforce the need for reproducible evaluation, explicit recovery and long-horizon failure handling. citeturn20academia0turn20academia2turn21academia12turn21academia13turn21academia14

**Overall recommendation:** there is a substantial amount of code and design work worth reusing, but it should be taken in small pieces. The highest-value source to study immediately is **Browser Harness JS for CDP target routing, BrowserSkill for ownership semantics, open-browser-use for the browser-adapter boundary, Desktop Commander for real connector history, Playwright for contract testing and Temporal's TypeScript samples for durable recovery**. Oracle remains your ChatGPT-aware writer. BrowserGym, AgentLab, Agent-E and Stagehand should inform the design and tests rather than become new competing runtimes. This path preserves your existing ChatGPT Project workflow and closes the two remaining evidence gaps without an unnecessary rewrite.