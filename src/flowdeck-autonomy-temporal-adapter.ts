import {isDeepStrictEqual} from 'node:util';
import {Client, WorkflowNotFoundError} from '@temporalio/client';
import {
 defaultPayloadConverter,
 WorkflowIdConflictPolicy,
 WorkflowIdReusePolicy,
 type PayloadConverter,
} from '@temporalio/common';
import type {ControllerEffects} from './flowdeck-autonomy-controller.js';
import type {AutonomousLifecycleInputV1} from './flowdeck-autonomous-workflow.js';
import {autonomyPolicyDigest, type AutonomyPolicyV1} from './flowdeck-autonomy-policy.js';

type IdentityEffects=Pick<ControllerEffects,'checkExisting'|'startExistingIdentity'>;
type TemporalDescription={workflowId:string;runId:string;type:string;taskQueue:string;status:{name:string}};
type IdentityClient={workflow:{
 getHandle(workflowId:string,runId?:string):{
  describe():Promise<TemporalDescription>;
  fetchHistory():Promise<Awaited<ReturnType<ReturnType<Client['workflow']['getHandle']>['fetchHistory']>>>;
 };
 start(workflowType:string,options:Parameters<Client['workflow']['start']>[1]):Promise<{firstExecutionRunId?:string}>;
}};
const WORKFLOW_TYPE='flowdeckAutonomousLifecycleV1';
const identifier=/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$/;
const inputKeys=['schema','projectId','campaignRunId','policy','policyDigest'].sort();
const policyKeys=['schema','mode','interactive','environment','profile','taskSource','projectId','projectUrl',
 'ownerId','deviceId','worktree','allowedRoot','planSha256','enabledTaskIds','instructionHashes','campaignId',
 'validFrom','validUntil','maxTasksPerRun','maxContinuationsPerTask','p2Continuations','maxSubmissionsPerRun',
 'maxCampaignRuns','maxCampaignSubmissions','maxRunDurationMinutes','automaticSuccessfulCloseout',
 'uncertainSend','identityConflict','reviewRequiredBeforeDependentTask'].sort();
class SelectedExecutionNotFound extends Error{}

function snapshotInput(value:AutonomousLifecycleInputV1):AutonomousLifecycleInputV1{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid autonomous lifecycle input');
 const input=JSON.parse(JSON.stringify(value)) as unknown;
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('invalid autonomous lifecycle input');
 const record=input as Record<string,unknown>;
 if(JSON.stringify(Object.keys(record).sort())!==JSON.stringify(inputKeys)||
  record.schema!=='flowdeck.autonomous-input/v1'||
  typeof record.projectId!=='string'||!identifier.test(record.projectId)||
  typeof record.campaignRunId!=='string'||!identifier.test(record.campaignRunId)||
  typeof record.policyDigest!=='string'||!/^([a-f0-9]{64})$/.test(record.policyDigest)||
  !record.policy||typeof record.policy!=='object'||Array.isArray(record.policy))
  throw Error('invalid autonomous lifecycle input');
 const policy=record.policy as Record<string,unknown>;
 if(JSON.stringify(Object.keys(policy).sort())!==JSON.stringify(policyKeys)||
  policy.schema!=='flowdeck.autonomy-policy/v1'||policy.mode!=='automatic-initial-send'||
  policy.interactive!==false||!['local-live','synthetic'].includes(String(policy.environment))||
  policy.profile!=='helium-profile-4'||policy.taskSource!=='approved-active-plan'||
  policy.projectId!==record.projectId||
  typeof policy.campaignId!=='string'||!identifier.test(policy.campaignId)||
  typeof policy.maxRunDurationMinutes!=='number'||!Number.isSafeInteger(policy.maxRunDurationMinutes)||
  policy.maxRunDurationMinutes<1||policy.maxRunDurationMinutes>60)
  throw Error('invalid autonomous lifecycle policy binding');
 if(autonomyPolicyDigest(policy as unknown as AutonomyPolicyV1)!==record.policyDigest)
  throw Error('validated lifecycle input and policy digest disagree');
 return input as AutonomousLifecycleInputV1;
}

