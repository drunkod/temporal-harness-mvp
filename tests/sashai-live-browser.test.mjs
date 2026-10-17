import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createLiveBrowser,browserEvaluate,confirmedToolCalls,PROJECT} from '../dist/sashai-live-browser.js';
import {composerPayloadFor} from '../dist/sashai-dispatch-evidence.js';

const owner='12345678-1234-4234-8234-123456789abc';
const url='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/6acfe3ee-ad30-83eb-b92e-fa069ac9ee6e';
const output='/fixture/report.md',marker='SASHAI_ROUTING_LIVE_V1_'+owner,prompt='Inspect sources, marker '+marker;
const target={id:'owned',url,type:'page',webSocketDebuggerUrl:'mock://owned'};
const call={id:'call-1',connector:'Remote Desktop Commander',operation:'write_file',path:output,completed:true};
function toolNode(c){const attrs={'data-tool-call-id':c.id,'data-connector-name':c.connector,'data-tool-name':c.operation,'data-file-path':c.path,'data-tool-status':c.completed?'completed':'running'};return {getAttribute:k=>attrs[k]??null};}
function message(role,text,id,calls=[]){return {innerText:text,getAttribute:k=>k==='data-message-author-role'?role:k==='data-message-id'?id:null,closest:()=>null,querySelectorAll:()=>calls.map(toolNode)};}
function evidenceBrowser(messages){
 const document={querySelectorAll:selector=>selector==='[data-message-author-role]'?messages:[]};
 return createLiveBrowser({pages:async()=>[target],evaluate:async(_,expression)=>runInNewContext(expression,{document,location:new URL(url)})});
}

test('owned window always creates a uniquely tagged new target instead of reusing owner tabs',async()=>{
 const existing={...target,id:'personal',url:PROJECT};let pages=[existing],opened=0;
 const b=createLiveBrowser({pages:async()=>pages,wait:async()=>{},openWindow:async requested=>{
  opened++;pages=[existing,{...target,id:'fresh',url:requested}];
 }});
 const selected=await b.createOwnedProjectTab(owner);
 assert.equal(selected.id,'fresh');assert.equal(opened,1);assert.ok(selected.url.includes(owner));
});

test('an existing or untagged target cannot be claimed after a failed handoff',async()=>{
 const personal={...target,url:PROJECT};
 const b=createLiveBrowser({pages:async()=>[personal],wait:async()=>{},openWindow:async()=>{}});
 await assert.rejects(b.createOwnedProjectTab(owner),/Owned project tab not found/);
});

test('connector mentions and old tool calls cannot certify invocation for a new turn',async()=>{
 const messages=[message('assistant','Old tool result','old',[call]),
  message('user',composerPayloadFor(prompt),'new-user'),
  message('assistant','Remote Desktop Commander wrote '+output+' using write_file','new-assistant')];
 const ev=await evidenceBrowser(messages).evidence(target.id,url,marker,output,prompt);
 assert.equal(ev.promptMatched,true);assert.equal(ev.turnId,'new-user');
 assert.equal(ev.tool,false);assert.deepEqual(Array.from(ev.calls),[]);
});

test('completed structured connector call is accepted only within the exact submitted turn',async()=>{
 const messages=[message('user',composerPayloadFor(prompt),'new-user'),
  message('assistant','Inspected /Users/test/Documents/work/sashai','answer',[call])];
 const ev=await evidenceBrowser(messages).evidence(target.id,url,marker,output,prompt);
 assert.equal(ev.tool,true);assert.equal(ev.promptMatched,true);assert.equal(ev.marker,true);
 assert.equal(ev.turnState,'turn_finished');assert.equal(ev.calls[0].id,'call-1');
});

for(const variant of ['different-prompt','duplicate-user','no-turn-id','later-user'])test('evidence refuses '+variant+' conversation provenance',async()=>{
 const user=message('user',variant==='different-prompt'?'Other task':composerPayloadFor(prompt),variant==='no-turn-id'?null:'new-user');
 const messages=[user,message('assistant','Completed','reply',[call])];
 if(variant==='duplicate-user')messages.push(message('user',composerPayloadFor(prompt),'duplicate'));
 if(variant==='later-user')messages.push(message('user','Owner changed the task','other'));
 const ev=await evidenceBrowser(messages).evidence(target.id,url,marker,output,prompt);
 assert.equal(ev.promptMatched,false);assert.equal(ev.tool,false);assert.equal(ev.turnId,null);
});

