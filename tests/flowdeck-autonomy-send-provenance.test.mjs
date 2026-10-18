import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAutonomySendProvenanceStore,autonomousSendPromptHash} from '../dist/flowdeck-autonomy-send-provenance.js';
import {sha256} from '../dist/flowdeck-autonomy-policy.js';
import {composerPayloadFor} from '../dist/sashai-dispatch-evidence.js';

const projectUrl='https://chatgpt.com/g/g-p-fixture/project';
const chat='https://chatgpt.com/g/g-p-fixture/c/chat-one';
const chat2='https://chatgpt.com/g/g-p-fixture/c/chat-two';
const intent=(overrides={})=>({schema:'flowdeck.send-intent/v1',dispatchId:'dispatch-001',workflowId:'workflow-001',runId:'run-000001',
 campaignId:'campaign-001',campaignRunId:'campaign-run-001',projectId:'project-001',taskId:'task-001',kind:'continue_p1',
 policyDigest:'a'.repeat(64),reservationId:'reservation-001',promptHash:autonomousSendPromptHash('continue this approved task'),tabId:'ABCDEFGHIJKLMNOP',
 projectUrl,priorChatUrl:chat,priorUserTurns:1,...overrides});
async function fixture(t,overrides={}){
 const root=await mkdtemp(join(tmpdir(),'flowdeck-send-provenance-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=createAutonomySendProvenanceStore(join(root,'isolated'));const i=intent(overrides);
 await store.putIntent(i);await store.recordPhase(i.dispatchId,'staged');await store.recordPhase(i.dispatchId,'click_attempted');
 const observation={schema:'flowdeck.send-observation/v1',dispatchId:i.dispatchId,intentSha256:sha256(await readFile(join(root,'isolated',i.dispatchId+'.intent.json'))),
  observedPromptHash:i.promptHash,tabId:i.tabId,chatUrl:i.kind==='initial_p2'?chat2:chat,userTurnId:'turn-observed-001',observedUserTurns:i.priorUserTurns+1};
 await store.putObservation(observation);await store.recordPhase(i.dispatchId,'submitted');await store.reconcile(i.dispatchId);
 return{root,store,intent:i,observation};
}
test('durable intent, observation, four phases, and exact-byte receipt reconcile',async t=>{
 const x=await fixture(t),verified=await x.store.readExact(x.intent.dispatchId);
 assert.deepEqual(verified.intent,x.intent);assert.deepEqual(verified.observation,x.observation);
 assert.deepEqual(verified.phases.map(x=>x.phase),['staged','click_attempted','submitted','reconciled']);
 assert.equal(verified.receipt.intentSha256,sha256(await readFile(join(x.root,'isolated',x.intent.dispatchId+'.intent.json'))));
 assert.equal(verified.receipt.observationSha256,sha256(await readFile(join(x.root,'isolated',x.intent.dispatchId+'.observation.json'))));
 assert.equal(autonomousSendPromptHash('  continue\n this approved task '),x.intent.promptHash);
 assert.equal(x.intent.promptHash,sha256(composerPayloadFor('continue this approved task')));
});
test('pre-click intent never contains a fabricated observed chat or turn identity',async t=>{
 const x=await fixture(t);const persisted=JSON.parse(await readFile(join(x.root,'isolated',x.intent.dispatchId+'.intent.json'),'utf8'));
 assert.equal(persisted.chatUrl,undefined);assert.equal(persisted.userTurnId,undefined);assert.equal(persisted.priorChatUrl,chat);
});
test('intent, observed seal, tab, chat, turn, count, phase, and receipt mutations quarantine',async t=>{
 const editIntent=field=>async x=>{const f=join(x.root,'isolated',x.intent.dispatchId+'.intent.json');const v=JSON.parse(await readFile(f));
  const alternatives={dispatchId:'other-dispatch',workflowId:'other-workflow',runId:'other-run',campaignId:'other-campaign',campaignRunId:'other-campaign-run',
   projectId:'other-project',taskId:'other-task',kind:'initial_p1',policyDigest:'b'.repeat(64),reservationId:'other-reservation',promptHash:'c'.repeat(64),
   tabId:'QRSTUVWXYZABCDEF',projectUrl:'https://chatgpt.com/g/other-project/project',priorChatUrl:'https://chatgpt.com/g/g-p-fixture/c/other-chat',priorUserTurns:2};
  v[field]=alternatives[field];await writeFile(f,JSON.stringify(v)+'\n');};
 const mutations=[
  ...['dispatchId','workflowId','runId','campaignId','campaignRunId','projectId','taskId','kind','policyDigest','reservationId','promptHash','tabId','projectUrl','priorChatUrl','priorUserTurns']
   .map(field=>[field,editIntent(field),/quarantine/]),
  ['observation hash',async x=>{const f=join(x.root,'isolated',x.intent.dispatchId+'.observation.json');const v=JSON.parse(await readFile(f));v.observedPromptHash='b'.repeat(64);await writeFile(f,JSON.stringify(v)+'\n');},/intent\/observation\/phase linkage/],
  ['tab',async x=>{const f=join(x.root,'isolated',x.intent.dispatchId+'.observation.json');const v=JSON.parse(await readFile(f));v.tabId='QRSTUVWXYZABCDEF';await writeFile(f,JSON.stringify(v)+'\n');},/intent\/observation\/phase linkage/],
  ['turn ID',async x=>{const f=join(x.root,'isolated',x.intent.dispatchId+'.observation.json');const v=JSON.parse(await readFile(f));v.userTurnId='';await writeFile(f,JSON.stringify(v)+'\n');},/observation schema/],
  ['turn count',async x=>{const f=join(x.root,'isolated',x.intent.dispatchId+'.observation.json');const v=JSON.parse(await readFile(f));v.observedUserTurns=99;await writeFile(f,JSON.stringify(v)+'\n');},/intent\/observation\/phase linkage/],
  ['phase bytes',async x=>{const f=join(x.root,'isolated',x.intent.dispatchId+'.staged.json');const v=JSON.parse(await readFile(f));v.phase='submitted';await writeFile(f,JSON.stringify(v)+'\n');},/phase linkage|receipt hash linkage/],
  ['receipt',async x=>{const f=join(x.root,'isolated',x.intent.dispatchId+'.receipt.json');const v=JSON.parse(await readFile(f));v.phaseRecordsSha256='c'.repeat(64);await writeFile(f,JSON.stringify(v)+'\n');},/receipt hash linkage/],
 ];
 for(const [name,mutate,re] of mutations){const x=await fixture(t);await mutate(x);await assert.rejects(x.store.readExact(x.intent.dispatchId),re,name);}
});
test('missing receipt, missing phase, truncated file, symlink, and extra duplicate-like record quarantine',async t=>{
 const a=await fixture(t);await rm(join(a.root,'isolated',a.intent.dispatchId+'.receipt.json'));await assert.rejects(a.store.readExact(a.intent.dispatchId),/receipt absent/);
 const b=await fixture(t);await rm(join(b.root,'isolated',b.intent.dispatchId+'.click_attempted.json'));await assert.rejects(b.store.readExact(b.intent.dispatchId),/gap or duplicate/);
 const c=await fixture(t);await writeFile(join(c.root,'isolated',c.intent.dispatchId+'.observation.json'),'{');await assert.rejects(c.store.readExact(c.intent.dispatchId),/partial\/unreadable/);
 const f=await fixture(t);await writeFile(join(f.root,'isolated',f.intent.dispatchId+'.intent.json'),'{');await assert.rejects(f.store.readExact(f.intent.dispatchId),/partial\/unreadable/);
 const g=await fixture(t);await writeFile(join(g.root,'isolated',g.intent.dispatchId+'.staged.json'),'{');await assert.rejects(g.store.readExact(g.intent.dispatchId));
 const h=await fixture(t);await rm(join(h.root,'isolated',h.intent.dispatchId+'.observation.json'));await rm(join(h.root,'isolated',h.intent.dispatchId+'.receipt.json'));await assert.rejects(h.store.readExact(h.intent.dispatchId),/receipt absent|receipt lacks full observation/);
 const d=await fixture(t);const obs=join(d.root,'isolated',d.intent.dispatchId+'.observation.json');const copy=join(d.root,'observation-copy');await writeFile(copy,await readFile(obs));await rm(obs);await symlink(copy,obs);await assert.rejects(d.store.readExact(d.intent.dispatchId),/regular file/);
 const e=await fixture(t);await writeFile(join(e.root,'isolated',e.intent.dispatchId+'.observation-copy.json'),'{}');await assert.rejects(e.store.readExact(e.intent.dispatchId),/unknown/);
});
test('continuation must remain in the same chat and a fresh P2 intent has no target chat before send',async t=>{
 const x=await fixture(t);const f=join(x.root,'isolated',x.intent.dispatchId+'.observation.json');const o=JSON.parse(await readFile(f));o.chatUrl=chat2;await writeFile(f,JSON.stringify(o)+'\n');await assert.rejects(x.store.readExact(x.intent.dispatchId),/continuation changed/);
 const p2=await fixture(t,{dispatchId:'dispatch-002',kind:'initial_p2',priorChatUrl:null,priorUserTurns:0});assert.equal(p2.observation.chatUrl,chat2);assert.equal(p2.intent.priorChatUrl,null);
});
test('incomplete exact intent fields and invalid canonical Project URLs are rejected',async t=>{
 const root=await mkdtemp(join(tmpdir(),'flowdeck-send-intent-invalid-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=createAutonomySendProvenanceStore(join(root,'root'));
 await assert.rejects(store.putIntent(intent({projectUrl:'https://chatgpt.com/g/g-p-fixture/project/?x=1'})),/intent schema/);
 await assert.rejects(store.putIntent(intent({campaignRunId:undefined})),/intent schema/);
});
