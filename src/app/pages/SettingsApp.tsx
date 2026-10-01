import { useEffect, useState, useCallback } from 'react';
import {
  hubspot,
  Box,
  Flex,
  Form,
  Heading,
  Text,
  Tag,
  Select,
  TextArea,
  Button,
  Alert,
  Divider,
  LoadingSpinner,
} from '@hubspot/ui-extensions';
import { PageTitle } from '@hubspot/ui-extensions/pages';

// --- Shared types ---

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

interface PromptSet {
  standalone: string;
  rollup: string;
}

interface SettingsResponse extends AppSettings {
  teams: LinearOption[];
  teamMembers: LinearOption[];
  prompts: PromptSet;
  promptDefaults: PromptSet;
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

interface PipelineStage {
  id: string;
  label: string;
  displayOrder: number;
  isClosed: boolean;
}

interface ContentRecord {
  id: string;
  title: string;
  contentType: string;
  pipelineStage: string;
  targetDate: string | null;
  linearIssueUrl: string | null;
}

interface ContentData {
  stages: PipelineStage[];
  records: ContentRecord[];
  objectTypeId: string;
  portalId: number;
  total: number;
}

type TagVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

const CONTENT_TYPE_VARIANT: Record<string, TagVariant> = {
  'blog post': 'info',
  'blog_post': 'info',
  'video': 'success',
  'tutorial': 'warning',
  'changelog': 'default',
  'documentation': 'info',
  'talk': 'warning',
  'social': 'error',
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

// --- Pipeline components ---

function RecordCard({ record }: { record: ContentRecord }) {
  const typeKey = record.contentType.toLowerCase();
  const tagVariant: TagVariant = CONTENT_TYPE_VARIANT[typeKey] ?? 'default';
  return (
    <Box>
      <Flex direction="column" gap="extra-small">
        {record.contentType && <Tag variant={tagVariant}>{record.contentType}</Tag>}
        <Text format={{ fontWeight: 'bold' }}>{record.title}</Text>
        {record.targetDate && (
          <Text variant="microcopy">Target: {formatDate(record.targetDate)}</Text>
        )}
      </Flex>
      <Divider />
    </Box>
  );
}

function KanbanColumn({ stage, records }: { stage: PipelineStage; records: ContentRecord[] }) {
  return (
    <Flex direction="column" gap="small">
      <Flex justify="between" align="center">
        <Text format={{ fontWeight: 'bold' }}>{stage.label}</Text>
        <Tag variant="default">{String(records.length)}</Tag>
      </Flex>
      <Divider />
      {records.length === 0 ? (
        <Text variant="microcopy">Empty</Text>
      ) : (
        records.map(r => <RecordCard key={r.id} record={r} />)
      )}
    </Flex>
  );
}

function PipelineBoard({ portalId, onShowSettings, onShowChangelog }: { portalId: number; onShowSettings: () => void; onShowChangelog: () => void }) {
  const [data, setData] = useState<ContentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    hubspot
      .serverless('content_data_api', { parameters: { portalId: String(portalId) } })
      .then((result: { statusCode: number; body: string }) => {
        if (result.statusCode === 200) {
          setData(JSON.parse(result.body) as ContentData);
        } else {
          const parsed = JSON.parse(result.body) as { error?: string };
          setError(parsed.error ?? 'Failed to load content data');
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load content data');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <Flex justify="center" align="center">
        <LoadingSpinner label="Loading content pipeline..." />
      </Flex>
    );
  }

  if (error || !data) {
    return (
      <Flex direction="column" gap="medium">
        <Alert title="Failed to load content pipeline" variant="error">
          <Text>{error ?? 'Unknown error — check function logs'}</Text>
        </Alert>
        <Button onClick={loadData} variant="secondary">Retry</Button>
      </Flex>
    );
  }

  const contentTypes = Array.from(
    new Set(data.records.map(r => r.contentType).filter(Boolean)),
  ).sort();

  const typeOptions = [
    { label: 'All types', value: 'all' },
    ...contentTypes.map(t => ({ label: t, value: t })),
  ];

  const filteredRecords = typeFilter === 'all'
    ? data.records
    : data.records.filter(r => r.contentType === typeFilter);

  const visibleStages = data.stages.filter(s =>
    showArchived ? true : s.label !== 'Archived',
  );

  const recordsByStage: Record<string, ContentRecord[]> = {};
  for (const stage of visibleStages) {
    recordsByStage[stage.id] = filteredRecords.filter(r => r.pipelineStage === stage.id);
  }

  const visibleCount = Object.values(recordsByStage).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <Box>
      <PageTitle>Content Command Center</PageTitle>
      <Flex justify="between" align="center">
        <Heading>Content Pipeline</Heading>
        <Flex align="center" gap="small">
          <Text>{visibleCount} of {data.total} records</Text>
          <Button onClick={loadData} variant="secondary" size="sm">Refresh</Button>
          <Button onClick={onShowChangelog} variant="secondary" size="sm">📋 Changelog</Button>
          <Button onClick={onShowSettings} variant="secondary" size="sm">⚙ Settings</Button>
        </Flex>
      </Flex>
      <Flex align="end" gap="medium">
        <Select
          label="Filter by type"
          name="typeFilter"
          value={typeFilter}
          onChange={val => setTypeFilter(String(val))}
          options={typeOptions}
        />
        <Button onClick={() => setShowArchived(prev => !prev)} variant="transparent">
          {showArchived ? 'Hide Archived' : 'Show Archived'}
        </Button>
      </Flex>
      <Flex direction="row" gap="medium" wrap="wrap">
        {visibleStages.map(stage => (
          <Box key={stage.id}>
            <KanbanColumn stage={stage} records={recordsByStage[stage.id] ?? []} />
          </Box>
        ))}
      </Flex>
    </Box>
  );
}

// --- Settings component ---

function SettingsPage({ portalId, onBack }: { portalId: number; onBack: () => void }) {
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
  }, [portalId, settings, projectMap, prompts]);

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
      <PageTitle>Settings</PageTitle>
      <Flex justify="between" align="center">
        <Heading>Linear Sync Settings</Heading>
        <Button onClick={onBack} variant="transparent">← Back</Button>
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

// --- Changelog component ---

function ChangelogManager({ portalId, onBack }: { portalId: number; onBack: () => void }) {
  const [records, setRecords] = useState<ContentRecord[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hubspot
      .serverless('content_data_api', {
        parameters: { portalId: String(portalId), pipeline: 'changelog' },
      })
      .then((result: { statusCode: number; body: string }) => {
        if (result.statusCode === 200) {
          const data = JSON.parse(result.body) as ContentData;
          // The API now filters to the changelog pipeline and returns THAT
          // pipeline's stages, so no client-side content_type filtering.
          setRecords(data.records);
          setStages(data.stages);
        } else {
          const parsed = JSON.parse(result.body) as { error?: string };
          setError(parsed.error ?? 'Failed to load changelog data');
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load changelog data');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Flex justify="center" align="center">
        <LoadingSpinner label="Loading changelog..." />
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex direction="column" gap="medium">
        <Alert title="Failed to load changelog" variant="error">
          <Text>{error}</Text>
        </Alert>
        <Button onClick={onBack} variant="secondary">← Back</Button>
      </Flex>
    );
  }

  return (
    <Box>
      <PageTitle>Changelog Manager</PageTitle>
      <Flex justify="between" align="center">
        <Heading>Changelog Manager</Heading>
        <Button onClick={onBack} variant="secondary" size="sm">← Back</Button>
      </Flex>
      <Flex direction="column" gap="medium">
        {stages.map(stage => {
          // Match on stage.id — r.pipelineStage is a HubSpot stage ID, never a label.
          const stageRecords = records.filter(r => r.pipelineStage === stage.id);
          return (
            <Box key={stage.id}>
              <Flex justify="between" align="center">
                <Text format={{ fontWeight: 'bold' }}>{stage.label}</Text>
                <Tag variant="default">{String(stageRecords.length)}</Tag>
              </Flex>
              <Divider />
              {stageRecords.length === 0 ? (
                <Text variant="microcopy">No items</Text>
              ) : (
                stageRecords.map(record => (
                  <Box key={record.id}>
                    <Text>{record.title}</Text>
                  </Box>
                ))
              )}
            </Box>
          );
        })}
      </Flex>
    </Box>
  );
}

// --- Root app ---

type View = 'pipeline' | 'settings' | 'changelog';

function App({ portalId }: { portalId: number }) {
  const [view, setView] = useState<View>('pipeline');
  if (view === 'settings') {
    return <SettingsPage portalId={portalId} onBack={() => setView('pipeline')} />;
  }
  if (view === 'changelog') {
    return <ChangelogManager portalId={portalId} onBack={() => setView('pipeline')} />;
  }
  return (
    <PipelineBoard
      portalId={portalId}
      onShowSettings={() => setView('settings')}
      onShowChangelog={() => setView('changelog')}
    />
  );
}

hubspot.extend<'pages'>(({ context }) => {
  const portalId = (context as { portal: { id: number } }).portal.id;
  return <App portalId={portalId} />;
});
