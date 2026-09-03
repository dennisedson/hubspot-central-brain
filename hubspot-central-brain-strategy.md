# HubSpot as the Central Brain

**A Hub-and-Spoke Strategy for Developer Advocacy**

Dennis Edson | Developer Advocate | HubSpot
August 2026 | v7

*DRAFT — Living Document*

---

## 1. The Problem

Over time, your daily workflow has migrated away from HubSpot and into a constellation of purpose-built tools — Linear for engineering tasks, Asana for cross-functional projects, Fellow for meeting capture, Obsidian for notes, Enterpret for developer feedback analysis. Each tool is good at what it does, but the result is scattered context: no single place knows about all your work, and the platform you advocate for has become the one you use least.

This strategy flips that. The goal is to make HubSpot the relational brain that connects everything — not by replacing every tool, but by ensuring HubSpot always has a structured, linked record of what matters. You keep the satellite tools where they're strong. You build the connective tissue yourself, using HubSpot's own developer platform. And in doing so, you re-engage deeply with the APIs, serverless functions, UI extensions, workflows, and Breeze agent tools that you advocate for.

> **THE DUAL OBJECTIVE:** This project serves two purposes: (1) build a system that genuinely improves your workflow, and (2) force deep, hands-on re-engagement with HubSpot's developer platform — not through external hosting, but by building everything on HubSpot itself. The build is the point.

---

## 2. The Architecture: Hub and Spoke

The system has seven layers. HubSpot is both the brain and the sync infrastructure — serverless functions, webhooks, workflow actions, and pipeline automation all live inside a single HubSpot Projects app. No external hosting required.

### 2.1 The Layers

| Layer | Tool | Role | What Lives Here |
|-------|------|------|-----------------|
| Think | Obsidian | Personal knowledge base | Raw notes, meeting notes, drafts, ideas, daily journals. All markdown, all local. |
| Orchestrate | Cowork | Glue and ad-hoc automation | Reads Obsidian, talks to all APIs, processes and routes information. Bridges gaps before automation is built. |
| Brain + Sync | HubSpot | Central graph + integration engine | Custom objects (Content, Changelog, Video), contacts, associations, serverless functions, webhooks, workflow automation, UI extensions, Breeze agent tools. Video object manages the YouTube pipeline natively — no external backend. |
| Team / Content Factory | Linear / Asana | Task management + content production | Linear for engineering tasks. Asana is the content factory — where content production workflow lives operationally. HubSpot state changes push updates to Asana task states via serverless functions. |
| Capture | Fellow | Meeting intelligence | Transcripts, summaries, action items. Feeds into HubSpot and Obsidian via serverless sync. |
| Feedback | Enterpret | Developer feedback intelligence | Aggregates developer feedback into a Knowledge Graph. Surfaces friction themes, pain points, and feature requests. A goldmine for content ideas. |
| Create | Descript / Canva / Figma / Adobe | Creative production tools | Video editing, visual design, UI mockups, image generation. Connected via MCP. Cowork orchestrates; outputs sync back to HubSpot records. |

### 2.2 The Information Flow

The key insight is that information flows in predictable patterns. A meeting in Fellow produces action items that become tasks in Linear and notes in Obsidian. A developer question in the community becomes a content idea in HubSpot, which moves through a pipeline, gets drafted in Obsidian, and links back to the contact who inspired it. The brain (HubSpot) doesn't need to hold the content itself — it holds the structure and relationships.

Typical flows:

- Fellow meeting → action items extracted → routed to Linear (tasks) + HubSpot (associated to contact) + Obsidian (meeting notes)
- Content idea → HubSpot Content object created → drafted in Obsidian → pipeline stages tracked in HubSpot → Linear task for review
- Changelog → HubSpot Changelog object with link to Linear issue → pipeline: drafting → reviewing → published → custom event tracks developer engagement
- Enterpret friction theme surfaces → Cowork queries Knowledge Graph → creates Content idea in HubSpot with source context → associated to affected product area
- Cowork → reads Obsidian for context → queries Enterpret for developer pain points → creates/updates HubSpot records → queries Linear/Asana for status
- Content published → Canva MCP generates social graphic from brand template → Descript MCP triggers video edits → LinkedIn post auto-queued in HubSpot Social → asset URLs written back to Content/Video records

### 2.3 Why Everything Lives in HubSpot

The previous version of this strategy used Vercel for the sync layer. That's been replaced with HubSpot's own serverless functions (Projects 2026.03). The reasons are both practical and philosophical:

- One codebase, one deploy. The sync functions, UI extensions, workflow actions, and webhook handlers all live in a single HubSpot Projects app.
- No external hosting to manage. No Vercel account, no environment variables to sync, no separate deploy pipeline.
- Tighter platform integration. Serverless functions in Projects have native access to HubSpot's context — no API key juggling for internal calls.
- The build is the curriculum. Every function you write teaches you a different surface of the platform you advocate for.

---

## 3. The HubSpot Data Model

The data model centers on three custom objects — Content, Changelog Entry, and Video — plus strategic use of HubSpot's native Projects object and other built-in objects. This is designed to be lean — start with what you need, extend as patterns emerge.

### 3.1 Custom Object: Content

Tracks any piece of content through its lifecycle, from idea to published artifact.

| Property | Type | Description |
|----------|------|-------------|
| title | Text | Working title of the content piece |
| content_type | Dropdown | Blog post, video, tutorial, talk, changelog, documentation, social |
| status | Pipeline stage | Idea → Outline → Drafting → Editing → Review → Published → Archived |
| source_url | URL | Link to the draft (Google Doc, Obsidian note, etc.) |
| published_url | URL | Link to the published artifact |
| linear_issue_url | URL | Link to the associated Linear issue, if any |
| asana_task_url | URL | Link to the associated Asana task, if any |
| linear_issue_id | Text | Linear issue ID for sync (hidden from UI) |
| asana_task_id | Text | Asana task ID for sync (hidden from UI) |
| target_date | Date | Target publish date |
| actual_date | Date | Actual publish date |
| topic_tags | Multi-checkbox | API, CRM, Workflows, UI Extensions, Integrations, etc. |
| enterpret_theme | Text | Enterpret friction theme or feedback category that inspired this content, if any |
| enterpret_quote_count | Number | Number of developer quotes in Enterpret related to this topic — quantifies demand |
| notes | Multi-line text | Internal notes, context, background |
| social_post_draft | Multi-line text | Auto-generated LinkedIn post copy. Editable before publishing. (See Section 9.3) |
| social_published_at | Datetime | When the social post went live |
| social_post_url | URL | URL of the published LinkedIn post |
| social_engagement_score | Number | Aggregate engagement (likes + comments + shares). Updated via sync. |

#### Pipeline: Content Lifecycle

| Stage | Probability | Description |
|-------|-------------|-------------|
| Idea | 10% | Captured from a meeting, community thread, or brainstorm. Not yet committed. |
| Outline | 20% | Structure defined. Decision made to produce this content. |
| Drafting | 40% | Actively being written/recorded. |
| Editing | 60% | Draft complete. In editing or review cycle. |
| Review | 80% | Final review by stakeholders. |
| Published | 100% | Live and available. |
| Archived | 0% | Retired or superseded. |

#### Associations

- Content → Contact: the developer/person who inspired the idea, or the subject matter expert
- Content → Company: if the content relates to a partner or customer use case
- Content → Content: related pieces (e.g., a blog post that spawned a video)
- Content → Changelog Entry: when content directly documents a product change
- Content → Video: when a content piece is a video, the Video record holds production data and YouTube metrics
- Content → Project: groups content under a larger effort (launch, sprint, initiative)

### 3.2 Custom Object: Changelog Entry

Tracks product changelog entries through their lifecycle. This is your most frequent content type and deserves its own object with tailored properties.

| Property | Type | Description |
|----------|------|-------------|
| title | Text | Changelog entry title |
| product_area | Dropdown | CRM, Marketing, Sales, Service, Operations, Developer Platform, etc. |
| change_type | Dropdown | New feature, improvement, deprecation, bug fix, breaking change |
| status | Pipeline stage | Identified → Drafting → Reviewing → Published |
| linear_issue_url | URL | Link to the Linear issue that drove this change |
| linear_issue_id | Text | Linear issue ID for sync |
| published_url | URL | Link to the published changelog entry |
| release_date | Date | When the change shipped or will ship |
| publish_date | Date | When the changelog entry was published |
| developer_impact | Dropdown | Breaking, action required, informational |
| notes | Multi-line text | Internal context |
| topic_tags | Multi-checkbox | Same values as Content object. Enables cross-content discovery — changelogs about the same topic surface alongside related blog posts and videos. |
| enterpret_theme | Text | Enterpret friction theme this changelog addresses, if any. Enables discovery by developer pain point. |

#### Pipeline: Changelog Lifecycle

