import { useRef } from 'react';
import type { WaTemplate } from '../../../shared/types.ts';
import { WA_AGENT_MODELS, WA_PLACEHOLDERS, type WaAgentSettings, type WaSettings } from '../../../shared/whatsapp.ts';
import type { WaSummary } from '../../../shared/types.ts';
import { AGENT_MODELS } from '../../../shared/agent.ts';
import { useApi } from '../lib/useApi.ts';
import { Switch } from '../components/ui.tsx';
import { agentWhere } from './agent.ts';
import { api } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useConfirm, useToast } from '../lib/app-context.tsx';
import { Field } from '../components/ui.tsx';
import { EnumSelect, FormShell, useForm } from '../components/forms.tsx';

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

/** The WhatsApp agent: on/off, auto-send (Business API only), model and what it may tell customers. */
export function WaAgentModal({ summary, onClose, onSaved }: { summary: WaSummary; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const settings = useApi<WaAgentSettings>('/wa/agent/settings');
  if (!settings.data) return null;
  return <WaAgentForm summary={summary} initial={settings.data} onClose={onClose} onSaved={onSaved} t={t} />;
}

function WaAgentForm({
  summary,
  initial,
  onClose,
  onSaved,
  t,
}: {
  summary: WaSummary;
  initial: WaAgentSettings;
  onClose: () => void;
  onSaved: () => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const toast = useToast();
  const f = useForm({ enabled: initial.enabled ? '1' : '0', autoSend: initial.autoSend ? '1' : '0', model: initial.model, profile: initial.profile });
  const v = f.values;
  const where = agentWhere(summary);
  const save = () =>
    f.submit(async () => {
      await api.patch('/wa/agent/settings', { enabled: v.enabled === '1', autoSend: v.autoSend === '1', model: v.model, profile: v.profile });
      toast(t('agent.toast.saved'));
      onSaved();
      onClose();
    });
  return (
    <FormShell title={t('wa.agentSettings')} onClose={onClose} onSubmit={save} busy={f.busy} formError={f.formError}>
      <div className="field full">
        <div className={`wa-mode static ${summary.live ? 'live' : ''}`}>
          <span>
            <strong>{summary.live ? t('wa.modeLive') : t('wa.modeAssist')}</strong>
            <span>{summary.live ? t('wa.modeLiveBody') : t('wa.modeAssistBody')}</span>
            <span className="muted small">
              {where === 'server' ? t('wa.agentWhereServer') : where === 'browser' ? t('wa.agentWhereBrowser') : t('wa.agentWhereNone')}
            </span>
          </span>
        </div>
      </div>
      <div className="field full">
        <Switch checked={v.enabled === '1'} onChange={(on) => f.set('enabled', on ? '1' : '0')} label={t('wa.agentEnabled')} />
      </div>
      <div className="field full">
        <Switch checked={v.autoSend === '1'} onChange={(on) => f.set('autoSend', on ? '1' : '0')} label={t('wa.agentAutoSend')} />
        <span className="help">{summary.live ? t('wa.agentAutoSendHelp') : t('wa.agentAutoSendOffline')}</span>
      </div>
      <Field label={t('agent.set.model')} help={t('agent.set.modelHelp')} htmlFor="wag-model" full>
        <EnumSelect id="wag-model" value={v.model} onChange={(x) => f.set('model', x)} options={WA_AGENT_MODELS} render={(x) => AGENT_MODELS.find((m) => m.id === x)?.label ?? x} />
      </Field>
      <Field label={t('wa.agentProfile')} help={t('wa.agentProfileHelp')} htmlFor="wag-profile" full>
        <textarea id="wag-profile" className="input" rows={10} value={v.profile} onChange={(e) => f.set('profile', e.target.value)} maxLength={4000} />
      </Field>
    </FormShell>
  );
}
