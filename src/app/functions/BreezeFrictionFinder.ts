import { getPortalConfig } from '../lib/portal-config';
import { HS_BASE, objectSearchPath } from '../lib/hs-api';

interface AgentToolBody {
  callbackId?: string;
  origin?: { portalId: number };
  inputFields?: { limit?: string };
  fields?: { limit?: string };
}

interface BreezeFrictionFinderContext {
  method: string;
  body: AgentToolBody;
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}

/** HubSpot CRM search page size. The handler does not paginate; see the
 *  truncation note it appends when `total` exceeds this. */
const PAGE_SIZE = 100;

interface CrmRecord {
  id: string;
  properties: Record<string, string | null>;
}

interface ThemeSummary {
  theme: string;
  quoteCount: number;
  contentCount: number;
  titles: string[];
}

export async function main(context: BreezeFrictionFinderContext): Promise<{ statusCode: number; body: string }> {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'No HubSpot access token' }) };
  }

  const portalId = context.accountId ?? context.body.origin?.portalId ?? 0;
  const inputFields = context.body.inputFields ?? context.body.fields ?? {};
  const limit = Math.min(parseInt(inputFields.limit ?? '15', 10) || 15, 30);

  let config;
  try {
    config = getPortalConfig(portalId);
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: `No portal config for portalId ${portalId}` }) };
  }

  const { objectTypeId } = config.content;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // Fetch all content_piece records that have an enterpret_theme set
  const searchRes = await fetch(`${HS_BASE}${objectSearchPath(objectTypeId)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName: 'enterpret_theme', operator: 'HAS_PROPERTY' },
          ],
        },
      ],
      properties: ['title', 'enterpret_theme', 'enterpret_quote_count', 'hs_pipeline_stage', 'content_type'],
      sorts: [{ propertyName: 'enterpret_quote_count', direction: 'DESCENDING' }],
      limit: PAGE_SIZE,
      after: '0',
    }),
  });

  if (!searchRes.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: `Records search failed: ${searchRes.status}` }) };
  }

  const search = await searchRes.json() as { results: CrmRecord[]; total?: number };

  // Aggregate by theme
  const themeMap = new Map<string, ThemeSummary>();
  for (const r of search.results) {
    const theme = (r.properties.enterpret_theme ?? '').trim();
    if (!theme) continue;
    const quoteCount = parseInt(r.properties.enterpret_quote_count ?? '0', 10) || 0;
    const title = r.properties.title ?? 'Untitled';

    const existing = themeMap.get(theme);
    const entry = existing ?? { theme, quoteCount: 0, contentCount: 0, titles: [] };
    if (!existing) themeMap.set(theme, entry);

    entry.contentCount += 1;
    entry.quoteCount = Math.max(entry.quoteCount, quoteCount);
    if (entry.titles.length < 3) {
      entry.titles.push(title);
    }
  }

  // Sort by quote count descending, then by content coverage ascending (gaps first)
  const themes = Array.from(themeMap.values())
    .sort((a, b) => b.quoteCount - a.quoteCount || a.contentCount - b.contentCount)
    .slice(0, limit);

  const coverageGaps = themes.filter(t => t.contentCount <= 1 && t.quoteCount > 0);

  if (themes.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        outputFields: {
          themes: 'No Enterpret themes found on any content records. Run the Enterpret sync runbook to populate them.',
          coverageGaps: 'No data — run the Enterpret MCP sync first.',
          themeCount: '0',
        },
      }),
    };
  }

  // Format themes as readable text. `themes` is capped at `limit`, so the
  // header names both numbers rather than implying the list is everything.
  const shownOf = themes.length < themeMap.size ? ` of ${themeMap.size}` : '';
  const themeLines: string[] = [
    `Developer Friction Themes (${themes.length}${shownOf} themes across ${search.results.length} content records):\n`,
  ];
  for (const t of themes) {
    const coverage = t.contentCount === 1
      ? '1 piece'
      : `${t.contentCount} pieces`;
    const demand = t.quoteCount > 0 ? ` — ${t.quoteCount} quotes` : '';
    themeLines.push(`• ${t.theme}${demand} | ${coverage}: ${t.titles.join(', ')}`);
  }

  const gapLines: string[] = [];
  if (coverageGaps.length === 0) {
    gapLines.push('No obvious coverage gaps — all tracked themes have multiple content pieces.');
  } else {
    gapLines.push(`${coverageGaps.length} theme${coverageGaps.length !== 1 ? 's' : ''} with high demand but thin coverage:\n`);
    for (const g of coverageGaps) {
      gapLines.push(`• ${g.theme} — ${g.quoteCount} quotes, only ${g.contentCount} content piece`);
    }
  }

  // The search is capped at PAGE_SIZE with no pagination. Say so when the cap
  // bites, so a partial aggregate is never read as the whole picture.
  const matched = search.total ?? search.results.length;
  if (matched > search.results.length) {
    themeLines.push(
      `\n(truncated: aggregated from the first ${search.results.length} of ${matched} themed content records, ` +
      'ranked by quote count — themes below that cut-off are not represented)',
    );
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      outputFields: {
        themes: themeLines.join('\n'),
        coverageGaps: gapLines.join('\n'),
        themeCount: String(themeMap.size),
      },
    }),
  };
}
