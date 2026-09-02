import { ModuleFields } from '@hubspot/cms-components/fields';

export function Component({ fieldValues }) {
  const title = fieldValues?.title || 'Central Brain Dashboard';
  return <div>{title}</div>;
}

export const meta = {
  label: 'Central Brain Dashboard',
};

export const fields = <ModuleFields></ModuleFields>;
