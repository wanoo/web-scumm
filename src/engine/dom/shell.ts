// The shell of the player: its elements (scene, verbs, inventory, menus), their layout for the screen, the accessible targets.
// Part of the player (4.1.0 "Clarity"): App's methods of the same name forward here.

import type { Id } from '../core/types';
import { roving } from './a11y';
import { el, esc } from './app-shared';
import type { App } from './app';

// ================================================================== layout
export function buildShell(app: App) {
  app.root.innerHTML = '';
  const rot = el(
    'div',
    'rotate',
    `<div class="ph"></div><div style="font-size:22px;color:#ffd84d">${esc(app.game.ui.rotate)}</div><div style="max-width:260px;color:#a99fbd">${esc(app.game.ui.rotateSub)}</div>`,
  );
  document.body.append(rot);
  app.g = el('div', 'game');
  app.scol = el('div', 'scol');
  app.scene = el('div', 'scene');
  // Pixel-art games: sprites and backgrounds scaled up with hard edges (style.css `.scene.pixel img`).
  if (app.game.skin?.pixelArt) app.scene.classList.add('pixel');
  app.scene.append(app.view.el);
  app.live = el('div', 'sr-only');
  app.live.setAttribute('aria-live', 'polite');
  app.live.setAttribute('aria-atomic', 'true');
  app.scene.append(app.live);
  app.scene.append(el('div', 'letter t'), el('div', 'letter b'));
  app.sbar = el('div', 'sbar');
  app.scene.append(app.sbar);
  app.scol.append(app.scene);
  app.side = el('div', 'side');
  app.verbsEl = el('div', 'verbs');
  app.verbsEl.setAttribute('role', 'group');
  app.verbsEl.setAttribute('aria-label', app.t('verbs'));
  roving(app.verbsEl, '.verb');
  for (const v of app.game.verbs) {
    const b = el('button', 'verb', esc(v.label));
    b.style.color = v.color;
    b.dataset.verb = v.id;
    b.onclick = () => app.pickVerb(v.id);
    app.verbsEl.append(b);
  }
  app.invEl = el('div', 'inv');
  app.invNav = el('div', 'invnav');
  const up = el('button', 'tool', '▲'),
    down = el('button', 'tool', '▼'),
    pg = el('span', 'invpg');
  up.onclick = () => {
    if (app.invPage > 0) {
      app.invPage--;
      app.renderInv();
    }
  };
  down.onclick = () => {
    if ((app.invPage + 2) * app.invCols < app.items.length) {
      app.invPage++;
      app.renderInv();
    }
  };
  app.invNav.append(up, pg, down);
  app.toolsEl = el('div', 'tools');
  const tool = (icon: Id, label: string, fn: (b: HTMLButtonElement) => void) => {
    const b = el('button', 'tool', `<img src="${app.bank.img(icon)}" alt="">`);
    b.setAttribute('aria-label', label);
    b.title = label;
    b.onclick = () => fn(b);
    app.toolsEl.append(b);
    return b;
  };
  const icons = app.game.skin.icons;
  // Several playable characters: one button per other character (their portrait, or their initial), before the map.
  for (const pid of app.game.players?.ids ?? []) {
    const c = app.game.characters[pid];
    const b = el(
      'button',
      'tool player',
      c?.portrait
        ? `<img src="${app.bank.img(c.portrait)}" alt="">`
        : `<span>${esc((c?.name ?? pid).slice(0, 1))}</span>`,
    );
    b.dataset.player = pid;
    b.setAttribute('aria-label', c?.name ?? pid);
    b.title = c?.name ?? pid;
    b.onclick = () => {
      if (!app.engine.busy && !app.speechEl) void app.engine.switchTo(pid);
    };
    app.toolsEl.append(b);
  }
  tool(icons.map, app.game.ui.mapTitle, () => {
    if (!app.engine.busy && !app.speechEl) void app.engine.openMap();
  });
  tool(icons.pause, app.game.ui.pause, () => app.pauseMenu());
  tool(icons.music, app.game.ui.music, (b) => {
    const on = !app.audio.musicOn;
    app.audio.setMusic(on);
    app.audio.setSfx(on);
    b.classList.toggle('off', !on);
  });
  app.side.append(app.verbsEl, app.invEl, app.invNav, app.toolsEl);
  app.g.append(app.scol, app.side);
  app.root.append(app.g);

  // Input: a tap during a line of dialogue dismisses it, otherwise it acts.
  app.g.addEventListener(
    'pointerdown',
    (e) => {
      if (app.speechEl && !(e.target as HTMLElement).closest('.overlay')) {
        e.stopPropagation();
        e.preventDefault();
        app.endSpeech();
        app.eatClick = performance.now();
      }
    },
    true,
  );
  // The tap that dismisses a line shouldn't also pick the verb or item that was under the finger.
  app.g.addEventListener(
    'click',
    (e) => {
      if (performance.now() - app.eatClick < 700) {
        e.stopPropagation();
        e.preventDefault();
        app.eatClick = -Infinity;
      }
    },
    true,
  );
  app.scene.addEventListener('pointerdown', (e) => app.onScenePointer(e));
  app.scene.addEventListener('pointermove', (e) => app.onHover(e));
  app.scene.addEventListener('pointerleave', () => {
    app.showLabel(null);
    app.sentence();
  });
  // The keyboard plays the whole game: Space / Enter advance a line, Escape closes what is on top, then pauses.
  document.addEventListener('keydown', (e) => app.onKey(e), { signal: app.aborter.signal });
}

