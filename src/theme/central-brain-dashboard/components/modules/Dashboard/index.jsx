import { ModuleFields, TextField } from '@hubspot/cms-components/fields';
import { getSecret } from '@hubspot/cms-components';
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

/**
 * Server-side only. `getSecret` throws if called from an island, which is the
 * point: the secret must never reach the browser.
 *
 * This used to call content-data-api and settings-api directly, both of which
 * were public and unauthenticated — and settings-api answers saveSettings and
 * backfill. Both are private now; dashboard-data is the one read-only door,
 * and it demands this secret.
 */
export async function getServerSideProps({ hublData }) {
  const portalId = hublData?.portalId;
  const noData = error => ({
    serverSideProps: { pipeline: null, settings: null, fetchError: error },
    caching: { cacheControl: 'no-cache' },
  });

  if (!portalId) return noData('Could not determine portal ID');

  try {
    const secret = getSecret('DASHBOARD_SHARED_SECRET');
    const url =
      `https://${portalId}.hs-sites.com/hs/serverless/dashboard-data` +
      `?portalId=${encodeURIComponent(portalId)}&secret=${encodeURIComponent(secret)}`;

    const res = await fetch(url);

    // A failed fetch used to fall through as `pipeline: null`, which the page
    // rendered as "0 active records". A wrong number is worse than an error,
    // and that is exactly how a broken endpoint went unnoticed.
    if (!res.ok) return noData(`Dashboard data unavailable (HTTP ${res.status})`);

    const raw = await res.json();
    const data = typeof raw.body === 'string' ? JSON.parse(raw.body) : raw;

    return {
      serverSideProps: {
        pipeline: data.pipeline ?? null,
        settings: data.settings ?? null,
        fetchError: null,
      },
      caching: { cacheControl: 'no-cache' },
    };
  } catch (err) {
    return noData(String(err));
  }
}

export function Component({ serverSideProps, fieldValues }) {
  // getServerSideProps' return lands under `serverSideProps` — it is NOT
  // spread into props. Destructuring pipeline/settings/fetchError at the top
  // level yielded three undefineds, which rendered as "0 active records" with
  // no error, and looked for six weeks like a portal with nothing in it.
  const { pipeline, settings, fetchError } = serverSideProps ?? {};
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
