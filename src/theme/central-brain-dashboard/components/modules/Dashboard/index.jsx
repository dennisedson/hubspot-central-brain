export function Component() {
  return (
    <div style={{ fontFamily: 'sans-serif', padding: '40px', background: '#f7f8fa', minHeight: '200px' }}>
      <h1 style={{ color: '#ff7a59' }}>Central Brain Dashboard</h1>
      <p>Module is rendering.</p>
    </div>
  );
}

export const meta = {
  label: 'Central Brain Dashboard',
  host_template_types: ['PAGE'],
};
