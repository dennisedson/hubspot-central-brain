import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SOURCE, TARGET, GENERATED_HEADER, render } from '../../scripts/sync-settings-form';

/**
 * The settings form exists in two directories because HubSpot bundles each
 * extension in isolation and an import cannot leave one:
 *
 *   Could not resolve "../pages/LinearSettingsForm.tsx"
 *     from "../../tmp/app/settings/SettingsPage.tsx"
 *
 * Copying is therefore unavoidable. What made the 2026-09-29 duplication
 * harmful was not the copy — it was that both copies were editable and nothing
 * noticed when they diverged. Three changes landed in the one nobody could see.
 *
 * This test is what makes the copy safe. Edit the source and forget to
 * regenerate, or edit the generated file directly, and the build fails here
 * rather than at a deploy or, worse, not at all.
 */
describe('the generated settings form', () => {
  it('matches the source it was generated from', () => {
    const source = readFileSync(SOURCE, 'utf8');
    const target = readFileSync(TARGET, 'utf8');

    expect(
      target,
      'settings form is stale — run: npm run sync:settings-form',
    ).toBe(render(source));
  });

  it('says it is generated, in its first line', () => {
    const target = readFileSync(TARGET, 'utf8');
    expect(target.startsWith('// GENERATED FILE — DO NOT EDIT.')).toBe(true);
    expect(target).toContain('npm run sync:settings-form');
  });

  it('names the one file anyone should edit', () => {
    expect(GENERATED_HEADER).toContain('src/app/pages/LinearSettingsForm.tsx');
  });

  it('is not what the source file is — the source carries no generated header', () => {
    // Guards against the sync being run backwards.
    expect(readFileSync(SOURCE, 'utf8')).not.toContain('GENERATED FILE');
  });
});
