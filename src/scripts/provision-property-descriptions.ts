/**
 * Sets `description` on every custom property of content_piece and video.
 *
 * WHY THIS EXISTS
 * ---------------
 * AI connectors read property descriptions and use them as context. Asked
 * about `enterpret_quotes`, the HubSpot connector replied "JSON array of
 * developer quotes, synced out-of-band" — that is this repo's description
 * text, echoed back without being prompted with it.
 *
 * So a description is no longer documentation nobody reads. It is part of what
 * an agent knows about the schema, and an undescribed field is one the agent
 * will guess about. See issue #22 and walkthrough 40.
 *
 * WHAT MAKES A GOOD ONE HERE
 * --------------------------
 * - Disambiguate pairs by naming the sibling. `source_url` and `published_url`
 *   are indistinguishable from their labels; each description points at the other.
 * - State format constraints that fail silently. `enterpret_quotes` is a
 *   textarea holding JSON: a nested object saves without error and renders nothing.
 * - Say who writes it and who reads it, so an agent knows whether to touch it.
 * - Skip the self-evident. `title` needs nothing.
 *
 * Descriptions live here rather than in the HubSpot UI so they are reviewed,
 * identical across all three portals, and survive provisioning a fresh account.
 *
 * Safe to re-run — it PATCHes, and skips any property whose description already
 * matches.
 *
 * Usage:
 *   npx tsx src/scripts/provision-property-descriptions.ts
 *   PORTAL=staging npx tsx src/scripts/provision-property-descriptions.ts
 *   PORTAL=prod    npx tsx src/scripts/provision-property-descriptions.ts
 */

import { loadEnv } from './script-env';
import { getPortalConfig } from '../app/lib/portal-config';
import { HS_BASE, propertiesPath } from '../app/lib/hs-api';

/** content_piece — spans both the content and changelog pipelines. */
const CONTENT_DESCRIPTIONS: Record<string, string> = {
  content_type:
    'What kind of content this is. Drives which pipeline the record belongs on: ' +
    '"changelog" records live on the Changelog pipeline, everything else on the ' +
    'Content pipeline.',

  // --- the URL trio: each names its siblings, because the labels do not ---
  source_url:
    'Link to the DRAFT — Google Doc, Obsidian note, etc. Written when the record is ' +
    'created, before anything is published. For the live article see published_url.',
  published_url:
    'Link to the LIVE, published artifact. Empty until the record reaches the ' +
    'Published stage. For the pre-publish draft see source_url.',

  // --- three Linear fields whose labels barely differ ---
  linear_id:
    'Linear issue UUID. This is the DEDUPE KEY: the sync matches on it via ' +
    'idProperty=linear_id to decide create-vs-update. Do not edit by hand — a ' +
    'changed value creates a duplicate record on the next sync.',
  linear_issue_id:
    'Human-readable Linear identifier such as "DAD-142". Display only. For the ' +
    'value the sync matches on see linear_id.',
  linear_issue_url:
    'Direct link to the Linear issue. Display only; nothing matches on it.',

  asana_task_id:
    'Asana task GID. Used to look the task up when syncing status. Display and ' +
    'lookup only — the record is not deduped on this.',
  asana_task_url:
    'Direct link to the Asana task, used by the Linear/Asana Status card.',

  // --- planned vs happened ---
  target_date:
    'PLANNED publish date. Set when the work is scheduled; used to flag overdue ' +
    'items. For when it actually shipped see actual_date.',
  actual_date:
    'ACTUAL publish date — when it really shipped. Empty until published. For the ' +
    'plan see target_date.',

  topic_tags:
    'Topic tags for this piece. Multi-select, stored SEMICOLON-DELIMITED, e.g. ' +
    '"api;crm". Drives Related Content scoring: each shared tag is worth 2 points.',

  // --- Enterpret trio ---
  enterpret_theme:
    'The Enterpret friction theme this content addresses, as free text, e.g. ' +
    '"webhook retries". Drives Related Content scoring (a theme match is worth 3 ' +
    'points) and is the key used to fetch quotes from Enterpret.',
  enterpret_quotes:
    'Developer quotes from Enterpret backing enterpret_theme, as a JSON array. ' +
    'STORED AS A STRING because this is a textarea — writing a nested object saves ' +
    'without error and renders nothing. Each entry: {text, source, sentiment, ' +
    'createdAt}, sentiment being positive|negative|neutral. Synced out-of-band ' +
    'from Enterpret; read by the Enterpret Insights card.',
  enterpret_quote_count:
    'How many quotes are stored in enterpret_quotes on this record. A count of what ' +
    'was synced here, not of everything Enterpret holds for the theme.',

  notes:
    'Free-form working notes for humans. Nothing parses this — safe for anything ' +
    'that does not belong in a structured field.',

  // --- social ---
  social_post_draft:
    'Generated LinkedIn draft, produced by the generate_social_draft workflow ' +
    'action. NEVER overwritten once non-empty unless that action is run with ' +
    'force=true, so human edits survive.',
  social_post_url:
    'Link to the published social post. Empty until it is actually posted.',
  social_published_at:
    'When the social post went live. Empty until published.',
  social_engagement_score:
    'Engagement score for the published social post. Populated after publishing; ' +
    'meaningless before.',
};

