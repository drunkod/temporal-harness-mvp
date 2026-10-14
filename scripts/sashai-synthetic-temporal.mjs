#!/usr/bin/env node
/** Disposable-only Temporal fixture proof. No browser or user repository dispatch. */
import {join,resolve} from 'node:path';
import {Connection,Client} from '@temporalio/client';
import {NativeConnection,Worker} from '@temporalio/worker';
import * as acts from '../dist/sashai-synthetic-report-activities.js';

const root=resolve(import.meta.dirname,'..');
const queue='oracle-sashai-synthetic-report';
const address=process.env.TEMPORAL_ADDRESS||'127.0.0.1:7233';
const action=process.argv[2]||'status';
const mode=process.argv[3]||'repair';
if(mode!=='repair'&&mode!=='uncertain')throw Error('Only fixed synthetic report fixtures allowed');
const id='sashai-synthetic-temporal-v1-'+mode;
if(action==='worker'){
 const c=await NativeConnection.connect({address});
 const w=await Worker.create({connection:c,namespace:process.env.TEMPORAL_NAMESPACE||'default',
  taskQueue:queue,workflowsPath:join(root,'dist','sashai-synthetic-report-workflow.js'),
  activities:acts,maxConcurrentActivityTaskExecutions:1,maxConcurrentWorkflowTaskExecutions:2});
 console.log('READY: synthetic-only Temporal worker '+queue);
 await w.run();
}else{
 const c=await Connection.connect({address});
 const client=new Client({connection:c,namespace:process.env.TEMPORAL_NAMESPACE||'default'});
 const h=client.workflow.getHandle(id);
 if(action==='start'){
  if(await h.describe().catch(()=>null))throw Error('Fixture workflow already exists; refuse duplicate start');
  const w=await client.workflow.start('syntheticReportLifecycle',{
   workflowId:id,taskQueue:queue,workflowExecutionTimeout:'30 minutes',
   args:[mode,mode==='repair']});
  console.log(JSON.stringify({started:true,workflowId:w.workflowId,mode,queue,
   realBrowserSends:0,productDispatchPermitted:false},null,2));
 }else if(action==='resume'){
  const d=await h.describe();
  if(d.status.name!=='RUNNING')throw Error('Fixture no longer running');
  await h.signal('resumeSyntheticReport');
  console.log(JSON.stringify({signaled:true,workflowId:id},null,2));
 }else if(action==='status'){
  const d=await h.describe().catch(()=>null);
  if(!d){console.log(JSON.stringify({exists:false,workflowId:id},null,2));}
  else{
   const live=d.status.name==='RUNNING';
   const state=live?await h.query('syntheticReportStatus'):await h.result();
   console.log(JSON.stringify({exists:true,workflowId:id,temporalStatus:d.status.name,state},null,2));
  }
 }else throw Error('Usage: sashai-synthetic-temporal.mjs worker|start|resume|status [repair|uncertain]');
 await c.close();
}
