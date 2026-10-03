"""Dependency-free Standard MIDI File reader (format 0/1)."""
import struct
from dataclasses import dataclass, field


@dataclass
class Note:
    start: int      # ticks
    end: int        # ticks (exclusive)
    pitch: int
    vel: int
    channel: int


@dataclass
class Track:
    index: int
    name: str = ''
    programs: dict = field(default_factory=dict)   # midi channel -> GM program
    notes: list = field(default_factory=list)
    cc: dict = field(default_factory=dict)         # cc number -> count
    pitchbends: int = 0


@dataclass
class Midi:
    ppq: int
    tracks: list
    tempos: list      # [(tick, bpm)]
    timesigs: list    # [(tick, num, den)]
    keysigs: list     # [(tick, sharps, minor)]

    @property
    def end_tick(self):
        return max((n.end for t in self.tracks for n in t.notes), default=0)

    def bar_ticks(self):
        num, den = (self.timesigs[0][1:] if self.timesigs else (4, 4))
        return self.ppq * 4 * num // den


def _vlq(d, i):
    v = 0
    while True:
        b = d[i]; i += 1; v = (v << 7) | (b & 0x7f)
        if b < 0x80:
            return v, i


def read_midi(path):
    d = open(path, 'rb').read()
    if d[:4] != b'MThd':
        raise ValueError(f'{path}: not a Standard MIDI File')
    hl, fmt, ntr, ppq = struct.unpack('>IHHH', d[4:14])
    if ppq & 0x8000:
        raise ValueError('SMPTE time division is not supported')
    i = 8 + hl
    tracks, tempos, timesigs, keysigs = [], [], [], []
    for ti in range(ntr):
        while d[i:i + 4] != b'MTrk':          # skip unknown chunks
            i += 8 + struct.unpack('>I', d[i + 4:i + 8])[0]
        ln = struct.unpack('>I', d[i + 4:i + 8])[0]
        j, end, tick, rs = i + 8, i + 8 + ln, 0, None
        tr = Track(ti)
        on = {}
        while j < end:
            dt, j = _vlq(d, j); tick += dt
            b = d[j]
            if b == 0xff:
                typ = d[j + 1]; l, k = _vlq(d, j + 2); data = d[k:k + l]; j = k + l
                if typ == 0x51:
                    tempos.append((tick, 60e6 / int.from_bytes(data, 'big')))
                elif typ == 0x58:
                    timesigs.append((tick, data[0], 2 ** data[1]))
                elif typ == 0x59:
                    keysigs.append((tick, struct.unpack('b', data[:1])[0], data[1]))
                elif typ in (0x03, 0x04) and not tr.name:
                    tr.name = data.decode('utf-8', 'replace')
                continue
            if b in (0xf0, 0xf7):
                l, k = _vlq(d, j + 1); j = k + l; continue
            if b & 0x80:
                rs = b; j += 1
            st = rs; typ, ch = st >> 4, st & 15
            n = 1 if typ in (0xc, 0xd) else 2
            data = d[j:j + n]; j += n
            if typ == 0x9 and data[1] > 0:
                on.setdefault((ch, data[0]), []).append((tick, data[1]))
            elif typ in (0x8, 0x9):
                lst = on.get((ch, data[0]))
                if lst:
                    s, v = lst.pop(0)
                    tr.notes.append(Note(s, max(tick, s + 1), data[0], v, ch))
            elif typ == 0xc:
                tr.programs.setdefault(ch, data[0])
            elif typ == 0xb:
                tr.cc[data[0]] = tr.cc.get(data[0], 0) + 1
            elif typ == 0xe:
                tr.pitchbends += 1
        for (ch, p), lst in on.items():     # hanging notes
            for s, v in lst:
                tr.notes.append(Note(s, tick, p, v, ch))
        tr.notes.sort(key=lambda n: (n.start, n.pitch))
        tracks.append(tr)
        i = end
    if not tempos:
        tempos = [(0, 120.0)]
    return Midi(ppq, tracks, sorted(tempos), sorted(timesigs), keysigs)


