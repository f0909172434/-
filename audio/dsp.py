"""Core DSP toolkit for 歸途 THE LONG WAY HOME.

Everything here is pure numpy / scipy: band-limited oscillators (PolyBLEP),
noise colours, filters (static biquads + STFT time-varying filters), modal
resonators, envelopes, panning, saturation, synthetic reverb impulse
responses, loudness (ITU-R BS.1770 K-weighting) and a look-ahead limiter.
"""
from __future__ import annotations

import numpy as np
from scipy import signal
from scipy.ndimage import uniform_filter1d, minimum_filter1d

SR = 48000
TWO_PI = 2.0 * np.pi

# ----------------------------------------------------------------------------
# pitch helpers
# ----------------------------------------------------------------------------
_NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def n2m(name) -> float:
    """'D4' -> 62, 'Bb3' -> 58, 'F#5' -> 78. Numbers pass through."""
    if isinstance(name, (int, float, np.integer, np.floating)):
        return float(name)
    letter = name[0].upper()
    i, acc = 1, 0
    while i < len(name) and name[i] in '#b':
        acc += 1 if name[i] == '#' else -1
        i += 1
    octv = int(name[i:])
    return float(12 * (octv + 1) + _NOTE[letter] + acc)


def mtof(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=np.float64) - 69.0) / 12.0)


def ns(sec: float) -> int:
    return int(round(sec * SR))


def tvec(n: int) -> np.ndarray:
    return np.arange(n, dtype=np.float64) / SR


# ----------------------------------------------------------------------------
# envelopes
# ----------------------------------------------------------------------------
def pts_env(n, pts, db=False):
    """Piecewise-linear envelope from [(t, v), ...] (t in seconds)."""
    ts = np.array([p[0] for p in pts], dtype=np.float64)
    vs = np.array([p[1] for p in pts], dtype=np.float64)
    e = np.interp(tvec(n), ts, vs)
    if db:
        e = 10.0 ** (e / 20.0)
    return e


def asr(n, att, rel, curve=2.0):
    """Attack / sustain / release envelope over n samples (raised-cos edges)."""
    e = np.ones(n)
    a = min(ns(att), n)
    r = min(ns(rel), n - a)
    if a > 0:
        x = np.linspace(0, 1, a, endpoint=False)
        e[:a] = (0.5 - 0.5 * np.cos(np.pi * x)) ** (curve / 2.0)
    if r > 0:
        x = np.linspace(0, 1, r)
        e[n - r:] *= 0.5 + 0.5 * np.cos(np.pi * x)
    return e


def expdecay(n, t60, delay=0.0):
    t = tvec(n) - delay
    return np.where(t < 0, 1.0, 10.0 ** (-3.0 * np.maximum(t, 0) / t60))


