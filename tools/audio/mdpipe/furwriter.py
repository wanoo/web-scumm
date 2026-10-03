# Minimal Furnace .fur (format 232, Furnace 0.6.8.3) writer
import struct, zlib

VERSION = 232

def u8(v): return struct.pack('<B', v & 0xff)
def s8(v): return struct.pack('<b', v)
def u16(v): return struct.pack('<H', v)
def u32(v): return struct.pack('<I', v)
def f32(v): return struct.pack('<f', v)
def STR(s): return s.encode('utf-8') + b'\0'

def block(tag, data): return tag + u32(len(data)) + data

def feature(code, data): return code + u16(len(data)) + data

# ---------- instruments ----------
def fm_op(ar=31, dr=0, d2r=0, rr=15, sl=0, tl=0, mult=1, dt=0, rs=0, am=0, ssg=0, kvs=2):
    return dict(ar=ar, dr=dr, d2r=d2r, rr=rr, sl=sl, tl=tl, mult=mult, dt=dt, rs=rs, am=am, ssg=ssg, kvs=kvs)

def ins_fm(name, alg, fb, ops, ams=0, fms=0):
    """ops given in musical order OP1, OP2, OP3, OP4; stored in YM register order 1,3,2,4."""
    d = u8(0xF4) + u8((alg << 4) | fb) + u8((ams << 3) | fms) + u8(0x20) + u8(0)
    for o in (ops[0], ops[2], ops[1], ops[3]):
        d += u8((o['dt'] + 3) << 4 | o['mult'])
        d += u8(o['tl'])
        d += u8((o['rs'] << 6) | o['ar'])
        d += u8((o['am'] << 7) | o['dr'])
        d += u8((o['kvs'] << 5) | o['d2r'])
        d += u8((o['sl'] << 4) | o['rr'])
        d += u8(o['ssg'])
        d += u8(0)
    body = feature(b'NA', STR(name)) + feature(b'FM', d) + b'EN'
    return block(b'INS2', u16(VERSION) + u16(1) + body)

def macro(code, vals, loop=255, rel=255):
    return u8(code) + u8(len(vals)) + u8(loop) + u8(rel) + u8(0) + u8(0) + u8(0) + u8(1) + bytes(v & 0xff for v in vals)

def ins_psg(name, vol, duty=None, arp=None):
    m = macro(0, vol)
    if arp: m += macro(1, arp)
    if duty is not None: m += macro(2, duty)
    m += u8(255)
    body = feature(b'NA', STR(name)) + feature(b'MA', u16(8) + m) + b'EN'
    return block(b'INS2', u16(VERSION) + u16(0) + body)

def ins_sample(name, sample_idx):
    sm = u16(sample_idx) + u8(0) + u8(32)
    body = feature(b'NA', STR(name)) + feature(b'SM', sm) + b'EN'
    return block(b'INS2', u16(VERSION) + u16(4) + body)

def sample_block(name, data8, rate):
    d = STR(name) + u32(len(data8)) + u32(rate) + u32(rate) + u8(8) + u8(0) + u8(0) + u8(0)
    d += struct.pack('<i', -1) + struct.pack('<i', -1)
    d += u32(0xffffffff) + u32(0) + u32(0) + u32(0)
    d += bytes(data8)
    return block(b'SMP2', d)

# ---------- patterns ----------
def pattern_block(ch, idx, rows, patlen):
    """rows: list (len patlen) of None or dict(note, ins, vol, fx=[(c,v),...])"""
    d = u8(0) + u8(ch) + u16(idx) + STR('')
    for r in rows:
        if not r:
            d += u8(0); continue
        mask = 0; fxmask = 0; payload = b''
        if r.get('note') is not None: mask |= 1; payload += u8(r['note'])
        if r.get('ins') is not None: mask |= 2; payload += u8(r['ins'])
        if r.get('vol') is not None: mask |= 4; payload += u8(r['vol'])
        fx = r.get('fx', [])
        assert len(fx) <= 4, r
        fxp = b''
        for k, (c, v) in enumerate(fx):
            fxmask |= (3 << (2 * k)); fxp += u8(c) + u8(v)
        if fx: mask |= 32
        d += u8(mask) + (u8(fxmask) if fx else b'') + payload + fxp
    d += u8(0xff)
    return block(b'PATN', d)

