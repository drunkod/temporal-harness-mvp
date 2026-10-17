#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {readRecoveryResumeRequest,claimRecoveryRelease} from '../dist/flowdeck-send-recovery.js';
import {resolve,isAbsolute} from 'node:path';
import {Connection,Client,WorkflowIdReusePolicy,WorkflowIdConflictPolicy} from '@temporalio/client';
import {createSupervisorProjectLoader} from '../dist/flowdeck-projects.js';
import {assertNoRunningFlowdeck,claimAttemptScope,inspectAttemptScope,assertAttemptScopeOwner} from './flowdeck-attempt-scope.mjs';

const root=resolve(import.meta.dirname,'..');
const args=process.argv.slice(2),action=args[0]||'preview';
const usage='Usage: node scripts/flowdeck-resume-send.mjs preview|start|release --request /absolute/resume-AUTH.json --attempt NAME [--approve-start | --run-id ID --approve-send]\nstart waits for follower readiness; release permits the one authorized B send. Never reruns A.';
if(args.includes('--help')){console.log(usage);process.exit(0);}
const allowed=new Set(['--request','--attempt','--run-id','--approve-start','--approve-send']);
const flags={};
for(let i=1;i<args.length;i++){
 const key=args[i];if(!allowed.has(key)||flags[key]!==undefined)throw Error(usage);
 if(key.startsWith('--approve-'))flags[key]=true;
 else{if(!args[i+1]||args[i+1].startsWith('--'))throw Error(usage);flags[key]=args[++i];}
}
if(!['preview','start','release'].includes(action)||!isAbsolute(flags['--request']||'')||!/^[-a-zA-Z0-9_]{1,80}$/.test(flags['--attempt']||''))throw Error(usage);
const requested=JSON.parse(await readFile(flags['--request'],'utf8'));
const project=await createSupervisorProjectLoader({base:root})(requested.projectId);
const input=await readRecoveryResumeRequest(root,flags['--request'],project);
const workflowId=`flowdeck-supervisor-${project.id}--${flags['--attempt']}`;
if(action==='preview'){console.log(JSON.stringify({workflowId,workflowType:'flowdeckRecoverSend',projectId:project.id,resumeTaskId:input.taskId,completedTaskId:input.completedTaskId,physicalSends:0,releaseRequired:true},null,2));process.exit(0);}
if(action==='start'&&!flags['--approve-start']||action==='release'&&(!flags['--approve-send']||!flags['--run-id']))throw Error('Explicit approval flag and release run ID required');
const connection=await Connection.connect({address:process.env.TEMPORAL_ADDRESS||'127.0.0.1:7233',connectTimeout:'5s'});
try{
 const client=new Client({connection,namespace:process.env.TEMPORAL_NAMESPACE||'default'});
 if(action==='start'){
  if((await inspectAttemptScope(root,project)).occupied)throw Error('Browser-owner scope already claimed; audited reconciliation required');
  await assertNoRunningFlowdeck(client.workflow.list.bind(client.workflow));
  await claimAttemptScope(root,{projectId:project.id,ownerId:project.ownerId,deviceId:project.deviceId,workflowId});
  const handle=await client.workflow.start('flowdeckRecoverSend',{workflowId,taskQueue:'flowdeck-supervisor',args:[input],workflowExecutionTimeout:'4 hours',retry:{maximumAttempts:1},workflowIdReusePolicy:WorkflowIdReusePolicy.REJECT_DUPLICATE,workflowIdConflictPolicy:WorkflowIdConflictPolicy.FAIL});
  console.log(JSON.stringify({workflowId,runId:handle.firstExecutionRunId,next:'Start the attempt-scoped follower; only after its ready message use release with this run ID. No prompt has been submitted by this command.'},null,2));
 }else{
  await assertAttemptScopeOwner(root,{projectId:project.id,ownerId:project.ownerId,deviceId:project.deviceId,workflowId});
  const handle=client.workflow.getHandle(workflowId,flags['--run-id']);
  const d=await handle.describe();const state=await handle.query('flowdeckSupervisorStatus');
  if(d.status.name!=='RUNNING'||d.runId!==flags['--run-id']||state.projectId!==project.id||state.taskId!==input.taskId||state.phase!=='waiting_for_manual_start')throw Error('Exact recovery execution is not waiting for readiness release');
  await claimRecoveryRelease(root,workflowId,d.runId,input.authorization.authorizationId);
  // An uncertain signal leaves this one-use release intent sealed for history reconciliation.
  await handle.signal('supervisorRecoveryReady');
  console.log(JSON.stringify({workflowId,runId:d.runId,released:true,warning:'Authorized recovery may now submit B once; do not manually submit it.'},null,2));
 }
}finally{await connection.close();}
