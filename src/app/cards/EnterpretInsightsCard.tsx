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

type Sentiment = 'positive' | 'negative' | 'neutral';

interface Quote {
  id: string | null;
  text: string;
  source: string;
  sentiment: Sentiment;
  createdAt: string | null;
  url: string | null;
}

interface SentimentSummary {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  dominant: Sentiment | null;
}

interface InsightsPayload {
  configured: boolean;
  theme: string | null;
  quoteCount: number | null;
  quotes: Quote[];
  sentiment: SentimentSummary | null;
  errors: { enterpret: string | null };
}

interface ServerlessResult { statusCode: number; body: string }

const SENTIMENT_TAG: Record<Sentiment, 'success' | 'warning' | 'default'> = {
  positive: 'success',
  negative: 'warning',
  neutral: 'default',
};

const SENTIMENT_LABEL: Record<Sentiment, string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
};

const DOMINANT_LABEL: Record<Sentiment, string> = {
  positive: 'Mostly positive',
  negative: 'Mostly negative',
  neutral: 'Mostly neutral',
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * The theme + stored count header. Shown in every state that has a theme, so
 * the card says something concrete whether or not Enterpret is connected.
 */
function ThemeHeader({ theme, quoteCount }: { theme: string; quoteCount: number | null }) {
  return (
    <Flex direction="column" gap="extra-small">
      <Text format={{ fontWeight: 'bold' }}>Friction theme</Text>
      <Flex direction="row" gap="small" align="center">
        <Tag variant="warning">{theme}</Tag>
        {quoteCount !== null && <Text>{plural(quoteCount, 'developer quote')}</Text>}
      </Flex>
    </Flex>
  );
}

function SentimentLine({ sentiment }: { sentiment: SentimentSummary }) {
  if (sentiment.total === 0 || !sentiment.dominant) return null;
  const parts = [
    sentiment.negative > 0 ? `${sentiment.negative} negative` : null,
    sentiment.neutral > 0 ? `${sentiment.neutral} neutral` : null,
    sentiment.positive > 0 ? `${sentiment.positive} positive` : null,
  ].filter(Boolean);

  return (
    <Flex direction="row" gap="small" align="center">
      <Tag variant={SENTIMENT_TAG[sentiment.dominant]}>{DOMINANT_LABEL[sentiment.dominant]}</Tag>
      <Text format={{ fontWeight: 'demibold' }}>{parts.join(' · ')}</Text>
    </Flex>
  );
}

function QuoteRow({ quote, showDivider }: { quote: Quote; showDivider: boolean }) {
  const when = formatDate(quote.createdAt);
  const attribution = when ? `${quote.source} · ${when}` : quote.source;

  return (
    <Flex direction="column" gap="extra-small">
      {showDivider && <Divider />}
      <Text format={{ italic: true }}>&ldquo;{quote.text}&rdquo;</Text>
      <Flex direction="row" gap="small" align="center">
        <Tag variant={SENTIMENT_TAG[quote.sentiment]}>{SENTIMENT_LABEL[quote.sentiment]}</Tag>
        {quote.url ? (
          <Link href={quote.url}>{attribution}</Link>
        ) : (
          <Text format={{ fontWeight: 'demibold' }}>{attribution}</Text>
        )}
      </Flex>
    </Flex>
  );
}

const Card = ({ context }: { context: { crm: { objectId: string | number } } }) => {
  const [data, setData] = useState<InsightsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const objectId = String(context.crm.objectId);

  // The async work lives inside the effect with a cancellation guard so no
  // setState runs synchronously within it, and none runs after unmount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await (hubspot.serverless as unknown as (
          uid: string,
          opts: { parameters: Record<string, string> },
        ) => Promise<ServerlessResult>)('enterpret_insights_api', {
          parameters: { objectId },
        });

        if (!result || result.statusCode === undefined) {
          throw new Error(`Unexpected serverless result: ${JSON.stringify(result)}`);
        }
        const parsed = JSON.parse(result.body) as InsightsPayload & { error?: string };
        if (result.statusCode !== 200) throw new Error(parsed.error ?? `HTTP ${result.statusCode}`);
        if (!cancelled) setData(parsed);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load Enterpret insights');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [objectId]);

  if (loading) return <LoadingSpinner label="Loading Enterpret insights" />;
  if (error) {
    return (
      <Alert title="Could not load Enterpret insights" variant="error">
        <Text>{error}</Text>
      </Alert>
    );
  }
  if (!data) return null;

  // State 1 — no theme on the record. A clean empty state, not an error.
  if (!data.theme) {
    return (
      <Flex direction="column" gap="small">
        <Text format={{ fontWeight: 'bold' }}>No friction theme yet</Text>
        <Text>
          Set the Enterpret Theme property on this record to tie it to a developer friction
          theme. The quotes driving that theme will show up here.
        </Text>
      </Flex>
    );
  }

  // State 2 — Enterpret is not connected. This is today's default, and it is a
  // finished state: the stored theme and count still carry real information.
  if (!data.configured) {
    return (
      <Flex direction="column" gap="medium">
        <ThemeHeader theme={data.theme} quoteCount={data.quoteCount} />
        <Divider />
        <Flex direction="column" gap="extra-small">
          <Flex direction="row" gap="small" align="center">
            <Tag>Enterpret not connected</Tag>
          </Flex>
          <Text>
            This theme and its quote count came from Enterpret when the record was created.
            Connect Enterpret to this app and the individual developer quotes behind the theme
            will be listed here, alongside their source and sentiment.
          </Text>
        </Flex>
      </Flex>
    );
  }

  // State 3 — connected. Show the summary and the verbatims.
  return (
    <Flex direction="column" gap="medium">
      <ThemeHeader theme={data.theme} quoteCount={data.quoteCount} />

      {data.errors.enterpret && (
        <Alert title="Enterpret is unavailable right now" variant="warning">
          <Text>
            Showing the theme and count stored on this record. {data.errors.enterpret}
          </Text>
        </Alert>
      )}

      {data.sentiment && <SentimentLine sentiment={data.sentiment} />}

      {!data.errors.enterpret && data.quotes.length === 0 && (
        <Text>Enterpret has no quotes filed under this theme yet.</Text>
      )}

      {data.quotes.map((quote, index) => (
        <QuoteRow key={quote.id ?? `${index}`} quote={quote} showDivider={index > 0} />
      ))}
    </Flex>
  );
};

hubspot.extend<'crm.record.tab'>(({ context }) => <Card context={context as never} />);
