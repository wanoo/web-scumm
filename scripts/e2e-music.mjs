// The music director's gates (3.5): `npm run e2e:music [url]`, the production build served (`npm run preview`).
// dom/director.ts is bundled as it ships and run in the browser:
//   1. drift (Chromium, offline): two stems started together, looped for thirty minutes on an OfflineAudioContext;
//      every loop of each must land on the same sample, and on the sample the plan says: 0 samples of drift.
//   2. clicks (Chromium, offline): 100 changes of mix over thirty minutes of sine stems; no step between two samples
//      may exceed what the sines themselves can do (a hard cut would), and each change lands on a bar. The same
//      render with a hard switch (fadeBeats 0) must be caught: the check sees clicks when there are some.
//   2b. transitions (Chromium, offline, 3.6): a score to another on a marker of the first, through a bridge; the
//      bridge must sound on the marker's sample and the new score on the bridge's end, to the sample; a score started
//      at a save's phase must sound from that point of its file.
//   3. jitter (Chromium and WebKit, real time): a constant stem through the director on the device's AudioContext,
//      20 changes of mix, the moment each one is heard measured at the sample (ScriptProcessor `playbackTime`). The
//      tap itself adds a constant delay (its buffers): the jitter is how far each change strays from that latency,
//      under 20 ms. The game's own stems decode, all of the same length.
//   4. in the game (Chromium, the sample game): the theme plays as stems; another room changes the mix on the next
//      bar without restarting the music; `?music=mix` plays the single mix instead.
// `--only=offline|live|game` runs one part. Exit codes: 0 every gate passes, 1 not.
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173/';
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
// `--live=chromium|webkit`: the real-time part in that browser only (CI installs one browser per row).
const liveIn = process.argv.find((a) => a.startsWith('--live='))?.split('=')[1];
const { outputFiles } = await build({ entryPoints: ['src/engine/dom/director.ts'], bundle: true, format: 'iife', globalName: 'WS', write: false, logLevel: 'error' });
const lib = outputFiles[0].text;
let failed = 0;
const say = (ok, msg) => { if (!ok) failed++; console.log(`  ${ok ? '✔' : '✖'} ${msg}`); };

async function page(browserType) {
  const browser = await browserType.launch(browserType === chromium ? { args: ['--autoplay-policy=no-user-gesture-required'] } : {});
  const p = await (await browser.newContext()).newPage();
  await p.goto(url);
  await p.addScriptTag({ content: lib });
  return { browser, p };
}

