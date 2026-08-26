# Testing in Production (And How We Stopped)

*The story behind Episode 14: Safe Testing Without Polluting Production*

---

For longer than we'd like to admit, "testing" the sync meant triggering a real workflow on the dev portal and watching what happened in the real Asana project.

It worked. Tasks appeared. Stages updated. The issue was that those tasks were in the same project the content team uses to track real work. Test records mixed in with real ones, pipeline stages got randomly updated, and the occasional test task with a title like "TEST IGNORE" lingered until someone manually deleted it.

The problem wasn't that we were testing — it's that we had no test environment for Asana. Our dev HubSpot portal was isolated (different object IDs, different workflows), but all three portals pointed at the same Asana project.

## Why We Didn't Just Use a Separate API Key

A separate Asana account would've been the obvious fix, but it creates its own problems: the workspace custom fields (Pipeline Stage, Linear Issue URL, etc.) live at the workspace level and need to exist in both accounts. Any change to the field schema has to be applied twice. And you lose visibility — you can't share projects between accounts, so a developer can't see their test tasks alongside their real ones.

What we actually needed was a **separate project** in the same workspace — one that mirrors the structure of the real project (same sections, same custom fields) but is explicitly for dev testing.

## The Provisioning Script

Rather than set up the test project by hand, we wrote a script that mirrors the real project's structure:

```typescript
const FIELDS_TO_ADD = [
  { gid: '1202184607659964', name: 'Pipeline Stage' },
  { gid: '1213736210804469', name: 'Linear Issue URL' },
  // ... other workspace-level fields
];

for (const field of FIELDS_TO_ADD) {
  await fetch(`/projects/${TEST_PROJECT_GID}/addCustomFieldSetting`, {
    method: 'POST',
    body: JSON.stringify({ data: { custom_field: field.gid } }),
  });
}
```

Sections are idempotent — it fetches existing ones first and only creates the missing ones. Run it once, get a project that behaves identically to production from the API's perspective.

## Per-Portal Routing

With the sandbox project created, we needed each portal to know which project to target. The cleanest solution: add `asanaProjectGid` directly to `PortalConfig` rather than using a shared environment variable.

```typescript
// dev portal
51869810: {
  asanaProjectGid: '1217881318437204', // Dennis-Staging
  asanaSections: {
    content: '1217881758656068',   // Developer Blog
    changelog: '1217881620715042', // Developer Changelog
  },
}

// prod portal
22047910: {
  asanaProjectGid: '1202179514576728', // BuildRel | Advocacy Content Factory
  asanaSections: {
    content: '1210601763434613',
    changelog: '1210743009828493',
  },
}
```

The workflow action reads `config.asanaProjectGid` and `config.asanaSections[objectType]` — no hardcoded constants, no environment variables to manage per deploy. The routing is baked into the portal config that already drives everything else.

## The Section Detail We Almost Missed

Asana tasks can be in a project without being in any section. When we first wired up task creation, tasks were landing in the project's catch-all area — not in the "Developer Blog" or "Developer Changelog" sections where they belonged.

The fix was in how Asana's task creation API works. To place a task in a specific section at creation time, you pass a `memberships` array:

```typescript
{
  data: {
    name: taskName,
    projects: [projectGid],
    memberships: [{ project: projectGid, section: sectionGid }],
    custom_fields: { ... },
  }
}
```

Without `memberships`, the task ends up in the default section. With it, you get exactly the placement you want, no post-creation move required.

## The Payoff

Dev syncs now land in Dennis-Staging. Production syncs land in the real project. Deleting test tasks is guilt-free. The provisioning script means if we ever need to set up another test project for a new collaborator, it's one command.

The broader lesson: environment isolation needs to be explicit in your configuration, not an afterthought. If your dev code can reach production data, eventually it will — and usually at the worst possible time.

---

*Watch the clean build in [Episode 14: Safe Testing Without Polluting Production](../walkthroughs/14-Safe%20Testing%20Without%20Polluting%20Production%3A%20Routing%20a%20HubSpot%20App%20to%20a%20Sandbox%20Asana%20Project.md)*
