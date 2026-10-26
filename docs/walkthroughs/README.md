# Episode guides

One guide per feature shipped or bug solved, written at the time — see `CLAUDE.md`
→ *Episode guides* for the format. Each is a record of how the code looked **when
it was written**. They are not rewritten as the code moves on; where a later
change would mislead someone following along, the guide carries a dated
**⚠️ Update** note under its title, and the table below says so.

## Read the older ones with these in mind

- **There are two portals, not three.** Staging was removed on 2026-09-29
  (ep 53): `develop` → dev on push, `master` → prod by hand. Guides before that
  mention a staging portal, branch, secret or Asana project.
- **Most functions publish no URL.** Since #126/#127 (eps 57–58) a function is
  private unless a caller genuinely needs its URL, and the CMS dashboard has one
  secret-gated door. Guides that `curl` `settings-api` or `content-data-api`
  predate that.
- **Scheduled work is a HubSpot "(Daily)" workflow.** No GitHub cron runs any
  more (ep 62); the credential health check is on demand (`npm run health`).
- **`changelog_entry` is gone** from both portals. A changelog is the second
  pipeline on `content_piece` (ep 15).
- **`SyncToLinear` asks the issue for its team** (ep 61); `provision:workflows`
  keeps each action's live team and version (ep 60).
- **A digest is any release in the rollup pipeline**, Spotlights included —
  matched by the pipeline's id, not the release name (ep 63).
- **Merges into `master` are merge commits** — `CLAUDE.md` → Process.

## Gap

Nothing covers 2026-10-01 — PRs #79 to #109, 31 merges: the settings surface,
changelog drafting, rollout dates, the credential probe. `CHANGELOG.md` has the
narrative.

## Index

