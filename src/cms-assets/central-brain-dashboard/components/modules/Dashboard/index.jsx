import { ModuleFields, TextField } from '@hubspot/cms-components/fields';

export function Component({ fieldValues }) {
  const title = fieldValues?.title || 'Central Brain Dashboard';
  return <div>{title}</div>;
}

export const meta = {
  label: 'Central Brain Dashboard',
};

export const fields = (
  <ModuleFields>
    <TextField name="title" label="Dashboard Title" default="Central Brain Dashboard" />
  </ModuleFields>
);
