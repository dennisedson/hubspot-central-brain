import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * UI extension components may only use HubSpot's own component set.
 *
 * There is no DOM to put a raw element into — the tree is serialised and
 * rendered remotely — so a `<strong>` throws at render. TypeScript does not
 * help: React's types permit intrinsic elements, so it typechecks, ships, and
 * then shows "There was a problem displaying this content" with a trace id and
 * nothing else.
 *
 * That cost two deploys and a wrong diagnosis. A single `<strong>` in a
 * microcopy line took down the whole settings view while every other view kept
 * working, which reads like a data problem rather than a markup one.
 *
 * Use the components instead: `<Text format={{ fontWeight: 'bold' }}>`.
 */

const UI_DIRS = ['pages', 'cards', 'settings'].map(d => path.join(__dirname, '..', d));

/** Elements a React author reaches for by habit, none of which exist here. */
const RAW_ELEMENTS = /<\/?(strong|b|em|i|u|span|div|p|br|hr|ul|ol|li|code|pre|h[1-6]|small|a)(\s|>|\/)/;

function tsxFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.tsx'))
    .map(f => path.join(dir, f));
}

describe('UI extensions use HubSpot components, never raw HTML', () => {
  const files = UI_DIRS.flatMap(tsxFiles);

  it('finds some components to check', () => {
    // Guards against the glob silently matching nothing and the suite passing
    // for the wrong reason.
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s contains no raw DOM elements', file => {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const offenders = lines
      .map((line, i) => ({ line: line.trim(), number: i + 1 }))
      .filter(({ line }) => RAW_ELEMENTS.test(line))
      // Comments describing the rule are not breaking it.
      .filter(({ line }) => !line.startsWith('*') && !line.startsWith('//'));

    expect(
      offenders.map(o => `line ${o.number}: ${o.line}`),
      'use a HubSpot component — e.g. <Text format={{ fontWeight: "bold" }}> instead of <strong>',
    ).toEqual([]);
  });
});

/**
 * The Linear settings form must exist exactly once.
 *
 * It is reached from two places — the Content Command Center page and the
 * app's Settings tab — and the last time that was true there were two copies.
 * Three changes landed in the one nobody could see while the one people used
 * stayed unchanged (#60). A second copy is the specific regression worth
 * failing a build over.
 */
describe('one settings form, two entrances', () => {
  it('declares the form in exactly one file anyone may edit', () => {
    // Copying is unavoidable: HubSpot bundles each extension directory in
    // isolation, so the settings extension cannot import across into pages/.
    // What must never happen again is a copy someone can EDIT — that is how
    // three changes landed in the invisible one (#60). Any second declaration
    // has to be generated and say so.
    const declaring = UI_DIRS
      .flatMap(tsxFiles)
      .filter(f => /function LinearSettingsForm/.test(fs.readFileSync(f, 'utf8')));

    const editable = declaring.filter(
      f => !fs.readFileSync(f, 'utf8').startsWith('// GENERATED FILE'));

    expect(editable.map(f => path.basename(f))).toEqual(['LinearSettingsForm.tsx']);
    expect(editable.map(f => path.basename(path.dirname(f)))).toEqual(['pages']);
    // And the generated one does exist, so the settings surface has a form.
    expect(declaring.length).toBe(2);
  });

  it('the settings surface imports the form rather than defining one', () => {
    const settings = fs.readFileSync(
      path.join(__dirname, '..', 'settings', 'SettingsPage.tsx'), 'utf8');

    expect(settings).toMatch(/import \{ LinearSettingsForm \}/);
    // The giveaways of a hand-written copy: its own state, its own API calls.
    expect(settings).not.toMatch(/useState|callApi|hubspot\.serverless/);
  });
});
