/**
 * Loads .env from the project root and resolves portal-specific credentials.
 * Import this at the top of any provisioning script instead of reading process.env directly.
 *
 * Usage:
 *   import { loadEnv } from './script-env';
 *   const { token, portalId, portal } = loadEnv();
 *
 * Portal selection: set PORTAL=dev|staging|prod (defaults to dev)
 */

import fs from 'fs';
import path from 'path';

export interface ScriptEnv {
  portal: string;
  portalId: number;
  appId: number;           // numeric project app ID (distribution: private)
  token: string;           // HUBSPOT_*_SERVICE_KEY (private app token for API scripts)
  personalKey: string;     // HUBSPOT_*_PERSONAL_ACCESS_KEY (for hs CLI / SDK client init)
  sharedSecret: string;    // SYNC_SHARED_SECRET
  asanaApiKey: string;     // ASANA_API_KEY
  developerApiKey: string; // HUBSPOT_*_DEVELOPER_KEY (per-portal developer key)
}

const PORTAL_IDS: Record<string, number> = {
  dev:     51869810,
  staging: 51869787,
  prod:    22047910,
};

// Numeric app IDs for the Central Brain project (distribution: private) per portal
const APP_IDS: Record<string, number> = {
  dev:     49103173,
  staging: 49115036,
  prod:    49129343,
};

function parseDotEnv(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const vars: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && val) vars[key] = val;
  }
  return vars;
}

function requireVar(vars: Record<string, string>, key: string): string {
  const val = vars[key];
  if (!val) { console.error(`${key} is not set in .env or environment.`); process.exit(1); }
  return val;
}

export function loadEnv(): ScriptEnv {
  const envPath = path.resolve(process.cwd(), '.env');
  const file = parseDotEnv(envPath);

  // process.env wins over .env so one-off overrides still work
  const vars = { ...file, ...process.env } as Record<string, string>;

  const portal = vars.PORTAL ?? 'dev';
  const portalId = PORTAL_IDS[portal];
  if (!portalId) { console.error(`Unknown portal "${portal}". Set PORTAL=dev|staging|prod`); process.exit(1); }

  const prefix = portal.toUpperCase();
  return {
    portal,
    portalId,
    appId:           APP_IDS[portal],
    token:           requireVar(vars, `HUBSPOT_${prefix}_SERVICE_KEY`),
    personalKey:     requireVar(vars, `HUBSPOT_${prefix}_PERSONAL_ACCESS_KEY`),
    sharedSecret:    requireVar(vars, 'SYNC_SHARED_SECRET'),
    asanaApiKey:     requireVar(vars, 'ASANA_API_KEY'),
    developerApiKey: requireVar(vars, `HUBSPOT_${prefix}_DEVELOPER_KEY`),
  };
}
