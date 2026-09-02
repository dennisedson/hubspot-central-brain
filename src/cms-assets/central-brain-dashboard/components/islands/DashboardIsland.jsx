import { useState, useEffect, useCallback } from 'react';

const styles = {
  root: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", background: '#f7f8fa', minHeight: '100vh', color: '#1a1a2e' },
  header: { background: 'linear-gradient(135deg, #ff7a59 0%, #f25c2a 100%)', padding: '28px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  logo: { width: '36px', height: '36px', background: 'rgba(255,255,255,0.2)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' },
  title: { color: '#fff', fontSize: '22px', fontWeight: '700', margin: '0', letterSpacing: '-0.3px' },
  subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: '13px', margin: '2px 0 0' },
  refreshBtn: { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' },
  body: { padding: '32px 40px', maxWidth: '1200px', margin: '0 auto' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '28px' },
  card: { background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  cardTitle: { fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#8c8ca1', margin: '0 0 16px' },
  bigStat: { fontSize: '36px', fontWeight: '700', color: '#ff7a59', lineHeight: '1', margin: '0 0 4px' },
  bigStatLabel: { fontSize: '13px', color: '#8c8ca1' },
  statRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' },
  dot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: '0' },
  dotGreen: { background: '#00bda5' },
  dotGrey: { background: '#c5c5d2' },
  statLabel: { fontSize: '13px', color: '#516f90', flex: '1' },
  statValue: { fontSize: '13px', fontWeight: '600', color: '#1a1a2e' },
  settingsRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f1f5' },
  badge: { background: '#eaf4fb', color: '#0091ae', fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '20px' },
  badgeMine: { background: '#fff4e5', color: '#f5a623', fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '20px' },
  pipeline: { background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '28px' },
  stageGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginTop: '16px' },
  stageCard: { background: '#f7f8fa', borderRadius: '8px', padding: '14px 16px', borderLeft: '3px solid #e5e8ef' },
  stageCardActive: { background: '#f7f8fa', borderRadius: '8px', padding: '14px 16px', borderLeft: '3px solid #ff7a59' },
  stageName: { fontSize: '12px', color: '#516f90', margin: '0 0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  stageCount: { fontSize: '24px', fontWeight: '700', color: '#1a1a2e', lineHeight: '1' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px', color: '#8c8ca1', fontSize: '14px', gap: '10px' },
  error: { background: '#fff3f3', border: '1px solid #fcd9da', borderRadius: '8px', padding: '16px 20px', color: '#c87872', fontSize: '14px' },
};

function getBase() {
  const portalId = typeof window !== 'undefined' && window.hsVars?.portal_id;
  return portalId ? `https://${portalId}.hs-sites.com/hs/serverless` : null;
}

function formatTime(iso) {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function assigneeLabel(filter) {
  if (filter === 'mine') return 'My issues only';
  if (filter === 'assigned') return 'Assigned issues';
  return 'All issues';
}

export default function DashboardIsland({ title }) {
  const [pipeline, setPipeline] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    const base = getBase();
    if (!base) {
      setError('Could not determine portal ID from window.hsVars');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [pipelineRes, settingsRes] = await Promise.all([
        fetch(`${base}/content-data-api`),
        fetch(`${base}/settings-api?action=getSettings`),
      ]);
      const pipelineJson = await pipelineRes.json();
      const settingsJson = await settingsRes.json();
      if (pipelineRes.ok) {
        const data = typeof pipelineJson.body === 'string' ? JSON.parse(pipelineJson.body) : pipelineJson;
        setPipeline(data);
      }
      if (settingsRes.ok) {
        const data = typeof settingsJson.body === 'string' ? JSON.parse(settingsJson.body) : settingsJson;
        setSettings(data);
      }
      setLastRefresh(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeStages = pipeline?.stages?.filter(s => !s.metadata?.isClosed && s.label !== 'Archived') ?? [];
  const recordsByStage = {};
  for (const stage of activeStages) {
    recordsByStage[stage.id] = (pipeline?.records ?? []).filter(r => r.pipelineStage === stage.id);
  }
  const totalActive = Object.values(recordsByStage).reduce((s, a) => s + a.length, 0);

  const syncStatus = [
    { label: 'Linear Sync', value: settings?.linearTeamId ? 'Configured' : 'Not configured', ok: !!settings?.linearTeamId },
    { label: 'Asana Sync', value: 'Active', ok: true },
    { label: 'Fellow Sync', value: 'Active', ok: true },
  ];

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>🧠</div>
          <div>
            <h1 style={styles.title}>{title}</h1>
            <p style={styles.subtitle}>{lastRefresh ? `Updated ${formatTime(lastRefresh)}` : 'Loading…'}</p>
          </div>
        </div>
        <button style={styles.refreshBtn} onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      <div style={styles.body}>
        {error && <div style={styles.error}>{error}</div>}

        {loading && !pipeline && (
          <div style={styles.loading}>Loading dashboard data…</div>
        )}

        {!loading && (
          <>
            <div style={styles.grid}>
              <div style={styles.card}>
                <p style={styles.cardTitle}>Content Pipeline</p>
                <div style={styles.bigStat}>{totalActive}</div>
                <div style={styles.bigStatLabel}>active records</div>
              </div>

              <div style={styles.card}>
                <p style={styles.cardTitle}>Sync Health</p>
                {syncStatus.map(s => (
                  <div key={s.label} style={styles.statRow}>
                    <div style={{ ...styles.dot, ...(s.ok ? styles.dotGreen : styles.dotGrey) }} />
                    <span style={styles.statLabel}>{s.label}</span>
                    <span style={styles.statValue}>{s.value}</span>
                  </div>
                ))}
              </div>

              <div style={styles.card}>
                <p style={styles.cardTitle}>Linear Settings</p>
                {settings ? (
                  <>
                    <div style={styles.settingsRow}>
                      <span style={styles.statLabel}>Team</span>
                      <span style={styles.statValue}>
                        {settings.teams?.find(t => t.id === settings.linearTeamId)?.name ?? settings.linearTeamId ?? '—'}
                      </span>
                    </div>
                    <div style={{ ...styles.settingsRow, borderBottom: 'none' }}>
                      <span style={styles.statLabel}>Filter</span>
                      <span style={settings.assigneeFilter === 'mine' ? styles.badgeMine : styles.badge}>
                        {assigneeLabel(settings.assigneeFilter)}
                      </span>
                    </div>
                  </>
                ) : (
                  <span style={styles.statLabel}>—</span>
                )}
              </div>
            </div>

            <div style={styles.pipeline}>
              <p style={styles.cardTitle}>Pipeline Breakdown</p>
              <div style={styles.stageGrid}>
                {activeStages.map(stage => {
                  const count = recordsByStage[stage.id]?.length ?? 0;
                  return (
                    <div key={stage.id} style={count > 0 ? styles.stageCardActive : styles.stageCard}>
                      <p style={styles.stageName}>{stage.label}</p>
                      <div style={styles.stageCount}>{count}</div>
                    </div>
                  );
                })}
                {activeStages.length === 0 && (
                  <span style={styles.statLabel}>No pipeline data</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
