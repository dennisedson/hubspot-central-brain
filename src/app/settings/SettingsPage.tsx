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

const PORTAL_SETTINGS_URLS: Record<number, string> = {
  51869810: 'https://51869810.hs-sites.com/hs/serverless/settings-api',
  51869787: 'https://51869787.hs-sites.com/hs/serverless/settings-api',
  22047910: 'https://22047910.hs-sites.com/hs/serverless/settings-api',
};

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

  const apiUrl = PORTAL_SETTINGS_URLS[portalId];

  useEffect(() => {
    if (!apiUrl) {
      setErrorDetail(`Portal ${portalId} is not configured`);
      setStatus('error');
      setLoading(false);
      return;
    }

    hubspot
      .fetch(apiUrl, { method: 'GET' })
      .then(async res => {
        const data = await res.json() as SettingsResponse & { error?: string; detail?: string };
        if (res.ok) {
          setSettings({
            linearTeamId: data.linearTeamId,
            assigneeFilter: data.assigneeFilter,
            linearAssigneeId: data.linearAssigneeId,
          });
          setTeams(data.teams ?? []);
          setTeamMembers(data.teamMembers ?? []);
        } else {
          setErrorDetail(`${res.status}: ${data.detail ?? data.error ?? JSON.stringify(data)}`);
          setStatus('error');
        }
      })
      .catch((err: unknown) => {
        setErrorDetail(err instanceof Error ? err.message : 'Failed to load settings');
        setStatus('error');
      })
      .finally(() => setLoading(false));
  }, [apiUrl]);

  const handleTeamChange = useCallback((teamId: string) => {
    setSettings(s => ({ ...s, linearTeamId: teamId, linearAssigneeId: '' }));
    setTeamMembers([]);
    if (!teamId || !apiUrl) return;
    setLoadingMembers(true);
    hubspot
      .fetch(apiUrl, { method: 'POST', body: { action: 'loadTeamMembers', teamId } })
      .then(async res => {
        const data = await res.json() as { teamMembers: LinearOption[] };
        setTeamMembers(data.teamMembers ?? []);
      })
      .catch(() => setTeamMembers([]))
      .finally(() => setLoadingMembers(false));
  }, [apiUrl]);

  const handleSave = useCallback(() => {
    if (!apiUrl) return;
    setSaving(true);
    setStatus('idle');
    hubspot
      .fetch(apiUrl, {
        method: 'POST',
        body: {
          linearTeamId: settings.linearTeamId,
          assigneeFilter: settings.assigneeFilter,
          linearAssigneeId: settings.linearAssigneeId,
        },
      })
      .then(async res => {
        if (res.ok) {
          setStatus('success');
        } else {
          const data = await res.json() as { error?: string; detail?: string };
          setErrorDetail(`${res.status}: ${data.detail ?? data.error ?? ''}`);
          setStatus('error');
        }
      })
      .catch(() => setStatus('error'))
      .finally(() => setSaving(false));
  }, [apiUrl, settings]);

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

  const teamOptions = teams.map(t => ({ label: t.name, value: t.id }));
  const memberOptions = teamMembers.map(m => ({ label: m.name, value: m.id }));

  const canSave = !!settings.linearTeamId &&
    (settings.assigneeFilter !== 'mine' || !!settings.linearAssigneeId);

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
    </Form>
  );
};
