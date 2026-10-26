'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CampusGame } from '@/lib/campus/game';
import type { GameStatus } from '@/lib/campus/types';
import { bootProgress, describeBootError, markTutorialCompleted, tutorialCompleted, type BootErrorCopy, type BootProgress } from '@/lib/campus/onboarding';
import { GameDialog } from './game/game-dialog';
import { GameMenu } from './game/game-menu';
import { TitleScreen } from './game/title-screen';
import { Tutorial } from './game/tutorial';
const initialPowerSaving = () => typeof window === 'undefined' || new URLSearchParams(window.location.search).get('fps') !== '60';
const storage = () => typeof window === 'undefined' ? null : window.localStorage;
type DialogState = { view: 'tutorial' | 'menu'; returnFocus: HTMLElement | null };
export default function Home() {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<HTMLCanvasElement>(null),
    game = useRef<CampusGame | null>(null);
  const [status, setStatus] = useState<GameStatus>({
      ready: false,
      powerSaving: initialPowerSaving(),
      location: 'Speedway',
      speed: 0,
      fps: 0,
      mode: 'Loading campus',
    }),
    [playing, setPlaying] = useState(false),
    [boot, setBoot] = useState<BootProgress>(() => bootProgress('engine')),
    [failure, setFailure] = useState<BootErrorCopy | null>(null),
    [dialog, setDialog] = useState<DialogState | null>(null),
    [tutorialDone, setTutorialDone] = useState(() => tutorialCompleted(storage));
  // Developer fixed-camera review (`?shot=<id>`): once the city is ready, hide the title and HUD so
  // the shot is unobstructed. Nothing starts playing; a plain URL is unchanged.
  // `?debug=1` shows the FPS readout. Both are read once, lazily, where a window exists.
  const [shotReview] = useState(() =>
    typeof window !== 'undefined' && !!new URLSearchParams(window.location.search).get('shot'));
  const [debug] = useState(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1');
  useEffect(() => {
    let cancelled = false;
    let instance: CampusGame | undefined;
    void import('@/lib/campus/game')
      .then(async ({ CampusGame }) => {
        if (cancelled || !host.current || !map.current) return;
        setPlaying(false);
        setStatus({
          ready: false,
          powerSaving: initialPowerSaving(),
          location: 'Speedway',
          speed: 0,
          fps: 0,
          mode: 'Loading campus',
        });
        setBoot(b => bootProgress('engine-start', b));
        try {
          instance = new CampusGame(host.current, map.current, setStatus,
            stage => { if (!cancelled) setBoot(b => bootProgress(stage, b)); });
          game.current = instance;
          await instance.init();
        } catch (e) {
          if (cancelled) return;
          instance?.dispose();
          console.error(e);
          setFailure(describeBootError(e, 'start'));
        }
      }, e => {
        if (cancelled) return;
        console.error(e);
        setFailure(describeBootError(e, 'import'));
      });
    return () => {
      cancelled = true;
      instance?.dispose();
      if (game.current === instance) game.current = null;
    };
  }, []);
  // A dialog over live play holds the player still; closing it resumes with no held keys.
  const paused = playing && !!dialog;
  useEffect(() => { game.current?.setInputPaused(paused); }, [paused]);
  const gameCanvas = () => host.current?.querySelector('canvas') ?? null;
  // After the commit, so a just-closed modal no longer makes the canvas inert.
  useEffect(() => { if (playing) host.current?.querySelector('canvas')?.focus({ preventScroll: true }); }, [playing]);
  const start = useCallback(() => {
    setDialog(null);
    game.current?.play();
    setPlaying(true);
  }, []);
  const finishTutorial = () => {
    markTutorialCompleted(storage);
    setTutorialDone(true);
    if (!playing && status.ready && !failure) start();
    else setDialog(null);
  };
  // H opens the menu during play (it is not a game key). Escape inside a dialog closes it.
  useEffect(() => {
    if (!playing || dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyH' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (status.traveling || status.mapExpanded) return;
      e.preventDefault();
      setDialog({ view: 'menu', returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : gameCanvas() });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, dialog, status.traveling, status.mapExpanded]);
  const flying = status.locomotion === 'flying' || status.locomotion === 'landing';
  const riding = !!status.locomotion && status.locomotion !== 'foot' && !flying;
  const showTitle = !playing && !(shotReview && status.ready && !failure);
  const hudHidden = !playing || !!dialog;
  const movementLocked = !status.ready || !!status.traveling || !!status.mapExpanded || !!status.overview;
  return (
    <main className="game-shell">
      <div className="game-viewport" ref={host} />
      {/* The HUD (and its map canvas, which the game draws into) stays mounted; it is only hidden. */}
      <div className={`hud${hudHidden ? ' hud-hidden' : ''}`} aria-hidden={hudHidden || undefined}>
        <header className="location">
          <h1>{status.location}</h1>
        </header>
        <div className="compass" aria-label="Compass">
          {status.heading ?? '—'}
        </div>
        <button type="button" className="menu-button" disabled={!playing || status.traveling} aria-haspopup="dialog"
          onClick={e => setDialog({ view: 'menu', returnFocus: e.detail > 0 ? gameCanvas() : e.currentTarget })}>
          <span className="menu-glyph" aria-hidden="true" />Menu<kbd>H</kbd>
        </button>
        <aside className={`map-panel${status.mapExpanded ? ' map-expanded' : ''}`} aria-label="Austin travel map">
          <div className="map-toolbar">
            <span>{status.mapExpanded ? 'Choose where to explore' : <>Map <kbd>M</kbd></>}</span>
            <Button className="map-toggle" variant="ghost" size="sm"
              disabled={!playing || !status.ready || status.traveling}
              aria-expanded={!!status.mapExpanded}
              onClick={() => game.current?.setMapExpanded(!status.mapExpanded)}>
              {status.mapExpanded ? 'Close map' : 'Expand'}
            </Button>
          </div>
          <div className="minimap">
            {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Spatial canvas picker supports arrow keys and Enter as well as point clicks. */}
            <canvas role="button"
              width="220"
              height="220"
              ref={map}
              tabIndex={playing && !dialog ? 0 : -1}
              aria-label="Austin map. Click a spot to travel. Use arrow keys to choose a point and Enter to travel."
            />
            <span className="north">N ↑</span>
          </div>
          {(debug || status.traveling) && <div className="map-caption">
            <span>{status.traveling ? 'Traveling…' : ''}</span>
            {debug && <span>{Math.round(status.fps)} FPS</span>}
          </div>}
          {status.mapExpanded && <p className="map-help">Click anywhere to start nearby · Arrow keys + Enter also work · Esc to close</p>}
        </aside>
        <div className={`context-bar${flying ? ' is-flying' : riding ? ' is-riding' : ''}`}>
          {status.overview ? <span className="context-readout">City overview · <kbd>V</kbd> to return</span>
          : flying ? <>
            <span className="context-readout">{status.locomotion === 'landing' ? 'Landing' : 'Flying'} · {Math.round((status.flightSpeed ?? 0) * 2.23694)} mph · {Math.round(status.flightHeight ?? 0)} m up</span>
            <button className="hud-action" type="button" tabIndex={playing && !dialog ? 0 : -1}
              disabled={movementLocked}
              aria-pressed={status.locomotion === 'flying' && !!status.flightHolding}
              onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); game.current?.beginFlightHold(); }}
              onPointerUp={() => game.current?.endFlightHold('up')}
              onPointerCancel={() => game.current?.endFlightHold('up')}
              onBlur={() => game.current?.endFlightHold('up')}
              onKeyDown={e => { if((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); game.current?.beginFlightHold(); } }}
              onKeyUp={e => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); game.current?.endFlightHold('up'); } }}>
              <kbd>W</kbd> Rise
            </button>
            <button className="hud-action" type="button" tabIndex={playing && !dialog ? 0 : -1}
              disabled={movementLocked}
              aria-pressed={status.locomotion === 'landing'}
              onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); game.current?.beginFlightHold('down'); }}
              onPointerUp={() => game.current?.endFlightHold('down')}
              onPointerCancel={() => game.current?.endFlightHold('down')}
              onBlur={() => game.current?.endFlightHold('down')}
              onKeyDown={e => { if((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); game.current?.beginFlightHold('down'); } }}
              onKeyUp={e => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); game.current?.endFlightHold('down'); } }}>
              <kbd>S</kbd> Land
            </button>
            <span className="context-hint">Release to hover</span>
          </> : <>
            {riding && <span className="context-readout">Scooter · {Math.round((status.scooterSpeed ?? 0) * 2.23694)} mph</span>}
            <button className="hud-action" type="button" tabIndex={playing && !dialog ? 0 : -1}
              disabled={movementLocked}
              aria-pressed={riding}
              onClick={() => game.current?.toggleRide()}>
              <kbd>E</kbd> {riding ? 'Get off' : 'Scooter'}
            </button>
            <button className="hud-action" type="button" tabIndex={playing && !dialog ? 0 : -1}
              disabled={movementLocked}
              aria-pressed={false}
              onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); game.current?.beginFlightHold(); }}
              onPointerUp={() => game.current?.endFlightHold('up')}
              onPointerCancel={() => game.current?.endFlightHold('up')}
              onBlur={() => game.current?.endFlightHold('up')}
              onKeyDown={e => { if((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); game.current?.beginFlightHold(); } }}
              onKeyUp={e => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); game.current?.endFlightHold('up'); } }}>
              <kbd>W</kbd> Hold to fly
            </button>
            {riding && <span className="context-hint"><kbd>↓</kbd>/<kbd>Space</kbd> brake</span>}
          </>}
        </div>
        {status.flightMessage && !status.travelMessage && <output className="travel-notice" aria-live="polite">{status.flightMessage}</output>}
        {status.rideMessage && !status.travelMessage && !status.flightMessage && <output className="travel-notice" aria-live="polite">{status.rideMessage}</output>}
        {status.travelMessage && <output className="travel-notice" aria-live="polite">
          <span>{status.travelMessage}</span>
          {status.traveling && <Button variant="ghost" size="sm" onClick={() => game.current?.cancelTravel()}>Cancel</Button>}
        </output>}
      </div>
      {showTitle && (
        <TitleScreen boot={boot} ready={status.ready} failure={failure} firstVisit={!tutorialDone}
          onStart={start}
          onTutorial={() => setDialog({ view: 'tutorial', returnFocus: null })} />
      )}
      {dialog && (
        <GameDialog view={dialog.view} label={dialog.view === 'menu' ? 'Game menu' : 'How to play'}
          className={dialog.view === 'menu' ? 'is-menu' : 'is-tutorial'}
          returnFocus={dialog.returnFocus}
          onClose={() => setDialog(null)}>
          {dialog.view === 'menu'
            ? <GameMenu powerSaving={!!status.powerSaving}
              onPowerSaving={enabled => game.current?.setPowerSaving(enabled)}
              onResume={() => setDialog(null)}
              onTutorial={() => setDialog({ view: 'tutorial', returnFocus: dialog.returnFocus })} />
            : <Tutorial
              finishLabel={playing ? 'Back to game' : status.ready && !failure ? 'Start exploring' : 'Done'}
              onFinish={finishTutorial}
              onSkip={() => setDialog(null)} />}
        </GameDialog>
      )}
    </main>
  );
}
