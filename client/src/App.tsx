import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  Building2,
  ChevronRight,
  Cloud,
  CloudOff,
  Columns3,
  Eye,
  Handshake,
  HardDrive,
  Languages,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  Megaphone,
  MessageCircle,
  Monitor,
  Moon,
  RefreshCcw,
  ShoppingBag,
  Sparkles,
  Sun,
  Target,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';
import { useI18n } from './lib/i18n.tsx';
import { errorMessage } from './lib/errors.ts';
import { useConfirm, useMeta, useTheme, useToast } from './lib/app-context.tsx';
import { OWN_THEME, STANDALONE } from './lib/env.ts';
import { api } from './lib/api.ts';
import type { OrderSummary, WaSummary } from '../../shared/types.ts';
import { Loading, Modal } from './components/ui.tsx';
import { useApi } from './lib/useApi.ts';
import { forgetKey, sealedDataset } from './standalone/unlock.ts';
import { agentEngine, useAgent } from './agent/engine.ts';
import { useAgentTyping } from './whatsapp/agent.ts';

// Pages carrying a password-protected prospect list can be locked again.
const PROTECTED = STANDALONE && sealedDataset() !== null;

const OverviewPage = lazy(() => import('./pages/OverviewPage.tsx'));
const SalesPage = lazy(() => import('./pages/SalesPage.tsx'));
const MarketingPage = lazy(() => import('./pages/MarketingPage.tsx'));
const PipelinePage = lazy(() => import('./pages/PipelinePage.tsx'));
const DealsPage = lazy(() => import('./pages/DealsPage.tsx'));
const LeadsPage = lazy(() => import('./pages/LeadsPage.tsx'));
const CampaignsPage = lazy(() => import('./pages/CampaignsPage.tsx'));
const AccountsPage = lazy(() => import('./pages/AccountsPage.tsx'));
const AccountDetailPage = lazy(() => import('./pages/AccountDetailPage.tsx'));
const TeamPage = lazy(() => import('./pages/TeamPage.tsx'));
const AgentPage = lazy(() => import('./pages/AgentPage.tsx'));
const WhatsAppPage = lazy(() => import('./pages/WhatsAppPage.tsx'));
const OrdersPage = lazy(() => import('./pages/OrdersPage.tsx'));

type Icon = ComponentType<{ 'aria-hidden'?: boolean }>;

interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  /** Colour of the icon tile (macOS System Settings style). */
  tile: string;
  /** Items waiting for the user (shown as a count). */
  count?: number;
}

const DASHBOARDS = ['/', '/sales', '/marketing'];

/** Dashboard filters carry over between the three dashboards; data pages start clean. */
function keepFilters(from: string, search: string, to: string): string {
  return DASHBOARDS.includes(from) && DASHBOARDS.includes(to) ? search : '';
}

function NavTile({ icon: I, color }: { icon: Icon; color: string }) {
  return (
    <span className="nav-tile" style={{ background: color }} aria-hidden>
      <I aria-hidden />
    </span>
  );
}