test('wrong connector, operation, destination or incomplete result is not tool evidence',()=>{
 for(const modified of [{...call,connector:'Other tool'},{...call,operation:'read_file'},
  {...call,path:'/other'},{...call,completed:false},{...call,id:''}])
  assert.equal(confirmedToolCalls([modified],output).length,0);
});

test('click checks full prompt and local deadline in the same browser evaluation',async()=>{
 let draft=composerPayloadFor(prompt),clicked=0;
 const e={innerText:draft,getClientRects:()=>[1]};
 const button={click:()=>{clicked++},getClientRects:()=>[1],getAttribute:()=>null};
 const document={querySelector:selector=>selector.startsWith('[contenteditable')?e:button,querySelectorAll:()=>[]};
 const b=createLiveBrowser({pages:async()=>[target],evaluate:async(_,expression)=>{
  e.innerText=draft;return runInNewContext(expression,{document,location:new URL(url)});
 }});
 assert.equal(await b.click(target,url,prompt,Date.now()-100),false);
 draft+=' plus unapproved instruction';
 assert.equal(await b.click(target,url,prompt,Date.now()+10000),false);
 draft=composerPayloadFor(prompt);
 assert.equal(await b.click(target,url,prompt,Date.now()+10000),true);
 assert.equal(clicked,1);
});

test('cancellation after target lookup prevents the click evaluation',async()=>{
 let evaluations=0;
 const b=createLiveBrowser({pages:async()=>[target],evaluate:async()=>{evaluations++;return true;}});
 await assert.rejects(b.click(target,url,prompt,Date.now()+10000,()=>{throw Error('cancelled');}),/cancelled/);
 assert.equal(evaluations,0);
});

test('composer hydration waits for readiness, selects the picker, and never sends',async()=>{
 let probes=0,opened=0,selected=0;
 const composer={innerText:'',getClientRects:()=>[1],focus:()=>{}};
 const picker={getClientRects:()=>[1],click:()=>{opened++}};
 const connector={innerText:'Probe RemoteMCP2',getClientRects:()=>[1],click:()=>{selected++;composer.innerText='Probe RemoteMCP2'},getAttribute:()=>null};

 const document={
  querySelector:selector=>selector.startsWith('[contenteditable')?(probes++<1?null:composer):selector.includes('Add files')?picker:null,
  querySelectorAll:selector=>selector==='button'?(opened?[connector]:[]):[],
  execCommand:()=>{composer.innerText+=' '+prompt;return true}
 };
 const b=createLiveBrowser({pages:async()=>[target],wait:async()=>{},evaluate:async(_,expression)=>runInNewContext(expression,{document,location:new URL(url)})});
 await b.stage(target,url,prompt);
 assert.equal(selected,1);assert.equal(opened,1);
});

test('persistent owner draft prevents staging without picker or composer modification',async()=>{
 let probes=0;
 const b=createLiveBrowser({pages:async()=>[target],evaluate:async()=>{probes++;return false;}});
 await assert.rejects(b.stage(target,url,prompt),/owner draft/);
 assert.equal(probes,1);
});

test('transient same-tab route hydration recovers before any send',async()=>{
  const replies=['wrong-target','ready','opened','wrong-target','selected','ready',true];
  let pages=[];
  const browser=createLiveBrowser({
    pages:async()=>pages,
    openWindow:async requested=>{pages=[{...target,url:requested}];},
    wait:async()=>{},
    evaluate:async(_tab,expression)=>expression.includes('ready:document.readyState')?{url:PROJECT,ready:'loading'}:replies.shift()
  });
  const owned=await browser.createOwnedProjectTab(owner);
  await browser.stage(owned,PROJECT,prompt);
  assert.deepEqual(replies,[]);
});

test('target drift during composer hydration refuses staging',async()=>{
 const document={querySelector:()=>null,querySelectorAll:()=>[]};
 const b=createLiveBrowser({pages:async()=>[target],wait:async()=>{},evaluate:async(_,expression)=>runInNewContext(expression,{document,location:new URL(PROJECT)})});
 await assert.rejects(b.stage(target,url,prompt),/Original owned ChatGPT tab changed/);
});

