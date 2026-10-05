# Audio: music and sound effects that sound like one game

*French version: [docs/fr/AUDIO.md](../fr/AUDIO.md).*

A game declares its sounds by id (`audio.music`, `audio.sfx`, `audio.voices` in `game.ts`) and plays them with
`music`, `sfx` and `say … voice`. Where do the files come from? `tools/audio` is a pipeline that turns a MIDI (or an
audio file) into a **Sega Mega Drive** arrangement (YM2612 FM + SN76489 PSG + DAC drums), and synthesises the sound
effects from the same bank of sounds, so every track and every blip of a game share one sonic identity, the way
`npm run prompts` gives every image one style. It is written for any AI assistant or human: the decisions are a JSON
file, the rest is code.

```bash
npm run audio -- setup                                              # once per machine: Furnace 0.6.8.3 + a GM SoundFont
npm run audio -- ingest song.mid games/<id>/audio/projects/<slug>   # MIDI (or .wav/.mp3: see "Audio sources")
npm run audio -- all games/<id>/audio/projects/<slug>/spec.json     # .fur + .wav + .vgm + .mp3 + QA report
npm run audio -- sfx games/<id>/audio/sfx.json                      # the game's sound effects → audio/sfx/*.mp3
npm run assets                                                      # ships audio/ to public/assets
```

Needs Python 3 with numpy, `ffmpeg` and `fluidsynth` (`brew install ffmpeg fluid-synth`). Furnace is downloaded by
`setup` into `tools/audio/.furnace` (not in the repository). Audio sources (not MIDI) need a Python 3.11 venv:
`uv venv --python 3.11 tools/audio/.venv && uv pip install --python tools/audio/.venv/bin/python -r tools/audio/requirements-audio.txt`.

## The rules

1. **Sources.** The source of a track must be yours, in the public domain, or under a licence that allows a derived
   work (a MIDI of a 19th-century piece is fine; a film theme is not). Say where it comes from in `spec.json`
   (`author`, `comment`), in a `SOURCE.md` next to `source.mid`, and in `CREDITS.md`. A transcription has a licence
   of its own, and the arrangement inherits it. The sample game's theme is Tchaikovsky's *Swan Lake* (public
   domain), its notes written out for the project by a script (`games/demo/audio/projects/swan-theme/compose.py`
   writes `source.mid`): no transcription to inherit from, so it is CC BY 4.0 and a game may be sold with it (3.7;
   the theme before it came from a CC BY-NC MIDI).
2. **One palette.** `tools/audio/palette.json` holds the FM patches, PSG envelopes, DAC drum kit and mix targets.
   Every project and every sound effect builds from it. A missing sound is a new patch in the palette (with a `desc`),
   never an ad-hoc patch in one spec; a patch that shipped tracks rely on is not edited (add one, or bump `version`).
3. **Re-orchestrate, never convert track by track.** Keep the melody, the harmony that matters, the structure and the
   tempo; reduce the polyphony on purpose (merge doublings, drop inner voices, turn held chords into arpeggios).
4. **A build is done when the QA report says `ISSUES: none`.** The report measures levels against the palette's
   targets, pitch accuracy and clipping. It does not listen: say so, and tell the human what to check by ear.
5. **The rendered files are committed** (`audio/music/*.mp3`, `audio/sfx/*.mp3`, the project's `spec.json`,
   `source.mid`, `analysis.md`, `qa.txt`); the heavy intermediates are not (`out/*.wav`, `reference.wav`).

## Music: the workflow

1. **Ingest.** `npm run audio -- ingest <source> games/<id>/audio/projects/<slug>` copies the MIDI to `source.mid`,
   writes `analysis.md` / `analysis.json` (tracks, ranges, polyphony, detected doublings, an activity map bar by bar
   that shows the sections, tempo and meter changes) and a `spec.json` skeleton, and renders `reference.wav` with a
   GM SoundFont for A/B listening.
2. **Analyse.** Read `analysis.md` fully. Decide what is essential (melody, bass, defining riffs, harmonic rhythm)
   and what can go. Tempo changes are not handled inside one build: cut the piece at a tempo change (`bars`), or
   make one project per section. `npm run audio -- analyze source.mid --dump N` lists the notes of track N bar by bar.
