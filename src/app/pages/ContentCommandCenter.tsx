import { useEffect, useState, useCallback } from 'react';
import {
  hubspot,
  Box,
  Flex,
  Heading,
  Text,
  Tag,
  LoadingSpinner,
  Alert,
  Select,
  Button,
  Divider,
} from '@hubspot/ui-extensions';
import { createPageRouter, PageRoutes, PageTitle } from '@hubspot/ui-extensions/pages';

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
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function RecordCard({ record }: { record: ContentRecord }) {
  const typeKey = record.contentType.toLowerCase();
  const tagVariant: TagVariant = CONTENT_TYPE_VARIANT[typeKey] ?? 'default';

  return (
    <Box>
      <Flex direction="column" gap="extra-small">
        {record.contentType && (
          <Tag variant={tagVariant}>{record.contentType}</Tag>
        )}
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
        <Tag variant={records.length > 0 ? 'default' : 'default'}>{String(records.length)}</Tag>
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

function PipelineBoard() {
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
        <Button
          onClick={() => setShowArchived(prev => !prev)}
          variant="transparent"
        >
          {showArchived ? 'Hide Archived' : 'Show Archived'}
        </Button>
      </Flex>

      <Flex direction="row" gap="medium" wrap="wrap">
        {visibleStages.map(stage => (
          <Box key={stage.id}>
            <KanbanColumn
              stage={stage}
              records={recordsByStage[stage.id] ?? []}
            />
          </Box>
        ))}
      </Flex>
    </Box>
  );
}

const PageRouter = createPageRouter(
  <PageRoutes>
    <PageRoutes.IndexRoute component={PipelineBoard} />
  </PageRoutes>
);

hubspot.extend<'pages'>(() => <PageRouter />);