async function ownedStagingFixture(routes=[],domLag=0){
 let current,armed=false,opened=false,selected=0,sends=0,insertions=0;
 const composer={innerText:'',getClientRects:()=>[1],focus:()=>{}};
 const menu={innerText:'More',getClientRects:()=>[1],getAttribute:()=>null,click:()=>{opened=true;}};
 const connector={innerText:'Probe RemoteMCP2',getClientRects:()=>[1],getAttribute:()=>null,click:()=>{selected++;composer.innerText='Probe RemoteMCP2';}};
 const send={getClientRects:()=>[1],getAttribute:()=>null,click:()=>{sends++;}};
 const document={readyState:'loading',querySelector:s=>s.startsWith('[contenteditable')?composer:s.includes('Add files')?menu:s.includes('Send')?send:null,querySelectorAll:s=>s==='button'?(opened?[connector]:[]):s.includes('contenteditable')?[composer]:[],execCommand:(_a,_b,text)=>{insertions++;composer.innerText+=text;return true;}};
 const browser=createLiveBrowser({
  pages:async()=>{if(!current)return [];if(armed&&routes.length){const route=routes.shift();return route==='replace-id'?[{...current,id:'unrelated'}]:[{...current,url:route}];}return [current];},
  openWindow:async requested=>{current={...target,id:'new-owned',url:requested};},wait:async()=>{},
  evaluate:async(_tab,expression)=>{
   const mismatch=expression.includes("return 'wrong-target'")&&domLag-->0;
   return runInNewContext(expression,{document,location:new URL(mismatch?'https://chatgpt.com/':PROJECT)});
  }
 });
 const tab=await browser.createOwnedProjectTab(owner);armed=true;
 return {browser,tab,counts:()=>({selected,sends,insertions})};
}
test('new owned target tolerates transient CDP bootstrap and DOM hydration, then stages once',async()=>{
 const f=await ownedStagingFixture(['about:blank','https://chatgpt.com/'],1);
 await f.browser.stage(f.tab,PROJECT,prompt);assert.equal(await f.browser.matches(f.tab,PROJECT,prompt),true);
 assert.deepEqual(f.counts(),{selected:1,sends:0,insertions:1});
 assert.ok(f.browser.diagnostics().some(d=>d.reason==='cdp_bootstrap'));
 assert.ok(f.browser.diagnostics().some(d=>d.reason==='cdp_url_pending'));
 assert.ok(f.browser.diagnostics().some(d=>d.reason.startsWith('dom_route_pending')));
});
test('permanent CDP drift of a new owned target times out without selecting or typing',async()=>{
 const f=await ownedStagingFixture(Array(65).fill('https://chatgpt.com/other-project'));
 await assert.rejects(f.browser.stage(f.tab,PROJECT,prompt),/stage.composer: cdp_url_pending/);
 assert.deepEqual(f.counts(),{selected:0,sends:0,insertions:0});
});
test('a replacement target never substitutes for the owned CDP ID',async()=>{
 const f=await ownedStagingFixture(Array(65).fill('replace-id'));
 await assert.rejects(f.browser.stage(f.tab,PROJECT,prompt),/stage.composer: tab_missing/);
 assert.equal(f.counts().sends,0);assert.equal(f.counts().insertions,0);
});
test('a changed ownership tag is rejected before any composer action',async()=>{
 const f=await ownedStagingFixture([PROJECT+'?flowdeckAttempt=another-owner']);
 await assert.rejects(f.browser.stage(f.tab,PROJECT,prompt),/attempt tag changed/);
 assert.equal(f.counts().insertions,0);assert.equal(f.counts().sends,0);
});

test('connector selection waits for hydration without reclicking or early typing',async()=>{
 let opened=0,selected=0,labelReads=0,inserted=0;
 const editor={innerText:'',getClientRects:()=>[1],focus:()=>{}};
 const menu={getClientRects:()=>[1],click:()=>{opened++}};
 const connector={innerText:'Probe RemoteMCP2',getClientRects:()=>[1],getAttribute:()=>null,click:()=>{selected++}};
 const doc={querySelector:s=>s.includes('contenteditable')?editor:s.includes('Add files')?menu:null,
  querySelectorAll:s=>s==='button'?(opened?[connector]:[]):s.includes('contenteditable')?[editor]:[],
  execCommand:(_a,_b,v)=>{inserted++;editor.innerText+=v;}};
 const b=createLiveBrowser({pages:async()=>[target],wait:async()=>{},evaluate:async(_t,expression)=>{
  if(expression.includes('unexpected_selection')&&++labelReads===3)editor.innerText='Probe RemoteMCP2';
  return runInNewContext(expression,{document:doc,location:new URL(url)});
 }});
 await b.stage(target,url,prompt);
 assert.equal(opened,1);assert.equal(selected,1);assert.equal(inserted,1);
 assert.equal(editor.innerText,composerPayloadFor(prompt));
 assert.ok(b.diagnostics().some(v=>v.check==='stage.selected_label'&&v.reason==='pending'));
});

