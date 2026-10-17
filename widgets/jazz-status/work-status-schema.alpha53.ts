// Copied from RemoteMCP-Jazz/control-plane/packages/protocol/src/work-status-schema.ts.
// jazz-tools 2.0.0-alpha.53. MIT: see THIRD_PARTY_LICENSE.txt. Body drift-tested byte-for-byte.
import { schema as s } from "jazz-tools";

export const workStatusSchema = {
  workStatusViews: s.table({
    ownerId: s.string(), workId: s.string(), deviceId: s.string(), revision: s.int(),
    state: s.string(), outcome: s.string().optional(), evidence: s.string(),
    lastEventId: s.string(), sourceCommittedAt: s.string(), timestampEvidence: s.string(),
    startedAt: s.string(), reportedAt: s.string().optional(),
    projectedAt: s.string(), source: s.string(),
  }),
  workStatusHealth: s.table({
    ownerId: s.string(), observedAt: s.string(), source: s.string(),
  }),
};
