import { useState, useEffect, useCallback } from 'react';
import styles from '../modules/Dashboard/Dashboard.module.css';

function getBase() {
  const portalId = typeof window !== 'undefined' && window.hsVars?.portal_id;
  return portalId ? `https://${portalId}.hs-sites.com/hs/serverless` : null;
}

function formatTime(iso) {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function assigneeLabel(filter) {
  if (filter === 'mine') return 'My issues only';
  if (filter === 'assigned') return 'Assigned issues';
  return 'All issues';
}

function assigneeBadgeClass(filter) {
  if (filter === 'mine') return `${styles.badge} ${styles.mine}`;
  if (filter === 'all') return `${styles.badge} ${styles.all}`;
  return styles.badge;
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
        const data = typeof pipelineJson.body === 'string'
          ? JSON.parse(pipelineJson.body)
          : pipelineJson;
        setPipeline(data);
      }

      if (settingsRes.ok) {
        const data = typeof settingsJson.body === 'string'
          ? JSON.parse(settingsJson.body)
          : settingsJson;
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
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.logo}>🧠</div>
          <div>
            <h1 className={styles.title}>{title}</h1>
            <p className={styles.subtitle}>
              {lastRefresh ? `Updated ${formatTime(lastRefresh)}` : 'Loading…'}
            </p>
          </div>
        </div>
        <button className={styles.refreshBtn} onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      <div className={styles.body}>
        {error && <div className={styles.error}>{error}</div>}

        {loading && !pipeline && (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            Loading dashboard data…
          </div>
        )}

        {!loading && (
          <>
            <div className={styles.grid}>
              <div className={styles.card}>
                <p className={styles.cardTitle}>Content Pipeline</p>
                <div className={styles.bigStat}>{totalActive}</div>
                <div className={styles.bigStatLabel}>active records</div>
              </div>

              <div className={styles.card}>
                <p className={styles.cardTitle}>Sync Health</p>
                {syncStatus.map(s => (
                  <div key={s.label} className={styles.statRow}>
                    <div className={`${styles.dot} ${s.ok ? styles.green : styles.grey}`} />
                    <span className={styles.statLabel}>{s.label}</span>
                    <span className={styles.statValue}>{s.value}</span>
                  </div>
                ))}
              </div>

              <div className={styles.card}>
                <p className={styles.cardTitle}>Linear Settings</p>
                {settings ? (
                  <>
                    <div className={styles.settingsRow}>
                      <span className={styles.statLabel}>Team</span>
                      <span className={styles.statValue}>
                        {settings.teams?.find(t => t.id === settings.linearTeamId)?.name ?? settings.linearTeamId ?? '—'}
                      </span>
                    </div>
                    <div className={styles.settingsRow}>
                      <span className={styles.statLabel}>Filter</span>
                      <span className={assigneeBadgeClass(settings.assigneeFilter)}>
                        {assigneeLabel(settings.assigneeFilter)}
                      </span>
                    </div>
                    {settings.assigneeFilter === 'mine' && settings.linearAssigneeId && (
                      <div className={styles.settingsRow}>
                        <span className={styles.statLabel}>Assignee</span>
                        <span className={styles.statValue}>
                          {settings.teamMembers?.find(m => m.id === settings.linearAssigneeId)?.name ?? '—'}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <span className={styles.statLabel}>—</span>
                )}
              </div>
            </div>

            <div className={styles.pipeline}>
              <p className={styles.cardTitle}>Pipeline Breakdown</p>
              <div className={styles.stageGrid}>
                {activeStages.map(stage => {
                  const count = recordsByStage[stage.id]?.length ?? 0;
                  return (
                    <div key={stage.id} className={`${styles.stageCard} ${count > 0 ? styles.active : ''}`}>
                      <p className={styles.stageName}>{stage.label}</p>
                      <div className={styles.stageCount}>{count}</div>
                    </div>
                  );
                })}
                {activeStages.length === 0 && (
                  <span className={styles.statLabel}>No pipeline data</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