if (!only || only === 'offline') {
  console.log('offline renders (Chromium):');
  const { browser, p } = await page(chromium);
  // 1. Drift: stem A an impulse on the left at its first sample, stem B on the right; 9.7 s long (not a whole number
  // of bars), looped for 30 minutes at 8 kHz.
  const drift = await p.evaluate(async () => {
    const sr = 8000, seconds = 1800, len = Math.round(9.7 * sr);
    const ctx = new OfflineAudioContext(2, sr * seconds, sr);
    const mk = (ch) => { const b = ctx.createBuffer(2, len, sr); b.getChannelData(ch)[0] = 1; return b; };
    const bufs = { a: mk(0), b: mk(1) };
    const d = new WS.MusicDirector(ctx, async (u) => u);
    d.buffer = async (u) => bufs[u];
    await d.play('drift', { stems: { a: 'a', b: 'b' }, bpm: 100 }, { a: 'a', b: 'b' }, ['a', 'b'], { at: 0.5, fadeMs: 0 });
    const out = await ctx.startRendering();
    const L = out.getChannelData(0), R = out.getChannelData(1);
    const hits = (x) => { const h = []; for (let i = 0; i < x.length; i++) if (x[i] > 0.5) h.push(i); return h; };
    const hl = hits(L), hr = hits(R);
    const start = Math.round(0.5 * sr);
    let worst = 0;
    for (let k = 0; k < Math.max(hl.length, hr.length); k++) {
      const want = start + k * len;
      worst = Math.max(worst, Math.abs((hl[k] ?? Infinity) - want), Math.abs((hr[k] ?? Infinity) - want));
    }
    return { loops: hl.length, right: hr.length, expected: Math.floor((sr * seconds - start - 1) / len) + 1, worst };
  });
  say(drift.loops === drift.expected && drift.right === drift.expected && drift.worst === 0, `drift: ${drift.loops} loops of each stem in 30 min, ${drift.worst} sample(s) off the plan`);

  // 2. Clicks: two sines of 70 and 47 samples a period (114.3 and 170.2 Hz, 0.45 each), in a buffer holding whole
  // periods of both (it loops without a seam), but never in a bar (16 000 samples): a cut falls mid-wave., 100 changes among [s1], [s2], [s1, s2], one every ~17 s.
  const clicks = (fadeBeats) => p.evaluate(async (fadeBeats) => {
    const sr = 8000, seconds = 1800, len = 70 * 47 * 30;
    const ctx = new OfflineAudioContext(1, sr * seconds, sr);
    const sine = (period) => { const b = ctx.createBuffer(1, len, sr); const x = b.getChannelData(0); for (let i = 0; i < len; i++) x[i] = 0.45 * Math.sin((2 * Math.PI * i) / period); return b; };
    const bufs = { s1: sine(70), s2: sine(47) };
    const score = { stems: { s1: 's1', s2: 's2' }, bpm: 120, beatsPerBar: 4, fadeBeats };
    const d = new WS.MusicDirector(ctx, async (u) => u);
    d.buffer = async (u) => bufs[u];
    d.lead = 0;
    await d.play('c', score, { s1: 's1', s2: 's2' }, ['s1'], { at: 0, fadeMs: 0 });
    const mixes = [['s2'], ['s1', 's2'], ['s1']];
    const ats = [];
    for (let k = 0; k < 100; k++) ats.push(d.mix(mixes[k % 3], 3 + k * 17.3));
    const out = (await ctx.startRendering()).getChannelData(0);
    // The steepest a sum of the two sines can move between two samples, with room for the ramps' own slope.
    const bound = 0.45 * ((2 * Math.PI) / 70) + 0.45 * ((2 * Math.PI) / 47) + 0.45 / (sr * 0.5) + 1e-4;
    let worst = 0, over = 0;
    for (let i = 1; i < out.length; i++) { const s = Math.abs(out[i] - out[i - 1]); if (s > worst) worst = s; if (s > bound) over++; }
    // On the bar of the music, which restarts its count where the buffer loops (core/score.ts `nextBoundary`).
    const dur = len / sr;
    const offGrid = ats.filter((a) => { if (a === null) return true; const m = a % dur; const r = Math.min(Math.abs(m / 2 - Math.round(m / 2)), Math.abs(m - dur)); return r > 1e-6 && Math.abs(m) > 1e-6; }).length;
    return { worst, bound, over, offGrid, changes: ats.filter((a) => a !== null).length };
  }, fadeBeats);
  const smooth = await clicks(2);
  say(smooth.over === 0 && smooth.changes === 100 && smooth.offGrid === 0, `clicks: ${smooth.changes} changes, ${smooth.offGrid} off the bar, steepest step ${smooth.worst.toFixed(4)} for a bound of ${smooth.bound.toFixed(4)} (${smooth.over} over)`);
  const hard = await clicks(0);
  say(hard.over > 0, `the same with a hard switch is caught: ${hard.over} step(s) over the bound, steepest ${hard.worst.toFixed(3)}`);

  // 2b. Transitions: A a constant on the left; at A's marker (bar 3: 6 s), a bridge of one bar (an impulse of 0.6 on
  // the right at its first sample), then B (an impulse of 0.9 on the right at its first sample): 6 s and 8 s, to the
  // sample. Then C from a save's phase (1.5 s into its file, an impulse 100 samples later).
  const tr = await p.evaluate(async () => {
    const sr = 8000, ctx = new OfflineAudioContext(2, sr * 20, sr);
    const buf = (len, ch, at, v) => { const b = ctx.createBuffer(2, len, sr); if (ch === 'dc') b.getChannelData(0).fill(0.3); else b.getChannelData(ch)[at] = v; return b; };
    const bufs = { a: buf(sr * 16, 'dc'), bridge: buf(sr * 2, 1, 0, 0.6), b: buf(sr * 16, 1, 0, 0.9) };
    const d = new WS.MusicDirector(ctx, async (u) => u);
    d.buffer = async (u) => bufs[u];
    d.lead = 0;
    await d.play('A', { stems: { a: 'a' }, bpm: 120, markers: { m: 3 } }, { a: 'a' }, ['a'], { at: 0, fadeMs: 0 });
    await d.play('B', { stems: { b: 'b' }, bpm: 120 }, { b: 'b' }, ['b'], { transition: { at: 'm', bridge: 'bridge' } });
    const out = await ctx.startRendering();
    const L = out.getChannelData(0), R = out.getChannelData(1);
    const near = (v) => { for (let i = 0; i < R.length; i++) if (Math.abs(R[i] - v) < 0.01) return i; return -1; };
    let lastA = -1; for (let i = 0; i < L.length; i++) if (L[i] > 1e-4) lastA = i;
    // C: a save's phase.
    const ctx2 = new OfflineAudioContext(1, sr * 4, sr);
    const c = ctx2.createBuffer(1, sr * 8, sr); c.getChannelData(0)[1.5 * sr + 100] = 1;
    const d2 = new WS.MusicDirector(ctx2, async (u) => u); d2.buffer = async () => c; d2.lead = 0;
    await d2.play('C', { stems: { c: 'c' }, bpm: 120 }, { c: 'c' }, ['c'], { at: 0.25, fadeMs: 0, offset: 1.5 });
    const C = (await ctx2.startRendering()).getChannelData(0);
    let hit = -1; for (let i = 0; i < C.length; i++) if (C[i] > 0.5) { hit = i; break; }
    return { bridge: near(0.6), b: near(0.9), lastA, want: [6 * sr, 8 * sr], phase: hit, wantPhase: 0.25 * sr + 100, plan: d.lastTransition };
  });
  say(tr.bridge === tr.want[0] && tr.b === tr.want[1] && tr.lastA < tr.want[0] + 0.05 * 8000 && tr.lastA >= tr.want[0], `transition: the bridge on the marker's sample (${tr.bridge}, want ${tr.want[0]}), the new score on the bridge's end (${tr.b}, want ${tr.want[1]}), the old one gone ${tr.lastA - tr.want[0]} samples after`);
  say(tr.phase === tr.wantPhase, `a save's phase: the score sounds from 1.5 s into its file (sample ${tr.phase}, want ${tr.wantPhase})`);
  await browser.close();
}

