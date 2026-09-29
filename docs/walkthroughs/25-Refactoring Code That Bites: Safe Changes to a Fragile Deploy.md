## 🎬 YouTube Episode Guide: Refactoring Code That Bites — Safe Changes to a Fragile Deploy

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to refactor a component that has a history of failing deploys without re-opening the investigation — by writing down your rollback trigger *before* you start, changing exactly one thing, and building a verification gate that can't be fooled by a misleading success message."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "Last episode we spent an afternoon finding out why this component wouldn't deploy. Today we're going to change it on purpose — and the scary part is that the thing we're adding back is a thing that was *in the room* when it was failing."
    Show the inline style object: 33 keys of CSS living inside a JavaScript file. Explain why it's there — it was inlined during the investigation under a theory that turned out to be wrong. "The bug is fixed. The scar tissue isn't. Today we remove the scar tissue without re-opening the wound."
    Demo the payoff: identical dashboard, real `.module.css` file, green deploy.

*   **The Architecture (1:00 - 3:00):**
    Explain the uncomfortable position. CSS Modules were present in the original failing builds — the very first version shipped a `Dashboard.module.css`. So re-introducing them *feels* like walking back into the fire.
    Then show why the evidence says otherwise, and make the reasoning explicit on screen:
    - Builds #143–#145 failed with **no** CSS module anywhere.
    - Build #146 passed **with** inline styles.
    - The one variable that tracked the failure perfectly was `export const fields`.
    "CSS modules were *present* during failures. They were never *correlated* with them. Those are different claims, and mixing them up is how you end up superstitious about your own codebase."
    Introduce the key discipline: **write the rollback trigger into the spec before you write the code.** Not "revert if it breaks" — a specific sentence saying what a red deploy would *mean*.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Name the rollback trigger first (3:00 - 4:00).**
    Open the spec. Show the Risk section, written before any code:
    > "If the deploy goes red: revert to inline styles and record it in the support ticket — it would mean CSS modules are a *second, independent trigger* of the same empty-error failure, which materially changes the bug report."
    "That sentence is the whole episode. It converts a scary change into a cheap experiment. If it goes red, we haven't lost an afternoon — we've *learned something worth more than the refactor*, and we know exactly where it goes."

    **Step 2 — Turn duplicated objects into base + modifier (4:00 - 6:00).**
    Open [DashboardIsland.jsx](../../src/cms-assets/central-brain-dashboard/components/islands/DashboardIsland.jsx). Show the three spots that compose styles by spreading, and why a naive find-and-replace would have been wrong. Focus on `stageCardActive`: five properties repeated to change one border colour.
    "This is the part where a refactor earns its keep. We're not transcribing the object into CSS — we're expressing what it always meant. Three duplications disappear because CSS already has a way to say 'the same, but this one thing differs.'"

    **Step 3 — Prove the conversion is total (6:00 - 7:00).**
    The two greps that make this safe, both cheap:
    "First: did I miss a conversion? Second: does every class I *use* actually *exist*? A typo'd class name in CSS Modules doesn't throw — it renders `undefined` and your element silently loses all styling. That second grep catches what the compiler won't."

    **Step 4 — Build a gate that can't be fooled (7:00 - 8:00).**
    Show the three-part check, and explain why each part exists:
    - `Building ... DONE` — meaningless on its own, it was green through every single failure
    - `Deploying ... DONE` — necessary, still not sufficient
    - run conclusion `success` — because fifteen components printed DONE inside deploys that failed as a whole
    "Any one of these alone would have lied to me at some point during the last investigation. Together they can't."

*   **Testing & Wrap-up (8:00 - 10:00):**
    Run the deploy. Green, build #149. Show the dashboard rendering identically.
    Be honest on camera about the two things that did *not* get done: the visual check is a human step, and there's a pre-existing lint error in an untouched file that was deliberately **not** fixed in this commit. "Fixing it would have been one line. It also would have meant this commit did two things, and if the deploy had gone red I'd have had two suspects instead of one. Unrelated cleanup is not free — it costs you your ability to bisect."
    Recap:
    1. Write the rollback trigger before the code.
    2. "Present during failures" ≠ "caused the failures."
    3. Refactors should remove duplication, not transcribe it.
    4. Verify what the compiler can't see.
    5. One commit, one change, one suspect.

**💻 Screen-Ready Code Snippets:**

**Before** — 33 keys of CSS hiding in a JavaScript file, with duplication baked in:

```jsx
const styles = {
  stageCard:       { background: '#f7f8fa', borderRadius: '8px', padding: '14px 16px', borderLeft: '3px solid #e5e8ef' },
  stageCardActive: { background: '#f7f8fa', borderRadius: '8px', padding: '14px 16px', borderLeft: '3px solid #ff7a59' },
  dot:      { width: '8px', height: '8px', borderRadius: '50%', flexShrink: '0' },
  dotGreen: { background: '#00bda5' },
  dotGrey:  { background: '#c5c5d2' },
};

<div style={count > 0 ? styles.stageCardActive : styles.stageCard}>
<div style={{ ...styles.dot, ...(s.ok ? styles.dotGreen : styles.dotGrey) }} />
```

**After** — base plus modifier, the duplication gone:

```css
/* .stageCardActive must follow .stageCard — equal specificity, source order wins. */
.stageCard {
  background: #f7f8fa;
  border-radius: 8px;
  padding: 14px 16px;
  border-left: 3px solid #e5e8ef;
}

.stageCardActive {
  border-left-color: #ff7a59;
}
```

```jsx
import css from '../../styles/dashboard.module.css';

<div className={`${css.stageCard} ${count > 0 ? css.stageCardActive : ''}`}>
<div className={`${css.dot} ${s.ok ? css.dotGreen : css.dotGrey}`} />
```

**The two greps that make the conversion safe:**

```bash
# 1. Did any inline style survive the conversion?
grep -n "style=\|styles\." components/islands/DashboardIsland.jsx
# expected: no output

# 2. Does every class the island USES actually EXIST in the stylesheet?
#    CSS Modules fail silently — a typo renders `undefined`, not an error.
comm -23 \
  <(grep -o "css\.[a-zA-Z]*" components/islands/DashboardIsland.jsx | sed 's/css\.//' | sort -u) \
  <(grep -o "^\.[a-zA-Z]*" styles/dashboard.module.css | sed 's/^\.//' | sort -u)
# expected: no output
```

**The verification gate — all three, or it didn't happen:**

```bash
# Gate 1 + 2: both lines must read DONE
gh run view <run-id> --log \
  | grep -iE "Building central-brain-cms|Deploying central-brain-cms" | sort -u

# Gate 3: the run itself must be green — components print DONE inside failed deploys
gh run list --branch develop --limit 1 \
  --json conclusion -q '.[0].conclusion'   # must be: success
```

**The rollback trigger, written before the code:**

> If the deploy goes red, revert to inline styles and record it in the support ticket — it would mean CSS modules are a **second, independent trigger** of the same empty-error failure, separate from `export const fields`. That materially widens the bug report rather than being a local styling problem.

**Result:** green, build #149. The trigger went unused — which is the outcome you want, from a sentence you should write anyway.
