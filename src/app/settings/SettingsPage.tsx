import { hubspot, Alert, Box, Divider, Heading, Text } from '@hubspot/ui-extensions';

/**
 * A probe, not the settings form.
 *
 * WHY THIS IS DELIBERATELY EMPTY OF FEATURES
 * ------------------------------------------
 * A `type: "settings"` component was built here once and rendered nowhere. It
 * deployed cleanly every time — "Deploying settings-hubspot-central-brain …
 * DONE" in every upload — to a surface nobody could find, and was removed in
 * #60 for being invisible.
 *
 * It was removed for a second reason that matters more: it had become a SECOND
 * COPY of the Linear settings form. Three changes landed in the invisible copy
 * while the page people actually use stayed unchanged, and four rounds of "why
 * isn't this appearing" came out of it.
 *
 * So this one carries no form, no state and no API calls. Its entire job is to
 * answer one question that has been open since 2026-09-29: does this surface
 * render at all for a private app on platformVersion 2026.03?
 *
 * The hsmeta beside this file matches the documented example exactly — same
 * `type`, same `config.entrypoint` shape — so if nothing appears, the
 * configuration is not what is wrong.
 *
 * IF IT RENDERS: the real work is moving the settings form somewhere both this
 * and `pages/SettingsApp.tsx` can use, so there is one implementation with two
 * entrances. Never two implementations.
 *
 * IF IT DOES NOT: that is reportable evidence rather than a guess — the
 * documented configuration, deployed, on a supported platform version,
 * rendering nothing. See issue #88.
 */
hubspot.extend<'settings'>(() => (
  <Box>
    <Heading>HubSpot Central Brain</Heading>
    <Alert title="This surface works" variant="success">
      <Text>
        If you are reading this, the app settings component renders for this app
        and this is where its configuration belongs.
      </Text>
    </Alert>
    <Divider />
    <Text>
      Linear sync, project routing, the historical import and the changelog
      drafting prompts currently live on the Content Command Center page, under
      Settings.
    </Text>
    <Text variant="microcopy">
      They have not been moved here yet. Moving them means making one
      implementation reachable from both places rather than copying the form,
      which is what went wrong the last time this component existed.
    </Text>
  </Box>
));
