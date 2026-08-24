import { useEffect, useState, useCallback } from 'react';
import {
  hubspot,
  ExtensionPointApiActions,
  SettingsContext,
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
  Divider,
} from '@hubspot/ui-extensions';

interface AppSettings {
  linearTeamId: string;
  assigneeFilter: 'all' | 'assigned' | 'mine';
  linearAssigneeId: string;
}

interface FunctionResponse {
  statusCode: number;
  body: string;
}

interface SettingsExtensionProps {
  context: SettingsContext;
  actions: ExtensionPointApiActions<'settings'>;
}

hubspot.extend<'settings'>(({ context, actions }: SettingsExtensionProps) => (
  <SettingsPage context={context} actions={actions} />
));

const SettingsPage = (_props: SettingsExtensionProps) => {
  const [settings, setSettings] = useState<AppSettings>({
    linearTeamId: '',
    assigneeFilter: 'all',
    linearAssigneeId: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    hubspot.serverless('app_settings_api', {
      parameters: { method: 'GET' },
    }).then(result => {
      if (result.status === 'SUCCESS') {
        const res = result.response as FunctionResponse;
        if (res.statusCode === 200) {
          setSettings(JSON.parse(res.body) as AppSettings);
        }
      }
    }).catch(() => {
      // use defaults on error
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  const handleSave = useCallback(() => {
    setSaving(true);
    setStatus('idle');
    hubspot.serverless('app_settings_api', {
      parameters: {
        method: 'POST',
        linearTeamId: settings.linearTeamId,
        assigneeFilter: settings.assigneeFilter,
        linearAssigneeId: settings.linearAssigneeId,
      },
    }).then(result => {
      if (result.status === 'SUCCESS') {
        const res = result.response as FunctionResponse;
        setStatus(res.statusCode === 200 ? 'success' : 'error');
      } else {
        setStatus('error');
      }
    }).catch(() => {
      setStatus('error');
    }).finally(() => {
      setSaving(false);
    });
  }, [settings]);

  if (loading) {
    return (
      <Flex justify="center" align="center">
        <LoadingSpinner label="Loading settings..." />
      </Flex>
    );
  }

  return (
    <Form>
      <Heading>Linear Sync Settings</Heading>
      <Text>Configure how this HubSpot portal syncs with Linear.</Text>

      <Divider />

      <Box>
        <Heading>Linear Configuration</Heading>
        <Input
          label="Linear Team ID"
          name="linearTeamId"
          description="Your Linear team ID — find it in Linear Settings → Teams → click your team → copy the UUID from the URL"
          value={settings.linearTeamId}
          onChange={value => setSettings(s => ({ ...s, linearTeamId: value }))}
        />
      </Box>

      <Box>
        <Heading>Issue Filter</Heading>
        <Select
          label="Which issues should sync to HubSpot?"
          name="assigneeFilter"
          value={settings.assigneeFilter}
          onChange={value => setSettings(s => ({ ...s, assigneeFilter: value as AppSettings['assigneeFilter'] }))}
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
            description="Your Linear user ID — find it in Linear Settings → Profile → copy the UUID from the URL"
            value={settings.linearAssigneeId}
            onChange={value => setSettings(s => ({ ...s, linearAssigneeId: value }))}
          />
        )}
      </Box>

      {status === 'success' && (
        <Alert title="Settings saved" variant="success" />
      )}
      {status === 'error' && (
        <Alert title="Failed to save settings" variant="error">
          <Text>Check the function logs in Sentry for details.</Text>
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
