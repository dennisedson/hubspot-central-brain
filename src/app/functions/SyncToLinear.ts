import { findStateIdByName, updateLinearIssueState } from '../lib/linear-client';
import { CONTENT_STAGE_TO_LINEAR_STATE, CHANGELOG_STAGE_TO_LINEAR_STATE } from '../lib/mapping';
import { verifySharedSecret } from '../lib/shared-secret';

interface SyncToLinearBody {
  callbackId: string;
  hs_object_id: string;
  inputFields: {
    sharedSecret: string;
    linearIssueId: string;
    hubspotStage: string;
    objectType: 'content' | 'changelog';
    linearTeamId: string;
  };
}

interface SyncToLinearContext {
  method: string;
  body: SyncToLinearBody;
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}

export async function main(context: SyncToLinearContext): Promise<{ statusCode: number; body: string }> {
  const expectedSecret = process.env.SYNC_SHARED_SECRET;
  if (!expectedSecret) {
    console.error('SYNC_SHARED_SECRET is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  if (!verifySharedSecret(context.body.inputFields?.sharedSecret, expectedSecret)) {
    console.warn('Rejected SyncToLinear request: invalid shared secret');
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error('LINEAR_API_KEY is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  const { linearIssueId, hubspotStage, objectType, linearTeamId } = context.body.inputFields;
  console.log('SyncToLinear received:', JSON.stringify({ linearIssueId, hubspotStage, objectType, linearTeamId }));

  const stageMap = objectType === 'changelog'
    ? CHANGELOG_STAGE_TO_LINEAR_STATE
    : CONTENT_STAGE_TO_LINEAR_STATE;

  const targetStateName = (stageMap as Record<string, string>)[hubspotStage];
  if (!targetStateName) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Unknown HubSpot stage: "${hubspotStage}" for objectType "${objectType}"` }),
    };
  }

  const stateId = await findStateIdByName(apiKey, linearTeamId, targetStateName);
  if (!stateId) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: `Linear state "${targetStateName}" not found in team ${linearTeamId}` }),
    };
  }

  await updateLinearIssueState(apiKey, linearIssueId, stateId);

  console.log(`Synced Linear issue ${linearIssueId} → "${targetStateName}" (${stateId})`);
  return {
    statusCode: 200,
    body: JSON.stringify({
      outputFields: {
        syncStatus: 'success',
        linearStateName: targetStateName,
      },
    }),
  };
}
