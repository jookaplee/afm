import { AlertCircle, CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import type { VerifyStatus } from '../../../shared/types.ts';
import { useI18n } from '../lib/i18n.tsx';

const ICON = { ok: CheckCircle2, changed: AlertCircle, closed: XCircle, not_found: HelpCircle } as const;

/** The AI agent's verdict on an account, as a small icon with a text label for screen readers. */
export function VerifyMark({ status }: { status: VerifyStatus | null }) {
  const { t } = useI18n();
  if (!status) return null;
  const Icon = ICON[status];
  const label = t(`account.verify.${status}`);
  return (
    <span className={`verify-mark ${status}`} title={label}>
      <Icon aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
