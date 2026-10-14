import test from 'node:test';
import assert from 'node:assert/strict';
import { previewSashaiContinuation } from '../dist/sashai-dispatch-preview.js';

const url='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/6acfca8f-34cc-83eb-aaa9-fbd1301247d4';
const sha='a'.repeat(64);
function fixture() {
  return {
    taskSource:{status:'approved_plan_has_pending_tasks',repository:'/fixture/sashai',
      activePlan:'plans/approved.md',owner:'/fixture/sashai',pendingCount:1,
      planSha256:sha,tasks:['Implement accepted task'],dispatchAllowed:false,
      reason:'Test fixture only',checkedAt:'2026-10-14T00:00:00.000Z'},
    observation:{url,browser:'attached_read_only',turnState:'turn_finished'},
    binding:{taskId:'task-1',taskText:'Implement accepted task',chatUrl:url,
      activePlan:'plans/approved.md',planSha256:sha,checkpoint:'Implementation exists; tests remain.',
      remainingSteps:['Add regression coverage'],acceptanceChecks:['Run agreed unit tests']},
    connectorPreservingTransportVerified:true,previousAttempt:'none',
  };
}

function assertNoExecution(result) {
  assert.equal(result.executionEnabled,false);
  assert.equal(result.submitsMessages,false);
  assert.equal(result.mode,'read_only_preview');
}

test('continuation proposal is task-bound and never enables execution',()=>{
  const input=fixture();
  const before=JSON.stringify(input);
  const result=previewSashaiContinuation(input);
  assertNoExecution(result);
  assert.equal(result.action,'prepare_continuation');
  assert.match(result.prompt,/SAME Sashai task task-1/);
  assert.match(result.prompt,/Remote Desktop Commander/);
  assert.match(result.prompt,/Add regression coverage/);
  assert.match(result.prompt,/Run agreed unit tests/);
  assert.match(result.promptSha256,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(input),before,'Preview must not mutate source/binding');
});

test('running and unanswered turns require observation, not continuation',()=>{
  for(const turnState of ['running','awaiting_answer']) {
    const input=fixture();input.observation.turnState=turnState;
    const result=previewSashaiContinuation(input);
    assertNoExecution(result);assert.equal(result.action,'observe');assert.equal(result.prompt,null);
  }
  const input=fixture();input.observation.pageBusyHint=true;
  assert.equal(previewSashaiContinuation(input).action,'prepare_continuation',
    'Generic page busy hint is not evidence of active generation');
});

test('missing plan and unbound task remain blocked even for completed chat response',()=>{
  const input=fixture();
  input.taskSource.status='no_active_plan';input.taskSource.activePlan=null;
  input.taskSource.planSha256=null;input.taskSource.tasks=[];delete input.binding;
  const result=previewSashaiContinuation(input);
  assertNoExecution(result);assert.equal(result.action,'blocked');assert.equal(result.prompt,null);
  assert.ok(result.blockers.some(x=>x.includes('No approved active plan')));
  assert.ok(result.blockers.some(x=>x.includes('No explicit current-task')));
});

test('stale plan, wrong chat and nonexistent checklist task cannot produce a prompt',()=>{
  for(const change of [
    input=>input.binding.planSha256='b'.repeat(64),
    input=>input.binding.activePlan='plans/other.md',
    input=>input.binding.taskText='Unapproved backlog goal',
    input=>input.binding.chatUrl=url.replace('6acfca8f','7acfca8f'),
  ]) {
    const input=fixture();change(input);
    const result=previewSashaiContinuation(input);
    assertNoExecution(result);assert.equal(result.action,'blocked');assert.equal(result.prompt,null);
  }
});

test('acceptance, remaining work and connector-preserving transport are independent gates',()=>{
  for(const change of [
    input=>input.binding.acceptanceChecks=[],
    input=>input.binding.remainingSteps=[],
    input=>input.binding.checkpoint='',
    input=>input.connectorPreservingTransportVerified=false,
  ]) {
    const input=fixture();change(input);
    const result=previewSashaiContinuation(input);
    assertNoExecution(result);assert.equal(result.action,'blocked');assert.equal(result.prompt,null);
  }
});

test('submitted, unknown and unspecified attempts require reconciliation without resend',()=>{
  for(const previousAttempt of ['submitted','unknown',undefined]) {
    const input=fixture();input.previousAttempt=previousAttempt;
    const result=previewSashaiContinuation(input);
    assertNoExecution(result);assert.equal(result.action,'reconcile_attempt');assert.equal(result.prompt,null);
  }
});

test('unobservable or outside-project chats never get a continuation proposal',()=>{
  for(const change of [
    input=>input.observation=null,
    input=>input.observation.browser='tab_not_open',
    input=>input.observation.url='https://chatgpt.com/c/6acfca8f-34cc-83eb-aaa9-fbd1301247d4',
    input=>input.observation.turnState='unknown',
  ]) {
    const input=fixture();change(input);
    const result=previewSashaiContinuation(input);
    assertNoExecution(result);assert.equal(result.action,'wait_for_observation');assert.equal(result.prompt,null);
  }
});