| Stage | Probability | Description |
|-------|-------------|-------------|
| Identified | 20% | Change is known, changelog entry not yet started. |
| Drafting | 50% | Writing the entry. |
| Reviewing | 80% | In review with stakeholders or PM. |
| Published | 100% | Live on the changelog. |

#### Associations

- Changelog → Contact: the PM, engineer, or stakeholder who owns the change
- Changelog → Content: when a blog post or tutorial documents this changelog entry
- Changelog → Project: groups changelog entries under a launch or initiative
- Changelog → Company: if the change was driven by a partner or customer request

### 3.3 Custom Object: Video

A native HubSpot custom object that tracks YouTube videos through their full lifecycle — from scripting through publishing — with metrics synced from the YouTube API via HubSpot serverless functions. No external backend (no Firebase, no standalone hosting). Everything lives in HubSpot.

> **WHY CUSTOM OBJECT, NOT APP OBJECT:** The original Creator Console used a BETAMAX App Object with Firebase backend, Gemini AI, and Google Docs bidirectional sync. This rebuild strips all external dependencies. A regular custom object is simpler to create and iterate on — no app approval process, no app-prefixed property names, no schema permanence constraints. YouTube API calls still happen, but they run through HubSpot serverless functions inside your Projects app.

| Property Group | Fields | Description |
|---------------|--------|-------------|
| Identity | title, youtube_video_id, youtube_url | Core identifiers. youtube_video_id has hasUniqueValue to prevent duplicates. |
| Content | video_description, thumbnail_url, tags | Video metadata synced from YouTube or set manually. |
| Lifecycle | status (Draft/Scheduled/Public), published_at, scheduled_publish_at | The video pipeline. Status drives automation and sync behavior. |
| Metrics | view_count, like_count, comment_count | YouTube engagement metrics pulled by a HubSpot serverless sync function. |
| Analytics | impressions, click_through_rate, average_view_duration | YouTube Studio analytics synced via ETag-optimized polling in serverless. |
| Attribution | utm_link, website_url, campaign_name | UTM-to-deal attribution pipeline connecting video views to revenue. |
| Content Studio | series_name, series_order, google_doc_url | Series structure and script drafting. google_doc_url is a reference link — no bidirectional sync. |

#### What Carries Over from Creator Console

The original Creator Console taught a full HubSpot app architecture. This rebuild keeps the patterns that matter and drops the external dependencies:

- YouTube OAuth flow — reused for API access to pull metrics and analytics
- Background Sync Engine — reimplemented as a HubSpot serverless scheduled function that polls YouTube API with ETag optimization
- CRM Cards — UI extensions on Video records for status, metrics, and quick actions
- Campaign Attribution — UTM-to-deal pipeline proving video ROI
- App Events — timeline activities when videos are published or metrics change significantly
- Workflow Actions — automation blocks triggered on Video pipeline stage changes

Dropped: Firebase/Firestore backend, Gemini AI integration (replaced by Breeze), Google Docs bidirectional sync (google_doc_url is now a simple link), multi-agent wizard cards. These can be revisited later if needed, but the goal is a clean HubSpot-native object.

#### Integration with the Central Brain

Every Video record associates to a Content record. The Video object holds production-specific data (YouTube metrics, script URL, recording status); the Content object holds editorial metadata (topic_tags, enterpret_theme, target_date, pipeline stage). This avoids duplicating properties and lets each object do what it's good at.

- Video → Content: every video is also a piece of content. The Content record tracks the editorial lifecycle; the Video record tracks production and performance.
- Video → Contact: the developer or guest featured in the video, or the person who requested it.
- When a Video moves to "Public": a workflow fires the content_published custom event, updates the associated Content record to "Published", and triggers the Sync to Linear action if there's a linked issue.
- The Content Command Center app page includes a video-specific view that pulls metrics from the Video object alongside editorial status from the associated Content records, showing views, CTR, and attribution data per video.

### 3.4 Native Object: Projects

HubSpot's built-in Projects object solves two problems at once: it's the grouping layer that ties related Content, Changelog, and Video records into a single effort, and it's the catch-all for work that doesn't fit those buckets. Available on all plans — just needs activation by a Super Admin in the Data Model settings.

> **WHY NATIVE PROJECTS, NOT A CUSTOM OBJECT:** The Projects object ships with pipelines, Gantt chart view, board view, color-coded tags, notifications, workflow support, custom reporting (including cumulative time-in-stage), and a full CRUD API. Building this as a custom object would burn one of your custom object slots and require you to rebuild every one of those features. Using the native object gives you all of this for free.

#### Key Properties

| Property | Type | Usage |
|----------|------|-------|
| hs_name | Text | Project name (e.g., "Q4 API v3 Launch", "DevRelCon 2026 Talk") |
| hs_description | Text | Brief scope description |
| hs_type | Enumeration | Extend the default values. Add: content_production, developer_relations, internal, speaking, review, community. This is how non-content work gets categorized. |
| hs_status | Enumeration | On Track, Delayed, On-Hold — built-in status tracking |
| hs_target_due_date | Date | Project deadline. Powers the Gantt view. |
| hs_pipeline + hs_pipeline_stage | Pipeline | Configure pipelines per project type (e.g., a Content Launch pipeline vs. a Speaking Engagement pipeline) |
| asana_project_id | Text (custom) | Asana project GID for sync. Links this HubSpot Project to its Asana counterpart. |
| asana_project_url | URL (custom) | Direct link to the Asana project board. |

#### Associations

- Project → Content (many): a launch project groups all its blog posts, tutorials, docs
- Project → Video (many): videos produced as part of this project
- Project → Changelog (many): changelog entries related to this effort
- Project → Contact: the owner, collaborators, or external stakeholders
- Project → Task: one-off to-dos and subtasks within the project
- Project → Deal: if the project drives revenue (e.g., a partner co-marketing effort)

#### Solving the Edge Cases

Not everything you're assigned is content. The Projects object handles the rest:

- Code review request → Project (type: review), associated to the Contact who requested it
- Speaking engagement → Project (type: speaking) with its own pipeline (Accepted → Prep → Slides Done → Delivered → Follow-up), associated to the event Contact and any resulting Content
- Internal tooling task → Project (type: internal), associated to the relevant team Contact
- Partner demo → Project (type: developer_relations), associated to the Company and Contact
- Sprint or initiative → Project (type: content_production) grouping all the Content/Video/Changelog records for that sprint

Every piece of work you're assigned gets a HubSpot presence. Content-producing work gets both a Project parent and the specific Content/Video/Changelog records. Non-content work lives in Projects alone.

#### Asana Project Mapping

