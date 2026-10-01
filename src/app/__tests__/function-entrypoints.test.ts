import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every function hsmeta must point at something the build actually produces.
 *
 * The build script used to name all twenty-three functions by hand. Adding a
 * twenty-fourth and not editing that list produced:
 *
 *   [ERROR][changelog_draft_api] The entrypoint file [/app/functions/ChangelogDraft.js]
 *   was not found in the project
 *
 * — at deploy time, from HubSpot, after everything local had passed. The `.js`
 * files are build artefacts and are not in git, so nothing before the upload
 * could have caught it.
 *
 * The script is a glob now, which fixes it for anything placed in that
 * directory. This test covers the other half: an hsmeta that names an
 * entrypoint with no source behind it at all.
 */

const FUNCTIONS = join(__dirname, '..', 'functions');

function hsmetaFiles(): string[] {
  return readdirSync(FUNCTIONS).filter(f => f.endsWith('-hsmeta.json'));
}

describe('function entrypoints', () => {
  it('finds the hsmeta files', () => {
    expect(hsmetaFiles().length).toBeGreaterThan(0);
  });

  it('every declared entrypoint has a TypeScript source behind it', () => {
    const broken: string[] = [];

    for (const file of hsmetaFiles()) {
      const meta = JSON.parse(readFileSync(join(FUNCTIONS, file), 'utf8')) as {
        uid?: string;
        config?: { entrypoint?: string };
      };
      const entrypoint = meta.config?.entrypoint;
      if (!entrypoint) continue;

      // "/app/functions/Name.js" -> src/app/functions/Name.ts
      const base = entrypoint.split('/').pop() ?? '';
      if (!base.endsWith('.js')) continue;
      const source = base.replace(/\.js$/, '.ts');

      if (!existsSync(join(FUNCTIONS, source))) {
        broken.push(`${meta.uid ?? file}: entrypoint ${entrypoint} has no ${source}`);
      }
    }

    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('builds every function in the directory, not a hand-kept list', () => {
    // A list someone has to remember to edit is how the above happened.
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts.build).toContain('src/app/functions/*.ts');
  });
});
