import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
const Home = lazy(() => import('../app/page'));
const Character = lazy(() => import('../app/character/page'));
const page = location.pathname.replace(/\/+$/, '') === '/character' ? <Character /> : <Home />;
createRoot(document.getElementById('root')!).render(
  <Suspense fallback={<main className="connection-shell"><output>Preparing campus…</output></main>}>{page}</Suspense>,
);