def write_midi(path, ppq, tracks_notes, bpm=120.0, names=None):
    """Write a format-1 MIDI. tracks_notes: list of lists of Note (channel respected)."""
    def vlq(v):
        out = [v & 0x7f]; v >>= 7
        while v:
            out.insert(0, (v & 0x7f) | 0x80); v >>= 7
        return bytes(out)
    chunks = []
    meta = vlq(0) + b'\xff\x51\x03' + int(60e6 / bpm).to_bytes(3, 'big') + vlq(0) + b'\xff\x2f\x00'
    chunks.append(b'MTrk' + struct.pack('>I', len(meta)) + meta)
    for ti, notes in enumerate(tracks_notes):
        ev = []
        for n in notes:
            ev.append((n.start, 1, bytes([0x90 | n.channel, n.pitch, max(1, n.vel)])))
            ev.append((n.end, 0, bytes([0x80 | n.channel, n.pitch, 0])))
        ev.sort(key=lambda e: (e[0], e[1]))
        body, last = b'', 0
        if names and ti < len(names):
            nm = names[ti].encode()
            body += vlq(0) + b'\xff\x03' + vlq(len(nm)) + nm
        for t, _, data in ev:
            body += vlq(t - last) + data; last = t
        body += vlq(0) + b'\xff\x2f\x00'
        chunks.append(b'MTrk' + struct.pack('>I', len(body)) + body)
    hdr = b'MThd' + struct.pack('>IHHH', 6, 1, len(chunks), ppq)
    open(path, 'wb').write(hdr + b''.join(chunks))


NOTE_NAMES = 'C C# D D# E F F# G G# A A# B'.split()


def note_name(p):
    return f'{NOTE_NAMES[p % 12]}{p // 12 - 1}'


def parse_note(s):
    """'C#5' / 'Bb3' / 61 -> midi number."""
    if isinstance(s, int):
        return s
    s = s.strip()
    base = 'C D EF G A B'.index(s[0].upper())
    i = 1
    if s[1] == '#': base += 1; i = 2
    elif s[1] == 'b': base -= 1; i = 2
    return base + (int(s[i:]) + 1) * 12


GM_PROGRAMS = [
    'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano', 'Electric Piano 1',
    'Electric Piano 2', 'Harpsichord', 'Clavinet', 'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba',
    'Xylophone', 'Tubular Bells', 'Dulcimer', 'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ',
    'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion', 'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)',
    'Electric Guitar (jazz)', 'Electric Guitar (clean)', 'Electric Guitar (muted)', 'Overdriven Guitar',
    'Distortion Guitar', 'Guitar Harmonics', 'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)',
    'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2', 'Violin', 'Viola', 'Cello',
    'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani', 'String Ensemble 1',
    'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Choir',
    'Orchestra Hit', 'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1',
    'Synth Brass 2', 'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon',
    'Clarinet', 'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
    'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)', 'Lead 5 (charang)',
    'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)', 'Pad 1 (new age)', 'Pad 2 (warm)',
    'Pad 3 (polysynth)', 'Pad 4 (choir)', 'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
    'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)', 'FX 5 (brightness)', 'FX 6 (goblins)',
    'FX 7 (echoes)', 'FX 8 (sci-fi)', 'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
    'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
    'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause',
    'Gunshot']

GM_DRUMS = {35: 'Kick 2', 36: 'Kick 1', 37: 'Side Stick', 38: 'Snare 1', 39: 'Clap', 40: 'Snare 2', 41: 'Low Floor Tom',
            42: 'Closed HH', 43: 'High Floor Tom', 44: 'Pedal HH', 45: 'Low Tom', 46: 'Open HH', 47: 'Low-Mid Tom',
            48: 'Hi-Mid Tom', 49: 'Crash 1', 50: 'High Tom', 51: 'Ride 1', 52: 'China', 53: 'Ride Bell',
            54: 'Tambourine', 55: 'Splash', 56: 'Cowbell', 57: 'Crash 2', 59: 'Ride 2'}
