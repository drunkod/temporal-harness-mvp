import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const projects = join(resolve(process.cwd()), 'examples', 'projects');
await mkdir(projects, { recursive: true });
for (const project of ['alpha', 'beta']) {
  const repo = join(projects, project);
  await mkdir(repo, { recursive: true });
  const file = join(repo, 'TASKS.md');
  const content = '# ' + project + ' — disposable demo project\n\n'
    + '- [ ] ' + project + '-greeting: Create a documented greeting output for ' + project + '\n';
  const existing = existsSync(join(repo, '.git'));
  if (!existing) {
    await writeFile(file, content, 'utf8');
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['add', 'TASKS.md'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=Temporal MVP', '-c', 'user.email=mvp@localhost',
      'commit', '-qm', 'fixture: initial task'], { cwd: repo });
  }
  // Repo Harness writes local browser dry-run records under .ai; they are not project source.
  const exclude = join(repo, '.git', 'info', 'exclude');
  await mkdir(join(repo, '.git', 'info'), { recursive: true });
  const previous = existsSync(exclude) ? await readFile(exclude, 'utf8') : '';
  if (!previous.split(/\r?\n/).includes('.ai/')) await appendFile(exclude, '\n.ai/\n');
  console.log(existing ? 'Preserved:' : 'Seeded:', repo);
}
