## 🎬 YouTube Episode Guide: Three Views, One Page — Adding a Changelog Manager to a HubSpot UI Extension

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to add a new view to an existing multi-view HubSpot UI extensions page app — including routing state, a new component that fetches and groups records by stage, and wiring a navigation button — without touching any existing views."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** The Content Command Center already has a pipeline kanban and a settings screen. We need a third: a Changelog Manager. By the end of this session it's a real routed view — click the Changelog button on the pipeline, see changelog entries grouped by stage with a count badge, hit Back, and you're home. Zero existing functionality changed.

*   **The Architecture (1:00 - 3:00):** `SettingsApp.tsx` is the single file that powers the entire page app. A `View` union type and a `useState` call in the root `App` component decide what renders. Adding a new view is purely additive: extend the union, add a new component, add an `if` branch in `App`, add a button to the entry point. The new `ChangelogManager` component follows the exact same data-fetching pattern as `PipelineBoard` — call `content_data_api`, parse the body, filter by `contentType`, group by stage.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    1. **Open `src/app/pages/SettingsApp.tsx`** — find `type View = 'pipeline' | 'settings'` at the bottom and add `| 'changelog'`. Then find `PipelineBoard`'s prop signature and add `onShowChangelog: () => void`.
    2. **Add the button** — inside `PipelineBoard`'s return, in the header `Flex`, add `<Button onClick={onShowChangelog} variant="secondary" size="sm">📋 Changelog</Button>` next to the existing Settings button.
    3. **Write `ChangelogManager`** — a self-contained function component: `useEffect` calls `hubspot.serverless('content_data_api', ...)`, filters records where `contentType.toLowerCase() === 'changelog'`, stores them in state. The render maps over `CHANGELOG_STAGES`, filters records per stage, shows a `Tag` with the count and a `Divider`, then lists titles.
    4. **Wire `App`** — add `if (view === 'changelog') return <ChangelogManager onBack={() => setView('pipeline')} />;` and pass `onShowChangelog={() => setView('changelog')}` to `PipelineBoard`.

*   **Testing & Wrap-up (8:00 - 10:00):** Run `npm run typecheck:pages` — exit 0 means all three views are type-safe. Deploy to dev with `npm run upload:dev`. In the portal, open the Content Command Center page, click "📋 Changelog", verify four stage sections appear with counts, click "← Back". Summary: three views, one file, one clean union type, zero regressions.

**💻 Screen-Ready Code Snippets:**

```tsx
// 1. Extend the View type
type View = 'pipeline' | 'settings' | 'changelog';

// 2. Add onShowChangelog to PipelineBoard props
function PipelineBoard({
  onShowSettings,
  onShowChangelog,
}: {
  onShowSettings: () => void;
  onShowChangelog: () => void;
}) { ... }

// 3. New Changelog button (inside PipelineBoard header Flex)
<Button onClick={onShowChangelog} variant="secondary" size="sm">
  📋 Changelog
</Button>

// 4. ChangelogManager component
const CHANGELOG_STAGES = ['Identified', 'Drafting', 'Reviewing', 'Published'];

function ChangelogManager({ onBack }: { onBack: () => void }) {
  const [records, setRecords] = useState<ContentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hubspot
      .serverless('content_data_api', { parameters: {} })
      .then((result: { statusCode: number; body: string }) => {
        if (result.statusCode === 200) {
          const data = JSON.parse(result.body) as ContentData;
          setRecords(data.records.filter(r => r.contentType.toLowerCase() === 'changelog'));
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

  if (loading) return <Flex justify="center" align="center"><LoadingSpinner label="Loading changelog..." /></Flex>;

  if (error) return (
    <Flex direction="column" gap="medium">
      <Alert title="Failed to load changelog" variant="error"><Text>{error}</Text></Alert>
      <Button onClick={onBack} variant="secondary">← Back</Button>
    </Flex>
  );

  return (
    <Box>
      <PageTitle>Changelog Manager</PageTitle>
      <Flex justify="between" align="center">
        <Heading>Changelog Manager</Heading>
        <Button onClick={onBack} variant="secondary" size="sm">← Back</Button>
      </Flex>
      <Flex direction="column" gap="medium">
        {CHANGELOG_STAGES.map(stage => {
          const stageRecords = records.filter(r => r.pipelineStage === stage);
          return (
            <Box key={stage}>
              <Flex justify="between" align="center">
                <Text format={{ fontWeight: 'bold' }}>{stage}</Text>
                <Tag variant="default">{String(stageRecords.length)}</Tag>
              </Flex>
              <Divider />
              {stageRecords.length === 0
                ? <Text variant="microcopy">No items</Text>
                : stageRecords.map(r => <Box key={r.id}><Text>{r.title}</Text></Box>)
              }
            </Box>
          );
        })}
      </Flex>
    </Box>
  );
}

// 5. Updated App — adds the changelog branch
function App({ portalId }: { portalId: number }) {
  const [view, setView] = useState<View>('pipeline');
  if (view === 'settings') return <SettingsPage portalId={portalId} onBack={() => setView('pipeline')} />;
  if (view === 'changelog') return <ChangelogManager onBack={() => setView('pipeline')} />;
  return (
    <PipelineBoard
      onShowSettings={() => setView('settings')}
      onShowChangelog={() => setView('changelog')}
    />
  );
}
```
