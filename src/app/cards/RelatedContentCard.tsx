import { useEffect, useState } from 'react';
import {
  hubspot,
  Alert,
  Divider,
  Flex,
  Link,
  LoadingSpinner,
  Tag,
  Text,
} from '@hubspot/ui-extensions';

interface RelatedItem {
  id: string;
  title: string;
  score: number;
  matchedTags: string[];
  matchedTheme: string | null;
  url: string;
}

interface RelatedPayload {
  related: RelatedItem[];
  source: {
    id: string;
    title: string;
    topicTags: string[];
    enterpretTheme: string | null;
  };
  objectType: 'content' | 'video';
  candidatesScanned: number;
  errors: { candidates: string | null };
}

interface ServerlessResult { statusCode: number; body: string }

interface CrmContext {
  objectId: string | number;
  objectTypeId?: string;
}

function MatchReason({ item }: { item: RelatedItem }) {
  const hasTags = item.matchedTags.length > 0;
  if (!hasTags && !item.matchedTheme) return null;

  return (
    <Flex direction="row" gap="extra-small" align="center">
      <Text format={{ fontWeight: 'demibold' }}>Matched on</Text>
      {item.matchedTags.map(tag => (
        <Tag key={tag}>{tag}</Tag>
      ))}
      {item.matchedTheme && <Tag variant="warning">theme: {item.matchedTheme}</Tag>}
    </Flex>
  );
}

const Card = ({ context }: { context: { crm: CrmContext } }) => {
  const [data, setData] = useState<RelatedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const objectId = String(context.crm.objectId);
  const objectTypeId = context.crm.objectTypeId ? String(context.crm.objectTypeId) : '';

  // The async work lives inside the effect with a cancellation guard so no
  // setState runs synchronously within it, and none runs after unmount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const parameters: Record<string, string> = { objectId };
        if (objectTypeId) parameters.objectTypeId = objectTypeId;

        const result = await (hubspot.serverless as unknown as (
          uid: string,
          opts: { parameters: Record<string, string> },
        ) => Promise<ServerlessResult>)('related_content_api', { parameters });

        if (!result || result.statusCode === undefined) {
          throw new Error(`Unexpected serverless result: ${JSON.stringify(result)}`);
        }
        const parsed = JSON.parse(result.body) as RelatedPayload & { error?: string };
        if (result.statusCode !== 200) throw new Error(parsed.error ?? `HTTP ${result.statusCode}`);
        if (!cancelled) setData(parsed);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load related content');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [objectId, objectTypeId]);

  if (loading) return <LoadingSpinner label="Finding related content" />;
  if (error) {
    return (
      <Alert title="Could not load related content" variant="error">
        <Text>{error}</Text>
      </Alert>
    );
  }
  if (!data) return null;

  const hasSourceSignals = data.source.topicTags.length > 0 || !!data.source.enterpretTheme;

  return (
    <Flex direction="column" gap="medium">
      {data.errors.candidates && (
        <Alert title="Search unavailable" variant="error">
          <Text>{data.errors.candidates}</Text>
        </Alert>
      )}

      {!hasSourceSignals && (
        <Text>
          Add topic tags or an Enterpret theme to this record and related content will show up here.
        </Text>
      )}

      {hasSourceSignals && data.related.length === 0 && (
        <Text>
          Nothing else shares these topic tags or theme yet — scanned{' '}
          {data.candidatesScanned} record{data.candidatesScanned === 1 ? '' : 's'}.
        </Text>
      )}

      {data.related.map((item, index) => (
        <Flex key={item.id} direction="column" gap="extra-small">
          {index > 0 && <Divider />}
          <Flex direction="row" gap="small" align="center">
            <Link href={item.url}>{item.title}</Link>
            <Tag variant="success">score {item.score}</Tag>
          </Flex>
          <MatchReason item={item} />
        </Flex>
      ))}
    </Flex>
  );
};

hubspot.extend<'crm.record.tab'>(({ context }) => <Card context={context as never} />);
