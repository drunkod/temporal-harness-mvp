import { createAutonomyController } from '../../../dist/flowdeck-autonomy-controller.js';
import { autonomyPolicyDigest } from '../../../dist/flowdeck-autonomy-policy.js';

const [manifestPath, ownerRoot] = process.argv.slice(2);
const policy = { schema:'flowdeck.autonomy-policy/v1', campaignId:'campaign-fixture-001', ownerId:'owner-fixture-001', deviceId:'device-fixture-001', worktree:'/tmp/root', allowedRoot:'/tmp' };
const digest = autonomyPolicyDigest(policy);
const effects = {
 authorize:async()=>({allowed:true,policyDigest:digest}),
 checkExisting:async()=>({status:'missing',runId:null,policyDigest:null}),
 startExistingIdentity:async()=>({runId:'run-fixture-001',policyDigest:digest}),
 ensureFollower:async()=>{}, followerStatus:async()=> 'running', stopFollower:async()=>{},
 ensureWorker:async()=>{}, workerStatus:async()=> 'running', stopWorker:async()=>{},
 deliverEvent:async()=>{}, status:async()=>({}),
 verify:async()=>({terminal:false,status:'blocked',reason:'still_running'}), cancelWorkflow:async()=>{},
 assertNoOutstandingEffects:async()=>{}, finalizeOrResumeCloseout:async()=>({receiptPath:'/tmp/unused',receiptSha256:digest}), verifyCloseoutReceipt:async()=>{},
};
const config={schema:'flowdeck.autonomy-controller-config/v1',policy,workflowId:'workflow-fixture-001',runId:null,ownerScope:{ownerId:policy.ownerId,deviceId:policy.deviceId,worktree:policy.worktree},follower:{schema:'flowdeck.event-follower/v1',source:'fixture-events',ownerId:policy.ownerId,deviceId:policy.deviceId,cursorPath:'/tmp/events.cursor'},deadlineAt:'2030-01-01T00:00:00Z',stopGraceMs:100};
const controller=createAutonomyController(manifestPath,effects,ownerRoot);
await controller.execute(config);
process.exit(0);
