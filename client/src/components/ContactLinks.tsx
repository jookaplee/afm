import type { MouseEvent } from 'react';
import { MessageCircle, Phone } from 'lucide-react';
import { useI18n } from '../lib/i18n.tsx';
import { telLink, waLink } from '../lib/contact.ts';

/** Phone number with WhatsApp and call shortcuts (links open outside the app). */
export function ContactLinks({ phone, compact }: { phone: string | null | undefined; compact?: boolean }) {
  const { t } = useI18n();
  if (!phone) return <span className="muted">—</span>;
  const wa = waLink(phone);
  const tel = telLink(phone);
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <span className="contact-links">
      <span className="num">{phone}</span>
      {wa && (
        <a className="chip wa" href={wa} target="_blank" rel="noopener noreferrer" onClick={stop} title={`${t('action.whatsapp')} ${phone}`} aria-label={`${t('action.whatsapp')} ${phone}`}>
          <MessageCircle aria-hidden />
          {!compact && t('action.whatsapp')}
        </a>
      )}
      {tel && !compact && (
        <a className="chip" href={tel} onClick={stop} title={`${t('action.call')} ${phone}`} aria-label={`${t('action.call')} ${phone}`}>
          <Phone aria-hidden />
        </a>
      )}
    </span>
  );
}
