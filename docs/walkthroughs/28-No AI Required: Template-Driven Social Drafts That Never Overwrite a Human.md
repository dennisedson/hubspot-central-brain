## 🎬 YouTube Episode Guide: No AI Required — Template-Driven Social Drafts That Never Overwrite a Human

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to build a HubSpot custom workflow action that generates a ready-to-post LinkedIn draft from CRM properties — using nothing but a pure TypeScript template function — and how to make it safely idempotent so it never destroys an edit a human made."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "Every 'AI writes your social posts' demo has the same two problems: it costs money on every run, and it silently overwrites the post you already hand-edited. Today we're building the opposite — a zero-dependency, zero-API-key draft generator that runs inside a HubSpot workflow, and that refuses to clobber human work."
    Demo: show a Content Piece record with a title, type, published URL, and topic tags. Enroll it in the workflow. Refresh — the Social Post Draft property is populated with a formatted LinkedIn post. Then hand-edit that draft, re-enroll, refresh again: the edit survives. The action reports `skipped`.

*   **The Architecture (1:00 - 3:00):**
    Plain-English framing, three pieces:
    1. **A pure function** (`social-draft.ts`) — properties in, string out. No `fetch`, no clock, no randomness. That purity is why we can TDD it with 49 tests in under a second.
    2. **A thin serverless function** (`GenerateSocialDraft.ts`) — the only part that touches the network. Read the record, call the pure function, write one property.
    3. **A workflow action definition** (the hsmeta JSON) — how HubSpot's workflow UI learns that this endpoint exists and what inputs it takes.

    Explain the key design constraint on screen: the draft has a **protected tail**. The published URL and the hashtags are the parts that actually drive clicks, so when we hit LinkedIn's character limit we truncate the *body* and never the tail. Draw it: `[opener][title][theme]` is squeezable, `[URL][hashtags]` is not.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 (3:00 - 4:30): The variant map — open `src/app/lib/social-draft.ts`.**
    Show `CONTENT_TYPE_VARIANTS`. The point to make on screen: a blog post and a video should not open with the same sentence, and "Read the full post:" is wrong for a video. Exporting the map (instead of burying a `switch` in the function) means copy changes never touch logic, and the tests can assert against the same source of truth. Show `DEFAULT_VARIANT` and the `variantFor()` fallback — unknown content types must never crash the workflow.

    **Step 2 (4:30 - 6:00): Hashtags — same file.**
    Show `toHashtag` and `buildHashtags`. Three things worth explaining:
    - Split on *any* non-alphanumeric run, so `ui_extensions`, `developer platform`, and `ci/cd` all normalize the same way.
    - The `HASHTAG_ACRONYMS` set. HubSpot stores enum values lowercase, so naive pascal-casing gives you `#Api` and `#Crm`. That looks amateur on LinkedIn. One `Set` fixes it.
    - The cap of 4, plus de-duplication — `api`, `API`, and `a.p.i` all collapse to one `#API`.

    **Step 3 (6:00 - 7:00): The protected tail — same file, `generateSocialDraft`.**
    Show blocks being built and `.filter(Boolean)`-ed. Call out the requirement this satisfies: no published URL means the CTA block disappears entirely, so you never ship a post ending in a dangling "Read the full post:". Then show the truncation branch — `roomForBody = MAX - tail.length - separator.length`.

    **Step 4 (7:00 - 8:00): The guard — open `src/app/functions/GenerateSocialDraft.ts`.**
    Show the `param()` helper first (inputs arrive three different ways, and Workflows nests them under `inputFields`). Then the money block: read `social_post_draft`, and if it is non-empty and `force` is not set, return early. Emphasize: this is what makes the action safe to leave running on a schedule forever.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Run `npx vitest run src/app/__tests__/social-draft.test.ts` — 49 tests, ~30ms, because the unit under test is pure. Highlight the two most valuable tests: the one asserting a 7600-character title still produces a draft under 2800 characters, and the one asserting that same truncated draft *still ends with all four hashtags and still contains the full URL*.
    Then prove the guard end-to-end in HubSpot: run the workflow, hand-edit the draft, run it again, and show the `{ skipped: true, reason: 'draft already exists' }` response in the action's execution log.
    Summary: pure core plus thin shell makes the hard logic testable in milliseconds; a read-before-write guard turns a destructive automation into a safe one.

