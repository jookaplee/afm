import { useRef } from 'react';
import type { WaTemplate } from '../../../shared/types.ts';
import { WA_PLACEHOLDERS, type WaSettings } from '../../../shared/whatsapp.ts';
import { api } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useConfirm, useToast } from '../lib/app-context.tsx';
import { Field } from '../components/ui.tsx';
import { FormShell, useForm } from '../components/forms.tsx';

export function WaTemplateModal({ template, onClose, onSaved }: { template?: WaTemplate | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const body = useRef<HTMLTextAreaElement>(null);
  const f = useForm({ name: template?.name ?? '', body: template?.body ?? '' });
  const v = f.values;

  const insert = (key: string) => {
    const el = body.current;
    const token = `{${key}}`;
    const at = el ? el.selectionStart : v.body.length;
    const end = el ? el.selectionEnd : v.body.length;
    f.set('body', v.body.slice(0, at) + token + v.body.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const save = () =>
    f.submit(async () => {
      if (template) await api.patch(`/wa/templates/${template.id}`, { name: v.name, body: v.body });
      else await api.post('/wa/templates', { name: v.name, body: v.body });
      toast(t('wa.templateSaved'));
      onSaved();
      onClose();
    });

  const remove = template
    ? async () => {
        if (!(await confirm({ message: t('wa.deleteTemplate', { name: template.name }), confirmLabel: t('common.delete'), danger: true }))) return;
        await api.del(`/wa/templates/${template.id}`);
        toast(t('wa.templateDeleted'));
        onSaved();
        onClose();
      }
    : undefined;

  return (
    <FormShell title={template ? t('wa.editTemplate') : t('wa.newTemplate')} onClose={onClose} onSubmit={save} busy={f.busy} formError={f.formError} onDelete={remove}>
      <Field label={t('wa.templateName')} error={f.errors.name} htmlFor="wat-name" full>
        <input id="wat-name" className="input" value={v.name} onChange={(e) => f.set('name', e.target.value)} maxLength={60} />
      </Field>
      <Field label={t('wa.templateBody')} error={f.errors.body} htmlFor="wat-body" full>
        <textarea id="wat-body" ref={body} className="input" rows={7} value={v.body} onChange={(e) => f.set('body', e.target.value)} maxLength={1000} />
      </Field>
      <div className="field full">
        <div className="link-list">
          <span className="muted small">{t('wa.placeholders')}</span>
          {WA_PLACEHOLDERS.map((k) => (
            <button key={k} type="button" className="chip" onClick={() => insert(k)} title={t(`wa.ph.${k}`)}>
              {`{${k}}`}
            </button>
          ))}
        </div>
      </div>
    </FormShell>
  );
}

export function WaSettingsModal({ settings, onClose, onSaved }: { settings: WaSettings; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const f = useForm({ myName: settings.myName, company: settings.company });
  const save = () =>
    f.submit(async () => {
      await api.patch('/wa/settings', f.values);
      toast(t('common.saved'));
      onSaved();
      onClose();
    });
  return (
    <FormShell title={t('wa.settingsTitle')} onClose={onClose} onSubmit={save} busy={f.busy} formError={f.formError}>
      <Field label={t('wa.set.myName')} help={t('wa.set.myNameHelp')} htmlFor="was-name">
        <input id="was-name" className="input" value={f.values.myName} onChange={(e) => f.set('myName', e.target.value)} maxLength={80} />
      </Field>
      <Field label={t('wa.set.company')} help={t('wa.set.companyHelp')} htmlFor="was-company">
        <input id="was-company" className="input" value={f.values.company} onChange={(e) => f.set('company', e.target.value)} maxLength={120} />
      </Field>
    </FormShell>
  );
}
