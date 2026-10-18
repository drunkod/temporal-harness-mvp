/** Production-safe initial P1 browser transaction. This module never starts a browser. */
import { mkdir, open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLiveBrowser, PROJECT, type LiveBrowser } from './sashai-live-browser.js';
import { composerPayloadFor } from './sashai-dispatch-evidence.js';
import { autonomyPolicyDigest, reserveAutonomousSend, sha256, validateAutonomyPolicy,
  type AutonomyPolicyV1, type AutonomousUsage } from './flowdeck-autonomy-policy.js';
import { createAutonomyCampaignStore } from './flowdeck-autonomy-campaign.js';
import { createAutonomousInitialJournal, initialDispatchKey, type InitialDispatchScope } from './flowdeck-autonomy-initial-send.js';
import { supervisedTaskPrompt } from './flowdeck-supervisor-activities.js';
import type { SupervisorProject, ApprovedTask } from './flowdeck-projects.js';
import { parseSashaiChatUrl } from './sashai-observer.js';

export const productionAutonomyRoot = () => join(homedir(), 'Library', 'Application Support', 'Flowdeck', 'autonomy-v1');
export interface InitialAuthorization {
  policy: AutonomyPolicyV1; project: SupervisorProject; task: ApprovedTask;
  planBytes: Buffer | string; usage: AutonomousUsage;
}
export interface InitialObservation {
  userPromptHash: string | null; chatUrl: string | null; turnId: string | null;
}
export interface ProductionInitialBrowser extends Pick<LiveBrowser,
  'createOwnedProjectTab' | 'stage' | 'matches' | 'click' | 'chat' | 'firstUserTurn'> {}
export interface ProductionInitialDependencies {
  root?: string;
  authorize(): Promise<InitialAuthorization>;
  /** Exact Temporal execution identity supplied by the workflow caller. */
  runId: string;
  cancelled?(): boolean;
  browser?: ProductionInitialBrowser;
  browserFactory?(): ProductionInitialBrowser;
  campaign?: ReturnType<typeof createAutonomyCampaignStore>;
  uuid?(): string;
}
export interface ProductionInitialResult { status: 'submitted' | 'pending' | 'reconciled'; scope: InitialDispatchScope }
const normalize = (s: string) => s.normalize('NFC').replace(/\s+/gu, ' ').trim();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fsyncDir = async (path: string) => { const d = await open(path, 'r'); try { await d.sync(); } finally { await d.close(); } };

/** Exclusive machine-wide claim. It is intentionally never auto-removed, including after success. */
export async function claimAutonomyBrowserOwner(root: string, owner: { campaignId: string; runId: string; deviceId: string; profile: string; tabOwnerId: string }) {
  const dir = resolve(root); await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'browser-owner.lock');
  const fd = await open(path, 'wx', 0o600);
  try { await fd.writeFile(JSON.stringify({ schema: 'flowdeck.browser-owner/v1', ...owner }) + '\n'); await fd.sync(); }
  finally { await fd.close(); }
  await fsyncDir(dir);
  return path;
}

function validateAuthorization(a: InitialAuthorization) {
  const p = validateAutonomyPolicy(a.policy, a.project, a.planBytes);
  const task = a.project.tasks.find(t => t.id === a.project.initialTaskId);
  if (!task || !same(task, a.task) || !p.enabledTaskIds.includes(task.id)) throw Error('initial task is not the exact approved enrolled task');
  if (a.project.projectUrl !== PROJECT) throw Error('unsupported project URL');
  const budget = reserveAutonomousSend(p, a.usage, 'initial_p1');
  if (!budget.allowed) throw Error('initial P1 reservation refused: ' + budget.reason);
  return { policy: p, task, prompt: supervisedTaskPrompt(a.project, task, 'initial') };
}

