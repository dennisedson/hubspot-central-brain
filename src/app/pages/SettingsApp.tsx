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

interface SettingsResponse extends AppSettings {
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

function PipelineBoard({ onShowSettings }: { onShowSettings: () => void }) {
  const [data, setData] = useState<ContentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    hubspot
      .serverless('content_data_api', { parameters: {} })
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
  const [loading, setLoading] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorDetail, setErrorDetail] = useState<string>('');

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

  const teamOptions = teams.map(t => ({ label: t.name, value: t.id }));
  const memberOptions = teamMembers.map(m => ({ label: m.name, value: m.id }));
  const canSave = !!settings.linearTeamId &&
    (settings.assigneeFilter !== 'mine' || !!settings.linearAssigneeId);

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
    </Form>
  );
}

// --- Root app ---

type View = 'pipeline' | 'settings';

function App({ portalId }: { portalId: number }) {
  const [view, setView] = useState<View>('pipeline');
  if (view === 'settings') {
    return <SettingsPage portalId={portalId} onBack={() => setView('pipeline')} />;
  }
  return <PipelineBoard onShowSettings={() => setView('settings')} />;
}

hubspot.extend<'pages'>(({ context }) => {
  const portalId = (context as { portal: { id: number } }).portal.id;
  return <App portalId={portalId} />;
});
