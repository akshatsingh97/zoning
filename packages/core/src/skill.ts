import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SKILL_PATH = '.agents/skills/zoning/SKILL.md';
export const SKILL_MARKER = 'written by zoning init';

export const SKILL_MD = `# Zoning

<!-- ${SKILL_MARKER}; safe to re-run zoning init -->

This repo uses Zoning: every file is zoned Critical, Shared, or Open by blast radius.

Before editing or creating any file:

1. Run \`zoning zone <file>\` from the repo root (add \`--json\` for machine output).
   It prints the file's tier and reason, and whether the active contract covers it.
2. If the file is Critical and not covered by the active contract, STOP.
   Do not edit it. Ask the developer to create an intent contract first
   (\`zoning contract new\`) covering that file.
3. Shared files: check who imports them before changing behavior.
   Open files: edit freely.

This skill is guidance. Enforcement lives in \`zoning watch\` (flags drive-by
edits the moment they happen) and the pre-commit \`zoning guard\` hook
(blocks drive-by commits and diffs without a passing \`zoning check\`).
`;

export interface WrittenSkill {
  path: string;
  created: boolean;
}

export function writeSkill(repoRoot: string): WrittenSkill {
  const path = join(repoRoot, SKILL_PATH);
  const existed = existsSync(path);
  if (existed && !readFileSync(path, 'utf8').includes(SKILL_MARKER)) {
    throw new Error(
      `a skill file already exists at ${path} (not written by zoning) — move it aside first`,
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, SKILL_MD, 'utf8');
  return { path, created: !existed };
}
