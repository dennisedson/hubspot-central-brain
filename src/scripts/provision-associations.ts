/**
 * Creates the content_piece / video association definitions that
 * `provision-objects.ts` never made (issue #3). Without them the
 * `associate_related_content` workflow action 4xxs on every association call.
 *
 * Safe to re-run — every pairing is read first and only created when missing.
 *
 * Definitions created:
 *  - Content Piece ↔ Content Piece  labeled "Related Content" (cb_related_content)
 *  - Content Piece ↔ Video          unlabeled, via the schema endpoint
 *  - Video ↔ Video                  labeled "Related Video"   (cb_related_video)
 *
 * The two self-referential pairings are the ones `AssociateRelatedContent` uses.
 * They exist only as LABELED definitions — a custom object has no unlabeled
 * association with itself — so the run prints the typeId of each label it
 * finds. Those typeIds are per-portal; nothing in the app hardcodes them, the
 * workflow action reads them back at call time.
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
    const route = result.pairing.route === 'labels' ? 'v4 labels' : 'v3 schema associations';
    console.log(
      `  ${ICONS[result.outcome]} ${result.pairing.description} (${route}) — ${result.detail}`,
    );
    if (result.state) console.log(`      state: ${result.state}`);
    if (result.typeId !== null) {
      console.log(`      label "${result.pairing.label}" → associationTypeId ${result.typeId}`);
    }
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
    console.log('\n✓ Every pairing is provisioned — AssociateRelatedContent can associate.');
    return;
  }

  console.error('\n✗ These pairings are still not usable:');
  for (const result of broken) {
    console.error(`  - ${result.pairing.description}: ${result.detail}`);
  }
  console.error(
    '\nAssociateRelatedContent associates through the LABELED definition, so a\n' +
    'self-referential pairing needs its own label present — an unlabeled\n' +
    'definition alone is not enough. Create the missing label by hand in\n' +
    'Data Management → Data Model, or re-run this script once the reported\n' +
    'error is addressed.',
  );
  process.exit(1);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