/** Implements only the controller's two Temporal identity effects. */
export function createTemporalIdentityEffects(
 client:Client|IdentityClient,
 expected:{workflowId:string;taskQueue:string;input:AutonomousLifecycleInputV1},
 options:{payloadConverter?:PayloadConverter}={},
):IdentityEffects{
 const workflowId=expected.workflowId,taskQueue=expected.taskQueue;
 if(typeof workflowId!=='string'||!identifier.test(workflowId)||
  typeof taskQueue!=='string'||!identifier.test(taskQueue))throw Error('invalid Temporal workflow or task queue identity');
 const input=snapshotInput(expected.input);
 const policyDigest=input.policyDigest;
 const converter=options.payloadConverter??defaultPayloadConverter;
 let startAttempted=false;

 async function inspect(runId:string|null){
  const lookup=client.workflow.getHandle(workflowId,runId??undefined);
  let description:TemporalDescription;
  try{description=await lookup.describe();}catch(error){
   if(error instanceof WorkflowNotFoundError)throw new SelectedExecutionNotFound();
   throw error;
  }
  if(description.workflowId!==workflowId||!description.runId||
   (runId!==null&&description.runId!==runId)||description.type!==WORKFLOW_TYPE)
   throw Error('Temporal execution identity mismatch');
  const bound=client.workflow.getHandle(workflowId,description.runId);
  const history=await bound.fetchHistory();
  const starts=(history.events??[]).filter(event=>event.workflowExecutionStartedEventAttributes!==null&&
   event.workflowExecutionStartedEventAttributes!==undefined);
  if(starts.length!==1)throw Error('one exact Temporal start event required');
  const start=starts[0].workflowExecutionStartedEventAttributes;
  const payloads=start?.input?.payloads??[];
  if(start?.workflowType?.name!==WORKFLOW_TYPE||start.taskQueue?.name!==taskQueue||payloads.length!==1)
   throw Error('Temporal workflow type, queue or input arity mismatch');
  let recorded:unknown;
  try{recorded=converter.fromPayload(payloads[0]);}catch{throw Error('Temporal start input could not be decoded');}
  if(!isDeepStrictEqual(recorded,input))throw Error('Temporal start input differs from pinned lifecycle input');
  return{runId:description.runId,status:description.status.name};
 }

 return{
  async checkExisting(id){
   if(id.workflowId!==workflowId)return{status:'unknown',runId:null,policyDigest:null};
   let found:Awaited<ReturnType<typeof inspect>>;
   try{found=await inspect(id.runId);}catch(error){
    if(id.runId===null&&error instanceof SelectedExecutionNotFound)
     return{status:'missing',runId:null,policyDigest:null};
    return{status:'unknown',runId:null,policyDigest:null};
   }
   const status=found.status==='RUNNING'?'running':found.status==='COMPLETED'?'completed':
    found.status==='CANCELLED'?'cancelled':'unknown';
   return status==='unknown'?{status,runId:null,policyDigest:null}:{status,runId:found.runId,policyDigest};
  },
  async startExistingIdentity(id){
   if(id.workflowId!==workflowId||id.policyDigest!==policyDigest)
    throw Error('Start request differs from pinned identity');
   if(startAttempted)throw Error('Temporal Start already attempted; reconcile the exact workflow ID');
   startAttempted=true;
   const handle=await client.workflow.start(WORKFLOW_TYPE,{
    workflowId,taskQueue,args:[input],
    workflowIdReusePolicy:WorkflowIdReusePolicy.REJECT_DUPLICATE,
    workflowIdConflictPolicy:WorkflowIdConflictPolicy.FAIL,
    workflowExecutionTimeout:`${input.policy.maxRunDurationMinutes} minutes`,
    retry:{maximumAttempts:1},
   });
   const runId=handle.firstExecutionRunId;
   if(!runId)throw Error('Temporal did not return a server-assigned execution run ID');
   await inspect(runId);
   return{runId,policyDigest};
  },
 };
}
