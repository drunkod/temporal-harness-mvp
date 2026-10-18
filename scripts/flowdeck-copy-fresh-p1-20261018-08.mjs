#!/usr/bin/env node
/** Copy only; validates the exact fresh live P1 waiting state before touching clipboard. */
import{spawnSync}from'node:child_process';
import{Connection,Client}from'@temporalio/client';
import{loadSupervisorProject}from'../dist/flowdeck-projects.js';
import{inspectSashaiTaskSource}from'../dist/sashai-task-source.js';
import{verifyPreparedSurface}from'./flowdeck-prepare-manual-start.mjs';
const id='sashai-fresh-attended-20261018-08',workflowId='flowdeck-supervisor-'+id;
const taskId='sashai-fresh-attended-p1-20261018-08';
const fail=msg=>{throw Error('Clipboard blocked: '+msg)};
let c;
try{
 const p=await loadSupervisorProject(id);
 if(p.initialTaskId!==taskId||p.tasks.length!==2)fail('wrong task enrollment');
 const gate=await inspectSashaiTaskSource(p.repo);
 if(gate.status!=='approved_plan_has_pending_tasks'||gate.pendingCount!==2)fail('task plan not ready');
 c=await Connection.connect({address:'127.0.0.1:7233',connectTimeout:'5 seconds'});
 const w=new Client({connection:c,namespace:'default'}).workflow.getHandle(workflowId);
 const d=await w.describe();
 if(d.status.name!=='RUNNING')fail('Temporal workflow not running');
 const s=await w.query('flowdeckSupervisorStatus');
 if(s.projectId!==id||s.taskId!==taskId||s.phase!=='waiting_for_manual_start'||
   s.status!=='waiting'||s.lastEvent!==null||s.workId!==null||s.chatUrl!==null||
   s.pilotBudget?.usage?.totalAutomatedSubmissions!==0)
  fail('manual-start state changed; do not send');
 const t=p.tasks.find(x=>x.id===taskId);
 if(!t||!t.instruction.startsWith('Task ID: '+taskId)||!t.instruction.includes(p.repo))
  fail('P1 instruction mismatch');
 await verifyPreparedSurface(p);
 const clip=spawnSync('/usr/bin/pbcopy',[],{input:t.instruction,encoding:'utf8',timeout:5000});
 if(clip.error)throw clip.error;
 if(clip.status!==0)fail('pbcopy failed');
 console.log('APPROVED FRESH P1 COPIED; nothing submitted. Paste ONLY in the verified PREPARED EMPTY TAB in the correct Sashai Project with Probe RemoteMCP2 and click Send ONCE. Do not retry if uncertain.');
}catch(e){console.error(String(e?.message??e));process.exitCode=2}
finally{await c?.close()}
