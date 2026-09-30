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
  Button,
  Alert,
  Divider,
  Checkbox,
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

interface PreviewIssue {
  id: string;
  identifier: string;
  title: string;
  state: string;
  team: string;
  project: string | null;
  kind: 'content' | 'changelog';
}

interface LinearOption {
  id: string;
  name: string;
}

type ProjectKind = 'content' | 'changelog' | 'ignore';

interface SettingsResponse extends AppSettings {
  projects?: LinearOption[];
  projectMap?: Record<string, ProjectKind>;
  unmappedProjects?: Array<{ id: string; name: string }>;
  teams: LinearOption[];
  teamMembers: LinearOption[];
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
  const [projectMap, setProjectMap] = useState<Record<string, ProjectKind>>({});
  const [unmapped, setUnmapped] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorDetail, setErrorDetail] = useState<string>('');

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewIssue[] | null>(null);
  const [previewMeta, setPreviewMeta] = useState({ scanned: 0, skippedAssignee: 0 });
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string>('');
  const [importError, setImportError] = useState('');

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
          setTeamMembers(data.teamMembers ?? []);
          setProjects(data.projects ?? []);
          setProjectMap(data.projectMap ?? {});
          setUnmapped(data.unmappedProjects ?? []);
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
  }, [portalId, settings]);

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
    { label: 'Any team — filter by assignee only', value: '' },
    ...teams.map(t => ({ label: t.name, value: t.id })),
  ];
  const memberOptions = teamMembers.map(m => ({ label: m.name, value: m.id }));

  // Mirrors isConfigured on the server: a team bounds the sync, or a named
  // assignee does.
  const canSave = settings.assigneeFilter === 'mine'
    ? !!settings.linearAssigneeId
    : !!settings.linearTeamId;

  // Read-only. Nothing is written until the import button below, which is the
  // point — a button that silently created 83 records was the wrong design.
  const runPreview = useCallback(async () => {
    setPreviewing(true);
    setImportError('');
    setImportResult('');
    try {
      const res = await callApi('backfillPreview', { portalId: String(portalId) });
      const parsed = JSON.parse(res.body || '{}');
      if (res.statusCode !== 200) throw new Error(parsed.error || `HTTP ${res.statusCode}`);
      const issues: PreviewIssue[] = parsed.issues ?? [];
      setPreview(issues);
      setPreviewMeta({ scanned: parsed.scanned ?? 0, skippedAssignee: parsed.skippedAssignee ?? 0 });
      // Everything ticked by default: the common case is importing the lot,
      // and unticking a few is less work than ticking eighty.
      setSelected(Object.fromEntries(issues.map(i => [i.id, true])));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }, [portalId]);

  const runImport = useCallback(async () => {
    const ids = Object.entries(selected).filter(([, on]) => on).map(([id]) => id);
    if (ids.length === 0) return;

    setImporting(true);
    setImportError('');
    try {
      // Batched so no single request has to finish the whole set. The page
      // holds the list, so there is no stored cursor to go stale.
      let created = 0, updated = 0;
      const failures: string[] = [];
      for (let i = 0; i < ids.length; i += 10) {
        const res = await callApi('backfill', {
          portalId: String(portalId),
          ids: ids.slice(i, i + 10).join(','),
        });
        const parsed = JSON.parse(res.body || '{}');
        if (res.statusCode !== 200) throw new Error(parsed.error || `HTTP ${res.statusCode}`);
        created += parsed.created ?? 0;
        updated += parsed.updated ?? 0;
        if (parsed.errors?.length) failures.push(...parsed.errors);
      }
      setImportResult(
        `Created ${created}, updated ${updated}` + (failures.length ? `, ${failures.length} failed` : '') + '.',
      );
      if (failures.length) setImportError(failures[0]);
      setPreview(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }, [portalId, selected]);

  const selectedCount = Object.values(selected).filter(Boolean).length;

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

      <Heading>Project mapping</Heading>

      {unmapped.length > 0 && (
        <Alert
          title={`${unmapped.length} new project${unmapped.length === 1 ? '' : 's'} with issues assigned to you`}
          variant="warning"
        >
          <Text>
            {unmapped.map(u => u.name).join(', ')}
          </Text>
          <Text>
            These are syncing as Content because nothing says otherwise. Set each one below
            and save — this notice clears once they are mapped.
          </Text>
        </Alert>
      )}
      <Text variant="microcopy">
        What issues in each Linear project become here. Unmapped projects default to
        Content. Choose <strong>Do not import</strong> for projects that are plain work
        rather than something you publish.
      </Text>

      {projects.length === 0 ? (
        <Text variant="microcopy">
          No Linear projects found. Check LINEAR_API_KEY, or this workspace has none.
        </Text>
      ) : (
        projects.slice(0, 60).map(project => (
          <Select
            key={project.id}
            label={project.name}
            name={`project-${project.id}`}
            value={projectMap[project.id] ?? 'content'}
            onChange={value =>
              setProjectMap(prev => ({ ...prev, [project.id]: value as ProjectKind }))
            }
            options={[
              { label: 'Content', value: 'content' },
              { label: 'Changelog', value: 'changelog' },
              { label: 'Do not import', value: 'ignore' },
            ]}
          />
        ))
      )}

      {projects.length > 60 && (
        <Text variant="microcopy">
          Showing the first 60 of {projects.length} projects.
        </Text>
      )}

      <Divider />

      <Heading>Import existing issues</Heading>
      <Text variant="microcopy">
        The webhook only picks up issues as they change, so anything that existed before you
        connected Linear will not appear on its own. Preview first — nothing is written until
        you choose to import. Linear itself is never modified.
      </Text>

      {previewing && <LoadingSpinner label="Reading Linear…" />}

      {importResult && <Alert title={importResult} variant="success" />}

      {importError && (
        <Alert title="Import problem" variant="error">
          <Text>{importError}</Text>
        </Alert>
      )}

      {preview === null ? (
        <Button onClick={() => void runPreview()} disabled={previewing || !canSave}>
          {previewing ? 'Reading…' : 'Preview import'}
        </Button>
      ) : (
        <>
          <Text>
            {preview.length} issue{preview.length === 1 ? '' : 's'} eligible, from{' '}
            {previewMeta.scanned} scanned. {previewMeta.skippedAssignee} skipped by your filter.
          </Text>

          {preview.slice(0, 50).map(issue => (
            <Checkbox
              key={issue.id}
              name={`sel-${issue.id}`}
              checked={!!selected[issue.id]}
              onChange={on => setSelected(prev => ({ ...prev, [issue.id]: !!on }))}
            >
              {`${issue.identifier} · ${issue.kind} · ${issue.state} · ${issue.project ?? 'no project'} · ${issue.title}`}
            </Checkbox>
          ))}

          {preview.length > 50 && (
            <Text variant="microcopy">
              Showing the first 50. All {preview.length} are selected and will import.
            </Text>
          )}

          {importing && <LoadingSpinner label={`Importing ${selectedCount}…`} />}

          <Button
            onClick={() => void runImport()}
            disabled={importing || selectedCount === 0}
            variant="primary"
          >
            {importing ? 'Importing…' : `Import ${selectedCount} issue${selectedCount === 1 ? '' : 's'}`}
          </Button>
          <Button onClick={() => setPreview(null)} disabled={importing} variant="secondary">
            Cancel
          </Button>
        </>
      )}
    </Form>
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
