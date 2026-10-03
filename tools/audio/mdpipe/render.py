"""Rendering: Furnace (WAV / per-channel WAV / VGM), FluidSynth GM reference, MP3 for sharing."""
import glob, os, platform, shutil, subprocess

PKG_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(PKG_ROOT, '.furnace')
FURNACE_VERSION = '0.6.8.3'


def furnace_bin():
    env = os.environ.get('FURNACE_BIN')
    if env:
        return env
    for c in (os.path.join(TOOLS, 'Furnace.app/Contents/MacOS/Furnace'), os.path.join(TOOLS, 'furnace'),
              shutil.which('furnace') or ''):
        if c and os.path.exists(c):
            return c
    raise RuntimeError('Furnace not found: run `python -m mdpipe setup` or set FURNACE_BIN')


def setup():
    """Download Furnace (pinned version) and a GM SoundFont into mdpipe/.furnace."""
    os.makedirs(TOOLS, exist_ok=True)
    base = f'https://github.com/tildearrow/furnace/releases/download/v{FURNACE_VERSION}/'
    if platform.system() == 'Darwin' and not os.path.exists(os.path.join(TOOLS, 'Furnace.app')):
        arch = 'arm64' if platform.machine() == 'arm64' else 'Intel'
        dmg = os.path.join(TOOLS, 'furnace.dmg'); mnt = os.path.join(TOOLS, 'mnt')
        subprocess.run(['curl', '-sL', '-o', dmg, base + f'furnace-{FURNACE_VERSION}-mac-{arch}.dmg'], check=True)
        subprocess.run(['hdiutil', 'attach', '-nobrowse', '-mountpoint', mnt, dmg], check=True, capture_output=True)
        subprocess.run(['cp', '-R', glob.glob(mnt + '/*.app')[0], TOOLS], check=True)
        subprocess.run(['hdiutil', 'detach', mnt], check=True, capture_output=True)
        subprocess.run(['xattr', '-dr', 'com.apple.quarantine', os.path.join(TOOLS, 'Furnace.app')])
        os.remove(dmg)
    elif platform.system() == 'Linux' and not os.path.exists(os.path.join(TOOLS, 'furnace')):
        tgz = os.path.join(TOOLS, 'f.tgz')
        subprocess.run(['curl', '-sL', '-o', tgz, base + f'furnace-{FURNACE_VERSION}-linux-x86_64.tar.gz'], check=True)
        subprocess.run(['tar', 'xzf', tgz, '-C', TOOLS, '--strip-components=1'], check=True)
        os.remove(tgz)
    sf = os.path.join(TOOLS, 'GeneralUser-GS.sf2')
    if not os.path.exists(sf):
        subprocess.run(['curl', '-sL', '-o', sf, 'https://github.com/mrbumpy409/GeneralUser-GS/raw/main/GeneralUser-GS.sf2'], check=True)
    print('Furnace:', furnace_bin()); print('SoundFont:', sf)


def furnace(*args):
    r = subprocess.run([furnace_bin(), '-loglevel', 'error', *args], capture_output=True, text=True)
    return r


def check_loads(fur):
    r = furnace('-info', fur)
    if r.returncode != 0 or 'INSTRUMENTS' not in r.stdout:
        raise RuntimeError(f'Furnace could not load {fur}:\n{r.stdout[-2000:]}{r.stderr[-2000:]}')
    return r.stdout


def render_wav(fur, wav):
    furnace('-output', wav, fur)
    if not os.path.exists(wav):
        raise RuntimeError('WAV render failed')


def render_stems(fur, outdir):
    os.makedirs(outdir, exist_ok=True)
    for f in glob.glob(os.path.join(outdir, 'ch_c*.wav')):
        os.remove(f)
    furnace('-outmode', 'perchan', '-output', os.path.join(outdir, 'ch.wav'), fur)
    return sorted(glob.glob(os.path.join(outdir, 'ch_c*.wav')))


def render_vgm(fur, vgm):
    furnace('-vgmout', vgm, fur)


def text_dump(fur, txt):
    furnace('-txtout', txt, fur)


def ffmpeg(*args):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *args], check=True)


def mp3(wav, out, lufs=-14, title=None):
    meta = ['-metadata', f'title={title}'] if title else []
    ffmpeg('-i', wav, '-af', f'loudnorm=I={lufs}:TP=-1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '192k', *meta, out)


def reference(midi, wav, lufs=-15):
    """Render the source MIDI with a GM SoundFont for A/B comparison (trailing silence trimmed)."""
    sf = os.path.join(TOOLS, 'GeneralUser-GS.sf2')
    if not shutil.which('fluidsynth') or not os.path.exists(sf):
        raise RuntimeError('needs fluidsynth (brew install fluid-synth) and `python -m mdpipe setup` for the SoundFont')
    raw = wav + '.raw.wav'
    subprocess.run(['fluidsynth', '-ni', '-g', '0.6', '-r', '44100', '-F', raw, sf, midi], check=True, capture_output=True)
    ffmpeg('-i', raw, '-af', f'areverse,silenceremove=start_periods=1:start_threshold=-60dB,areverse,loudnorm=I={lufs}:TP=-1',
           '-ar', '44100', '-c:a', 'pcm_s16le', wav)
    os.remove(raw)
