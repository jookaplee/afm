import { useState } from 'react';
import { CheckCircle2, Circle, Plus } from 'lucide-react';
import type { RepRow } from '../../../shared/types.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { ErrorState, Loading, PageHeader } from '../components/ui.tsx';
import { DataTable, type Column } from '../components/DataTable.tsx';
import { RepFormModal } from '../components/forms.tsx';

export default function TeamPage() {
  const { t, fmt } = useI18n();
  const { data, error, loading, reload } = useApi<RepRow[]>('/reps');
  const [editing, setEditing] = useState<RepRow | 'new' | null>(null);

  const columns: Column<RepRow>[] = [
    {
      key: 'name',
      header: t('field.repName'),
      render: (r) => (
        <div>
          <div className="cell-main">{r.name}</div>
          {r.email && <div className="cell-sub">{r.email}</div>}
        </div>
      ),
      nowrap: true,
    },
    { key: 'role', header: t('field.role'), render: (r) => t(`role.${r.role}`), nowrap: true },
    { key: 'team', header: t('field.team'), render: (r) => (r.team === 'sdr' ? '—' : t(`segment.${r.team}`)), nowrap: true },
    { key: 'quota', header: t('team.quota'), align: 'right', render: (r) => (r.monthly_quota ? fmt.money(r.monthly_quota) : '—'), nowrap: true },
    { key: 'deals', header: t('team.openDeals'), align: 'right', render: (r) => fmt.num(r.open_deals) },
    { key: 'accounts', header: t('team.accounts'), align: 'right', render: (r) => fmt.num(r.accounts) },
    {
      key: 'active',
      header: t('field.status'),
      render: (r) =>
        r.active ? (
          <span className="badge good">
            <CheckCircle2 aria-hidden />
            {t('team.active')}
          </span>
        ) : (
          <span className="badge">
            <Circle aria-hidden />
            {t('team.inactive')}
          </span>
        ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title={t('team.title')}
        subtitle={t('team.subtitle')}
        actions={
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            {t('team.new')}
          </button>
        }
      />
      <section className="card">
        {error && !data ? (
          <ErrorState onRetry={reload} />
        ) : !data ? (
          <Loading />
        ) : (
          <div className={loading ? 'refetching' : undefined} style={{ paddingTop: 6 }}>
            <DataTable columns={columns} rows={data} rowKey={(r) => r.id} onRowClick={(r) => setEditing(r)} />
          </div>
        )}
      </section>
      {editing && (
        <RepFormModal
          rep={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