test('two visible editors refuse staging without picking, typing or sending',async()=>{
 let mutations=0;
 const editors=Array.from({length:2},()=>({innerText:'',getClientRects:()=>[1]}));
 const doc={querySelector:s=>s.includes('contenteditable')?editors[0]:null,
  querySelectorAll:s=>s.includes('contenteditable')?editors:[],
  execCommand:()=>{mutations++}};
 const b=createLiveBrowser({pages:async()=>[target],wait:async()=>{},evaluate:async(_t,expression)=>
  runInNewContext(expression,{document:doc,location:new URL(url)})});
 await assert.rejects(b.stage(target,url,prompt),/Ambiguous visible composers/);
 assert.equal(mutations,0);
});


test('hidden first editor cannot mask the uniquely visible empty composer',async()=>{
 let selected=0,inserted=0,opened=false;
 const hidden={innerText:'',getClientRects:()=>[]};
 const visible={innerText:'',getClientRects:()=>[1],focus:()=>{}};
 const menu={getClientRects:()=>[1],click:()=>{opened=true}};
 const connector={innerText:'Probe RemoteMCP2',getClientRects:()=>[1],getAttribute:()=>null,
  click:()=>{selected++;visible.innerText='Probe RemoteMCP2'}};
 const doc={querySelector:s=>s.includes('contenteditable')?hidden:s.includes('Add files')?menu:null,
  querySelectorAll:s=>s==='button'?(opened?[connector]:[]):s.includes('contenteditable')?[hidden,visible]:[],
  execCommand:(_a,_b,text)=>{inserted++;visible.innerText+=text}};
 const b=createLiveBrowser({pages:async()=>[target],wait:async()=>{},evaluate:async(_t,x)=>
  runInNewContext(x,{document:doc,location:new URL(url)})});
 await b.stage(target,url,prompt);
 assert.equal(selected,1);assert.equal(inserted,1);
 assert.equal(visible.innerText,composerPayloadFor(prompt));
 assert.equal(hidden.innerText,'');
});

test('ambiguous connector candidates fail closed before selection or insertion',async()=>{
 let selected=0,inserted=0,opened=false;
 const editor={innerText:'',getClientRects:()=>[1]};
 const menu={getClientRects:()=>[1],click:()=>{opened=true}};
 const connector=()=>({innerText:'Probe RemoteMCP2',getClientRects:()=>[1],getAttribute:()=>null,click:()=>{selected++}});
 const doc={querySelector:s=>s.includes('contenteditable')?editor:s.includes('Add files')?menu:null,
  querySelectorAll:s=>s==='button'?(opened?[connector(),connector()]:[]):s.includes('contenteditable')?[editor]:[],
  execCommand:()=>{inserted++}};
 const b=createLiveBrowser({pages:async()=>[target],wait:async()=>{},evaluate:async(_t,x)=>
  runInNewContext(x,{document:doc,location:new URL(url)})});
 await assert.rejects(b.stage(target,url,prompt),/Ambiguous connector choices/);
 assert.equal(selected,0);assert.equal(inserted,0);
});


