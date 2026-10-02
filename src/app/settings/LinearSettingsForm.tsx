// GENERATED FILE — DO NOT EDIT.
//
// Source of truth: src/app/pages/LinearSettingsForm.tsx
// Regenerate with: npm run sync:settings-form
//
// This exists because HubSpot bundles each extension directory in isolation,
// so the settings extension cannot import across into pages/. Edits made here
// are overwritten, and settings-form-in-sync.test.ts fails while the two files
// differ.

import { useEffect, useState, useCallback } from 'react';
import {
  hubspot,
  Alert,
  Box,
  Button,
  Divider,
  Flex,
  Form,
  Heading,
  Input,
  Link,
  LoadingSpinner,
  Select,
  Tag,
  Text,
  TextArea,
} from '@hubspot/ui-extensions';

/**
 * The Linear sync settings form — team, assignee, project routing, the
 * historical import and the changelog drafting prompts.
 *
 * ONE IMPLEMENTATION, TWO ENTRANCES
 * ---------------------------------
 * This lives in its own file because it is reached from two places: the
 * Content Command Center page, and the app's Settings tab under Connected
 * apps.
 *
 * The last time there were two entrances there were also two copies. Three
 * changes landed in the copy nobody could see while the one people used stayed
 * unchanged, and four rounds of "why isn't this appearing" came out of it (#60).
 * Whatever else changes here, there must never be a second copy of this form.
 *
 * `onBack` is optional on purpose: the page needs a way back to the pipeline
 * board, and the Settings tab is already a destination of its own.
 */

type ServerlessResult = {
  statusCode: number;
  body: string;
};

async function callApi(action: string, params: Record<string, string> = {}): Promise<ServerlessResult> {
  const result = await (hubspot.serverless as (uid: string, opts: { parameters: Record<string, string> }) => Promise<ServerlessResult>)(
    'app_settings_api',
    { parameters: { action, ...params } },
  );
  if (!result || result.statusCode === undefined) {
    throw new Error(`Unexpected serverless result: ${JSON.stringify(result)}`);
  }
  return result;
}

// --- Settings types ---

interface AppSettings {
  linearTeamId: string;
  assigneeFilter: 'all' | 'assigned' | 'mine';
  linearAssigneeId: string;
}

interface LinearOption {
  id: string;
  name: string;
}

type ProjectKind = 'content' | 'changelog' | 'ignore';
type ProjectMap = Record<string, ProjectKind>;

interface UnmappedProject {
  id: string;
  name: string;
}

type GoogleStatus = 'disconnected' | 'pending_secret' | 'connected' | 'unknown';

interface GoogleStatusResponse {
  status: GoogleStatus;
  channelTitle?: string | null;
}

interface AuthorizeResponse {
  authUrl: string;
  redirectUri: string;
  scopes: string[];
  /** Which secret this authorisation's refresh token belongs in. */
  secretName: string;
}

interface PromptSet {
  standalone: string;
  rollup: string;
}

interface SettingsResponse extends AppSettings {
  teams: LinearOption[];
  teamMembers: LinearOption[];
  prompts: PromptSet;
  promptDefaults: PromptSet;
  model: string;
  thinking: string;
  projects: LinearOption[];
  projectMap: ProjectMap;
  unmappedProjects: UnmappedProject[];
}

// --- Import types ---

interface PreviewIssue {
  id: string;
  identifier: string;
  title: string;
  state: string;
  team: string;
  project: string | null;
  kind: ProjectKind;
}

/**
 * Issues per import request.
 *
 * MUST match IMPORT_BATCH_SIZE in src/app/lib/import-batching.ts, which is what
 * the backfill action enforces. `import-batch-size.test.ts` fails if they drift.
 *
 * Defined here rather than imported because no UI extension in this repo has
 * ever imported from ../lib and the bundler's handling of it is unproven — the
 * settings page is not the place to find out.
 */
const IMPORT_BATCH_SIZE = 15;

