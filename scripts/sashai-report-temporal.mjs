#!/usr/bin/env node
/** Fixed-scope Temporal review workflow: reads an existing report, sends no ChatGPT messages. */
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Connection,Client} from '@temporalio/client';
import {NativeConnection,Worker} from '@temporalio/worker';
import * as acts from '../dist/sashai-report-temporal-activities.js';

const base=resolve(import.meta.dirname,'..');
const taskId='sashai-architecture-report-2026-10-15';
const queue='oracle-sashai-report-review';
const action=process.argv[2]||'status';
const contract=await readFile(join(base,'docs','SASHAI-ARCHITECTURE-REVIEW-TASK.md'),'utf8');
const contractSha256=createHash('sha256').update(contract).digest('hex');
const workflowId='sashai-report-review-'+contractSha256.slice(0,20);
const address=process.env.TEMPORAL_ADDRESS||'127.0.0.1:7233';
if(action==='worker'){
 const c=await NativeConnection.connect({address});
 const w=await Worker.create({connection:c,namespace:process.env.TEMPORAL_NAMESPACE||'default',
   taskQueue:queue,workflowsPath:join(base,'dist','sashai-report-temporal.js'),
   activities:acts,maxConcurrentActivityTaskExecutions:1,maxConcurrentWorkflowTaskExecutions:2});
 console.log('READY report-only worker queue='+queue+' workflowId='+workflowId);
 await w.run();
}else{
 const c=await Connection.connect({address});
 const client=new Client({connection:c,namespace:process.env.TEMPORAL_NAMESPACE||'default'});
 const handle=client.workflow.getHandle(workflowId);
 if(action==='start'){
  const existing=await handle.describe().catch(()=>null);
  if(existing)throw Error('Report workflow already exists; reconcile status rather than starting another');
  const h=await client.workflow.start('sashaiReportLifecycle',{
   workflowId,taskQueue:queue,workflowExecutionTimeout:'30 minutes',
   args:[{taskId,contractSha256,pauseBeforeReverification:true}]});
  console.log(JSON.stringify({started:true,workflowId:h.workflowId,taskQueue:queue,
   scope:'read_only_adoption',chatgptSends:0},null,2));
 }else if(action==='resume'){
  const d=await handle.describe();
  if(d.status.name!=='RUNNING')throw Error('Workflow not running; refuse resume');
  await handle.signal('resumeReportReview');
  console.log(JSON.stringify({signaled:true,workflowId,taskQueue:queue},null,2));
 }else if(action==='status'){
  const d=await handle.describe().catch(()=>null);
  if(!d){console.log(JSON.stringify({exists:false,workflowId,taskQueue:queue}));}
  else{
   const live=d.status.name==='RUNNING';
   let state=null;
   try{state=live?await handle.query('sashaiReportLifecycleStatus'):await handle.result();}
   catch(e){state={unavailable:String(e).slice(0,150)};}
   console.log(JSON.stringify({exists:true,workflowId,taskQueue:queue,
    temporalStatus:d.status.name,state},null,2));
  }
 }else throw Error('Usage: sashai-report-temporal.mjs worker|start|resume|status');
 await c.close();
}
