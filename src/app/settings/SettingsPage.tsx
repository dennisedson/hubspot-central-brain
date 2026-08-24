import { useEffect, useState, useCallback } from 'react';
import {
  hubspot,
  Form,
  Input,
  Select,
  Button,
  Alert,
  Heading,
  Text,
  Flex,
  Box,
  LoadingSpinner,
} from '@hubspot/ui-extensions';

interface AppSettings {
  linearTeamId: string;
  assigneeFilter: 'all' | 'assigned' | 'mine';
  linearAssigneeId: string;
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
  const [loading, setLoading] = useState(true);
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
        const data = await res.json() as AppSettings & { error?: string; detail?: string };
        if (res.ok) {
          setSettings(data as AppSettings);
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

  if (status === 'error' && !settings.linearTeamId) {
    return (
      <Alert title="Failed to load settings" variant="error">
        <Text>{errorDetail || 'Check function logs in the developer portal.'}</Text>
      </Alert>
    );
  }

  return (
    <Form>
      <Heading>Linear Sync Settings</Heading>
      <Text>Configure how this portal syncs with Linear.</Text>

      <Box>
        <Input
          label="Linear Team ID"
          name="linearTeamId"
          description="Find in Linear Settings → Teams → click your team → copy the UUID from the URL"
          value={settings.linearTeamId}
          onChange={value => setSettings(s => ({ ...s, linearTeamId: value }))}
        />
      </Box>

      <Box>
        <Select
          label="Which issues should sync to HubSpot?"
          name="assigneeFilter"
          value={settings.assigneeFilter}
          onChange={value =>
            setSettings(s => ({
              ...s,
              assigneeFilter: value as AppSettings['assigneeFilter'],
            }))
          }
          options={[
            { label: 'All issues', value: 'all' },
            { label: 'Assigned issues only', value: 'assigned' },
            { label: 'My issues only', value: 'mine' },
          ]}
        />

        {settings.assigneeFilter === 'mine' && (
          <Input
            label="Your Linear User ID"
            name="linearAssigneeId"
            description="Find in Linear Settings → Profile → copy the UUID from the URL"
            value={settings.linearAssigneeId}
            onChange={value =>
              setSettings(s => ({ ...s, linearAssigneeId: value }))
            }
          />
        )}
      </Box>

      {status === 'success' && <Alert title="Settings saved" variant="success" />}
      {status === 'error' && (
        <Alert title="Failed to save settings" variant="error">
          <Text>{errorDetail || 'Check the function logs for details.'}</Text>
        </Alert>
      )}

      <Button
        onClick={handleSave}
        disabled={saving || !settings.linearTeamId}
        variant="primary"
      >
        {saving ? 'Saving…' : 'Save settings'}
      </Button>
    </Form>
  );
};
