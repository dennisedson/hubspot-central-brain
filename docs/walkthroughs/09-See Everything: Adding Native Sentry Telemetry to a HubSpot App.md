## 🎬 YouTube Episode Guide: See Everything: Adding Native Sentry Telemetry to a HubSpot App

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to add native telemetry to a HubSpot 2026.03 app so that all function logs and errors are automatically piped to Sentry — with zero SDK code required."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** "HubSpot's runtime doesn't expose function logs in the UI — only deploy logs. So when a sync silently fails, you have no idea why. Here's how we fixed that with one config file and got every `console.log` and error appearing in Sentry in real time."

*   **The Architecture (1:00 - 3:00):** HubSpot's 2026.03 platform has a built-in telemetry component that acts as a log sink. You configure which log types and levels to forward, add a `TELEMETRY_SECRET` (your Sentry DSN), and HubSpot pipes all matching log output to Sentry automatically. No Sentry SDK, no extra code in your functions.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    1.  **Create the config file** — `src/app/telemetry/telemetry-hsmeta.json`. Set `providerType: "SENTRY"`, choose log types (`APP_FUNCTION`, `ENDPOINT_FUNCTION`, `WEBHOOKS`), and log levels (`ERROR`, `WARN`, `INFO`). Start conservative — you can always add more types later.
    2.  **Create a Sentry project** — Node.js platform, Vanilla (no framework). Enable Error Monitoring and Logging. Copy the DSN from Settings → Client Keys.
    3.  **Add the secret** — `hs app secrets add --profile=dev` → name: `TELEMETRY_SECRET` → value: Sentry DSN. Repeat for staging and prod.
    4.  **Deploy and verify** — push to your deploy branch, trigger a function invocation, check Sentry Issues and Logs for output.

*   **Testing & Wrap-up (8:00 - 10:00):** Trigger the Linear webhook or workflow action, then open Sentry and show the `console.log` output appearing under Logs. Show an error scenario appearing under Issues with a full stack trace. Recap: one file, one secret, full visibility — no SDK needed.

**💻 Screen-Ready Code Snippets:**

```json
// src/app/telemetry/telemetry-hsmeta.json
{
  "uid": "telemetry",
  "type": "telemetry",
  "config": {
    "providerType": "SENTRY",
    "datasetName": "hubspot-central-brain",
    "logTypes": [
      "APP_FUNCTION",
      "ENDPOINT_FUNCTION",
      "WEBHOOKS"
    ],
    "logLevels": ["ERROR", "WARN", "INFO"]
  }
}
```

```bash
# Add the secret (repeat for each portal profile)
hs app secrets add --profile=dev
# Name: TELEMETRY_SECRET
# Value: https://your-key@your-id.ingest.us.sentry.io/your-project-id

hs app secrets add --profile=staging
hs app secrets add --profile=prod
```

**📋 Per-Environment Checklist:**
Every portal needs its own `TELEMETRY_SECRET` added before telemetry works. The same Sentry DSN can be used across all three environments, or you can create separate Sentry projects per environment for cleaner separation. Either way, the secret must be added AND a deploy must follow for the function to pick it up.

**⚠️ Volume Warning:**
The HubSpot docs warn that enabling all log types and levels can result in very high data volume. Start with `APP_FUNCTION` and `ENDPOINT_FUNCTION` only, and `ERROR`/`WARN`/`INFO` levels. Add `DEBUG`/`TRACE` only when actively debugging.