/** Splits into runs of at most `size`, preserving order. */
function chunk<T>(items: T[], size: number = IMPORT_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface ImportResult {
  requested: number;
  imported: number;
  created: number;
  updated: number;
  errors: string[];
}

// --- Pipeline types ---

export function LinearSettingsForm({ portalId, onBack }: { portalId: number; onBack?: () => void }) {
  const [settings, setSettings] = useState<AppSettings>({
    linearTeamId: '',
    assigneeFilter: 'all',
    linearAssigneeId: '',
  });
  const [teams, setTeams] = useState<LinearOption[]>([]);
  const [teamMembers, setTeamMembers] = useState<LinearOption[]>([]);
  const [projects, setProjects] = useState<LinearOption[]>([]);
  const [projectMap, setProjectMap] = useState<ProjectMap>({});
  const [unmappedProjects, setUnmappedProjects] = useState<UnmappedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorDetail, setErrorDetail] = useState<string>('');
  const [previewIssues, setPreviewIssues] = useState<PreviewIssue[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  // Captured when the import starts: the selection can change underneath, and
  // the result must be judged against what was actually requested.
  const [importAsked, setImportAsked] = useState(0);
  // What this portal has overridden. Empty is the normal state and means
  // "use the shipped default" — never prefilled with the default, because
  // saving that would freeze this portal at today's wording.
  const [prompts, setPrompts] = useState<PromptSet>({ standalone: '', rollup: '' });
  const [promptDefaults, setPromptDefaults] = useState<PromptSet>({ standalone: '', rollup: '' });
  // '' means "use the shipped default", the same convention as the prompts.
  const [google, setGoogle] = useState<GoogleStatus>('unknown');
  const [googleChannel, setGoogleChannel] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [grantedScopes, setGrantedScopes] = useState<string[]>([]);
  const [secretName, setSecretName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [googleError, setGoogleError] = useState('');

  const [model, setModel] = useState('');
  const [thinking, setThinking] = useState('');

  useEffect(() => {
    callApi('getSettings', { portalId: String(portalId) })
      .then(res => {
        if (res.statusCode === 200) {
          const data = JSON.parse(res.body) as SettingsResponse;
          setSettings({
            linearTeamId: data.linearTeamId,
            assigneeFilter: data.assigneeFilter,
            linearAssigneeId: data.linearAssigneeId,
          });
          setTeams(data.teams ?? []);
          setPrompts(data.prompts ?? { standalone: '', rollup: '' });
          setPromptDefaults(data.promptDefaults ?? { standalone: '', rollup: '' });
          setModel(data.model ?? '');
          setThinking(data.thinking ?? '');
          setTeamMembers(data.teamMembers ?? []);
          setProjects(data.projects ?? []);
          setProjectMap(data.projectMap ?? {});
          setUnmappedProjects(data.unmappedProjects ?? []);
        } else {
          const data = JSON.parse(res.body) as { error?: string; detail?: string };
          setErrorDetail(`${res.statusCode}: ${data.detail ?? data.error ?? res.body}`);
          setStatus('error');
        }
      })
      .catch((err: unknown) => {
        setErrorDetail(err instanceof Error ? err.message : 'Failed to load settings');
        setStatus('error');
      })
      .finally(() => setLoading(false));
  }, [portalId]);

  const handleTeamChange = useCallback((teamId: string) => {
    setSettings(s => ({ ...s, linearTeamId: teamId, linearAssigneeId: '' }));
    setTeamMembers([]);
    if (!teamId) return;
    setLoadingMembers(true);
    callApi('loadTeamMembers', { portalId: String(portalId), teamId })
      .then(res => {
        const data = JSON.parse(res.body) as { teamMembers: LinearOption[] };
        setTeamMembers(data.teamMembers ?? []);
      })
      .catch(() => setTeamMembers([]))
      .finally(() => setLoadingMembers(false));
  }, [portalId]);

  /** The auth function is its own extension point; this page just asks it. */
  const callYouTubeAuth = useCallback(
    async (action: string, service?: string): Promise<ServerlessResult> =>
      (hubspot.serverless as (uid: string, opts: { parameters: Record<string, string> }) => Promise<ServerlessResult>)(
        'youtube_auth',
        { parameters: { action, portalId: String(portalId), ...(service ? { service } : {}) } },
      ),
    [portalId],
  );

  useEffect(() => {
    callYouTubeAuth('status')
      .then(res => {
        if (res.statusCode !== 200) { setGoogle('unknown'); return; }
        const data = JSON.parse(res.body) as GoogleStatusResponse;
        setGoogle(data.status ?? 'unknown');
        setGoogleChannel(data.channelTitle ?? '');
      })
      .catch(() => setGoogle('unknown'));
  }, [callYouTubeAuth]);

  const startGoogleAuth = useCallback((service: 'youtube' | 'drive') => {
    setConnecting(true);
    setGoogleError('');
    setAuthUrl('');
    callYouTubeAuth('authorize', service)
      .then(res => {
        if (res.statusCode !== 200) {
          const data = JSON.parse(res.body) as { error?: string; detail?: string };
          setGoogleError(data.detail ?? data.error ?? 'Could not start the Google connection');
          return;
        }
        const data = JSON.parse(res.body) as AuthorizeResponse;
        setAuthUrl(data.authUrl);
        setRedirectUri(data.redirectUri);
        setGrantedScopes(data.scopes ?? []);
        setSecretName(data.secretName ?? '');
      })
      .catch((err: unknown) =>
        setGoogleError(err instanceof Error ? err.message : 'Could not start the Google connection'))
      .finally(() => setConnecting(false));
  }, [callYouTubeAuth]);

  const handleSave = useCallback(() => {
    setSaving(true);
    setStatus('idle');
    callApi('saveSettings', {
      portalId: String(portalId),
      linearTeamId: settings.linearTeamId,
      assigneeFilter: settings.assigneeFilter,
      linearAssigneeId: settings.linearAssigneeId,
      projectMap: JSON.stringify(projectMap),
      promptStandalone: prompts.standalone,
      promptRollup: prompts.rollup,
      model,
      thinking,
    })
      .then(res => {
        if (res.statusCode === 200) {
          setStatus('success');
        } else {
          const data = JSON.parse(res.body) as { error?: string; detail?: string };
          setErrorDetail(`${res.statusCode}: ${data.detail ?? data.error ?? ''}`);
          setStatus('error');
        }
      })
      .catch(() => setStatus('error'))
      .finally(() => setSaving(false));
  }, [portalId, settings, projectMap, prompts, model, thinking]);

  const handlePreview = useCallback(() => {
    setPreviewLoading(true);
    setImportError(null);
    setImportResult(null);
    callApi('backfillPreview', { portalId: String(portalId) })
      .then(res => {
        if (res.statusCode === 200) {
          const data = JSON.parse(res.body) as { issues: PreviewIssue[] };
          setPreviewIssues(data.issues);
          setSelectedIds(new Set(data.issues.map(i => i.id)));
        } else {
          const data = JSON.parse(res.body) as { error?: string };
          setImportError(data.error ?? 'Preview failed');
        }
      })
      .catch((err: unknown) => {
        setImportError(err instanceof Error ? err.message : 'Preview failed');
      })
      .finally(() => setPreviewLoading(false));
  }, [portalId]);

  const toggleIssue = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds(prev =>
      prev.size === previewIssues.length
        ? new Set<string>()
        : new Set(previewIssues.map(i => i.id)),
    );
  }, [previewIssues]);

  /**
   * Imports the selection in batches, one request at a time.
   *
   * This used to send every selected id in a single call. Selecting all 83
   * assigned issues produced 33 records on production and a green "Import
   * complete" — each issue costs a HubSpot search plus a write, and 83 of them
   * is far more work than one invocation gets.
   *
   * Sequential rather than parallel: the writes are not the bottleneck worth
   * optimising, and six concurrent invocations against the same object is a
   * good way to turn one problem into a different one.
   */
  const handleImport = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setImportLoading(true);
    setImportResult(null);
    setImportError(null);
    setImportAsked(ids.length);
    setImportProgress({ done: 0, total: ids.length });

    const batches = chunk(ids);
    const totals: ImportResult = { requested: 0, imported: 0, created: 0, updated: 0, errors: [] };
    let done = 0;

    try {
      for (const batch of batches) {
        const res = await callApi('backfill', { portalId: String(portalId), ids: batch.join(',') });
        if (res.statusCode !== 200) {
          const data = JSON.parse(res.body) as { error?: string; detail?: string };
          throw new Error(data.detail ?? data.error ?? 'Import failed');
        }
        const batchResult = JSON.parse(res.body) as ImportResult;
        totals.requested += batchResult.requested;
        totals.imported += batchResult.imported;
        totals.created += batchResult.created;
        totals.updated += batchResult.updated;
        totals.errors.push(...batchResult.errors);

        done += batch.length;
        setImportProgress({ done, total: ids.length });
      }
      setImportResult(totals);
    } catch (err) {
      // Whatever already landed is shown alongside the error. A batch failing
      // halfway through must not erase the record of the ones that worked.
      if (done > 0) setImportResult(totals);
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportProgress(null);
      setImportLoading(false);
    }
  }, [portalId, selectedIds]);

  if (loading) {
    return (
      <Flex justify="center" align="center">
        <LoadingSpinner label="Loading settings..." />
      </Flex>
    );
  }

  if (status === 'error' && !settings.linearTeamId && teams.length === 0) {
    return (
      <Flex direction="column" gap="medium">
        <Button onClick={onBack} variant="transparent">← Back</Button>
        <Alert title="Failed to load settings" variant="error">
          <Text>{errorDetail || 'Check function logs in the developer portal.'}</Text>
        </Alert>
      </Flex>
    );
  }

  const teamOptions = [
    { label: 'Any team — filter by assignee only', value: 'any' },
    ...teams.map(t => ({ label: t.name, value: t.id })),
  ];
  const memberOptions = teamMembers.map(m => ({ label: m.name, value: m.id }));
  // Mirrors isConfigured on the server: a team bounds the sync, or a named
  // assignee does.
  const canSave = settings.assigneeFilter === 'mine'
    ? !!settings.linearAssigneeId
    : !!settings.linearTeamId;

  return (
    <Form>
      <Flex justify="between" align="center">
        <Heading>Linear Sync Settings</Heading>
        {onBack && <Button onClick={onBack} variant="transparent">← Back</Button>}
      </Flex>
      <Text>Configure how this portal syncs with Linear.</Text>

      <Select
        label="Linear Team"
        name="linearTeamId"
        value={settings.linearTeamId}
        placeholder={teams.length === 0 ? 'No teams found — check LINEAR_API_KEY' : 'Select a team'}
        onChange={value => handleTeamChange(String(value))}
        options={teamOptions}
      />

      <Select
        label="Which issues should sync to HubSpot?"
        name="assigneeFilter"
        value={settings.assigneeFilter}
        onChange={value =>
          setSettings(s => ({ ...s, assigneeFilter: value as AppSettings['assigneeFilter'], linearAssigneeId: '' }))
        }
        options={[
          { label: 'All issues', value: 'all' },
          { label: 'Assigned issues only', value: 'assigned' },
          { label: 'My issues only', value: 'mine' },
        ]}
      />

      {settings.assigneeFilter === 'mine' && (
        loadingMembers ? (
          <Flex justify="start" align="center">
            <LoadingSpinner label="Loading team members..." />
          </Flex>
        ) : (
          <Select
            label="Which team member are you?"
            name="linearAssigneeId"
            value={settings.linearAssigneeId}
            placeholder={memberOptions.length === 0 ? 'Select a team first' : 'Select your name'}
            onChange={value => setSettings(s => ({ ...s, linearAssigneeId: String(value) }))}
            options={memberOptions}
          />
        )
      )}

      <Divider />

      {unmappedProjects.length > 0 && (
        <Alert title="New Linear projects detected" variant="warning">
          <Text>
            {unmappedProjects.length === 1
              ? `"${unmappedProjects[0].name}" is sending issues but has no mapping.`
              : `${unmappedProjects.length} projects are sending issues but have no mapping.`}
            {' '}Unmapped projects default to Content. Assign each one below, then save.
          </Text>
        </Alert>
      )}

      <Heading>Project Routing</Heading>
      <Text>Route issues from each Linear project to a HubSpot pipeline, or ignore them.</Text>

      {projects.length === 0 ? (
        <Text variant="microcopy">No Linear projects found — check LINEAR_API_KEY</Text>
      ) : (
        projects.map(project => (
          <Select
            key={project.id}
            label={project.name}
            name={`project_${project.id}`}
            value={projectMap[project.id] ?? ''}
            placeholder="Unmapped (defaults to Content)"
            onChange={value => setProjectMap(prev => {
              const next = { ...prev };
              if (value === '') { delete next[project.id]; } else { next[project.id] = value as ProjectKind; }
              return next;
            })}
            options={[
              { label: 'Unmapped (defaults to Content)', value: '' },
              { label: 'Content', value: 'content' },
              { label: 'Changelog', value: 'changelog' },
              { label: 'Ignore', value: 'ignore' },
            ]}
          />
        ))
      )}

      <Divider />

      <Heading>Google connection</Heading>
      <Text variant="microcopy">
        Two separate connections. Google refuses to grant the YouTube scopes and
        Drive in one authorisation — it blocks the consent screen with
        &quot;scopes that cannot be requested together&quot; — so each has its own
        consent and its own refresh token.
      </Text>

      <Flex align="center" gap="small">
        <Tag variant={google === 'connected' ? 'success' : google === 'pending_secret' ? 'warning' : 'error'}>
          {google === 'connected' ? 'Connected'
            : google === 'pending_secret' ? 'Awaiting secret'
            : google === 'disconnected' ? 'Not connected'
            : 'Unknown'}
        </Tag>
        {googleChannel && <Text>{googleChannel}</Text>}
      </Flex>

      {google === 'pending_secret' && (
        <Alert title="Connected, but the token is not stored yet" variant="warning">
          <Text>
            Google approved the connection and returned a refresh token. Until it
            is saved as a secret and the project re-uploaded, nothing can use it.
          </Text>
        </Alert>
      )}

      {googleError && (
        <Alert title="Could not start the Google connection" variant="error">
          <Text>{googleError}</Text>
        </Alert>
      )}

      {!authUrl ? (
        <Flex gap="small">
          <Button variant="secondary" disabled={connecting} onClick={() => startGoogleAuth('youtube')}>
            {connecting ? 'Preparing…' : google === 'connected' ? 'Reconnect YouTube' : 'Connect YouTube'}
          </Button>
          <Button variant="secondary" disabled={connecting} onClick={() => startGoogleAuth('drive')}>
            {connecting ? 'Preparing…' : 'Connect Drive'}
          </Button>
        </Flex>
      ) : (
        <Box>
          <Text format={{ fontWeight: 'bold' }}>1. Approve the connection</Text>
          <Link href={authUrl}>Open the Google consent screen</Link>
          <Text variant="microcopy">Granting: {grantedScopes.join(', ')}</Text>

          <Text format={{ fontWeight: 'bold' }}>2. Store the token it returns</Text>
          <Text variant="microcopy">
            Google redirects back to this portal and the response contains a
            refresh token, shown once. Save it with
            {' '}<Text format={{ fontWeight: 'bold' }}>hs secrets add {secretName}</Text>
            {' '}and re-upload the project — a running function does not pick up a
            changed secret without a deploy. Each connection has its own secret,
            so storing one under the other&apos;s name breaks both.
          </Text>
          <Text variant="microcopy">
            Check the account first: the CLI ignores --account when only one is
            configured, so an update can land on the wrong portal.
          </Text>

          <Text variant="microcopy">
            If Google rejects the redirect, add this to the OAuth client as an
            authorised redirect URI: {redirectUri}
          </Text>
          <Text variant="microcopy">
            The Cloud project also needs the Google Drive API enabled — consenting
            to a scope and the project being allowed to call the API are separate
            things. Only Drive: the documents are created by uploading HTML and
            letting Drive convert it, so the Docs API is never called.
          </Text>
        </Box>
      )}

      <Divider />

      <Heading>Changelog Drafting</Heading>
      <Text variant="microcopy">
        Which model writes the draft. A draft has to finish inside HubSpot&apos;s
        20-second function limit, so these are speed settings before they are cost
        settings — Opus with thinking on will time out on a long standalone post.
      </Text>

      <Select
        label="Model"
        name="changelogModel"
        value={model}
        onChange={value => { setModel(String(value ?? '')); setStatus('idle'); }}
        options={[
          { label: 'Default (Sonnet — fits the 20s function limit)', value: '' },
          { label: 'Opus — most capable', value: 'opus' },
          { label: 'Sonnet — half the cost, faster', value: 'sonnet' },
          { label: 'Haiku — cheapest, fastest', value: 'haiku' },
        ]}
      />

      <Select
        label="Thinking"
        name="changelogThinking"
        value={thinking}
        onChange={value => { setThinking(String(value ?? '')); setStatus('idle'); }}
        options={[
          { label: 'Default (Off — fastest)', value: '' },
          { label: 'Adaptive', value: 'adaptive' },
          { label: 'Off — cheaper and faster', value: 'off' },
        ]}
      />

      <Heading>Changelog Drafting Prompts</Heading>
      <Text variant="microcopy">
        The instructions sent to the model when drafting a changelog. Leave these
        empty to use the prompts shipped with the app — an empty field keeps this
        portal receiving improvements to them. Fill one in only to override it here.
      </Text>

      <PromptOverride
        label="Standalone post"
        name="promptStandalone"
        hint="For a change significant enough to earn its own announcement and its own email to subscribers."
        value={prompts.standalone}
        defaultValue={promptDefaults.standalone}
        onChange={next => setPrompts(prev => ({ ...prev, standalone: next }))}
      />

      <PromptOverride
        label="Rollup entry"
        name="promptRollup"
        hint="For one entry inside a monthly digest. Two to four sentences, and it refuses breaking changes."
        value={prompts.rollup}
        defaultValue={promptDefaults.rollup}
        onChange={next => setPrompts(prev => ({ ...prev, rollup: next }))}
      />

      <Divider />

      {status === 'success' && <Alert title="Settings saved" variant="success" />}
      {status === 'error' && (
        <Alert title="Failed to save settings" variant="error">
          <Text>{errorDetail || 'Check the function logs for details.'}</Text>
        </Alert>
      )}

      <Button onClick={handleSave} disabled={saving || !canSave} variant="primary">
        {saving ? 'Saving…' : 'Save settings'}
      </Button>

      <Divider />

      <Heading>Historical Import</Heading>

      {!canSave || Object.keys(projectMap).length === 0 ? (
        <Alert title={!canSave ? 'Configure settings first' : 'Map your projects first'} variant="info">
          <Text>
            {!canSave
              ? 'Set your team, assignee, and project mappings above, then save before importing.'
              : 'Assign each project above to Content, Changelog, or Ignore, then save before importing.'}
          </Text>
        </Alert>
      ) : (
        <Flex direction="column" gap="small">
          <Text>Preview existing Linear issues and choose which to import into HubSpot.</Text>
          <Box>
            <Button onClick={handlePreview} disabled={previewLoading} variant="secondary">
              {previewLoading ? 'Loading preview…' : 'Preview Eligible Issues'}
            </Button>
          </Box>

          {importError && (
            <Alert title="Error" variant="error">
              <Text>{importError}</Text>
            </Alert>
          )}

          {previewIssues.length > 0 && !importResult && (
            <Flex direction="column" gap="small">
              <Flex justify="between" align="center">
                <Text format={{ fontWeight: 'bold' }}>{selectedIds.size} of {previewIssues.length} issues selected</Text>
                <Button onClick={toggleAll} variant="transparent" size="sm">
                  {selectedIds.size === previewIssues.length ? 'Deselect All' : 'Select All'}
                </Button>
              </Flex>

              {previewIssues.map(issue => (
                <Flex key={issue.id} align="center" gap="small">
                  <Button
                    onClick={() => toggleIssue(issue.id)}
                    variant={selectedIds.has(issue.id) ? 'primary' : 'secondary'}
                    size="sm"
                  >
                    {selectedIds.has(issue.id) ? '✓' : '○'}
                  </Button>
                  <Tag variant={issue.kind === 'changelog' ? 'warning' : 'info'}>{issue.kind}</Tag>
                  <Flex direction="column" gap="extra-small">
                    <Text format={{ fontWeight: 'bold' }}>{issue.identifier}: {issue.title}</Text>
                    <Text variant="microcopy">{issue.state}{issue.project ? ` · ${issue.project}` : ''}</Text>
                  </Flex>
                </Flex>
              ))}

              <Box>
                <Button
                  onClick={handleImport}
                  disabled={importLoading || selectedIds.size === 0}
                  variant="primary"
                >
                  {importLoading
                    ? importProgress
                      ? `Importing ${importProgress.done} of ${importProgress.total}…`
                      : 'Importing…'
                    : `Import ${selectedIds.size} Issue${selectedIds.size === 1 ? '' : 's'}`}
                </Button>
              </Box>
            </Flex>
          )}

          {importResult && (() => {
            // Judged against what was ASKED FOR, not just against errors. The
            // old version showed "Import complete" in green whenever the errors
            // list was empty, which is how 33 of 83 read as a success.
            const complete =
              importResult.errors.length === 0 && importResult.imported >= importAsked;
            return (
              <Alert
                title={complete ? 'Import complete' : 'Import did not finish'}
                variant={complete ? 'success' : 'warning'}
              >
                <Text>
                  Imported {importResult.imported} of {importAsked} selected — created{' '}
                  {importResult.created}, updated {importResult.updated}
                  {importResult.errors.length > 0
                    ? `. ${importResult.errors.length} error(s).`
                    : ''}
                </Text>
                {!complete && (
                  <Text variant="microcopy">
                    Run the import again to pick up the rest — issues already brought
                    over are matched on their Linear id and updated, not duplicated.
                  </Text>
                )}
              </Alert>
            );
          })()}
        </Flex>
      )}
    </Form>
  );
}


