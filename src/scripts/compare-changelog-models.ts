/**
 * Draft the same real records with different models, and print the results
 * side by side.
 *
 * The point is to settle "is Opus worth it for this?" with output rather than
 * assumption. Changelog drafting is a transformation of structured fields into
 * prose, which a smaller model may do just as well — but that is a guess until
 * someone reads three drafts from each.
 *
 * Read-only against HubSpot. It writes nothing: no drafts are saved, no
 * settings are changed. It does spend Anthropic credits, which is the whole
 * point, so it defaults to three records and asks for confirmation of nothing.
 *
 * Usage:
 *   PORTAL=prod npm run compare:changelog-models
 *   PORTAL=prod npm run compare:changelog-models -- --n=5 --mode=standalone --models=opus,sonnet,haiku
 */

import { loadEnv } from './script-env';
import { HS_BASE, objectSearchPath } from '../app/lib/hs-api';
import { getPortalConfig } from '../app/lib/portal-config';
import { parseRolloutNotes, formatSourceForModel, missingForStandalone } from '../app/lib/changelog-source';
import { promptFor, type ChangelogDraftMode } from '../app/lib/changelog-prompts';
import { MODEL_IDS, thinkingConfigFor, type ModelChoice, type ThinkingChoice } from '../app/lib/changelog-model';

/** Published rates per million tokens, 2026-10-01. Update if they move. */
const RATES: Record<ModelChoice, { input: number; output: number }> = {
  opus: { input: 4, output: 20 },
  sonnet: { input: 2, output: 10 },
  haiku: { input: 1, output: 5 },
};

function arg(name: string, fallback: string): string {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

interface Record_ { id: string; title: string; notes: string }

async function fetchRecords(objectTypeId: string, pipelineId: string, token: string, n: number): Promise<Record_[]> {
  const res = await fetch(`${HS_BASE}${objectSearchPath(objectTypeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'hs_pipeline', operator: 'EQ', value: pipelineId }] }],
      properties: ['title', 'notes'],
      limit: 100,
    }),
  });
  if (!res.ok) throw new Error(`HubSpot search failed ${res.status}: ${await res.text()}`);
  const body = await res.json() as { results: Array<{ id: string; properties: Record<string, string | null> }> };

  // Prefer records with real source material: comparing models on an empty
  // record tells you nothing about either.
  return body.results
    .map(r => ({ id: r.id, title: r.properties.title ?? '', notes: r.properties.notes ?? '' }))
    .filter(r => r.notes.length > 200)
    .slice(0, n);
}

async function draft(
  model: ModelChoice,
  thinking: ThinkingChoice,
  system: string,
  opening: string,
  message: string,
  apiKey: string,
) {
  const started = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL_IDS[model],
      max_tokens: 4096,
      thinking: thinkingConfigFor(thinking, model),
      system: [{ type: 'text', text: system }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: opening, cache_control: { type: 'ephemeral' } }] },
        { role: 'user', content: message },
      ],
    }),
  });
  const elapsed = Date.now() - started;
  const text = await res.text();
  if (!res.ok) return { ok: false as const, elapsed, error: `${res.status}: ${text.slice(0, 200)}` };

  const body = JSON.parse(text) as {
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const out = body.content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n').trim();
  const inTok = body.usage?.input_tokens ?? 0;
  const outTok = body.usage?.output_tokens ?? 0;
  const cost = (inTok / 1e6) * RATES[model].input + (outTok / 1e6) * RATES[model].output;
  return { ok: true as const, elapsed, text: out, inTok, outTok, cost };
}

async function main() {
  const { token, portalId, portal } = loadEnv();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in .env');

  const n = Math.max(1, parseInt(arg('n', '3'), 10));
  const mode = (arg('mode', 'rollup') === 'standalone' ? 'standalone' : 'rollup') as ChangelogDraftMode;
  const thinking = (arg('thinking', 'adaptive') === 'off' ? 'off' : 'adaptive') as ThinkingChoice;
  const models = arg('models', 'opus,sonnet')
    .split(',')
    .map(m => m.trim())
    .filter((m): m is ModelChoice => m in MODEL_IDS);

  if (models.length < 1) throw new Error('No valid models. Choose from: opus, sonnet, haiku');

  const config = getPortalConfig(portalId);
  const records = await fetchRecords(
    config.content.objectTypeId,
    config.content.pipelines.changelog.pipelineId,
    token,
    n,
  );

  console.log(`\n[${portal}] Comparing ${models.join(' vs ')} — mode=${mode}, thinking=${thinking}`);
  console.log(`${records.length} record(s) with usable source material\n`);

  const system = promptFor(mode);
  const totals: Record<string, { cost: number; ms: number; out: number }> = {};

  for (const rec of records) {
    const source = parseRolloutNotes(rec.notes);
    const missing = missingForStandalone(source);
    console.log('═'.repeat(78));
    console.log(`RECORD ${rec.id}  ${rec.title}`);
    if (missing.length) console.log(`  thin for standalone — missing: ${missing.join(', ')}`);
    console.log('═'.repeat(78));

    const opening = [
      formatSourceForModel(source, rec.title),
      '',
      'There is no draft yet.',
    ].join('\n');
    const ask = mode === 'rollup'
      ? 'Draft this as a digest entry.'
      : 'Draft this as a standalone changelog post.';

    for (const model of models) {
      const result = await draft(model, thinking, system, opening, ask, apiKey);
      console.log(`\n──── ${model.toUpperCase()} ${'─'.repeat(60 - model.length)}`);
      if (!result.ok) { console.log(`  FAILED  ${result.error}`); continue; }

      totals[model] ??= { cost: 0, ms: 0, out: 0 };
      totals[model].cost += result.cost;
      totals[model].ms += result.elapsed;
      totals[model].out += result.outTok;

      console.log(`  ${result.inTok} in / ${result.outTok} out · ${(result.elapsed / 1000).toFixed(1)}s · $${result.cost.toFixed(4)}\n`);
      console.log(result.text.split('\n').map(l => `  ${l}`).join('\n'));
    }
    console.log();
  }

  console.log('═'.repeat(78));
  console.log('TOTALS');
  for (const [model, t] of Object.entries(totals)) {
    console.log(`  ${model.padEnd(8)} $${t.cost.toFixed(4)}  ${(t.ms / 1000).toFixed(1)}s  ${t.out} output tokens`);
  }
  console.log('\nRead the drafts. Cost is pennies either way — judge on whether the');
  console.log('cheaper output is good enough, not on the numbers.\n');
}

main().catch(err => {
  console.error('\nFailed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
