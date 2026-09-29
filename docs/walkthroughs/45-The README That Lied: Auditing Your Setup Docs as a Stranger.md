## 🎬 YouTube Episode Guide: The README That Lied — Auditing Your Setup Docs as a Stranger

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to audit your own setup documentation by executing it as a hostile stranger — proving where it breaks with a reproducible command instead of reading it and assuming it's fine — and how to spot the specific class of rot where your `.env.example` and your config loader have quietly drifted apart."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 – 1:00):**
    Open on a green terminal. 616 tests passing, typecheck clean, a live deployed endpoint returning real data. Everything works. Then ask the question that ruins the afternoon: *"Could anyone else get here?"* Copy `.env.example` to `.env` exactly as the README instructs, run the first provisioning command, and watch it die in one line: `HUBSPOT_DEV_SERVICE_KEY is not set in .env or environment.` The app is healthy. The path to the app is broken. Those are different claims, and only one of them was ever tested.

*   **The Architecture (1:00 – 3:00):**
    Plain English on why setup docs rot faster than any other file. Every other artifact in the repo is executed constantly — tests run on every push, code runs in production. The README is executed *once per new person*, and on a solo project that number is zero. So it silently records the state of the world on the day it was written. The specific failure mode to name: **the example and the loader are two separate sources of truth for the same contract.** `.env.example` is a hand-maintained list; `script-env.ts` is the code that actually reads variables. Nothing links them, nothing tests them, so they drift — and the drift is invisible until someone new arrives.

*   **Step-by-Step Implementation (3:00 – 8:00):**

    *   **Step 1 — Execute the docs, don't read them (3:00 – 4:30).** The core technique. Make a throwaway directory, copy `.env.example` into it as `.env`, and run the real config loader against it in isolation with the parent environment stripped — `env -u` matters, or your own working shell masks the bug. Show the one-line failure. Emphasize: you now have a *reproduction*, not an opinion. That distinction is the whole episode.

    *   **Step 2 — Diff the two sources of truth (4:30 – 6:00).** Put `.env.example` and `script-env.ts` side by side and build the table on screen. Four variables the loader requires and the example never mentions; one variable the example ships that the loader never reads, because portal IDs turned out to be hardcoded. Land the general lesson: whenever a config example exists, ask what actually consumes it, then compare them mechanically rather than by eye.

    *   **Step 3 — Find the steps that were never written down (6:00 – 7:15).** Deploy succeeded, so surely setup is done? No. Grep `package.json` for provisioning scripts and count ten. Grep the README for them and find zero. Then the sharper trick: check which scripts have **no npm alias at all** — four of them, reachable only by reading `src/scripts/`. One of those four is required, and its own header comment says so: without it, an action 4xxs on every call. A required step that is both undocumented and undiscoverable is the worst combination in a repo.

    *   **Step 4 — Make the docs testable, not just correct (7:15 – 8:00).** Fixing prose is temporary; the rot returns. So add a check that fails loudly: parse every `npm run X` out of the README and assert each one exists in `package.json`. Show it printing `all 15 resolve`. Now the README has at least one executable claim, and the next drift gets caught.

*   **Testing & Wrap-up (8:00 – 10:00):**
    Re-run the reproduction from step 1 against the corrected `.env.example` and watch it get past the credential check. Run the README-command verifier. Run the full validate gate to prove the docs edit broke nothing. Then the honest close, which is the most valuable part: the walkthrough **still isn't fully verified**, because the local service key turned out to be a dead token. Say so in the commit rather than implying an end-to-end run happened. Documentation that admits what it hasn't proven is worth more than documentation that quietly implies it has.

**💻 Screen-Ready Code Snippets:**

**The audit — execute the docs in isolation:**
```bash
mkdir -p /tmp/envtest && cp .env.example /tmp/envtest/.env && cd /tmp/envtest

# env -u strips your real vars, or your own shell hides the bug
env -u HUBSPOT_DEV_SERVICE_KEY -u HUBSPOT_DEV_SYNC_SECRET \
    -u ASANA_API_KEY -u HUBSPOT_DEV_DEVELOPER_KEY \
  npx tsx -e "import {loadEnv} from '/abs/path/src/scripts/script-env.ts'; loadEnv()"

# HUBSPOT_DEV_SERVICE_KEY is not set in .env or environment.
```

**The drift — what the loader actually requires:**
```ts
// script-env.ts — the real contract
return {
  token:           requireVar(vars, `HUBSPOT_${prefix}_SERVICE_KEY`),
  personalKey:     requireVar(vars, `HUBSPOT_${prefix}_PERSONAL_ACCESS_KEY`),
  sharedSecret:    requireVar(vars, `HUBSPOT_${prefix}_SYNC_SECRET`),
  asanaApiKey:     requireVar(vars, 'ASANA_API_KEY'),
  developerApiKey: requireVar(vars, `HUBSPOT_${prefix}_DEVELOPER_KEY`),
};
// ...while .env.example shipped ACCOUNT_ID, which loadEnv never reads.
```

**Finding undiscoverable scripts:**
```bash
# every provisioning script with no npm alias
for f in src/scripts/provision-*.ts; do
  b=$(basename $f); grep -q "$b" package.json || echo "  orphaned: $b"
done
# orphaned: provision-associations.ts   ← required, and silent when skipped
```

**Make the README testable:**
```js
const pkg = JSON.parse(fs.readFileSync('package.json','utf8')).scripts;
const readme = fs.readFileSync('README.md','utf8');
const names = [...new Set([...readme.matchAll(/npm run ([a-z:-]+)/g)].map(m => m[1]))];
for (const n of names) console.log((n in pkg ? '  ok   ' : '  MISS ') + n);
// all 15 resolve
```

**Prove a credential is dead before blaming the script:**
```bash
# 401 here means regenerate the token — stop debugging the provisioning code
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $HUBSPOT_DEV_SERVICE_KEY" \
  https://api.hubapi.com/crm/v3/owners?limit=1
```
