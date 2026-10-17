import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inspectSashaiTaskSource } from './sashai-task-source.js';
import { SASHAI_PROJECT_URL } from './sashai-observer.js';
import {validatePilotProject} from './flowdeck-pilot-budget.js';
import type {PilotSendPolicy} from './flowdeck-pilot-budget.js';

export type ApprovedTask = { id: string; title: string; instruction: string; requiresReviewBeforeNext?: boolean; dependsOn?: string[] };
export type SupervisorProject = {
  id: string; ownerId: string; deviceId: string; repo: string; projectUrl: string; initialTaskId: string; tasks: ApprovedTask[];
 attendedPilotBudget?:PilotSendPolicy;
};
export interface ProjectLoaderOptions {
  base?: string;
  inspect?: typeof inspectSashaiTaskSource;
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Enrollment is explicit. Neither snapshots nor the loader select or authorize tasks. */
export function createSupervisorProjectLoader(options: ProjectLoaderOptions = {}) {
  const base = resolve(options.base ?? process.cwd());
  const inspect = options.inspect ?? inspectSashaiTaskSource;
  return async function loadSupervisorProject(projectId: string): Promise<SupervisorProject> {
    const config: unknown = JSON.parse(await readFile(join(base, '.state/flowdeck-supervisor/projects.json'), 'utf8'));
    if (!config || typeof config !== 'object' || !('projects' in config) || !Array.isArray(config.projects))
      throw Error('Expected enrollment {projects: SupervisorProject[]}');
    const matches = config.projects.filter(p => p?.id === projectId);
    if (matches.length !== 1) throw Error('Project is not uniquely enrolled');
    const p = matches[0] as SupervisorProject;
    if (![p.id, p.ownerId, p.deviceId, p.repo].every(text) || !p.repo.startsWith('/') ||
        p.projectUrl !== SASHAI_PROJECT_URL) throw Error('Invalid enrollment or unsupported ChatGPT project (Sashai only)');
    if (!Array.isArray(p.tasks) || !p.tasks.length) throw Error('Explicit approved tasks required');
    const ids = new Set<string>(), titles = new Set<string>();
    for (const t of p.tasks) {
      if (!t || ![t.id, t.title, t.instruction].every(text) || ids.has(t.id) || titles.has(t.title) ||
          (t.requiresReviewBeforeNext !== undefined && typeof t.requiresReviewBeforeNext !== 'boolean'))
        throw Error('Invalid or duplicate approved task');
      ids.add(t.id); titles.add(t.title);
    }
    const initialTaskId = p.initialTaskId === undefined && p.tasks.length === 1 ? p.tasks[0].id : p.initialTaskId;
    if (!text(initialTaskId) || !ids.has(initialTaskId))
      throw Error('initialTaskId must name an approved task (required when multiple tasks are enrolled)');
    for (const t of p.tasks) {
      if (t.dependsOn !== undefined && (!Array.isArray(t.dependsOn) ||
          t.dependsOn.some(id => !text(id) || id === t.id || !ids.has(id)) ||
          new Set(t.dependsOn).size !== t.dependsOn.length))
        throw Error('Invalid task dependency: IDs must be unique, known, and not self references');
    }
    if(p.id.startsWith('sashai-fresh-attended-')&&!p.attendedPilotBudget)
      throw Error('Fresh attended pilot requires a validated hard send budget');
    if(p.attendedPilotBudget!==undefined&&!validatePilotProject({...p,initialTaskId}))
      throw Error('Invalid bounded attended pilot policy');
    const gate = await inspect(p.repo);
    if (gate.status !== 'approved_plan_has_pending_tasks') throw Error(`Task authority blocked: ${gate.status}: ${gate.reason}`);
    if (p.tasks.some(t => gate.tasks.filter(title => title === t.title).length !== 1))
      throw Error('Configured titles must exactly match unique unchecked active-plan Task Breakdown rows');
    return { id: p.id, ownerId: p.ownerId, deviceId: p.deviceId, repo: p.repo, projectUrl: p.projectUrl, initialTaskId,
      tasks: p.tasks.map(t => ({ id: t.id, title: t.title, instruction: t.instruction,
        ...(t.requiresReviewBeforeNext === undefined ? {} : { requiresReviewBeforeNext: t.requiresReviewBeforeNext }),
                ...(t.dependsOn === undefined ? {} : { dependsOn: [...t.dependsOn] }) })),
      ...(p.attendedPilotBudget ? {attendedPilotBudget:{...p.attendedPilotBudget}} : {}) };
  };
}
export const loadSupervisorProject = createSupervisorProjectLoader();
