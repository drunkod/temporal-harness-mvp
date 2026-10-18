import {
  initialActivities,
  type InitialActivityPorts,
} from './flowdeck-autonomy-production-activities.js';
import type {
  AutonomousExecutionContext,
  AutonomousLifecycleActivities,
} from './flowdeck-autonomous-workflow.js';
import { autonomyPolicyDigest } from './flowdeck-autonomy-policy.js';

type InitialMethods = 'submitInitialP1' | 'reconcileInitialP1';
type RemainingActivities = Omit<AutonomousLifecycleActivities, InitialMethods>;

export interface ProductionRegistryPorts {
  initial: InitialActivityPorts;
  /** Every non-initial operation is supplied by production integrations. */
  remaining: RemainingActivities;
  /** Must validate Activity SDK workflow/run identity, cancellation and pinned environment. */
  assertExecution(context: AutonomousExecutionContext): void;
}

const requiredRemaining: readonly (keyof RemainingActivities)[] = [
  'validateAndClaim', 'awaitP1Events', 'continueP1', 'reconcileContinuation',
  'awaitP1Completion', 'submitP2', 'reconcileP2', 'awaitP2Completion', 'closeout',
];

/** Complete, fail-closed registry. Initial send methods retain their exact existing API. */
export function createProductionRegistry(p: ProductionRegistryPorts): AutonomousLifecycleActivities {
  if (!p || typeof p.assertExecution !== 'function' || !p.initial || !p.remaining)
    throw new Error('complete production registry ports are required');
  for (const name of requiredRemaining) {
    if (typeof p.remaining[name] !== 'function') throw new Error(`missing production activity: ${name}`);
  }
  const first = initialActivities(p.initial);
  const guard = <T>(call: (c: AutonomousExecutionContext) => Promise<T>) =>
    async (c: AutonomousExecutionContext): Promise<T> => {
      p.assertExecution(c);
      if (!c || c.schema !== 'flowdeck.autonomous-input/v1' ||
          c.projectId !== c.policy.projectId || autonomyPolicyDigest(c.policy) !== c.policyDigest ||
          !c.workflowId || !c.runId || !c.campaignRunId)
        throw new Error('production activity context identity is invalid');
      return call(c);
    };
  return {
    validateAndClaim: guard(c => p.remaining.validateAndClaim(c)),
    submitInitialP1: guard(c => first.submitInitialP1(c)),
    reconcileInitialP1: guard(c => first.reconcileInitialP1(c)),
    awaitP1Events: guard(c => p.remaining.awaitP1Events(c)),
    continueP1: guard(c => p.remaining.continueP1(c)),
    reconcileContinuation: guard(c => p.remaining.reconcileContinuation(c)),
    awaitP1Completion: guard(c => p.remaining.awaitP1Completion(c)),
    submitP2: guard(c => p.remaining.submitP2(c)),
    reconcileP2: guard(c => p.remaining.reconcileP2(c)),
    awaitP2Completion: guard(c => p.remaining.awaitP2Completion(c)),
    closeout: guard(c => p.remaining.closeout(c)),
  };
}
