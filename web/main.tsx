import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import { StartupBoundary, StartupScreen } from './startup';
const Home = lazy(() => import('../app/page'));
const Character = lazy(() => import('../app/character/page'));
const page = location.pathname.replace(/\/+$/, '') === '/character' ? <Character /> : <Home />;
createRoot(document.getElementById('root')!).render(
  <StartupBoundary><Suspense fallback={<StartupScreen />}>{page}</Suspense></StartupBoundary>,
);
