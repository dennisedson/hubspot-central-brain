import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A UI extension may not import from outside its own directory.
 *
 * HubSpot bundles each extension directory in isolation — the upload copies one
 * directory to a temp root and resolves from there:
 *
 *   Could not resolve "../pages/LinearSettingsForm.tsx"
 *     from "../../tmp/app/settings/SettingsPage.tsx"
 *
 * Nothing local catches this. It typechecks, because the file is right there.
 * `npm run validate` passes. `hs project validate` passes — I reintroduced the
 * broken import and ran it, and it reported "valid and ready to upload". CI's
 * Dry-Run Validate passed on the PR that then failed to build. There is no
 * --dry-run on `hs project upload`.
 *
 * So the constraint is encoded here instead, where it costs a second.
 *
 * Serverless functions are deliberately NOT covered: esbuild bundles them
 * locally before upload with --bundle, which inlines ../lib, so HubSpot only
 * ever sees one self-contained file. The isolation applies to what HubSpot
 * bundles itself.
 */

const APP = path.join(__dirname, '..');
const EXTENSION_DIRS = ['cards', 'pages', 'settings'];

function sourceFiles(dir: string): string[] {
  const root = path.join(APP, dir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter(f => /\.(tsx|ts)$/.test(f))
    .map(f => path.join(root, f));
}

/**
 * Comments stripped first.
 *
 * Not fussiness: the very comment documenting this rule quotes the build error,
 * which contains `from "../../tmp/app/settings/SettingsPage.tsx"`. Scanning raw
 * source reports the explanation as a violation.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** Every relative import specifier in a file. */
export function relativeImports(source: string): string[] {
  return [...stripComments(source).matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g)]
    .map(m => m[1]);
}

describe('UI extension imports stay inside their own directory', () => {
  it('finds the extension sources it is meant to be checking', () => {
    const counts = EXTENSION_DIRS.map(d => sourceFiles(d).length);
    expect(counts.every(n => n > 0), `no sources found in ${EXTENSION_DIRS}`).toBe(true);
  });

  it('no relative import escapes its extension directory', () => {
    const escapes: string[] = [];

    for (const dir of EXTENSION_DIRS) {
      const root = path.join(APP, dir);
      for (const file of sourceFiles(dir)) {
        for (const specifier of relativeImports(fs.readFileSync(file, 'utf8'))) {
          const resolved = path.resolve(path.dirname(file), specifier);
          if (!resolved.startsWith(root + path.sep)) {
            escapes.push(
              `${dir}/${path.basename(file)} imports "${specifier}" — outside ${dir}/`,
            );
          }
        }
      }
    }

    expect(
      escapes,
      `HubSpot bundles each extension directory alone, so these cannot resolve at upload:\n${escapes.join('\n')}`,
    ).toEqual([]);
  });
});

describe('the scanner itself', () => {
  it('ignores import-looking text inside comments', () => {
    // The doc comment above this rule quotes the build error verbatim, and the
    // error contains a relative path. Without stripping, the explanation of the
    // rule violates the rule.
    const withComment = `
      /* Could not resolve "../pages/Thing.tsx"
         from "../../tmp/app/settings/Page.tsx" */
      // import { X } from '../elsewhere';
      import { Real } from './Local.tsx';
    `;
    expect(relativeImports(withComment)).toEqual(['./Local.tsx']);
  });

  it('still sees a real escaping import', () => {
    expect(relativeImports(`import { X } from '../pages/X.tsx';`)).toEqual(['../pages/X.tsx']);
  });
});