**💻 Screen-Ready Code Snippets:**

**1. The variant map — copy lives in data, not in logic**

```ts
export const CONTENT_TYPE_VARIANTS: Record<string, ContentTypeVariant> = {
  blog_post: { opener: 'New blog post is live.',        cta: 'Read the full post:' },
  video:     { opener: 'New video just dropped.',       cta: 'Watch it here:'      },
  tutorial:  { opener: 'Fresh tutorial, start to finish.', cta: 'Follow along here:' },
  talk:      { opener: 'The talk recording is now up.', cta: 'Watch the talk:'     },
  changelog: { opener: 'Heads up — there is a new changelog entry worth knowing about.', cta: 'Full details:' },
};

export const DEFAULT_VARIANT: ContentTypeVariant = {
  opener: 'Sharing something new.',
  cta: 'Take a look:',
};

function variantFor(contentType?: string | null): ContentTypeVariant {
  return CONTENT_TYPE_VARIANTS[(contentType ?? '').trim().toLowerCase()] ?? DEFAULT_VARIANT;
}
```

**2. Hashtags that don't look amateur**

```ts
// HubSpot stores enum values lowercase, so without this you ship "#Api".
export const HASHTAG_ACRONYMS = new Set(['api', 'crm', 'ui', 'ux', 'sdk', 'cli', 'graphql']);

function capitalizeWord(word: string): string {
  if (HASHTAG_ACRONYMS.has(word.toLowerCase())) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function toHashtag(tag?: string | null): string {
  const words = (tag ?? '').trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return words.length ? `#${words.map(capitalizeWord).join('')}` : '';
}
// 'ui_extensions'      -> '#UIExtensions'
// 'developer platform' -> '#DeveloperPlatform'
```

**3. The protected tail — truncate the body, never the link**

```ts
const bodyBlocks = [variant.opener, title, themeSentence].filter(Boolean);
const tailBlocks = [
  url ? `${variant.cta} ${url}` : '',        // no URL -> no dangling CTA
  hashtags.length ? hashtags.join(' ') : '',
].filter(Boolean);

const body = bodyBlocks.join('\n\n');
const tail = tailBlocks.join('\n\n');
const full = `${body}\n\n${tail}`;
if (full.length <= MAX_DRAFT_LENGTH) return full;

// Over the cap: squeeze the body, keep the link and hashtags whole.
const roomForBody = MAX_DRAFT_LENGTH - tail.length - '\n\n'.length;
const trimmed = truncate(body, roomForBody);
return trimmed ? `${trimmed}\n\n${tail}` : tail;
```

**4. The guard that makes it safe to re-run forever**

```ts
const existingDraft = (props.social_post_draft ?? '').trim();

// A human may have rewritten this in HubSpot. Never clobber their edit
// unless the caller explicitly asks us to regenerate.
if (existingDraft && !force) {
  return result(200,
    { skipped: true, reason: 'draft already exists', objectId },
    { draftStatus: 'skipped', reason: 'draft already exists' });
}
```

**5. Reading inputs from all three call shapes**

```ts
// Direct query call, JSON body, or nested under inputFields by Workflows.
function param(ctx: GenerateSocialDraftContext, key: string): string | undefined {
  return (
    str(ctx.parameters?.[key]) ??
    str(ctx.query?.[key]) ??
    str(ctx.body?.[key]) ??
    str(ctx.body?.inputFields?.[key])
  );
}
```

**6. Example output**

```
New blog post is live.

Building Bulletproof Bidirectional Sync Between HubSpot and Linear

This one came straight from what developers keep telling us about webhook echo loops.

Read the full post: https://developers.hubspot.com/blog/bidirectional-sync

#API #Workflows #DeveloperPlatform
```
