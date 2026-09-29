import { useEffect, useState, useCallback } from 'react';
import {
  hubspot,
  Form,
  Select,
  Button,
  Alert,
  Heading,
  Text,
  Flex,
  LoadingSpinner,
} from '@hubspot/ui-extensions';

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

type ServerlessResult = {
  statusCode: number;
  body: string;
};

async function callApi(action: string, params: Record<string, string> = {}): Promise<{ statusCode: number; body: string }> {
  const result = await (hubspot.serverless as (uid: string, opts: { parameters: Record<string, string> }) => Promise<ServerlessResult>)(
    'app_settings_api',
    { parameters: { action, ...params } },
  );
  if (!result || result.statusCode === undefined) {
    throw new Error(`Unexpected serverless result: ${JSON.stringify(result)}`);
  }
  return result;
}

hubspot.extend<'settings'>(({ context }) => <SettingsPage portalId={context.portal.id} />);

const SettingsPage = ({ portalId }: { portalId: number }) => {
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

  // The import runs a page per request and is driven from here, so closing the
  // tab stops it rather than losing it — the cursor lives on the App Config
  // record and the next run picks up from there.
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importCount, setImportCount] = useState(0);
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
  }, []);

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
      <Alert title="Failed to load settings" variant="error">
        <Text>{errorDetail || 'Check function logs in the developer portal.'}</Text>
      </Alert>
    );
  }

  // "Any team" first, because it is the mode that keeps working when someone
  // adds you to a new team. A team-scoped filter goes quietly stale instead.
  const teamOptions = [
    { label: 'Any team — filter by assignee only', value: '' },
    ...teams.map(t => ({ label: t.name, value: t.id })),
  ];
  const memberOptions = teamMembers.map(m => ({ label: m.name, value: m.id }));

  // Mirrors isConfigured on the server. Either a team bounds the sync, or a
  // named assignee does. Neither means every issue in the workspace, which is
  // what filled a portal with records nobody asked for.
  const canSave = settings.assigneeFilter === 'mine'
    ? !!settings.linearAssigneeId
    : !!settings.linearTeamId;

  const runImport = useCallback(async (reset: boolean) => {
    setImporting(true);
    setImportError('');
    setImportDone(false);

    try {
      let finished = false;
      let first = true;

      // Loop until Linear says there are no more pages. Each call imports a
      // small page and persists its cursor, so a failure here leaves progress
      // intact rather than starting over.
      while (!finished) {
        const res = await callApi('backfill', first && reset ? { reset: 'true' } : {});
        const parsed = JSON.parse(res.body || '{}');
        if (res.statusCode !== 200) throw new Error(parsed.error || `HTTP ${res.statusCode}`);

        setImportCount(parsed.totalImported ?? 0);
        finished = !!parsed.done;
        first = false;
      }
      setImportDone(true);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }, []);

  return (
    <Form>
      <Heading>Linear Sync Settings</Heading>
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

      <Button
        onClick={handleSave}
        disabled={saving || !canSave}
        variant="primary"
      >
        {saving ? 'Saving…' : 'Save settings'}
      </Button>

      <Heading>Import existing issues</Heading>
      <Text variant="microcopy">
        The webhook only picks up issues as they change, so anything tagged before you
        connected Linear will not appear on its own. This imports them once, using the team
        and filter above. It reads from Linear and writes here — nothing in Linear is changed.
      </Text>

      {importing && <LoadingSpinner label={`Imported ${importCount} so far…`} />}

      {importDone && (
        <Alert title={`Imported ${importCount} issue${importCount === 1 ? '' : 's'}`} variant="success">
          <Text>Running it again is safe — existing records are updated, not duplicated.</Text>
        </Alert>
      )}

      {importError && (
        <Alert title="Import stopped" variant="error">
          <Text>{importError}</Text>
          <Text>Progress was saved. Choosing Resume continues from where it stopped.</Text>
        </Alert>
      )}

      <Flex direction="row" gap="small">
        <Button onClick={() => void runImport(false)} disabled={importing || !canSave}>
          {importing ? 'Importing…' : 'Resume import'}
        </Button>
        <Button onClick={() => void runImport(true)} disabled={importing || !canSave}>
          Start over
        </Button>
      </Flex>
    </Form>
  );
};
