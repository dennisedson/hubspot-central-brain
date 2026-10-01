import { useEffect, useState, useCallback } from 'react';
import {
  hubspot,
  Alert,
  Box,
  Button,
  Divider,
  Flex,
  Heading,
  Input,
  LoadingSpinner,
  Select,
  Tag,
  Text,
  TextArea,
} from '@hubspot/ui-extensions';

/**
 * Drafting a changelog on the record, conversationally.
 *
 * The source material is already here: `notes` carries the Linear issue
 * description, which for rollout issues is a structured template. Across the 70
 * changelog records on production it holds Rollout ID, Name and State on 99%
 * and an extractable description on 99% — so this card is a transformation of
 * known fields, not a blank page.
 *
 * It is also why the draft saves to `changelog_draft` and never back into
 * `notes`: the next webhook rewrites notes from Linear and would destroy it.
 *
 * The conversation lives in component state and is gone when the panel closes.
 * That is deliberate. The thread is a working session; the draft is the
 * artefact, and the draft is what persists.
 */

type ServerlessResult = { statusCode: number; body: string };

async function callApi(params: Record<string, string>): Promise<ServerlessResult> {
  const result = await (hubspot.serverless as (
    uid: string, opts: { parameters: Record<string, string> },
  ) => Promise<ServerlessResult>)('changelog_draft_api', { parameters: params });
  if (!result || result.statusCode === undefined) {
    throw new Error(`Unexpected serverless result: ${JSON.stringify(result)}`);
  }
  return result;
}

type Mode = 'standalone' | 'rollup';

