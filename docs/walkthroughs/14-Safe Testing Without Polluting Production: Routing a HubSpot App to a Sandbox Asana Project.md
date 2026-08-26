## 🎬 YouTube Episode Guide: Safe Testing Without Polluting Production

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to provision a sandbox Asana project, mirror its structure from production, and route your dev/staging/prod portals to different projects using per-portal config — so your test syncs never touch real data."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** You're testing your HubSpot-to-Asana sync on the dev portal and it creates a task straight into your real content pipeline. There's no environment separation — dev, staging, and prod all hit the same project. We fix this with a sandbox project, a provisioning script to mirror its structure, and per-portal routing in `portal-config.ts`.

*   **The Architecture (1:00 - 3:00):** Three components work together:
    1. **A sandbox Asana project** (e.g. "Dennis-Staging") with the same sections and custom fields as production — provisioned once by script, not by hand.
    2. **`asanaProjectGid` and `asanaSections` in `PortalConfig`** — each portal (dev/staging/prod) declares its own target project and section GIDs.
    3. **Section-aware task creation** — when creating a new Asana task, pass a `memberships` array with `{project, section}` so the task lands in the right section automatically.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    *   **Step 1 — Write the provisioning script** (`src/scripts/provision-asana-test-project.ts`): Fetch existing sections, create any missing ones, then call `/projects/{gid}/addCustomFieldSetting` for each workspace-level field. Print the resulting section GIDs for copy-paste into config.
    *   **Step 2 — Extend `PortalConfig`** (`src/app/lib/portal-config.ts`): Add `asanaProjectGid: string` and `asanaSections: { content: string; changelog: string }`. Wire dev to the sandbox GID and staging/prod to the real project GID.
    *   **Step 3 — Use config in the workflow action** (`src/app/functions/SyncToAsana.ts`): Replace the hardcoded `ASANA_PROJECT_GID` constant with `config.asanaProjectGid` and pull the section via `config.asanaSections[objectType]`.
    *   **Step 4 — Pass `sectionGid` to `createTask`** (`src/app/lib/asana-client.ts`): Accept an optional `sectionGid` parameter. When present, add `memberships: [{project, section}]` to the task payload — this is the Asana API's way of placing a task in a specific section at creation time.

*   **Testing & Wrap-up (8:00 - 10:00):** Run `ASANA_API_KEY=xxx npm run provision:asana-test-project` and copy the printed section GIDs into `portal-config.ts`. Trigger a sync on dev — verify the task appears in Dennis-Staging under the correct section, not in the real project. Summary: never hardcode project IDs in workflow actions; put them in config keyed by portal so environment separation is guaranteed.

**💻 Screen-Ready Code Snippets:**

```typescript
// portal-config.ts — per-portal Asana routing
const CONFIGS: Record<number, PortalConfig> = {
  // dev
  51869810: {
    asanaProjectGid: '1217881318437204', // Dennis-Staging (test project)
    asanaSections: {
      content: '1217881758656068',   // Developer Blog section
      changelog: '1217881620715042', // Developer Changelog section
    },
    // ...
  },
  // prod
  22047910: {
    asanaProjectGid: '1202179514576728', // BuildRel | Advocacy Content Factory
    asanaSections: {
      content: '1210601763434613',
      changelog: '1210743009828493',
    },
    // ...
  },
};
```

```typescript
// asana-client.ts — section-aware task creation
export async function createTask(
  apiKey: string,
  projectGid: string,
  name: string,
  customFields: Record<string, string>,
  sectionGid?: string,
): Promise<{ gid: string }> {
  const memberships = sectionGid
    ? [{ project: projectGid, section: sectionGid }]
    : undefined;

  return request(apiKey, 'POST', '/tasks', {
    data: {
      name,
      projects: [projectGid],
      custom_fields: customFields,
      ...(memberships ? { memberships } : {}),
    },
  });
}
```

```typescript
// provision-asana-test-project.ts — mirror sections and fields
const SECTIONS_TO_CREATE = ['Developer Blog', 'Developer Changelog', 'Backlog', /* ... */];
const FIELDS_TO_ADD = [
  { gid: '1202184607659964', name: 'Pipeline Stage' },
  { gid: '1213736210804469', name: 'Linear Issue URL' },
  // ...
];

for (const field of FIELDS_TO_ADD) {
  await fetch(`/projects/${TEST_PROJECT_GID}/addCustomFieldSetting`, {
    method: 'POST',
    body: JSON.stringify({ data: { custom_field: field.gid, is_important: true } }),
  });
}
```