export function createFlowdeckAutonomyProductionInitial(deps: ProductionInitialDependencies) {
  const root = resolve(deps.root ?? productionAutonomyRoot());
  const journal = createAutonomousInitialJournal(join(root, 'initial-dispatches'));
  const campaign = deps.campaign ?? createAutonomyCampaignStore(root);
  const selectedBrowser = deps.browser ?? deps.browserFactory?.();
  if (!selectedBrowser) throw Error('an explicit browser adapter is required');
  const browser: ProductionInitialBrowser = selectedBrowser;
  const canceled = async () => { if (deps.cancelled?.()) throw Error('initial dispatch canceled'); };
  const authorize = async (expectedDigest?: string, expectedPromptHash?: string) => {
    await canceled();
    const a = await deps.authorize();
    const v = validateAuthorization(a);
    if (expectedDigest && autonomyPolicyDigest(v.policy) !== expectedDigest) throw Error('policy/enrollment/plan changed before initial click');
    if (expectedPromptHash && sha256(normalize(composerPayloadFor(v.prompt))) !== expectedPromptHash) throw Error('approved first-task prompt changed');
    return { ...v, authorization: a };
  };

  async function run(): Promise<ProductionInitialResult> {
    // Validate durable execution identity before authorization or any filesystem,
    // campaign, browser, or journal effects. A random ID is only for tab ownership.
    if (typeof deps.runId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$/.test(deps.runId))
      throw Error('a valid Temporal runId is required for initial dispatch');
    const runId = deps.runId;
    const initial = await authorize();
    const p = initial.policy;
    const owner = (deps.uuid ?? randomUUID)();
    await claimAutonomyBrowserOwner(root, { campaignId: p.campaignId, runId, deviceId: p.deviceId, profile: p.profile, tabOwnerId: owner });
    await campaign.reserve(p, runId, 'initial_p1'); // durable and never refunded
    await canceled();
    const tab = await browser.createOwnedProjectTab(owner);
    if (tab.url.split('?')[0] !== PROJECT) throw Error('new owned tab is not the approved project route');
    const scope: InitialDispatchScope = Object.freeze({ campaignId: p.campaignId, runId,
      projectId: p.projectId, taskId: initial.task.id, tabId: tab.id, projectUrl: PROJECT,
      worktree: p.worktree, promptHash: sha256(normalize(composerPayloadFor(initial.prompt))),
      policyDigest: autonomyPolicyDigest(p) });
    await persistPrompt(scope, initial.prompt);
    await journal.reserve(scope); // immutable owned tab identity is durable before any send click
    await authorize(scope.policyDigest, scope.promptHash);
    await browser.stage(tab, PROJECT, initial.prompt);
    await journal.next(scope, 'staged');
    await authorize(scope.policyDigest, scope.promptHash);
    if (!await browser.matches(tab, PROJECT, initial.prompt)) throw Error('initial staged composer or owned tab mismatch: quarantine');
    await authorize(scope.policyDigest, scope.promptHash);
    await journal.next(scope, 'click_attempted'); // irreversible barrier precedes the only click call
    await authorize(scope.policyDigest, scope.promptHash);
    const clicked = await browser.click(tab, PROJECT, initial.prompt, Date.now() + 10_000, () => {
      if (deps.cancelled?.()) throw Error('initial dispatch canceled');
    });
    if (clicked !== true) throw Error('initial click uncertain; click_attempted retained, never retry');
    await journal.next(scope, 'submitted');
    const observation = await observe(scope, initial.prompt);
    return await recordObservation(scope, observation);
  }

  async function observe(scope: InitialDispatchScope, prompt?: string): Promise<InitialObservation> {
    if (!prompt) prompt = await readPersistedPrompt(scope);
    const chat = await browser.chat(scope.tabId);
    const firstTurn = chat && browser.firstUserTurn ? await browser.firstUserTurn(scope.tabId, chat.url, prompt) : null;
    const exactFirstTurn = firstTurn?.matched === true && firstTurn.turnId !== null;
    return { userPromptHash: exactFirstTurn ? scope.promptHash : null,
      chatUrl: chat?.url ?? null, turnId: exactFirstTurn ? firstTurn!.turnId : null };
  }

  async function persistPrompt(scope: InitialDispatchScope, prompt: string) {
    const dir = join(root, 'initial-prompts'); await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, initialDispatchKey(scope) + '.json');
    const record = { schema: 'flowdeck.initial-prompt/v1', scope, prompt };
    const fd = await open(path, 'wx', 0o600);
    try { await fd.writeFile(JSON.stringify(record) + '\n'); await fd.sync(); } finally { await fd.close(); }
    await fsyncDir(dir);
  }

  async function readPersistedPrompt(scope: InitialDispatchScope) {
    const path = join(root, 'initial-prompts', initialDispatchKey(scope) + '.json');
    const record = JSON.parse(await readFile(path, 'utf8'));
    if (record.schema !== 'flowdeck.initial-prompt/v1' || !same(record.scope, scope) ||
      sha256(normalize(composerPayloadFor(record.prompt))) !== scope.promptHash)
      throw Error('persisted initial prompt changed: quarantine');
    return record.prompt as string;
  }

  async function recordObservation(scope: InitialDispatchScope, o: InitialObservation): Promise<ProductionInitialResult> {
    const dir = join(root, 'initial-observations'); await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, sha256(JSON.stringify([scope.campaignId, scope.runId, scope.taskId])) + '.json');
    let expectedChat = false;
    if (o.chatUrl) {
      try {
        const actual = parseSashaiChatUrl(o.chatUrl);
        const expectedProject = new URL(scope.projectUrl).pathname.match(/^\/g\/([^/]+)\/project$/)?.[1];
        const actualProject = new URL(actual.url).pathname.match(/^\/g\/([^/]+)\/c\//)?.[1];
        // ChatGPT conversation paths may carry the human-readable -dr-sashai suffix.
        // Bind the canonical Project identity, never a different Project or chat.
        if (!expectedProject || actualProject?.replace(/-dr-sashai$/i, '') !== expectedProject)
          throw Error('initial tab/chat Project mismatch: quarantine');
        expectedChat = true;
      } catch (e) {
        if (String(e).includes('Project mismatch')) throw e;
        throw Error('initial tab/chat URL mismatch: quarantine');
      }
    }
    if (!o.userPromptHash || o.userPromptHash !== scope.promptHash || !expectedChat || !o.turnId)
      return { status: 'pending', scope };
    const record = { schema: 'flowdeck.initial-observation/v1', scope, chatUrl: o.chatUrl, turnId: o.turnId, userPromptHash: o.userPromptHash };
    try {
      const fd = await open(path, 'wx', 0o600);
      try { await fd.writeFile(JSON.stringify(record) + '\n'); await fd.sync(); } finally { await fd.close(); }
      await fsyncDir(dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const old = JSON.parse(await readFile(path, 'utf8'));
      if (!same(old, record)) throw Error('initial tab/chat/turn observation mismatch: quarantine');
    }
    if (await journal.current(scope) === 'submitted') await journal.next(scope, 'reconciled');
    return { status: 'reconciled', scope };
  }

  /** Restart path is observation-only; click_attempted/submitted can never enter run(). */
  async function reconcile(scope: InitialDispatchScope): Promise<ProductionInitialResult> {
    const phase = await journal.current(scope);
    if (phase === 'reconciled') {
      const path = join(root, 'initial-observations', sha256(JSON.stringify([scope.campaignId, scope.runId, scope.taskId])) + '.json');
      const old = JSON.parse(await readFile(path, 'utf8'));
      if (!same(old.scope, scope)) throw Error('initial observation scope changed: quarantine');
      return { status: 'reconciled', scope };
    }
    if (phase !== 'submitted' && phase !== 'click_attempted') throw Error('initial click was not attempted; observe only, never click again');
    const o = await observe(scope);
    if (phase === 'click_attempted' && o.userPromptHash === scope.promptHash && o.chatUrl && o.turnId) {
      await journal.next(scope, 'submitted');
    }
    return recordObservation(scope, o);
  }
  return { run, reconcile, journal };
}

/** Construction does not launch a process; createLiveBrowser only binds CDP methods. */
export function createProductionInitial(deps: Omit<ProductionInitialDependencies, 'browser' | 'browserFactory'>) {
  return createFlowdeckAutonomyProductionInitial({ ...deps, browserFactory: () => createLiveBrowser() });
}
