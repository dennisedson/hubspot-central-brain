import React, { useEffect, useState, useCallback } from 'react';
import {
  hubspot,
  ExtensionPointApiActions,
  SettingsContext,
  Form,
  Input,
  Select,
  Option,
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

interface SettingsExtensionProps {
  context: SettingsContext;
  actions: ExtensionPointApiActions<'settings'>;
}

hubspot.extend<'settings'>(({ context, actions }: SettingsExtensionProps) => (
  <SettingsPage context={context} actions={actions} />
));

const SettingsPage = ({ actions }: SettingsExtensionProps) => {
  const [settings, setSettings] = useState<AppSettings>({
    linearTeamId: '',
    assigneeFilter: 'all',
    linearAssigneeId: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    actions.serverless('app_settings_api', {
      parameters: { method: 'GET' },
    }).then((response: { status: number; body: string }) => {
      if (response.status === 200) {
        setSettings(JSON.parse(response.body));
      }
    }).catch(() => {
      // use defaults on error
    }).finally(() => {
      setLoading(false);
    });
  }, [actions]);

  const handleSave = useCallback(() => {
    setSaving(true);
    setStatus('idle');
    actions.serverless('app_settings_api', {
      parameters: { method: 'POST', settings },
    }).then((response: { status: number; body: string }) => {
      setStatus(response.status === 200 ? 'success' : 'error');
    }).catch(() => {
      setStatus('error');
    }).finally(() => {
      setSaving(false);
    });
  }, [actions, settings]);

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
        <Heading level={3}>Linear Configuration</Heading>
        <Input
          label="Linear Team ID"
          name="linearTeamId"
          description="Your Linear team ID — find it in Linear Settings → Teams → click your team → copy the UUID from the URL"
          value={settings.linearTeamId}
          onChange={value => setSettings(s => ({ ...s, linearTeamId: value }))}
        />
      </Box>

      <Box>
        <Heading level={3}>Issue Filter</Heading>
        <Select
          label="Which issues should sync to HubSpot?"
          name="assigneeFilter"
          value={settings.assigneeFilter}
          onChange={value => setSettings(s => ({ ...s, assigneeFilter: value as AppSettings['assigneeFilter'] }))}
        >
          <Option value="all" label="All issues" />
          <Option value="assigned" label="Assigned issues only" />
          <Option value="mine" label="My issues only" />
        </Select>

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
