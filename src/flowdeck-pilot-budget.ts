/** Deterministic send reservations for the explicitly scoped two-task attended pilot.
 * Restricts workflow activity scheduling; it is NOT task approval or a send receipt.
 */
export interface PilotSendPolicy {
 schema:'flowdeck.attended-pilot-budget/v1';
 initialTaskId:string;
 nextTaskId:string;
}
export interface PilotSendUsage {
 p1Continuations:number;
 nextChatSubmissions:number;
 totalAutomatedSubmissions:number;
}
export type PilotSendRequest =
 | {kind:'continue';taskId:string}
 | {kind:'next';previousTaskId:string;taskId:string};
export type BudgetDecision =
 | {allowed:true;usage:PilotSendUsage}
 | {allowed:false;reason:string};

export const isPilotSendPolicy=(policy:unknown):policy is PilotSendPolicy=>{
 if(!policy||typeof policy!=='object')return false;
 const p=policy as Record<string,unknown>;
 return p.schema==='flowdeck.attended-pilot-budget/v1'&&
  typeof p.initialTaskId==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(p.initialTaskId)&&
  typeof p.nextTaskId==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(p.nextTaskId)&&
  p.initialTaskId!==p.nextTaskId&&Object.keys(p).every(k=>['schema','initialTaskId','nextTaskId'].includes(k));
};
export const initialPilotSendUsage=():PilotSendUsage=>({
 p1Continuations:0,nextChatSubmissions:0,totalAutomatedSubmissions:0,
});
export function reservePilotSend(policy:PilotSendPolicy,usage:PilotSendUsage,request:PilotSendRequest):BudgetDecision {
 if(!isPilotSendPolicy(policy))return {allowed:false,reason:'invalid_pilot_policy'};
 if(!usage||[usage.p1Continuations,usage.nextChatSubmissions,usage.totalAutomatedSubmissions]
   .some(n=>!Number.isSafeInteger(n)||n<0)||
   usage.p1Continuations>1||usage.nextChatSubmissions>1||
   usage.totalAutomatedSubmissions!==usage.p1Continuations+usage.nextChatSubmissions)
  return {allowed:false,reason:'invalid_pilot_usage'};
 if(!request||!['continue','next'].includes(request.kind))
  return {allowed:false,reason:'invalid_pilot_send_request'};
 if(request.kind==='continue'){
  if(request.taskId!==policy.initialTaskId)return {allowed:false,reason:'continuation_not_allowed_for_task'};
  if(usage.nextChatSubmissions!==0)return {allowed:false,reason:'pilot_already_advanced'};
  if(usage.p1Continuations>=1)return {allowed:false,reason:'p1_continuation_budget_exhausted'};
 }else{
  if(request.previousTaskId!==policy.initialTaskId||request.taskId!==policy.nextTaskId)
   return {allowed:false,reason:'next_task_outside_pilot_scope'};
  if(usage.nextChatSubmissions>=1)return {allowed:false,reason:'next_chat_budget_exhausted'};
 }
 if(usage.totalAutomatedSubmissions>=2)return {allowed:false,reason:'automated_send_budget_exhausted'};
 return {allowed:true,usage:{
  p1Continuations:usage.p1Continuations+(request.kind==='continue'?1:0),
  nextChatSubmissions:usage.nextChatSubmissions+(request.kind==='next'?1:0),
  totalAutomatedSubmissions:usage.totalAutomatedSubmissions+1,
 }};
}
/** Also rejects malformed/partial policy on loading, not only on the send path. */
export function validatePilotProject(project:{
 id:string;initialTaskId:string;tasks:Array<{id:string;dependsOn?:string[];requiresReviewBeforeNext?:boolean}>;
 attendedPilotBudget?:PilotSendPolicy;
}):boolean {
 const policy=project.attendedPilotBudget;
 if(!policy)return false;
 if(!isPilotSendPolicy(policy)||project.tasks.length!==2||
    project.initialTaskId!==policy.initialTaskId||
    project.tasks[0].id!==policy.initialTaskId||
    project.tasks[1].id!==policy.nextTaskId||
    project.tasks.some(t=>(t.dependsOn?.length??0)>0||t.requiresReviewBeforeNext===true))
  throw Error('Invalid bounded attended pilot policy or task authority');
 return true;
}