def adir(): return block(b'ADIR', u32(0))

# ---------- whole song ----------
def build_fur(*, name, author, comment, systems, sysvols, patlen, orders, effcols, speeds,
              hz, instruments, samples, patterns, chan_names, vtempo=(150, 150), hl=(8, 32),
              no_opn2_vol=True, system_name='Sega Genesis/Mega Drive', category='',
              chip_flags=('clockSel=0\n', 'chipType=0\nclockSel=0\nnoEasyNoise=true\n')):
    nch = len(orders)
    ordlen = len(orders[0])

    def info(ins_ptrs, smp_ptrs, pat_ptrs, adir_ptrs, flag_ptrs=()):
        d = u8(0) + u8(speeds[0]) + u8(speeds[1 % len(speeds)]) + u8(1) + f32(hz)
        d += u16(patlen) + u16(ordlen) + u8(hl[0]) + u8(hl[1])
        d += u16(len(instruments)) + u16(0) + u16(len(samples)) + u32(len(patterns))
        d += bytes(systems + [0] * (32 - len(systems)))
        d += bytes([64] * 32) + bytes(32)
        fp = list(flag_ptrs) + [0] * (32 - len(flag_ptrs))
        d += b''.join(u32(x) for x in fp)
        d += STR(name) + STR(author) + f32(440.0)
        # compat flags (20): defaults of a new Furnace song
        d += bytes([0, 2, 2, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1])
        for p in ins_ptrs: d += u32(p)
        for p in smp_ptrs: d += u32(p)
        for p in pat_ptrs: d += u32(p)
        for ch in range(nch): d += bytes(orders[ch])
        d += bytes(effcols)
        d += bytes([3] * nch) + bytes(nch)
        for n in chan_names: d += STR(n)
        for n in chan_names: d += STR('')
        d += STR(comment)
        d += f32(1.0)
        # extended compat (28 bytes)
        ext = [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 4, 0, 1 if no_opn2_vol else 0, 1, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0]
        d += bytes(ext)
        d += u16(vtempo[0]) + u16(vtempo[1])
        d += STR('') + STR('') + u8(0) + bytes(3)
        d += STR(system_name) + STR(category) + STR('') + STR('') + STR('') + STR('')
        for v in sysvols: d += f32(v) + f32(0.0) + f32(0.0)
        d += u32(0) + u8(1)
        d += bytes(8)
        sp = list(speeds) + [0] * (16 - len(speeds))
        d += u8(len(speeds)) + bytes(sp) + u8(0)
        for p in adir_ptrs: d += u32(p)
        return block(b'INFO', d)

    hdr_len = 32
    dummy = info([0] * len(instruments), [0] * len(samples), [0] * len(patterns), [0, 0, 0], [0] * len(chip_flags))
    pos = hdr_len + len(dummy)
    blobs = []
    flag_ptrs = []
    for f in chip_flags:
        flag_ptrs.append(pos); b = block(b'FLAG', STR(f)); blobs.append(b); pos += len(b)
    adir_ptrs = []
    for _ in range(3):
        adir_ptrs.append(pos); b = adir(); blobs.append(b); pos += len(b)
    ins_ptrs = []
    for b in instruments: ins_ptrs.append(pos); blobs.append(b); pos += len(b)
    smp_ptrs = []
    for b in samples: smp_ptrs.append(pos); blobs.append(b); pos += len(b)
    pat_ptrs = []
    for b in patterns: pat_ptrs.append(pos); blobs.append(b); pos += len(b)
    inf = info(ins_ptrs, smp_ptrs, pat_ptrs, adir_ptrs, flag_ptrs)
    assert len(inf) == len(dummy)
    header = b'-Furnace module-' + u16(VERSION) + u16(0) + u32(hdr_len) + bytes(8)
    raw = header + inf + b''.join(blobs)
    return zlib.compress(raw, 9)
