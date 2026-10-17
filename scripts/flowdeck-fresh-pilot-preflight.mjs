#!/usr/bin/env node
/** Read-only preparation gate. A proposal is never an authorization or enrollment.
 * No browser/Temporal/plugin imports, no filesystem mutations and no process launch.
 */
import {readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pathToFileURL} from 'node:url';
import {inspectAttemptScope} from './flowdeck-attempt-scope.mjs';
import {createHash} from 'node:crypto';
import {validatePilotProject,initialPilotSendUsage,reservePilotSend} from '../dist/flowdeck-pilot-budget.js';
const PROJECT='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project';
const usage='Usage: node scripts/flowdeck-fresh-pilot-preflight.mjs --proposal /absolute/proposal.json [--root /absolute/repository]';
const simple=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(x);
export function inspectProposal(proposal,enrollments=[]){
 const blockers=[];
 const add=(code,explanation)=>blockers.push({code,explanation});
 if(proposal?.schema!=='flowdeck.pilot-proposal/v1'||proposal?.state!=='prepared_not_authorized'||
    proposal?.executionAuthorized!==false||proposal?.productionEnrollment!==false)
  add('invalid_proposal_contract','Only an explicitly unapproved proposal is accepted');
 if(!simple(proposal?.id)||!simple(proposal?.initialTaskId))add('invalid_pilot_identity','Fresh pilot/task IDs required');
 if(proposal?.projectUrl!==PROJECT||proposal?.browserProfile!=='Helium Profile 4'||proposal?.connector!=='Probe RemoteMCP2')
  add('invalid_destination','Exact Sashai project, Profile 4 and Probe RemoteMCP2 required');
 if(typeof proposal?.proposedWorktree!=='string'||!proposal.proposedWorktree.startsWith('/'))
  add('worktree_unspecified','An absolute proposed worktree must be recorded');
 if(!Array.isArray(proposal?.tasks)||proposal.tasks.length!==2||
    new Set(proposal.tasks.map(t=>t.id)).size!==2||
    !proposal.tasks.some(t=>t.id===proposal.initialTaskId)||
    proposal.tasks.some(t=>!simple(t?.id)||typeof t?.title!=='string'||!t.title.trim()||
       !t.independent||t.requiresReviewBeforeNext!==false||
       typeof t.instruction!=='string'||!t.instruction.includes('Probe RemoteMCP2')||
       !t.instruction.includes('FLOWDECK_STATUS: implementation_done')||
       !t.instruction.includes('FLOWDECK_STATUS: needs_attention')||
       !t.instruction.includes(t.id)||!t.instruction.includes(proposal.proposedWorktree)))
  add('invalid_two_task_contract','Two unique independent task instructions with exact markers and worktree are required');
 if(proposal?.maxPlannedOwnerSubmissions!==1||proposal?.maxPlannedAutomatedContinuations!==1||
    proposal?.maxPlannedAutomatedNextTaskSubmissions!==1)
  add('invalid_send_budget','Pilot must be bounded to owner P1, one continuation and one next-task send');
 // This is an independent pure-policy check, not proof that a live worker is
 // deployed. Workflow wiring is covered by exact-revision regression/replay.
 let policyVerified=false;
 try{
  if(proposal?.attendedPilotBudget&&Array.isArray(proposal?.tasks)){
   const policy=proposal.attendedPilotBudget;
   const valid=validatePilotProject({id:proposal.id,initialTaskId:proposal.initialTaskId,
    tasks:proposal.tasks,attendedPilotBudget:policy});
   const first=reservePilotSend(policy,initialPilotSendUsage(),{kind:'continue',taskId:policy.initialTaskId});
   const duplicate=first.allowed?reservePilotSend(policy,first.usage,{kind:'continue',taskId:policy.initialTaskId}):null;
   const next=first.allowed?reservePilotSend(policy,first.usage,
    {kind:'next',previousTaskId:policy.initialTaskId,taskId:policy.nextTaskId}):null;
   const p2=reservePilotSend(policy,initialPilotSendUsage(),{kind:'continue',taskId:policy.nextTaskId});
   policyVerified=valid&&first.allowed&&duplicate?.allowed===false&&next?.allowed===true&&p2.allowed===false;
  }
 }catch{/* Malformed source policy cannot be a permission receipt. */}
 if(!policyVerified||proposal?.budgetEnforcedByWorkflow!==true)
  add('workflow_budget_not_enforced','Compiled pilot policy is missing/invalid; tests and exact build evidence also required');
 if(enrollments.some(p=>p?.id===proposal?.id||
    p?.tasks?.some(t=>proposal?.tasks?.some(t2=>t.id===t2.id||t.title===t2.title))))
  add('reused_pilot_identity','Pilot ID/task ID/title already exists in production enrollment');
 // A proposal cannot confer external owner approval, even if someone edits its JSON flags.
 add('owner_approval_missing','No separately audited owner approval is supplied by this proposal');
 return blockers;
}
export async function inspectFreshPilot({root,proposalPath}){
 const parsed=JSON.parse(await readFile(proposalPath,'utf8'));
 const enrolled=JSON.parse(await readFile(join(root,'.state/flowdeck-supervisor/projects.json'),'utf8')).projects;
 const blockers=inspectProposal(parsed,enrolled);
 const exists=await stat(parsed.proposedWorktree).then(s=>s.isDirectory()).catch(e=>{
  if(e.code==='ENOENT')return false;throw e;
 });
 if(!exists)blockers.push({code:'worktree_not_provisioned',explanation:'Proposed disposable worktree is not created/approved'});
 const enrolledDevice=enrolled.find(p=>p.projectUrl===PROJECT)?.deviceId;
 if(enrolledDevice){
  const scope=await inspectAttemptScope(root,{deviceId:enrolledDevice});
  if(scope.occupied)blockers.push({code:'browser_owner_claim_occupied',explanation:'Existing single-host device/profile claim must be reconciled'});
 }
 const proposalSha256=createHash('sha256').update(await readFile(proposalPath)).digest('hex');
 return {check:'flowdeck.fresh-pilot.preflight/v1',mode:'read-only',pilotId:parsed.id,
  proposalSha256,readyForExecution:false,executionAuthorized:false,
  taskCount:parsed.tasks?.length??null,proposedWorktree:parsed.proposedWorktree,
  blockers,writes:false};
}
async function main(args){
 if(args.includes('--help')){console.log(usage);return;}
 const flags={};
 for(let i=0;i<args.length;i+=2){
  const k=args[i],v=args[i+1];
  if(!['--proposal','--root'].includes(k)||!v||flags[k]||!v.startsWith('/')||args.length%2)
   throw Error(usage);
  flags[k]=v;
 }
 if(!flags['--proposal'])throw Error(usage);
 const root=resolve(flags['--root']??fileURLToPath(new URL('..',import.meta.url)));
 const result=await inspectFreshPilot({root,proposalPath:resolve(flags['--proposal'])});
 console.log(JSON.stringify(result,null,2));
 if(result.blockers.length)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 await main(process.argv.slice(2));
