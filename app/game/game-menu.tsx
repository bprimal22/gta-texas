import Link from '@/web/link';

/** In-game pause menu: resume, how to play, settings and credits (kept off the HUD). */
export function GameMenu({ powerSaving, onPowerSaving, onResume, onTutorial }: {
  powerSaving: boolean;
  onPowerSaving: (enabled: boolean) => void;
  onResume: () => void;
  onTutorial: () => void;
}) {
  return (
    <div className="game-menu">
      <header className="dialog-head">
        <p className="dialog-kicker">GTA Texas</p>
        <h2>Paused</h2>
      </header>
      <div className="menu-actions">
        <button type="button" className="primary-button" data-autofocus onClick={onResume}>Resume</button>
        <button type="button" className="ghost-button" onClick={onTutorial}>How to play</button>
      </div>
      <section className="menu-section" aria-labelledby="menu-settings">
        <h3 id="menu-settings">Settings</h3>
        <button type="button" role="switch" aria-checked={powerSaving} className="setting-switch"
          aria-label="Power saver" aria-describedby="menu-power-detail"
          onClick={() => onPowerSaving(!powerSaving)}>
          <span>
            <strong>Power saver</strong>
            <small id="menu-power-detail">{powerSaving ? 'On · 30 FPS, same image quality' : 'Off · up to 60 FPS'}</small>
          </span>
          <span className="switch-track" aria-hidden="true"><span /></span>
        </button>
      </section>
      <section className="menu-section" aria-labelledby="menu-keys">
        <h3 id="menu-keys">Shortcuts</h3>
        <ul className="menu-shortcuts">
          <li><kbd>M</kbd> Map &amp; travel</li>
          <li><kbd>V</kbd> City overview</li>
          <li><kbd>H</kbd> This menu</li>
          <li><kbd>Esc</kbd> Release mouse</li>
        </ul>
      </section>
      <footer className="menu-links">
        <Link href="/character">View your character</Link>
        <a href="/credits.txt" target="_blank" rel="noreferrer">Map &amp; asset credits</a>
      </footer>
    </div>
  );
}
