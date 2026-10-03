"""Audio (wav/mp3/flac/ogg/m4a...) -> MIDI, so audio sources enter the same MIDI-based pipeline.

Strategy:
  1. optional stem separation (demucs, if installed): drums / bass / vocals / other
  2. polyphonic transcription per stem with Spotify basic-pitch
  3. tempo estimate + quantisation to a 16th grid, one MIDI track per stem
The result is a DRAFT: the arranger must inspect it (analyze), clean wrong notes and
decide roles exactly like for a hand-made MIDI. Drums from audio are only an onset sketch.
"""
import os, shutil, subprocess, tempfile
import numpy as np
from .midi import Note, write_midi

PPQ = 480


def _need(mod, hint):
    try:
        return __import__(mod)
    except ImportError:
        raise RuntimeError(f'missing "{mod}": {hint}')


def to_wav(src, dst, sr=44100):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', str(sr), dst], check=True)


def estimate_bpm(wav):
    """Onset-autocorrelation tempo estimate (60-200 BPM), no librosa needed."""
    import wave
    w = wave.open(wav); sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float)
    hop = 512
    frames = len(x) // hop
    e = np.array([np.sum(x[i * hop:(i + 1) * hop] ** 2) for i in range(frames)])
    onset = np.maximum(0, np.diff(np.log1p(e)))
    onset -= onset.mean()
    ac = np.correlate(onset, onset, 'full')[len(onset) - 1:]
    fps = sr / hop
    lags = np.arange(len(ac))
    bpm = 60 * fps / np.maximum(lags, 1)
    ok = (bpm >= 60) & (bpm <= 200)
    best = lags[ok][np.argmax(ac[ok] * np.exp(-((bpm[ok] - 120) / 80) ** 2))]
    return round(60 * fps / best, 1)


def separate(wav, outdir):
    if not shutil.which('demucs'):
        return {'mix': wav}
    subprocess.run(['demucs', '-n', 'htdemucs', '-o', outdir, wav], check=True)
    base = os.path.join(outdir, 'htdemucs', os.path.splitext(os.path.basename(wav))[0])
    return {s: os.path.join(base, s + '.wav') for s in ('vocals', 'other', 'bass', 'drums') if os.path.exists(os.path.join(base, s + '.wav'))}


def transcribe(src, out_mid, bpm=None, separate_stems=True, min_note_s=0.06):
    _need('basic_pitch', 'pip install "basic-pitch[onnx]" (python <= 3.11 recommended)')
    from basic_pitch.inference import predict
    from basic_pitch import ICASSP_2022_MODEL_PATH
    tmp = tempfile.mkdtemp(prefix='mdpipe_')
    wav = os.path.join(tmp, 'src.wav'); to_wav(src, wav)
    bpm = bpm or estimate_bpm(wav)
    if abs(bpm - round(bpm)) < 0.5:
        bpm = float(round(bpm))
    stems = separate(wav, tmp) if separate_stems else {'mix': wav}
    tick = lambda sec: int(round(sec * bpm / 60 * PPQ / 120)) * 120      # quantise to 16ths
    tracks, names = [], []
    for name, path in stems.items():
        _, _, events = predict(path, ICASSP_2022_MODEL_PATH, minimum_note_length=min_note_s * 1000)
        notes = []
        ch = 9 if name == 'drums' else len(tracks) % 9
        for s, e, p, amp, _ in events:
            a, b = tick(s), tick(e)
            if b <= a: b = a + 120
            if name == 'drums':
                p = 36 if p < 50 else (38 if p < 70 else 42)    # crude onset->kit sketch
            notes.append(Note(a, b, int(p), int(min(127, 40 + amp * 87)), ch))
        tracks.append(sorted(notes, key=lambda n: (n.start, n.pitch))); names.append(name)
    write_midi(out_mid, PPQ, tracks, bpm=bpm, names=names)
    shutil.rmtree(tmp, ignore_errors=True)
    return {'bpm': bpm, 'stems': names, 'notes': {n: len(t) for n, t in zip(names, tracks)}}
