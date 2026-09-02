import { useState } from 'react';

export default function DashboardIsland() {
  const [count, setCount] = useState(0);
  return (
    <div style={{ fontFamily: 'sans-serif', padding: '40px', background: '#f7f8fa', minHeight: '100vh' }}>
      <h1 style={{ color: '#ff7a59' }}>🧠 Central Brain Dashboard</h1>
      <p>Island is hydrated. Click count: {count}</p>
      <button
        onClick={() => setCount(c => c + 1)}
        style={{ padding: '8px 16px', background: '#ff7a59', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
      >
        Click me
      </button>
    </div>
  );
}
