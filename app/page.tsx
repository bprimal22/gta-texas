'use client';
import { useEffect, useRef, useState } from 'react';
import Link from '@/web/link';
import { Button } from '@/components/ui/button';
import type { CampusGame } from '@/lib/campus/game';
import type { GameStatus } from '@/lib/campus/types';
export default function Home() {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<HTMLCanvasElement>(null),
    game = useRef<CampusGame | null>(null);
  const [status, setStatus] = useState<GameStatus>({
      ready: false,
      location: 'Speedway',
      speed: 0,
      fps: 0,
      mode: 'Loading campus',
    }),
    [playing, setPlaying] = useState(false);
  // Developer fixed-camera review (`?shot=<id>`): hide the intro overlay so the
  // shot is unobstructed. Nothing starts playing; a plain URL is unchanged.
  // Read once, lazily, and only where a window exists (safe for non-browser renders).
  const [shotReview] = useState(() =>
    typeof window !== 'undefined' && !!new URLSearchParams(window.location.search).get('shot'));
  useEffect(() => {
    let cancelled = false;
    let instance: CampusGame | undefined;
    void import('@/lib/campus/game')
      .then(async ({ CampusGame }) => {
        if (cancelled || !host.current || !map.current) return;
        setPlaying(false);
        setStatus({
          ready: false,
          location: 'Speedway',
          speed: 0,
          fps: 0,
          mode: 'Loading campus',
        });
        try {
          instance = new CampusGame(host.current, map.current, setStatus);
          game.current = instance;
          await instance.init();
        } catch (e) {
          if (cancelled) return;
          instance?.dispose();
          console.error(e);
          setStatus((s) => ({ ...s, error: String(e) }));
        }
      })
      .catch(() => {
        if (!cancelled)
          setStatus((s) => ({
            ...s,
            error:
              'The game engine could not load. Reload the page to try again.',
          }));
      });
    return () => {
      cancelled = true;
      instance?.dispose();
      if (game.current === instance) game.current = null;
    };
  }, []);
  const flying = status.locomotion === 'flying' || status.locomotion === 'landing';
  return (
    <main className="game-shell">
      <div className="game-viewport" ref={host} />
      <header className="location">
        <span className="eyebrow">AUSTIN, TEXAS</span>
        <h1>{status.location}</h1>
        <span className="build-tag">Local campus · Offline build</span>
        {playing && <button className="flight-toggle" type="button"
          disabled={!status.ready || status.traveling || status.mapExpanded || status.overview}
          aria-pressed={flying}
          onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); game.current?.beginFlightHold(); }}
          onPointerUp={() => game.current?.endFlightHold('up')}
          onPointerCancel={() => game.current?.endFlightHold('up')}
          onBlur={() => game.current?.endFlightHold('up')}
          onKeyDown={e => { if((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); game.current?.beginFlightHold(); } }}
          onKeyUp={e => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); game.current?.endFlightHold('up'); } }}>
          <kbd>G</kbd> Hold to rise
        </button>}
      </header>
      <div className="compass" aria-label="Compass">
        {status.heading ?? '—'}
      </div>
      {!playing && !shotReview && (
        <div className="entry">
          <p className="eyebrow">THE UNIVERSITY OF TEXAS</p>
          <h2>Explore the Forty Acres.</h2>
          <p>Walk, ride a scooter, or hold G to fly over the local campus.</p>
          <Link href="/character" style={{ color: 'inherit', fontSize: 14 }}>
            View your character
          </Link>
          <Button
            className="enter-button"
            disabled={!status.ready || !!status.error}
            onClick={() => {
              game.current?.play();
              setPlaying(true);
            }}
          >
            {status.error
              ? 'Unable to load campus'
              : status.ready
                ? 'Enter campus'
                : 'Preparing campus…'}
            <span aria-hidden="true">↗</span>
          </Button>
          {status.error && <p className="load-error">{status.error}</p>}
        </div>
      )}
      <aside className={`map-panel${status.mapExpanded ? ' map-expanded' : ''}`} aria-label="Campus travel map">
        <div className="map-toolbar">
          <span>{status.mapExpanded ? 'Choose where to explore' : 'Click to travel'}</span>
          <Button className="map-toggle" variant="ghost" size="sm"
            disabled={!playing || !status.ready || status.traveling}
            aria-expanded={!!status.mapExpanded}
            onClick={() => game.current?.setMapExpanded(!status.mapExpanded)}>
            {status.mapExpanded ? 'Close map' : 'Expand map'}
          </Button>
        </div>
        <div className="minimap">
          {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Spatial canvas picker supports arrow keys and Enter as well as point clicks. */}
          <canvas role="button"
            width="220"
            height="220"
            ref={map}
            tabIndex={playing ? 0 : -1}
            aria-label="Campus map. Click a spot to travel. Use arrow keys to choose a point and Enter to travel."
          />
          <span className="north">N ↑</span>
        </div>
        <div className="map-caption">
          <span>UT AUSTIN</span>
          <span>{status.traveling ? 'Loading…' : `${Math.round(status.fps)} FPS`}</span>
        </div>
        {status.mapExpanded && <p className="map-help">Click anywhere to start nearby · Arrow keys + Enter also work · Esc to close</p>}
      </aside>
      <footer className={`controls${flying ? ' flying-controls' : status.locomotion && status.locomotion !== 'foot' ? ' riding-controls' : ''}`}>
        {flying ? <>
          <span><kbd>W A S D</kbd> Fly</span>
          <span><kbd>SPACE</kbd> Up</span>
          <span><kbd>↓ / C</kbd> Hold to descend</span>
          <span><kbd>SHIFT</kbd> Boost</span>
          <span><kbd>↑ / G</kbd> Hold to rise · release to hover</span>
          <span className="flight-readout">{status.locomotion === 'landing' ? 'Landing' : 'Flight'} · {Math.round((status.flightSpeed ?? 0) * 2.23694)} mph · {Math.round(status.flightHeight ?? 0)} m up</span>
        </> : status.locomotion && status.locomotion !== 'foot' ? <>
          <span><kbd>W</kbd> Ride</span>
          <span><kbd>A / D</kbd> Steer</span>
          <span><kbd>S / SPACE</kbd> Brake</span>
          <span><kbd>F</kbd> Get off</span>
          <span>Scooter · {Math.round((status.scooterSpeed ?? 0)*2.23694)} mph</span>
          <span><kbd>G</kbd> Hold to rise</span>
        </> : <>
          <span><kbd>W A S D</kbd> Walk</span>
          <span><kbd>SHIFT</kbd> Run</span>
          <span><kbd>SPACE</kbd> Jump</span>
          <span><kbd>F</kbd> Scooter</span>
          <span><kbd>G</kbd> Hold to rise</span>
        </>}
        <span>
          <kbd>MOUSE DRAG</kbd> Look
        </span>
        <span>
          <kbd>V</kbd> {status.overview ? 'Return to character' : 'Campus view'}
        </span>
        <span><kbd>M</kbd> Travel map</span>
        <span className="secondary-control">
          Scroll to zoom · Double-click to lock camera · Esc to release
        </span>
      </footer>
      {status.flightMessage && !status.travelMessage && <output className="travel-notice" aria-live="polite">{status.flightMessage}</output>}
      {status.rideMessage && !status.travelMessage && !status.flightMessage && <output className="travel-notice" aria-live="polite">{status.rideMessage}</output>}
      {status.travelMessage && <output className="travel-notice" aria-live="polite">
        <span>{status.travelMessage}</span>
        {status.traveling && <Button variant="ghost" size="sm" onClick={() => game.current?.cancelTravel()}>Cancel</Button>}
      </output>}
      {status.imagery && (
        <div className="imagery-credits offline-credits" aria-label="Campus scenery attribution">
          <span>{status.imagery.credits}</span>
        </div>
      )}
      <a
        className="credits"
        href="/credits.txt"
        target="_blank"
        rel="noreferrer"
      >
        Map & asset credits
      </a>
    </main>
  );
}