3. **Arrange: write `spec.json`.** Default channel plan, to adapt and justify:

   | Channel | Role (`role` = QA target) | Typical content |
   |---|---|---|
   | FM1 | lead | the melody (`lead_brass`, `synth_lead`, `bright_strings`) |
   | FM2 | double, pan L | the melody an octave away on a contrasting patch, detuned (`fx_init: [["E5", "86"]]`) |
   | FM3 | bass | the lowest voice (`slap_bass`, `finger_bass`) |
   | FM4 | harmony | horn / countermelody / chord voice; the patch can change per section |
   | FM5 | counter, pan R | a secondary line, a chord tone |
   | FM6 | drums (DAC) | kick / snare / toms; an FM part where there are no drums |
   | PSG1 | echo | the melody delayed `delay_rows: 4` at vol ~8 |
   | PSG2 | arp | `type: arp` (`00 7C` power arps, `00 37` / `00 47` minor / major) |
   | PSG3 | accent | brass bite +12, a chord tone |
   | NOISE | noise | hats, open hat, crash |

   GM family → palette: brass → `lead_brass`; horn / trombone / tuba → `horn_section`; strings / pads →
   `bright_strings` or `soft_pad`; piano → `e_piano`; mallets / bells → `bell`; organ → `organ`; distorted guitar →
   `power_guitar` (feed it the low octave: it adds the octave and the fifth); clean guitar → `muted_pluck`; bass →
   `slap_bass` (busy) or `finger_bass` (sustained); synth lead → `synth_lead`; orchestra hits → `orch_hit`.

   Spec reference (`games/demo/audio/projects/swan-theme/spec.json` is a complete example):
   - top level: `title`, `author`, `comment`, `slug`, `source`, `bars` (how many bars to build), `rows_per_beat`
     (8 = 32nd-note rows), `pattern_rows` (64), `hz` (60), `extra_bars` (ring-out), `stop_at_end`, `sections`
     `{ name: [first, last] }`, `bpm` (override);
   - `channels.<CH>`: `name`, `role`, `pan` (`L` / `R` / `C`, FM only), `fx_init` `[["E5", "86"]]`,
     `fx` `[["bar:beat", "04", "00"]]`, `parts`;
   - a part: `track` (index, a name fragment, or a list to merge), `voice` (`high` / `low` / `latest` / `rankN`),
     `bars` (`[a, b]`, a section name, or a list of either) or `from` / `to` (`"bar:beat"`), `exclude_bars`, `ins`
     (palette key), `vol` (FM 0–127, PSG 0–15), `weak_vol` (off-beat accent), `accent_long`, `transpose`,
     `delay_rows`, `vibrato` (hex `"34"`, on notes ≥ 1.5 beats), `offs`;
   - an arp part: `type: "arp"`, `root_track`, `voice`, `bars`, `every_rows`, `transpose`, `arp` (hex xy), `ins`,
     `vol`, `weak_vol`;
   - `drums`: `track`, `dac`, `noise`, `accent: "beat"`, `map` (GM note → `kick` / `snare` / `ghost` / `tom:G3` /
     `hat` / `ohat` / `crash` / `noise_snare`), `hat_fill`, `extra_crash`, `noise_vols`;
   - `extras`: single notes for endings and stabs `{ ch, at: "bar:beat", note: "C5", beats, ins, vol }`.
4. **Build, render, check, iterate.** `npm run audio -- all …/spec.json` writes `out/<slug>.fur` (editable in
   Furnace), `.wav`, `.vgm` (emulators, real hardware players), `.mp3` (−14 LUFS), `<slug>_patterns.txt` and
   `qa.txt`. Fix what `ISSUES` lists and build again: a level off target → the part's `vol` (FM: 1 step ≈ 0.75 dB at
   the top of the range, more lower down; PSG: 1 step = 2 dB); a low pitch match → a wrong `transpose`, two parts
   overlapping on one channel, or `voice` picking the wrong line; `note collision` → two notes on one row.
