## 🎬 YouTube Episode Guide: The Empty Error — Bisecting a Deploy That Refuses to Talk

> **⚠️ Correction — read before filming.** The conclusion this episode reaches, that `export const fields` cannot deploy, is **wrong**. The real cause was a double-deploy race in CI: `hs project upload` auto-deploys after building, and the workflow then deployed the *same build* a second time. A component only deploys successfully once, so whichever attempt ran second failed. `fields` deploys fine — it only broke the redundant second deploy. See [episode 26](26-The%20Bisect%20That%20Lied:%20When%20Your%20Test%20Harness%20Is%20Non-Deterministic.md).
>
> The bisect *technique* below is still sound and still worth teaching. What it produced was a false conviction, because the harness underneath it was non-deterministic — a perfect 7-for-7 correlation that was really a coin flip weighted by build timing. That is the deeper lesson, and the honest version of this episode leads with it: **a bisect is only as trustworthy as the determinism of the thing you're testing.**

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to isolate an opaque deploy failure — the kind that gives you no stack trace, no error ID, and literally an empty error body — by bisecting a component down to its absolute floor and walking it back up one rung at a time, using CI runs as your test harness."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    Open on the error, in all its uselessness:
    `[ERROR] Deployment of hubspot-central-brain failed due to an internal error.`
    Then scroll to the part that makes it worse — `--- central-brain-cms failed with the following error ---` followed by *nothing*. An empty error body.
    "One component out of sixteen. The build succeeds every time. The deploy dies every time. And HubSpot won't tell us why. By the end of this video we'll have the exact line of code responsible — found without a single log message from the server."
    Demo the payoff: the dashboard rendering live on the CMS page, deployed green.

*   **The Architecture (1:00 - 3:00):**
    Explain the split that cracks the case: a HubSpot project component goes through **two** distinct server-side phases.
    1. **Build** — compiles your JSX into an artifact. `Building central-brain-cms ... DONE`
    2. **Deploy** — takes that artifact and *registers* it into the portal. `Deploying central-brain-cms ... FAILED`
    "Build passing and deploy failing tells you something enormous: your code compiles fine. The problem is in what the compiler *emitted* and how the portal tried to swallow it. That halves your search space before you've changed a line."
    Then the key mental model for the episode: **an empty error body is the signature of an unhandled server-side exception**, not a validation failure. Contrast with a real validation error the CLI renders properly (`Encountered the following errors for .../pages-hsmeta.json`). Validation errors are *handled*; this one crashed something.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Correlate before you theorize (3:00 - 4:00).**
    Open the terminal, run `gh run list`. Show the table: three failures with the component, one success the moment it was reverted, another failure the moment it came back. "Component present ⇒ deploy fails. That's a perfect correlation across five builds. We haven't opened a single source file yet and we already know exactly which component owns the bug."

    **Step 2 — Watch four good hypotheses die (4:00 - 5:30).**
    This is the honest part of the episode, and the most useful. Show the eliminated list — theme directory structure, module `meta` fields, dependency version a full major behind, and three materially different versions of the component source. Each one tested in isolation. Each one failing *byte-identically*.
    "Here's the lesson. When your fix changes nothing about the failure — not the message, not the timing, not the stage — you didn't fix the wrong thing. You were looking in the wrong *place*. Three identical failures in a row is your signal to stop guessing and start bisecting."

    **Step 3 — Fall all the way to the floor (5:30 - 6:45).**
    Open [index.jsx](../../src/cms-assets/central-brain-dashboard/components/modules/Dashboard/index.jsx) and delete almost everything. No island. No fields. No imports. A module that returns a `<div>`.
    "Resist the urge to remove *half*. Go to the absolute floor first. If the floor fails, the problem isn't your code at all and you've saved yourself an afternoon. If the floor passes, you now have a known-good baseline — and every rung above it is a suspect you can convict individually."
    Push. Green. Build #142. "That single green build just eliminated the entire portal-side theory."

    **Step 4 — Climb one rung at a time (6:45 - 8:00).**
    Add the `fields` export back. Push. **Red.** Build #143.
    Narrow it: empty `ModuleFields`, no `TextField`. Push. **Red.** Build #144.
    Then the move that makes it airtight — copy HubSpot's *own* reference field markup, verbatim, from their official 2026.03 sample repo. Push. **Red.** Build #145.
    "That's the whole case. When the vendor's own documented example fails in your project, you are no longer debugging your code. You're documenting their bug."

