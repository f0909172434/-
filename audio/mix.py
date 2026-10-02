"""Buses, reverbs, gates, mastering, WAV writing, QC and the overview plot."""
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


def qc_report(out, stems, T, log=print):
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
    for k, s in stems.items():
        log(f"  stem {k:9s} peak {db(np.max(np.abs(s))):6.1f} dBFS  integrated {integrated_lufs(s):6.1f} LUFS")
    # stereo / mono compatibility
    c = [float(np.corrcoef(out[0, ns(a):ns(a + 10)], out[1, ns(a):ns(a + 10)])[0, 1])
         for a in np.arange(0, n / SR - 10, 10) if np.any(out[:, ns(a):ns(a + 10)])]
    rep['lr_corr_min'] = min(c)
    log(f"L/R correlation per 10 s: min {min(c):.2f}, median {np.median(c):.2f} (mono-safe if > 0)")
    # level vs time
    log('\nlevel every 2 s  (t: RMS dBFS / peak dBFS / short-term LUFS)')
    tt, st = short_term_lufs(out, 3.0, 0.5)
    rows = []
    for t0 in np.arange(0, n / SR, 2.0):
        seg = out[:, ns(t0):ns(t0 + 2.0)]
        rms = db(np.sqrt(np.mean(seg ** 2)))
        pk = db(np.max(np.abs(seg)))
        s = float(np.interp(t0 + 1.0, tt, st))
        rows.append((t0, rms, pk, s))
    for i in range(0, len(rows), 4):
        log('  ' + ' | '.join(f'{r[0]:5.0f}s {r[1]:6.1f} {r[2]:6.1f} {r[3]:6.1f}' for r in rows[i:i + 4]))
    rep['levels'] = rows
    # structural silences
    for a, b, name in [(T['silence'] + 0.1, T['supernova'] - 0.05, 'pre-supernova black'),
                       (T['heart_stop'] + 0.1, T['harmonic'] - 0.02, 'heartbeat-stop bar')]:
        seg = out[:, ns(a):ns(b)]
        log(f'silence check {name:22s} {a:.2f}-{b:.2f}s: RMS {db(np.sqrt(np.mean(seg ** 2))):.1f} dBFS, '
            f'peak {db(np.max(np.abs(seg))):.1f} dBFS')
    # sync
    log('\nsync check (half-max onset in band vs. timeline):')
    checks = [('boot blip 1', T['boot'] + T['boot_lines'][0]['t'], (1000, 4000), stems['sfx']),
              ('boot blip 5', T['boot'] + T['boot_lines'][4]['t'], (1000, 4000), stems['sfx']),
              ('hard-cut boom', T['hard_cut'], (20, 200), stems['sfx']),
              ('presents piano', T['presents_note'], (30, 400), stems['music']),
              ('leitmotif #1', T['lock1'], (1000, 1400), stems['music']),
              ('SUPERNOVA', T['supernova'], (20, 300), out),
              ('ignition impact', T['ignition'], (25, 150), stems['sfx']),
              ('sunrise timp+cym', T['sunrise'], (84, 91), stems['music']),
              ('heart stops/harm.', T['harmonic'], (1500, 2000), stems['music']),
              ('first heartbeat', T['heart'], (30, 120), stems['sfx']),
              ('climax impact', T['climax'], (20, 200), stems['sfx']),
              ('SIGNAL LOST beep', T['lost'], (400, 600), stems['sfx']),
              ('reacquire motif', T['reacquire'], (1100, 1250), stems['music']),
              ('HOME chime', T['home'], (1700, 1820), stems['sfx'])]
    sync = []
    for name, t, band, src in checks:
        on, pk = onset_time(src, t, band)
        d = (on - t) * 1000
        sync.append((name, t, on, d))
        log(f'  {name:18s} expected {t:7.3f}s  measured {on:7.3f}s  delta {d:+6.1f} ms  '
            f'({"OK" if abs(d) <= 1000 / 24 else "CHECK"}, 1 frame = 41.7 ms)')
    rep['sync'] = sync
    return rep


