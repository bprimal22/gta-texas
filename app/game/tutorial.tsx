import { useState } from 'react';
import { TUTORIAL_STEPS } from '@/lib/campus/onboarding';

/** Three short how-to-play cards. Skippable at any point; finishing records completion (via onFinish). */
export function Tutorial({ finishLabel, onFinish, onSkip }: {
  finishLabel: string;
  onFinish: () => void;
  onSkip: () => void;
}) {
  const [index, setIndex] = useState(0);
  const step = TUTORIAL_STEPS[index], last = index === TUTORIAL_STEPS.length - 1;
  return (
    <div className="tutorial">
      <header className="dialog-head">
        <p className="dialog-kicker">How to play</p>
        <ol className="tutorial-dots" aria-label={`Step ${index + 1} of ${TUTORIAL_STEPS.length}`}>
          {TUTORIAL_STEPS.map((s, i) => <li key={s.id} className={i === index ? 'is-current' : i < index ? 'is-done' : ''}>
            <button type="button" aria-label={`Step ${i + 1}: ${s.title}`} aria-current={i === index ? 'step' : undefined}
              onClick={() => setIndex(i)} />
          </li>)}
        </ol>
      </header>
      <section key={step.id} className="tutorial-step" aria-live="polite">
        <h2><span className="tutorial-number">{index + 1}</span>{step.title}</h2>
        <p className="tutorial-summary">{step.summary}</p>
        <ul className="tutorial-bindings">
          {step.bindings.map(b => <li key={b.action}>
            <span className="keys">{b.keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
            <span>{b.action}</span>
          </li>)}
        </ul>
        {step.note && <p className="tutorial-note">{step.note}</p>}
      </section>
      <footer className="dialog-actions">
        <button type="button" className="ghost-button" onClick={onSkip}>Skip</button>
        <span className="dialog-spacer" />
        {index > 0 && <button type="button" className="ghost-button" onClick={() => setIndex(index - 1)}>Back</button>}
        <button type="button" className="primary-button" data-autofocus
          onClick={() => last ? onFinish() : setIndex(index + 1)}>
          {last ? finishLabel : 'Next'}
        </button>
      </footer>
    </div>
  );
}
