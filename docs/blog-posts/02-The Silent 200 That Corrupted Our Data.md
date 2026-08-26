# The Silent 200 That Corrupted Our Data

*The story behind Episode 13: Stop Updating the Wrong Asana Task*

---

The workflow action returned 200. The Asana API returned 200. The HubSpot logs showed success. And somewhere in our Asana project, a random task had just been silently updated with the wrong pipeline stage.

We only found out because we noticed the task URL in the response body pointed somewhere unexpected. If we hadn't been watching closely, we would have kept syncing and never known.

## How It Happened

The `sync_to_asana` workflow action is supposed to find an existing Asana task (by matching a Linear issue URL stored in a custom field) and update its pipeline stage. If no task is found, it creates one.

The lookup code looked like this:

```typescript
const taskGid = await findTaskByLinearIssueUrl(asanaApiKey, projectGid, linearIssueUrl);
```

What we didn't account for: changelogs don't always have a Linear issue URL. When the workflow fired for a changelog record with an empty `linearIssueUrl`, we passed an empty string to the search.

Asana's task search API is flexible — a custom field filter with an empty string value doesn't return zero results. It returns the first task in the project that has *any* value for that field. Or sometimes just the first task overall. The behavior isn't clearly documented, and it varies.

The result: `findTaskByLinearIssueUrl` returned a valid GID. Our code updated that task. Everything succeeded. The wrong task now had the wrong stage.

## The Fix and Why It Works

The guard is tiny:

```typescript
if (!taskGid && linearIssueUrl) {
  taskGid = await findTaskByLinearIssueUrl(asanaApiKey, projectGid, linearIssueUrl);
}
```

If `linearIssueUrl` is empty, we skip the search entirely. If there's no stored task URL either, we create a new task instead of modifying an existing one we didn't mean to touch.

But we didn't stop there. We also added a higher-priority lookup: before searching Asana at all, check if the HubSpot record already has an `asana_task_url` property. If it does, we can extract the task GID directly from the URL and skip the API search entirely:

```typescript
let taskGid: string | null = null;

if (existingAsanaTaskUrl) {
  const parts = existingAsanaTaskUrl.split('/');
  taskGid = parts[parts.length - 1] || null;
}

if (!taskGid && linearIssueUrl) {
  taskGid = await findTaskByLinearIssueUrl(asanaApiKey, projectGid, linearIssueUrl);
}
```

This makes re-syncs idempotent: the first sync creates a task and writes its URL back to HubSpot. Every subsequent sync reads that URL directly — no search, no ambiguity, no risk of matching the wrong record.

## The Lesson About "Successful" API Calls

The bug was invisible because every component behaved correctly within its own contract. The workflow action did what it was supposed to do. The Asana API returned valid data. The HubSpot action returned success. The failure was at the boundary — in an assumption about what an empty string search would return.

APIs that accept flexible filter parameters are dangerous this way. A search with no constraints is often valid — it just means "give me everything." Your code needs to decide whether "no filter" is the right thing to ask for, or whether it should bail out entirely.

The principle: **validate inputs before making API calls, not just before returning responses.** A 200 from an API doesn't mean your business logic was correct. It means the request was well-formed.

---

*Watch the clean build in [Episode 13: Stop Updating the Wrong Asana Task](../walkthroughs/13-Stop%20Updating%20the%20Wrong%20Asana%20Task%3A%20Bulletproof%20Task%20Lookup%20with%20Stored%20URLs.md)*