/**
 * One editable system prompt.
 *
 * The field is EMPTY when this portal has not overridden anything, and that is
 * the normal state — it is never prefilled with the shipped default, because
 * saving that would store today's wording and silently cut this portal off
 * from every later improvement to it. "Load default to edit" is the deliberate
 * way to start from the baseline; clearing the field is how you go back.
 */
function PromptOverride({
  label, name, hint, value, defaultValue, onChange,
}: {
  label: string;
  name: string;
  hint: string;
  value: string;
  defaultValue: string;
  onChange: (next: string) => void;
}) {
  const overridden = value.trim().length > 0;
  return (
    <Box>
      <Flex justify="between" align="center">
        <Text format={{ fontWeight: 'bold' }}>{label}</Text>
        <Tag variant={overridden ? 'warning' : 'success'}>
          {overridden ? 'Custom' : 'Using default'}
        </Tag>
      </Flex>
      <Text variant="microcopy">{hint}</Text>
      <TextArea
        label=""
        name={name}
        value={value}
        rows={10}
        placeholder="Empty — the shipped default is in use."
        onChange={next => onChange(String(next ?? ''))}
      />
      <Flex gap="small">
        <Button
          size="sm"
          variant="secondary"
          disabled={overridden}
          onClick={() => onChange(defaultValue)}
        >
          Load default to edit
        </Button>
        <Button
          size="sm"
          variant="transparent"
          disabled={!overridden}
          onClick={() => onChange('')}
        >
          Reset to default
        </Button>
      </Flex>
    </Box>
  );
}
