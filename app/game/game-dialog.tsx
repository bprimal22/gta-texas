import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal over the game: native showModal() makes the page behind inert, Tab cycles inside,
 * Escape closes, and focus goes back to `returnFocus` (or whatever had focus) on close. */
export function GameDialog({ label, view, onClose, returnFocus, className = '', children }: {
  label: string;
  /** Changing view moves focus to the new content's [data-autofocus]. */
  view?: string;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Captured once per opening, before focus moves into the dialog.
    if (!restore.current) restore.current = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (!dialog.open) dialog.showModal();
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog).focus({ preventScroll: true });
  }, [returnFocus, view]);
  // Passive cleanup runs after the commit, once the HUD is visible (focusable) again.
  useEffect(() => () => {
    const target = restore.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, []);
  return (
    <dialog ref={ref} className={`game-dialog ${className}`} aria-label={label} tabIndex={-1}
      // Escape closes natively; every native close (however it happens) is reported back to React.
      onClose={onClose}
      onKeyDown={e => {
        if (e.key !== 'Tab') return;
        const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(el => el.offsetParent !== null || el === document.activeElement);
        if (!items.length) { e.preventDefault(); return; }
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }}>
      {children}
    </dialog>
  );
}
