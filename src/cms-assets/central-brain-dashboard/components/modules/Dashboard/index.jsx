import { Island } from '@hubspot/cms-components';
import { ModuleFields, TextField } from '@hubspot/cms-components/fields';
import DashboardIsland from '../../islands/DashboardIsland.jsx?island';

export function Component({ fieldValues }) {
  const title = fieldValues?.title || 'Central Brain Dashboard';
  return <Island module={DashboardIsland} hydrateOn="load" title={title} />;
}

export const meta = {
  label: 'Central Brain Dashboard',
};

export const fields = (
  <ModuleFields>
    <TextField name="title" label="Dashboard Title" default="Central Brain Dashboard" />
  </ModuleFields>
);
