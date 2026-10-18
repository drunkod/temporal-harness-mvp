import { Context } from '@temporalio/activity';
import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { AutonomousExecutionContext } from './flowdeck-autonomous-workflow.js';
import type { InitialDispatchScope, InitialDispatchPhase } from './flowdeck-autonomy-initial-send.js';
import { initialDispatchKey } from './flowdeck-autonomy-initial-send.js';
import { createFlowdeckAutonomyProductionInitial, type InitialAuthorization, type ProductionInitialBrowser } from './flowdeck-autonomy-production-initial.js';
import { autonomyPolicyDigest } from './flowdeck-autonomy-policy.js';

const phases: InitialDispatchPhase[] = ['claimed', 'staged', 'click_attempted', 'submitted', 'reconciled'];
const exact = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const contextKey = (c: AutonomousExecutionContext) => hash(JSON.stringify([
  c.workflowId, c.runId, c.campaignRunId, c.projectId, c.policy.campaignId, c.policyDigest,
]));

export interface InitialScopeStore {
  readExact(context: AutonomousExecutionContext): Promise<InitialDispatchScope | null>;
  persistExact(context: AutonomousExecutionContext, scope: InitialDispatchScope): Promise<void>;
  /** Durable pre-transaction binding, used to distinguish fresh from owner-without-scope. */
  claimExact(context: AutonomousExecutionContext): Promise<void>;
}

