import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
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

interface Meeting {
  id: string;
  title: string;
  timestamp: string | null;
  relative: string;
  outcome: string | null;
}

interface ContentSummary {
  id: string;
  title: string;
  contentType: string | null;
  pipelineStage: string | null;
  linearIssueUrl: string | null;
  targetDate: string | null;
}

interface IntelligencePayload {
  meetings: Meeting[];
  content: ContentSummary[];
  errors: { meetings: string | null; content: string | null };
}

interface ServerlessResult { statusCode: number; body: string }

/**
 * One section of the card. Each renders from its own slice of the payload so a
 * failure in one source can never blank the other.
 */
function Section({
  title,
  error,
  isEmpty,
  emptyLabel,
  children,
}: {
  title: string;
  error: string | null;
  isEmpty: boolean;
  emptyLabel: string;
  children: ReactNode;
}) {
  return (
    <Flex direction="column" gap="extra-small">
      <Text format={{ fontWeight: 'bold' }}>{title}</Text>
      {error && (
        <Alert title={`${title} unavailable`} variant="error">
          <Text>{error}</Text>
        </Alert>
      )}
      {!error && isEmpty && <Text>{emptyLabel}</Text>}
      {!error && !isEmpty && children}
    </Flex>
  );
}

const Card = ({ context }: { context: { crm: { objectId: string | number } } }) => {
  const [data, setData] = useState<IntelligencePayload | null>(null);
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
        ) => Promise<ServerlessResult>)('meeting_intelligence_api', {
          parameters: { contactId: String(context.crm.objectId) },
        });
        if (!result || result.statusCode === undefined) {
          throw new Error(`Unexpected serverless result: ${JSON.stringify(result)}`);
        }
        const parsed = JSON.parse(result.body) as IntelligencePayload & { error?: string };
        if (result.statusCode !== 200) throw new Error(parsed.error ?? `HTTP ${result.statusCode}`);
        if (!cancelled) setData(parsed);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load meeting intelligence');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context.crm.objectId]);

  if (loading) return <LoadingSpinner label="Loading meeting intelligence" />;
  if (error) {
    return (
      <Alert title="Could not load meeting intelligence" variant="error">
        <Text>{error}</Text>
      </Alert>
    );
  }
  if (!data) return null;

  const meetings = data.meetings ?? [];
  const content = data.content ?? [];

  return (
    <Flex direction="column" gap="medium">
      <Section
        title="Recent meetings"
        error={data.errors?.meetings ?? null}
        isEmpty={meetings.length === 0}
        emptyLabel="No meetings recorded"
      >
        <Flex direction="column" gap="small">
          {meetings.map((meeting: Meeting) => (
            <Flex key={meeting.id} direction="column" gap="extra-small">
              <Flex direction="row" gap="small" align="center">
                <Text format={{ fontWeight: 'demibold' }}>{meeting.title}</Text>
                {meeting.outcome && <Tag>{meeting.outcome}</Tag>}
              </Flex>
              <Text>{meeting.relative}</Text>
            </Flex>
          ))}
        </Flex>
      </Section>

      <Divider />

      <Section
        title="Related content"
        error={data.errors?.content ?? null}
        isEmpty={content.length === 0}
        emptyLabel="No content linked to this contact"
      >
        <Flex direction="column" gap="small">
          {content.map((item: ContentSummary) => {
            const meta = [item.contentType, item.targetDate].filter(Boolean).join(' · ');
            return (
              <Flex key={item.id} direction="column" gap="extra-small">
                {item.linearIssueUrl ? (
                  <Link href={item.linearIssueUrl}>{item.title}</Link>
                ) : (
                  <Text format={{ fontWeight: 'demibold' }}>{item.title}</Text>
                )}
                {meta !== '' && <Text>{meta}</Text>}
              </Flex>
            );
          })}
        </Flex>
      </Section>
    </Flex>
  );
};

hubspot.extend<'crm.record.tab'>(({ context }) => <Card context={context as never} />);
