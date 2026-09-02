import { useState, useEffect, useCallback } from 'react';
import css from '../../styles/dashboard.module.css';

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
    <div className={css.root}>
      <div className={css.header}>
        <div className={css.headerLeft}>
          <div className={css.logo}>🧠</div>
          <div>
            <h1 className={css.title}>{title}</h1>
            <p className={css.subtitle}>{lastRefresh ? `Updated ${formatTime(lastRefresh)}` : 'Loading…'}</p>
          </div>
        </div>
        <button className={css.refreshBtn} onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      <div className={css.body}>
        {error && <div className={css.error}>{error}</div>}

        {loading && !pipeline && (
          <div className={css.loading}>Loading dashboard data…</div>
        )}

        {!loading && (
          <>
            <div className={css.grid}>
              <div className={css.card}>
                <p className={css.cardTitle}>Content Pipeline</p>
                <div className={css.bigStat}>{totalActive}</div>
                <div className={css.bigStatLabel}>active records</div>
              </div>

              <div className={css.card}>
                <p className={css.cardTitle}>Sync Health</p>
                {syncStatus.map(s => (
                  <div key={s.label} className={css.statRow}>
                    <div className={`${css.dot} ${s.ok ? css.dotGreen : css.dotGrey}`} />
                    <span className={css.statLabel}>{s.label}</span>
                    <span className={css.statValue}>{s.value}</span>
                  </div>
                ))}
              </div>

              <div className={css.card}>
                <p className={css.cardTitle}>Linear Settings</p>
                {settings ? (
                  <>
                    <div className={css.settingsRow}>
                      <span className={css.statLabel}>Team</span>
                      <span className={css.statValue}>
                        {settings.teams?.find(t => t.id === settings.linearTeamId)?.name ?? settings.linearTeamId ?? '—'}
                      </span>
                    </div>
                    <div className={`${css.settingsRow} ${css.settingsRowLast}`}>
                      <span className={css.statLabel}>Filter</span>
                      <span className={settings.assigneeFilter === 'mine' ? `${css.badge} ${css.badgeMine}` : css.badge}>
                        {assigneeLabel(settings.assigneeFilter)}
                      </span>
                    </div>
                  </>
                ) : (
                  <span className={css.statLabel}>—</span>
                )}
              </div>
            </div>

            <div className={css.pipeline}>
              <p className={css.cardTitle}>Pipeline Breakdown</p>
              <div className={css.stageGrid}>
                {activeStages.map(stage => {
                  const count = recordsByStage[stage.id]?.length ?? 0;
                  return (
                    <div key={stage.id} className={`${css.stageCard} ${count > 0 ? css.stageCardActive : ''}`}>
                      <p className={css.stageName}>{stage.label}</p>
                      <div className={css.stageCount}>{count}</div>
                    </div>
                  );
                })}
                {activeStages.length === 0 && (
                  <span className={css.statLabel}>No pipeline data</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