/** @internal Read by the modules of dom/ (4.1.0). */
export function layout(app: App) {
  const r = app.root.getBoundingClientRect();
  const W = r.width,
    H = r.height;
  app.desk = matchMedia('(pointer: fine)').matches && W >= 720 && H >= 450;
  app.g.classList.toggle('desk', app.desk);
  let sw: number, sh: number;
  if (app.desk) {
    // 16:10 scene on top, panel at the bottom (sentence line + verbs + inventory + menu), like LucasArts games.
    sh = Math.floor(Math.min(W / 1.6, H / 1.34));
    sw = Math.round(sh * 1.6);
    const ph = Math.round(sh * 0.34);
    Object.assign(app.g.style, { width: `${sw}px`, height: `${sh + ph}px` });
    Object.assign(app.scol.style, { width: `${sw}px`, height: `${sh}px` });
    Object.assign(app.side.style, {
      width: `${sw}px`,
      height: `${ph}px`,
      fontSize: `${Math.max(12, Math.round(ph * 0.1))}px`,
    });
    app.verbsEl.style.fontSize = `${Math.max(12, Math.round(ph * 0.105))}px`;
    for (const b of app.verbsEl.children) (b as HTMLElement).style.height = '';
    if (app.sbar.parentElement !== app.side) app.side.prepend(app.sbar);
  } else {
    const sideW = Math.max(176, Math.min(300, W - H * 1.6));
    sw = W - sideW;
    sh = Math.min(H, sw / 1.6);
    sw = Math.round(sh * 1.6);
    sh = Math.round(sh);
    Object.assign(app.g.style, { width: `${sw + sideW}px`, height: `${H}px` });
    Object.assign(app.scol.style, { width: `${sw}px`, height: `${H}px` });
    Object.assign(app.side.style, {
      width: `${sideW}px`,
      height: '',
      fontSize: `${Math.max(12, Math.min(16, Math.round(sideW / 13)))}px`,
    });
    const colW = (sideW - 16) / 3;
    app.verbsEl.style.fontSize = `${Math.max(10, Math.min(16, Math.floor(colW / 4.1)))}px`;
    for (const b of app.verbsEl.children)
      (b as HTMLElement).style.height = `${Math.max(44, Math.min(56, Math.round(H * 0.12)))}px`; // a touch target: 44 px at least (4.1.6)
    if (app.sbar.parentElement !== app.scene) app.scene.append(app.sbar);
  }
  Object.assign(app.scene.style, {
    width: `${sw}px`,
    height: `${sh}px`,
    fontSize: `${Math.max(13, Math.round(sw * 0.03))}px`,
  });
  app.u = sw / 640;
  app.sw = sw;
  app.view.resize(app.u);
  app.renderA11yTargets();
  if (app.items) app.renderInv();
}

/** Keyboard and screen-reader representation of the visible coordinate-based scene hotspots. */
export function renderA11yTargets(app: App) {
  // Diffed by id (4.1.5): a button lives as long as its target is in the room; 4.1.0 rebuilt the layer on every state
  // change, and a focused button lost its focus each time.
  if (!app.view.room || !app.engine.state) {
    app.a11yTargets?.remove();
    app.a11yTargets = null;
    app.a11yButtons.clear();
    return;
  }
  let layer = app.a11yTargets;
  if (!layer || layer.parentElement !== app.view.el) {
    layer?.remove();
    app.a11yButtons.clear();
    layer = el('div', 'a11y-targets');
    app.view.el.append(layer);
    app.a11yTargets = layer;
  }
  layer.setAttribute('aria-label', app.view.room.name);
  const wanted = new Set<string>();
  for (const id of app.engine.targets(app.view.room)) {
    const box = app.view.box(id);
    if (!box) continue;
    wanted.add(id);
    let b = app.a11yButtons.get(id);
    if (!b) {
      b = el('button', 'a11y-target');
      b.dataset.target = id;
      b.onfocus = () => {
        app.showLabel(id);
        app.sentence(id);
      };
      b.onblur = () => {
        app.showLabel(null);
        app.sentence();
      };
      b.onclick = (e) => {
        e.stopPropagation();
        // The button keeps its focus across the action it started (4.1.5), so the player's Space or Enter lands here
        // while the line it caused is showing: it advances the line, as a tap on the scene does.
        if (app.speechEl && !app.scene.querySelector('.overlay:not(.mapview) .mg-skip')) {
          app.endSpeech();
          app.eatClick = performance.now();
          return;
        }
        if (!app.engine.busy && !app.inCutscene) void app.actOnTarget(id);
      };
      layer.append(b);
      app.a11yButtons.set(id, b);
    }
    const name = app.engine.nameOf(id);
    if (b.textContent !== name) {
      b.textContent = name;
      b.setAttribute('aria-label', name);
    }
    Object.assign(b.style, {
      left: `${box[0] * app.u}px`,
      top: `${box[1] * app.u}px`,
      width: `${Math.max(24, box[2] * app.u)}px`,
      height: `${Math.max(24, box[3] * app.u)}px`,
    });
  }
  for (const [id, b] of app.a11yButtons)
    if (!wanted.has(id)) {
      b.remove();
      app.a11yButtons.delete(id);
    }
}
