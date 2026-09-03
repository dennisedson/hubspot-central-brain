import { describe, it, expect } from 'vitest';
import {
  associationLabelsPath,
  schemaAssociationsPath,
  HS_BASE,
  HS_API_VERSION,
  objectPath,
  objectSearchPath,
  objectBatchReadPath,
  associationListPath,
  defaultAssociationPath,
  labeledAssociationPath,
  associationBatchCreatePath,
  propertiesPath,
  schemasPath,
  pipelinesPath,
  datedObjectPath,
  datedObjectSearchPath,
} from '../lib/hs-api';

/**
 * These are exact-literal assertions on purpose.
 *
 * They are the safety net for the issue #14 migration off non-date-based API
 * versions. When someone flips a builder from `/crm/v3/…` to a dated path, the
 * failing assertion here is the signal that every call site using that builder
 * just moved with it — and the diff of this file is the record of which
 * families moved and which did not.
 *
 * Do not soften these into regexes or `toContain`.
 */
describe('hs-api constants', () => {
  it('points at the HubSpot API host', () => {
    expect(HS_BASE).toBe('https://api.hubapi.com');
  });

  it('pins the dated API version', () => {
    expect(HS_API_VERSION).toBe('2026-03');
  });
});

describe('objectPath', () => {
  it('builds a collection path when no id is given', () => {
    expect(objectPath('2-67505887')).toBe('/crm/objects/2026-03/2-67505887');
  });

  it('builds a single-record path when an id is given', () => {
    expect(objectPath('2-67505887', '4201')).toBe('/crm/objects/2026-03/2-67505887/4201');
  });

  it('accepts a standard object name as the object type', () => {
    expect(objectPath('contacts', 'dennis%40example.com')).toBe(
      '/crm/objects/2026-03/contacts/dennis%40example.com',
    );
  });

  it('interpolates verbatim — encoding is the call site\'s job', () => {
    // Builders never percent-encode. Call sites that need encodeURIComponent
    // apply it to the argument themselves, exactly as they did before the
    // paths were centralised here.
    expect(objectPath('contacts', 'a b/c')).toBe('/crm/objects/2026-03/contacts/a b/c');
  });
});

describe('objectSearchPath', () => {
  it('builds the CRM search path for an object type', () => {
    expect(objectSearchPath('2-67505887')).toBe('/crm/objects/2026-03/2-67505887/search');
  });
});

describe('objectBatchReadPath', () => {
  it('builds the batch read path for an object type', () => {
    expect(objectBatchReadPath('meetings')).toBe('/crm/objects/2026-03/meetings/batch/read');
  });
});

describe('association paths', () => {
  it('lists associations from one record to an object type', () => {
    expect(associationListPath('contacts', '551', 'meetings')).toBe(
      '/crm/v4/objects/contacts/551/associations/meetings',
    );
  });

  it('builds the default (unlabeled) association path between two records', () => {
    expect(defaultAssociationPath('2-67505887', '10', '2-67505887', '20')).toBe(
      '/crm/v4/objects/2-67505887/10/associations/default/2-67505887/20',
    );
  });

  it('builds the labeled association path between two records', () => {
    // Issue #3: the path AssociateRelatedContent PUTs to. Same shape as
    // defaultAssociationPath minus the `default` segment — the association type
    // travels in the body instead.
    expect(labeledAssociationPath('2-67505887', '10', '2-67505887', '20')).toBe(
      '/crm/v4/objects/2-67505887/10/associations/2-67505887/20',
    );
  });

  it('never emits the default segment — that endpoint has no self-referential definition', () => {
    expect(labeledAssociationPath('2-67505887', '10', '2-67505887', '20')).not.toContain(
      '/associations/default/',
    );
  });

  it('extends associationListPath with the target record id', () => {
    expect(labeledAssociationPath('2-1', '10', '2-2', '20')).toBe(
      `${associationListPath('2-1', '10', '2-2')}/20`,
    );
  });

  it('builds the batch create path between two object types', () => {
    expect(associationBatchCreatePath('projects', 'contacts')).toBe(
      '/crm/v4/associations/projects/contacts/batch/create',
    );
  });
});

describe('propertiesPath', () => {
  it('builds the property collection path for an object type', () => {
    expect(propertiesPath('2-67505887')).toBe('/crm/v3/properties/2-67505887');
  });

  it('builds a single property path when a name is given', () => {
    expect(propertiesPath('2-67505887', 'linear_id')).toBe(
      '/crm/v3/properties/2-67505887/linear_id',
    );
  });
});

