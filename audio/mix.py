"""Buses, reverbs, gates, mastering, WAV writing, QC and the overview image (卜 ORACLE)."""
from __future__ import annotations

import contextlib
import struct

import numpy as np

from dsp import (SR, ns, pan, make_ir, convolve_stereo, tv_lowpass, k_weight, integrated_lufs,
                 short_term_lufs, true_peak, limiter, compressor, hp, bp, undb, db)


class Layer:
    """A (possibly time-limited) layer of a bus: dry + reverb sends."""

    def __init__(self, name, t0, t1, n_total):
        self.name = name
        self.i0 = ns(t0)
        self.i1 = min(ns(t1), n_total)
        self.n = self.i1 - self.i0
        self.bufs = {}

    def buf(self, key):
        if key not in self.bufs:
            self.bufs[key] = np.zeros((2, self.n), np.float32)
        return self.bufs[key]


class Bus:
    def __init__(self, name, n, layers=None):
        self.name = name
        self.n = n
        self.layers = {'main': Layer('main', 0, n / SR, n), 'free': Layer('free', 0, n / SR, n)}
        for lname, (t0, t1) in (layers or {}).items():
            self.layers[lname] = Layer(lname, t0, t1, n)
        self._default = 'main'
        self.truncated = []

    @contextlib.contextmanager
    def layer(self, name):
        old = self._default
        self._default = name
        try:
            yield self
        finally:
            self._default = old

    def add(self, t, x, db_=0.0, send=None, layer=None):
        L = self.layers[layer or self._default]
        x = np.asarray(x, dtype=np.float64)
        if x.ndim == 1:
            x = pan(x, 0.0) * 0.7071
        if not np.all(np.isfinite(x)):
            raise ValueError(f'non-finite audio added to {self.name} at t={t}')
        i0 = int(round(t * SR)) - L.i0
        s0 = 0
        if i0 < 0:
            s0 = -i0
            i0 = 0
        m = min(x.shape[1] - s0, L.n - i0)
        if m <= 0:
            return
        if m < x.shape[1] - s0 and np.max(np.abs(x[:, s0 + m:])) > 1e-4:
            self.truncated.append((L.name, round(t, 2)))
        g = undb(db_)
        seg = (x[:, s0:s0 + m] * g).astype(np.float32)
        L.buf('dry')[:, i0:i0 + m] += seg
        for k, a in (send or {}).items():
            if a > 0:
                L.buf(k)[:, i0:i0 + m] += seg * np.float32(a)

    def muffle(self, layer, t0, t1, fc_pts):
        """Time-varying low-pass over a region of a layer (dry + sends)."""
        L = self.layers[layer]
        a, b = max(ns(t0) - L.i0, 0), min(ns(t1) - L.i0, L.n)
        ts = np.array([p[0] for p in fc_pts]) - (a + L.i0) / SR
        fs = np.log(np.array([p[1] for p in fc_pts], dtype=np.float64))
        fc = lambda tt: np.exp(np.interp(tt, ts, fs))
        for k, arr in L.bufs.items():
            arr[:, a:b] = tv_lowpass(arr[:, a:b].astype(np.float64), fc, order=2, nper=2048, hop=256)

    def render(self, irs, wet, gates):
        """Mix the layers into one stereo stem: dry + convolved sends, gated."""
        out = np.zeros((2, self.n), np.float32)
        for lname, L in self.layers.items():
            if not L.bufs:
                continue
            ext = L.n + max(ir.shape[1] for ir in irs.values())
            y = np.zeros((2, ext), np.float32)
            for k, arr in L.bufs.items():
                if k == 'dry':
                    y[:, :L.n] += arr
                else:
                    w = convolve_stereo(np.pad(arr, ((0, 0), (0, ext - L.n))), irs[k])
                    y += w * np.float32(wet[k])
            m = min(ext, self.n - L.i0)
            y = y[:, :m]
            g = gates.get((self.name, lname)) or gates.get(('*', lname))
            if g:
                tt = (np.arange(m) + L.i0) / SR
                gt = np.array([p[0] for p in g])
                gv = np.array([p[1] for p in g])
                y = y * np.interp(tt, gt, gv).astype(np.float32)[None]
            out[:, L.i0:L.i0 + m] += y
        return out


