import { ModuleFields, TextField } from '@hubspot/cms-components/fields';

export function Component({ fieldValues }) {
  return <div>{fieldValues.footerText}</div>;
}

export const fields = (
  <ModuleFields>
    <TextField label="Footer Text" name="footerText" default="Be Well." />
  </ModuleFields>
);

export const meta = {
  label: 'Central Brain Dashboard',
};
