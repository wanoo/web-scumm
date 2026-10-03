"""mdpipe - multi-source -> Sega Mega Drive (YM2612 + SN76489) audio pipeline.

  python -m mdpipe setup                          download pinned Furnace + GM SoundFont
  python -m mdpipe ingest SOURCE projects/NAME    MIDI/WAV/MP3/... -> project folder (source.mid, analysis.md, spec.json skeleton, reference render)
  python -m mdpipe analyze FILE.mid [--dump N] [--drums N]
  python -m mdpipe transcribe AUDIO -o out.mid [--bpm 120] [--no-separate]
  python -m mdpipe build projects/NAME/spec.json  -> out/NAME.fur (+ pattern text dump)
  python -m mdpipe qa projects/NAME/spec.json     objective checks (levels, pitch, peak)
  python -m mdpipe all projects/NAME/spec.json    build + render (wav, vgm, mp3) + qa  <- main iteration loop
  python -m mdpipe sfx games/ID/audio/sfx.json    the sound effects of a game, from the palette -> audio/sfx/*.mp3
"""
import argparse, json, os, shutil, sys
from . import analyze as an, arrange, render, qa

AUDIO_EXT = {'.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.aif', '.aiff', '.opus'}


def out_paths(spec_path):
    proj = os.path.dirname(os.path.abspath(spec_path))
    name = json.load(open(spec_path)).get('slug') or os.path.basename(proj)
    out = os.path.join(proj, 'out'); os.makedirs(out, exist_ok=True)
    return proj, out, name


def cmd_build(spec):
    proj, out, name = out_paths(spec)
    fur = os.path.join(out, name + '.fur')
    a = arrange.build(spec, fur)
    render.check_loads(fur)
    render.text_dump(fur, os.path.join(out, name + '_patterns.txt'))
    print(f'built {fur} ({len(a.bank.blocks)} instruments, {len(a.bank.samples)} samples, speeds {a.speeds()})')
    for l in a.log:
        print('  note:', l)
    return fur


def cmd_qa(spec, fur=None):
    proj, out, name = out_paths(spec)
    fur = fur or os.path.join(out, name + '.fur')
    rep = qa.run(spec, fur, os.path.join(out, '.qa'))
    txt = qa.report_text(rep)
    print(txt)
    json.dump(rep, open(os.path.join(out, 'qa.json'), 'w'), indent=1)
    open(os.path.join(out, 'qa.txt'), 'w').write(txt)
    shutil.rmtree(os.path.join(out, '.qa'), ignore_errors=True)
    return rep


def cmd_all(spec):
    proj, out, name = out_paths(spec)
    fur = cmd_build(spec)
    wav, vgm, mp3 = (os.path.join(out, name + e) for e in ('.wav', '.vgm', '.mp3'))
    render.render_wav(fur, wav)
    render.render_vgm(fur, vgm)
    title = json.load(open(spec)).get('title', name)
    render.mp3(wav, mp3, title=f'{title} (Mega Drive)')
    ref = os.path.join(proj, 'reference.wav')
    if os.path.exists(ref) and not os.path.exists(os.path.join(out, 'reference.mp3')):
        render.mp3(ref, os.path.join(out, 'reference.mp3'), title=f'{title} (source)')
    print('rendered', wav, vgm, mp3)
    return cmd_qa(spec, fur)


SPEC_SKELETON = {
    "title": "", "author": "", "slug": "",
    "source": "source.mid",
    "rows_per_beat": 8, "pattern_rows": 64, "hz": 60, "extra_bars": 1, "stop_at_end": True,
    "sections": {},
    "channels": {
        "FM1": {"name": "FM1 Lead", "role": "lead", "pan": "C", "parts": []},
        "FM2": {"name": "FM2 Double", "role": "double", "pan": "L", "parts": []},
        "FM3": {"name": "FM3 Bass", "role": "bass", "pan": "C", "parts": []},
        "FM4": {"name": "FM4 Harmony", "role": "harmony", "pan": "C", "parts": []},
        "FM5": {"name": "FM5 Counter", "role": "counter", "pan": "R", "parts": []},
        "FM6": {"name": "FM6 DAC", "role": "drums"},
        "PSG1": {"name": "PSG1 Echo", "role": "echo", "parts": []},
        "PSG2": {"name": "PSG2 Arp", "role": "arp", "parts": []},
        "PSG3": {"name": "PSG3 Accent", "role": "accent", "parts": []},
        "NOISE": {"name": "Noise", "role": "noise"}
    },
    "drums": None,
    "extras": []
}

