/**
 * Asks a portal to check its own credentials.
 *
 * On demand, not on a schedule. The scheduled workflow this replaces fired
 * daily for two weeks and reported nothing: its prod job declared
 * `environment: Prod` to reach the secret and so inherited the deploy approval
 * gate, leaving fourteen runs queued behind a reviewer. A monitor whose absence
 * from the failure list reads as "all clear" is worse than no monitor.
 *
 * The endpoint itself earns its place — one request, six credentials, real
 * token exchanges rather than a config read. It found the dead YouTube refresh
 * token on its first call. What it did not need was a cron.
 *
 * Usage:
 *   PORTAL=prod npm run health
 *   PORTAL=dev npm run health
 */

import { loadEnv } from './script-env';

interface Check {
  name: string;
  status: 'ok' | 'invalid' | 'unconfigured' | 'error';
  detail: string;
}

async function main() {
  const { portalId, portal, sharedSecret } = loadEnv();

  const url = `https://${portalId}.hs-sites.com/hs/serverless/app-health`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: sharedSecret, portalId: String(portalId) }),
  });

  if (!res.ok) {
    console.error(`\n[${portal}] health endpoint returned ${res.status}`);
    console.error((await res.text()).slice(0, 300));
    process.exit(1);
  }

  const body = await res.json() as { status: string; checks: Check[] };
  console.log(`\n[${portal}] portal ${portalId} — ${body.status}\n`);
  for (const check of body.checks) {
    console.log(`  ${check.status.padEnd(13)} ${check.name.padEnd(10)} ${check.detail}`);
  }
  console.log();

  // Non-zero on a broken credential, so this is usable in a pipeline later if
  // the scheduled version is ever wanted back — just not behind a deploy gate.
  const broken = body.checks.filter(c => c.status === 'invalid' || c.status === 'error');
  if (broken.length) process.exit(1);
}

main().catch(err => {
  console.error('\nFailed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