interface SourceResponse {
  title: string;
  fields: Record<string, string>;
  description: string;
  missingForStandalone: string[];
  draft: string;
  draftMode: string;
  isChangelog: boolean;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

function SourceFields({ fields, description }: { fields: Record<string, string>; description: string }) {
  const entries = Object.entries(fields);
  if (entries.length === 0 && !description) {
    return <Text variant="microcopy">No rollout template found in this record&apos;s notes.</Text>;
  }
  return (
    <Box>
      {entries.map(([key, value]) => (
        <Flex key={key} gap="small">
          <Text format={{ fontWeight: 'bold' }}>{key}:</Text>
          <Text>{value}</Text>
        </Flex>
      ))}
      {description && (
        <Box>
          <Text format={{ fontWeight: 'bold' }}>Description</Text>
          <Text>{description}</Text>
        </Box>
      )}
    </Box>
  );
}

function Conversation({ turns, busy }: { turns: Turn[]; busy: boolean }) {
  if (turns.length === 0 && !busy) return null;
  return (
    <Box>
      {turns.map((turn, i) => (
        <Box key={`${turn.role}-${i}`}>
          <Tag variant={turn.role === 'user' ? 'default' : 'info'}>
            {turn.role === 'user' ? 'You' : 'Assistant'}
          </Tag>
          <Text>{turn.content}</Text>
          <Divider />
        </Box>
      ))}
      {busy && <LoadingSpinner label="Thinking…" />}
    </Box>
  );
}

function ChangelogDraftCard({ objectId, portalId }: { objectId: string; portalId: string }) {
  const [source, setSource] = useState<SourceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>('standalone');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState('');
  const [savedDraft, setSavedDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    callApi({ action: 'source', objectId, portalId })
      .then(res => {
        if (res.statusCode !== 200) {
          const data = JSON.parse(res.body) as { error?: string; detail?: string };
          setError(data.detail ?? data.error ?? 'Could not read this record');
          return;
        }
        const data = JSON.parse(res.body) as SourceResponse;
        setSource(data);
        setDraft(data.draft);
        setSavedDraft(data.draft);
        if (data.draftMode === 'rollup' || data.draftMode === 'standalone') setMode(data.draftMode);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not read this record'))
      .finally(() => setLoading(false));
  }, [objectId, portalId]);

  const send = useCallback((text: string) => {
    if (!text.trim() || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setMessage('');
    setBusy(true);
    setError(null);

    callApi({
      action: 'turn',
      objectId,
      portalId,
      mode,
      message: text,
      // History minus the turn just added — the server appends it itself.
      conversation: JSON.stringify(turns),
    })
      .then(res => {
        if (res.statusCode !== 200) {
          const data = JSON.parse(res.body) as { error?: string; detail?: string };
          setError(data.detail ?? data.error ?? 'Drafting failed');
          return;
        }
        const { reply } = JSON.parse(res.body) as { reply: string };
        setTurns(prev => [...prev, { role: 'assistant', content: reply }]);
        // The reply is offered, never forced into the editor: anything already
        // edited by hand stays put until it is deliberately replaced.
        if (!draft.trim()) setDraft(reply);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Drafting failed'))
      .finally(() => setBusy(false));
  }, [busy, turns, objectId, portalId, mode, draft]);

  const save = useCallback(() => {
    setSaving(true);
    setSaved(false);
    setError(null);
    callApi({ action: 'save', objectId, portalId, mode, draft })
      .then(res => {
        if (res.statusCode !== 200) {
          const data = JSON.parse(res.body) as { error?: string; detail?: string };
          setError(data.detail ?? data.error ?? 'Could not save');
          return;
        }
        setSavedDraft(draft);
        setSaved(true);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not save'))
      .finally(() => setSaving(false));
  }, [objectId, portalId, mode, draft]);

  if (loading) return <LoadingSpinner label="Loading changelog source…" />;

  if (error && !source) {
    return (
      <Alert title="Changelog drafting unavailable" variant="error">
        <Text>{error}</Text>
      </Alert>
    );
  }

  if (source && !source.isChangelog) {
    return (
      <Text variant="microcopy">
        This record is not on the changelog pipeline, so there is nothing to draft here.
      </Text>
    );
  }

  const missing = source?.missingForStandalone ?? [];
  const thinForStandalone = mode === 'standalone' && missing.length > 0;
  const unsaved = draft !== savedDraft;

  return (
    <Box>
      <Select
        label="Draft as"
        name="mode"
        value={mode}
        onChange={value => { setMode(value as Mode); setSaved(false); }}
        options={[
          { label: 'Standalone post', value: 'standalone' },
          { label: 'Rollup entry (digest)', value: 'rollup' },
        ]}
      />

      {thinForStandalone && (
        <Alert title="This record is thin for a standalone post" variant="warning">
          <Text>
            Missing: {missing.join(', ')}. A standalone post leans on these, so expect
            to fill gaps by hand — or draft it as a rollup entry instead.
          </Text>
        </Alert>
      )}

      <Divider />
      <Heading>Source</Heading>
      <SourceFields fields={source?.fields ?? {}} description={source?.description ?? ''} />

      <Divider />
      <Heading>Draft with the assistant</Heading>
      <Conversation turns={turns} busy={busy} />

      {error && (
        <Alert title="Something went wrong" variant="error">
          <Text>{error}</Text>
        </Alert>
      )}

      <Input
        label="Ask for a draft, or ask for a change"
        name="message"
        value={message}
        placeholder={turns.length === 0 ? 'Draft this changelog' : 'Shorter, and mention the CLI command'}
        onChange={value => setMessage(String(value ?? ''))}
      />
      <Flex gap="small">
        <Button variant="primary" disabled={busy || !message.trim()} onClick={() => send(message)}>
          {busy ? 'Working…' : 'Send'}
        </Button>
        {turns.length === 0 && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => send(mode === 'rollup'
              ? 'Draft this as a digest entry.'
              : 'Draft this as a standalone changelog post.')}
          >
            Draft it for me
          </Button>
        )}
        {turns.length > 0 && (
          <Button variant="transparent" disabled={busy} onClick={() => setTurns([])}>
            Clear conversation
          </Button>
        )}
      </Flex>

      <Divider />
      <Flex justify="between" align="center">
        <Heading>Draft</Heading>
        {unsaved && <Tag variant="warning">Unsaved changes</Tag>}
      </Flex>
      <TextArea
        label=""
        name="draft"
        value={draft}
        rows={14}
        placeholder="Nothing yet — ask the assistant, or write it yourself."
        onChange={value => { setDraft(String(value ?? '')); setSaved(false); }}
      />
      {saved && !unsaved && <Alert title="Draft saved" variant="success" />}
      <Button variant="primary" disabled={saving || !unsaved} onClick={save}>
        {saving ? 'Saving…' : 'Save draft'}
      </Button>
    </Box>
  );
}

hubspot.extend<'crm.record.tab'>(({ context }) => {
  // portalId is passed explicitly on every call: context.accountId is absent
  // inside hubspot.serverless() invocations, which is what made VideoCard
  // return 500 twice before the param() fallback existed.
  const ctx = context as { crm: { objectId: string | number }; portal: { id: number } };
  return (
    <ChangelogDraftCard
      objectId={String(ctx.crm.objectId)}
      portalId={String(ctx.portal.id)}
    />
  );
});