def fade(x, fin=0.005, fout=0.005):
    x = np.array(x, dtype=np.float64, copy=True)
    n = x.shape[-1]
    a, b = min(ns(fin), n // 2), min(ns(fout), n // 2)
    if a > 0:
        x[..., :a] *= np.linspace(0, 1, a)
    if b > 0:
        x[..., n - b:] *= np.linspace(1, 0, b)
    return x


def onepole(x, tau):
    """One-pole lowpass smoothing with time constant tau (s)."""
    if tau <= 0:
        return x
    a = np.exp(-1.0 / (tau * SR))
    zi = signal.lfilter_zi([1 - a], [1, -a]) * x[..., :1]
    y, _ = signal.lfilter([1 - a], [1, -a], x, axis=-1, zi=zi)
    return y


def smooth_random(n, rate, r, lo=-1.0, hi=1.0):
    """Smooth random curve (control points every 1/rate s, cosine interp)."""
    npts = int(n / SR * rate) + 3
    pts = r.uniform(lo, hi, npts)
    x = tvec(n) * rate
    i = np.floor(x).astype(int)
    f = x - i
    f = 0.5 - 0.5 * np.cos(np.pi * f)
    return pts[i] * (1 - f) + pts[i + 1] * f


# ----------------------------------------------------------------------------
# oscillators (band-limited)
# ----------------------------------------------------------------------------
def phase_acc(freq, n, phase0=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    dt = f / SR
    ph = phase0 + np.cumsum(dt) - dt[0]
    return ph, dt


def _polyblep(p, dt):
    out = np.zeros_like(p)
    m = p < dt
    if np.any(m):
        t = p[m] / dt[m]
        out[m] = t + t - t * t - 1.0
    m = p > 1.0 - dt
    if np.any(m):
        t = (p[m] - 1.0) / dt[m]
        out[m] = t * t + t + t + 1.0
    return out


def saw(freq, n, phase0=0.0):
    ph, dt = phase_acc(freq, n, phase0)
    p = ph % 1.0
    return 2.0 * p - 1.0 - _polyblep(p, dt)


def square(freq, n, phase0=0.0, duty=0.5):
    ph, dt = phase_acc(freq, n, phase0)
    p1 = ph % 1.0
    p2 = (ph + 1.0 - duty) % 1.0
    s1 = 2.0 * p1 - 1.0 - _polyblep(p1, dt)
    s2 = 2.0 * p2 - 1.0 - _polyblep(p2, dt)
    return 0.5 * (s1 - s2) * 2.0


def sine(freq, n, phase0=0.0):
    ph, _ = phase_acc(freq, n, phase0)
    return np.sin(TWO_PI * ph)


# ----------------------------------------------------------------------------
# noise
# ----------------------------------------------------------------------------
def colored_noise(n, r, slope_db_oct=0.0, lo=15.0, hi=None, channels=None):
    """FFT-shaped noise. slope -3 = pink, -6 = brown. Normalised to RMS 1."""
    shape = (n,) if channels is None else (channels, n)
    w = r.standard_normal(shape)
    if slope_db_oct == 0.0 and hi is None:
        return w
    W = np.fft.rfft(w, axis=-1)
    f = np.fft.rfftfreq(n, 1.0 / SR)
    g = (np.maximum(f, lo) / 1000.0) ** (slope_db_oct / 6.0206)
    g[f < lo * 0.5] = 0.0
    if hi is not None:
        g /= np.sqrt(1.0 + (f / hi) ** 4)
    W *= g
    y = np.fft.irfft(W, n=n, axis=-1)
    y /= (np.sqrt(np.mean(y ** 2)) + 1e-12)
    return y


# ----------------------------------------------------------------------------
# filters
# ----------------------------------------------------------------------------
def _clipf(f):
    return float(np.clip(f, 5.0, 0.47 * SR))


def lp(x, fc, order=2):
    sos = signal.butter(order, _clipf(fc), 'low', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=-1)


def hp(x, fc, order=2):
    sos = signal.butter(order, _clipf(fc), 'high', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=-1)


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [_clipf(lo), _clipf(hi)], 'band', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=-1)


def _rbj(kind, f0, gain_db=0.0, q=0.707):
    A = 10 ** (gain_db / 40.0)
    w0 = TWO_PI * _clipf(f0) / SR
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2 * q)
    if kind == 'peak':
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == 'lowshelf':
        sa = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * cw + sa), 2 * A * ((A - 1) - (A + 1) * cw),
             A * ((A + 1) - (A - 1) * cw - sa)]
        a = [(A + 1) + (A - 1) * cw + sa, -2 * ((A - 1) + (A + 1) * cw),
             (A + 1) + (A - 1) * cw - sa]
    elif kind == 'highshelf':
        sa = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + sa), -2 * A * ((A - 1) + (A + 1) * cw),
             A * ((A + 1) + (A - 1) * cw - sa)]
        a = [(A + 1) - (A - 1) * cw + sa, 2 * ((A - 1) - (A + 1) * cw),
             (A + 1) - (A - 1) * cw - sa]
    elif kind == 'bandpass':  # constant 0 dB peak gain
        b = [alpha, 0.0, -alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    else:
        raise ValueError(kind)
    b = np.array(b) / a[0]
    a = np.array(a) / a[0]
    return np.concatenate([b, a])[None, :]


def eq(x, bands):
    """bands: list of (kind, f0, gain_db, q)."""
    if not bands:
        return x
    sos = np.concatenate([_rbj(k, f, g, q) for (k, f, g, q) in bands], axis=0)
    return signal.sosfilt(sos, x, axis=-1)


def formant_bank(x, formants):
    """Parallel band-pass resonators. formants: [(freq, bw, gain_db)]."""
    y = np.zeros_like(x)
    for f, bw, g in formants:
        if f >= 0.45 * SR:
            continue
        sos = _rbj('bandpass', f, 0.0, f / bw)
        y += (10 ** (g / 20.0)) * signal.sosfilt(sos, x, axis=-1)
    return y


def tv_filter(x, mask_fn, nper=2048, hop=512):
    """Time-varying zero-phase-ish filter via STFT masking.
    mask_fn(freqs[F], times[T]) -> gains[F, T]"""
    n = x.shape[-1]
    f, t, Z = signal.stft(x, fs=SR, nperseg=nper, noverlap=nper - hop)
    M = mask_fn(f, t)
    Z = Z * M
    _, y = signal.istft(Z, fs=SR, nperseg=nper, noverlap=nper - hop)
    y = y[..., :n]
    if y.shape[-1] < n:
        y = np.pad(y, [(0, 0)] * (y.ndim - 1) + [(0, n - y.shape[-1])])
    return y


def tv_lowpass(x, fc_curve, order=2, nper=2048, hop=256):
    """fc_curve: array of length n (Hz) sampled per sample, or callable(t)."""
    n = x.shape[-1]

    def mask(f, t):
        if callable(fc_curve):
            fc = np.asarray(fc_curve(t), dtype=np.float64)
        else:
            idx = np.clip((t * SR).astype(int), 0, n - 1)
            fc = np.asarray(fc_curve)[idx]
        fc = np.maximum(fc, 20.0)
        return 1.0 / np.sqrt(1.0 + (f[:, None] / fc[None, :]) ** (2 * order))
    return tv_filter(x, mask, nper=nper, hop=hop)


def modal(exc, freqs, t60s, amps):
    """Bank of 2-pole resonators (modal synthesis) driven by exc."""
    y = np.zeros_like(exc, dtype=np.float64)
    for f, T, a in zip(freqs, t60s, amps):
        if f >= 0.45 * SR or a == 0:
            continue
        r = 10.0 ** (-3.0 / (T * SR))
        w = TWO_PI * f / SR
        y += a * signal.lfilter([np.sin(w)], [1.0, -2.0 * r * np.cos(w), r * r], exc)
    return y


def dc_block(x, fc=8.0):
    return hp(x, fc, order=1)


# ----------------------------------------------------------------------------
# stereo / dynamics helpers
# ----------------------------------------------------------------------------
def pan(x, p=0.0):
    """Constant-power pan of mono x; p in [-1, 1] (scalar or array)."""
    a = (np.clip(np.asarray(p, dtype=np.float64), -1, 1) + 1.0) * np.pi / 4.0
    return np.stack([x * np.cos(a), x * np.sin(a)]) * np.sqrt(2.0)


def as_stereo(x):
    x = np.asarray(x)
    return np.stack([x, x]) if x.ndim == 1 else x


def width(st, w):
    m = 0.5 * (st[0] + st[1])
    s = 0.5 * (st[0] - st[1]) * w
    return np.stack([m + s, m - s])


def sat(x, drive=1.0):
    if drive <= 0:
        return x
    return np.tanh(drive * x) / np.tanh(drive)


def haas(x, ms=12.0, side=1):
    """Mono -> wide stereo using a short decorrelating delay."""
    d = ns(ms / 1000.0)
    y = np.concatenate([np.zeros(d), x])[:len(x)]
    return np.stack([x, y]) if side > 0 else np.stack([y, x])


def db(x):
    return 20 * np.log10(np.maximum(np.abs(x), 1e-12))


def undb(d):
    return 10 ** (np.asarray(d) / 20.0)


# ----------------------------------------------------------------------------
# reverb: synthetic impulse responses with frequency-dependent decay
# ----------------------------------------------------------------------------
def make_ir(rt_low, rt_mid, rt_high, length, predelay=0.02, seed=0,
            er=12, er_gain=0.35, hf=10000.0, lf_cut=40.0):
    r = np.random.default_rng(seed)
    n = ns(length)
    noise = r.standard_normal((2, n))
    nper = 1024
    f, t, Z = signal.stft(noise, fs=SR, nperseg=nper, noverlap=nper - 256)
    lf = np.log10(np.maximum(f, 20.0))
    rt = np.interp(lf, np.log10([120.0, 800.0, 3000.0, 9000.0, 20000.0]),
                   [rt_low, rt_mid, 0.5 * (rt_mid + rt_high), rt_high, rt_high * 0.45])
    dec = 10.0 ** (-3.0 * t[None, :] / rt[:, None])
    tilt = 1.0 / np.sqrt(1.0 + (f / hf) ** 2)
    Z = Z * (dec * tilt[:, None])[None]
    _, ir = signal.istft(Z, fs=SR, nperseg=nper, noverlap=nper - 256)
    ir = ir[:, :n]
    # diffuse build-up
    bu = ns(0.06)
    ir[:, :bu] *= np.linspace(0, 1, bu) ** 1.5
    # early reflections
    for ch in range(2):
        for k in range(er):
            tt = r.uniform(0.004, 0.085)
            g = er_gain * (1 - tt / 0.1) * r.choice([-1, 1]) * r.uniform(0.4, 1.0)
            i = ns(tt)
            ir[ch, i] += g * np.sqrt(np.mean(ir[ch, :ns(0.2)] ** 2)) * 30
    ir = hp(ir, lf_cut, order=2)
    # tail fade to avoid truncation click
    tf = ns(0.3)
    ir[:, -tf:] *= np.linspace(1, 0, tf)
    ir = np.concatenate([np.zeros((2, ns(predelay))), ir], axis=1)
    ir /= np.sqrt(np.mean(np.sum(ir ** 2, axis=1)))
    return ir.astype(np.float32)


def convolve_stereo(x, ir):
    out = np.zeros_like(x, dtype=np.float32)
    n = x.shape[-1]
    for ch in range(2):
        if not np.any(x[ch]):
            continue
        y = signal.oaconvolve(x[ch].astype(np.float32), ir[ch])
        out[ch] = y[:n]
    return out


# ----------------------------------------------------------------------------
# loudness (ITU-R BS.1770-4, 48 kHz coefficients) and peaks
# ----------------------------------------------------------------------------
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285],
       [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def k_weight(x):
    y = signal.lfilter(_K1[0], _K1[1], x, axis=-1)
    return signal.lfilter(_K2[0], _K2[1], y, axis=-1)


def _block_ms(xk, win, hop):
    p = np.sum(xk.astype(np.float64) ** 2, axis=0)  # sum over channels
    c = np.concatenate([[0.0], np.cumsum(p)])
    w, h = ns(win), ns(hop)
    starts = np.arange(0, len(p) - w + 1, h)
    return (c[starts + w] - c[starts]) / w, starts


def integrated_lufs(x):
    ms, _ = _block_ms(k_weight(x), 0.4, 0.1)
    l = -0.691 + 10 * np.log10(ms + 1e-20)
    g = ms[l > -70]
    if len(g) == 0:
        return -99.0
    lr = -0.691 + 10 * np.log10(np.mean(g)) - 10
    g2 = ms[(l > -70) & (l > lr)]
    return float(-0.691 + 10 * np.log10(np.mean(g2)))


def short_term_lufs(x, win=3.0, hop=0.5):
    ms, starts = _block_ms(k_weight(x), win, hop)
    return (starts + ns(win) / 2) / SR, -0.691 + 10 * np.log10(ms + 1e-20)


def true_peak(x):
    up = signal.resample_poly(x, 4, 1, axis=-1)
    return float(np.max(np.abs(up)))


def limiter(x, ceiling_db=-1.2, look=0.004, release=0.08):
    """Look-ahead brick-wall limiter with smooth gain (no overshoot)."""
    thr = undb(ceiling_db)
    up = signal.resample_poly(x, 4, 1, axis=-1)
    pk = np.max(np.abs(up), axis=0).reshape(-1, 4).max(axis=1)[:x.shape[-1]]
    g = np.minimum(1.0, thr / np.maximum(pk, 1e-9))
    L = max(3, ns(look))
    g1 = minimum_filter1d(g, size=2 * L + 1, mode='nearest')
    g1 = uniform_filter1d(g1, size=L, mode='nearest')
    R = ns(release)
    g2 = minimum_filter1d(g, size=2 * R + 1, mode='nearest')
    g2 = uniform_filter1d(g2, size=R, mode='nearest')
    # slow component recovers smoothly; fast one guarantees the ceiling
    gain = np.minimum(g1, 0.5 * (g1 + g2))
    return x * gain[None, :], gain


def compressor(x, thr_db=-18.0, ratio=2.0, win=0.05, smooth=0.25, knee=6.0):
    """Gentle RMS bus compressor (stereo-linked)."""
    ms = uniform_filter1d(np.mean(x ** 2, axis=0), size=ns(win), mode='nearest')
    lev = 10 * np.log10(ms + 1e-12)
    over = lev - thr_db
    gr = np.where(over <= -knee / 2, 0.0,
                  np.where(over >= knee / 2, over * (1 - 1 / ratio),
                           (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee)))
    from scipy.ndimage import maximum_filter1d
    S = ns(smooth)
    gr = maximum_filter1d(gr, size=S, mode='nearest')
    gr = uniform_filter1d(gr, size=S, mode='nearest')
    return x * undb(-gr)[None, :], gr
