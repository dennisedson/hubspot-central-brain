## 🎬 YouTube Episode Guide: Your Portal on Glass — Building a CMS React Dashboard with Islands

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to build a membership-gated, at-a-glance CMS dashboard in a HubSpot Project using CMS React, Islands for client-side interactivity, and your own serverless functions as the data layer — all within the same project as your app."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    Open on the finished page: an orange-gradient header reads "Central Brain Dashboard." Below it, three stat cards — content pipeline count, sync health dots, Linear settings — and a full pipeline breakdown grid. Click Refresh. The numbers update live without a page reload.
    "This page is membership-gated. Only people on your HubSpot membership list can see it. And every number on it comes from your own serverless functions — the same ones your workflow actions already call. You didn't write a separate backend. You reused what you already had."

*   **The Architecture (1:00 - 3:00):**
    Explain the two-layer model. The CMS page is server-rendered HTML, fast and SEO-clean. The Island is a React subtree that hydrates client-side on load and handles all the data fetching and interactivity.
    Draw the data path: CMS page loads → Island JavaScript runs in the browser → `fetch()` hits `/<portalId>.hs-sites.com/hs/serverless/content-data-api` and `settings-api` → responses paint the cards.
    Key insight: the portal ID is available at `window.hsVars.portal_id`, so the same module works across dev, staging, and prod portals without a config change.
    Explain why no CMS function is needed — your existing private app serverless functions already have public HTTP endpoints registered via their hsmeta files. The CMS Island just fetches from those URLs.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Scaffold the CMS assets component (3:00 - 4:30).**
    Open [cms-assets-hsmeta.json](../../src/cms-assets/cms-assets-hsmeta.json). Show the three required fields: `uid`, `type: "cms-assets"`, and `themePath` pointing to your assets folder.
    Then open [central-brain-dashboard/package.json](../../src/cms-assets/central-brain-dashboard/package.json) and point out the two dependencies: `@hubspot/cms-components` and `@hubspot/cms-dev-server`. Pin them to an exact version — not a range. HubSpot's deploy pipeline processes the artifact against a specific runtime; a stale semver range can match a build that the portal's deploy processor can't handle.
    Open [cms-assets.json](../../src/cms-assets/central-brain-dashboard/cms-assets.json). Show the two fields: `label` and `outputPath: ""`.

    **Step 2 — Write the module shell (4:30 - 5:30).**
    Open [components/modules/Dashboard/index.jsx](../../src/cms-assets/central-brain-dashboard/components/modules/Dashboard/index.jsx). Show how thin it is — just an Island mount.
    ```jsx
    import { Island } from '@hubspot/cms-components';
    import DashboardIsland from '../../islands/DashboardIsland.jsx?island';

    export function Component() {
      return <Island module={DashboardIsland} hydrateOn="load" title="Central Brain Dashboard" />;
    }

    export const meta = { label: 'Central Brain Dashboard' };
    ```
    Explain the `?island` suffix — it's a Vite bundler hint that tells the build tool to create a separate client-side chunk for this component. Without it, the component renders server-side only with no React hydration.
    Note: keep the module shell simple. Do not add a `fields` export here — there is a known portal-side issue where `ModuleFields` in this position causes a silent deploy crash with an empty error body.

    **Step 3 — Build the Island (5:30 - 7:30).**
    Open [components/islands/DashboardIsland.jsx](../../src/cms-assets/central-brain-dashboard/components/islands/DashboardIsland.jsx).
    Show the portal ID detection:
    ```js
    function getBase() {
      const portalId = typeof window !== 'undefined' && window.hsVars?.portal_id;
      return portalId ? `https://${portalId}.hs-sites.com/hs/serverless` : null;
    }
    ```
    Walk through the `load` function — `Promise.all` to fetch pipeline and settings in parallel, dual response shape handling (`pipelineJson.body` might be a JSON string if the serverless function wraps it, or a plain object if it doesn't).
    Show the CSS module import from the `styles/` directory: `import css from '../../styles/dashboard.module.css'`. CSS modules scope class names automatically — no global leakage onto the host page.

    **Step 4 — Deploy and create the page (7:30 - 8:00).**
    Push to develop. GH Action runs `hs project upload && hs project deploy`.
    In HubSpot: Content → Website Pages → Create page → drag in the "Central Brain Dashboard" module → Publish.
    To gate it: page Settings → Audience access → Private — requires membership → pick your list.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Load the published page. Open DevTools → Network. Filter for `serverless`. You should see two requests fire on load: one to `content-data-api`, one to `settings-api`. Both return 200. The cards populate.
    Click Refresh. Watch the requests fire again. Count in the Pipeline Breakdown card should match what you see in HubSpot CRM.
    Recap: one `cms-assets` component, one Island, two reused serverless endpoints. The dashboard costs you zero new backend code — it's a read layer on top of what was already there.

**💻 Screen-Ready Code Snippets:**

**Module shell (`index.jsx`):**
```jsx
import { Island } from '@hubspot/cms-components';
import DashboardIsland from '../../islands/DashboardIsland.jsx?island';

export function Component() {
  return <Island module={DashboardIsland} hydrateOn="load" title="Central Brain Dashboard" />;
}

export const meta = { label: 'Central Brain Dashboard' };
```

**Portal-agnostic base URL detection (Island):**
```js
function getBase() {
  const portalId = typeof window !== 'undefined' && window.hsVars?.portal_id;
  return portalId ? `https://${portalId}.hs-sites.com/hs/serverless` : null;
}
```

**Parallel data fetch with dual response shape handling:**
```js
const [pipelineRes, settingsRes] = await Promise.all([
  fetch(`${base}/content-data-api`),
  fetch(`${base}/settings-api?action=getSettings`),
]);
const pipelineJson = await pipelineRes.json();
// Serverless functions may return { body: "...json..." } or plain JSON
const data = typeof pipelineJson.body === 'string'
  ? JSON.parse(pipelineJson.body)
  : pipelineJson;
```

**`package.json` — pin exact versions, not ranges:**
```json
{
  "dependencies": { "@hubspot/cms-components": "1.2.70" },
  "devDependencies": { "@hubspot/cms-dev-server": "1.2.70" }
}
```
