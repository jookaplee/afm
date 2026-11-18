import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  Building2,
  Columns3,
  Handshake,
  Languages,
  LayoutDashboard,
  Megaphone,
  Menu,
  Monitor,
  Moon,
  RefreshCcw,
  Sun,
  Target,
  TrendingUp,
  UserPlus,
} from 'lucide-react';
import { useI18n } from './lib/i18n.tsx';
import { useMeta, useTheme, useToast } from './lib/app-context.tsx';
import { api } from './lib/api.ts';
import { Loading } from './components/ui.tsx';

const OverviewPage = lazy(() => import('./pages/OverviewPage.tsx'));
const SalesPage = lazy(() => import('./pages/SalesPage.tsx'));
const MarketingPage = lazy(() => import('./pages/MarketingPage.tsx'));
const PipelinePage = lazy(() => import('./pages/PipelinePage.tsx'));
const DealsPage = lazy(() => import('./pages/DealsPage.tsx'));
const LeadsPage = lazy(() => import('./pages/LeadsPage.tsx'));
const CampaignsPage = lazy(() => import('./pages/CampaignsPage.tsx'));
const AccountsPage = lazy(() => import('./pages/AccountsPage.tsx'));
const AccountDetailPage = lazy(() => import('./pages/AccountDetailPage.tsx'));

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ 'aria-hidden'?: boolean }>;
}

export function App() {
  const { t, lang, setLang } = useI18n();
  const { meta, reload } = useMeta();
  const { mode, cycle } = useTheme();
  const toast = useToast();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => setNavOpen(false), [location.pathname]);
  useEffect(() => {
    document.title = `${meta.appName} · ${t('app.subtitle')}`;
  }, [meta.appName, t]);

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: t('nav.dashboards'),
      items: [
        { to: '/', label: t('nav.overview'), icon: LayoutDashboard },
        { to: '/sales', label: t('nav.sales'), icon: TrendingUp },
        { to: '/marketing', label: t('nav.marketing'), icon: Megaphone },
      ],
    },
    {
      label: t('nav.manage'),
      items: [
        { to: '/pipeline', label: t('nav.pipeline'), icon: Columns3 },
        { to: '/deals', label: t('nav.deals'), icon: Handshake },
        { to: '/leads', label: t('nav.leads'), icon: UserPlus },
        { to: '/campaigns', label: t('nav.campaigns'), icon: Target },
        { to: '/accounts', label: t('nav.accounts'), icon: Building2 },
      ],
    },
  ];

  const resetData = async () => {
    if (!window.confirm(t('confirm.reset'))) return;
    try {
      await api.post('/admin/reset', {});
      reload();
      setResetKey((k) => k + 1);
      toast(t('toast.resetDone'));
    } catch (e) {
      toast((e as Error).message || t('error.generic'), 'bad');
    }
  };

  const ThemeIcon = mode === 'dark' ? Moon : mode === 'light' ? Sun : Monitor;

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar" aria-label={t('nav.aria')}>
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <rect x="7" y="17" width="4" height="8" rx="1.5" fill="var(--on-accent)" />
            <rect x="14" y="12" width="4" height="13" rx="1.5" fill="var(--on-accent)" />
            <rect x="21" y="7" width="4" height="18" rx="1.5" fill="var(--on-accent)" />
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
                <NavLink key={it.to} to={{ pathname: it.to, search: keepFilters(location.pathname, location.search, it.to) }} end={it.to === '/'} className="nav-link">
                  <it.icon aria-hidden />
                  {it.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="row">
            <button className="btn sm" style={{ flex: 1 }} onClick={cycle} title={t(`theme.${mode}`)}>
              <ThemeIcon aria-hidden />
              {t(`theme.${mode}`)}
            </button>
            <button className="btn sm" onClick={() => setLang(lang === 'ms' ? 'en' : 'ms')} title={t('lang.switch')} aria-label={t('lang.switch')}>
              <Languages aria-hidden />
              {lang === 'ms' ? 'EN' : 'BM'}
            </button>
          </div>
          <button className="btn sm ghost" onClick={resetData}>
            <RefreshCcw aria-hidden />
            {t('action.resetData')}
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden />
      <div>
        <div className="topbar">
          <button className="btn icon" onClick={() => setNavOpen(true)} aria-label={t('nav.menu')}>
            <Menu aria-hidden />
          </button>
          <strong>{meta.appName}</strong>
          <span className="muted">{t('app.subtitle')}</span>
        </div>
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
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

const DASHBOARDS = ['/', '/sales', '/marketing'];

/** Dashboard filters carry over between the three dashboards; data pages start clean. */
function keepFilters(from: string, search: string, to: string): string {
  return DASHBOARDS.includes(from) && DASHBOARDS.includes(to) ? search : '';
}