/** Own this directory per isolated lifecycle execution. Records are exclusive and immutable. */
export function createInitialScopeStore(stateRoot: string): InitialScopeStore {
  const root = resolve(stateRoot);
  const claims = join(root, 'initial-activity-claims');
  const claimPath = (c: AutonomousExecutionContext) => join(claims, `${contextKey(c)}.json`);
  const readClaim = async (c: AutonomousExecutionContext) => {
    try {
      const record = JSON.parse(await readFile(claimPath(c), 'utf8'));
      if (record.schema !== 'flowdeck.initial-activity-claim/v1' ||
          !exact(record.identity, identity(c))) throw Error('initial activity claim changed: quarantine');
      try {
        const scoped = JSON.parse(await readFile(claimPath(c) + '.scope', 'utf8'));
        if (scoped.schema !== record.schema || !exact(scoped.identity, record.identity) || !scoped.scope)
          throw Error('initial activity scope claim changed: quarantine');
        return scoped;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return record;
        throw e;
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  };
  const identity = (c: AutonomousExecutionContext) => ({
    workflowId: c.workflowId, runId: c.runId, campaignRunId: c.campaignRunId,
    projectId: c.projectId, campaignId: c.policy.campaignId, policyDigest: c.policyDigest,
  });

  async function claimExact(c: AutonomousExecutionContext) {
    const existing = await readdir(claims).catch(e => {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    });
    for (const name of existing.filter(n => n.endsWith('.json'))) {
      const other = JSON.parse(await readFile(join(claims, name), 'utf8'));
      if (other.schema !== 'flowdeck.initial-activity-claim/v1') throw Error('invalid activity owner claim: quarantine');
      const i = other.identity;
      if ((i.workflowId === c.workflowId || i.runId === c.runId) && !exact(i, identity(c)))
        throw Error('duplicate or foreign workflow/run owner claim: quarantine');
    }
    await mkdir(claims, { recursive: true, mode: 0o700 });
    const record = { schema: 'flowdeck.initial-activity-claim/v1', identity: identity(c) };
    try {
      const fd = await open(claimPath(c), 'wx', 0o600);
      try { await fd.writeFile(JSON.stringify(record) + '\n'); await fd.sync(); } finally { await fd.close(); }
      const dir = await open(claims, 'r'); try { await dir.sync(); } finally { await dir.close(); }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      await readClaim(c); // Existing exact claim is an idempotent retry; foreign contents fail closed.
    }
  }

  async function discover(c: AutonomousExecutionContext): Promise<{ scope: InitialDispatchScope; phase: InitialDispatchPhase } | null> {
    const dir = join(root, 'initial-dispatches');
    const names = await readdir(dir).catch(e => {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    });
    const groups = new Map<string, Array<{ scope: InitialDispatchScope; phase: InitialDispatchPhase }>>();
    for (const name of names.filter(n => n.endsWith('.json'))) {
      const record = JSON.parse(await readFile(join(dir, name), 'utf8'));
      if (record.schema !== 'flowdeck.autonomous-dispatch/v1' || !phases.includes(record.phase))
        throw Error('unreadable initial journal record: quarantine');
      const s = record.scope as InitialDispatchScope;
      if (s?.runId !== c.runId) continue;
      if (s.projectId !== c.projectId || s.policyDigest !== c.policyDigest || s.campaignId !== c.policy.campaignId)
        throw Error('foreign run/project/policy claim: quarantine');
      if (name !== `${initialDispatchKey(s)}-${record.phase}.json`)
        throw Error('initial journal filename/claim mismatch: quarantine');
      const key = initialDispatchKey(s), group = groups.get(key) ?? [];
      if (group.some(x => x.phase === record.phase)) throw Error('duplicate initial phase claim: quarantine');
      group.push({ scope: s, phase: record.phase }); groups.set(key, group);
    }
    const records: Array<{ scope: InitialDispatchScope; phase: InitialDispatchPhase }> = [];
    for (const group of groups.values()) {
      group.sort((a, b) => phases.indexOf(a.phase) - phases.indexOf(b.phase));
      if (group.some(x => !exact(x.scope, group[0].scope)) ||
          group.some((x, i) => phases.indexOf(x.phase) !== i))
        throw Error('duplicate or discontinuous initial journal claim: quarantine');
      records.push({ scope: group[0].scope, phase: group[group.length - 1].phase });
    }
    if (records.length > 1) throw Error('ambiguous initial dispatch claims: quarantine');
    return records[0] ?? null;
  }

  async function readExact(c: AutonomousExecutionContext) {
    const claim = await readClaim(c);
    // Same workflow/run with another campaign, project, or policy is never adoptable.
    const claimNames = await readdir(claims).catch(e => {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    });
    for (const name of claimNames.filter(n => n.endsWith('.json'))) {
      const other = JSON.parse(await readFile(join(claims, name), 'utf8'));
      if (other.schema !== 'flowdeck.initial-activity-claim/v1') throw Error('invalid activity owner claim: quarantine');
      const i = other.identity;
      if ((i.workflowId === c.workflowId || i.runId === c.runId) && !exact(i, identity(c)))
        throw Error('duplicate or foreign workflow/run owner claim: quarantine');
    }
    const found = await discover(c);
    const ownerPath = join(root, 'browser-owner.lock');
    let owner: any = null;
    try { owner = JSON.parse(await readFile(ownerPath, 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (!claim && !found && !owner) return null;
    if (!claim && found) throw Error('initial journal exists without exact activity owner: quarantine');
    if (!claim && owner) throw Error('ambiguous owner without exact activity scope: quarantine');
    if (found && (!owner || owner.runId !== c.runId || owner.campaignId !== c.policy.campaignId))
      throw Error('initial journal has no matching durable browser owner: quarantine');
    if (claim.scope) {
      if (!found || !exact(claim.scope, found.scope)) throw Error('claimed scope differs from on-disk journal: quarantine');
      return found.scope;
    }
    if (found) return found.scope; // Activity returned/lost scope can be reconstructed from the journal.
    // A reservation/owner exists but no journal is visible: never call run again.
    if (owner) {
      if (owner.runId === c.runId || owner.campaignId === c.policy.campaignId)
        throw Error('ambiguous owner without recoverable initial scope: quarantine');
      throw Error('foreign browser owner claim: quarantine');
    }
    return null;
  }

  async function persistExact(c: AutonomousExecutionContext, scope: InitialDispatchScope) {
    const claim = await readClaim(c);
    if (!claim) throw Error('exact activity owner must be claimed before scope persistence');
    if (scope.runId !== c.runId || scope.projectId !== c.projectId ||
        scope.campaignId !== c.policy.campaignId || scope.policyDigest !== c.policyDigest)
      throw Error('initial scope differs from exact activity context');
    const found = await discover(c);
    if (!found || !exact(found.scope, scope)) throw Error('scope is not backed by its on-disk claimed journal');
    const record = { ...claim, scope };
    try {
      const fd = await open(claimPath(c) + '.scope', 'wx', 0o600);
      try { await fd.writeFile(JSON.stringify(record) + '\n'); await fd.sync(); } finally { await fd.close(); }
      const dir = await open(claims, 'r'); try { await dir.sync(); } finally { await dir.close(); }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const old = JSON.parse(await readFile(claimPath(c) + '.scope', 'utf8'));
      if (!exact(old, record)) throw Error('initial scope persistence conflict: quarantine');
    }
  }
  return { claimExact, readExact, persistExact };
}

export interface InitialActivityPorts {
  root: string;
  scopes: InitialScopeStore;
  authorize(context: AutonomousExecutionContext): Promise<InitialAuthorization>;
  browserFactory(): ProductionInitialBrowser;
  /** Test port; production defaults to Temporal's current Activity context. */
  executionContext?(): { workflowExecution: { workflowId: string; runId: string }; cancellationSignal: AbortSignal };
}

export function initialActivities(ports: InitialActivityPorts) {
  function assertExecution(input: AutonomousExecutionContext) {
    const injected = ports.executionContext?.();
    const temporal = injected ? null : Context.current();
    const actual = injected?.workflowExecution ?? temporal!.info.workflowExecution;
    if (!actual || actual.workflowId !== input.workflowId || actual.runId !== input.runId ||
        input.projectId !== input.policy.projectId || autonomyPolicyDigest(input.policy) !== input.policyDigest ||
        !/^[a-zA-Z0-9._-]{8,128}$/.test(input.campaignRunId))
      throw Error('Activity execution differs from authorized lifecycle context');
    if ((injected?.cancellationSignal ?? temporal!.cancellationSignal).aborted) throw Error('Activity cancelled');
    return { workflowExecution: actual, cancellationSignal: injected?.cancellationSignal ?? temporal!.cancellationSignal };
  }
  const check = (input: AutonomousExecutionContext) => {
    assertExecution(input);
    if (input.projectId !== input.policy.projectId || autonomyPolicyDigest(input.policy) !== input.policyDigest)
      throw Error('Activity policy/project binding mismatch');
  };
  async function verifyAuthority(input: AutonomousExecutionContext) {
    check(input);
    const a = await ports.authorize(input);
    check(input);
    if (autonomyPolicyDigest(a.policy) !== input.policyDigest || a.project.id !== input.projectId ||
        a.policy.projectId !== input.projectId)
      throw Error('Current authority drifted from workflow input');
  }
  function transaction(input: AutonomousExecutionContext) {
    return createFlowdeckAutonomyProductionInitial({ root: ports.root, runId: input.runId,
      browserFactory: ports.browserFactory,
      cancelled: () => {
        try { assertExecution(input); return false; } catch { return true; }
      },
      authorize: async () => {
        check(input);
        const a = await ports.authorize(input);
        check(input);
        if (autonomyPolicyDigest(a.policy) !== input.policyDigest || a.project.id !== input.projectId ||
            a.policy.projectId !== input.projectId)
          throw Error('Current authority drifted from workflow input');
        return a;
      },
    });
  }
  return {
    async submitInitialP1(input: AutonomousExecutionContext) {
      check(input);
      await ports.scopes.claimExact(input);
      check(input);
      const prior = await ports.scopes.readExact(input);
      if (!prior) await verifyAuthority(input); // Do not even construct a browser adapter for drifted authority.
      const tx = transaction(input);
      let result;
      if (prior) result = await tx.reconcile(prior);
      else {
        try { result = await tx.run(); }
        catch (error) {
          // A thrown run is never reported as submitted. Preserve discoverable scope and observe only.
          const recovered = await ports.scopes.readExact(input);
          if (!recovered) throw error;
          try { await tx.reconcile(recovered); } catch { /* The durable phase remains quarantined for later observation. */ }
          await ports.scopes.persistExact(input, recovered);
          check(input);
          return { status: 'blocked' as const, reason: 'initial_submission_uncertain' };
        }
      }
      await ports.scopes.persistExact(input, result.scope);
      check(input);
      // Workflow accounting counts this submission separately from reconciliation.
      return { status: 'submitted' as const };
    },
    async reconcileInitialP1(input: AutonomousExecutionContext) {
      check(input);
      const scope = await ports.scopes.readExact(input);
      check(input);
      if (!scope) return { status: 'blocked' as const, reason: 'initial_scope_unavailable' };
      const result = await transaction(input).reconcile(scope);
      await ports.scopes.persistExact(input, scope);
      check(input);
      return { status: result.status === 'reconciled' ? 'reconciled' as const : 'pending' as const };
    },
  };
}
