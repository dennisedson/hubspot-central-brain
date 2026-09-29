## 🎬 YouTube Episode Guide: Write the Link Once — Connecting Obsidian Notes to CRM Records Without an Echo Loop

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to connect a local markdown vault to a CRM without building a sync engine — a two-way link written exactly once, and a way to test scaffolding that has no runtime code to test."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "I need my Obsidian notes and my HubSpot records to know about each other. The obvious answer is a sync process. The obvious answer is wrong, and I know that because this same project already got burned by it."
    Show the finished thing: a note whose frontmatter carries a HubSpot record id, and a HubSpot record whose `source_url` opens that note. Click through in both directions.
    "No daemon. No webhook. No conflict resolution. Both links are written once, at creation, and then never touched again."

*   **The Architecture (1:00 - 3:00):**
    Start with the temptation. A continuous sync sounds better: rename a note, the link follows. Change a title in HubSpot, the note updates.
    Then the war story that kills it. Earlier in this project the Linear sync needed `[hs-sync]` markers stamped into issue descriptions purely to break echo loops — HubSpot updates Linear, Linear's webhook fires, HubSpot updates again, forever. That was between two systems that *both* have webhooks and revision history to arbitrate with.
    "A markdown file on my laptop has neither. No webhook when I rename it. No revision history the CRM can inspect. If I built continuous sync here I'd be solving a harder version of a problem that already cost me a week — and solving it blind."
    Then the reframe: **what does the link actually need to do?** Answer a question in each direction. Which record is this note about? Which note is the draft for this record? Neither question needs live data. Both are answered by a value written once.
    "A link that breaks visibly when I rename a file is *better* than a loop that corrupts quietly. I can fix a broken link. I cannot see a loop until the data is wrong."

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Both directions, in the fields that already exist (3:00 - 4:30).**
    Note side: frontmatter with `hubspot_id` and `hubspot_portal` — those two together are the durable pointer, because a record id means nothing without knowing which portal it lives in.
    HubSpot side: `source_url`, a property whose documented purpose is already "Link to the draft (Google Doc, Obsidian note, etc.)". It holds an `obsidian://open?vault=…&file=…` URI.
    "I added no new HubSpot property for this. The field was already there, described for exactly this. Half of integration design is noticing what already exists."
    Then the honest caveat about the mirrored fields — `content_type`, `topic_tags` — they're a **cache** for filtering notes without a round-trip, and the README says outright that HubSpot wins if they disagree. "Name the authority or you'll be debugging which copy is right at 2am."

    **Step 2 — The vestigial object you must not link to (4:30 - 5:30).**
    Show the schema listing: `content_piece`, `video`, and a `changelog_entry` sitting right there looking exactly like the thing a changelog note should point at.
    Then the check: zero records, and the only reference anywhere in the codebase is one provisioning script that predates changelog being consolidated into `content_piece`'s second pipeline.
    "It's a trap left by our own history. It has the right name and it is completely wrong. So the template hardcodes `content_piece`, the README explains why, and a test enforces it — because in three months I will not remember."

    **Step 3 — Testing content that has no runtime (5:30 - 7:00).**
    The problem: this ships markdown. Nothing executes. What is there to test?
    The answer is the failure mode. These prompts are deliberately **self-contained** — every portal id and object type id inline — because a Cowork session has none of the repo's context. Which means a stale id inside one is invisible from Cowork's side. It doesn't error. It reads the wrong portal.
    Show the assertion: extract every `2-XXXXXXXX` and every 9–10 digit number from every prompt, and assert each exists in `portal-config.ts`.
    "That's the whole trick for testing documentation: don't test that the words are there. Test the facts that would be silently wrong."

    **Step 4 — The test catching my own overreach (7:00 - 8:00).**
    First run, one failure. My assertion said the changelog template must not contain the string `changelog_entry` — but the template deliberately *names* it in a comment explaining why not to use it.
    "Two ways to fix this. Delete the comment and make the test pass, or narrow the test to the actual mistake. The comment is the most useful line in that file — it's the thing that stops the next person reaching for the wrong object."
    Narrow the assertion to `hubspot_object: changelog_entry`. Both survive.
    "When a test fails, ask whether the test is describing the right failure. Deleting good code to satisfy a lazy assertion is the most common way test suites make a codebase worse."

*   **Testing & Wrap-up (8:00 - 10:00):**
    Copy the template to a real vault, show every folder arrives including the empty ones — because they carry `.gitkeep`, a lesson this project learned the hard way when `assets/` and `styles/` existed locally and silently never reached CI.
    Recap:
    1. **Ask what the link must answer** before deciding it needs syncing. Most links answer a question that a written-once value answers fine.
    2. **A visible break beats a quiet loop.**
    3. **Name the authority** whenever you cache a field in two places.
    4. **Check for vestigial objects.** The right-sounding name is not the right target.
    5. **Test documentation for facts that fail silently**, not for prose.

**💻 Screen-Ready Code Snippets:**

**Both halves of the link, each written once:**

```yaml
---
hubspot_object: content_piece
hubspot_id: "60962462621"     # id + portal together are the pointer —
hubspot_portal: 51869810      # an id alone is meaningless across portals
hubspot_pipeline: content
content_type: blog_post       # mirrors HubSpot. A CACHE. HubSpot wins.
topic_tags: [api, crm]
---
```

```
source_url = obsidian://open?vault=<vault>&file=changelogs%2Fwebhook-retries.md
```

**The vestigial-object check — run this before trusting a schema name:**

```bash
# It exists, it has the perfect name, and it is wrong.
grep -rn "changelog_entry" src/ | grep -v node_modules
#   → one hit, in a provisioning script that predates the consolidation

curl -s -H "Authorization: Bearer $HS_TOKEN" \
  "https://api.hubapi.com/crm/objects/2026-03/2-67505888?limit=1"
#   → {"results": []}     zero records, ever
```

**Testing a document for the facts that fail silently:**

```ts
// Prompts are self-contained by design, so a stale id inside one cannot be
// caught from the Cowork side — it would just read the wrong portal.
it('every id in every prompt matches portal-config', () => {
  const config = fs.readFileSync('src/app/lib/portal-config.ts', 'utf8');

  for (const file of PROMPTS) {
    const body = read(path.join('prompts', file));

    for (const m of body.matchAll(/\b2-\d{7,9}\b/g)) {
      expect(config, `${file} references unknown object type ${m[0]}`)
        .toContain(m[0]);
    }
    for (const m of body.matchAll(/\b\d{9,10}\b/g)) {
      expect(config, `${file} references unknown id ${m[0]}`).toContain(m[0]);
    }
  }
});
```

**The assertion that was wrong, and the narrower one that replaced it:**

```ts
// ✗ Too broad — rejects the comment that explains the trap
expect(body).not.toContain('changelog_entry');

// ✓ Rejects the actual mistake, keeps the explanation
expect(body).not.toContain('hubspot_object: changelog_entry');
```

> The template deliberately names `changelog_entry` in a comment saying why it must not be used. That comment is the most valuable line in the file. The fix was narrowing the test, not deleting the documentation.

**Empty folders need a keepfile or they never leave your laptop:**

```bash
for d in daily meetings content changelogs templates prompts \
         references references/enterpret/themes; do
  touch "vault-template/$d/.gitkeep"
done
```

> Git does not track empty directories. This project already lost a deploy cycle to exactly that when `assets/` and `styles/` existed locally and silently never reached CI.
