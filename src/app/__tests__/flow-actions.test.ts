import { describe, it, expect } from 'vitest';
import { carryOverServerActionFields, sentinelTeamWarnings, type FlowAction } from '../../scripts/flow-actions';

/**
 * Shapes are the real ones: dev's "Content → Sync to Linear + Asana" and
 * "Content → Associate Related Content", read from the live portal before and
 * after `provision:workflows` on 2026-10-20.
 */

const SYNC_TO_LINEAR = '1-271474309';
const SYNC_TO_ASANA = '1-271572298';
const ASSOCIATE = '1-272000110';
const REAL_TEAM = 'db6b2f51-b4b4-4e91-a874-a9f3d21e6fbe';

describe('carryOverServerActionFields', () => {
  // The control: the behaviour this already had, which the fix must keep.
  it('copies back hs_ fields the server filled in and the builder never sets', () => {
    const built: FlowAction[] = [{ actionId: '1', actionTypeId: ASSOCIATE, fields: { objectType: 'content' } }];
    const live: FlowAction[] = [{
      actionId: '1',
      actionTypeId: ASSOCIATE,
      fields: { objectType: 'content', hs_target_object: '{{ enrolled_object }}' },
    }];

    expect(carryOverServerActionFields(built, live)[0].fields).toEqual({
      objectType: 'content',
      hs_target_object: '{{ enrolled_object }}',
    });
  });

  it('leaves an action with no live counterpart exactly as built', () => {
    const built: FlowAction[] = [{ actionId: '2', actionTypeId: SYNC_TO_ASANA, fields: { objectType: 'content' } }];
    expect(carryOverServerActionFields(built, [])).toEqual(built);
  });

  it('matches on actionId AND actionTypeId', () => {
    const built: FlowAction[] = [{ actionId: '1', actionTypeId: SYNC_TO_LINEAR, fields: {} }];
    const live: FlowAction[] = [{ actionId: '1', actionTypeId: SYNC_TO_ASANA, fields: { hs_target_object: 'x', linearTeamId: REAL_TEAM } }];
    expect(carryOverServerActionFields(built, live)[0].fields).toEqual({});
  });
});

describe('carryOverServerActionFields — what the 2026-10-20 dev run broke', () => {
  it("keeps the live team id when the builder only has the 'any' sentinel", () => {
    // App settings say linear_team_id = 'any' (assignee-first sync). That is a
    // filter for the webhook, not a team: SyncToLinear looks up the team's
    // workflow states with it, and Linear has no team called 'any'.
    const built: FlowAction[] = [{ actionId: '1', actionTypeId: SYNC_TO_LINEAR, actionTypeVersion: 0, fields: { linearTeamId: 'any' } }];
    const live: FlowAction[] = [{ actionId: '1', actionTypeId: SYNC_TO_LINEAR, actionTypeVersion: 0, fields: { linearTeamId: REAL_TEAM } }];

    expect(carryOverServerActionFields(built, live)[0].fields.linearTeamId).toBe(REAL_TEAM);
  });

  it('keeps the action version the live flow pins', () => {
    // The builder always says 0. Dev's Associate and LinkedIn flows pinned 75.
    const built: FlowAction[] = [{ actionId: '1', actionTypeId: ASSOCIATE, actionTypeVersion: 0, fields: {} }];
    const live: FlowAction[] = [{ actionId: '1', actionTypeId: ASSOCIATE, actionTypeVersion: 75, fields: {} }];

    expect(carryOverServerActionFields(built, live)[0].actionTypeVersion).toBe(75);
  });

  it('still lets a real team id from the builder replace the live one', () => {
    // A deliberate change of team must keep working.
    const built: FlowAction[] = [{ actionId: '1', actionTypeId: SYNC_TO_LINEAR, fields: { linearTeamId: 'team-new' } }];
    const live: FlowAction[] = [{ actionId: '1', actionTypeId: SYNC_TO_LINEAR, fields: { linearTeamId: REAL_TEAM } }];

    expect(carryOverServerActionFields(built, live)[0].fields.linearTeamId).toBe('team-new');
  });

  it('still adds fields the builder sets and the live flow lacks', () => {
    // objectId and title were added on dev on purpose; SyncToLinear needs
    // objectId to write a new issue's id back.
    const built: FlowAction[] = [{ actionId: '1', actionTypeId: SYNC_TO_LINEAR, fields: { linearTeamId: 'any', objectId: 'hs_object_id', title: 'title' } }];
    const live: FlowAction[] = [{ actionId: '1', actionTypeId: SYNC_TO_LINEAR, fields: { linearTeamId: REAL_TEAM } }];

    expect(carryOverServerActionFields(built, live)[0].fields).toEqual({
      linearTeamId: REAL_TEAM,
      objectId: 'hs_object_id',
      title: 'title',
    });
  });
});

describe('sentinelTeamWarnings', () => {
  it("names a flow that will still carry 'any' — prod's live value already is", () => {
    const actions: FlowAction[] = [
      { actionId: '1', actionTypeId: SYNC_TO_LINEAR, fields: { linearTeamId: 'any' } },
      { actionId: '2', actionTypeId: SYNC_TO_ASANA, fields: {} },
    ];
    const warnings = sentinelTeamWarnings('Content → Sync to Linear + Asana', actions);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Content → Sync to Linear \+ Asana/);
    expect(warnings[0]).toMatch(/any/);
  });

  it('is silent for a real team id and for actions with no team at all', () => {
    expect(sentinelTeamWarnings('x', [
      { actionId: '1', actionTypeId: SYNC_TO_LINEAR, fields: { linearTeamId: REAL_TEAM } },
      { actionId: '2', actionTypeId: ASSOCIATE, fields: {} },
    ])).toEqual([]);
  });
});
