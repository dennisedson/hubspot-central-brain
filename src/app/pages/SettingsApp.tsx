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
import { LinearSettingsForm } from './LinearSettingsForm.tsx';

// --- Shared types ---

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
    return (
      <>
        <PageTitle>Settings</PageTitle>
        <LinearSettingsForm portalId={portalId} onBack={() => setView('pipeline')} />
      </>
    );
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
