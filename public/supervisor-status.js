import {mountJazzStatus} from '/jazz-status-loader.js';

const jazz=document.getElementById('flowdeck-jazz-status');
let disposeJazz=()=>{};
if(jazz){
 try{
  const response=await fetch('/api/jazz/status-config',{cache:'no-store'});
  if(response.ok){const config=await response.json();jazz.replaceChildren();disposeJazz=mountJazzStatus(jazz,{pluginOrigin:config.pluginOrigin});}
 }catch{/* The static authorized-panel link remains visible. */}
}
const phase=document.getElementById('supervisor-phase');
const detail=document.getElementById('supervisor-detail');
const tasks=document.getElementById('supervisor-tasks');
const connection=document.getElementById('supervisor-connection');
const events=new EventSource('/api/supervisor/stream');
events.addEventListener('status',event=>{
 try{
  const state=JSON.parse(event.data);
  const savedAt=new Date(state.updatedAt);
  connection.textContent=Number.isFinite(savedAt.getTime())
    ? 'Saved snapshot · '+savedAt.toISOString()+' · live workflow freshness unconfirmed'
    : 'Snapshot timestamp unavailable · live workflow freshness unconfirmed';
  connection.className='small warning';
  phase.textContent=String(state.phase||state.status||'Waiting').replaceAll('_',' ');
  detail.textContent=state.blocker||'Implementation status only. External systems own code review.';
  tasks.replaceChildren();
  for(const task of state.tasks||[]){
   const row=document.createElement('div');row.className='kv';
   const name=document.createElement('span');name.textContent=task.title||task.id;
   const status=document.createElement('span');status.className='val';
   status.textContent=(task.implementationStatus||'approved')+' / '+(task.reviewStatus||'not_started');
   row.append(name,status);tasks.append(row);
  }
  const active=(state.tasks||[]).find(t=>t.id===state.taskId);
  if(active){document.getElementById('task').textContent=active.implementationStatus.replaceAll('_',' ');}
 }catch{connection.textContent='Status unavailable';connection.className='small warning';}
});
events.onerror=()=>{connection.textContent='Connection interrupted — freshness unconfirmed';connection.className='small warning';};
window.addEventListener('pagehide',()=>{events.close();disposeJazz();},{once:true});
