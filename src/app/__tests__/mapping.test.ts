import { describe, it, expect } from 'vitest';
import {
  SYNC_SOURCE_TAG,
  linearChangelogMappings,
  asanaContentMappings,
} from '../lib/mapping';

describe('mapping config', () => {
  it('has a sync source tag', () => {
    expect(SYNC_SOURCE_TAG).toBe('hubspot-central-brain');
  });

  it('linear changelog mappings have required fields', () => {
    const hubspotFields = linearChangelogMappings.map((m) => m.hubspot);
    expect(hubspotFields).toContain('title');
    expect(hubspotFields).toContain('linear_issue_id');
    expect(hubspotFields).toContain('linear_issue_url');
  });

  it('asana content mappings set hubspot as owner for title', () => {
    const titleMapping = asanaContentMappings.find(
      (m) => m.hubspot === 'title'
    );
    expect(titleMapping?.owner).toBe('hubspot');
  });

  it('all mappings have valid owner values', () => {
    const allMappings = [
      ...linearChangelogMappings,
      ...asanaContentMappings,
    ];
    for (const mapping of allMappings) {
      expect(['hubspot', 'external']).toContain(mapping.owner);
    }
  });
});
