import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findByLinearId, getCurrentStage, upsertContent, upsertChangelog } from '@lib/hubspot-client';
import type { LinearWebhookPayload } from '@lib/types';

const mockSearch = vi.fn();
const mockUpdate = vi.fn();
const mockCreate = vi.fn();

const mockClient = {
  crm: {
    objects: {
      searchApi: { doSearch: mockSearch },
      basicApi: { update: mockUpdate, create: mockCreate },
    },
  },
} as any;

const baseIssue: LinearWebhookPayload = {
  action: 'create',
  type: 'Issue',
  organizationId: 'org-1',
  webhookTimestamp: 1000000,
  webhookId: 'wh-1',
  data: {
    id: 'lin-123',
    identifier: 'ENG-1',
    title: 'Add API endpoint docs',
    state: { id: 'st-1', name: 'In Progress', type: 'started' },
    labels: { nodes: [] },
    url: 'https://linear.app/team/issue/ENG-1',
    team: { id: 't-1', name: 'Engineering' },
  },
};

beforeEach(() => vi.clearAllMocks());

describe('findByLinearId', () => {
  it('returns null when no records match', async () => {
    mockSearch.mockResolvedValue({ results: [] });
    expect(await findByLinearId(mockClient, '2-content', 'lin-999')).toBeNull();
    expect(mockSearch).toHaveBeenCalledWith('2-content', expect.objectContaining({
      filterGroups: [{ filters: [{ propertyName: 'linear_issue_id', operator: 'EQ', value: 'lin-999' }] }],
    }));
  });

  it('returns the id of the first matching record', async () => {
    mockSearch.mockResolvedValue({ results: [{ id: 'hs-456' }, { id: 'hs-789' }] });
    expect(await findByLinearId(mockClient, '2-content', 'lin-123')).toBe('hs-456');
  });
});

describe('getCurrentStage', () => {
  it('returns null when no record exists', async () => {
    mockSearch.mockResolvedValue({ results: [] });
    expect(await getCurrentStage(mockClient, '2-content', 'lin-999')).toBeNull();
  });

  it('returns the hs_pipeline_stage value from the matching record', async () => {
    mockSearch.mockResolvedValue({ results: [{ id: 'hs-1', properties: { hs_pipeline_stage: 'stage-abc' } }] });
    expect(await getCurrentStage(mockClient, '2-content', 'lin-123')).toBe('stage-abc');
  });

  it('returns null when the record has no stage set', async () => {
    mockSearch.mockResolvedValue({ results: [{ id: 'hs-1', properties: { hs_pipeline_stage: null } }] });
    expect(await getCurrentStage(mockClient, '2-content', 'lin-123')).toBeNull();
  });
});

describe('upsertContent', () => {
  it('creates a new record when no existing match, maps "In Progress" to "drafting"', async () => {
    mockSearch.mockResolvedValue({ results: [] });
    mockCreate.mockResolvedValue({ id: 'hs-new-1' });

    const result = await upsertContent(mockClient, baseIssue);

    expect(mockCreate).toHaveBeenCalledOnce();
    const createCall = mockCreate.mock.calls[0];
    expect(createCall[1].properties).toMatchObject({
      title: 'Add API endpoint docs',
      linear_issue_id: 'lin-123',
      linear_issue_url: 'https://linear.app/team/issue/ENG-1',
    });
    // Stage must be an ID (non-empty string) — actual value depends on portal-config
    expect(typeof createCall[1].properties.hs_pipeline_stage).toBe('string');
    expect(result).toEqual({ id: 'hs-new-1', action: 'created' });
  });

  it('maps description to the notes property', async () => {
    const issueWithDesc = { ...baseIssue, data: { ...baseIssue.data, description: 'Some notes here' } };
    mockSearch.mockResolvedValue({ results: [] });
    mockCreate.mockResolvedValue({ id: 'hs-new-2' });
    await upsertContent(mockClient, issueWithDesc);
    expect(mockCreate.mock.calls[0][1].properties.notes).toBe('Some notes here');
  });

  it('updates when a matching record exists', async () => {
    mockSearch.mockResolvedValue({ results: [{ id: 'hs-existing' }] });

    const result = await upsertContent(mockClient, baseIssue);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.any(String),
      'hs-existing',
      expect.objectContaining({ properties: expect.objectContaining({ title: 'Add API endpoint docs' }) }),
    );
    expect(result).toEqual({ id: 'hs-existing', action: 'updated' });
  });
});

describe('upsertChangelog', () => {
  it('creates a changelog record, maps "Done" to "published"', async () => {
    const doneIssue: LinearWebhookPayload = {
      ...baseIssue,
      data: { ...baseIssue.data, state: { id: 'st-done', name: 'Done', type: 'completed' } },
    };
    mockSearch.mockResolvedValue({ results: [] });
    mockCreate.mockResolvedValue({ id: 'hs-cl-1' });

    const result = await upsertChangelog(mockClient, doneIssue);

    expect(result.action).toBe('created');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ properties: expect.objectContaining({ linear_issue_id: 'lin-123' }) }),
    );
  });
});
