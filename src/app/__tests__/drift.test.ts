import { describe, it, expect } from 'vitest';
import {
  resolvePipeline,
  stageNameFromId,
  computeLinearDrift,
  computeAsanaDrift,
} from '../lib/drift';
import type { PortalConfig } from '../lib/portal-config';

const config = {
  content: {
    objectTypeId: '2-1',
    pipelines: {
      content: {
        pipelineId: 'pipe-content',
        stageIds: { idea: 's1', outline: 's2', drafting: 's3', editing: 's4', review: 's5', published: 's6', archived: 's7' },
      },
      changelog: {
        pipelineId: 'pipe-changelog',
        stageIds: { identified: 'c1', drafting: 'c2', reviewing: 'c3', published: 'c4' },
      },
    },
  },
} as unknown as PortalConfig;

describe('resolvePipeline', () => {
  it('identifies the content pipeline', () => {
    expect(resolvePipeline(config, 'pipe-content')).toBe('content');
  });

  it('identifies the changelog pipeline', () => {
    expect(resolvePipeline(config, 'pipe-changelog')).toBe('changelog');
  });

  it('returns null for an unknown pipeline', () => {
    expect(resolvePipeline(config, 'pipe-nope')).toBeNull();
  });
});

describe('stageNameFromId', () => {
  it('reverses a content stage id to its name', () => {
    expect(stageNameFromId(config, 'content', 's4')).toBe('editing');
  });

  it('reverses a changelog stage id to its name', () => {
    expect(stageNameFromId(config, 'changelog', 'c3')).toBe('reviewing');
  });

  it('returns null for an unknown stage id', () => {
    expect(stageNameFromId(config, 'content', 'nope')).toBeNull();
  });
});

describe('computeLinearDrift', () => {
  it('reports in sync when forward mapping matches', () => {
    const r = computeLinearDrift('content', 'drafting', 'In Progress');
    expect(r).toEqual({ inSync: true, expectedState: 'In Progress', actualState: 'In Progress' });
  });

  it('reports in sync for editing vs In Progress', () => {
    const r = computeLinearDrift('content', 'editing', 'In Progress');
    expect(r?.inSync).toBe(true);
  });

  it('reports in sync for identified vs Canceled on changelog', () => {
    const r = computeLinearDrift('changelog', 'identified', 'Canceled');
    expect(r?.inSync).toBe(true);
  });

  it('reports drift on a genuine mismatch', () => {
    const r = computeLinearDrift('content', 'drafting', 'Done');
    expect(r).toEqual({ inSync: false, expectedState: 'In Progress', actualState: 'Done' });
  });

  it('uses the changelog table for changelog records', () => {
    const r = computeLinearDrift('changelog', 'reviewing', 'In Review');
    expect(r?.inSync).toBe(true);
  });

  it('returns null when the state maps nowhere', () => {
    expect(computeLinearDrift('content', 'drafting', 'Triage')).toBeNull();
  });
});

describe('computeAsanaDrift', () => {
  it('reports in sync when the enum gid matches', () => {
    const r = computeAsanaDrift('content', 'drafting', '1202184607667441');
    expect(r?.inSync).toBe(true);
  });

  it('reports in sync for editing, which shares the In Progress gid', () => {
    const r = computeAsanaDrift('content', 'editing', '1202184607667441');
    expect(r?.inSync).toBe(true);
  });

  it('reports drift on a genuine mismatch', () => {
    const r = computeAsanaDrift('content', 'drafting', '1202212684793528');
    expect(r?.inSync).toBe(false);
  });

  it('returns null for an unknown gid', () => {
    expect(computeAsanaDrift('content', 'drafting', '999')).toBeNull();
  });
});
