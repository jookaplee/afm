import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus } from 'lucide-react';
import type { Paged, WaMessageRow, WaTemplate } from '../../../shared/types.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { ErrorState, Loading, Modal, Pager } from '../components/ui.tsx';
import { DataTable, type Column } from '../components/DataTable.tsx';
import { WaTemplateModal } from './WaForms.tsx';

/** Every template, with edit and new. */
export function TemplatesModal({ templates, onClose, onChanged }: { templates: WaTemplate[]; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<WaTemplate | 'new' | null>(null);
  return (
    <>
      <Modal title={t('wa.templatesTitle')} onClose={onClose} width={620}>
        <div className="wa-templates">
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {t('wa.newTemplate')}
            </button>
          </div>
          {templates.map((tpl) => (
            <article key={tpl.id} className="wa-template">
              <header className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <strong>{tpl.name}</strong>
                <button className="btn sm ghost" onClick={() => setEditing(tpl)}>
                  <Pencil aria-hidden />
                  {t('common.edit')}
                </button>
              </header>
              <p className="wa-preview">{tpl.body}</p>
            </article>
          ))}
        </div>
      </Modal>
      {editing && <WaTemplateModal template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={onChanged} />}
    </>
  );
}

const PAGE_SIZE = 20;

/** Every message sent, newest first. */
export function LogModal({ onClose, onOpen }: { onClose: () => void; onOpen: (leadId: number) => void }) {
  const { t, fmt } = useI18n();
  const [page, setPage] = useState(1);
  const log = useApi<Paged<WaMessageRow>>('/wa/messages', { page, pageSize: PAGE_SIZE });
  const cols: Column<WaMessageRow>[] = [
    { key: 'time', header: t('wa.col.time'), render: (m) => fmt.stamp(m.created_at), nowrap: true },
    {
      key: 'lead',
      header: t('wa.col.contact'),
      render: (m) => (
        <div>
          <div className="cell-main">{m.account_id ? <Link to={`/accounts/${m.account_id}`}>{m.company ?? '—'}</Link> : (m.company ?? '—')}</div>
          <div className="cell-sub">
            {m.lead_name} · {m.phone}
          </div>
        </div>
      ),
      nowrap: true,
    },
    { key: 'template', header: t('wa.col.template'), render: (m) => m.template_name ?? '—', nowrap: true },
    { key: 'body', header: t('wa.col.message'), render: (m) => <span className="wa-preview">{m.body}</span> },
  ];
  return (
    <Modal title={t('wa.tab.log')} onClose={onClose} width={860}>
      {log.data ? (
        <>
          <DataTable
            columns={cols}
            rows={log.data.rows}
            rowKey={(m) => m.id}
            empty={t('wa.noMessages')}
            onRowClick={(m) => {
              if (m.lead_id) onOpen(m.lead_id);
            }}
          />
          <Pager page={page} pageSize={PAGE_SIZE} total={log.data.total} onPage={setPage} />
        </>
      ) : log.error ? (
        <ErrorState onRetry={log.reload} />
      ) : (
        <Loading />
      )}
    </Modal>
  );
}
