// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isTyping, roving, trapFocus } from '@engine/dom/a11y';

const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const tick = () => new Promise((r) => queueMicrotask(() => r(undefined)));

function dialog(n = 3) {
  document.body.innerHTML = '<button id="outside">out</button><div id="d"></div>';
  const d = document.getElementById('d')!;
  for (let i = 0; i < n; i++) {
    const b = document.createElement('button');
    b.id = `b${i}`;
    b.textContent = String(i);
    d.append(b);
  }
  return d;
}

describe('trapFocus', () => {
  it('focuses the first button, wraps Tab both ways, releases to the previous focus', async () => {
    const d = dialog();
    document.getElementById('outside')!.focus();
    const release = trapFocus(d);
    await tick();
    expect(document.activeElement?.id).toBe('b0');
    key(d, 'Tab', { shiftKey: true });
    expect(document.activeElement?.id).toBe('b2');
    key(d, 'Tab');
    expect(document.activeElement?.id).toBe('b0');
    release();
    expect(document.activeElement?.id).toBe('outside');
  });

  it('calls onEscape and stops the event there', async () => {
    const d = dialog();
    let escaped = 0,
      bubbled = 0;
    document.body.addEventListener('keydown', () => bubbled++);
    trapFocus(d, { onEscape: () => escaped++ });
    await tick();
    key(document.getElementById('b1')!, 'Escape');
    expect(escaped).toBe(1);
    expect(bubbled).toBe(0);
  });
});

describe('roving', () => {
  it('moves with the arrows, wraps, Home and End jump, disabled buttons are skipped', async () => {
    const d = dialog(4);
    (document.getElementById('b2') as HTMLButtonElement).disabled = true;
    roving(d, 'button');
    document.getElementById('b0')!.focus();
    key(document.activeElement!, 'ArrowRight');
    expect(document.activeElement?.id).toBe('b1');
    key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement?.id).toBe('b3');
    key(document.activeElement!, 'ArrowRight');
    expect(document.activeElement?.id).toBe('b0');
    key(document.activeElement!, 'ArrowLeft');
    expect(document.activeElement?.id).toBe('b3');
    key(document.activeElement!, 'Home');
    expect(document.activeElement?.id).toBe('b0');
    key(document.activeElement!, 'End');
    expect(document.activeElement?.id).toBe('b3');
  });
});

describe('isTyping', () => {
  it('is true in a text field only', () => {
    document.body.innerHTML = '<input id="i"><button id="b">x</button>';
    let seen: boolean[] = [];
    document.body.addEventListener('keydown', (e) => seen.push(isTyping(e)));
    key(document.getElementById('i')!, 'a');
    key(document.getElementById('b')!, 'a');
    expect(seen).toEqual([true, false]);
  });
});
