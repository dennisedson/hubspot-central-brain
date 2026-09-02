import { describe, it, expect, vi, beforeEach } from 'vitest';

let main: (ctx: any) => Promise<any>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  vi.doMock('@lib/hubspot-client', () => ({
    getFellowLastSync: vi.fn().mockResolvedValue(null),
    setFellowLastSync: vi.fn().mockResolvedValue(undefined),
    findContactByEmail: vi.fn().mockResolvedValue('contact-1'),
    upsertFellowProject: vi.fn().mockResolvedValue({ id: 'proj-1', action: 'created' }),
    associateProjectToContact: vi.fn().mockResolvedValue(undefined),
  }));

  vi.doMock('@lib/fellow-client', () => ({
    pollFellowActionItems: vi.fn().mockResolvedValue([]),
    getFellowMeetingParticipants: vi.fn().mockResolvedValue([]),
  }));

  vi.doMock('@lib/portal-config', () => ({
    getPortalConfig: vi.fn().mockReturnValue({
      appConfig: { objectTypeId: '2-app' },
    }),
  }));

  process.env.FELLOW_API_KEY = 'test-key';

  const mod = await import('../functions/FellowSync');
  main = mod.main;
});

const baseCtx = {
  method: 'POST',
  headers: {},
  query: {},
  accountId: 999,
  body: { callbackId: 'cb-1', hs_object_id: 'record-1', inputFields: {} },
};

const sampleGroup = {
  noteTitle: '1:1 with Alice',
  meetingId: 'mtg-1',
  meetingStartTime: '2026-09-01T10:00:00Z',
  actionItems: [
    {
      text: 'Write the blog post',
      updatedAt: '2026-09-01T11:00:00Z',
      assignees: [{ name: 'Dennis Edson', status: 'not_done' as const }],
    },
  ],
};

