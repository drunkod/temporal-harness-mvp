import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = resolve(process.cwd());
const projects = ['alpha','beta'];
let passed = 0;
for (const name of projects) {
  const repo = join(root,'examples','projects',name);
  const output = join(repo,'OUTPUT.md');
  const todo = join(repo,'TASKS.md');
  const receiptPath = join(root,'.state','receipts',name+'-greeting.json');
  if (![output,todo,receiptPath].every(existsSync)) throw new Error('Missing demo artifact: '+name);
  const data = await readFile(output,'utf8');
  const check = JSON.parse(await readFile(receiptPath,'utf8'));
  const actual = createHash('sha256').update(data).digest('hex');
  const pending = await readFile(todo,'utf8');
  const clean = execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim();
  if (actual!==check.contentSha256 || check.verdict!=='verified' || !pending.includes('- [x] '+name+'-greeting:') || clean) {
    throw new Error('Failed independent final verification: '+name);
  }
  console.log('VERIFIED',name,check.gitCommit,check.browser,check.jev);
  passed++;
}
console.log('PASS: '+passed+' independently verified repos, no dirty working trees.');
