/**
 * Creates the content_piece / video association definitions that
 * `provision-objects.ts` never made (issue #3). Without them the
 * `associate_related_content` workflow action 4xxs on every association call.
 *
 * Safe to re-run — every pairing is read first and only created when missing.
 *
 * Definitions created:
 *  - Content Piece ↔ Content Piece  (self-referential — see the note below)
 *  - Content Piece ↔ Video
 *  - Video ↔ Video                  (self-referential — see the note below)
 *
 * SELF-REFERENTIAL PAIRINGS ARE NOT GUARANTEED. HubSpot documents same-object
 * associations for standard objects but says nothing about a custom object
 * paired with itself, and its schema endpoint has a dedicated
 * CANNOT_ASSOCIATE_OBJECT_TYPE_WITH_ITSELF rejection. This script attempts them
 * via the v4 labels endpoint and tells you exactly what the portal answered.
 * Read the summary at the end: only a pairing reported as `defined-unlabeled`
 * will actually work with `AssociateRelatedContent`.
 *
 * Usage:
 *   npx tsx src/scripts/provision-associations.ts
 *   PORTAL=staging npx tsx src/scripts/provision-associations.ts
 *   PORTAL=prod npx tsx src/scripts/provision-associations.ts
 */

import { loadEnv } from './script-env';
import { getPortalConfig } from '../app/lib/portal-config';
import {
  ensureAssociationDefinitions,
  requiredAssociationPairings,
  unusablePairings,
  isSelfReferential,
  type EnsureResult,
} from './association-definitions';

const ICONS: Record<EnsureResult['outcome'], string> = {
  created: '✓',
  skipped: '–',
  failed: '✗',
};

function report(results: EnsureResult[]): void {
  console.log('');
  for (const result of results) {
    const route = isSelfReferential(result.pairing) ? 'v4 labels' : 'v3 schema associations';
    console.log(
      `  ${ICONS[result.outcome]} ${result.pairing.description} (${route}) — ${result.detail}`,
    );
    if (result.state) console.log(`      state: ${result.state}`);
  }
}

async function main() {
  const { token, portal, portalId } = loadEnv();
  const config = getPortalConfig(portalId);
  const pairings = requiredAssociationPairings(config);

  console.log(`[${portal}] Ensuring association definitions on portal ${portalId}`);
  console.log(`  content_piece: ${config.content.objectTypeId}`);
  console.log(`  video:         ${config.video.objectTypeId}`);

  const results = await ensureAssociationDefinitions(token, pairings);
  report(results);

  const broken = unusablePairings(results);
  if (broken.length === 0) {
    console.log('\n✓ All pairings have an unlabeled definition — AssociateRelatedContent can associate.');
    return;
  }

  console.error('\n✗ These pairings still have no unlabeled association definition:');
  for (const result of broken) {
    console.error(`  - ${result.pairing.description}: ${result.detail}`);
  }
  console.error(
    '\nAssociateRelatedContent uses PUT …/associations/default/… which needs the unlabeled\n' +
    'type. For any pairing above, either create the association by hand in\n' +
    'Data Management → Data Model, or switch that path to the labeled association\n' +
    'endpoint using the typeId from GET /crm/v4/associations/{from}/{to}/labels.',
  );
  process.exit(1);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
