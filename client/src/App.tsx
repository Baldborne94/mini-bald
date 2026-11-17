import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import { LOCKED_EVENT } from './api/client.ts';
import { useAuthStatus } from './api/hooks.ts';
import { LockScreen } from './features/auth/LockScreen.tsx';
import { Icon, type IconName } from './components/Icon.tsx';
import { Catalog } from './features/catalog/Catalog.tsx';
import { Dashboard } from './features/dashboard/Dashboard.tsx';
import { GroupsPage } from './features/groups/GroupsPage.tsx';
import { MiniatureForm } from './features/miniature/MiniatureForm.tsx';
import { MiniaturePage } from './features/miniature/MiniaturePage.tsx';
import { Celebrations } from './features/motivation/celebrate.tsx';
import { GoalsPage } from './features/motivation/GoalsPage.tsx';
import { PickPage } from './features/motivation/PickPage.tsx';
import { PaintsPage } from './features/paints/PaintsPage.tsx';
import { RecipesPage } from './features/recipes/recipes.tsx';
import { ActiveTimer } from './features/sessions/sessions.tsx';
import { SettingsPage } from './features/settings/SettingsPage.tsx';
import s from './App.module.css';

// The phone tab bar has room for four destinations around the add button;
// the rest sit behind "More" there and are listed in full on the desktop rail.
const NAV: { to: string; label: string; icon: IconName; only?: 'mobile' | 'desktop' }[] = [
  { to: '/', label: 'Bench', icon: 'home' },
  { to: '/minis', label: 'Minis', icon: 'grid' },
  { to: '/paints', label: 'Paints', icon: 'drop' },
  { to: '/goals', label: 'Goals', icon: 'trophy', only: 'desktop' },
  { to: '/recipes', label: 'Recipes', icon: 'book', only: 'desktop' },
  { to: '/groups', label: 'Groups', icon: 'folder', only: 'desktop' },
  { to: '/settings', label: 'Settings', icon: 'gear', only: 'desktop' },
  { to: '/more', label: 'More', icon: 'more', only: 'mobile' },
];

function MorePage() {
  return (
    <div className={s.more}>
      <h1>More</h1>
      {NAV.filter((item) => item.only === 'desktop').map((item) => (
        <NavLink key={item.to} to={item.to} className="card">
          <Icon name={item.icon} size={24} />
          <b>{item.label}</b>
          <Icon name="right" />
        </NavLink>
      ))}
    </div>
  );
}

function Logo() {
  return (
    <NavLink to="/" className={s.logo} aria-label="MiniBald home">
      <svg viewBox="0 0 32 48" width="18" height="27" aria-hidden="true">
        <rect x="11" y="1.5" width="10" height="10" rx="2.5" fill="var(--text)" />
        <path d="M9 13h14v4c3.4 2 5 5.2 5 9.2V41a5.5 5.5 0 0 1-5.5 5.5h-13A5.5 5.5 0 0 1 4 41V26.2c0-4 1.6-7.2 5-9.2z" fill="var(--primary)" />
      </svg>
      <span>
        mini<b>bald</b>
      </span>
    </NavLink>
  );
}

export function App() {
  const qc = useQueryClient();
  const { data: auth } = useAuthStatus();
  // Any request answered with 401 re-checks the lock state, which brings up the PIN screen.
  useEffect(() => {
    const onLocked = () => void qc.invalidateQueries({ queryKey: ['auth'] });
    window.addEventListener(LOCKED_EVENT, onLocked);
    return () => window.removeEventListener(LOCKED_EVENT, onLocked);
  }, [qc]);

  if (!auth) return null;
  if (!auth.unlocked) return <LockScreen />;
  return (
    <div className={s.shell}>
      <aside className={s.rail}>
        <Logo />
        <nav className={s.nav} aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `${s.navLink} ${isActive ? s.navActive : ''} ${item.only === 'mobile' ? s.mobileOnly : ''} ${item.only === 'desktop' ? s.desktopOnly : ''}`}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <NavLink to="/minis/new" className={`btn btn--primary ${s.add}`}>
          <Icon name="plus" />
          <span>Add miniature</span>
        </NavLink>
      </aside>
      <main className={s.main}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/minis" element={<Catalog />} />
          <Route path="/minis/new" element={<MiniatureForm />} />
          <Route path="/minis/:id" element={<MiniaturePage />} />
          <Route path="/minis/:id/edit" element={<MiniatureForm />} />
          <Route path="/paints" element={<PaintsPage />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/pick" element={<PickPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<p className="muted">Nothing on this shelf.</p>} />
        </Routes>
      </main>
      <ActiveTimer />
      <Celebrations />
    </div>
  );
}
