import { useState } from 'react';
import { api } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useToast } from '../lib/app-context.tsx';
import { Field, Switch } from '../components/ui.tsx';
import { EnumSelect, FormShell, useForm } from '../components/forms.tsx';
import { AGENT_MODELS, type AgentSettings } from '../../../shared/agent.ts';
import { agentEngine, getApiKey, type Runner } from './engine.ts';

const mask = (k: string) => (k.length > 12 ? `${k.slice(0, 7)}…${k.slice(-4)}` : '••••');

export function AgentSettingsModal({ settings, runner, onClose }: { settings: AgentSettings; runner: Runner; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [key, setKey] = useState(getApiKey());
  const [newKey, setNewKey] = useState('');
  const f = useForm({
    model: settings.model,
    perCycle: String(settings.perCycle),
    discoverPerCycle: String(settings.discoverPerCycle),
    intervalMin: String(settings.intervalMin),
    dailyCalls: String(settings.dailyCalls),
    reverifyDays: String(settings.reverifyDays),
    autopilot: settings.autopilot ? '1' : '0',
    autoFillEmpty: settings.autoFillEmpty ? '1' : '0',
  });
  const v = f.values;
  const num = (k: keyof typeof v, id: string, label: string, help?: string) => (
    <Field label={label} help={help} htmlFor={id} error={f.errors[k]}>
      <input id={id} className="input" inputMode="numeric" value={v[k]} onChange={(e) => f.set(k, e.target.value.replace(/[^\d]/g, ''))} />
    </Field>
  );

  const save = () =>
    f.submit(async () => {
      await api.patch('/agent/settings', {
        model: v.model,
        perCycle: Number(v.perCycle),
        discoverPerCycle: Number(v.discoverPerCycle),
        intervalMin: Number(v.intervalMin),
        dailyCalls: Number(v.dailyCalls),
        reverifyDays: Number(v.reverifyDays),
        autopilot: v.autopilot === '1',
        autoFillEmpty: v.autoFillEmpty === '1',
      });
      if (newKey.trim()) agentEngine.setApiKey(newKey);
      else agentEngine.unblock();
      agentEngine.touched();
      toast(t('agent.toast.saved'));
      onClose();
    });

  return (
    <FormShell title={t('agent.settingsTitle')} onClose={onClose} onSubmit={save} busy={f.busy} formError={f.formError}>
      <Field label={t('agent.set.model')} help={t('agent.set.modelHelp')} htmlFor="ag-model" full>
        <EnumSelect id="ag-model" value={v.model} onChange={(x) => f.set('model', x)} options={AGENT_MODELS.map((m) => m.id)} render={(x) => AGENT_MODELS.find((m) => m.id === x)?.label ?? x} />
      </Field>
      {num('perCycle', 'ag-per', t('agent.set.perCycle'))}
      {num('discoverPerCycle', 'ag-disc', t('agent.set.discover'), t('agent.set.discoverHelp'))}
      {num('intervalMin', 'ag-int', t('agent.set.interval'))}
      {num('dailyCalls', 'ag-daily', t('agent.set.daily'), t('agent.set.dailyHelp'))}
      {num('reverifyDays', 'ag-reverify', t('agent.set.reverify'))}
      <div className="field full">
        <Switch checked={v.autopilot === '1'} onChange={(on) => f.set('autopilot', on ? '1' : '0')} label={t('agent.set.autopilot')} />
      </div>
      <div className="field full">
        <Switch checked={v.autoFillEmpty === '1'} onChange={(on) => f.set('autoFillEmpty', on ? '1' : '0')} label={t('agent.set.autoFill')} />
      </div>
      {runner === 'browser' && (
        <Field label={t('agent.set.key')} help={key ? t('agent.set.keySaved', { masked: mask(key) }) : t('agent.setup.privacy')} htmlFor="ag-key" full>
          <div className="row" style={{ gap: 8 }}>
            <input
              id="ag-key"
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={key ? t('agent.set.keyNew') : 'sk-ant-…'}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
            {key && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  agentEngine.setApiKey(null);
                  setKey('');
                }}
              >
                {t('agent.set.keyRemove')}
              </button>
            )}
          </div>
        </Field>
      )}
    </FormShell>
  );
}
