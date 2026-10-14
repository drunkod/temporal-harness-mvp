#!/usr/bin/env node
/**
 * Pin and patch Oracle 0.21.3 inside .state ONLY. Global/Homebrew Oracle untouched.
 *
 * Current ChatGPT HTML does not expose [data-testid^="conversation-turn"].
 * It does expose sr-only h4 headings "You said:" and "ChatGPT said:".
 * This preserves the usual selectors, adding a fallback only when both fail.
 */
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const base=resolve(import.meta.dirname,'..');
const root=join(base,'.state','oracle-local');
const cli=join(root,'node_modules','.bin','oracle');
const turns=join(root,'node_modules','@steipete','oracle','dist','src','browser','conversationTurns.js');
await mkdir(root,{recursive:true});
if(!existsSync(turns)){
  const p=spawnSync('npm',['install','--prefix',root,'--no-save','--no-package-lock',
    '--ignore-scripts','--no-audit','--no-fund','@steipete/oracle@0.21.3'],
    {cwd:base,encoding:'utf8',timeout:120000});
  if(p.status!==0)throw Error('Local Oracle install failed: '+p.stderr);
}
let code=await readFile(turns,'utf8');
const oldText=`    return containers.length > 0
      ? containers
      : Array.from(root.querySelectorAll(\${fallbackSelector}));`;
const newText=`    if (containers.length) return containers;
    const legacy = Array.from(root.querySelectorAll(\${fallbackSelector}));
    if (legacy.length) return legacy;
    // ChatGPT 2026 UI: per-turn screenreader heading, with body in parent.
    return Array.from(root.querySelectorAll('h4.sr-only'))
      .filter(h => /^(You said:|ChatGPT said:)$/.test((h.textContent || '').trim()))
      .map(h => h.parentElement)
      .filter(Boolean);`;
if(code.includes(oldText)){
  code=code.replace(oldText,newText);
  await writeFile(turns,code);
}else if(!code.includes('ChatGPT 2026 UI')){
  throw Error('Oracle upstream changed; refuse unknown patch');
}
const assistantPath=join(root,'node_modules','@steipete','oracle','dist','src','browser','actions','assistantResponse.js');
let assistant=await readFile(assistantPath,'utf8');
const assistantOld='return Boolean(node.querySelector(ASSISTANT_SELECTOR) || node.querySelector(\'[data-testid*="assistant"]\'));';
const assistantNew='return Boolean((node.querySelector(\'h4.sr-only\')?.textContent || \'\').trim() === \'ChatGPT said:\' || node.querySelector(ASSISTANT_SELECTOR) || node.querySelector(\'[data-testid*="assistant"]\'));';
if(assistant.includes(assistantOld)){
  const count=assistant.split(assistantOld).length-1;
  if(count<3)throw Error('Unexpected Oracle reader layout: '+count+' matches');
  assistant=assistant.split(assistantOld).join(assistantNew);
  await writeFile(assistantPath,assistant);
}else if(!assistant.includes(assistantNew)){
  throw Error('Oracle assistant reader changed: refuse patch');
}
const v=spawnSync(cli,['--version'],{encoding:'utf8',timeout:15000});
if(v.status!==0 || !v.stdout.includes('0.21.3'))throw Error('Unexpected locally pinned Oracle version');
console.log(JSON.stringify({localOracle:cli,version:v.stdout.trim(),domFallbackPatched:true,homebrewUntouched:true},null,2));
