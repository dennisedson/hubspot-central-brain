## 🎬 YouTube Episode Guide: Delete the Environment, Keep the Check — Replacing Staging With Ten Assertions

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to decide whether a staging environment is earning its keep — and how to replace it with a preflight check that asserts your production portal actually matches what your code expects, before a deploy touches it."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    Open on the config, not the argument. Pull up `portal-config.ts` and show three environments. Then show the staging entry pointing at `1202179514576728` — **the same Asana project, and the same two sections, as production.**

    Say the line the whole episode hangs on: *"This environment existed to protect production. It was configured to write into production's project."*

    Then the payoff: one command against prod, and two faults nobody had recorded appear in four seconds.

*   **The Architecture (1:00 - 3:00):**
    Make the case in plain English, because it's a judgement call and viewers should be able to disagree with it.

    What is staging *for*? Catching problems before users see them. For a single-operator project, the honest answer is: catching **per-portal provisioning drift**. Object type ids, pipeline ids, stage ids and properties all differ per portal, so code that works on dev can fail on prod because a property was never created there. That's real, and it's the one thing dev genuinely cannot catch.

    Now ask whether staging was catching it. Ours had gone unmaintained for the life of the project: no changelog pipeline of its own, possibly holding workflow actions pointing at dev, and aimed at the real production Asana project. **An environment nobody keeps current doesn't just fail to help — it gives false confidence and becomes somewhere wrong-portal writes can originate.**

    Then the general principle, which is the transferable bit: **a check beats an environment for this job because a check fails loudly.** A stale environment fails silently. If your team has been burned by silent failures — green deploys that shipped nothing, `sed` matching nothing and exiting 0 — you already know which you'd rather have.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Take the environment out properly (3:00 - 4:30).**
    Show the removal, and stress the one line that matters: deleting the entry from `portal-config.ts`. Not the workflow file, not the profile — the config. Because `getPortalConfig` throws on an unknown portal, removing it converts "silently writes to the wrong portal" into "refuses to start." Deleting the deploy workflow is housekeeping; deleting the config is the safety change.

    **Step 2 — Write the check (4:30 - 6:00).**
    Open `src/scripts/preflight.ts`. Four things, in order: object type ids exist, pipelines exist, stages exist within them, and every property the app reads or writes exists on its object.

    Spend your time on the fourth. That's the one that catches the real bugs, and say why: the properties this project got wrong were `youtube_url`, `source_url` and `asana_task_id` — provisioned but never written, or read but absent — and **every single one was discovered by a human noticing something blank**, not by anything failing.

    **Step 3 — Be deliberate about what you don't check (6:00 - 6:45).**
    Secrets are excluded on purpose. The deploy already validates them and names the missing one. A second list that could drift out of agreement with the deploy is worse than no list at all. This is a good moment to make a general point about checks: **a check that can disagree with the authority it duplicates is a liability.**

    **Step 4 — Run it against production and watch it work (6:45 - 8:00).**
    This is the best moment in the episode, and it's real output, not a staged demo:

    ```
    FAIL [pipeline] content/changelog has no pipelineId configured
    FAIL [property] app_configs is missing: youtube_channel_id, …
    ```

    Explain what the second one would have cost. HubSpot **omits** unknown properties rather than erroring. So the OAuth flow would have completed, returned success, and then reported `disconnected` forever — with nothing in any log. That's an afternoon of debugging, converted into one CI step.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Wire it into the prod deploy before the upload, so a deploy cannot proceed over drift. Then the honest epilogue, because it's the most useful part:

    **Fixing prod broke a test, and the test deserved to break.** A guard test asserted "400 when the pipeline isn't configured" by naming a portal that happened to have no changelog pipeline. It passed for a reason unrelated to the guard, and stopped passing the moment someone finished provisioning. **A test that depends on something being incomplete stops testing anything the moment it's completed.** It now stubs a config instead.

    Close on the rule: when you're deciding whether to keep an environment, ask what it uniquely catches, then ask whether a check could catch the same thing and fail louder. Often it can, and it costs four seconds instead of a portal.

**💻 Screen-Ready Code Snippets:**

**1. The removal that actually protects you** — `src/app/lib/portal-config.ts`

```ts
// Deleting the deploy workflow is housekeeping. Deleting THIS is the safety
// change: getPortalConfig throws on an unknown portal, so an accidental
// deploy to the old id now refuses to start instead of writing to it.
export function getPortalConfig(portalId: number): PortalConfig {
  const config = CONFIGS[portalId];
  if (!config) throw new Error(`No portal config found for portalId ${portalId}`);
  return config;
}
```

**2. The check that replaced it** — `src/scripts/preflight.ts`

```ts
async function checkProperties(
  token: string, label: string, objectTypeId: string, required: string[],
) {
  const body = await hsGet<{ results?: Array<{ name?: string }> }>(
    token, propertiesPath(objectTypeId),
  );
  const live = new Set((body?.results ?? []).map(r => r.name).filter(Boolean));

  const missing = required.filter(name => !live.has(name));
  if (missing.length > 0) fail('property', `${label} is missing: ${missing.join(', ')}`);
  else pass(`${required.length} properties on ${label}`);
}
```

**3. Fail the deploy, don't warn**

```ts
if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s) — this portal is NOT ready for a deploy:\n`);
  for (const f of failures) console.error(`  FAIL [${f.area}] ${f.detail}`);
  console.error('\nDeploying over drift does not error — it produces records with blank');
  console.error('properties and syncs that report success while writing nothing.\n');
  process.exit(1);
}
```

**4. In the deploy, before the upload** — `.github/workflows/deploy-prod.yml`

```yaml
- name: Preflight — does prod match portal-config?
  env:
    PORTAL: prod
    HUBSPOT_PROD_SERVICE_KEY: ${{ secrets.HUBSPOT_PROD_SERVICE_KEY }}
  run: npm run preflight
```

**5. The test that was passing for the wrong reason**

```ts
it('returns 400 when the requested pipeline is not configured', async () => {
  // Built on a stubbed config rather than a real portal, deliberately. This
  // used to point at whichever portal happened to lack a changelog pipeline,
  // so it passed for a reason unrelated to the guard — and broke the day that
  // portal was finally provisioned.
  vi.doMock('@lib/portal-config', async () => { /* … changelog: { pipelineId: '' } */ });

  const { main } = await import('../functions/BreezeContentPipeline');
  const res = await main(ctx({ pipeline: 'changelog' }, TEST_PORTAL_ID));

  expect(res.statusCode).toBe(400);
});
```