# ----------------------------------------------------------------------------
# WAV (24-bit PCM)
# ----------------------------------------------------------------------------
def write_wav24(path, x):
    x = np.clip(np.asarray(x, dtype=np.float64), -1.0, 1.0 - 1.0 / 2 ** 23)
    ints = np.round(x.T * 8388607.0).astype('<i4')
    raw = ints.reshape(-1).view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    ch, sr, bits = x.shape[0], SR, 24
    fmt = struct.pack('<HHIIHH', 1, ch, sr, sr * ch * 3, ch * 3, bits)
    with open(path, 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', 4 + 8 + len(fmt) + 8 + len(raw)) + b'WAVE')
        f.write(b'fmt ' + struct.pack('<I', len(fmt)) + fmt)
        f.write(b'data' + struct.pack('<I', len(raw)) + raw)


def read_wav_info(path):
    with open(path, 'rb') as f:
        h = f.read(44)
    ch, sr = struct.unpack('<HI', h[22:28])
    bits = struct.unpack('<H', h[34:36])[0]
    nbytes = struct.unpack('<I', h[40:44])[0]
    return dict(channels=ch, sr=sr, bits=bits, frames=nbytes // (ch * bits // 8),
                seconds=nbytes / (ch * bits // 8) / sr)


# ----------------------------------------------------------------------------
# mastering
# ----------------------------------------------------------------------------
def master(stems, target_lufs=-15.0, ceiling_dbtp=-1.0, fade_out=None, log=print):
    names = list(stems)
    mix = sum(stems[k].astype(np.float64) for k in names)
    l0 = integrated_lufs(mix)
    g0 = undb(-19.0 - l0)
    mix *= g0
    comp, cgr = compressor(mix, thr_db=-15.0, ratio=1.8, win=0.08, smooth=0.3, knee=8.0)
    cg = undb(-cgr)
    l1 = integrated_lufs(comp)
    g1 = undb(target_lufs - l1)
    pre = comp * g1
    total = g0 * g1 * cg
    if fade_out is not None:
        total = total * fade_out
        pre = pre * fade_out[None]
    # limit, then make-up so the *limited* master lands on the loudness target
    mk = 1.0
    for _ in range(4):
        out, lg = limiter(pre * mk, ceiling_db=ceiling_dbtp - 0.25, look=0.004, release=0.06)
        for _ in range(4):
            tp = true_peak(out)
            if db(tp) <= ceiling_dbtp - 0.05:
                break
            out, lg2 = limiter(out, ceiling_db=ceiling_dbtp - 0.25 - (db(tp) - ceiling_dbtp) - 0.1)
            lg = lg * lg2
        li = integrated_lufs(out)
        if abs(li - target_lufs) < 0.15:
            break
        mk *= undb(target_lufs - li)
    lg = lg * mk
    gr = -db(np.maximum(lg / mk, 1e-9))
    hop = ns(2.0)
    busy = [(i * 2, float(np.max(gr[i * hop:(i + 1) * hop]))) for i in range(len(gr) // hop)]
    log('  limiter GR > 2 dB at: ' + ', '.join(f'{t}s:{g:.1f}' for t, g in busy if g > 2.0))
    total = total * lg
    stems_out = {k: stems[k].astype(np.float64) * total[None] for k in names}
    log(f'  master: raw {l0:.1f} LUFS, comp max GR {np.max(cgr):.1f} dB, limiter max GR {np.max(gr):.1f} dB')
    return out, stems_out, dict(raw_lufs=l0, comp_gr_max=float(np.max(cgr)), lim_gr_max=float(np.max(gr)))


# ----------------------------------------------------------------------------
# QC
# ----------------------------------------------------------------------------
def onset_time(x, t, band=None, win=(-0.3, 0.3)):
    """Onset = instant of steepest rise of the (band-limited) energy envelope in dB
    inside [t+win0, t+win1].  Robust against swells/beds leading into a hit."""
    from scipy.ndimage import uniform_filter1d
    a, b = ns(t + win[0] - 0.2), ns(t + win[1] + 0.05)
    seg = x[:, max(a, 0):b].mean(axis=0)
    if band:
        seg = bp(seg, band[0], band[1], order=2)
    e = 10 * np.log10(uniform_filter1d(seg ** 2, ns(0.004)) + 1e-14)
    d = ns(0.012)
    rise = np.full_like(e, -1e9)
    rise[d:] = e[d:] - e[:-d]
    lo = ns(0.2)
    i = lo + int(np.argmax(rise[lo:lo + ns(win[1] - win[0])]))
    return (max(a, 0) + i - d // 2) / SR, float(np.max(e))


def qc_report(out, stems, checks, silences, log=print):
    """checks: [(name, t, band, stem|'master', window)], silences: [(t0, t1, name)]."""
    rep = {}
    n = out.shape[1]
    log('\n=== QC ===')
    rep['seconds'] = n / SR
    rep['nan'] = bool(np.isnan(out).any())
    rep['sample_peak_dbfs'] = float(db(np.max(np.abs(out))))
    rep['true_peak_dbtp'] = float(db(true_peak(out)))
    rep['clipped'] = int(np.sum(np.abs(out) >= 0.9999))
    rep['dc'] = [float(np.mean(out[0])), float(np.mean(out[1]))]
    rep['lufs_i'] = integrated_lufs(out)
    log(f"length {rep['seconds']:.6f} s | NaN {rep['nan']} | sample peak {rep['sample_peak_dbfs']:.2f} dBFS | "
        f"true peak {rep['true_peak_dbtp']:.2f} dBTP | clipped samples {rep['clipped']}")
    log(f"DC offset L {rep['dc'][0]:.2e} R {rep['dc'][1]:.2e} | integrated loudness {rep['lufs_i']:.2f} LUFS")
    rep['stems'] = {}
    for k, s in stems.items():
        pk, li = float(db(np.max(np.abs(s)))), integrated_lufs(s)
        rep['stems'][k] = dict(peak_dbfs=pk, lufs_i=li)
        log(f"  stem {k:9s} peak {pk:6.1f} dBFS  integrated {li:6.1f} LUFS")
    c = [float(np.corrcoef(out[0, ns(a):ns(a + 10)], out[1, ns(a):ns(a + 10)])[0, 1])
         for a in np.arange(0, n / SR - 10, 10) if np.std(out[:, ns(a):ns(a + 10)]) > 1e-6]
    rep['lr_corr_min'] = min(c)
    log(f"L/R correlation per 10 s: min {min(c):.2f}, median {np.median(c):.2f} (mono-safe if > 0)")
    log('\nlevel every 2 s  (t: RMS dBFS / peak dBFS / short-term LUFS)')
    tt, st = short_term_lufs(out, 3.0, 0.5)
    rows = []
    for t0 in np.arange(0, n / SR, 2.0):
        seg = out[:, ns(t0):ns(t0 + 2.0)]
        rms = db(np.sqrt(np.mean(seg ** 2)))
        pk = db(np.max(np.abs(seg)))
        s = float(np.interp(t0 + 1.0, tt, st))
        rows.append((float(t0), float(rms), float(pk), s))
    for i in range(0, len(rows), 4):
        log('  ' + ' | '.join(f'{r[0]:5.0f}s {r[1]:6.1f} {r[2]:6.1f} {r[3]:6.1f}' for r in rows[i:i + 4]))
    rep['levels'] = rows
    rep['silences'] = []
    for a, b, name in silences:
        seg = out[:, ns(a):ns(b)]
        r_, p_ = float(db(np.sqrt(np.mean(seg ** 2)))), float(db(np.max(np.abs(seg))))
        rep['silences'].append((name, a, b, r_, p_))
        log(f'silence check {name:24s} {a:7.2f}-{b:7.2f}s: RMS {r_:6.1f} dBFS, peak {p_:6.1f} dBFS')
    log('\nsync check (steepest onset in band vs. timeline; 1 frame = 41.7 ms):')
    sync = []
    for name, t, band, src, win in checks:
        x = out if src == 'master' else stems[src]
        on, pk = onset_time(x, t, band, win)
        d = (on - t) * 1000
        ok = abs(d) <= 1000 / 24
        sync.append((name, t, on, d, ok))
        log(f'  {name:26s} expected {t:8.3f}s  measured {on:8.3f}s  delta {d:+6.1f} ms  {"OK" if ok else "CHECK"}')
    rep['sync'] = sync
    ds = np.array([abs(s[3]) for s in sync])
    rep['sync_max_abs_ms'] = float(ds.max())
    rep['sync_mean_abs_ms'] = float(ds.mean())
    log(f'  -> {int(np.sum([s[4] for s in sync]))}/{len(sync)} within one frame; max |delta| {ds.max():.1f} ms, '
        f'mean {ds.mean():.1f} ms')
    return rep


def _png(path, img):
    import zlib
    h, w, _ = img.shape
    raw = b''.join(b'\x00' + img[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def overview_png(path, out, stems, marks, sync_marks, log=print, W=1800):
    """Overview without matplotlib: waveform (min/max), stem RMS (dB), short-term loudness, log-frequency
    spectrogram; grey lines = audio cues, orange ticks = checked sync points. 10-s grid."""
    from scipy import signal
    n = out.shape[1]
    dur = n / SR
    Hw, Hs, Hl, Hsp, gap = 150, 150, 120, 300, 6
    H = Hw + Hs + Hl + Hsp + 3 * gap
    img = np.full((H, W, 3), 13, np.uint8)
    col = np.minimum((np.arange(n) * W) // n, W - 1)
    m = out.mean(axis=0)
    mn = np.full(W, 0.0)
    mx = np.full(W, 0.0)
    np.minimum.at(mn, col, m)
    np.maximum.at(mx, col, m)
    y0 = 0
    for x in range(W):
        a = int(Hw / 2 - mx[x] * Hw / 2)
        b = int(Hw / 2 - mn[x] * Hw / 2)
        img[y0 + max(a, 0):y0 + min(b + 1, Hw), x] = (232, 195, 122)
    y0 = Hw + gap
    cols = {'music': (122, 184, 232), 'sfx': (232, 122, 122), 'ambience': (138, 232, 122)}
    for k, s in stems.items():
        p = np.zeros(W)
        np.add.at(p, col, s.mean(axis=0) ** 2)
        cnt = np.bincount(col, minlength=W)
        lv = 10 * np.log10(p / np.maximum(cnt, 1) + 1e-12)
        yy = np.clip(((-lv) / 80.0) * Hs, 0, Hs - 1).astype(int)
        for x in range(W):
            img[y0 + yy[x], x] = cols.get(k, (200, 200, 200))
    y0 = Hw + Hs + 2 * gap
    tt, st = short_term_lufs(out, 3.0, 0.25)
    xs = np.clip((tt / dur * W).astype(int), 0, W - 1)
    ys = np.clip(((-st - 2) / 58.0) * Hl, 0, Hl - 1).astype(int)
    for lvl in (-16, -23, -40):
        img[y0 + int((-lvl - 2) / 58.0 * Hl), :] = (60, 60, 70)
    for x, y in zip(xs, ys):
        img[y0 + y, x] = (240, 224, 160)
    y0 = Hw + Hs + Hl + 3 * gap
    f, t, Z = signal.stft(m, fs=SR, nperseg=4096, noverlap=4096 - 2048)
    fl = np.geomspace(25, 20000, Hsp)
    S = np.abs(Z)[np.clip(np.searchsorted(f, fl), 0, len(f) - 1)]
    D = 20 * np.log10(S + 1e-9)
    D = np.clip((D - D.max() + 95) / 95, 0, 1)
    ti = np.clip((np.arange(W) / W * len(t)).astype(int), 0, len(t) - 1)
    D = D[::-1][:, ti]
    img[y0:y0 + Hsp] = np.stack([np.clip(D * 2.2 - 0.4, 0, 1) * 255, np.clip(D * 1.6 - 0.8, 0, 1) * 255,
                                 np.clip(1.2 - np.abs(D - 0.45) * 3, 0, 1) * 160], -1).astype(np.uint8)
    for s10 in np.arange(0, dur, 10):
        x = int(s10 / dur * W)
        img[:, x] = np.maximum(img[:, x], 40)
    for t0, _ in marks:
        x = min(int(t0 / dur * W), W - 1)
        img[:, x] = (110, 110, 120)
    for t0, _ in sync_marks:
        x = min(int(t0 / dur * W), W - 1)
        img[Hw - 12:Hw, x] = (255, 150, 40)
    _png(path, img)
    log(f'  wrote {path}')
