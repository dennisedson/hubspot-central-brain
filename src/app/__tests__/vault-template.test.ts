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
  'promote-note.md',
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

  // A half-done substitution leaves a link that opens nothing, and Obsidian
  // gives no useful error for it.
  it('no unsubstituted vault-name placeholder survives', () => {
    for (const file of PROMPTS) {
      expect(read(path.join('prompts', file)), `${file} still has a placeholder`)
        .not.toContain('<VAULT_NAME>');
    }
    expect(read('README.md')).not.toContain('<vault-name>');
  });

  // The vault name contains a space, so every obsidian:// URI must carry it
  // percent-encoded. A raw space silently produces a link that will not open.
  it('obsidian URIs percent-encode the vault name', () => {
    for (const file of [...PROMPTS.map(f => path.join('prompts', f)), 'README.md']) {
      const body = read(file);
      for (const m of body.matchAll(/obsidian:\/\/open\?vault=([^&\s]*)/g)) {
        expect(m[1], `${file} has an unencoded vault name`).not.toContain(' ');
        expect(m[1]).toBe('Dev-Central-Brain');
      }
    }
  });

  it('no prompt uses the changelog pipeline against prod', () => {
    for (const file of PROMPTS) {
      const body = read(path.join('prompts', file));
      if (body.includes('929918080')) {
        expect(body, `${file} must scope changelog work to dev`).toContain('51869810');
        expect(body).not.toContain('22047910');
      }
    }
  });
});

/**
 * The vault's one front door.
 *
 * Ideas never reach HubSpot on their own — the vault IS the idea stage. Ticking
 * `promote` on a note is the moment somebody decides the work is real, and it
 * lands the record at Outline, which is the threshold where the app creates the
 * Linear issue and the Asana task.
 *
 * None of this can be tested by running it: the prompt executes in Cowork on a
 * different machine, against a live portal. These checks pin the facts that a
 * human reading the prompt cannot verify for themselves — the stage id above
 * all, because Outline and Idea differ by one digit and picking the wrong one
 * produces a record that looks created and fans out to nothing.
 */
describe('the vault promotion path', () => {
  it('content-brief carries a promote switch, defaulting to off', () => {
    const body = read('templates/content-brief.md');
    // Obsidian renders a frontmatter boolean as a checkbox in the properties
    // panel — which is the entire user interface for this feature.
    expect(body).toContain('promote: false');
  });

  it('the promote switch sits in frontmatter, not in the note body', () => {
    const body = read('templates/content-brief.md');
    const frontmatter = body.slice(0, body.indexOf('\n---', 3));
    expect(frontmatter).toContain('promote: false');
  });

  // Changelog notes are born from a Linear issue that already exists, and their
  // pipeline has no Outline stage to promote into. A switch there would be a
  // control that does nothing.
  it('the changelog template has no promote switch', () => {
    expect(read('templates/changelog.md')).not.toContain('promote:');
  });

  it('the promote prompt targets Outline, never Idea', () => {
    const body = read('prompts/promote-note.md');
    // 1418660000 is Outline on dev; 1418659999 is Idea. One digit apart.
    expect(body).toContain('1418660000');
    expect(body).toContain('"hs_pipeline_stage":"1418660000"');
  });

  it('the promote prompt writes both halves of the identity contract', () => {
    const body = read('prompts/promote-note.md');
    // Note → record, and record → note. Missing either leaves a link that only
    // works in one direction, which nobody notices until they need the other.
    expect(body).toContain('hubspot_id');
    expect(body).toContain('source_url');
    expect(body).toContain('obsidian://open?vault=Dev-Central-Brain');
  });

  it('the promote prompt guards against promoting the same note twice', () => {
    const body = read('prompts/promote-note.md');
    expect(body.toLowerCase()).toContain('hubspot_id` is already set');
  });

  // changelog-from-linear.md step 3 creates a record LinearWebhook has already
  // created. Running it today produces two records for one issue, and both look
  // correct. The prompt is not rewritten here — it is flagged, loudly, at the top.
  it('changelog-from-linear warns about the duplicate it creates', () => {
    const body = read('prompts/changelog-from-linear.md');
    const top = body.slice(0, 1200);
    expect(top).toContain('LinearWebhook');
    expect(top.toLowerCase()).toMatch(/two records|duplicate/);
  });

  it('the promote prompt is listed in the prompts README', () => {
    expect(read('prompts/README.md')).toContain('`promote-note.md`');
  });
});