5. **Deliver.** Copy `out/<slug>.mp3` to `games/<id>/audio/music/<id>.mp3`, declare it in `audio.music`, play it
   (`titleScreen.music`, a room's `music`, a `music` command), `npm run assets`. Tell the human which channel plays
   what, which liberties the arrangement took, and what to check by ear (lead / bass balance, the echo level, the
   stereo split).

### Audio sources
A `.wav` / `.mp3` / `.flac` is first transcribed to MIDI by basic-pitch (`.venv` required; demucs stems are optional
and heavy). The result is a draft: keep the melody, the bass and the chord roots, delete ghost notes, check the tempo
(`--bpm`), rewrite the drums as a pattern. Prefer a MIDI when one exists.

### Hardware and Furnace facts (handled in code)
Furnace plays SN76489 tone channels two octaves above the written note; the builder compensates, so specs use real
pitches (keep PSG notes ≥ A2). The DAC has no volume: dynamics are separate samples (`snare` / `ghost`). One note per
channel, four effects per cell, 32nd-note rows at 60 Hz with a groove for the tempo.

## Stems for the music director (3.5)

`npm run audio -- stems <project>/spec.json` renders the arrangement channel by channel (Furnace's per-channel
output) and sums the channels into stems: the spec's `"stems": { "<name>": ["FM1", "PSG1"], … }`, or by channel role
when it has none (melody: lead and echo; harmony: double, harmony, counter, accent, arp; bass; drums: the DAC and the
noise). Every stem comes from the same render, so all have the same length and start, and their sum is the mix. One
gain, the same for every stem, brings the sum to −14 LUFS (never a per-stem normalisation: the balance is the
arrangement's). It writes `games/<id>/audio/music/<slug>-stems/<stem>.mp3` and a `score.json` to paste under
`audio.scores`, by the id of the single mix (the tempo is measured from the render: bars × beats over its length;
`pcmBytes` is the stems' decoded weight at 48 kHz, on which a browser that does not tell its memory decides, 3.5.1).
Stems made by hand are welcome, but `npm run validate -- --release` measures them with ffprobe (3.6). Every stem must have
the same rate, channels and number of samples, the loop must end inside them, and `pcmBytes` must be what they decode to.

Group channels by what the game will switch on and off: the sample game's theme has melody, strings, harp and bass,
and plays only the harp and the bass while Biscuit is active. A stem that is nearly silent (a noise
channel alone, −54 LUFS) is a wasted download: fold it into another one. The single mix stays: it is what plays under
Save-Data, on a low-end device, or without Web Audio.

## Sound effects

`games/<id>/audio/sfx.json` holds one recipe per effect id of `audio.sfx`; `npm run audio -- sfx <file>` renders
them to `audio/sfx/<id>.mp3` (trimmed, peak-normalised, 10 ms fade). A recipe is a few rows of one or more channels
at 60 rows per second, with the palette's instruments:

```json
"door_open": { "desc": "a latch, then a wooden creak", "rows": 40, "tracks": [
  { "ch": "NOISE", "ins": "noise_hat", "events": [{ "row": 0, "note": "C6", "vol": 12 }] },
  { "ch": "FM1", "ins": "muted_pluck", "events": [{ "row": 3, "note": "D2", "vol": 118, "fx": [["01", "03"]] }, { "row": 28, "off": true }] }
] }
```

Events: `note` (name or MIDI number), `ins` (per track or per event), `vol`, `fx` (hex pairs: `01` / `02` pitch slide
up / down, `00xy` arpeggio, `04xy` vibrato, `0Axy` volume slide), `off`. `gain` sets the peak (default 0.9). The
sample game's `sfx.json` covers the usual vocabulary of an adventure game: clicks and selections, success and
error, doors and latches, coins, cloth, paper, a phone ring, drops, bells, glass, metal, shuffles, a gong. Copy it
into a new game and keep the ids: the engine's defaults (`select`, `success`, `error`…) expect them.

## In the Studio and the tools
The Assets tab lists the music and sound ids a game declares and whether a file exists for each; `npm run assets`
ships what is there and reports what is missing. The MCP `read_doc` tool serves this page as `AUDIO`.
