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

interface Drift {
  inSync: boolean;
  expectedState: string | null;
  actualState: string;
}

interface LinearStatus {
  identifier: string;
  title: string;
  state: string;
  assignee: string | null;
  updatedAt: string;
  url: string;
  drift: Drift | null;
}

interface AsanaStatus {
  name: string;
  stageGid: string | null;
  assignee: string | null;
  url: string;
  drift: Drift | null;
}

interface StatusPayload {
  linear: LinearStatus | null;
  asana: AsanaStatus | null;
  pipeline: string | null;
  stageLabel: string | null;
  errors: { linear: string | null; asana: string | null };
}

interface ServerlessResult { statusCode: number; body: string }

function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function DriftNotice({ drift, system }: { drift: Drift | null; system: string }) {
  if (!drift || drift.inSync) return null;
  return (
    <Alert title="Out of sync" variant="warning">
      <Text>
        {system} shows {drift.actualState}; this record&apos;s stage expects{' '}
        {drift.expectedState ?? 'an unmapped state'}.
      </Text>
    </Alert>
  );
}

const Card = ({ context }: { context: { crm: { objectId: string | number } } }) => {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The async work lives inside the effect with a cancellation guard so no
  // setState runs synchronously within it, and none runs after unmount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await (hubspot.serverless as unknown as (
          uid: string,
          opts: { parameters: Record<string, string> },
        ) => Promise<ServerlessResult>)('task_status_api', {
          parameters: { objectId: String(context.crm.objectId) },
        });
        if (!result || result.statusCode === undefined) {
          throw new Error(`Unexpected serverless result: ${JSON.stringify(result)}`);
        }
        const parsed = JSON.parse(result.body) as StatusPayload & { error?: string };
        if (result.statusCode !== 200) throw new Error(parsed.error ?? `HTTP ${result.statusCode}`);
        if (!cancelled) setData(parsed);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load status');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context.crm.objectId]);

  if (loading) return <LoadingSpinner label="Loading task status" />;
  if (error) return <Alert title="Could not load status" variant="error"><Text>{error}</Text></Alert>;
  if (!data) return null;

  const nothingLinked = !data.linear && !data.asana && !data.errors.linear && !data.errors.asana;
  if (nothingLinked) {
    return <Text>This record is not linked to a Linear issue or an Asana task.</Text>;
  }

  return (
    <Flex direction="column" gap="medium">
      <Flex direction="column" gap="extra-small">
        <Text format={{ fontWeight: 'bold' }}>Linear</Text>
        {data.errors.linear && (
          <Alert title="Linear unavailable" variant="error"><Text>{data.errors.linear}</Text></Alert>
        )}
        {!data.errors.linear && !data.linear && <Text>Not linked to Linear.</Text>}
        {data.linear && (
          <>
            <Flex direction="row" gap="small" align="center">
              <Link href={data.linear.url}>{data.linear.identifier}</Link>
              <Tag>{data.linear.state}</Tag>
            </Flex>
            <Text>{data.linear.title}</Text>
            <Text format={{ fontWeight: 'demibold' }}>
              {data.linear.assignee ?? 'Unassigned'} · updated {formatWhen(data.linear.updatedAt)}
            </Text>
            <DriftNotice drift={data.linear.drift} system="Linear" />
          </>
        )}
      </Flex>

      <Divider />

      <Flex direction="column" gap="extra-small">
        <Text format={{ fontWeight: 'bold' }}>Asana</Text>
        {data.errors.asana && (
          <Alert title="Asana unavailable" variant="error"><Text>{data.errors.asana}</Text></Alert>
        )}
        {!data.errors.asana && !data.asana && <Text>Not linked to Asana.</Text>}
        {data.asana && (
          <>
            <Link href={data.asana.url}>{data.asana.name}</Link>
            <Text format={{ fontWeight: 'demibold' }}>
              {data.asana.assignee ?? 'Unassigned'}
            </Text>
            <DriftNotice drift={data.asana.drift} system="Asana" />
          </>
        )}
      </Flex>
    </Flex>
  );
};

hubspot.extend<'crm.record.tab'>(({ context }) => <Card context={context as never} />);
