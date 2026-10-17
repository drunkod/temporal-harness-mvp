import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {reconcileTransportDraft} from '../scripts/flowdeck-browser-test-draft.mjs';
import {composerPayloadFor} from '../dist/sashai-dispatch-evidence.js';

const project='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project';
const prompt='FLOWDECK TRANSPORT CHECK ONLY. This draft must never be submitted.';
const tab={id:'fresh-owned',type:'page',url:project+'?flowdeckAttempt=12345678-1234-4234-8234-123456789abc',
 webSocketDebuggerUrl:'mock://fresh'};
function harness(initial,options={}){
 const editor={innerText:initial,getClientRects:()=>[1],focus(){}};
 let deletes=0,evaluations=0;
 const selection={removeAllRanges(){},addRange(){}};
 const document={
  querySelectorAll:s=>s.includes('contenteditable')?[editor]:[],
  createRange:()=>({selectNodeContents(e){assert.equal(e,editor)}}),
  execCommand:(command)=>{assert.equal(command,'delete');deletes++;editor.innerText='';return true}
 };
 const deps={
  pages:async()=>options.targets??[{...tab}],
  wait:async()=>{if(options.restore&&deletes>0)editor.innerText=initial},
  evaluate:async(_target,expression)=>{
   evaluations++;
   return runInNewContext(expression,{document,window:{getSelection:()=>selection},location:new URL(project)});
  }
 };
 return {deps,editor,deletes:()=>deletes,evaluations:()=>evaluations};
}
test('only exact known Flowdeck test draft is cleared in a tagged owned test tab',async()=>{
 const h=harness(composerPayloadFor(prompt));
 assert.deepEqual(await reconcileTransportDraft(tab,project,prompt,h.deps),{ready:true,cleaned:true});
 assert.equal(h.editor.innerText,'');assert.equal(h.deletes(),1);
});
test('blank composer never receives a mutation',async()=>{
 const h=harness('');
 assert.deepEqual(await reconcileTransportDraft(tab,project,prompt,h.deps),{ready:true,cleaned:false});
 assert.equal(h.deletes(),0);
});
test('foreign user draft fails closed with zero clearing',async()=>{
 const h=harness('Unrelated owner draft');
 await assert.rejects(reconcileTransportDraft(tab,project,prompt,h.deps),/foreign_draft/);
 assert.equal(h.deletes(),0);assert.equal(h.editor.innerText,'Unrelated owner draft');
});
test('restored known draft is not repeatedly deleted',async()=>{
 const h=harness(composerPayloadFor(prompt),{restore:true});
 await assert.rejects(reconcileTransportDraft(tab,project,prompt,h.deps),/restored after exact cleanup/);
 assert.equal(h.deletes(),1);
});
test('missing/replaced target or wrong route and ownership tag fails before DOM mutation',async()=>{
 for(const targets of [[{...tab,id:'replacement'}],[{...tab,url:'https://chatgpt.com/g/foreign/project'}],
   [{...tab,url:project+'?flowdeckAttempt=wrong'}],[]]){
  const h=harness(composerPayloadFor(prompt),{targets});
  await assert.rejects(reconcileTransportDraft(tab,project,prompt,h.deps),/missing\/ambiguous|wrong project|ownership tag/);
  assert.equal(h.deletes(),0);assert.equal(h.evaluations(),0);
 }
});
test('untagged input tab is never accepted as test ownership',async()=>{
 const h=harness(composerPayloadFor(prompt));
 await assert.rejects(reconcileTransportDraft({...tab,url:project},project,prompt,h.deps),/freshly tagged owned test tab/);
 assert.equal(h.deletes(),0);
});

test('a transient invalid CDP URL waits for the SAME owned tab without mutating any draft',async()=>{
 const h=harness('');
 let reads=0;
 const pages=async()=>[{...tab,url:++reads<=2?'unparseable-temporary-navigation-url':tab.url}];
 assert.deepEqual(await reconcileTransportDraft(tab,project,prompt,{...h.deps,pages,wait:async()=>{}}),
   {ready:true,cleaned:false});
 assert.equal(reads,3);
 assert.equal(h.deletes(),0);
 assert.equal(h.evaluations(),1,'the invalid navigation URL was never evaluated or mutated');
});
test('a syntactically valid foreign project still fails immediately even if it shares a tab ID',async()=>{
 const h=harness('',{targets:[{...tab,url:'https://chatgpt.com/g/another-project/project'}]});
 await assert.rejects(reconcileTransportDraft(tab,project,prompt,h.deps),/wrong project/);
 assert.equal(h.deletes(),0);
 assert.equal(h.evaluations(),0);
});
