import { useEffect, useRef, useState } from 'react';
import Link from '@/web/link';
import { BOOT_PHASES, LOADING_TIPS, type BootErrorCopy, type BootProgress } from '@/lib/campus/onboarding';

/** A boot stage that has not changed for this long gets a "still working" note and a reload option. */
const STALL_MS = 25000;

/** Full-screen start: real boot stages while loading, then Start exploring / How to play. */
export function TitleScreen({ boot, ready, failure, firstVisit, onStart, onTutorial }: {
  boot: BootProgress;
  ready: boolean;
  failure: BootErrorCopy | null;
  firstVisit: boolean;
  onStart: () => void;
  onTutorial: () => void;
}) {
  const [tip, setTip] = useState(0);
  // The stage a stall timer fired for; a newer stage clears the note without another state update.
  const [stalledStage, setStalledStage] = useState<string | null>(null);
  const loading = !ready && !failure;
  const start = useRef<HTMLButtonElement>(null);
  // Offer Enter-to-start once ready, without pulling focus away from anything the player is using.
  useEffect(() => {
    if (ready && (!document.activeElement || document.activeElement === document.body)) start.current?.focus({ preventScroll: true });
  }, [ready]);
  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => setTip(t => (t + 1) % LOADING_TIPS.length), 6500);
    return () => clearInterval(timer);
  }, [loading]);
  useEffect(() => {
    if (!loading) return;
    const stage = boot.stage;
    const timer = setTimeout(() => setStalledStage(stage), STALL_MS);
    return () => clearTimeout(timer);
  }, [loading, boot.stage]);
  const stalled = loading && stalledStage === boot.stage;
  const phase = BOOT_PHASES[Math.min(boot.phaseIndex, BOOT_PHASES.length - 1)];
  const step = Math.min(boot.phaseIndex + 1, BOOT_PHASES.length);
  return (
    <div className={`title-screen${ready ? ' is-ready' : ''}${failure ? ' is-failed' : ''}`}>
      <div className="title-content">
        <p className="title-kicker">AUSTIN · TEXAS</p>
        <h1 className="title-logo">GTA <span>TEXAS</span></h1>
        <p className="title-tagline">From the Forty Acres to Lady Bird Lake. Explore Austin on foot, by scooter, or in flight.</p>

        {failure ? (
          <div className="boot-error" role="alert">
            <h2>{failure.title}</h2>
            <p>{failure.message}</p>
            <button type="button" className="primary-button" onClick={() => window.location.reload()}>Reload and try again</button>
            {failure.detail && <details><summary>Technical details</summary><code>{failure.detail}</code></details>}
          </div>
        ) : (
          <>
            <div className="boot-progress">
              <progress className="sr-only" aria-label="Loading stages" max={BOOT_PHASES.length}
                value={ready ? BOOT_PHASES.length : boot.phaseIndex}
                aria-valuetext={ready ? 'Ready' : `Step ${step} of ${BOOT_PHASES.length}: ${phase.label}`} />
              <div className="boot-bar" aria-hidden="true">
                {BOOT_PHASES.map((p, i) => {
                  const fill = ready ? 1 : Math.max(0, Math.min(1, boot.fraction * BOOT_PHASES.length - i));
                  return <span key={p.id} className={`boot-segment${i === boot.phaseIndex && !ready ? ' is-current' : ''}`}>
                    <span style={{ transform: `scaleX(${fill})` }} />
                  </span>;
                })}
              </div>
              <div className="boot-status">
                <output>{ready ? 'Austin is ready' : phase.label}</output>
                <span className="boot-step">{ready ? '' : `Step ${step} of ${BOOT_PHASES.length}`}</span>
              </div>
              {!ready && <p className="boot-detail">{boot.detail}…</p>}
              {stalled && <p className="boot-stalled">
                Still working on this step. Large areas can take a while on slower devices.{' '}
                <button type="button" className="text-button" onClick={() => window.location.reload()}>Reload</button>
              </p>}
            </div>

            <div className="title-actions">
              <button ref={start} type="button" className="primary-button start-button" disabled={!ready} onClick={onStart}>
                {ready ? 'Start exploring' : 'Loading Austin…'}
              </button>
              <button type="button" className={firstVisit ? 'ghost-button is-recommended' : 'ghost-button'} onClick={onTutorial}>
                How to play
              </button>
            </div>
            {firstVisit
              ? <p className="title-hint">First time here? <strong>How to play</strong> covers the controls in three short steps.</p>
              : <p className="title-hint">Press <kbd>H</kbd> in game for help and settings.</p>}
            {loading && <p className="title-tip" key={tip}><span>Tip</span>{LOADING_TIPS[tip]}</p>}
          </>
        )}
        <Link className="title-link" href="/character">View your character</Link>
      </div>
    </div>
  );
}
