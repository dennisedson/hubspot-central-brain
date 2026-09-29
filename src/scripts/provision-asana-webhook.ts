/**
 * Registers an Asana webhook subscription pointing to the AsanaWebhook serverless function.
 *
 * Usage:
 *   PORTAL=dev npx tsx src/scripts/provision-asana-webhook.ts <function-url>
 *
 * Where <function-url> is the full URL of the deployed AsanaWebhook function, e.g.:
 *   https://app-49103173.hubspot.com/app/functions/asana-webhook
 *
 * IMPORTANT — handshake note:
 *   Asana performs a one-time handshake by POSTing to the target URL with
 *   X-Hook-Secret in the request header and expecting the same value in the
 *   response header. HubSpot's serverless runtime strips incoming custom headers,
 *   so the function cannot read or echo X-Hook-Secret back.
 *
 *   If registration fails with a handshake error, the workaround is:
 *     1. Register the webhook to a temporary endpoint you control (e.g. a local
 *        ngrok tunnel running a simple echo server).
 *     2. Note the X-Hook-Secret Asana sends.
 *     3. Use PUT /webhooks/{gid} to update the target URL to the HubSpot function
 *        URL — subsequent event deliveries do NOT re-handshake.
 *   Alternatively, once HubSpot exposes response header support, the function
 *   already handles the handshake (see AsanaWebhook.ts).
 *
 * Lists existing webhooks for the project first so you can avoid duplicates.
 */

import { loadEnv } from './script-env';
import { getPortalConfig } from '../app/lib/portal-config';

const ASANA_API = 'https://app.asana.com/api/1.0';

async function asanaRequest<T>(apiKey: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ASANA_API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Asana ${method} ${path} → ${res.status}: ${await res.text()}`);
  const json = await res.json() as { data: T };
  return json.data;
}

async function main() {
  const targetUrl = process.argv[2];
  if (!targetUrl) {
    console.error('Usage: provision-asana-webhook.ts <function-url>');
    process.exit(1);
  }

  const env = loadEnv();
  const config = getPortalConfig(env.portalId);

  // List existing webhooks for the project
  console.log(`\nExisting webhooks for project ${config.asanaProjectGid}:`);
  const existing = await asanaRequest<Array<{ gid: string; target: string; active: boolean }>>(
    env.asanaApiKey,
    'GET',
    `/webhooks?workspace=${config.asanaWorkspaceGid}&resource=${config.asanaProjectGid}&opt_fields=gid,target,active`,
  );

  if (existing.length === 0) {
    console.log('  (none)');
  } else {
    for (const wh of existing) {
      console.log(`  gid=${wh.gid} active=${wh.active} target=${wh.target}`);
    }
    const duplicate = existing.find(wh => wh.target === targetUrl);
    if (duplicate) {
      console.log(`\nWebhook to ${targetUrl} already exists (gid=${duplicate.gid}). Nothing to do.`);
      process.exit(0);
    }
  }

  // Register new webhook — only fire on task custom_field changes
  console.log(`\nRegistering webhook → ${targetUrl}`);
  const webhook = await asanaRequest<{ gid: string }>(
    env.asanaApiKey,
    'POST',
    '/webhooks',
    {
      data: {
        resource: config.asanaProjectGid,
        target: targetUrl,
        filters: [
          { resource_type: 'task', action: 'changed', fields: ['custom_fields'] },
        ],
      },
    },
  );

  console.log(`\nWebhook registered: gid=${webhook.gid}`);
  console.log('Asana will have sent the handshake POST to your function.');
  console.log('If the function echoed X-Hook-Secret back, the webhook is now active.');
  console.log('If not (HubSpot strips the header), see the handshake workaround in the script header.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