if (!only || only === 'live') {
  for (const [name, type] of [['chromium', chromium], ['webkit', webkit]].filter(([n]) => !liveIn || n === liveIn)) {
    console.log(`real time (${name}):`);
    const { browser, p } = await page(type);
    await p.mouse.click(5, 5).catch(() => {}); // a gesture, for a browser that wants one before sound
    const r = await p.evaluate(async () => {
      const ctx = new AudioContext();
      await ctx.resume().catch(() => {});
      const t0 = ctx.currentTime; await new Promise((r) => setTimeout(r, 400));
      if (ctx.currentTime <= t0) return { clock: false };
      // The game's stems: they decode, all of one length.
      const files = ['melody', 'strings', 'harp', 'bass'].map((s) => `assets/audio/music/swan-theme-stems/${s}.mp3`);
      const d0 = new WS.MusicDirector(ctx);
      const lens = await Promise.all(files.map((f) => d0.buffer(new URL(f, location.href).href).then((b) => b.length, () => -1)));
      // Jitter: a constant stem; its level is the mix's gain, seen at the sample by a ScriptProcessor.
      const sr = ctx.sampleRate, one = ctx.createBuffer(1, sr * 4, sr); one.getChannelData(0).fill(1);
      const zero = ctx.createBuffer(1, sr * 4, sr);
      const d = new WS.MusicDirector(ctx);
      d.buffer = async (u) => (u === 'one' ? one : zero);
      const tap = ctx.createScriptProcessor(1024, 1, 1);
      d.master.disconnect(); d.master.connect(tap); tap.connect(ctx.destination);
      d.master.gain.value = 1;
      const score = { stems: { one: 'one', zero: 'zero' }, bpm: 240, beatsPerBar: 1, quantize: 'beat', fadeBeats: 0.2 };
      let level = 0; const crossings = [];
      tap.onaudioprocess = (e) => { const x = e.inputBuffer.getChannelData(0); for (let i = 0; i < x.length; i++) { const on = x[i] > 0.5; if (on !== (level > 0.5)) crossings.push({ t: e.playbackTime + i / sr, on }); level = x[i]; } };
      await d.play('j', score, { one: 'one', zero: 'zero' }, ['zero'], { fadeMs: 0 });
      const plan = [];
      for (let k = 0; k < 20; k++) {
        // More than a beat and the lead apart: two requests on the same boundary keep only the last (by design).
        await new Promise((r) => setTimeout(r, 330 + ((k * 37) % 90)));
        const on = k % 2 === 0;
        const at = d.mix(on ? ['one', 'zero'] : ['zero']);
        if (at !== null) plan.push({ at, mid: at + 0.2 * 0.25 / 2, on });
      }
      await new Promise((r) => setTimeout(r, 900));
      tap.onaudioprocess = null;
      const lag = plan.map((p) => { const c = crossings.find((x) => x.on === p.on && x.t >= p.at - 0.05 && x.t <= p.mid + 0.3); return c ? c.t - p.mid : Infinity; });
      const sorted = [...lag].sort((a, b) => a - b), latency = sorted[Math.floor(sorted.length / 2)];
      const errs = lag.map((x) => Math.abs(x - latency));
      d.stop(0); await ctx.close();
      return { clock: true, lens, crossings: crossings.length, plan: plan.slice(0, 3), seen: crossings.slice(0, 4), changes: plan.length, latencyMs: latency * 1000, worstMs: Math.max(...errs) * 1000, meanMs: (errs.reduce((a, b) => a + b, 0) / errs.length) * 1000 };
    });
    if (!r.clock) say(false, `no audio clock: the AudioContext does not advance in ${name}`);
    else {
      say(r.lens.every((l) => l > 0 && l === r.lens[0]), `the game's 4 stems decode, ${r.lens[0]} frames each`);
      if (!(r.worstMs < 20)) console.log('    ', JSON.stringify({ crossings: r.crossings, plan: r.plan, seen: r.seen }));
      say(r.changes === 20 && r.worstMs < 20, `jitter: ${r.changes} changes, each heard within ${r.worstMs.toFixed(2)} ms of the others' latency (${r.meanMs.toFixed(2)} ms on average; the tap's constant delay ${r.latencyMs.toFixed(1)} ms) (< 20)`);
    }
    await browser.close();
  }
}
if ((!only || only === 'game') && !process.argv.includes('--no-game')) {
  console.log('in the game (Chromium):');
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  let p;
  // A fresh context each time: no autosave from the previous visit, no service worker in between.
  const play = async (q) => {
    p = await (await browser.newContext({ viewport: { width: 932, height: 430 } })).newPage();
    await p.goto(new URL(q, url).toString());
    await p.waitForFunction(() => !!window.__game?.engine, null, { timeout: 20000 });
    await p.locator('.overlay .bigbtn').first().click();
    await p.waitForFunction(() => !!window.__game.engine.state, null, { timeout: 20000 });
  };
  await play('./?music=stems');
  const g = await p.evaluate(async () => {
    const a = window.__game.audio, wait = (f) => new Promise((r) => { const t0 = performance.now(); const k = () => (f() || performance.now() - t0 > 8000 ? r(f()) : setTimeout(k, 50)); k(); });
    await wait(() => a.director?.startedAt != null);
    const d = a.director; if (!d) return { director: false };
    const first = { id: d.current, stems: [...d.stems], start: d.startedAt };
    const g = window.__game;
    await g.engine.teleport('garden');
    await wait(() => d.stems.length === 3);
    const garden = [...d.stems], sameStart = d.startedAt === first.start, room = g.engine.state.room;
    // A save keeps the music's phase (3.6); loading it after the music stopped resumes there.
    await new Promise((r) => setTimeout(r, 1500));
    g.engine.save();
    const saved = g.engine.store.load();
    a.stop();
    await wait(() => !d.current);
    await g.engine.load(saved);
    await wait(() => d.current === 'theme');
    const resumed = d.position;
    // 3.6.1: the same save loaded while its own score plays on: the music goes back to the saved point.
    await new Promise((r) => setTimeout(r, 2500));
    const drifted = d.position;
    await g.engine.load(saved);
    await wait(() => d.current === 'theme' && d.position !== null && Math.abs(d.position - saved.music.at) < 1);
    const reloaded = d.position;
    return { director: true, first, garden, sameStart, room, saved: saved.music, resumed, drifted, reloaded };
  });
  say(g.director && g.first.id === 'theme' && g.first.stems.length === 4, `the theme as stems in the house: ${g.director ? g.first.stems.join(', ') : 'no director'}`);
  say(g.director && g.garden.join() === 'strings,harp,bass' && g.sameStart, `the garden: ${g.garden?.join(', ')}, the same music going on (started once)`);
  say(g.saved?.id === 'theme' && g.saved.at > 1 && Math.abs(g.resumed - g.saved.at) < 1, `a save keeps the music's phase (${g.saved?.at?.toFixed(2)} s), and loading it resumes there (${g.resumed?.toFixed(2)} s)`);
  say(g.saved && Math.abs(g.drifted - g.saved.at) > 1.5 && Math.abs(g.reloaded - g.saved.at) < 1, `loading that save while the theme plays on (${g.drifted?.toFixed(2)} s) brings it back to the saved point (${g.reloaded?.toFixed(2)} s)`);
  await play('./?music=mix');
  const m = await p.evaluate(() => ({ director: !!window.__game.audio.director?.current }));
  say(!m.director, '?music=mix: the single mix, no director');
  await browser.close();
}
console.log(`${failed ? '✖' : '✔'}  music director: ${failed ? `${failed} gate(s) failed` : 'every gate passes'}`);
process.exit(failed ? 1 : 0);
