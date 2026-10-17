#!/usr/bin/env node
/** Explicit operator entry point. Status/help never start workers or send browser messages. */
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Connection,Client,WorkflowIdReusePolicy,WorkflowIdConflictPolicy,WorkflowNotFoundError} from '@temporalio/client';
import {assertNoRunningFlowdeck,claimAttemptScope,inspectAttemptScope} from './flowdeck-attempt-scope.mjs';
const root=resolve(import.meta.dirname,'..');
const argv=process.argv.slice(2), action=argv[0]||'status', projectId=argv[1], attemptFlag=argv[2], attempt=argv[3];
const queue='flowdeck-supervisor';
const usage='Usage: node scripts/flowdeck-supervisor.mjs status | worker | start PROJECT_ID [--attempt NAME] | workflow-status PROJECT_ID [--attempt NAME]';
const validPart=value=>typeof value==='string'&&/^[-a-zA-Z0-9_]{1,80}$/.test(value);
const workflowIdFor=(project, name)=>'flowdeck-supervisor-'+project+(name===undefined?'':'--'+name);
const print=x=>console.log(JSON.stringify(x,null,2));
async function main(){
 if(action==='help'||action==='--help'){console.log(usage);return;}
 if(action==='status'){
  try{print(JSON.parse(await readFile(join(root,'.state/flowdeck-supervisor/status.json'),'utf8')));}
  catch(e){if(e.code!=='ENOENT')throw e;print({status:'not_configured',dispatchStarted:false,
   nextAction:'Enroll owner/device/project and approved active-plan tasks. See docs/FLOWDECK-SUPERVISOR-RUNBOOK.md.'});}
  return;
 }
 if(action==='worker'){
  process.chdir(root);
  const {Worker,NativeConnection}=await import('@temporalio/worker');
  const module=await import('../dist/flowdeck-supervisor-activities.js');
  const names=['loadSupervisorProject','adoptStartedWork','observeWorkResult','sendContinuationOnce','startNextTaskOnce','publishSupervisorState','reconcileSubmittedTurn','recoverPreSendOnce'];
  const activities=Object.fromEntries(names.map(name=>[name,module[name]]));
  const connection=await NativeConnection.connect({address:process.env.TEMPORAL_ADDRESS||'127.0.0.1:7233'});
  try{const worker=await Worker.create({connection,namespace:process.env.TEMPORAL_NAMESPACE||'default',
   taskQueue:queue,workflowsPath:join(root,'dist/flowdeck-supervisor-workflow.js'),activities,
   maxConcurrentActivityTaskExecutions:1,maxConcurrentWorkflowTaskExecutions:2});
   console.log('READY: minimal event-led Flowdeck supervisor; no workflow automatically started.');
   await worker.run();
  }finally{await connection.close();}
  return;
 }
 if(!['start','workflow-status'].includes(action)||!validPart(projectId)||projectId.includes('--')
    || argv.length>4 || (attemptFlag!==undefined && (attemptFlag!=='--attempt'||!validPart(attempt))))throw Error(usage);
 process.chdir(root);
 // Resolve authoritative task source BEFORE any Temporal start.
 const project=action==='start'?await (await import('../dist/flowdeck-projects.js')).loadSupervisorProject(projectId):null;
 const connection=await Connection.connect({address:process.env.TEMPORAL_ADDRESS||'127.0.0.1:7233'});
 try{
  const client=new Client({connection,namespace:process.env.TEMPORAL_NAMESPACE||'default'});
  const id=workflowIdFor(projectId, attempt),handle=client.workflow.getHandle(id);
  let existing;
  try{existing=await handle.describe();}catch(e){if(!(e instanceof WorkflowNotFoundError))throw e;}
  if(action==='start'){
   if(existing)throw Error('Workflow already exists; inspect it rather than creating another sender.');
   if((await inspectAttemptScope(root,project)).occupied)throw Error('Browser-owner scope already claimed; audited reconciliation required');
   await assertNoRunningFlowdeck(client.workflow.list.bind(client.workflow));
   await claimAttemptScope(root,{projectId,ownerId:project.ownerId,deviceId:project.deviceId,workflowId:id});
   const started=await client.workflow.start('flowdeckSupervisor',{workflowId:id,taskQueue:queue,args:[projectId],
    workflowExecutionTimeout:'4 hours',retry:{maximumAttempts:1},
    workflowIdReusePolicy:WorkflowIdReusePolicy.REJECT_DUPLICATE,workflowIdConflictPolicy:WorkflowIdConflictPolicy.FAIL});
   print({workflowId:started.workflowId,taskQueue:queue,eventSignal:'supervisorWorkEvent',status:'waiting for manual task start'});
  }else if(!existing)print({exists:false,workflowId:id});
  else print({workflowId:id,temporal:existing.status.name,state:existing.status.name==='RUNNING'?
   await handle.query('flowdeckSupervisorStatus'):existing.status.name==='COMPLETED'?await handle.result():null});
 }finally{await connection.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