| # | Episode | Read with |
|---|---|---|
| 01 | [Stop the Echo: Building Bulletproof Bidirectional Sync](01-Stop%20the%20Echo:%20Building%20Bulletproof%20Bidirectional%20Sync.md) |  |
| 02 | [Build a Type-Safe HubSpot CRM Client in TypeScript](02-Build%20a%20Type-Safe%20HubSpot%20CRM%20Client%20in%20TypeScript.md) |  |
| 03 | [From HubSpot to Linear: Building a Workflow Action Serverless Function](03-From%20HubSpot%20to%20Linear:%20Building%20a%20Workflow%20Action%20Serverless%20Function.md) | State lookup now uses the issue's own team (ep 61) |
| 04 | [Never Hit a Label Conflict Again: Automating HubSpot Custom Object Provisioning](04-Never%20Hit%20a%20Label%20Conflict%20Again:%20Automating%20HubSpot%20Custom%20Object%20Provisioning.md) |  |
| 05 | [One Codebase, Three Portals: Runtime Multi-Environment Config for HubSpot Apps](05-One%20Codebase,%20Three%20Portals:%20Runtime%20Multi-Environment%20Config%20for%20HubSpot%20Apps.md) | Written for three portals; there are two (ep 53) |
| 06 | [Shipping HubSpot Apps with GitHub Actions: The Traps No One Warns You About](06-Shipping%20HubSpot%20Apps%20with%20GitHub%20Actions:%20The%20Traps%20No%20One%20Warns%20You%20About.md) | Staging branch and portal removed — note at top |
| 07 | [The Debug Marathon: Getting Linear Webhooks Into HubSpot Serverless Functions](07-The%20Debug%20Marathon:%20Getting%20Linear%20Webhooks%20Into%20HubSpot%20Serverless%20Functions.md) |  |
| 07b | [Settings Without UUIDs: Building a Zero-Config HubSpot Settings Page](07b-Settings%20Without%20UUIDs:%20Building%20a%20Zero-Config%20HubSpot%20Settings%20Page.md) | `settings-api` is private now — note at top |
| 08 | [Closing the Loop: Building the HubSpot to Linear Workflow Action](08-Closing%20the%20Loop:%20Building%20the%20HubSpot%20to%20Linear%20Workflow%20Action.md) | State lookup now uses the issue's own team (ep 61) |
| 09 | [See Everything: Adding Native Sentry Telemetry to a HubSpot App](09-See%20Everything:%20Adding%20Native%20Sentry%20Telemetry%20to%20a%20HubSpot%20App.md) |  |
| 10 | [Settings Without Code: Building a HubSpot App Settings Page](10-Settings%20Without%20Code:%20Building%20a%20HubSpot%20App%20Settings%20Page.md) |  |
| 11 | [Hunting the Ghost URL: Debugging a Silent Workflow Action Failure](11-Hunting%20the%20Ghost%20URL:%20Debugging%20a%20Silent%20Workflow%20Action%20Failure.md) |  |
| 12 | [Settings That Actually Work: Wiring Runtime Config to the Webhook Handler](12-Settings%20That%20Actually%20Work:%20Wiring%20Runtime%20Config%20to%20the%20Webhook%20Handler.md) |  |
| 13 | [Stop Updating the Wrong Asana Task: Bulletproof Task Lookup with Stored URLs](13-Stop%20Updating%20the%20Wrong%20Asana%20Task:%20Bulletproof%20Task%20Lookup%20with%20Stored%20URLs.md) |  |
| 14 | [Safe Testing Without Polluting Production: Routing a HubSpot App to a Sandbox Asana Project](14-Safe%20Testing%20Without%20Polluting%20Production:%20Routing%20a%20HubSpot%20App%20to%20a%20Sandbox%20Asana%20Project.md) | Written for three portals; there are two (ep 53) |
| 15 | [One Object Two Pipelines: Consolidating HubSpot Custom Objects](15-One%20Object%20Two%20Pipelines:%20Consolidating%20HubSpot%20Custom%20Objects.md) | `changelog_entry` is now gone from both portals |
| 16 | [Stop Clicking, Start Scripting: Provisioning HubSpot Workflows Programmatically](16-Stop%20Clicking,%20Start%20Scripting:%20Provisioning%20HubSpot%20Workflows%20Programmatically.md) | Partial PUT replaced by a full-replace recipe — note at top, ep 60 |
| 17 | [Five Bugs One Session: Debugging a Multi-Environment HubSpot Workflow Integration](17-Five%20Bugs%20One%20Session:%20Debugging%20a%20Multi-Environment%20HubSpot%20Workflow%20Integration.md) | Written for three portals; the dotenv lesson stands |
| 18 | [The Silent Filter Bug: When Your API Search Returns the Wrong Task](18-The%20Silent%20Filter%20Bug:%20When%20Your%20API%20Search%20Returns%20the%20Wrong%20Task.md) |  |
| 19 | [Close the Loop: Building an Asana-to-HubSpot Webhook Listener](19-Close%20the%20Loop:%20Building%20an%20Asana-to-HubSpot%20Webhook%20Listener.md) |  |
| 20 | [From Push to Pull: Building a Polling-Based Asana-HubSpot Sync](20-From%20Push%20to%20Pull:%20Building%20a%20Polling-Based%20Asana-HubSpot%20Sync.md) |  |
| 21 | [From Meetings to Projects: Syncing Fellow Action Items to HubSpot with Dynamic Pipeline Resolution](21-From%20Meetings%20to%20Projects:%20Syncing%20Fellow%20Action%20Items%20to%20HubSpot%20with%20Dynamic%20Pipeline%20Resolution.md) |  |
| 22 | [Three Shapes, One Fix: Reverse-Engineering HubSpot Serverless Return Values](22-Three%20Shapes,%20One%20Fix:%20Reverse-Engineering%20HubSpot%20Serverless%20Return%20Values.md) |  |
| 23 | [Your Portal on Glass: Building a CMS React Dashboard with Islands](23-Your%20Portal%20on%20Glass:%20Building%20a%20CMS%20React%20Dashboard%20with%20Islands.md) | Data path replaced by one secret-gated door — note at top, ep 58 |
| 24 | [The Empty Error: Bisecting a Deploy That Refuses to Talk](24-The%20Empty%20Error:%20Bisecting%20a%20Deploy%20That%20Refuses%20to%20Talk.md) |  |
| 25 | [Refactoring Code That Bites: Safe Changes to a Fragile Deploy](25-Refactoring%20Code%20That%20Bites:%20Safe%20Changes%20to%20a%20Fragile%20Deploy.md) |  |
| 26 | [The Bisect That Lied: When Your Test Harness Is Non-Deterministic](26-The%20Bisect%20That%20Lied:%20When%20Your%20Test%20Harness%20Is%20Non-Deterministic.md) |  |
| 27 | [One Card, Two APIs: Live Cross-System Status Inside a HubSpot Record](27-One%20Card,%20Two%20APIs:%20Live%20Cross-System%20Status%20Inside%20a%20HubSpot%20Record.md) |  |
| 28 | [No AI Required: Template-Driven Social Drafts That Never Overwrite a Human](28-No%20AI%20Required:%20Template-Driven%20Social%20Drafts%20That%20Never%20Overwrite%20a%20Human.md) |  |
| 29 | [Why Am I Seeing This: Scoring Related Records Inside HubSpot](29-Why%20Am%20I%20Seeing%20This:%20Scoring%20Related%20Records%20Inside%20HubSpot.md) |  |
| 30 | [Shipping Before the Key: A Card That Is Finished Without Its Integration](30-Shipping%20Before%20the%20Key:%20A%20Card%20That%20Is%20Finished%20Without%20Its%20Integration.md) |  |
| 31 | [The Tests That Werent Testing: Preparing a Migration You Cant Verify](31-The%20Tests%20That%20Werent%20Testing:%20Preparing%20a%20Migration%20You%20Cant%20Verify.md) |  |
| 32 | [Pin the URL: Handler Tests That Make a Migration Verifiable](32-Pin%20the%20URL:%20Handler%20Tests%20That%20Make%20a%20Migration%20Verifiable.md) |  |
| 33 | [The Association That Never Was: Provisioning What Your Workflow Action Needs](33-The%20Association%20That%20Never%20Was:%20Provisioning%20What%20Your%20Workflow%20Action%20Needs.md) |  |
| 34 | [The Name Was the Bug: Self-Referential HubSpot Associations That Actually Work](34-The%20Name%20Was%20the%20Bug:%20Self-Referential%20HubSpot%20Associations%20That%20Actually%20Work.md) |  |
| 35 | [Probe, Dont Infer: Finishing a Deprecation Migration Against a Live Portal](35-Probe,%20Dont%20Infer:%20Finishing%20a%20Deprecation%20Migration%20Against%20a%20Live%20Portal.md) |  |
| 36 | [Delete the Integration: Reading Synced Data Instead of Calling an API](36-Delete%20the%20Integration:%20Reading%20Synced%20Data%20Instead%20of%20Calling%20an%20API.md) |  |
| 37 | [Three Views One Page: Adding a Changelog Manager to a HubSpot UI Extension](37-Three%20Views%20One%20Page:%20Adding%20a%20Changelog%20Manager%20to%20a%20HubSpot%20UI%20Extension.md) |  |
| 38 | [The Path That Was Never Where You Expected: Migrating to HubSpot's Dated Schemas API](38-The%20Path%20That%20Was%20Never%20Where%20You%20Expected:%20Migrating%20to%20HubSpot's%20Dated%20Schemas%20API.md) |  |
| 39 | [Write the Link Once: Connecting Obsidian Notes to CRM Records Without an Echo Loop](39-Write%20the%20Link%20Once:%20Connecting%20Obsidian%20Notes%20to%20CRM%20Records%20Without%20an%20Echo%20Loop.md) | `changelog_entry` is now gone from both portals |
| 40 | [Your Schema Is a Prompt: Why CRM Field Descriptions Suddenly Matter](40-Your%20Schema%20Is%20a%20Prompt:%20Why%20CRM%20Field%20Descriptions%20Suddenly%20Matter.md) | Written for three portals; there are two |
| 41 | [Talk to Your CRM: Building Breeze Agent Tools That Know Your Content Pipeline](41-Talk%20to%20Your%20CRM:%20Building%20Breeze%20Agent%20Tools%20That%20Know%20Your%20Content%20Pipeline.md) |  |
| 42 | [Green Deploy, Broken Tool: Testing Breeze Agent Tools That Fail Without Failing](42-Green%20Deploy,%20Broken%20Tool:%20Testing%20Breeze%20Agent%20Tools%20That%20Fail%20Without%20Failing.md) |  |
| 43 | [The Sed That Stopped Matching: When Your Deploy Pipeline Quietly Ships the Wrong Portal](43-The%20Sed%20That%20Stopped%20Matching:%20When%20Your%20Deploy%20Pipeline%20Quietly%20Ships%20the%20Wrong%20Portal.md) | Written for three portals; the verify-the-rewrite lesson stands |
| 44 | [Zero Checks: When Your CI Trigger Names a Branch That Doesnt Exist](44-Zero%20Checks:%20When%20Your%20CI%20Trigger%20Names%20a%20Branch%20That%20Doesnt%20Exist.md) | Branch names of the three-portal era; the lesson stands |
| 45 | [The README That Lied: Auditing Your Setup Docs as a Stranger](45-The%20README%20That%20Lied:%20Auditing%20Your%20Setup%20Docs%20as%20a%20Stranger.md) |  |
| 46 | [Expired 20,705 Days Ago: When an Auth Error Lies About Whats Wrong](46-Expired%2020,705%20Days%20Ago:%20When%20an%20Auth%20Error%20Lies%20About%20Whats%20Wrong.md) |  |
| 47 | [Most of a Port Is Deletion: Moving a Firebase App Inside HubSpot](47-Most%20of%20a%20Port%20Is%20Deletion:%20Moving%20a%20Firebase%20App%20Inside%20HubSpot.md) |  |
| 48 | [The Parameter That Was Never There: When Your Tests Encode the Wrong Reality](48-The%20Parameter%20That%20Was%20Never%20There:%20When%20Your%20Tests%20Encode%20the%20Wrong%20Reality.md) |  |
| 49 | [The Half-Working Webhook: When Verification Succeeds and Delivery Cannot](49-The%20Half-Working%20Webhook:%20When%20Verification%20Succeeds%20and%20Delivery%20Cannot.md) |  |
| 50 | [Leaving the Queue: Making an Unassignment Travel Across Three Systems](50-Leaving%20the%20Queue:%20Making%20an%20Unassignment%20Travel%20Across%20Three%20Systems.md) |  |
| 51 | [Null Is Not an Answer: Making a Silently Skipped Feature Confess](51-Null%20Is%20Not%20an%20Answer:%20Making%20a%20Silently%20Skipped%20Feature%20Confess.md) |  |
| 52 | [The Second Front Door: Creating Linear Issues Without Creating Fifty](52-The%20Second%20Front%20Door:%20Creating%20Linear%20Issues%20Without%20Creating%20Fifty.md) |  |
| 53 | [Delete the Environment, Keep the Check: Replacing Staging With Ten Assertions](53-Delete%20the%20Environment,%20Keep%20the%20Check:%20Replacing%20Staging%20With%20Ten%20Assertions.md) |  |
| 54 | [Five Failures Between a Green Deploy and a Working App](54-Five%20Failures%20Between%20a%20Green%20Deploy%20and%20a%20Working%20App.md) |  |
| 55 | [Truthy Is Not a Check: The Sentinel That Lied About Being Empty](55-Truthy%20Is%20Not%20a%20Check:%20The%20Sentinel%20That%20Lied%20About%20Being%20Empty.md) |  |
| 56 | [One Brain, Two Machines: Shared Instructions That Make Your AI Write Tests](56-One%20Brain,%20Two%20Machines:%20Shared%20Instructions%20That%20Make%20Your%20AI%20Write%20Tests.md) |  |
| 57 | [The Door You Forgot You Opened: Auditing Public Serverless Endpoints](57-The%20Door%20You%20Forgot%20You%20Opened:%20Auditing%20Public%20Serverless%20Endpoints.md) | Superseded in part by ep 58 and ep 62 — note at top |
| 58 | [One Door, One Key: Securing an Endpoint Two Callers Share](58-One%20Door,%20One%20Key:%20Securing%20an%20Endpoint%20Two%20Callers%20Share.md) |  |
| 59 | [Follow the Release: Syncing a Digest Doc Link from Linear Without Owning the Digest](59-Follow%20the%20Release:%20Syncing%20a%20Digest%20Doc%20Link%20from%20Linear%20Without%20Owning%20the%20Digest.md) | Rollups matched by pipeline, not name — note at top, ep 63 |
| 60 | [Snapshot, Run, Diff: Catching a Provisioning Script That Rewrote Live Workflows](60-Snapshot,%20Run,%20Diff:%20Catching%20a%20Provisioning%20Script%20That%20Rewrote%20Live%20Workflows.md) |  |
| 61 | [Ask the Issue, Not the Config: Resolving a Linear Team From the Record Itself](61-Ask%20the%20Issue,%20Not%20the%20Config:%20Resolving%20a%20Linear%20Team%20From%20the%20Record%20Itself.md) |  |
| 62 | [The Scheduler You Already Had: Moving a Cron Out of GitHub and Behind a Secret](62-The%20Scheduler%20You%20Already%20Had:%20Moving%20a%20Cron%20Out%20of%20GitHub%20and%20Behind%20a%20Secret.md) |  |
| 63 | [Membership Is the Container, Not the Name: Matching Linear Releases by Pipeline](63-Membership%20Is%20the%20Container,%20Not%20the%20Name:%20Matching%20Linear%20Releases%20by%20Pipeline.md) |  |