test('CDP transport settles on early close, failed send and protocol errors without waiting for timeout',async()=>{
 const original=globalThis.WebSocket;
 let mode='close',sent=0;
 const instances=[];
 class FakeSocket {
  constructor(address){
   assert.equal(address,target.webSocketDebuggerUrl);
   this.listeners=new Map();this.closed=false;instances.push(this);
   queueMicrotask(()=>this.emit(mode==='before-open'?'close':'open'));
  }
  addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);}
  removeEventListener(type,handler){this.listeners.get(type)?.delete(handler);}
  emit(type,event={}){for(const handler of [...(this.listeners.get(type)||[])])handler(event);}
  send(payload){
   assert.deepEqual(JSON.parse(payload),{id:1,method:'Runtime.evaluate',params:{expression:'1+2',returnByValue:true}});
   sent++;
   if(mode==='send-throws')throw Error('mock socket closed during send');
   queueMicrotask(()=>{
    if(mode==='close')this.emit('close');
    if(mode==='socket-error')this.emit('error');
    if(mode==='protocol-error')this.emit('message',{data:JSON.stringify({id:1,error:{code:-1}})});
    if(mode==='malformed-then-success'){
     this.emit('message',{data:'invalid'});
     this.emit('message',{data:JSON.stringify({id:2,result:{result:{value:999}}})});
     this.emit('message',{data:JSON.stringify({id:1,result:{result:{value:3}}})});
    }
   });
  }
  close(){this.closed=true;this.emit('close');}
 }
 try{
  globalThis.WebSocket=FakeSocket;
  const cases=[
   ['before-open','CDP socket closed before evaluation result'],
   ['close','CDP socket closed before evaluation result'],
   ['send-throws','CDP socket send failure'],
   ['socket-error','CDP socket failure'],
   ['protocol-error','CDP evaluation failed']
  ];
  for(const [scenario,expected] of cases){
   mode=scenario;
   await assert.rejects(browserEvaluate(target,'1+2'),new RegExp(expected));
   const socket=instances.at(-1);
   assert.equal(socket.closed,true);
   assert.equal([...socket.listeners.values()].reduce((n,s)=>n+s.size,0),0,'listeners removed on failure');
  }
  mode='malformed-then-success';
  assert.equal(await browserEvaluate(target,'1+2'),3,'unrelated CDP events ignored');
  assert.equal(instances.at(-1).closed,true);
  assert.equal([...instances.at(-1).listeners.values()].reduce((n,s)=>n+s.size,0),0,'listeners removed on success');
  assert.equal(sent,5,'closed before open never sent a command');
 }finally{globalThis.WebSocket=original;}
});

test('one verified closed picker can be reopened after its initial click was swallowed',async()=>{
 let pickerClicks=0,connectorClicks=0,inserted=0;
 const editor={innerText:'',getClientRects:()=>[1],focus(){}};
 const picker={getClientRects:()=>[1],getAttribute:()=>null,click:()=>{pickerClicks++}};
 const connector={innerText:'Probe RemoteMCP2',getClientRects:()=>[1],getAttribute:()=>null,
  click:()=>{connectorClicks++;editor.innerText='Probe RemoteMCP2'}};
 const document={
  querySelector:s=>s.includes('contenteditable')?editor:s.includes('Add files')?picker:null,
  querySelectorAll:s=>s==='button'?(pickerClicks>=2?[connector]:[]):s.includes('button[aria-label')?[picker]:
   s.includes('contenteditable')?[editor]:[],
  execCommand:(_kind,_fallback,text)=>{inserted++;editor.innerText+=text}
 };
 const b=createLiveBrowser({pages:async()=>[target],wait:async()=>{},
  evaluate:async(_t,x)=>runInNewContext(x,{document,location:new URL(url)})});
 await b.stage(target,url,prompt);
 assert.equal(pickerClicks,2,'one initial click plus at most one verified-closed reopen');
 assert.equal(connectorClicks,1,'connector is selected once');
 assert.equal(inserted,1,'prompt is inserted once');
 assert.ok(b.diagnostics().some(x=>x.reason==='picker_reopened_once_after_verified_closed'));
});
test('persistently closed picker never gets a third click or a prompt insertion',async()=>{
 let pickerClicks=0,inserted=0;
 const editor={innerText:'',getClientRects:()=>[1],focus(){}};
 const picker={getClientRects:()=>[1],getAttribute:()=>null,click:()=>{pickerClicks++}};
 const document={
  querySelector:s=>s.includes('contenteditable')?editor:s.includes('Add files')?picker:null,
  querySelectorAll:s=>s==='button'?[]:s.includes('button[aria-label')?[picker]:
   s.includes('contenteditable')?[editor]:[],
  execCommand:()=>{inserted++}
 };
 const b=createLiveBrowser({pages:async()=>[target],wait:async()=>{},
  evaluate:async(_t,x)=>runInNewContext(x,{document,location:new URL(url)})});
 await assert.rejects(b.stage(target,url,prompt),/connector_missing_after_single_picker_reopen/);
 assert.equal(pickerClicks,2);
 assert.equal(inserted,0);
});