DEFAULT_DRUM_MAP = {"35": "kick", "36": "kick", "37": "ghost", "38": "snare", "39": "snare", "40": "snare",
                    "41": "tom:F3", "43": "tom:G3", "45": "tom:B3", "47": "tom:D4", "48": "tom:E4", "50": "tom:G4",
                    "42": "hat", "44": "hat", "51": "hat", "53": "hat", "46": "ohat",
                    "49": "crash", "52": "crash", "55": "crash", "57": "crash"}


def cmd_ingest(source, proj, bpm=None):
    os.makedirs(proj, exist_ok=True)
    ext = os.path.splitext(source)[1].lower()
    mid = os.path.join(proj, 'source.mid')
    if ext in ('.mid', '.midi'):
        shutil.copy(source, mid)
    elif ext in AUDIO_EXT:
        from .transcribe import transcribe
        shutil.copy(source, os.path.join(proj, 'source_audio' + ext))
        info = transcribe(source, mid, bpm=bpm)
        print('transcribed:', info)
        print('!! audio transcription is a draft - check the analysis carefully, fix wrong notes in source.mid if needed')
    else:
        raise SystemExit(f'unsupported source type {ext}')
    m, rep = an.analyze(mid)
    txt = an.report_text(m, rep)
    for t in rep['tracks']:
        txt += f"\n\n## Track {t['index']} {t['name']}\n"
        txt += an.drum_grid(m, t['index']) if t['drums'] else an.bar_dump(m, t['index'])
    open(os.path.join(proj, 'analysis.md'), 'w').write(txt)
    json.dump(rep, open(os.path.join(proj, 'analysis.json'), 'w'), indent=1, default=str)
    spec_path = os.path.join(proj, 'spec.json')
    if not os.path.exists(spec_path):
        sk = json.loads(json.dumps(SPEC_SKELETON))
        sk['slug'] = os.path.basename(os.path.abspath(proj))
        sk['title'] = sk['slug']
        drums = [t for t in rep['tracks'] if t['drums']]
        if drums:
            sk['drums'] = {"track": drums[0]['index'], "dac": "FM6", "noise": "NOISE", "accent": "beat", "map": DEFAULT_DRUM_MAP}
        json.dump(sk, open(spec_path, 'w'), indent=2)
    try:
        render.reference(mid, os.path.join(proj, 'reference.wav'))
    except Exception as e:
        print('reference render skipped:', e)
    print(f'project ready: {proj}\n  analysis.md  <- read this\n  spec.json    <- write the arrangement here\n  reference.wav')


def main(argv=None):
    p = argparse.ArgumentParser(prog='mdpipe', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('setup')
    s = sub.add_parser('ingest'); s.add_argument('source'); s.add_argument('project'); s.add_argument('--bpm', type=float)
    s = sub.add_parser('analyze'); s.add_argument('midi'); s.add_argument('--dump', type=int); s.add_argument('--drums', type=int); s.add_argument('--json')
    s = sub.add_parser('transcribe'); s.add_argument('audio'); s.add_argument('-o', required=True); s.add_argument('--bpm', type=float); s.add_argument('--no-separate', action='store_true')
    for c in ('build', 'qa', 'all'):
        s = sub.add_parser(c); s.add_argument('spec')
    s = sub.add_parser('sfx'); s.add_argument('spec'); s.add_argument('--out'); s.add_argument('--only', nargs='*')
    a = p.parse_args(argv)
    try:
        if a.cmd == 'setup': render.setup()
        elif a.cmd == 'ingest':
            cmd_ingest(a.source, a.project, a.bpm)
            if os.path.splitext(a.source)[1].lower() in AUDIO_EXT:
                sys.stdout.flush(); os._exit(0)   # onnxruntime/coreml teardown can abort on macOS
        elif a.cmd == 'analyze': an.main(a.midi, a.json, a.dump, a.drums)
        elif a.cmd == 'transcribe':
            from .transcribe import transcribe
            print(transcribe(a.audio, a.o, bpm=a.bpm, separate_stems=not a.no_separate))
            sys.stdout.flush(); os._exit(0)
        elif a.cmd == 'build': cmd_build(a.spec)
        elif a.cmd == 'qa': cmd_qa(a.spec)
        elif a.cmd == 'all': cmd_all(a.spec)
        elif a.cmd == 'sfx':
            from . import sfx
            sfx.run(a.spec, a.out, a.only)
    except (arrange.SpecError, RuntimeError) as e:
        sys.exit(f'error: {e}')


if __name__ == '__main__':
    main()
