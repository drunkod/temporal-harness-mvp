#!/usr/bin/env node
/** Read-only bound v2 replay test. Never sends browser messages. */
import {readFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{resolve,join}from'node:path';
import{Connection,Client}from'@temporalio/client';
const root=resolve(import.meta.dirname,'..');
const body=await readFile(join(root,'docs','SASHAI-ARCHITECTURE-REVIEW-TASK.md'));
const contractSha256=createHash('sha256').update(body).digest('hex');
const workflowId='sashai-report-binding-v2-'+contractSha256.slice(0,20);
const action=process.argv[2]||'status';
const c=await Connection.connect({address:process.env.TEMPORAL_ADDRESS||'127.0.0.1:7233'});
try{
 const cli=new Client({connection:c,namespace:'default'});
 const h=cli.workflow.getHandle(workflowId);
 if(action==='start'){
  if(await h.describe().catch(()=>null))throw Error('Bound review proof already exists; no duplicate starts');
  const w=await cli.workflow.start('sashaiReportLifecycle',{workflowId,
   taskQueue:'oracle-sashai-report-review',workflowExecutionTimeout:'30 minutes',
   args:[{taskId:'sashai-architecture-report-2026-10-15',contractSha256,pauseBeforeReverification:true}]});
  console.log(JSON.stringify({started:true,workflowId:w.workflowId,readOnly:true}));
 }else if(action==='resume'){
  const d=await h.describe();if(d.status.name!=='RUNNING')throw Error('Not running');
  await h.signal('resumeReportReview');
  console.log(JSON.stringify({signaled:true,workflowId}));
 }else if(action==='status'){
  const d=await h.describe().catch(()=>null);
  if(!d){console.log(JSON.stringify({exists:false,workflowId}));}
  else{
   const state=d.status.name==='RUNNING'?await h.query('sashaiReportLifecycleStatus'):await h.result();
   console.log(JSON.stringify({exists:true,workflowId,status:d.status.name,state},null,2));
  }
 }else throw Error('Commands: start|resume|status');
}finally{await c.close();}
