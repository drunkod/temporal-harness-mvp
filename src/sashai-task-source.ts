import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';

export type PlanGateStatus =
  'no_active_plan' | 'missing_contract' | 'invalid_plan_marker' |
  'plan_not_found' | 'archived_or_nonexecution_plan' |
  'wrong_worktree' | 'missing_worktree_owner' |
  'invalid_task_breakdown' | 'approved_plan_no_pending_tasks' |
  'approved_plan_has_pending_tasks';

export type PlanGate = {
  status: PlanGateStatus;
  repository: string;
  activePlan: string | null;
  owner: string | null;
  pendingCount: number;
  tasks: string[];
  dispatchAllowed: false;
  reason: string;
  checkedAt: string;
};

const defaultRepo = '/Users/test/Documents/work/sashai';
const planMarker = '.ai/harness/active-plan';
const ownerMarker = '.ai/harness/active-worktree';

async function readMarker(path: string): Promise<string | null> {
  const s = await stat(path).catch(() => null);
  if (!s || !s.isFile() || s.size > 2048) return null;
  const text = (await readFile(path, 'utf8')).trim();
  if (!text || text.includes('\0') || text.includes('\n')) return null;
  return text;
}

export function taskBreakdownItems(planText: string): string[] | null {
  const lines = planText.split(/\r?\n/);
  const headings = lines.flatMap((line,i)=> /^## Task Breakdown\s*$/.test(line)?[i]:[]);
  if (headings.length !== 1) return null;
  const start = headings[0] + 1;
  const endOffset = lines.slice(start).findIndex(line => /^##\s+/.test(line));
  const end = endOffset < 0 ? lines.length : start + endOffset;
  return lines.slice(start,end)
    .flatMap(line => {
      const m = line.match(/^\s*[-*]\s+\[ \]\s+(.+?)\s*$/);
      return m ? [m[1].slice(0,250)] : [];
    });
}

/** Read-only resolution of Sashai's authoritative active execution plan.
 *  No marker means NO next task, regardless of backlog or generated status.
 */
export async function inspectSashaiTaskSource(repo = defaultRepo): Promise<PlanGate> {
  const root = await realpath(resolve(repo)).catch(() => resolve(repo));
  const checkedAt = new Date().toISOString();
  const result = (status: PlanGateStatus, reason: string,
    activePlan: string | null = null, owner: string | null = null,
    tasks: string[] = []): PlanGate => ({
      status, repository: root, activePlan, owner,
      pendingCount: tasks.length, tasks: tasks.slice(0,20), dispatchAllowed:false,
      reason, checkedAt,
    });
  const contract = await stat(join(root,'AGENTS.md')).catch(() => null);
  if (!contract?.isFile()) return result('missing_contract','AGENTS.md routing contract cannot be verified');
  const marker = await readMarker(join(root,planMarker));
  if (!marker) return result('no_active_plan',
    'No .ai/harness/active-plan marker. Do not infer a task from snapshots, backlogs, recent or archived plans.');
  if (isAbsolute(marker) || !/^plans\/[a-zA-Z0-9_.\/-]+\.md$/.test(marker) || marker.includes('..')) {
    return result('invalid_plan_marker','Active-plan marker must be a repo-relative plans/*.md path');
  }
  if (marker.startsWith('plans/archive/') || marker.startsWith('plans/sprints/') ||
      marker.startsWith('plans/prds/')) {
    return result('archived_or_nonexecution_plan','Archived, sprint or PRD files are not executable active plans',marker);
  }
  const candidate = resolve(root,marker);
  const actual = await realpath(candidate).catch(() => null);
  const rel = actual ? relative(root,actual) : null;
  if (!actual || !rel) return result('plan_not_found','Active-plan marker points to a missing plan',marker);
  if (rel.startsWith('..'+sep) || rel==='..' || isAbsolute(rel))
    return result('invalid_plan_marker','Active plan resolves outside the Sashai repository');
  const worktree = await readMarker(join(root,ownerMarker));
  if (!worktree) return result('missing_worktree_owner','Active-worktree owner marker missing; refuse concurrent dispatch',marker);
  const owner = await realpath(resolve(root,worktree)).catch(() => null);
  if (owner !== root) return result('wrong_worktree','Active task belongs to another worktree',marker,owner||worktree);
  const text = await readFile(actual,'utf8');
  const items = taskBreakdownItems(text);
  if (!items) return result('invalid_task_breakdown','Plan must contain exactly one ## Task Breakdown',marker,owner);
  if (items.length === 0) return result('approved_plan_no_pending_tasks',
    'No unchecked task rows in the approved plan; completion still requires independent acceptance',marker,owner);
  return result('approved_plan_has_pending_tasks',
    'Approved plan contains unchecked items, but dispatch remains disabled until explicit task binding and verification',marker,owner,items);
}