*   **Testing & Wrap-up (8:00 - 10:00):**
    Prove the workaround ships: restore the full 197-line dashboard island, keep the `Island` import, drop only the `fields` export, hardcode the title. Push. **Green**, build #146. Show the dashboard rendering on the page.
    Then pin the dependency and confirm still green (#147) — "not causal, but `latest` in a lockfile-free directory is a future outage."
    Recap the transferable technique:
    1. Correlate presence/absence before theorizing.
    2. Note *which phase* fails — it halves the search space.
    3. Three identical failures = wrong place, not wrong fix.
    4. Bisect to the floor, then climb.
    5. Reproduce with the vendor's own sample to convert "my bug" into "their bug."
    Close on the cost: the eliminated hypotheses were all *reasonable*. Being reasonable isn't the same as being right, and CI runs are cheap enough to let evidence decide.

**💻 Screen-Ready Code Snippets:**

**The one line that broke it** — this module builds fine and fails to deploy:

```jsx
import { ModuleFields, TextField } from '@hubspot/cms-components/fields';

export function Component({ fieldValues }) {
  return <div>{fieldValues.footerText}</div>;
}

// ⚠️ This export was CONVICTED IN ERROR. Removing it did flip the
//    build green — but only by changing timing in a racy CI pipeline.
//    See the correction at the top of this file.
export const fields = (
  <ModuleFields>
    <TextField label="Footer Text" name="footerText" default="Be Well." />
  </ModuleFields>
);

export const meta = {
  label: 'Central Brain Dashboard',
};
```

**The bisect floor** — start here, not halfway:

```jsx
export function Component() {
  return <div>Central Brain Dashboard</div>;
}

export const meta = {
  label: 'Central Brain Dashboard',
};
```

**The shipping version** — full island, no `fields`:

```jsx
import { Island } from '@hubspot/cms-components';
import DashboardIsland from '../../islands/DashboardIsland.jsx?island';

export function Component() {
  return (
    <Island
      module={DashboardIsland}
      hydrateOn="load"
      title="Central Brain Dashboard"
    />
  );
}

export const meta = {
  label: 'Central Brain Dashboard',
};
```

**Reading the two-phase split in CI** — the command that reframed the whole investigation:

```bash
# Build phase vs deploy phase, side by side
gh run view <run-id> --log | grep -iE "Building central-brain-cms|Deploying central-brain-cms"

# Building central-brain-cms  ... DONE     <- your code compiles
# Deploying central-brain-cms ... FAILED   <- the portal choked on the artifact
```

**The bisect ladder, as run:**

| Build | Component contains | Result |
|-------|--------------------|--------|
| #142 | bare `<div>`, no imports | ✅ green |
| #143 | + `fields` export w/ `TextField` | ❌ red |
| #144 | + `fields` export, empty `ModuleFields` | ❌ red |
| #145 | + HubSpot's verbatim reference field | ❌ red |
| #146 | full island, **no** `fields` export | ✅ green |
| #147 | + dependency pinned to `1.2.70` | ✅ green |

**Known limitation, since corrected:** at the time of filming the module title was hardcoded, on the belief that the `fields` export could not deploy. That belief was wrong (see the correction at the top). No support ticket was warranted — the bug was in our own workflow, not HubSpot's platform. Restoring the `fields` export is what ultimately made the module render at all.
