// Keyboard helpers for the game's DOM: a focus trap for dialogs, arrow-key navigation inside a group of buttons.
// Pure DOM, no engine: tested under happy-dom (tests/dom/a11y.test.ts).

export const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab inside `container`, calls `onEscape` on Escape, focuses `initial` (or the first focusable element) now.
 * Returns the function that releases the trap and restores the focus the dialog took.
 */
export function trapFocus(
  container: HTMLElement,
  o: { onEscape?: () => void; initial?: HTMLElement | null; restore?: boolean } = {},
): () => void {
  const previous = document.activeElement as HTMLElement | null;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && o.onEscape) {
      e.preventDefault();
      e.stopPropagation();
      o.onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!focusable.length) return;
    const first = focusable[0],
      last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', onKey);
  queueMicrotask(() => (o.initial ?? container.querySelector<HTMLElement>(FOCUSABLE))?.focus());
  return () => {
    container.removeEventListener('keydown', onKey);
    if (o.restore !== false) previous?.focus?.();
  };
}

/**
 * Arrow keys move the focus between the elements matching `selector` inside `container` (wrapping); Home and End
 * jump to the ends. The elements keep their natural Tab order.
 */
export function roving(container: HTMLElement, selector: string): () => void {
  const onKey = (e: KeyboardEvent) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const items = [...container.querySelectorAll<HTMLElement>(selector)].filter(
      (x) => !(x as HTMLButtonElement).disabled,
    );
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}

/** True when the keyboard event comes from a text field: the game must not react to typing. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
