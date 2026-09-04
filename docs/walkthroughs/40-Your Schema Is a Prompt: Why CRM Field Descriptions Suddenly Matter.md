## 🎬 YouTube Episode Guide: Your Schema Is a Prompt — Why CRM Field Descriptions Suddenly Matter

**🎯 Core Learning Objective:**
"By the end of this video, you will know why the `description` field on a custom CRM property stopped being documentation and became functional — it is read by AI connectors as context — and you will be able to audit your own schema for the fields that will make an agent guess wrong."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "I connected HubSpot to Claude, asked it about a custom object, and it told me something I didn't tell it in the prompt."
    Show the connector's reply describing `enterpret_quotes` as *"JSON array of developer quotes, synced out-of-band."*
    Then show where that sentence came from — the provisioning script, written days earlier:
    ```
    description: 'Developer quotes from Enterpret for this content piece, as a JSON array.
                  Synced out-of-band; read by the Enterpret Insights card.'
    ```
    "Nobody reads property descriptions. I wrote that one out of habit. It turns out the model reads them — and that changes what they're for."

*   **The Architecture (1:00 - 3:00):**
    Explain what a connector actually does when asked about an object. It fetches the property schema — names, labels, types, **and descriptions** — and that becomes context.
    So the schema is no longer just a data contract. It is part of the prompt.
    Then the uncomfortable audit. Run it live on screen:
    ```
    1 of 20 custom properties have a description
    ```
    "One. And it's the one the model described correctly and in detail. The other nineteen have a label and nothing else."
    Land the reframe: **a label names a field; a description explains it.** `Source URL` is a name. "Link to the draft — Google Doc, Obsidian note, etc." is an explanation. A human infers the second from context they already have. A model has no such context, so it guesses — and a confident wrong guess is worse than a question.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Find the fields that will actively mislead (3:00 - 4:30).**
    Not every field needs a description. `Title` is fine. Go hunting for the ones where a reasonable guess is wrong.
    Show the real offenders from this schema:
    - `source_url` and `published_url` — from labels alone, which one is the draft? A model has a 50/50 shot, and choosing wrong writes a draft link into the field meant for the live article.
    - `linear_id`, `linear_issue_id`, `linear_issue_url` — three fields, near-identical labels. One is the dedupe key the sync matches on. Nothing on screen says which.
    - `target_date` and `actual_date` — planned versus happened, invisible from the names.
    - `notes` — a label that says nothing at all.
    "These aren't gaps in documentation. They're ambiguities that a connector will resolve confidently and silently, and you'll find out when the data is wrong."

    **Step 2 — Write descriptions for the reader who has no context (4:30 - 6:00).**
    Show the pattern: what it holds, what writes it, what reads it, and any format constraint.
    ```
    ✗ "The published URL"                       — restates the label
    ✓ "Link to the live, published article.
       Empty until the record reaches Published.
       For the pre-publish draft, see source_url."
    ```
    "Point at the sibling field. That's what disambiguates a pair — you're not describing one field, you're describing the *boundary* between two."
    Then the format-constraint case, which is the highest-value kind:
    ```
    ✓ "Developer quotes as a JSON array, stored as a STRING because this is a
       textarea. Writing a nested object saves without error and renders nothing."
    ```
    "That sentence prevents a specific silent failure. It is worth more in the schema than in any README, because the schema is what the agent reads."

    **Step 3 — Put descriptions in the provisioning script, not the UI (6:00 - 7:00).**
    Show `provision-enterpret-quotes.ts` — the description lives beside the property definition, in version control, applied identically to all three portals.
    "Type it into the HubSpot UI and it exists on one portal, unreviewed, and vanishes the next time someone provisions a fresh account. Put it in the script and it's code review, three portals, one source of truth."

    **Step 4 — Audit your own (7:00 - 8:00).**
    Run the one-liner on screen against a real portal. Read out the count. "Whatever your number is, the fields with no description are the ones your agents are guessing about."

*   **Testing & Wrap-up (8:00 - 10:00):**
    Prove the loop closes: add a description, re-run the provisioning script, ask the connector about the field again, watch the new sentence come back in its answer.
    Recap:
    1. **Connectors read property descriptions.** The schema is context now.
    2. **Labels name, descriptions explain.** Only one of those survives losing your context.
    3. **Prioritise ambiguous pairs** — `source_url`/`published_url` — over obvious singles.
    4. **Descriptions are the right home for silent-failure warnings**, because that is where the agent looks.
    5. **Version-control them.** A description typed into a UI is a description that exists on one portal.

**💻 Screen-Ready Code Snippets:**

**The audit — run this against your own portal:**

```bash
curl -s -H "Authorization: Bearer $HS_TOKEN" \
  "https://api.hubapi.com/crm/properties/2026-03/2-67505887" | python3 -c "
import json,sys
props=[p for p in json.load(sys.stdin)['results']
       if not p['name'].startswith('hs_')]
missing=[p for p in props if not (p.get('description') or '').strip()]
print(f'{len(props)-len(missing)} of {len(props)} have a description')
for p in missing: print('  no description:', p['name'])"
```

**What it said here — the number that makes the point:**

```
1 of 20 custom properties have a description

WITH:
  enterpret_quotes    Developer quotes from Enterpret for this content piece…

WITHOUT (invisible to a connector):
  source_url          label='Source URL'
  published_url       label='Published URL'
  linear_id           label='Linear ID (unique)'
  linear_issue_id     label='Linear Issue ID'
  linear_issue_url    label='Linear Issue URL'
  target_date         label='Target Date'
  actual_date         label='Actual Publish Date'
  notes               label='Notes'
  …
```

**A description that disambiguates a pair, by naming its sibling:**

```ts
{
  name: 'source_url',
  label: 'Source URL',
  description:
    'Link to the DRAFT — Google Doc, Obsidian note, etc. Written when the ' +
    'record is created. For the published article see published_url.',
  type: 'string',
  fieldType: 'text',
}
```

**A description that prevents a specific silent failure:**

```ts
{
  name: 'enterpret_quotes',
  label: 'Enterpret Quotes',
  description:
    'Developer quotes from Enterpret for this content piece, as a JSON array. ' +
    'Synced out-of-band; read by the Enterpret Insights card.',
  type: 'string',
  fieldType: 'textarea',
}
```

> This is the one the connector read back, almost verbatim, without being told. The proof that the loop is real.

**Where descriptions belong — in the script, not the UI:**

```ts
// provision-enterpret-quotes.ts — one definition, all three portals,
// reviewed like any other change.
const PROPERTY = {
  name: 'enterpret_quotes',
  label: 'Enterpret Quotes',
  description: 'Developer quotes from Enterpret for this content piece, as a JSON array. ' +
               'Synced out-of-band; read by the Enterpret Insights card.',
  type: 'string',
  fieldType: 'textarea',
};
```

> Typed into the HubSpot UI instead, that sentence exists on one portal, was reviewed by nobody, and disappears the next time a fresh account is provisioned.