export function App() {
  const { t, lang, setLang } = useI18n();
  const { meta, reload } = useMeta();
  const { mode, cycle } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => setMoreOpen(false), [location.pathname]);
  // The AI agent's autopilot runs while the dashboard is open, whatever the page.
  const agent = useAgent();
  useEffect(() => agentEngine.boot(), []);
  useEffect(() => {
    if (resetKey) agentEngine.touched();
  }, [resetKey]);
  const agentPending = agent.summary?.findings.pending ?? 0;
  // Badges: chats waiting (unread or needing a person) and orders waiting for confirmation.
  // Refreshed on navigation, when the WhatsApp agent finishes, and every 30 seconds.
  const waTyping = useAgentTyping();
  const [badgeTick, setBadgeTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setBadgeTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const badgeKey = `${resetKey}.${location.pathname}.${location.search}.${waTyping.size}.${badgeTick}`;
  const wa = useApi<WaSummary>('/wa/summary', { k: badgeKey });
  const ord = useApi<OrderSummary>('/orders/summary', { k: badgeKey });
  const waUnread = (wa.data?.unread ?? 0) + (wa.data?.needsHuman ?? 0);
  const ordersPending = ord.data?.counts.pending ?? 0;
  useEffect(() => {
    document.title = `${meta.appName} · ${t('app.subtitle')}`;
  }, [meta.appName, t]);

  const dashboards: NavItem[] = [
    { to: '/', label: t('nav.overview'), icon: LayoutDashboard, tile: 'var(--tile-blue)' },
    { to: '/sales', label: t('nav.sales'), icon: TrendingUp, tile: 'var(--tile-green)' },
    { to: '/marketing', label: t('nav.marketing'), icon: Megaphone, tile: 'var(--tile-orange)' },
  ];
  const manage: NavItem[] = [
    { to: '/pipeline', label: t('nav.pipeline'), icon: Columns3, tile: 'var(--tile-indigo)' },
    { to: '/deals', label: t('nav.deals'), icon: Handshake, tile: 'var(--tile-teal)' },
    { to: '/leads', label: t('nav.leads'), icon: UserPlus, tile: 'var(--tile-pink)' },
    { to: '/whatsapp', label: t('nav.whatsapp'), icon: MessageCircle, tile: 'var(--tile-green)', count: waUnread },
    { to: '/orders', label: t('nav.orders'), icon: ShoppingBag, tile: 'var(--tile-orange)', count: ordersPending },
    { to: '/campaigns', label: t('nav.campaigns'), icon: Target, tile: 'var(--tile-purple)' },
    { to: '/accounts', label: t('nav.accounts'), icon: Building2, tile: 'var(--tile-gray)' },
    { to: '/team', label: t('nav.team'), icon: Users, tile: 'var(--tile-blue)' },
    { to: '/agent', label: t('nav.agent'), icon: Sparkles, tile: 'var(--tile-purple)', count: agentPending },
  ];
  const groups = [
    { label: t('nav.dashboards'), items: dashboards },
    { label: t('nav.manage'), items: manage },
  ];
  // Phone tab bar: four destinations + "More" (iOS caps a tab bar at five).
  const tabItems = [...dashboards, manage[0]];
  const moreItems = manage.slice(1);
  const inMore = moreItems.some((it) => location.pathname.startsWith(it.to));

  const resetData = async () => {
    if (!(await confirm({ message: t('confirm.reset'), confirmLabel: t('action.resetData'), danger: true }))) return;
    try {
      await api.post('/admin/reset', {});
      reload();
      setResetKey((k) => k + 1);
      setMoreOpen(false);
      toast(t('toast.resetDone'));
    } catch (e) {
      toast(errorMessage(e, t), 'bad');
    }
  };

  const lockDevice = async () => {
    if (!(await confirm({ message: t('lock.lockConfirm'), confirmLabel: t('lock.lockDevice') }))) return;
    forgetKey();
    window.location.reload();
  };

  const ThemeIcon = mode === 'dark' ? Moon : mode === 'light' ? Sun : Monitor;
  const persistence = useApi<{ mode: 'cloud' | 'device' | 'memory' | 'readonly' }>(STANDALONE ? '/_persistence' : null, { k: resetKey });
  const pmode = persistence.data?.mode;
  const PersistIcon = pmode === 'cloud' ? Cloud : pmode === 'device' ? HardDrive : pmode === 'readonly' ? Eye : CloudOff;
  const persistNote = pmode && (
    <div className="persist-note" title={t(`persist.${pmode}Hint`)} role="status">
      <PersistIcon aria-hidden />
      <span>{t(`persist.${pmode}`)}</span>
    </div>
  );

  return (
    <div className="shell">
      <aside className="sidebar" aria-label={t('nav.aria')}>
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
            <defs>
              <linearGradient id="brand-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#3a95ff" />
                <stop offset="1" stopColor="#0062e0" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="8" fill="url(#brand-grad)" />
            <rect x="7" y="17" width="4" height="8" rx="2" fill="#fff" />
            <rect x="14" y="12" width="4" height="13" rx="2" fill="#fff" />
            <rect x="21" y="7" width="4" height="18" rx="2" fill="#fff" />
          </svg>
          <div>
            <div className="brand-name">{meta.appName}</div>
            <div className="brand-sub">{t('app.subtitle')}</div>
          </div>
        </div>
        <nav>
          {groups.map((g) => (
            <div className="nav-group" key={g.label}>
              <div className="nav-label">{g.label}</div>
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={{ pathname: it.to, search: keepFilters(location.pathname, location.search, it.to) }}
                  end={it.to === '/'}
                  className="nav-link"
                >
                  <NavTile icon={it.icon} color={it.tile} />
                  {it.label}
                  {!!it.count && (
                    <span className="nav-count" aria-label={t('agent.kpi.pending')}>
                      {it.count > 99 ? '99+' : it.count}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          {persistNote}
          <div className="row">
            {OWN_THEME && (
              <button className="btn sm" style={{ flex: 1 }} onClick={cycle} title={t(`theme.${mode}`)}>
                <ThemeIcon aria-hidden />
                {t(`theme.${mode}`)}
              </button>
            )}
            <button className="btn sm" onClick={() => setLang(lang === 'ms' ? 'en' : 'ms')} title={t('lang.switch')} aria-label={t('lang.switch')}>
              <Languages aria-hidden />
              {lang === 'ms' ? 'EN' : 'BM'}
            </button>
          </div>
          <button className="btn sm ghost" onClick={resetData}>
            <RefreshCcw aria-hidden />
            {t('action.resetData')}
          </button>
          {PROTECTED && (
            <button className="btn sm ghost" onClick={lockDevice}>
              <Lock aria-hidden />
              {t('lock.lockDevice')}
            </button>
          )}
        </div>
      </aside>

      <main className="main" key={resetKey}>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/marketing" element={<MarketingPage />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/deals" element={<DealsPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:id" element={<AccountDetailPage />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="/agent" element={<AgentPage />} />
            <Route path="/whatsapp" element={<WhatsAppPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>

      {/* iOS tab bar (phones) */}
      <nav className="tabbar" aria-label={t('nav.aria')}>
        {tabItems.map((it) => (
          <NavLink
            key={it.to}
            to={{ pathname: it.to, search: keepFilters(location.pathname, location.search, it.to) }}
            end={it.to === '/'}
            className="tab-item"
          >
            <it.icon aria-hidden />
            {it.label}
          </NavLink>
        ))}
        <button className={`tab-item ${inMore ? 'active' : ''}`} onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
          <LayoutGrid aria-hidden />
          {t('nav.more')}
        </button>
      </nav>

      {moreOpen && (
        <Modal title={t('nav.more')} onClose={() => setMoreOpen(false)}>
          <div className="sheet-stack">
            <div className="list-group">
              {moreItems.map((it) => (
                <Link key={it.to} to={it.to} className="list-row">
                  <NavTile icon={it.icon} color={it.tile} />
                  {it.label}
                  {!!it.count && <span className="nav-count">{it.count > 99 ? '99+' : it.count}</span>}
                  <ChevronRight className="chev" aria-hidden />
                </Link>
              ))}
            </div>
            <div>
              <div className="list-group">
                {OWN_THEME && (
                  <button className="list-row" onClick={cycle}>
                    <NavTile icon={ThemeIcon} color="var(--tile-indigo)" />
                    {t('theme.label')}
                    <span className="value">{t(`theme.name.${mode}`)}</span>
                  </button>
                )}
                <button className="list-row" onClick={() => setLang(lang === 'ms' ? 'en' : 'ms')}>
                  <NavTile icon={Languages} color="var(--tile-blue)" />
                  {t('lang.label')}
                  <span className="value">{lang === 'ms' ? 'Bahasa Malaysia' : 'English'}</span>
                </button>
                {PROTECTED && (
                  <button className="list-row" onClick={lockDevice}>
                    <NavTile icon={Lock} color="var(--tile-gray)" />
                    {t('lock.lockDevice')}
                  </button>
                )}
                <button className="list-row" onClick={resetData} style={{ color: 'var(--critical-text)' }}>
                  <NavTile icon={RefreshCcw} color="var(--tile-pink)" />
                  {t('action.resetData')}
                </button>
              </div>
              {persistNote && <div className="list-caption">{persistNote}</div>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
