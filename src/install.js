import { existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `autosubtitles install` copies the skill that ships inside this package into the
 * skills folder of each agent found on the machine. The skill and the commands it
 * tells an agent to run therefore always come from the same version.
 */

const SKILL = 'autosubtitles';
const AGENTS = [
    { name: 'Claude Code', dir: '.claude' },
    { name: 'Codex', dir: '.codex' },
    { name: 'Cursor', dir: '.cursor' },
    { name: 'Gemini CLI', dir: '.gemini' },
];
// The shared location that agents without a folder of their own read.
const SHARED = { name: 'Other agents', dir: '.agents' };

export async function installSkill({ project = false, home = os.homedir(), cwd = process.cwd() } = {}) {
    const source = fileURLToPath(new URL(`../skills/${SKILL}`, import.meta.url));
    const root = project ? cwd : home;
    // In a project every agent gets a copy; at home only the agents that are actually there.
    const found = project ? AGENTS : AGENTS.filter((agent) => existsSync(path.join(root, agent.dir)));
    const installed = [];
    for (const agent of [...found, SHARED]) {
        const target = path.join(root, agent.dir, 'skills', SKILL);
        await rm(target, { recursive: true, force: true });
        await mkdir(path.dirname(target), { recursive: true });
        await cp(source, target, { recursive: true });
        installed.push({ agent: agent.name, path: target });
    }
    return { ok: true, action: 'installed', scope: project ? 'project' : 'user', installed };
}
