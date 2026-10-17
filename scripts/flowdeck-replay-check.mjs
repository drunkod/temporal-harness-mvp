#!/usr/bin/env node
/**
 * Read-only exact-run Temporal history replay. This script has no workflow
 * starter, activity registry, production task-queue connection or write path.
 * Histories stay in memory and may contain private task content.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Connection,Client} from '@temporalio/client';
import {Worker} from '@temporalio/worker';

const usage = 'Usage: node scripts/flowdeck-replay-check.mjs --address HOST:PORT --namespace NAME --workflow-id EXACT_ID --run-id EXACT_UUID [--deadline-ms 90000]';
const argv=process.argv.slice(2);
if(argv.includes('--help')){console.log(usage);process.exit(0);}
const allowed=new Set(['--address','--namespace','--workflow-id','--run-id','--deadline-ms']);
if(argv.length%2!==0)throw Error(usage);
const flags={};
for(let i=0;i<argv.length;i+=2){
  const key=argv[i],value=argv[i+1];
  if(!allowed.has(key)||flags[key]||!value||value.startsWith('--'))throw Error(usage);
  flags[key]=value;
}
const address=flags['--address'],namespace=flags['--namespace'],workflowId=flags['--workflow-id'],runId=flags['--run-id'];
if(!address||!namespace||!workflowId||!runId||!/^[0-9a-f-]{36}$/i.test(runId))throw Error(usage);
const deadlineMs=Number(flags['--deadline-ms']??90000);
if(!Number.isSafeInteger(deadlineMs)||deadlineMs<10000||deadlineMs>180000)throw Error('Replay watchdog must be between 10000 and 180000 ms');
const workflowsPath=fileURLToPath(new URL('../dist/flowdeck-supervisor-workflow.js',import.meta.url));
const workflowSha256=createHash('sha256').update(await readFile(workflowsPath)).digest('hex');
let connection;
const watchdog=setTimeout(()=>{
  console.error(JSON.stringify({ok:false,phase:'watchdog',workflowId,runId,deadlineMs,workflowSha256}));
  process.exit(124);
},deadlineMs);
try{
  connection=await Connection.connect({address,connectTimeout:'8 seconds'});
  const client=new Client({connection,namespace});
  const handle=client.workflow.getHandle(workflowId,runId);
  const described=await handle.describe();
  if(described.runId!==runId)throw Error('Temporal described a different exact run ID');
  if(!['flowdeckSupervisor','flowdeckRecoverSend'].includes(described.type))
    throw Error('The exact execution is not a Flowdeck supervisor workflow');
  const history=await handle.fetchHistory();
  if(!Array.isArray(history.events)||history.events.length===0)throw Error('History contains no events');
  const markerEvents=history.events.filter(e=>e.markerRecordedEventAttributes?.markerName==='core_patch');
  const types=Object.fromEntries([...new Set(history.events.map(e=>e.eventType))].map(k=>[String(k),history.events.filter(e=>e.eventType===k).length]));
  await Worker.runReplayHistory({workflowsPath,shutdownGraceTime:'1 second'},history,workflowId);
  console.log(JSON.stringify({ok:true,mode:'read-only-history-replay',address,namespace,workflowId,runId,
    workflowType:described.type,temporalStatus:described.status.name,historyEventCount:history.events.length,
    patchMarkerCount:markerEvents.length,workflowSha256,historyEventTypeCounts:types,
    sideEffects:{starts:0,signals:0,activityRegistrations:0,productionTaskQueuePolls:0,browserActions:0}},null,2));
}catch(error){
  console.error(JSON.stringify({ok:false,mode:'read-only-history-replay',workflowId,runId,workflowSha256,
    errorType:error?.name||'Error',errorMessage:String(error?.message??error).slice(0,2000)},null,2));
  process.exitCode=1;
}finally{
  try{if(connection)await connection.close();}
  finally{clearTimeout(watchdog);}
}
