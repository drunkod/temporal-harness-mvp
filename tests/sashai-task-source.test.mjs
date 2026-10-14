import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectSashaiTaskSource, taskBreakdownItems } from '../dist/sashai-task-source.js';

test('task breakdown parser ignores deferred goals and only reads the named checklist',()=>{
  const x='# Plan\n## Task Breakdown\n- [x] Completed\n- [ ] First approved step\n### Detail\n- [ ] Nested approved check\n## Deferred Goals\n- [ ] Unapproved backlog\n';
  assert.deepEqual(taskBreakdownItems(x),['First approved step','Nested approved check']);
  assert.equal(taskBreakdownItems('# no task breakdown\n- [ ] task'),null);
  assert.equal(taskBreakdownItems('## Task Breakdown\n## Task Breakdown\n- [ ] duplicate'),null);
});

test('active plan resolver is read-only and refuses missing, archived, foreign and ambiguous authorities',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sashai-plan-gate-'));
 const marker=join(root,'.ai','harness');
 const plan=join(root,'plans','active-plan.md');
 try{
  await mkdir(marker,{recursive:true});
  await mkdir(join(root,'plans','archive'),{recursive:true});
  await writeFile(join(root,'AGENTS.md'),'# Routing contract\n');
  await writeFile(join(root,'tasks','current.md'),'Idle').catch(()=>{});
  await writeFile(plan,'# Approved Plan\n## Task Breakdown\n- [x] completed\n- [ ] Implement accepted task\n- [ ] Run verification\n');
  const a=await inspectSashaiTaskSource(root);
  assert.equal(a.status,'no_active_plan');
  assert.equal(a.dispatchAllowed,false);
  await writeFile(join(marker,'active-plan'),'plans/active-plan.md\n');
  const b=await inspectSashaiTaskSource(root);
  assert.equal(b.status,'missing_worktree_owner');
  await writeFile(join(marker,'active-worktree'),root+'\n');
  const c=await inspectSashaiTaskSource(root);
  assert.equal(c.status,'approved_plan_has_pending_tasks');
  assert.equal(c.pendingCount,2);
  assert.equal(c.dispatchAllowed,false,'Even approved tasks need a separate execution gate');
  assert.equal(c.tasks[0],'Implement accepted task');
  assert.match(c.planSha256,/^[a-f0-9]{64}$/);
  await writeFile(plan,'# Approved Plan\n## Task Breakdown\n- [ ] Updated task\n');
  const revised=await inspectSashaiTaskSource(root);
  assert.notEqual(revised.planSha256,c.planSha256);
  assert.equal(revised.dispatchAllowed,false);
  await writeFile(join(marker,'active-worktree'),join(tmpdir(),'someone-else')+'\n');
  assert.equal((await inspectSashaiTaskSource(root)).status,'wrong_worktree');
  await writeFile(join(marker,'active-plan'),'plans/archive/old.md\n');
  assert.equal((await inspectSashaiTaskSource(root)).status,'archived_or_nonexecution_plan');
  await writeFile(join(marker,'active-plan'),'plans/../../some-external-plan.md\n');
  assert.equal((await inspectSashaiTaskSource(root)).status,'invalid_plan_marker');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('the live Sashai worktree has no approved active plan; never select an archived or completed plan',async t=>{
 const gate=await inspectSashaiTaskSource('/Users/test/Documents/work/sashai');
 if(gate.status==='missing_contract'){t.skip('Sashai repository unavailable on this host');return;}
 assert.equal(gate.status,'no_active_plan');
 assert.equal(gate.activePlan,null);
 assert.equal(gate.pendingCount,0);
 assert.equal(gate.dispatchAllowed,false);
});
