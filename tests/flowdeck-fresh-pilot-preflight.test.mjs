import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {inspectProposal} from '../scripts/flowdeck-fresh-pilot-preflight.mjs';

const proposalPath=fileURLToPath(new URL('../docs/FLOWDECK_FRESH_ATTENDED_PILOT_PROPOSAL_2026-10-16.json',import.meta.url));
const fresh=async()=>JSON.parse(await readFile(proposalPath,'utf8'));
const reasons=b=>b.map(x=>x.code);
test('fresh pilot proposal is deliberately unapproved and cannot independently authorize a send',async()=>{
 const p=await fresh(), b=inspectProposal(p,[]);
 assert.deepEqual(reasons(b),['owner_approval_missing']);
 assert.equal(p.executionAuthorized,false);
 assert.equal(p.productionEnrollment,false);
 assert.equal(p.tasks.length,2);
 assert.equal(p.tasks[0].id,p.initialTaskId);
 assert.match(p.tasks[0].instruction,/FLOWDECK_STATUS: continue/);
 assert.match(p.tasks[1].instruction,/FLOWDECK_STATUS: implementation_done/);
 assert.notEqual(p.tasks[0].artifact,p.tasks[1].artifact);
});
test('existing pilot identifiers or task titles prevent reuse',async()=>{
 const p=await fresh();
 const reused=inspectProposal(p,[{id:p.id,tasks:[]}]);
 assert.ok(reasons(reused).includes('reused_pilot_identity'));
 const titleReuse=inspectProposal(p,[{id:'other',tasks:[{id:'other-task',title:p.tasks[1].title}]}]);
 assert.ok(reasons(titleReuse).includes('reused_pilot_identity'));
});
test('connector, destination, identities, task instructions and budgets fail closed',async()=>{
 const p=await fresh();
 for(const [patch,expected] of [
  [{connector:'Remote Desktop Commander'},'invalid_destination'],
  [{projectUrl:'https://example.invalid/project'},'invalid_destination'],
  [{tasks:[p.tasks[0],p.tasks[0]]},'invalid_two_task_contract'],
  [{maxPlannedAutomatedContinuations:6},'invalid_send_budget'],
  [{initialTaskId:'historical-b'},'invalid_two_task_contract'],
  [{state:'approved'},'invalid_proposal_contract'],
  [{executionAuthorized:true},'invalid_proposal_contract']
 ]){
  assert.ok(reasons(inspectProposal({...p,...patch},[])).includes(expected),expected);
 }
});
test('a proposal boolean alone cannot confer pilot budget or owner approval',async()=>{
 const p=await fresh();
 const missing=inspectProposal({...p,attendedPilotBudget:undefined,budgetEnforcedByWorkflow:true},[]);
 assert.ok(reasons(missing).includes('workflow_budget_not_enforced'));
 assert.ok(reasons(missing).includes('owner_approval_missing'));
 const wrong=inspectProposal({...p,attendedPilotBudget:{...p.attendedPilotBudget,nextTaskId:'wrong'}},[]);
 assert.ok(reasons(wrong).includes('workflow_budget_not_enforced'));
 assert.deepEqual(reasons(inspectProposal(p,[])),['owner_approval_missing']);
});
