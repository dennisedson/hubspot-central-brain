# The Deploy That Broke 500 Workflows

*The story behind Episode 13: Stop Updating the Wrong Asana Task*

---

Three consecutive failed deploys. Each one with the same error:

```
BACKWARDS_INCOMPATIBLE_CHANGE: Adding a required field to an action definition
that has existing enrollments is not allowed.
```

We had just added a `title` input field to our `sync_to_asana` workflow action. It made perfect sense — the action creates Asana tasks, and tasks need names. We marked it required. We deployed.

The problem: HubSpot workflow actions are long-lived. The moment you publish an action definition, HubSpot starts enrolling records into workflows that use it. When a new required field appears in a definition update, every existing enrollment is now missing that field — and HubSpot refuses to deploy because it can't retroactively inject values into records that are already mid-flight through a workflow.

We were stuck. Rolling back would've meant losing the new field entirely. Forcing the deploy wasn't possible — the API rejects it.

## The Fix Is Simpler Than You'd Think

The solution is to **never add required fields to live action definitions.** New inputs should always be optional, with sane defaults in the handler code.

In `sync-to-asana-hsmeta.json`:
```json
{
  "internalName": "title",
  "isRequired": false
}
```

In `SyncToAsana.ts`:
```typescript
const title = context.body.inputFields.title ?? 'Untitled';
```

The record gets a task. The task gets a name. Existing enrollments keep working. The deploy goes through.

## What This Changes About How You Design Actions

The instinct when adding a field is to mark it required if you know you'll always want it. But "always" is relative to *new* enrollments — not the ones already in flight. The rule we internalized:

> **Required fields are for brand-new action definitions only.** Any field added to an existing definition must be optional.

This isn't a HubSpot quirk — it's a versioning constraint that shows up in every long-lived API surface. Think of it like adding a non-nullable column to a database table with existing rows: you need a default first, then the constraint.

## The Bonus Bug We Found While We Were At It

While fixing the deploy, we noticed a second problem hiding in the same action. When `linearIssueUrl` was empty (changelogs don't always have one), our code still passed it to Asana's custom field search API:

```typescript
// Before — dangerous
const taskGid = await findTaskByLinearIssueUrl(asanaApiKey, projectGid, linearIssueUrl);
```

Asana's search API treated an empty string as "match any value" and returned the first task in the project. Our action updated that task — silently, successfully, with a 200 response — and we only caught it by noticing the Asana task URL in the response pointed to an unrelated record.

The fix was a single guard:

```typescript
// After — safe
if (!taskGid && linearIssueUrl) {
  taskGid = await findTaskByLinearIssueUrl(asanaApiKey, projectGid, linearIssueUrl);
}
```

Two bugs. One guard. One optional-field declaration. A deploy that should've taken five minutes took three sessions to fully understand — but the lessons are sticky.

---

*Watch the clean build in [Episode 13: Stop Updating the Wrong Asana Task](../walkthroughs/13-Stop%20Updating%20the%20Wrong%20Asana%20Task%3A%20Bulletproof%20Task%20Lookup%20with%20Stored%20URLs.md)*
