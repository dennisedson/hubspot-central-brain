/**
 * How a re-provisioned workflow's actions are reconciled with the live flow.
 *
 * Its own module, out of provision-workflows.ts, because that script runs
 * main() on import and so nothing in it could be tested — which is how the
 * first live run of its update path, on dev on 2026-10-20, rewrote two things
 * nobody had asked it to (see carryOverServerActionFields).
 */

import { isAnyTeam } from '../app/lib/mapping';

export interface FlowAction {
  actionId: string;
  actionTypeId: string;
  actionTypeVersion?: number;
  fields: Record<string, unknown>;
}

/**
 * PUT /automation/v4/flows/{id} replaces the whole actions array, so anything
 * the live flow holds that the builder does not know about has to be copied
 * back, or the update silently resets it. Matched on actionId AND actionTypeId
 * so a reordered flow cannot copy the wrong action's values. Three things:
 *
 * - **`hs_` fields.** Every custom action whose definition does not opt out
 *   with `requiresObject: false` gets an `hs_target_object` field (default
 *   "{{ enrolled_object }}"), the target object selector. The server fills it
 *   in on create, so it only exists on the live flow.
 *
 * - **`actionTypeVersion`.** The builder always says 0. Dev's Associate and
 *   LinkedIn flows pinned 75, and the update reset them.
 *
 * - **`linearTeamId`, when the builder only has the `'any'` sentinel.** The
 *   builder reads the team from app settings, and with assignee-first sync
 *   those say `'any'` — a filter for the webhook, not a team. SyncToLinear
 *   looks up the team's workflow states with this field, and Linear has no
 *   team called `'any'`, so writing it broke every stage sync on dev. A real
 *   team id from the builder still replaces the live one.
 */
export function carryOverServerActionFields(built: FlowAction[], live: FlowAction[]): FlowAction[] {
  return built.map(action => {
    const match = live.find(l => l.actionId === action.actionId && l.actionTypeId === action.actionTypeId);
    if (!match) return action;

    const inherited: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(match.fields ?? {})) {
      if (key.startsWith('hs_') && !(key in action.fields)) inherited[key] = value;
    }

    const builtTeam = action.fields.linearTeamId;
    const liveTeam = match.fields?.linearTeamId;
    if (typeof builtTeam === 'string' && isAnyTeam(builtTeam) && typeof liveTeam === 'string') {
      inherited.linearTeamId = liveTeam;
    }

    return {
      ...action,
      ...(match.actionTypeVersion !== undefined ? { actionTypeVersion: match.actionTypeVersion } : {}),
      fields: { ...action.fields, ...inherited },
    };
  });
}

/**
 * One warning per action that will still carry the `'any'` sentinel as its
 * team — on a new flow, or where the live flow already held it, as prod's two
 * sync flows do. Provisioning cannot invent a team, so it says so instead.
 *
 * Since SyncToLinear asks an existing issue for its own team, the sentinel only
 * costs the create path: a promoted vault note answers `no_team_for_create`.
 */
export function sentinelTeamWarnings(flowName: string, actions: FlowAction[]): string[] {
  return actions
    .filter(a => typeof a.fields.linearTeamId === 'string' && isAnyTeam(a.fields.linearTeamId))
    .map(a =>
      `"${flowName}" action ${a.actionId}: linearTeamId is '${a.fields.linearTeamId}'. Stage syncs use each issue's ` +
      `own team, but a note promoted from the vault cannot create a Linear issue until this is a real team id.`,
    );
}