/** video */
const VIDEO_DESCRIPTIONS: Record<string, string> = {
  youtube_video_id:
    'YouTube video ID — the 11-character code from the URL, not the full URL. ' +
    'Used to fetch stats. For the full link see youtube_url.',
  youtube_url:
    'Full YouTube watch URL. Display only; lookups use youtube_video_id.',
  google_doc_url:
    'Link to the script or outline draft. The video equivalent of source_url on ' +
    'content_piece.',
  video_description:
    'The description text published to YouTube, not an internal summary.',
  thumbnail_url: 'Link to the thumbnail image asset.',
  tags:
    'Topic tags for this video. FREE TEXT, unlike content_piece.topic_tags which ' +
    'is a multi-select — so values here are not guaranteed to match that vocabulary.',
  series_name:
    'Name of the series this video belongs to, if any. Empty for standalone videos.',
  series_order:
    'Position within series_name, 1-based. Meaningless without series_name.',

  // --- scheduled vs actual ---
  scheduled_publish_at:
    'PLANNED publish time. For when it actually went live see published_at.',
  published_at:
    'ACTUAL publish time — when it really went live. Empty until published. For ' +
    'the plan see scheduled_publish_at.',

  // --- metrics: all populated after publishing ---
  view_count: 'YouTube view count at last sync. Empty before publishing.',
  like_count: 'YouTube like count at last sync. Empty before publishing.',
  comment_count: 'YouTube comment count at last sync. Empty before publishing.',
  impressions: 'YouTube impressions at last sync — times the thumbnail was shown.',
  click_through_rate:
    'Impressions-to-views ratio, as a PERCENTAGE (e.g. 4.2 means 4.2%), not a fraction.',
  average_view_duration:
    'Mean watch time in SECONDS, not a percentage of video length.',

  utm_link: 'Tracking link used to attribute traffic from this video.',
  website_url: 'Link to a related page on the website, if the video supports one.',
  campaign_name: 'Marketing campaign this video belongs to, if any.',
};

interface Property {
  name: string;
  description?: string;
}

async function describe(
  token: string,
  objectTypeId: string,
  label: string,
  descriptions: Record<string, string>,
): Promise<number> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const res = await fetch(`${HS_BASE}${propertiesPath(objectTypeId)}`, { headers });
  if (!res.ok) {
    console.error(`  ✗ Could not read ${label} properties: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const existing = (await res.json()) as { results: Property[] };
  const byName = new Map(existing.results.map(p => [p.name, p]));

  console.log(`\n  ${label} (${objectTypeId})`);
  let changed = 0;

  for (const [name, description] of Object.entries(descriptions)) {
    const current = byName.get(name);
    if (!current) {
      console.log(`    ? ${name} — not on this portal, skipped`);
      continue;
    }
    if ((current.description ?? '').trim() === description.trim()) {
      console.log(`    – ${name} — already current`);
      continue;
    }
    const patch = await fetch(`${HS_BASE}${propertiesPath(objectTypeId, name)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ description }),
    });
    if (!patch.ok) {
      console.error(`    ✗ ${name} — ${patch.status}: ${await patch.text()}`);
      process.exit(1);
    }
    console.log(`    ✓ ${name}`);
    changed++;
  }
  return changed;
}

async function main(): Promise<void> {
  const { portal, portalId, token } = loadEnv();
  const config = getPortalConfig(portalId);

  console.log(`[${portal}] portal ${portalId}`);

  const a = await describe(token, config.content.objectTypeId, 'content_piece', CONTENT_DESCRIPTIONS);
  const b = await describe(token, config.video.objectTypeId, 'video', VIDEO_DESCRIPTIONS);

  console.log(`\n  ${a + b} description(s) updated.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
