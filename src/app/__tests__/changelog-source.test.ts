import { describe, it, expect } from 'vitest';
import {
  parseRolloutNotes,
  missingForStandalone,
  formatSourceForModel,
  THIN_DESCRIPTION,
} from '../lib/changelog-source';

/**
 * Fixtures taken from the shape of real production records — all 70 changelog
 * records carry `notes`, the Linear issue description, and for rollout issues
 * that is this template.
 */

const FULL = `## New Rollout Created

**Rollout ID:** 310955
**Name:** hs app logs CLI command
**Gate Name:** DeveloperPlatformLogging:ExternalDeveloperLogs
**State:** In Development
**Type:** ADDITIONAL_FUNCTIONALITY
**Hub:** Developers & Builders

### People

**Owner:** chardy
**Product Config DRI:** mameligrillon
**UX DRI:** tserkes

### Scope

**Products:** hubspot-free
**Audiences:** API developer, App partner, CRM developer
**Use Cases:** Automate work, Manage data, Assist work

### Impact

**Frequency of Use:** OCCASIONAL
**User Impact:** MODERATE
**Delivery Method:** AUTOMATIC

### Description

##### Description

Developers can now fetch all app logs, including serverless functions, CRM cards, webhooks, and API calls, directly to their terminal via a CLI command with support for filtering and structured output.`;

/** The ~29% shape: header fields only, no Scope or Impact blocks. */
const SPARSE = `## New Rollout Created

**Rollout ID:** 299001
**Name:** Something smaller
**State:** Live
**Hub:** Developers & Builders

### Description

Blog pages will soon be copied from your production portal when a sandbox is created.`;

describe('parseRolloutNotes', () => {
  it('reads the structured fields', () => {
    const s = parseRolloutNotes(FULL);
    expect(s.fields['Name']).toBe('hs app logs CLI command');
    expect(s.fields['State']).toBe('In Development');
    expect(s.fields['Type']).toBe('ADDITIONAL_FUNCTIONALITY');
    expect(s.fields['Audiences']).toBe('API developer, App partner, CRM developer');
    expect(s.fields['User Impact']).toBe('MODERATE');
  });

  it('extracts the description from under its heading', () => {
    // The real records nest `##### Description` inside `### Description`.
    const s = parseRolloutNotes(FULL);
    expect(s.description).toContain('fetch all app logs');
    expect(s.description).not.toContain('**Rollout ID:**');
  });

  it('keeps the raw notes whatever happens', () => {
    // The template is not a contract — it is whatever a human pasted in.
    const s = parseRolloutNotes('nothing structured at all');
    expect(s.raw).toBe('nothing structured at all');
    expect(s.fields).toEqual({});
    expect(s.description).toBeNull();
  });

  it('survives empty or missing notes', () => {
    for (const input of ['', null, undefined]) {
      const s = parseRolloutNotes(input);
      expect(s.fields).toEqual({});
      expect(s.description).toBeNull();
      expect(s.raw).toBe('');
    }
  });

  it('takes the first occurrence of a repeated label', () => {
    // The header block is authoritative; the description repeats some labels.
    const s = parseRolloutNotes('**State:** Live\n\n### Description\n\n**State:** stale copy');
    expect(s.fields['State']).toBe('Live');
  });
});

describe('missingForStandalone', () => {
  it('is empty when the record has what the format leans on', () => {
    expect(missingForStandalone(parseRolloutNotes(FULL))).toEqual([]);
  });

  it('names what a sparse record lacks, so nobody finds out from a thin draft', () => {
    const missing = missingForStandalone(parseRolloutNotes(SPARSE));
    expect(missing).toContain('Type');
    expect(missing).toContain('Audiences');
    expect(missing).toContain('Use Cases');
    expect(missing).toContain('User Impact');
  });

  it('flags a description too short to carry a post', () => {
    // One production record's description is three characters long.
    const s = parseRolloutNotes('**Type:** X\n**Audiences:** Y\n**Use Cases:** Z\n**User Impact:** W\n\n### Description\n\nTBD');
    expect(missingForStandalone(s)).toEqual(['a usable Description']);
    expect('TBD'.length).toBeLessThan(THIN_DESCRIPTION);
  });

  it('distinguishes a missing description from a thin one', () => {
    const none = parseRolloutNotes('**Type:** X\n**Audiences:** Y\n**Use Cases:** Z\n**User Impact:** W');
    expect(missingForStandalone(none)).toEqual(['Description']);
  });
});

describe('formatSourceForModel', () => {
  it('leads with the structure and still hands over the whole of notes', () => {
    const out = formatSourceForModel(parseRolloutNotes(FULL), 'A record');
    expect(out).toContain('Record title: A record');
    expect(out).toContain('- Audiences: API developer, App partner, CRM developer');
    expect(out).toContain('fetch all app logs');
    // Verbatim notes survive, because the parse is lossy by design.
    expect(out).toContain('**Gate Name:** DeveloperPlatformLogging:ExternalDeveloperLogs');
  });

  it('still produces something usable when nothing parsed', () => {
    const out = formatSourceForModel(parseRolloutNotes('just a sentence'), 'Untitled');
    expect(out).toContain('just a sentence');
  });
});
