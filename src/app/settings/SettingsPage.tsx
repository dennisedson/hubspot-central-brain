import { hubspot, Box, Heading, Text } from '@hubspot/ui-extensions';
import { LinearSettingsForm } from './LinearSettingsForm.tsx';

/**
 * The app's Settings tab, under Connected apps.
 *
 * This surface was written off on 2026-09-29 as something a private app does
 * not get: the app's entry had Overview and Insights and no Settings tab, and
 * a component deployed here rendered nowhere. That has since changed — the
 * tabs are now Overview, Settings and App cards, and the probe in #100 showed
 * the component rendering. The original diagnosis was reasonable when it was
 * made and is no longer true.
 *
 * THE FORM IS IMPORTED, NEVER COPIED
 * ----------------------------------
 * The component that lived here before was removed for two reasons, and the
 * second mattered more than the first: it had become a SECOND COPY of the
 * Linear settings form. Three changes landed in the copy nobody could see
 * while the page people actually used stayed unchanged (#60).
 *
 * HubSpot bundles each extension directory in isolation — the upload copies
 * one directory to a temp root, so an import that leaves it cannot resolve:
 *
 *   Could not resolve "../pages/LinearSettingsForm.tsx"
 *     from "../../tmp/app/settings/SettingsPage.tsx"
 *
 * Sharing by import is therefore not available. The file beside this one is
 * GENERATED from pages/LinearSettingsForm.tsx by `npm run sync:settings-form`,
 * which `npm run build` runs first, and `settings-form-in-sync.test.ts` fails
 * while the two differ. A copy that cannot silently drift is a different thing
 * from two implementations.
 *
 * No `onBack` is passed — the Settings tab is a destination, not a detour.
 */
hubspot.extend<'settings'>(({ context }) => {
  const portalId = (context as { portal: { id: number } }).portal.id;
  return (
    <Box>
      <Heading>Linear Sync</Heading>
      <Text variant="microcopy">
        The same settings are also reachable from the Content Command Center page.
      </Text>
      <LinearSettingsForm portalId={portalId} />
    </Box>
  );
});