Each Asana project maps to a HubSpot Project record via asana_project_id. When a new Asana project is created in the content factory, a webhook fires and creates the corresponding HubSpot Project. Tasks within that Asana project map to either Content/Changelog/Video records (if they produce content) or to HubSpot Tasks associated to the Project (if they're operational). The sync-to-asana workflow action updates the Asana project status when the HubSpot Project pipeline stage changes.

### 3.5 Other Native Objects to Leverage

Don't reinvent what HubSpot already provides:

- Contacts — developers you interact with, community members, collaborators, speakers
- Companies — partner companies, customer companies whose use cases inspire content
- Tasks — one-off to-dos, subtasks within Projects, or quick action items from meetings
- Notes — quick context attached to contacts or content records
- Meetings — if you connect your calendar, these auto-create and can be associated to contacts

---

## 4. The Sync Layer: HubSpot Serverless Functions

The sync layer lives entirely inside a HubSpot Projects app (platformVersion 2026.03). Public endpoint functions receive webhooks from Linear, Asana, and Fellow. App functions handle internal logic. Custom workflow actions provide reusable automation blocks. No external hosting needed.

### 4.1 Architecture

> **PLATFORM NOTE:** As of 2026.03, serverless functions are fully supported in Projects. They use the Node.js 18+ runtime, deploy with hs project upload, and run on HubSpot's infrastructure. Public endpoints are exposed for webhook receivers. Enterprise subscription required for production; developer test accounts work for development.

The sync layer has three tiers, each addressing a different kind of integration:

#### Tier 1: Public Endpoint Functions (Webhook Receivers)

These are publicly accessible HTTPS endpoints that receive webhook payloads from external systems. Defined in the Projects framework under /src/app/functions/.

| Function | Trigger | Action |
|----------|---------|--------|
| linear-webhook.ts | Linear webhook (issue.created, issue.updated, issue.removed) | Validates HMAC-SHA256 signature. Upserts Content or Changelog Entry in HubSpot via CRM API. Stores linear_issue_id for bidirectional linking. |
| asana-webhook.ts | Asana webhook (task changed, completed, created) | Handles X-Hook-Secret handshake. Receives Asana state changes to keep HubSpot in sync. Stores asana_task_id for linking. Primary sync direction is HubSpot → Asana (Asana is the content factory). |
| fellow-sync.ts | Scheduled (cron-style) or Fellow webhook | Polls Fellow API for recent meetings. Extracts action items and transcript summary. Creates HubSpot tasks associated to contacts. Logs a custom behavioral event for the meeting. |

#### Tier 2: Custom Workflow Actions

Reusable automation blocks that appear in HubSpot's workflow editor. When a Content or Changelog record changes pipeline stage, workflows can trigger these actions without custom code.

| Action | Trigger Context | What It Does |
|--------|----------------|--------------|
| Sync to Linear | Content or Changelog pipeline stage change | Pushes status update to the linked Linear issue via GraphQL API. Maps HubSpot pipeline stages to Linear states. |
| Sync to Asana | Content pipeline stage change | Updates the linked Asana task status via REST API. Asana is the content factory — this keeps the production team's view current as HubSpot pipeline stages change. |
| Notify via Slack | Any pipeline stage change | Posts a formatted update to a Slack channel with record title, new stage, and a direct link to the HubSpot record. |
| Log Content Event | Content moves to Published | Fires a custom behavioral event (content_published) with metadata — useful for tracking your output cadence. |

> **ASANA: THE CONTENT FACTORY:** Asana is where content production workflow lives operationally — the team's day-to-day task board. The primary sync direction is HubSpot → Asana: when a Content record moves through the HubSpot pipeline, the corresponding Asana task state updates automatically. Asana → HubSpot sync also exists (via webhook) but is secondary — it keeps HubSpot aware of changes made directly in Asana. The exact Asana project schema and workflow stages are pending review and will be mapped to HubSpot Content pipeline stages in the sync config.

#### Tier 3: Pipeline Automation (No-Code)

HubSpot supports native automation on custom object pipelines. For simple triggers, no serverless code is needed at all — configure directly in Settings > Objects > Custom Objects > Pipelines > Automate.

- When a Changelog Entry enters "Published": auto-set publish_date to today, send internal notification, trigger the Sync to Linear workflow action
- When a Content record enters "Drafting": create a follow-up task with a target date based on the target_date property
- When a Content record enters "Published": auto-set actual_date, fire the content_published custom event

### 4.2 Project Structure

A single HubSpot Projects app containing everything:

- /src/app/functions/linear-webhook.ts — public endpoint, receives Linear webhooks
- /src/app/functions/asana-webhook.ts — public endpoint, receives Asana webhooks
- /src/app/functions/fellow-sync.ts — public endpoint or scheduled, polls Fellow
- /src/app/functions/sync-to-linear.ts — app function, called by workflow action
- /src/app/functions/sync-to-asana.ts — app function, called by workflow action
- /src/app/functions/youtube-sync.ts — scheduled function, polls YouTube API with ETag optimization, updates Video object metrics and analytics
- /src/app/workflow-actions/ — custom workflow action definitions (*-hsmeta.json)
- /src/app/webhooks/ — HubSpot webhook subscription configs (*-hsmeta.json)
- /src/app/extensions/ — UI extension cards and app pages (React + TypeScript)
- /src/app/lib/linear-client.ts — Linear GraphQL client
- /src/app/lib/asana-client.ts — Asana REST client
- /src/app/lib/fellow-client.ts — Fellow REST client
- /src/app/lib/mapping.ts — property mapping config between systems

### 4.3 Webhook Security

- Linear: HMAC-SHA256 signature verification on every inbound request
- Asana: handle the initial handshake (X-Hook-Secret header), then HMAC verification on subsequent payloads
- HubSpot internal webhooks: validated automatically by the Projects framework
- All external API keys and secrets stored in HubSpot app secrets, accessed via environment in serverless functions
- YouTube OAuth tokens: store refresh token in HubSpot app secrets. The youtube-sync.ts function uses it to obtain short-lived access tokens for API polling. No user-facing OAuth flow needed after initial setup.

### 4.4 Idempotency and Conflict Handling

Each system stores the other system's ID in a dedicated property (e.g., linear_issue_id on the HubSpot Content object, and a HubSpot record ID in Linear issue description or metadata). Before creating a new record, always search for an existing match. When in doubt, the system that owns the property wins — this is defined per-field in the mapping config.

To prevent echo loops (HubSpot updates Linear, which fires a webhook back to HubSpot): tag outbound updates with a source identifier and skip processing inbound webhooks that originated from your own sync.

---

## 5. HubSpot-Native Features to Leverage

Beyond custom objects and serverless functions, HubSpot's platform has several features that directly serve this system. Using them deepens your platform knowledge and reduces custom code.

### 5.1 Custom Behavioral Events

Custom events (now available to all Pro customers) let you track any behavioral data tied to contacts. For a developer advocate, this is powerful:

- **content_published** — fired when a Content record reaches Published. Properties: content_type, topic_tags, title. Over time, builds a picture of your output cadence and focus areas.
- **changelog_published** — fired when a Changelog Entry is published. Properties: product_area, change_type, developer_impact. Tracks your changelog coverage across product areas.
- **developer_engaged** — fired when a contact interacts with your content (click, view, response). Properties: content_id, engagement_type. Ties content performance back to individual developers.

Events can be sent via the HTTP API from serverless functions, or triggered by custom coded workflow actions. They feed into HubSpot's reporting and can trigger workflows themselves.

### 5.2 Custom Workflow Actions (Reusable Blocks)

Beyond the sync-specific actions in Section 4, custom workflow actions can be packaged as reusable blocks that appear in the workflow editor for anyone in your org. Define them in /src/app/workflow-actions/ with an *-hsmeta.json config. Examples:

- "Create Content Brief" — given a topic and content_type, creates a Content object with pre-filled properties and a linked Obsidian template path
- "Escalate to Linear" — takes any HubSpot record context and creates a Linear issue with the right labels and a backlink
- "Weekly Content Digest" — aggregates pipeline changes from the past week and formats a Slack message

### 5.3 Breeze Agent Tools

HubSpot now supports building custom tools that Breeze agents can use. This means you can teach HubSpot's AI assistant to interact with your custom objects and sync layer. HubSpot also supports the Model Context Protocol (MCP), allowing Breeze to connect to external data sources.

- **Content Pipeline Query** — a Breeze tool that lets you ask "what content is in review?" or "show me all changelogs for Developer Platform this month" and get answers from your custom objects.
- **Meeting Action Router** — a Breeze tool that takes a Fellow meeting summary and suggests which items should become Content ideas, Changelog entries, or Linear tasks.
- **Enterpret Friction Finder** — a Breeze tool that queries Enterpret's Knowledge Graph for top friction themes in a given product area and time range. Ask Breeze "what are developers struggling with in the CRM API?" and get a ranked list with quote counts and sample feedback.
- **MCP Connector** — build an MCP server that exposes your Obsidian vault to Breeze, so it can reference your notes when drafting content or answering questions about your work.

### 5.4 App Pages

App Pages (GA as of April 2026) are full-page experiences inside HubSpot built with the same UI Extensions SDK. They support multi-page navigation via PageRoutes, PageLink, and PageHeader. This is where your dashboards and management views live — not crammed into sidebar cards.

- **Content Command Center** — a multi-page app with views for: pipeline board (kanban by stage), calendar view (content by target_date), and analytics (time-in-stage, throughput by content_type).
- **Changelog Manager** — a dedicated page for managing changelog entries with inline editing, Linear issue previews, and bulk status updates.

### 5.5 Breeze Assistant for Custom Code

Breeze Assistant can now generate custom coded workflow actions from natural language descriptions. Useful for rapid prototyping — describe what you want a workflow action to do, and Breeze generates the JavaScript including input definitions, logic, and data outputs. Great for iterating quickly on simple sync logic before packaging it as a formal custom workflow action in your Projects app.

### 5.6 Rollup Properties

Rollup properties aggregate data from associated records — count, sum, average, min, or max. They compute automatically whenever associated records change. For the Central Brain, rollups turn HubSpot into a live reporting surface without custom code:

- **Project → Content count** — how many Content records are associated. Instant project scope visibility.
- **Project → average time-in-stage** — average days Content records spend in each pipeline stage. Surfaces bottlenecks.
- **Contact → Content count** — how many content pieces a developer has inspired. Identifies your most prolific sources.
- **Content → Video view_count sum** — total video views across all associated Video records. Shows content reach.
- **Project → Changelog count** — how many changelog entries a launch produced. Measures scope.

Rollup properties can be used in workflow enrollment criteria, reports, and lists — making derived data first-class citizens in the CRM.

### 5.7 Calculation Properties

Calculation properties compute values from other properties on the same record. Two key types:

- **Time-between calculations** — automatically compute the duration between two date properties. For Content: time between created date and actual_date gives "idea-to-publish" velocity. For Changelog: time between release_date and publish_date measures documentation lag.
- **Custom formulas** — combine property values with arithmetic, string, or conditional logic. Example: a "content health score" that weights enterpret_quote_count, social_engagement_score, and time-in-stage to prioritize which content to finish first.

Stage calculated properties (opt-in since May 2026) track cumulative time in each pipeline stage for custom objects. Enable this on Content and Changelog pipelines to get automatic time-in-stage metrics without custom code.

### 5.8 Smart Properties (AI-Populated)

Smart properties use HubSpot's data agent to populate field values from data sources. The AI reads available context and fills properties automatically. Potential uses:

- Auto-categorize a Content record's topic_tags based on its title and notes — reduces manual tagging
- Auto-extract a summary from a Changelog Entry's notes for the social_post_draft field
- Auto-suggest enterpret_theme matches by analyzing the Content record's title against known friction themes

Smart properties reduce the manual data entry that kills CRM adoption. They require configuration per property and work best with structured text inputs.

### 5.9 Pipeline Rules

Pipeline rules enforce data quality as records move through stages. Configure them in Settings > Objects > Pipelines:

- **Required fields at transitions** — moving Content from "Drafting" to "Editing" requires source_url to be set. Moving to "Published" requires published_url and actual_date. This prevents incomplete records from advancing.
- **Stage order enforcement** — optionally enforce sequential stage progression. Prevents skipping from "Idea" directly to "Published" — every piece goes through the workflow.
- **Conditional rules** — require different fields based on content_type. A video requires a Video association before moving to "Published"; a blog post requires published_url.

Pipeline rules make the system self-enforcing. You can't cut corners even when you're in a rush.

### 5.10 Knowledge Vaults

Knowledge vaults are structured data stores that Breeze agents can reference when answering questions. Up to 50 vaults per account, supporting xlsx, csv, json, and xml uploads. For the Central Brain:

- **Content Playbook vault** — upload your content templates, style guide, and topic taxonomy. Breeze agents reference this when drafting content briefs or suggesting edits.
- **API Reference vault** — upload HubSpot API endpoint summaries and common patterns. Your Breeze tools can reference this when answering developer questions.
- **Enterpret Themes vault** — periodically export top friction themes and upload. Breeze agents can cross-reference this when suggesting content ideas.

Vaults complement Breeze Agent Tools — the tools define what Breeze can do, the vaults define what it knows.

### 5.11 Breeze Studio (Agent Builder)

Breeze Studio is the no-code interface for building custom Breeze agents. Each agent gets a name, persona, instructions, and a set of tools (including your custom Agent Tools from Section 5.3). Build specialized agents:

- **Content Planning Agent** — knows your Content Playbook vault, has the Content Pipeline Query tool and Enterpret Friction Finder tool. Helps plan what to create next.
- **Publishing Assistant Agent** — has the Find and Associate Related Content tool, knowledge of your social post patterns, and the social draft generator. Helps finalize content for publishing.
- **Developer Feedback Agent** — has the Enterpret tools and access to your Themes vault. Answers questions like "what are developers saying about X?" grounded in real data.

Agents built in Breeze Studio are available to anyone in your portal, making your custom intelligence accessible to teammates without them needing to understand the underlying tools.

### 5.12 HubSpot MCP Client

HubSpot's MCP (Model Context Protocol) client enables Breeze agents to connect to external MCP servers without custom code. This is separate from building your own MCP server — it means Breeze can natively talk to systems that expose an MCP interface:

- Connect Breeze to an Asana MCP server — Breeze agents can query and update Asana tasks directly, complementing your serverless sync layer
- Connect Breeze to your Obsidian MCP server — Breeze agents can read your notes when drafting or answering questions
- As more tools expose MCP interfaces (Descript, Adobe, etc.), Breeze gains new capabilities without custom development

The MCP client means your Breeze agents can orchestrate across systems the same way Cowork does — but from inside HubSpot's UI.

### 5.13 Data Agent Workflow Actions

HubSpot's data agent provides AI-powered workflow actions that process text without custom code. Three actions available:

- **AI Categorize** — classifies text into predefined categories. Use on Content notes to auto-set content_type or topic_tags. Use on Changelog notes to set developer_impact.
- **AI Summarize** — generates a summary from a text field. Use to auto-generate social_post_draft from a Content record's notes when it reaches "Published".
- **AI Extract** — pulls structured data from unstructured text. Use on Fellow meeting notes to extract action items, mentioned contacts, and content ideas.

These actions run inside standard HubSpot workflows — no serverless functions, no API calls, no tokens. They're the fastest path to AI-powered automation in your pipeline.

### 5.14 Agent CLI & Developer MCP Server

Two developer-facing tools that accelerate building on HubSpot:

- **Agent CLI (hs mcp setup)** — connects AI coding agents (Claude Code, Cursor, Windsurf, etc.) to your HubSpot account. When building your Projects app, this gives your AI assistant live access to your CRM schema, object definitions, and API docs. Dramatically faster development.
- **Developer MCP Server** — a local MCP server that exposes HubSpot developer tools to your AI editor. Enables queries like "show me the Content object schema" or "what properties does Video have" from your coding environment. The server runs locally and connects to your dev portal.

Both tools serve the build process itself — they make it faster to develop the Central Brain system, and they're features of the platform you should advocate for.

### 5.15 Webhooks Journal API v4

The Webhooks Journal API v4 introduces batched reads and CRM object filtering for webhook event history. Instead of polling individual events, you can:

- Query the journal for all webhook events related to Content objects in a time range — useful for debugging sync issues
- Filter by event type (object.created, object.updated, object.deleted) to audit what your sync layer processed
- Use batched reads for efficient monitoring — one API call returns pages of events instead of individual lookups

Build a simple monitoring page in your Content Command Center app that shows recent webhook activity, sync successes/failures, and any events that need manual review.

### 5.16 Dashboards & Goal Tracking

HubSpot's native reporting and dashboards work with custom objects. Build dashboards that serve as your operational cockpit:

- **Content Velocity Dashboard** — charts content throughput by week/month, average time-in-stage per content_type, and pipeline stage distribution. Uses custom event data and stage calculated properties.
- **Changelog Coverage Dashboard** — reports on changelog entries by product_area, developer_impact, and time-to-publish. Identifies which product areas are under-documented.
- **Social Performance Dashboard** — aggregates social_engagement_score by topic_tags and content_type. Shows which topics and formats drive the most social engagement.
- **Enterpret Coverage Report** — cross-references enterpret_theme values across Content records to show which friction themes have corresponding content and which are unaddressed.

Goal tracking lets you set and monitor targets — e.g., "publish 4 changelogs per week" or "create content for the top 3 Enterpret themes each quarter." Goals can be tied to dashboards and trigger notifications when you're falling behind.

---

## 6. Obsidian + Cowork Layer

Obsidian is your thinking and drafting layer. It's a local folder of markdown files, which makes it trivially accessible to Cowork. This layer doesn't require any API integration — just a connected folder.

### 6.1 Vault Structure (Suggested)

- / — vault root
- /daily/ — daily notes, journal entries, quick captures
- /meetings/ — meeting notes (auto-generated from Fellow via Cowork)
- /content/ — drafts and outlines for content pieces tracked in HubSpot
- /changelogs/ — changelog draft files
- /references/ — research, links, saved resources
- /templates/ — reusable templates for meetings, content briefs, changelogs

### 6.2 Cowork Workflows

With your Obsidian vault connected as a folder in Cowork, you can ask Cowork to:

- Turn rough meeting notes into a structured HubSpot content record with properties pre-filled
- Pull your content pipeline from HubSpot and generate a status summary in a daily note
- Draft a changelog entry from a Linear issue description, save it to Obsidian, and create the HubSpot Changelog object simultaneously
- Query "what content ideas came from meetings this week?" by cross-referencing Fellow data with HubSpot contacts
- Review your Obsidian daily notes and surface anything that should become a HubSpot record
- Query Enterpret: "what are the top developer friction points this month?" → get themes with quote counts → create Content ideas in HubSpot pre-tagged with the Enterpret theme
- Before writing a blog post, ask Cowork to pull relevant developer quotes from Enterpret to ground the content in real feedback
- Weekly content planning: cross-reference your HubSpot content pipeline with Enterpret's top themes to spot coverage gaps
- Slack as content input: scan specific Slack channels (e.g., #developer-questions, #product-feedback) for recurring themes or questions — surface them as Content ideas in HubSpot with the Slack message linked
- Daily pipeline summary to Slack: post a morning digest of pipeline state (what's in review, what's overdue, what shipped yesterday) to a personal channel or DM

> **COWORK AS DAY-ONE BRIDGE:** Cowork already has connectors for Linear, Asana, Slack, Fellow, Enterpret, and Google Calendar — plus file read/write for Obsidian. The Enterpret connector gives you direct access to the Knowledge Graph: run queries, search fields, find user quotes. Use it as an ad-hoc orchestrator from day one. As your HubSpot automation matures, Cowork shifts from "the glue" to "the power user interface."

---

## 7. HubSpot UI Extensions

UI extensions make HubSpot the surface where you actually work, not just where data lives. Build with the Projects framework (React + TypeScript). Use the useCrmSearch hook (May 2026) for querying CRM data directly from cards. Share code between extensions to avoid duplication.

### 7.1 Record Cards

#### Linear/Asana Status Card

Displays on Content and Changelog records. Shows the linked Linear/Asana issue status, assignee, and recent activity inline — no tab switching. Calls your sync-to-linear serverless function via hubspot.fetch() for live data. Uses useCrmSearch for related record lookups.

#### Meeting Intelligence Card

Displays on Contact records. Shows recent meetings (from Fellow sync), key action items, and associated content that resulted from conversations with this person. Makes the "this blog post was inspired by this developer" connection visible.

#### Enterpret Insights Card

Displays on Content records that have an enterpret_theme set. Shows the related friction theme from Enterpret, top developer quotes, quote volume trend, and a direct link to the theme in Enterpret's dashboard. When you're editing a content piece, you can see the real developer pain behind it without leaving HubSpot.

#### Related Content Card

Displays on Content and Video records. Surfaces other records that share topic_tags or the same enterpret_theme, plus existing associations. One-click button to create a formal association. Full design in Section 8.

### 7.2 App Pages

#### Content Command Center

A multi-page app using PageRoutes. Page 1: pipeline board showing all Content objects by stage (kanban-style). Page 2: calendar view by target_date. Page 3: analytics — time-in-stage distributions, throughput by content_type, publishing cadence. Page 4: video dashboard — pulls YouTube metrics from the Video custom objects alongside editorial status from the associated Content records, showing views, CTR, and attribution data per video. This is your daily driver inside HubSpot.

#### Changelog Manager

A focused app page for changelog workflow. Shows all Changelog Entries with inline Linear issue previews (fetched via serverless function), bulk status updates, and a quick-create form. Filtered views by product_area and developer_impact.

---

## 8. Cross-Content Discovery

When you create a new piece of content, you should always know what related content already exists — videos, blog posts, changelogs, anything. This mechanism ensures nothing is published in isolation when there's an opportunity to cross-link and amplify.

### 8.1 How It Works

Every Content and Changelog record carries topic_tags (multi-select) and enterpret_theme (text). These two properties are the matching keys. Video records inherit discoverability through their required Content association — the Related Content Card traverses the link to read the Content record's topic_tags and enterpret_theme. When you create or edit a record, the system queries for others that share at least one topic_tag or the same enterpret_theme, then surfaces them.

- **Content ↔ Content associations** — HubSpot supports same-object associations. When you link a blog post to a related changelog or tutorial, both records show the connection on their record pages. Build these associations manually at first, then automate via a workflow action.
- **Content ↔ Video associations** — the same mechanism links Content records to Video records. If you're writing a blog post about custom objects and you have a video covering that topic, the association makes it visible.
- **Enterpret theme matching** — content records that share the same enterpret_theme are related by definition — they address the same developer friction point. This is a powerful discovery axis that no other system gives you.

### 8.2 Related Content Card (UI Extension)

A dedicated CRM card on Content and Video record pages. This card uses useCrmSearch to find related records and displays them inline.

- Queries Content objects where any value in topic_tags overlaps with the current record's topic_tags
- Queries Content and Video objects where enterpret_theme matches the current record
- Queries existing Content ↔ Content and Content ↔ Video associations
- Displays results grouped: "Same Topic" and "Same Friction Theme" — with title, content_type, status, and a direct link
- One-click "Associate" button to create a formal HubSpot association between two records

This card should display on both Content and Video records. On a Video record, it surfaces blog posts, changelogs, and other content about the same topic — making it trivial to add a link in the video description or show notes.

### 8.3 Before-You-Publish Checklist

A Cowork workflow (or a custom workflow action) that runs before content is finalized. When a Content record moves to the "Review" pipeline stage:

- Query for related content using topic_tags and enterpret_theme
- Check if any related Videos exist that could be embedded or linked
- Check if there are related changelog entries that should be referenced
- Generate a brief in Obsidian (or Slack notification) listing all related content with links
- Suggest cross-links: "You're publishing a blog about X. Consider linking to: [Video: Building X], [Changelog: X API update]"

This can start as a Cowork scheduled workflow or ad-hoc command, then graduate to a custom workflow action that fires automatically on pipeline stage change.

### 8.4 Auto-Association Workflow Action

A custom workflow action in your Projects app: "Find and Associate Related Content." When triggered (manually or on pipeline stage change), it:

- Reads the current record's topic_tags and enterpret_theme
- Uses the CRM Search API to find matching records across Content and Video objects
- Creates associations for any matches above a relevance threshold (e.g., 2+ shared topic_tags)
- Logs the associations created as an activity on the record timeline

This means your content graph grows automatically as you publish. Over time, HubSpot becomes a knowledge graph of your content library — every piece connected to what it relates to.

### 8.5 Content Repurposing Workflow

The cross-content discovery mechanism also powers systematic repurposing. When a piece of content performs well (high social_engagement_score, high Video view_count, or strong Enterpret quote coverage), the system should surface it as a repurposing candidate:

- **Blog → Video script** — a Cowork workflow takes a published blog post's Content record, pulls the Obsidian draft, and generates a video script outline. Creates a new Video record associated to the original Content record via Content ↔ Content.
- **Talk → Blog post** — after a speaking engagement (Project type: speaking), Cowork generates a blog post outline from the talk notes and any Fellow transcript. Creates a new Content record associated to the Project.
- **Changelog → Social thread** — for high-impact changelogs (developer_impact: breaking or action_required), generate a multi-post social thread explaining the change. The social_post_draft field holds the thread content.
- **Video → Blog recap** — when a Video record has strong view_count, suggest a companion blog post covering the same material for readers who prefer text. The Content ↔ Video association makes the connection.

Content ↔ Content associations track the repurposing lineage — you can always see what a piece was derived from and what it spawned. Over time, this reveals which topics have the deepest content coverage and which formats perform best per topic.

---

## 9. Social Media Strategy

Publishing content is only half the job. Distribution through social channels — and tracking that distribution back to HubSpot contacts — closes the loop. HubSpot's Social tools handle LinkedIn publishing natively, and the CRM ties social engagement back to individual contacts.

### 9.1 Channels

Start with LinkedIn and YouTube. LinkedIn is where your developer audience engages professionally and where HubSpot's Social tools work natively. YouTube is covered by the Video custom object pipeline. Additional channels (Twitter/X, Dev.to, Hashnode) can be added later using the same pattern.

### 9.2 Publishing Workflow

When a Content record reaches "Published" in the HubSpot pipeline, the social distribution workflow kicks in:

- **Step 1: Draft generation** — a custom workflow action (or Cowork workflow) generates a LinkedIn post draft based on the content's title, topic_tags, and a summary. For blog posts, it pulls the intro paragraph. For changelogs, it formats the key change and developer impact. For videos, it generates a teaser with the YouTube URL.
- **Step 2: HubSpot Social queue** — the draft is pushed to HubSpot's Social Inbox via the Social Media Publishing API. It sits as a draft awaiting your review and scheduling. You can edit the copy, pick a publish time, and approve — all inside HubSpot.
- **Step 3: Publish and track** — HubSpot publishes to LinkedIn on schedule. Engagement data (likes, comments, shares, clicks) flows back into HubSpot automatically.

### 9.3 Content Object Properties for Social

Add these properties to the Content custom object to track social distribution:

- **social_post_draft (textarea)** — the generated social post copy. Editable before publishing.
- **social_published_at (datetime)** — when the social post went live.
- **social_post_url (text)** — the URL of the published LinkedIn post. Clickable link from the HubSpot record.
- **social_engagement_score (number)** — aggregate engagement metric (likes + comments + shares). Updated periodically via sync.

### 9.4 Contact Attribution from Social

This is where HubSpot's CRM shines for social. When someone engages with your LinkedIn post and later visits your content:

- HubSpot's Contact Create Attribution report traces which social posts drove new contact creation
- Deal Create Attribution shows which social posts contributed to pipeline (useful for proving DevRel ROI)
- The developer_engaged custom behavioral event fires when a known contact clicks through from a social post, tying the engagement to the specific Content record
- Over time, you can answer: "Which topics drive the most social engagement?" and "Which social posts generated contacts that became customers?"

### 9.5 YouTube Integration via Video Object

YouTube distribution is handled by the Video custom object pipeline. The social layer adds a cross-promotion mechanism:

- When a Video record reaches "Public" status, the workflow generates a LinkedIn post promoting the video with the YouTube URL
- The Video record's utm_link property is used in the social post to ensure attribution tracking
- YouTube metrics (views, likes, CTR) are synced to the Video object — the social layer adds LinkedIn engagement data for the promotional post

This creates a complete picture: video performance on YouTube plus social amplification performance on LinkedIn, both visible from the same HubSpot record.

> **MARKETING HUB REQUIREMENT:** HubSpot Social tools require Marketing Hub Professional or Enterprise. The Social Media Publishing API is available at the Professional tier. Contact attribution reports require Marketing Hub Enterprise. If you're on a lower tier, the social draft generation and Content properties still work — you'd just publish manually to LinkedIn and lose the native attribution reporting.

---

## 10. Creative Production Layer

Content creation requires specialized tools — video editors, design platforms, prototyping tools. Rather than replacing them, the Central Brain connects to them via MCP (Model Context Protocol) where available, and tracks their outputs as properties on HubSpot records. The creative tools are spokes; HubSpot remains the brain.

### 10.1 Descript (Video & Audio Editing)

Descript is the primary video and audio editing tool. It handles recording, transcription, editing (text-based), and publishing. A Descript MCP server exists that exposes the Descript API:

- **Import automation** — trigger video imports into Descript from a HubSpot workflow when a Video record enters "Drafting" stage. The MCP server's import endpoint accepts a media URL.
- **Underlord edits** — Descript's AI editing features (Studio Sound, filler word removal, gap removal) can be triggered via the API. A Cowork workflow can fire these post-import.
- **Status monitoring** — poll Descript job status from a serverless function or Cowork workflow. When processing completes, update the Video record's status in HubSpot.
- **Publishing** — retrieve published project details (rendered URLs, transcripts) and write them back to the Video record.

Integration pattern: Video record in HubSpot → Descript MCP for editing → status/output synced back to HubSpot. The Video object's google_doc_url field can double as a Descript project link.

### 10.2 Canva (Visual Design)

Canva handles thumbnails, social graphics, presentation visuals, and branded assets. Already connected in your environment via MCP. Available tools:

- **generate-design** — create new designs from a text prompt. Use for quick thumbnail generation when a Video or Content record needs a visual.
- **search-designs / search-brand-templates** — find existing designs and brand templates. Keeps your visual assets discoverable.
- **edit-design** — modify existing designs programmatically. Update text overlays, swap images, adjust layouts.
- **export-design** — export designs as PNG/PDF/etc. Retrieve the export URL and store it on the Content or Video record's thumbnail_url.
- **autofill-design** — populate a brand template with data. Use for batch-generating social graphics from Content record properties (title, topic_tags, publish date).

Integration pattern: when Content reaches "Review" stage, a Cowork workflow generates a social graphic via Canva autofill using the Content record's properties, exports it, and stores the URL on the record.

### 10.3 Figma (UI/UX Design)

Figma handles UI mockups, diagrams, and design system assets. Already connected via MCP. Key capabilities:

- **get_design_context / get_screenshot** — pull design context and screenshots from Figma files. Useful when a Content record documents a UI feature — embed the actual design in the content brief.
- **generate_diagram** — create diagrams from descriptions. Use for architecture diagrams in blog posts or documentation.
- **get_metadata** — retrieve file metadata, component information, and design tokens.

Integration pattern: primarily pulled into the content creation workflow. When drafting a blog post about a HubSpot feature, Cowork can pull relevant Figma screenshots and embed them in the Obsidian draft. The Figma MCP is a research tool more than an automation target.

### 10.4 Adobe Creative Suite

Adobe's MCP connector ("Adobe for Creativity", launched April 2026) exposes 50+ tools across Photoshop, Lightroom, Firefly, Express, and Premiere. Key capabilities for the Central Brain:

- **Photoshop** — image manipulation, compositing, and retouching. Use for hero images, featured graphics, and complex visual assets that exceed Canva's capabilities.
- **Lightroom** — photo editing and color grading. Use for headshots, event photography, and product screenshots that need professional treatment.
- **Firefly** — AI image generation. Generate custom illustrations, backgrounds, and visual concepts for content. Can be prompted with the Content record's topic for contextual generation.
- **Express** — quick design and social media templates. Overlaps with Canva for simpler tasks — use whichever has the better template for the job.
- **Premiere** — video editing for complex projects that exceed Descript's capabilities. Multi-camera edits, advanced effects, and professional post-production.

The Adobe MCP connector is not yet in your connected MCP registry. Adding it gives you 50+ tools accessible from Cowork, and eventually from Breeze via the HubSpot MCP Client.

### 10.5 MCP Integration Pattern

All four creative tools follow the same integration pattern with the Central Brain:

- HubSpot is the trigger: pipeline stage changes or workflow actions initiate creative work
- MCP is the bridge: Cowork (and eventually Breeze via the HubSpot MCP Client) calls creative tool APIs through their MCP interfaces
- HubSpot is the record: outputs (URLs, asset IDs, export links) are written back to the originating Content, Video, or Changelog record
- No direct HubSpot ↔ creative tool sync needed — Cowork and Breeze orchestrate the interaction

| Tool | MCP Status | Primary Use | HubSpot Integration |
|------|-----------|-------------|---------------------|
| Descript | External MCP server (install needed) | Video/audio editing, transcription | Video object status sync, transcript retrieval |
| Canva | Connected (live) | Thumbnails, social graphics, branded assets | Auto-generate graphics on pipeline stage change |
| Figma | Connected (live) | UI mockups, diagrams, design context | Pull screenshots into content briefs |
| Adobe | Available (not connected) | Advanced image/video editing, AI generation | Professional assets for high-production content |

> **CREATIVE TOOLS ARE SPOKES, NOT HUBS:** The creative tools don't need deep bidirectional sync with HubSpot. They need to be triggerable from your workflow and to report back their outputs. Cowork is the orchestration layer — it talks to each tool's MCP, runs the operation, and updates HubSpot. As Breeze gains MCP client capabilities, some of this shifts into HubSpot-native automation.

---

## 11. Phased Build Plan

Designed to deliver value at each phase. Each phase has a concrete milestone that changes your daily workflow and teaches a different surface of the HubSpot developer platform.

### Phase 1: Foundation (Weeks 1–2)

Get the data model into HubSpot and start using it manually. Connect Obsidian to Cowork. No code yet — just the objects, pipelines, and associations.

**Platform skills practiced:** Custom objects, properties, pipelines, associations, pipeline rules, rollup properties, calculation properties, stage calculated properties, Agent CLI, CRM API basics.

| Task | Tool | Outcome |
|------|------|---------|
| Create Content custom object with all properties and pipeline | HubSpot (UI or API) | Content lifecycle is trackable in HubSpot |
| Create Changelog Entry custom object with properties and pipeline | HubSpot (UI or API) | Changelog workflow lives in HubSpot |
| Set up associations (Content ↔ Contact, Content ↔ Content, Changelog ↔ Contact, Content ↔ Changelog) | HubSpot API | Relational graph is wired up |
| Configure pipeline automation (auto-set dates, create follow-up tasks) | HubSpot Settings | No-code automation from day one |
| Connect Obsidian vault as a folder in Cowork | Cowork | Cowork can read/write your notes |
| Create Obsidian templates for meeting notes, content briefs, changelogs | Obsidian | Consistent structure from day one |
| Create Video custom object with all property groups (Identity, Content, Lifecycle, Metrics, Analytics, Attribution, Content Studio) and pipeline | HubSpot (UI or API) | Video pipeline is live alongside Content and Changelog — no external backend |
| Set up Video → Content and Video → Contact associations | HubSpot API | Videos are linked to the editorial layer |
| Add social distribution properties to Content object (social_post_draft, social_published_at, social_post_url, social_engagement_score) | HubSpot | Content records track their social distribution lifecycle |
| Set up Content ↔ Content same-object associations | HubSpot API | Cross-content discovery is structurally possible |
| Activate the native Projects object, configure hs_type enum (content_production, developer_relations, internal, speaking, review, community), set up pipeline stages | HubSpot Data Model + Settings | Projects groups work and handles non-content assignments |
| Set up Project associations to Content, Video, Changelog, Contact, Task | HubSpot Data Model | Every piece of work can be grouped under a Project |
| Manually create 5–10 Content records for current projects | HubSpot | Immediate value — your pipeline is visible |
| Configure pipeline rules: require source_url before Editing, published_url before Published | HubSpot Settings | Data quality enforced from day one |
| Set up rollup properties: Content count on Projects, Content count on Contacts | HubSpot Properties | Aggregate metrics visible without reports |
| Enable stage calculated properties on Content and Changelog pipelines | HubSpot Settings | Automatic time-in-stage tracking |
| Create calculation property: idea_to_publish_days (time-between created date and actual_date) | HubSpot Properties | Content velocity measurable per record |
| Run hs mcp setup to connect AI coding agent to dev portal | HubSpot Agent CLI | Accelerated development for the entire build |

> **MILESTONE:** You have a working content pipeline in HubSpot with pipeline rules enforcing data quality, rollup properties aggregating data across associations, stage calculated properties tracking time-in-stage automatically, a Video custom object, the native Projects object, and your AI coding agent connected via Agent CLI. Everything you're assigned has a HubSpot presence — all native, no external backends.

### Phase 2: The HubSpot App — Linear Sync (Weeks 3–5)

Scaffold the HubSpot Projects app and build the first sync pair. Linear is the highest-value target because changelog entries almost always link to Linear issues.

**Platform skills practiced:** Projects framework (2026.03), serverless functions, public endpoints, webhook subscriptions, custom workflow actions, HubSpot CLI, app secrets.

| Task | Tool | Outcome |
|------|------|---------|
| Scaffold HubSpot Projects app (platformVersion: 2026.03) | HubSpot CLI (hs project create) | Single app for all sync + UI |
| Build linear-webhook.ts — public endpoint with HMAC-SHA256 verification | Projects serverless | Linear events flow into HubSpot |
| Implement Linear → HubSpot sync for issues tagged with a specific label | Serverless + CRM API | Tagged Linear issues auto-create Changelog objects |
| Build Sync to Linear custom workflow action | Projects workflow actions | Reusable block in the workflow editor |
| Configure HubSpot workflows: on Changelog stage change → trigger Sync to Linear | HubSpot Workflows | Pipeline changes reflect in Linear automatically |
| Build property mapping config in /src/app/lib/mapping.ts | Projects | Clean separation of mapping logic from sync logic |
| Deploy and test with hs project upload in developer test account | HubSpot CLI | End-to-end sync verified |

> **MILESTONE:** When a Linear issue is tagged "changelog", a Changelog Entry appears in HubSpot with the issue linked. When you move it through the HubSpot pipeline, Linear updates. All running on HubSpot's infrastructure.

### Phase 3: Asana (Content Factory) + Fellow + Enterpret (Weeks 6–8)

Extend the app with Asana integration — Asana is the content factory where production workflow lives. Connect Fellow for meeting intelligence. Connect Enterpret as the feedback-to-content pipeline. Build custom behavioral events to start tracking your output.

**Platform skills practiced:** Additional serverless functions, custom behavioral events API, workflow triggers on events, Data Agent workflow actions (AI Categorize, AI Summarize), Knowledge Vaults, Enterpret Knowledge Graph API.

| Task | Tool | Outcome |
|------|------|---------|
| Build asana-webhook.ts with handshake and signature verification | Projects serverless | Asana events flow into HubSpot for awareness |
| Implement HubSpot → Asana state sync (primary direction) | Serverless + Asana API | HubSpot pipeline stage changes push state updates to Asana tasks in the content factory |
| Map HubSpot Content pipeline stages to Asana workflow states (schema/mapping TBD — pending Asana schema review) | Projects mapping config | Stage transitions translate correctly between systems |
| Implement Asana project → HubSpot Project sync (asana_project_id, asana_project_url) | Serverless + Projects API | Each Asana project has a corresponding HubSpot Project record |
| Build fellow-sync.ts — polls Fellow API for recent meetings | Projects serverless | Meeting data enters HubSpot automatically |
| Extract Fellow action items, create HubSpot tasks associated to contacts | Serverless + CRM API | Meeting follow-ups are tracked in HubSpot |
| Build Cowork workflow: Enterpret top themes → HubSpot Content ideas | Cowork + Enterpret | Friction-driven content ideas flow into your pipeline |
| Build Cowork workflow: pull Enterpret quotes for a Content record's topic | Cowork + Enterpret | Real developer feedback grounds every content piece |
| Define custom behavioral events: content_published, changelog_published | Events API | Output tracking begins |
| Wire content_published event into workflow: fire when Content hits Published | Workflows + custom code | Events fire automatically on pipeline changes |
| Build Cowork workflow: Fellow transcript → Obsidian meeting note | Cowork | Meeting notes auto-land in your vault |
| Configure Data Agent workflow actions: AI Categorize on Content notes → auto-set topic_tags | HubSpot Workflows | Content records auto-tagged on creation — less manual data entry |
| Configure AI Summarize action: auto-generate social_post_draft when Content hits Published | HubSpot Workflows | Social drafts generated without custom code |
| Upload Content Playbook to a Knowledge Vault (style guide, topic taxonomy, templates) | HubSpot Knowledge Vaults | Breeze agents have structured reference material |

> **MILESTONE:** After a meeting, action items auto-create in HubSpot and a meeting note appears in Obsidian. Data Agent AI actions auto-tag content and draft social posts. A Knowledge Vault stores your content playbook for Breeze. The Asana content factory stays current as HubSpot pipeline stages change. Enterpret themes feed into your pipeline. Custom events track every piece published.

### Phase 4: UI Extensions (Weeks 9–11)

Build the surfaces that make HubSpot your daily driver. Record cards for context, app pages for management.

**Platform skills practiced:** UI Extensions SDK, React in HubSpot, useCrmSearch hook, hubspot.fetch(), PageRoutes, PageLink, PageHeader, code sharing between extensions.

| Task | Tool | Outcome |
|------|------|---------|
| Build Linear/Asana Status Card for Content and Changelog records | UI Extensions | See task status without leaving HubSpot |
| Build Meeting Intelligence Card for Contact records | UI Extensions | See meeting history and related content per contact |
| Build Enterpret Insights Card for Content records | UI Extensions | See friction theme, developer quotes, and demand signal per content piece |
| Build Content Command Center app page (pipeline board, calendar, analytics) | App Pages + PageRoutes | Full-page content management inside HubSpot |
| Build Changelog Manager app page | App Pages | Focused changelog workflow with Linear previews |
| Build Related Content Card for Content and Video records | UI Extensions | See related content by topic and friction theme, one-click association |
| Build "Find and Associate Related Content" custom workflow action | Projects workflow actions | Content graph grows automatically on pipeline stage change |
| Build social post draft generator workflow action | Projects workflow actions | LinkedIn draft auto-generated when content is published |
| Connect HubSpot Social for LinkedIn publishing | HubSpot Social tools | Social drafts queue in HubSpot Social Inbox for review and scheduling |
| Share common components between extensions (useCrmSearch, fetch wrappers) | Code sharing (2026) | DRY codebase, consistent UX |

> **MILESTONE:** HubSpot is now a genuine command center. You open a Contact and see their meeting history, related content, and linked tasks. The Related Content Card surfaces cross-linking opportunities on every record. When you publish content, a LinkedIn draft auto-queues in HubSpot Social. The Content Command Center is your daily planning surface.

### Phase 5: Breeze + Intelligence + Creative Tools (Weeks 12–16)

Add AI capabilities using Breeze Agent Tools and Breeze Studio. Connect creative production tools via MCP. Build reporting dashboards and goal tracking from your custom events data.

**Platform skills practiced:** Breeze Agent Tools, Breeze Studio, Knowledge Vaults, HubSpot MCP Client, Webhooks Journal v4, goal tracking, creative tool MCP integration, custom reporting, dashboards.

| Task | Tool | Outcome |
|------|------|---------|
| Build Content Pipeline Query Breeze tool | Breeze Agent Tools | Ask Breeze about your pipeline in natural language |
| Build Enterpret Friction Finder Breeze tool | Breeze Agent Tools | Ask Breeze about developer pain points by product area |
| Build Meeting Action Router Breeze tool | Breeze Agent Tools | Breeze suggests where meeting action items should go |
| Build MCP connector for Obsidian vault | MCP Protocol | Breeze can reference your notes when working |
| Create content velocity dashboard from custom events | HubSpot Reports | Visual tracking of output cadence and focus areas |
| Create changelog coverage report by product_area | HubSpot Reports | Identify gaps in changelog coverage |
| Build social engagement dashboard with contact attribution | HubSpot Reports | See which social posts drive contacts and pipeline |
| Build Cowork before-you-publish workflow for cross-content suggestions | Cowork | Never publish without checking for related content to cross-link |
| Build Content Planning Agent in Breeze Studio (Content Playbook vault + Pipeline Query tool + Friction Finder tool) | Breeze Studio | No-code agent that helps plan what to create next |
| Build Publishing Assistant Agent in Breeze Studio (Related Content tool + social draft generator) | Breeze Studio | Agent that helps finalize and cross-link content before publishing |
| Connect Descript MCP to Cowork — build video import + Underlord edit workflow | Cowork + Descript MCP | Video editing automation from HubSpot pipeline triggers |
| Build Canva autofill workflow: Content reaches Review → generate social graphic from brand template | Cowork + Canva MCP | Social graphics auto-generated from content properties |
| Upload Enterpret Themes and API Reference to Knowledge Vaults | HubSpot Knowledge Vaults | Breeze agents grounded in real developer data and API knowledge |
| Configure HubSpot MCP Client: connect Breeze to Asana MCP | HubSpot MCP Client | Breeze agents can query and update Asana without custom code |
| Build webhook monitoring view in Content Command Center (Webhooks Journal v4) | App Pages + Webhooks API | Sync health visible inside HubSpot — debug without leaving the portal |
| Set up goal tracking: 4 changelogs/week, top 3 Enterpret themes/quarter | HubSpot Goals | Targets tracked with notifications when falling behind |

> **MILESTONE:** You can ask Breeze "what changelogs are overdue for Developer Platform?" and get an answer grounded in real data. Custom Breeze agents in Breeze Studio handle content planning and publishing assistance. Descript and Canva are wired into the pipeline via MCP — video editing and graphic generation triggered by pipeline stage changes. Goal tracking monitors your output targets. The system is not just functional — it's intelligent and creative.

### Phase 6: Refinement and Expansion (Ongoing)

With the core system running, iterate based on what you actually use. Some likely extensions:

- Cowork scheduled tasks: daily morning brief that pulls your HubSpot pipeline, today's meetings from Fellow, and open Linear items
- Obsidian → HubSpot: Cowork reads a daily note and auto-creates Content records for any ideas tagged #content-idea
- Video object enhancements: use Breeze Agent Tools to draft video scripts informed by Enterpret friction themes, so every video is grounded in real developer pain points
- Community tracking: use Contacts to track developer advocates at partner companies, associated to joint content
- developer_engaged events: expand to track who's reading your content, then surface engaged developers in the Meeting Intelligence Card
- Enterpret → HubSpot automated sync: scheduled serverless function that queries Enterpret for new high-volume themes weekly and auto-creates Content ideas in the pipeline
- Feedback-content coverage report: dashboard showing which Enterpret friction themes have corresponding Content records and which are unaddressed
- Expand social channels: add Twitter/X, Dev.to, Hashnode using the same workflow action pattern — draft generation per platform, queue in HubSpot Social or post via API
- Social A/B patterns: test different post formats (thread vs single post, with/without image) and track engagement_score per variant to optimize distribution
- Cross-content intelligence: Breeze tool that answers "what content do we have about X?" by querying topic_tags and associations, then suggests gaps
- Connect Adobe MCP ("Adobe for Creativity") — use Firefly for AI-generated illustrations, Photoshop for hero images, Premiere for complex video edits
- Build Figma → content brief workflow: pull design screenshots and component context into Obsidian drafts when documenting UI features
- Smart properties: configure AI auto-population for topic_tags, enterpret_theme suggestions, and content_type classification
- Expand Knowledge Vaults: add vaults for competitor analysis, community FAQ patterns, and product roadmap context
- Connect Breeze MCP Client to additional creative tool MCP servers as they become available
- Build Developer Feedback Agent in Breeze Studio: answers "what are developers saying about X?" grounded in Enterpret data and your Content records

---

## 12. Technical Reference

### 12.1 Subscription Requirements

This strategy touches features across multiple HubSpot tiers. Here's what you need and when:

| Feature | Required Tier | Phase |
|---------|--------------|-------|
| Custom objects (Content, Changelog, Video) | Enterprise | 1 |
| Pipelines on custom objects | Enterprise | 1 |
| Rollup properties | Enterprise | 1 |
| Calculation properties (including stage calculated) | Enterprise | 1 |
| Pipeline rules | Enterprise | 1 |
| Serverless functions (Projects framework) | Enterprise (dev test accounts for development) | 2 |
| Custom behavioral events | Professional (all hubs) | 3 |
| Data Agent workflow actions (AI Categorize, Summarize, Extract) | Enterprise | 3 |
| Knowledge Vaults | Enterprise (with Breeze add-on) | 3 |
| HubSpot Social Publishing API | Marketing Hub Professional | 4 |
| Contact/Deal Create Attribution reports | Marketing Hub Enterprise | 4 |
| Breeze Agent Tools | Enterprise (with Breeze add-on) | 5 |
| Breeze Studio (Agent Builder) | Enterprise (with Breeze add-on) | 5 |
| HubSpot MCP Client | Enterprise (with Breeze add-on) | 5 |
| Goal tracking | Professional (all hubs) | 5 |
| Custom reporting + dashboards on custom objects | Professional | 5 |

Developer test accounts (free via HubSpot developer portal) support most Enterprise features for development and testing. Production deployment requires the listed tiers.

### 12.2 API Versions and Platform Notes

- HubSpot Projects: use platformVersion 2026.03. New versions release March/September, 18-month support window.
- HubSpot API: use 2026-03 date-versioned endpoints (/api-name/2026-03/resource).
- Legacy CRM cards deprecated October 31, 2026 — UI Extensions via Projects only.
- Serverless functions: Node.js 18+ runtime, Enterprise required for production, dev test accounts for development.
- Custom object pipelines: up to 100 stages, stage calculated properties opt-in (June 2026), count toward 4,500-property limit.
- Custom behavioral events: available to all Pro customers. Can be sent via HTTP API or triggered in workflows.
- Breeze Agent Tools: build custom tools for Breeze using the developer platform. MCP connectors also supported.
- App Pages: GA April 2026. Support PageRoutes, PageLink, PageHeader for multi-page navigation.
- Code sharing between UI Extensions: supported in 2026.03 — shared types, utilities, and components.
- Rollup properties: aggregate data from associated records. Available on all object types including custom objects.
- Calculation properties: time-between and custom formulas. Stage calculated properties opt-in since May 2026.
- Smart properties: AI-populated via data agent. Requires data agent configuration per property.
- Pipeline rules: enforce stage order and required fields. Configure in Settings > Objects > Pipelines.
- Knowledge vaults: up to 50 per account. Support xlsx, csv, json, xml. Feed structured data to Breeze agents.
- Breeze Studio: no-code agent builder. Agents combine tools, vaults, and custom instructions.
- HubSpot MCP Client: Breeze connects to external MCP servers natively. Complements the Developer MCP Server.
- Data Agent Workflow Actions: AI Categorize, AI Summarize, AI Extract — no custom code needed.
- Agent CLI (hs mcp setup): connects AI coding agents to HubSpot for accelerated development.
- Webhooks Journal API v4: batched reads with CRM object filtering for webhook event monitoring.

### 12.3 Key URLs

- HubSpot Developer Platform: developers.hubspot.com/developer-platform-basics
- Serverless Functions (Projects): developers.hubspot.com/docs/cms/reference/serverless-functions/serverless-functions-in-projects
- Custom Objects API: developers.hubspot.com/docs/guides/api/crm/objects/custom-objects
- Webhooks API: developers.hubspot.com/docs/api-reference/latest/webhooks/guide
- UI Extensions: developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/overview
- Custom Workflow Actions: developers.hubspot.com/docs/apps/developer-platform/add-features/custom-workflow-actions
- Breeze Agent Tools: developers.hubspot.com/ai-tools-beta
- Custom Events API: developers.hubspot.com/docs/api-reference/legacy/events/send-event-data/guide
- Linear Webhooks: linear.app/developers/webhooks
- Asana Webhooks: developers.asana.com/docs/webhooks-guide
- Fellow API: fellow.ai (API docs via workspace settings)
- Enterpret Knowledge Graph: accessible via Cowork connector (run_graph_query, find_user_quote, search_graph_fields)
- Projects Object: knowledge.hubspot.com/records/understand-and-use-projects-object
- Projects API: developers.hubspot.com/docs/api-reference/latest/crm/objects/projects/guide
- Social Media Publishing API: developers.hubspot.com/docs/api-reference/latest/social-media/guide
- UI Extensions Examples: github.com/hubspotdev/ui-extensions-examples
- Knowledge Vaults: knowledge.hubspot.com/breeze/knowledge-vaults
- Breeze Studio: knowledge.hubspot.com/breeze/agent-builder
- HubSpot Agent CLI: developers.hubspot.com/docs/guides/crm/setup/developer-tools/mcp
- Descript MCP: github.com/descript/mcp-server (external MCP server for Descript API)
- Adobe MCP: adobe.com/products/adobe-for-creativity (50+ tools, MCP connector)
- Canva MCP: mcp.canva.com (connected — generate, edit, export designs)
- Figma MCP: mcp.figma.com (connected — design context, screenshots, diagrams)

### 12.4 Guiding Principles

- Build on HubSpot. The sync layer, UI, and automation all live in a single HubSpot Projects app. No external hosting.
- Start manual, then automate. Use Cowork and pipeline automation from day one. Build serverless functions as patterns stabilize.
- HubSpot is the brain, not the body. It holds structure and relationships. Content drafts live in Obsidian/Docs. Engineering tasks live in Linear. Content production lives in the Asana content factory. HubSpot state drives Asana state, not the reverse.
- Every record has a link. If work happens elsewhere, the HubSpot record has a clickable URL to get there.
- Use the full platform. Custom objects, serverless functions, workflow actions, UI extensions, Breeze tools, Breeze Studio, Knowledge Vaults, MCP Client, Data Agent actions, pipeline rules, rollup/calculation properties, custom events, app pages, goal tracking. Each phase teaches a different surface.
- The build is the curriculum. By the end, you'll have shipped a real app using every major feature of the developer platform you advocate for.
