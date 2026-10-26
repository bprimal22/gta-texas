import { Component, type ReactNode } from 'react';

/** Tiny eager shell: stays visible while the page chunk arrives, before Three.js loads. */
export function StartupScreen({ failed = false }: { failed?: boolean }) {
  return <main className="startup-shell">
    <div className="startup-content">
      <p className="startup-kicker">AUSTIN · TEXAS</p>
      <h1 className="startup-title">GTA <span>TEXAS</span></h1>
      <p className="startup-status" role={failed ? 'alert' : 'status'}>
        {failed ? 'The game couldn’t start. Check your connection and try again.' : 'Starting the game…'}
      </p>
      {failed && <button className="startup-retry" type="button" onClick={() => window.location.reload()}>Try again</button>}
    </div>
  </main>;
}

export class StartupBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <StartupScreen failed /> : this.props.children; }
}
