import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * The vault template ships no runtime code, so these checks are structural.
 *
 * The important one is the id assertion: prompts are deliberately self-contained,
 * which means a stale portal or object-type id inside one cannot be caught by
 * anything on the Cowork side. It would just read the wrong portal.
 */

const ROOT = path.resolve(__dirname, '../../../vault-template');

const REQUIRED_DIRS = [
  'daily', 'meetings', 'content', 'changelogs',
  'references', 'references/enterpret/themes',
  'templates', 'prompts',
];

const TEMPLATES = [
  'content-brief.md', 'changelog.md', 'meeting-note.md',
  'enterpret-theme.md', 'daily-note.md',
];

const PROMPTS = [
  'README.md', 'enterpret-sync.md', 'weekly-content-planning.md',
  'coverage-gaps.md', 'changelog-from-linear.md', 'daily-pipeline-digest.md',
];

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('vault template structure', () => {
  it.each(REQUIRED_DIRS)('%s exists', dir => {
    expect(fs.statSync(path.join(ROOT, dir)).isDirectory()).toBe(true);
  });

  // Git does not track empty directories. Without .gitkeep these vanish on
  // clone — the same way assets/ and styles/ did earlier in this project.
  it.each(REQUIRED_DIRS)('%s has a .gitkeep so it survives a clone', dir => {
    expect(fs.existsSync(path.join(ROOT, dir, '.gitkeep'))).toBe(true);
  });

  it('has a README', () => {
    expect(read('README.md')).toContain('linkage contract');
  });
});

describe('note templates', () => {
  it.each(TEMPLATES)('%s exists and opens with YAML frontmatter', file => {
    const body = read(path.join('templates', file));
    expect(body.startsWith('---\n')).toBe(true);
    expect(body.indexOf('\n---', 3)).toBeGreaterThan(0);
  });

  it.each(['content-brief.md', 'changelog.md'])(
    '%s points at content_piece, never the vestigial changelog_entry',
    file => {
      const body = read(path.join('templates', file));
      expect(body).toContain('hubspot_object: content_piece');
      // Assert on the actual mistake — using it as the object — not on any
      // mention. changelog.md deliberately names it in a comment explaining
      // why it must not be used, and that explanation is worth keeping.
      expect(body).not.toContain('hubspot_object: changelog_entry');
    },
  );

  it('changelog template uses the changelog pipeline', () => {
    expect(read('templates/changelog.md')).toContain('hubspot_pipeline: changelog');
  });

  it('enterpret theme template uses a sentiment normaliseSentiment produces', () => {
    const body = read('templates/enterpret-theme.md');
    expect(['positive', 'negative', 'neutral'].some(s =>
      body.includes(`dominant_sentiment: ${s}`))).toBe(true);
  });
});

describe('Cowork prompts', () => {
  it.each(PROMPTS)('%s exists', file => {
    expect(fs.existsSync(path.join(ROOT, 'prompts', file))).toBe(true);
  });

  it.each(PROMPTS.filter(f => f !== 'README.md'))(
    '%s carries the unverified banner',
    file => {
      expect(read(path.join('prompts', file))).toContain('Unverified');
    },
  );

  // The load-bearing assertion. Every id a prompt embeds must match the codebase.
  it('every id in every prompt matches portal-config', () => {
    const config = fs.readFileSync(
      path.resolve(__dirname, '../lib/portal-config.ts'), 'utf8');

    const KNOWN = ['51869810', '2-67505887', '2-67505890', '926238627', '929918080'];
    for (const id of KNOWN) expect(config).toContain(id);

    for (const file of PROMPTS) {
      const body = read(path.join('prompts', file));
      // object type ids look like 2-XXXXXXXX; every one must be real
      for (const m of body.matchAll(/\b2-\d{7,9}\b/g)) {
        expect(config, `${file} references unknown object type ${m[0]}`)
          .toContain(m[0]);
      }
      // 9-10 digit ids in prompts are portals or pipelines; all must be real
      for (const m of body.matchAll(/\b\d{9,10}\b/g)) {
        expect(config, `${file} references unknown id ${m[0]}`).toContain(m[0]);
      }
    }
  });

  it('no prompt uses the changelog pipeline against staging or prod', () => {
    for (const file of PROMPTS) {
      const body = read(path.join('prompts', file));
      if (body.includes('929918080')) {
        expect(body, `${file} must scope changelog work to dev`).toContain('51869810');
        expect(body).not.toContain('51869787');
        expect(body).not.toContain('22047910');
      }
    }
  });
});