describe('FellowSync.main', () => {
  it('returns 500 when FELLOW_API_KEY is missing', async () => {
    delete process.env.FELLOW_API_KEY;
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toBe('Server misconfiguration');
  });

  it('returns 400 when hs_object_id is missing', async () => {
    const ctx = { ...baseCtx, body: { ...baseCtx.body, hs_object_id: undefined } };
    const result = await main(ctx);
    expect(result.statusCode).toBe(400);
  });

  it('returns success with zero counts when no action items', async () => {
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.outputFields.syncStatus).toBe('success');
    expect(body.outputFields.projectsCreated).toBe('0');
    expect(body.outputFields.projectsUpdated).toBe('0');
  });

  it('saves sync timestamp before processing action items', async () => {
    const { setFellowLastSync: mockSet } = await import('@lib/hubspot-client');
    const { pollFellowActionItems: mockPoll } = await import('@lib/fellow-client');
    vi.mocked(mockPoll).mockResolvedValue([sampleGroup]);

    await main(baseCtx);
    expect(vi.mocked(mockSet)).toHaveBeenCalledOnce();
    expect(vi.mocked(mockSet)).toHaveBeenCalledWith('2-app', 'record-1', expect.any(String));
  });

  it('creates a project with correct properties and associates contact', async () => {
    const { upsertFellowProject: mockUpsert, associateProjectToContact: mockAssoc } = await import('@lib/hubspot-client');
    const { pollFellowActionItems: mockPoll, getFellowMeetingParticipants: mockParticipants } = await import('@lib/fellow-client');

    vi.mocked(mockPoll).mockResolvedValue([sampleGroup]);
    vi.mocked(mockParticipants).mockResolvedValue([
      { email: 'dedson@hubspot.com', name: 'Dennis Edson', isAttendee: true, isExternal: false },
    ]);

    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.outputFields.projectsCreated).toBe('1');
    expect(body.outputFields.projectsUpdated).toBe('0');

    expect(vi.mocked(mockUpsert)).toHaveBeenCalledWith(
      'mtg-1:0:dennis_edson',
      expect.objectContaining({
        hs_name: 'Write the blog post',
        hs_pipeline_stage: 'pending',
        hs_type: 'internal_ops',
        fellow_action_item_id: 'mtg-1:0:dennis_edson',
      }),
    );
    expect(vi.mocked(mockAssoc)).toHaveBeenCalledWith('proj-1', 'contact-1');
  });

  it('sets pipeline stage to "done" for completed action items', async () => {
    const { upsertFellowProject: mockUpsert } = await import('@lib/hubspot-client');
    const { pollFellowActionItems: mockPoll } = await import('@lib/fellow-client');

    const doneGroup = {
      ...sampleGroup,
      actionItems: [{ ...sampleGroup.actionItems[0], assignees: [{ name: 'Dennis Edson', status: 'done' as const }] }],
    };
    vi.mocked(mockPoll).mockResolvedValue([doneGroup]);

    await main(baseCtx);
    expect(vi.mocked(mockUpsert)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ hs_pipeline_stage: 'done' }),
    );
  });

  it('counts updated projects separately from created', async () => {
    const { upsertFellowProject: mockUpsert } = await import('@lib/hubspot-client');
    const { pollFellowActionItems: mockPoll } = await import('@lib/fellow-client');

    vi.mocked(mockPoll).mockResolvedValue([sampleGroup]);
    vi.mocked(mockUpsert).mockResolvedValue({ id: 'proj-existing', action: 'updated' });

    const result = await main(baseCtx);
    const body = JSON.parse(result.body);
    expect(body.outputFields.projectsCreated).toBe('0');
    expect(body.outputFields.projectsUpdated).toBe('1');
  });

  it('does not associate contact when updated (association already exists)', async () => {
    const { upsertFellowProject: mockUpsert, associateProjectToContact: mockAssoc } = await import('@lib/hubspot-client');
    const { pollFellowActionItems: mockPoll, getFellowMeetingParticipants: mockParticipants } = await import('@lib/fellow-client');

    vi.mocked(mockPoll).mockResolvedValue([sampleGroup]);
    vi.mocked(mockParticipants).mockResolvedValue([
      { email: 'dedson@hubspot.com', name: 'Dennis Edson', isAttendee: true, isExternal: false },
    ]);
    vi.mocked(mockUpsert).mockResolvedValue({ id: 'proj-existing', action: 'updated' });

    await main(baseCtx);
    expect(vi.mocked(mockAssoc)).not.toHaveBeenCalled();
  });

  it('does not associate when no participant email matches assignee name', async () => {
    const { associateProjectToContact: mockAssoc } = await import('@lib/hubspot-client');
    const { pollFellowActionItems: mockPoll, getFellowMeetingParticipants: mockParticipants } = await import('@lib/fellow-client');

    vi.mocked(mockPoll).mockResolvedValue([sampleGroup]);
    vi.mocked(mockParticipants).mockResolvedValue([
      { email: 'other@example.com', name: 'Someone Else', isAttendee: true, isExternal: false },
    ]);

    await main(baseCtx);
    expect(vi.mocked(mockAssoc)).not.toHaveBeenCalled();
  });

  it('continues processing when participants fetch fails', async () => {
    const { upsertFellowProject: mockUpsert } = await import('@lib/hubspot-client');
    const { pollFellowActionItems: mockPoll, getFellowMeetingParticipants: mockParticipants } = await import('@lib/fellow-client');

    vi.mocked(mockPoll).mockResolvedValue([sampleGroup]);
    vi.mocked(mockParticipants).mockRejectedValue(new Error('Fellow API down'));

    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    expect(vi.mocked(mockUpsert)).toHaveBeenCalledOnce();
  });

  it('returns 500 when portal config is not found', async () => {
    const { getPortalConfig: mockConfig } = await import('@lib/portal-config');
    vi.mocked(mockConfig).mockImplementation(() => { throw new Error('No config'); });

    const result = await main(baseCtx);
    expect(result.statusCode).toBe(500);
  });

  it('handles multiple action items across multiple meetings', async () => {
    const { upsertFellowProject: mockUpsert } = await import('@lib/hubspot-client');
    const { pollFellowActionItems: mockPoll } = await import('@lib/fellow-client');

    const group2 = {
      noteTitle: 'Team standup',
      meetingId: 'mtg-2',
      meetingStartTime: '2026-09-01T09:00:00Z',
      actionItems: [
        { text: 'Review PR', updatedAt: '', assignees: [{ name: 'Alice', status: 'not_done' as const }] },
        { text: 'Update docs', updatedAt: '', assignees: [{ name: 'Bob', status: 'not_done' as const }] },
      ],
    };
    vi.mocked(mockPoll).mockResolvedValue([sampleGroup, group2]);

    const result = await main(baseCtx);
    expect(JSON.parse(result.body).outputFields.projectsCreated).toBe('3');
    expect(vi.mocked(mockUpsert)).toHaveBeenCalledTimes(3);
  });

  it('continues when one upsert fails', async () => {
    const { upsertFellowProject: mockUpsert } = await import('@lib/hubspot-client');
    const { pollFellowActionItems: mockPoll } = await import('@lib/fellow-client');

    const group2 = {
      ...sampleGroup,
      meetingId: 'mtg-2',
      actionItems: [{ text: 'Second item', updatedAt: '', assignees: [{ name: 'Alice', status: 'not_done' as const }] }],
    };
    vi.mocked(mockPoll).mockResolvedValue([sampleGroup, group2]);
    vi.mocked(mockUpsert)
      .mockRejectedValueOnce(new Error('HubSpot down'))
      .mockResolvedValue({ id: 'proj-2', action: 'created' });

    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).outputFields.projectsCreated).toBe('1');
  });
});