describe('schemasPath', () => {
  it('builds the schemas path with no trailing query string', () => {
    // Callers append their own `?limit=100`.
    expect(schemasPath()).toBe('/crm/v3/schemas');
    expect(`${schemasPath()}?limit=100`).toBe('/crm/v3/schemas?limit=100');
  });
});

describe('pipelinesPath', () => {
  it('builds the pipeline collection path for an object type', () => {
    expect(pipelinesPath('projects')).toBe('/crm/v3/pipelines/projects');
  });

  it('builds a single pipeline path when a pipeline id is given', () => {
    expect(pipelinesPath('2-67505887', 'pipe-1')).toBe('/crm/v3/pipelines/2-67505887/pipe-1');
  });
});

describe('dated builders (already migrated)', () => {
  it('builds a dated collection path', () => {
    expect(datedObjectPath('projects')).toBe('/crm/objects/2026-03/projects');
  });

  it('builds a dated single-record path', () => {
    expect(datedObjectPath('projects', '9001')).toBe('/crm/objects/2026-03/projects/9001');
  });

  it('builds a dated search path', () => {
    expect(datedObjectSearchPath('projects')).toBe('/crm/objects/2026-03/projects/search');
  });

  it('derives its version segment from HS_API_VERSION', () => {
    expect(datedObjectPath('projects')).toBe(`/crm/objects/${HS_API_VERSION}/projects`);
  });
});

/**
 * The split is the whole point of this module: some families are migrated and
 * some are not. This block states which is which, so the state of the #14
 * migration is readable from the test output rather than from grep.
 */
describe('migration status (issue #14)', () => {
  const legacyBuilders: Array<[string, string]> = [
    ['associationListPath', associationListPath('contacts', '5', 'meetings')],
    ['defaultAssociationPath', defaultAssociationPath('2-1', '5', '2-1', '6')],
    ['labeledAssociationPath', labeledAssociationPath('2-1', '5', '2-1', '6')],
    ['associationBatchCreatePath', associationBatchCreatePath('projects', 'contacts')],
    ['propertiesPath', propertiesPath('2-1')],
    ['schemasPath', schemasPath()],
    ['pipelinesPath', pipelinesPath('2-1')],
  ];

  const datedBuilders: Array<[string, string]> = [
    // Migrated 2026-09-02: the objects family moved with a one-line change to
    // OBJECTS_V3. The 56 failing URL assertions that produced were the audit
    // trail confirming every call site moved with it.
    ['objectPath', objectPath('2-1', '5')],
    ['objectSearchPath', objectSearchPath('2-1')],
    ['objectBatchReadPath', objectBatchReadPath('2-1')],
    ['datedObjectPath', datedObjectPath('projects', '1')],
    ['datedObjectSearchPath', datedObjectSearchPath('projects')],
  ];

  it.each(legacyBuilders)(
    '%s is STILL LEGACY — emits a non-dated /crm/vN/ path',
    (_name, path) => {
      expect(path).toMatch(/^\/crm\/v[34]\//);
      expect(path).not.toContain(HS_API_VERSION);
    },
  );

  it.each(datedBuilders)('%s is ALREADY DATED — emits /crm/objects/<version>/', (_name, path) => {
    expect(path.startsWith(`/crm/objects/${HS_API_VERSION}/`)).toBe(true);
    expect(path).not.toMatch(/\/crm\/v[34]\//);
  });

  it('CRM objects and Fellow projects now share one dated shape', () => {
    // Before the migration these two produced different shapes. They are now
    // identical, which is the clearest single statement that objects moved.
    expect(objectSearchPath('projects')).toBe('/crm/objects/2026-03/projects/search');
    expect(datedObjectSearchPath('projects')).toBe('/crm/objects/2026-03/projects/search');
  });
});

// Added for the association-definition provisioning (issue #3). These belong in
// the migration checklist alongside every other legacy builder.
describe('association definition builders', () => {
  it('associationLabelsPath is still on legacy v4', () => {
    expect(associationLabelsPath('2-67505887', '2-67505887')).toBe(
      '/crm/v4/associations/2-67505887/2-67505887/labels',
    );
  });

  it('associationLabelsPath handles a cross-type pairing', () => {
    expect(associationLabelsPath('2-67505887', '2-67505890')).toBe(
      '/crm/v4/associations/2-67505887/2-67505890/labels',
    );
  });

  it('schemaAssociationsPath is on the dated 2026-03 surface', () => {
    expect(schemaAssociationsPath('2-67505887')).toBe(
      '/crm/v3/schemas/2-67505887/associations',
    );
  });
});
