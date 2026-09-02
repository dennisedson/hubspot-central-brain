import { Island } from '@hubspot/cms-components';
import DashboardIsland from '../../islands/DashboardIsland.jsx?island';

export function Component() {
  return <Island module={DashboardIsland} hydrateOn="load" title="Central Brain Dashboard" />;
}

export const meta = {
  label: 'Central Brain Dashboard',
};