def overview_png(path, out, stems, T, marks, log=print):
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
    except Exception as e:  # pragma: no cover
        log(f'  (matplotlib unavailable: {e}; skipping overview)')
        return
    from scipy import signal
    n = out.shape[1]
    dur = n / SR
    fig, ax = plt.subplots(4, 1, figsize=(26, 15), sharex=True,
                           gridspec_kw=dict(height_ratios=[1.1, 1.0, 1.0, 2.2]))
    fig.patch.set_facecolor('#0d0f12')
    for a in ax:
        a.set_facecolor('#0d0f12')
        a.tick_params(colors='#aab')
        for s in a.spines.values():
            s.set_color('#334')
    # waveform envelope
    hop = ns(0.05)
    m = out.mean(axis=0)[: (n // hop) * hop].reshape(-1, hop)
    tt = np.arange(m.shape[0]) * hop / SR
    ax[0].fill_between(tt, m.min(axis=1), m.max(axis=1), color='#e8c37a', lw=0)
    ax[0].set_ylim(-1, 1)
    ax[0].set_ylabel('master', color='#aab')
    ax[0].set_title('THE LONG WAY HOME (Gui Tu) — score & sound design overview (master, 48 kHz / 24-bit)',
                    color='#dde', fontsize=14, loc='left')
    # stems envelopes
    cols = {'music': '#7ab8e8', 'sfx': '#e87a7a', 'ambience': '#8ae87a'}
    for k, s in stems.items():
        e = np.sqrt((s.mean(axis=0)[: (n // hop) * hop].reshape(-1, hop) ** 2).mean(axis=1))
        ax[1].plot(tt, db(e), color=cols.get(k, '#ccc'), lw=0.8, label=k)
    ax[1].set_ylim(-80, 0)
    ax[1].set_ylabel('stem RMS dBFS', color='#aab')
    ax[1].legend(loc='lower left', facecolor='#1a1d22', labelcolor='#dde', fontsize=9)
    # loudness
    t3, s3 = short_term_lufs(out, 3.0, 0.25)
    t4, s4 = short_term_lufs(out, 0.4, 0.1)
    ax[2].plot(t4, s4, color='#556', lw=0.6, label='momentary (0.4 s)')
    ax[2].plot(t3, s3, color='#f0e0a0', lw=1.2, label='short-term (3 s)')
    ax[2].axhline(integrated_lufs(out), color='#e8c37a', ls='--', lw=0.8, label='integrated')
    ax[2].set_ylim(-60, -2)
    ax[2].set_ylabel('LUFS', color='#aab')
    ax[2].legend(loc='lower left', facecolor='#1a1d22', labelcolor='#dde', fontsize=9)
    # log-frequency spectrogram
    x = out.mean(axis=0)
    f, t, Z = signal.stft(x, fs=SR, nperseg=4096, noverlap=4096 - 2400)
    S = np.abs(Z)
    fl = np.geomspace(25, 20000, 300)
    idx = np.searchsorted(f, fl)
    S2 = S[np.clip(idx, 0, len(f) - 1)]
    D = 20 * np.log10(S2 + 1e-9)
    D = np.clip(D - D.max(), -100, 0)
    ax[3].imshow(D, origin='lower', aspect='auto', extent=[0, dur, 0, len(fl)], cmap='magma', vmin=-95, vmax=0)
    yt = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
    ax[3].set_yticks([np.searchsorted(fl, v) for v in yt])
    ax[3].set_yticklabels([f'{v // 1000}k' if v >= 1000 else str(v) for v in yt])
    ax[3].set_ylabel('Hz', color='#aab')
    ax[3].set_xlabel('time (s)', color='#aab')
    ax[3].set_xticks(np.arange(0, dur + 1, 10))
    for t0, label in marks:
        for a in ax:
            a.axvline(t0, color='#ffffff', alpha=0.18, lw=0.7)
        ax[0].text(t0 + 0.4, 0.92, label, color='#dde', fontsize=7.5, rotation=90, va='top')
    plt.tight_layout()
    fig.savefig(path, dpi=90, facecolor=fig.get_facecolor())
    plt.close(fig)
    log(f'  wrote {path}')
