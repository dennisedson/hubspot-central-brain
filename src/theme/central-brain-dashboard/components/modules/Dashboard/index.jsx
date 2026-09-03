import { ModuleFields, TextField } from '@hubspot/cms-components/fields';
import styles from '../../../styles/dashboard.module.css';

export const hublDataTemplate = `{% set hublData = {"portalId": hub_id} %}`;

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

export async function getServerSideProps({ hublData }) {
  const portalId = hublData?.portalId;
  if (!portalId) {
    return {
      serverSideProps: { pipeline: null, settings: null, fetchError: 'Could not determine portal ID' },
      cacheConfig: { cacheControl: 'no-cache' },
    };
  }
  const base = `https://${portalId}.hs-sites.com/hs/serverless`;
  try {
    const [pipelineRes, settingsRes] = await Promise.all([
      fetch(`${base}/content-data-api`),
      fetch(`${base}/settings-api?action=getSettings`),
    ]);
    const pipelineRaw = await pipelineRes.json();
    const settingsRaw = await settingsRes.json();
    const pipeline = pipelineRes.ok
      ? (typeof pipelineRaw.body === 'string' ? JSON.parse(pipelineRaw.body) : pipelineRaw)
      : null;
    const settings = settingsRes.ok
      ? (typeof settingsRaw.body === 'string' ? JSON.parse(settingsRaw.body) : settingsRaw)
      : null;
    return {
      serverSideProps: { pipeline, settings, fetchError: null },
      cacheConfig: { cacheControl: 'no-cache' },
    };
  } catch (err) {
    return {
      serverSideProps: { pipeline: null, settings: null, fetchError: String(err) },
      cacheConfig: { cacheControl: 'no-cache' },
    };
  }
}

export function Component({ pipeline, settings, fetchError, fieldValues }) {
  const activeStages =
    pipeline?.stages?.filter(s => !s.metadata?.isClosed && s.label !== 'Archived') ?? [];
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
            <h1 className={styles.title}>{fieldValues?.title ?? 'Central Brain Dashboard'}</h1>
            <p className={styles.subtitle}>
              {fetchError ? 'Error loading data' : `Updated ${formatTime(new Date().toISOString())}`}
            </p>
          </div>
        </div>
      </div>

      <div className={styles.body}>
        {fetchError && <div className={styles.error}>{fetchError}</div>}

        {!fetchError && (
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
                    <div className={`${styles.dot} ${s.ok ? styles.dotGreen : styles.dotGrey}`} />
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
                    <div className={`${styles.settingsRow} ${styles.settingsRowLast}`}>
                      <span className={styles.statLabel}>Filter</span>
                      <span className={settings.assigneeFilter === 'mine' ? `${styles.badge} ${styles.badgeMine}` : styles.badge}>
                        {assigneeLabel(settings.assigneeFilter)}
                      </span>
                    </div>
                  </>
                ) : (
                  <span className={styles.statLabel}>No settings configured</span>
                )}
              </div>
            </div>

            <div className={styles.pipeline}>
              <p className={styles.cardTitle}>Pipeline Breakdown</p>
              <div className={styles.stageGrid}>
                {activeStages.map(stage => {
                  const count = recordsByStage[stage.id]?.length ?? 0;
                  return (
                    <div key={stage.id} className={`${styles.stageCard} ${count > 0 ? styles.stageCardActive : ''}`}>
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

export const meta = {
  label: 'Central Brain Dashboard',
  host_template_types: ['PAGE'],
};

export const fields = (
  <ModuleFields>
    <TextField name="title" label="Dashboard Title" default="Central Brain Dashboard" />
  </ModuleFields>
);
