"""Sound design for 卜 ORACLE: the 3 a.m. room, the keyboard, data, the river of whispers,
the textures of each era, the night fire and the crack 卜 (everything synthesised).

Every sync-critical sound (keys, ticks, pings, the crack, the chimes) starts with its transient
on sample 0, so placing it at time t puts the audible onset exactly on t.
"""
from __future__ import annotations

import numpy as np
from scipy import signal

from dsp import (SR, TWO_PI, n2m, mtof, ns, tvec, pts_env, onepole, smooth_random, saw, square,
                 colored_noise, lp, hp, bp, eq, modal, tv_filter, pan, sat, fade, haas)
from instruments import glass_ping, wind_chime, bronze_bell


def R(seed):
    return np.random.default_rng(seed)


def P(x, p=0.0):
    """Mono -> stereo at pan p (same -3 dB centre convention as Bus.add)."""
    return pan(x, p) * 0.7071


ROOM = {'room': 0.22}
DATA = {'hall': 0.12, 'space': 0.35}
ERA = {'room': 0.25, 'hall': 0.2}


# ============================================================================
# building blocks
# ============================================================================
def whoosh(rise=1.4, fall=1.0, f_lo=250.0, f_hi=5000.0, seed=0, pans=(-0.7, 0.6), level=1.0, q=1.1, slope=-2.0):
    """Swells to a peak at t = rise, then decays; band-pass centre rides the envelope."""
    r = R(seed)
    n = ns(rise + fall)
    t = tvec(n)
    x = colored_noise(n, r, slope)
    env = np.where(t < rise, np.clip(t / rise, 0, 1) ** 3, np.exp(-np.maximum(t - rise, 0) / (fall / 4)))

    def mask(f, tt):
        e = np.interp(tt, t, env)
        fc = f_lo * (f_hi / f_lo) ** e
        lf = np.log2(np.maximum(f, 20))[:, None]
        return np.exp(-0.5 * ((lf - np.log2(fc)[None, :]) / q) ** 2)
    y = tv_filter(x, mask, nper=1024, hop=256) * env
    p = np.interp(t, [0, rise, rise + fall], [pans[0], 0.5 * (pans[0] + pans[1]), pans[1]])
    return fade(pan(y * 0.25 * level, p), 0.01, 0.1)


def impulses(n, times, amps, pans_, kernels, r):
    """Stereo impulse trains convolved with one of several short kernels (cheap crackle/clicks)."""
    out = np.zeros((2, n))
    groups = len(kernels)
    which = r.integers(0, groups, len(times))
    for g in range(groups):
        sel = np.nonzero(which == g)[0]
        if len(sel) == 0:
            continue
        imp = np.zeros((2, n))
        idx = np.clip((np.asarray(times)[sel] * SR).astype(int), 0, n - 1)
        a = np.asarray(amps)[sel]
        ang = (np.clip(np.asarray(pans_)[sel], -1, 1) + 1) * np.pi / 4
        np.add.at(imp[0], idx, a * np.cos(ang))
        np.add.at(imp[1], idx, a * np.sin(ang))
        k = kernels[g]
        for ch in range(2):
            out[ch] += signal.fftconvolve(imp[ch], k)[:n]
    return out


def wood_kernel(r, f_lo=900, f_hi=2800, t60=0.02, n_modes=3):
    """Short modal 'tok' kernel (wood, bamboo, keycaps)."""
    n = ns(max(t60 * 2.5, 0.01))
    exc = np.zeros(n)
    exc[0] = 1.0
    fr = np.sort(r.uniform(f_lo, f_hi, n_modes))
    y = modal(exc, fr, [t60 * r.uniform(0.6, 1.2) for _ in fr], [r.uniform(0.5, 1.0) for _ in fr])
    y += 0.5 * hp(r.standard_normal(n), 2500) * np.exp(-tvec(n) / 0.0007)
    return y / (np.max(np.abs(y)) + 1e-9)


# ============================================================================
# THE ROOM (3 a.m.)
# ============================================================================
def room_tone(dur, seed=0, fridge_off=None):
    """Room air + a fridge humming in the kitchen (60 Hz compressor family). fridge_off: time
    (relative) at which the compressor cycles off: relay click, a thunk and the hum winding down."""
    r = R(seed)
    n = ns(dur)
    t = tvec(n)
    air = hp(lp(colored_noise(n, r, -4.5, channels=2), 1600), 35) * 0.010
    wob = 1 + 0.0006 * smooth_random(n, 0.2, r)
    f = 60.0 * wob
    amp = 1.0 + 0.08 * smooth_random(n, 0.5, r)
    if fridge_off is not None:
        u = np.clip((t - fridge_off) / 1.4, 0, 1)
        f = f * (1 - 0.32 * u ** 0.7)
        amp = amp * np.where(t < fridge_off, 1.0, np.exp(-(t - fridge_off) / 0.42))
    ph = np.cumsum(f) / SR
    hum = np.zeros(n)
    for k, a in enumerate([0.30, 1.0, 0.22, 0.38, 0.10, 0.14, 0.04, 0.05]):
        hum += a * np.sin(TWO_PI * (k + 1) * ph + r.uniform(0, TWO_PI))
    rumble = lp(r.standard_normal(n), 140) * 0.6
    whine = np.sin(TWO_PI * 7.53 * ph) * 0.05
    fr = lp(hum + rumble + whine, 700) * amp * 0.012
    out = air + P(fr, -0.35) + 0.5 * haas(fr * 0.5, 17)
    if fridge_off is not None:
        i = ns(fridge_off)
        m = n - i
        tt = tvec(m)
        clk = bp(r.standard_normal(m), 1200, 5000) * np.exp(-tt / 0.002) * 0.02
        thunk = np.sin(TWO_PI * 58 * tt) * np.exp(-tt / 0.07) * np.minimum(tt / 0.004, 1) * 0.012
        thunk += lp(r.standard_normal(m), 300) * np.exp(-tt / 0.05) * 0.008
        out[:, i:] += P(lp(clk + thunk, 4000), -0.35)
    return out


def distant_car(dur=7.0, peak=2.8, seed=0):
    """A car passing far away, heard through the window (tyres + engine, doppler, L -> R)."""
    r = R(seed)
    n = ns(dur)
    t = tvec(n)
    x = (t - peak) / 1.5
    env = (1.0 / (1.0 + x * x) ** 1.5) * np.clip(t / 0.9, 0, 1) * np.clip((dur - t) / 0.8, 0, 1)
    dop = 1 + 0.035 * np.tanh(-(t - peak) / 0.9)
    tyres = eq(lp(colored_noise(n, r, -2.0), 900), [('peak', 420, 6.0, 0.8)])
    eng = lp(saw(31.0 * dop, n) + 0.5 * saw(62.0 * dop, n, 0.3), 260)
    y = lp((tyres * 0.8 + eng * 0.35) * env, 1100)
    p = np.clip(-0.75 + 1.45 * t / dur, -0.8, 0.8)
    return pan(y, p) * 0.7071 * 0.05


# ============================================================================
# KEYS AND UI
# ============================================================================
_KEY = {
    # body modes (Hz), t60s, amps; deck thump modes; release hold (s); level
    'key': ([1150, 1900, 2750, 3900, 5400], [0.022, 0.018, 0.014, 0.010, 0.007], [1.0, 0.8, 0.6, 0.4, 0.25],
            [190, 330], 0.10, 1.0),
    'bs': ([1300, 2100, 3000, 4200, 5800], [0.016, 0.013, 0.010, 0.008, 0.006], [1.0, 0.8, 0.55, 0.35, 0.2],
           [210, 360], 0.045, 0.62),
    'enter': ([780, 1350, 2100, 3100, 4400], [0.030, 0.024, 0.018, 0.012, 0.008], [1.0, 0.85, 0.6, 0.4, 0.25],
              [150, 260], 0.16, 1.45),
    'space': ([700, 1250, 2000, 3000], [0.030, 0.022, 0.016, 0.011], [1.0, 0.8, 0.5, 0.3], [140, 240], 0.12, 1.3),
    'mech': ([2100, 3300, 4500, 6200], [0.012, 0.010, 0.008, 0.006], [1.0, 0.8, 0.5, 0.3], [140, 260], 0.07, 1.2),
}


def laptop_key(kind='key', vel=1.0, seed=0, hold=None):
    """A laptop keystroke: bottom-out click + keycap/deck body at t = 0, softer release click later."""
    r = R(seed)
    modes, t60s, amps, deck, hold0, lvl = _KEY[kind]
    hold = hold0 * r.uniform(0.85, 1.2) if hold is None else hold
    n = ns(hold + 0.12)
    t = tvec(n)
    sc = r.uniform(0.9, 1.1)

    def stroke(i0, g, deck_g):
        m = n - i0
        tt = t[:m]
        exc = r.standard_normal(m) * np.exp(-tt / 0.00035)
        y = modal(exc, [f * sc * r.uniform(0.97, 1.03) for f in modes], t60s, amps)
        y += 0.55 * hp(exc, 3200)
        if deck_g:
            y += deck_g * modal(lp(exc, 600), [f * r.uniform(0.95, 1.05) for f in deck], [0.045, 0.03], [1.0, 0.5])
        return g * y
    y = np.zeros(n)
    y += stroke(0, 1.0, 0.9)
    if kind in ('enter', 'space'):  # stabiliser rattle
        y[ns(0.006):] += stroke(ns(0.006), 0.35, 0.0)[:n - ns(0.006)]
    i_rel = ns(hold)
    y[i_rel:] += stroke(i_rel, 0.32 if kind != 'mech' else 0.6, 0.15)[:n - i_rel]
    y *= np.minimum(t / 0.0002, 1)
    return fade(y * 0.25 * vel * lvl, 0, 0.01)


def ai_tick(seed=0, f=5274.0):
    """The AI typing: a tiny, even, glassy tick."""
    r = R(seed)
    n = ns(0.08)
    t = tvec(n)
    y = np.sin(TWO_PI * f * t) * np.exp(-t / 0.012) + 0.3 * np.sin(TWO_PI * 2.76 * f * t) * np.exp(-t / 0.004)
    y *= np.minimum(t / 0.0004, 1)
    y += hp(r.standard_normal(n), 6000) * np.exp(-t / 0.0006) * 0.25
    return fade(y * 0.1, 0, 0.01)


def send_tick(seed=0):
    """Soft 'sent' tick: a small upward glassy blip with a breath of air."""
    r = R(seed)
    n = ns(0.3)
    t = tvec(n)
    f = 1100 * 2 ** (1.2 * np.clip(t / 0.09, 0, 1))
    y = np.sin(TWO_PI * np.cumsum(f) / SR) * np.minimum(t / 0.004, 1) * np.exp(-t / 0.06)
    y += bp(r.standard_normal(n), 2000, 9000) * np.exp(-t / 0.07) * 0.25
    return fade(y * 0.05, 0, 0.03)


def grain(f, decay, r, n_len=None):
    n = n_len or ns(decay * 6 + 0.002)
    t = tvec(n)
    return np.sin(TWO_PI * f * t + r.uniform(0, TWO_PI)) * np.exp(-t / decay) * np.minimum(t / 0.0004, 1)


def spray(dur, times, pans_, r, f_range=(3500, 9500), decay=(0.003, 0.009), amp=(0.3, 1.0)):
    """A fine spray of tiny high ticks (each a short sine grain)."""
    n = ns(dur)
    out = np.zeros((2, n))
    for tg, p in zip(times, pans_):
        g = grain(r.uniform(*f_range), r.uniform(*decay), r) * r.uniform(*amp)
        i = ns(tg)
        m = min(len(g), n - i)
        if m > 0:
            out[:, i:i + m] += P(g[:m], p)
    return out


# ============================================================================
# THE WHISPERING RIVER (many quiet voices: STFT-synthesised whispers, never intelligible)
# ============================================================================
_VOW = np.array([(750, 1250, 2550, 3600), (500, 1800, 2550, 3600), (300, 2250, 3000, 3700),
                 (500, 900, 2450, 3500), (350, 800, 2300, 3400), (550, 1450, 2450, 3500)], float)
_FRIC = [(6500, 1800), (3200, 900), (5000, 3500), (1500, 1200), (2500, 1500)]


def _ola(Z, nper, hop, n):
    frames = np.fft.irfft(Z, n=nper, axis=1) * np.hanning(nper)[None, :]
    nfr = frames.shape[0]
    out = np.zeros(nfr * hop + nper)
    for j in range(nper // hop):
        out[j * hop: j * hop + nfr * hop] += frames[:, j * hop:(j + 1) * hop].reshape(-1)
    return out[:n]


def whisper_field(dur, nv, seed, syl=(0.10, 0.26), phrase=(0.7, 2.8), gap=(0.2, 1.8), lp_hz=8000.0,
                  lvl=(-14.0, 0.0), flow=0.3, scale=(0.88, 1.22), fric=1.0, env_pts=None, pan_w=0.95):
    """nv whispering voices (formant-shaped noise, syllables, phrases, pauses) drifting across the
    stereo field like objects carried by a river. Returns stereo, RMS-normalised to ~0.05."""
    r = R(seed)
    nper, hop = 1024, 256
    n = ns(dur)
    nfr = n // hop + 1
    f = np.fft.rfftfreq(nper, 1.0 / SR)
    shape = (1.0 / np.sqrt(1.0 + (f / lp_hz) ** 4)) * (1.0 / np.sqrt(1.0 + (250.0 / np.maximum(f, 1)) ** 4))
    ZL = np.zeros((nfr, len(f)), np.complex64)
    ZR = np.zeros((nfr, len(f)), np.complex64)
    fr_t = np.arange(nfr) * hop / SR
    bw = np.array([130.0, 170.0, 230.0, 320.0])
    for v in range(nv):
        sc = r.uniform(*scale)
        amp = np.zeros(nfr)
        F = np.tile(_VOW[5] * sc, (nfr, 1))
        fa = np.zeros(nfr)
        fc = np.full(nfr, 3000.0)
        fb = np.full(nfr, 1500.0)
        t = r.uniform(-1.0, gap[1])
        prev = _VOW[r.integers(0, 6)] * sc
        while t < dur:
            pl = r.uniform(*phrase)
            te = t + pl
            while t < te:
                d = r.uniform(*syl)
                a, b = int(max(t, 0) * SR / hop), int(min(t + d, dur) * SR / hop)
                if b > a:
                    k = np.arange(b - a)
                    w = np.sin(np.pi * (k + 0.5) / (b - a)) ** 0.7
                    vo = _VOW[r.integers(0, 6)] * sc
                    u = (k / max(b - a - 1, 1))[:, None]
                    F[a:b] = prev * (1 - u) * 0.35 + vo * (1 - 0.35 * (1 - u))
                    prev = vo
                    g = r.uniform(0.55, 1.0)
                    amp[a:b] = np.maximum(amp[a:b], g * w)
                    if r.random() < 0.65 * fric:
                        c = max(1, int(r.uniform(0.03, 0.08) * SR / hop))
                        cc, cb = _FRIC[r.integers(0, len(_FRIC))]
                        e = np.exp(-np.arange(min(c, b - a)) / max(c / 2.5, 1))
                        fa[a:a + len(e)] = np.maximum(fa[a:a + len(e)], g * e * r.uniform(0.5, 1.1))
                        fc[a:a + len(e)] = cc * sc
                        fb[a:a + len(e)] = cb
                        amp[a:a + len(e)] *= 0.4
                t += d * r.uniform(1.0, 1.25)
            t += r.uniform(*gap)
        act = np.nonzero((amp > 1e-3) | (fa > 1e-3))[0]
        if len(act) == 0:
            continue
        ff = f[None, :]
        Fa = F[act]
        mag = np.zeros((len(act), len(f)), np.float32)
        for j, (gj) in enumerate([1.0, 0.7, 0.45, 0.25]):
            mag += gj * np.exp(-0.5 * ((ff - Fa[:, j:j + 1]) / bw[j]) ** 2)
        mag *= amp[act][:, None]
        mag += fa[act][:, None] * 0.6 * np.exp(-0.5 * ((ff - fc[act][:, None]) / fb[act][:, None]) ** 2)
        mag *= shape[None, :] * 10 ** (r.uniform(*lvl) / 20)
        Zv = mag * np.exp(1j * r.uniform(0, TWO_PI, mag.shape)).astype(np.complex64)
        p0 = r.uniform(-pan_w, pan_w)
        dirn = r.choice([-1, 1])
        p = np.clip(p0 + dirn * flow * (fr_t[act] / max(dur, 1e-6)) * 2 * r.uniform(0.4, 1.0), -pan_w, pan_w)
        ang = (p + 1) * np.pi / 4
        ZL[act] += (np.cos(ang)[:, None] * Zv).astype(np.complex64)
        ZR[act] += (np.sin(ang)[:, None] * Zv).astype(np.complex64)
    y = np.stack([_ola(ZL, nper, hop, n), _ola(ZR, nper, hop, n)])
    y /= np.sqrt(np.mean(y ** 2)) + 1e-12
    y *= 0.05
    if env_pts is not None:
        y *= pts_env(n, env_pts)[None]
    return y


# ============================================================================
# ERAS (upstream): modem, teleprinter + Morse, quill, fortune sticks, yarrow, fire
# ============================================================================
_DTMF = {'1': (697, 1209), '2': (697, 1336), '3': (697, 1477), '4': (770, 1209), '5': (770, 1336),
         '6': (770, 1477), '7': (852, 1209), '8': (852, 1336), '9': (852, 1477), '0': (941, 1336)}


def modem(dur, seed=0):
    """A compressed dial-up handshake down a phone line: DTMF, answer tone, warble, screech."""
    r = R(seed)
    n = ns(dur)
    t = tvec(n)
    y = np.zeros(n)
    for k, d in enumerate('5550147'):
        a, b = ns(0.05 + 0.11 * k), ns(0.05 + 0.11 * k + 0.07)
        tt = t[a:b] - t[a]
        fl, fh = _DTMF[d]
        y[a:b] += (np.sin(TWO_PI * fl * tt) + np.sin(TWO_PI * fh * tt)) * 0.4 * fade(np.ones(b - a), 0.004, 0.004)
    a, b = ns(0.95), ns(1.55)
    tt = t[a:b] - t[a]
    rev = np.where((tt % 0.45) < 0.225, 1.0, -1.0)
    y[a:b] += np.sin(TWO_PI * 2100 * tt) * rev * 0.45 * fade(np.ones(b - a), 0.01, 0.01)
    a, b = ns(1.62), ns(2.3)
    m = b - a
    bits = np.repeat(r.integers(0, 2, m // 80 + 1), 80)[:m]
    fsk = np.where(bits > 0, 2400.0, 1200.0)
    y[a:b] += np.sin(TWO_PI * np.cumsum(fsk) / SR) * 0.35 * fade(np.ones(m), 0.01, 0.01)
    a, b = ns(2.3), n
    m = b - a
    tt = t[a:b] - t[a]
    nz = bp(r.standard_normal(m), 600, 3200)
    gate = np.repeat(r.choice([0.3, 1.0, 0.7], m // 960 + 1), 960)[:m]
    bong = np.sin(TWO_PI * np.cumsum(1800 * 2 ** (-0.8 * np.clip((tt - 0.25) / 0.4, 0, 1))) / SR)
    bong *= ((tt > 0.25) & (tt < 0.75)) * 0.3
    y[a:b] += (nz * onepole(gate, 0.004) * 0.5 + bong) * fade(np.ones(m), 0.01, 0.2)
    y = sat(bp(y, 300, 3400) * 1.6, 1.0)
    return fade(y * 0.06, 0.01, 0.2)


def mech_typing(dur, seed=0, rate=9.0):
    """A 1990s mechanical keyboard typing in bursts, in the next room."""
    r = R(seed)
    n = ns(dur)
    out = np.zeros((2, n))
    t = r.uniform(0.0, 0.3)
    while t < dur - 0.2:
        burst = r.integers(3, 9)
        for _ in range(burst):
            k = laptop_key('mech', r.uniform(0.6, 1.0), seed=int(r.integers(1 << 30)))
            i = ns(t)
            m = min(len(k), n - i)
            if m > 0:
                out[:, i:i + m] += P(k[:m], r.uniform(-0.2, 0.2))
            t += r.exponential(1.0 / rate) + 0.04
            if t >= dur - 0.2:
                break
        t += r.uniform(0.25, 0.7)
    return out


_MORSE = {'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.', 'G': '--.', 'H': '....',
          'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..', 'M': '--', 'N': '-.', 'O': '---', 'P': '.--.',
          'Q': '--.-', 'R': '.-.', 'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
          'Y': '-.--', 'Z': '--..'}


def morse(text, wpm=35.0, f=650.0, seed=0):
    """CW Morse: the telegram as it went down the line."""
    r = R(seed)
    u = 1.2 / wpm
    on = []
    t = 0.0
    for w, word in enumerate(text.split()):
        if w:
            t += 4 * u
        for c, ch in enumerate(word):
            if c:
                t += 2 * u
            for s, sym in enumerate(_MORSE[ch]):
                if s:
                    t += u
                d = u if sym == '.' else 3 * u
                on.append((t, d))
                t += d
    n = ns(t + 0.3)
    tt = tvec(n)
    key = np.zeros(n)
    for a, d in on:
        key[ns(a):ns(a + d)] = 1.0
    key = onepole(key, 0.0015)
    y = np.sin(TWO_PI * f * tt) * key + 0.02 * bp(r.standard_normal(n), 300, 2500)
    return bp(y, 350, 1600) * 0.08, t


def teleprinter(dur, seed=0, rate=6.5):
    """Teletype: motor hum, selector clicks and the typebar strike for each character, CR now and then."""
    r = R(seed)
    n = ns(dur)
    t = tvec(n)
    mot = (np.sin(TWO_PI * 60 * t) * 0.4 + np.sin(TWO_PI * 120 * t + 0.4) * 0.6 + lp(r.standard_normal(n), 200) * 0.5)
    mot = lp(mot, 400) * 0.02 + bp(r.standard_normal(n), 1300, 1600) * 0.002
    times, amps, pans_ = [], [], []
    k = 0
    tc = 0.08
    while tc < dur - 0.05:
        for j in range(r.integers(3, 6)):   # selector clicks
            times.append(tc + 0.004 * j + r.uniform(0, 0.002))
            amps.append(r.uniform(0.15, 0.3))
            pans_.append(0.15)
        times.append(tc + 0.026)            # typebar strike
        amps.append(r.uniform(0.8, 1.0))
        pans_.append(0.1 + 0.002 * (k % 60))
        k += 1
        tc += 1.0 / rate
        if k % 23 == 0:
            tc += 0.25
    kernels = [wood_kernel(r, 1800, 4200, 0.012, 3) for _ in range(3)] + [wood_kernel(r, 2200, 5200, 0.03, 4)]
    clat = impulses(n, times, amps, pans_, kernels, r)
    return clat * 0.11 + P(mot, 0.1)


def quill(dur, seed=0):
    """A quill on laid paper: scratchy strokes in words, a dip in the inkwell."""
    r = R(seed)
    n = ns(dur)
    t = tvec(n)
    env = np.zeros(n)
    tc = 0.15
    while tc < dur - 0.2:
        for _ in range(r.integers(3, 7)):       # strokes of one word
            d = r.uniform(0.06, 0.3)
            a, b = ns(tc), min(ns(tc + d), n)
            if b <= a:
                break
            k = np.arange(b - a) / SR
            press = np.sin(np.pi * k / d) ** 0.6 * r.uniform(0.5, 1.0)
            env[a:b] = np.maximum(env[a:b], press)
            tc += d + r.uniform(0.02, 0.09)
        tc += r.uniform(0.18, 0.45)
        if 1.5 < tc < 2.3 and r.random() < 0.8:
            tc += 0.45                           # dip
    stick = np.abs(lp(r.standard_normal(n), 420)) ** 1.5
    stick /= np.mean(stick) + 1e-9
    nz = r.standard_normal(n)
    scr = bp(nz, 2400, 9000) * stick * 0.6 + bp(nz, 1200, 3000) * 0.25 + bp(nz, 300, 1100) * 0.15
    y = scr * onepole(env, 0.004)
    i = ns(1.95)
    if i < n:
        tk = glass_ping('G7', 0.5, seed=seed, t60=0.25, click=0.6)
        m = min(len(tk), n - i)
        y[i:i + m] += tk[:m] * 0.5
    return P(y * 0.05, 0.25)


def fortune_sticks(dur, seed=0, rate=4.0):
    """求籤: a bamboo cylinder of sticks shaken in rhythm until one stick falls out and clatters."""
    r = R(seed)
    n = ns(dur)
    times, amps, pans_ = [], [], []
    tf = dur - 0.75
    k = 0
    tc = 0.1
    while tc < tf - 0.1:
        for _ in range(r.integers(12, 26)):
            times.append(tc + r.gamma(2.0, 0.018))
            amps.append(r.uniform(0.2, 1.0) * (0.7 + 0.3 * (k % 2)))
            pans_.append(r.uniform(-0.25, 0.25))
        k += 1
        tc += (1.0 / rate) * (1.12 if k % 2 else 0.88)
    kern = [wood_kernel(r, 1100, 2900, 0.018, 3) for _ in range(4)]
    out = impulses(n, times, amps, pans_, kern, r)
    body = np.zeros(n)
    exc = out.mean(axis=0)
    body = modal(exc, [390, 1120, 1830], [0.06, 0.04, 0.03], [1.0, 0.4, 0.2])
    out = out + P(body * 0.6, 0.0)
    # the one stick falls out: clack + bounces
    for j, (dt, a) in enumerate([(0.0, 1.0), (0.17, 0.45), (0.29, 0.25), (0.36, 0.12)]):
        kk = wood_kernel(r, 1500, 3800, 0.03, 4)
        i = ns(tf + dt)
        m = min(len(kk), n - i)
        if m > 0:
            out[:, i:i + m] += P(kk[:m] * a * 0.8, 0.35 + 0.05 * j)
    return out * 0.09


def yarrow(dur, seed=0):
    """蓍草: forty-nine dry stalks divided in two, then counted off by fours onto the mat."""
    r = R(seed)
    n = ns(dur)
    out = np.zeros((2, n))

    def swish(t0, d):
        m = ns(d)
        tt = tvec(m)
        e = np.sin(np.pi * np.clip(tt / d, 0, 1)) ** 1.5
        x = bp(colored_noise(m, r, -1.0), 1500, 8000) * e * 0.5
        tm = r.uniform(0, d, int(d * 260))
        cr = spray(d, tm, r.uniform(-0.3, 0.3, len(tm)), r, f_range=(2000, 6500), decay=(0.0008, 0.003),
                   amp=(0.2, 1.0))
        i = ns(t0)
        mm = min(m, n - i)
        out[:, i:i + mm] += (P(x, 0.0) + cr * np.interp(tt, [0, d], [1, 1])[None] * e[None] * 0.9)[:, :mm]

    times, amps, pans_ = [], [], []

    def count(t0, groups):
        tc = t0
        for g in range(groups):
            for j in range(4):
                times.append(tc + j * 0.105 + r.uniform(-0.01, 0.01))
                amps.append(r.uniform(0.5, 1.0))
                pans_.append(-0.2 + 0.1 * g)
            tc += 0.42 + r.uniform(-0.03, 0.05)
        return tc
    swish(0.15, 0.55)
    tc = count(0.85, 4)
    swish(tc + 0.1, 0.5)
    count(tc + 0.75, 3)
    kern = [wood_kernel(r, 1600, 4200, 0.007, 3) for _ in range(3)]
    out += impulses(n, times, amps, pans_, kern, r) * 0.6
    return out * 0.08


def fire(dur, seed=0, crackle_pts=((0, 8),), roar_pts=None):
    """A night fire: low roar, flicker, gas hiss pockets, crackles and pops, a log shifting."""
    r = R(seed)
    n = ns(dur)
    t = tvec(n)
    roar = lp(colored_noise(n, r, -6.0, channels=2), 220) * (0.7 + 0.3 * smooth_random(n, 0.8, r))
    flick = bp(colored_noise(n, r, -2.0, channels=2), 300, 1500) * (0.5 + 0.5 * smooth_random(n, 2.5, r)) ** 2 * 0.35
    pock = np.clip(smooth_random(n, 0.35, r), 0, 1) ** 2
    hiss = bp(r.standard_normal((2, n)), 2500, 7000) * pock * 0.08
    y = roar + flick + hiss
    if roar_pts is not None:
        y *= pts_env(n, roar_pts)[None]
    dens = pts_env(n, list(crackle_pts))
    ev = np.nonzero(r.random(n) < dens / SR)[0]
    # clusters: some events spawn a few followers
    extra = []
    for e in ev[r.random(len(ev)) < 0.25]:
        for _ in range(r.integers(1, 5)):
            extra.append(e + int(r.uniform(0.004, 0.05) * SR))
    ev = np.concatenate([ev, np.array(extra, dtype=int)]) if extra else ev
    ev = ev[ev < n]
    a = np.minimum(r.pareto(2.2, len(ev)) * 0.25 + 0.08, 1.6) * r.choice([-1, 1], len(ev))
    kern = [wood_kernel(r, 700, 4500, r.uniform(0.002, 0.009), 3) for _ in range(6)]
    cr = impulses(n, ev / SR, a, r.uniform(-0.6, 0.6, len(ev)), kern, r)
    y = y * 0.1 + cr * 0.12
    for _ in range(int(dur / 14) + 1):   # a log settles
        tl = r.uniform(1.0, max(dur - 1.5, 1.2))
        i = ns(tl)
        m = min(ns(0.6), n - i)
        tt = tvec(m)
        thud = lp(r.standard_normal(m), 250) * np.exp(-tt / 0.08) * 0.08
        y[:, i:i + m] += P(thud, r.uniform(-0.3, 0.3))
    return hp(y, 30, order=2)


# ============================================================================
# THE CRACK 卜
# ============================================================================
def rod_hiss(dur=2.5, seed=0):
    """The red-hot bronze rod meets the hollow: a tiny metal tick, then a sizzle that thickens, the shell
    creaking under the heat. Ends hard at dur (the crack takes over)."""
    r = R(seed)
    n = ns(dur + 0.01)
    t = tvec(n)
    y = np.zeros(n)
    tick = modal(np.r_[1.0, np.zeros(ns(0.08) - 1)], [2100, 3650, 5300], [0.03, 0.022, 0.015], [1.0, 0.6, 0.4])
    y[:len(tick)] += tick * 0.25
    grow = np.clip(t / dur, 0, 1)
    dens = 40 + 220 * grow ** 1.5
    ev = (r.random(n) < dens / SR).astype(float) * r.uniform(0.2, 1.0, n)
    bub = signal.lfilter([1.0], [1.0, -0.82], ev)
    nz = r.standard_normal(n)
    sizzle = bp(nz, 2500, 10000) * (0.25 + onepole(bub, 0.0015) * 1.5)
    steam = bp(nz, 800, 2500) * (0.3 + 0.7 * grow) * 0.35
    onset = 1 - np.exp(-t / 0.04)
    y += (sizzle * (0.35 + 0.65 * grow) + steam) * onset * 0.12
    for tc in (0.9, 1.65, 2.2):              # the shell creaks
        m = ns(0.22)
        i = ns(tc)
        if i + m > n:
            continue
        tt = tvec(m)
        f = r.uniform(45, 90) * (1 + 0.3 * tt / 0.22)
        pulses = (np.diff(np.floor(np.cumsum(f) / SR), prepend=0) > 0).astype(float)
        cr = bp(pulses * r.uniform(0.5, 1.0, m), 250, 1200) * np.sin(np.pi * tt / 0.22)
        y[i:i + m] += cr * 0.35 * (0.6 + 0.4 * tc / dur)
    y[-ns(0.01):] *= np.linspace(1, 0, ns(0.01))
    return y


def crack(soft=False, seed=0, twigs=(), gain=1.0):
    """卜: the oracle bone cracks. A dry, sharp snap at t = 0 (micro-fractures, a bright tear), the shell
    ringing like a struck bone plate ('puk') with its lowest mode on A4; the branch stroke 60 ms later;
    then the fine twigs splitting off. soft=True: the title version (rounder, longer ring)."""
    r = R(seed + (77 if soft else 0))
    L = 3.0 if soft else 2.0
    n = ns(L)
    t = tvec(n)
    y = np.zeros(n)
    ring_k = 1.7 if soft else 1.0
    modes = np.array([440, 707, 1032, 1488, 2015, 2660, 3470, 4420])
    t60 = np.array([0.40, 0.28, 0.22, 0.17, 0.13, 0.10, 0.075, 0.055]) * ring_k
    amps = np.array([1.0, 0.75, 0.6, 0.45, 0.38, 0.3, 0.22, 0.15])

    def snap(at, g, bright):
        i0 = ns(at)
        m = n - i0
        tt = t[:m]
        burst = r.standard_normal(m) * np.exp(-tt / 0.0012)
        for d, a in ((0.0008, 0.7), (0.0019, 0.5), (0.0031, 0.35), (0.0046, 0.22)):
            j = ns(d)
            burst[j:j + 3] += a * r.choice([-1, 1]) * np.array([1.0, -0.6, 0.2])
        burst[0] += 1.0
        burst[1] -= 0.6
        hi = bp(burst, 1500, 14000 if bright else 5200)
        ring = modal(lp(burst, 6000), modes * r.uniform(0.985, 1.015, len(modes)), t60, amps)
        fb = 165 * (1 - 0.3 * np.minimum(tt / 0.05, 1))
        body = np.sin(TWO_PI * np.cumsum(fb) / SR) * np.exp(-tt / 0.022) * np.minimum(tt / 0.0005, 1)
        sub = np.sin(TWO_PI * 70 * tt) * np.exp(-tt / 0.09) * np.minimum(tt / 0.002, 1)
        z = hi * (1.0 if bright else 0.45) + ring * 0.55 + body * 0.5 + sub * (0.0 if soft else 0.3)
        y[i0:] += g * z
    snap(0.0, 1.0, not soft)
    snap(0.06, 0.42, not soft)
    for k, tw in enumerate(twigs):
        i0 = ns(tw)
        if i0 >= n:
            continue
        m = min(ns(0.03), n - i0)
        tt = t[:m]
        g = hp(r.standard_normal(m), 2500 if not soft else 1800) * np.exp(-tt / 0.0009)
        g += modal(g, [r.uniform(2500, 6000)], [0.01], [0.6])
        y[i0:i0 + m] += g * r.uniform(0.05, 0.13) * (0.6 if soft else 1.0)
    y *= np.minimum(t / 0.00005, 1)
    return fade(y * 0.5 * gain, 0, 0.3)


def crack_echo(seed=0, level=1.0):
    """A softened, distant copy of the crack (the echo that becomes rhythm)."""
    y = crack(soft=True, seed=seed, gain=level)
    return lp(y, 4500)


# ============================================================================
# render, section by section
# ============================================================================
def render(S, A, T, log=print):
    """Sound design into S (sfx) and A (ambience). Layers: main, pre (gated at the crack), fire,
    rush (gated at the cut to the answer), mem (gated with the memory fade)."""
    _room(S, A, T)
    _keys(S, T)
    _todata(S, A, T)
    log('  sfx: room tone, keys, AI ticks, toData')
    _mind(S, A, T)
    _river(S, A, T)
    log('  sfx: mind data, whispering river')
    _eras(S, A, T)
    log('  sfx: eras (modem, teleprinter + Morse, quill, fortune sticks, yarrow, fire)')
    _bone(S, A, T)
    _lineage(S, A, T)
    log('  sfx: the crack, lineage (echoes, flips, tape, circuits)')
    _rush(S, A, T)
    _answer(S, A, T)
    _title(S, A, T)
    log('  sfx: rush, answer (lifts), memory murmurs, title crack')


def _room(S, A, T):
    # opening: room tone + fridge + a car far away
    d0 = T['mind'] + 1.6
    rt = room_tone(d0, seed=1)
    rt *= pts_env(rt.shape[1], [(0, 0.0), (0.6, 1.0), (T['mind'] - 0.6, 1.0), (d0, 0.0)])[None]
    A.add(0.0, rt, -1.0, ROOM)
    A.add(T['car'] - 0.8, distant_car(7.5, 2.4, seed=2), -9.0, {'room': 0.1, 'hall': 0.25})
    # the answer: the same room; at 3 a.m. the fridge cycles off in the long silence
    ta, te = T['answer'], T['memory'] + 3.0
    rt = room_tone(te - ta, seed=3, fridge_off=T['fridge_off'] - ta)
    rt *= pts_env(rt.shape[1], [(0, 0.0), (T['answer_fade'], 1.0), (T['memory'] - ta, 1.0), (te - ta, 0.0)])[None]
    A.add(ta, rt, -1.0, ROOM)


def _keys(S, T):
    for k, e in enumerate(T['keys']):
        kind = e['kind']
        if kind == 'ai':
            f = 5274.0 * (1 + 0.012 * ((k * 7) % 5 - 2))
            S.add(e['t'], P(ai_tick(seed=k, f=f), 0.05), -11.0, {'room': 0.15, 'space': 0.12})
            continue
        r = R(1000 + k)
        if kind == 'enter':
            S.add(e['t'], P(laptop_key('enter', 1.0, seed=k), 0.12), -5.0, ROOM)
            S.add(e['t'] + 0.035, P(send_tick(seed=k), 0.0), -7.0, {'room': 0.1, 'space': 0.3})
            continue
        if kind == 'bs':
            v = 0.85 - 0.05 * (e['i'] % 3)
            S.add(e['t'], P(laptop_key('bs', v, seed=k), 0.2), -6.0, ROOM)
            continue
        # memories at the end are typed more slowly and more softly than the first question
        soft = e['msg'] in T['soft_msgs']
        v = r.uniform(0.75, 1.0) * (0.8 if soft else 1.0)
        S.add(e['t'], P(laptop_key('space' if kind == 'space' else 'key', v, seed=k), r.uniform(-0.15, 0.1)),
              -6.0, ROOM)


def _todata(S, A, T):
    # the listening tone lives in the score; here: crystalline ticks, a spray, a rising airy swell
    notes = ['E7', 'D7', 'A6', 'G6', 'C7', 'A6', 'D7']
    ticks = T['todata']
    m = len(ticks)
    r = R(40)
    for i, t in enumerate(ticks):
        p = -0.42 + 0.84 * i / max(m - 1, 1)
        S.add(t, P(glass_ping(notes[i % 7], 0.75, seed=i, t60=0.8, click=0.5), p), -13.0, DATA)
        tm = 0.04 + 0.30 * r.beta(2.0, 2.2, 30)
        S.add(t, spray(0.5, tm, p + r.normal(0, 0.1, 30), r), -15.0, DATA)
    t0 = ticks[0] + 0.25
    rise = T['mind'] + 0.1 - t0
    S.add(t0, whoosh(rise, 1.6, 500, 7000, seed=41, pans=(-0.3, 0.2), level=0.9, q=1.3, slope=-1.0), -8.0,
          {'space': 0.5})


def _mind(S, A, T):
    # the seven tokens: a glass ping and a precise box click each
    notes = ['E6', 'D6', 'A5', 'G5', 'C6', 'A5', 'D6']
    for i, t in enumerate(T['pings']):
        p = -0.45 + 0.9 * i / 6
        S.add(t, P(glass_ping(notes[i % 7], 0.85, seed=50 + i, t60=1.5, click=0.6), p), -6.0, DATA)
        S.add(t, P(laptop_key('bs', 0.5, seed=60 + i, hold=0.03), p), -16.0, {'space': 0.2})
    # vectors unroll: soft rapid clicks sweeping across
    v0, v1 = T['vectors']
    r = R(70)
    tm = np.arange(0.0, v1 - v0, 0.0437)
    tm = tm + r.uniform(-0.003, 0.003, len(tm))
    pans_ = np.interp(tm, [0, v1 - v0], [-0.7, 0.7])
    sp = spray(v1 - v0 + 0.2, np.maximum(tm, 0), pans_, r, f_range=(2200, 4800), decay=(0.002, 0.005),
               amp=(0.5, 1.0))
    sp *= pts_env(sp.shape[1], [(0, 0), (0.6, 1.0), (v1 - v0 - 0.8, 1.0), (v1 - v0 + 0.2, 0)])[None]
    S.add(v0, sp, -12.0, DATA)
    # a faint granular shimmer fills the abstract space
    d = T['river'] - T['mind']
    gr = spray(d, r.uniform(0, d, int(d * 14)), r.uniform(-0.9, 0.9, int(d * 14)), r, f_range=(5000, 11000),
               decay=(0.01, 0.04), amp=(0.1, 0.5))
    gr *= pts_env(gr.shape[1], [(0, 0), (2.5, 1), (d - 2.0, 1), (d, 0)])[None]
    A.add(T['mind'], gr, -22.0, {'space': 0.6})
    # the dive toward the lit region
    d0, d1 = T['dive']
    S.add(d0, whoosh(d1 - d0, 1.2, 300, 6000, seed=71, pans=(0.3, -0.2), level=1.0, q=1.2), -9.0, {'space': 0.4})


def _river(S, A, T):
    t0 = T['river'] - 1.5
    t1 = T['eras'][1] + 1.0
    d = t1 - t0
    env = [(0, 0), (1.5, 0.55), (T['river_card'] - t0, 0.85), (T['eras'][0] - 4 - t0, 1.0),
           (T['eras'][0] - t0, 0.75), (T['eras'][1] - t0, 0.25), (d, 0)]
    w = whisper_field(d, 44, seed=80, env_pts=env)
    A.add(t0, w, -9.0, {'hall': 0.3, 'space': 0.35})
    # a soft current under the voices
    r = R(81)
    n = ns(d)
    fl = lp(colored_noise(n, r, -3.0, channels=2), 1400) * (0.6 + 0.4 * smooth_random(n, 0.25, r))
    fl *= pts_env(n, env)[None]
    A.add(t0, fl * 0.02, -8.0, {'space': 0.3})


def _eras(S, A, T):
    e = T['eras']          # [modem, teleprinter, quill, sticks, yarrow, fire]
    xf = 0.6
    # 1. modem + 90s keyboard
    m = modem(e[1] - e[0] + xf, seed=90)
    m *= pts_env(m.shape[0], [(0, 0.3), (0.2, 1), (e[1] - e[0], 1), (e[1] - e[0] + xf, 0)])
    S.add(e[0] - 0.05, P(m, -0.35), -6.0, ERA)
    kb = mech_typing(e[1] - e[0] + xf, seed=91)
    kb *= pts_env(kb.shape[1], [(0, 0), (0.3, 1), (e[1] - e[0], 1), (e[1] - e[0] + xf, 0)])[None]
    S.add(e[0], kb, -15.0, ERA)
    # 2. teleprinter + Morse (MOTHER GRAVELY ILL STOP)
    d = e[2] - e[1] + 1.2
    tp = teleprinter(d, seed=92)
    tp *= pts_env(tp.shape[1], [(0, 0), (0.4, 1), (e[2] - e[1], 0.8), (d, 0)])[None]
    S.add(e[1] - 0.2, tp, -6.0, ERA)
    mo, mdur = morse('MOTHER GRAVELY ILL STOP', wpm=34.0, seed=93)
    mo *= pts_env(len(mo), [(0, 1), (e[2] - e[1] + 0.3, 1), (e[2] - e[1] + 2.2, 0), (mdur + 1, 0)])
    S.add(e[1] + 0.15, P(mo, -0.25), -5.0, {'hall': 0.25})
    # 3. quill
    d = e[3] - e[2] + 1.0
    q = quill(d, seed=94)
    q *= pts_env(q.shape[1], [(0, 0), (0.5, 1), (e[3] - e[2], 1), (d, 0)])[None]
    S.add(e[2] - 0.3, q, -2.0, ERA)
    # 4. bamboo fortune sticks
    fs = fortune_sticks(e[4] - e[3] + 0.2, seed=95)
    S.add(e[3] + 0.1, fs, -3.0, ERA)
    # 5. yarrow stalks
    y = yarrow(e[5] - e[4] + 0.6, seed=96)
    y *= pts_env(y.shape[1], [(0, 1), (e[5] - e[4], 1), (e[5] - e[4] + 0.6, 0)])[None]
    S.add(e[4], y, -1.0, ERA)
    # 6. the fire grows (and becomes the night fire of the bone scene)
    with A.layer('fire'):
        tf0, tf1 = e[5] - 1.0, T['lineage'] + 5.0
        d = tf1 - tf0
        tb = T['bone'] - tf0
        f = fire(d, seed=97, crackle_pts=[(0, 1), (tb, 10), (d, 6)])
        f *= pts_env(f.shape[1], [(0, 0), (2.0, 0.25), (tb, 0.85), (tb + 2.0, 1.0), (T['lineage'] - tf0, 0.8),
                                  (d, 0.0)])[None]
        A.add(tf0, f, -4.0, {'room': 0.15, 'hall': 0.15})


def _bone(S, A, T):
    tr, tc = T['rod'], T['crack']
    with S.layer('pre'):
        S.add(tr, P(rod_hiss(tc - tr, seed=100), 0.05), -1.0, {'room': 0.2, 'hall': 0.1})
    # THE CRACK: dry, sharp, resonant; a little night air around it, then silence
    S.add(tc, P(crack(soft=False, seed=101, twigs=T['twigs']), 0.0), 2.0, {'room': 0.25, 'hall': 0.12})


def _lineage(S, A, T):
    t0 = T['lineage']
    g0 = T['yinyang'][0]
    # the crack's echo becomes rhythm: bounces that settle onto the grid
    for k, (dt, lv) in enumerate([(0.0, -4), (0.5, -9), (0.875, -12), (1.125, -15), (1.3125, -18)]):
        tt = t0 + dt * (g0 - t0) / 1.5
        S.add(tt, P(crack_echo(seed=110 + k, level=0.8), 0.3 * (-1) ** k), lv, {'hall': 0.2, 'space': 0.4})
    # the hexagrams flip into 0 and 1
    tfl = T['flip']
    r = R(111)
    for k in range(64):
        tt = tfl + 0.75 * (k / 63) ** 0.85
        S.add(tt, P(laptop_key('bs', r.uniform(0.3, 0.55), seed=120 + k, hold=0.012), -0.7 + 1.4 * k / 63),
              -16.0, {'hall': 0.15, 'space': 0.2})
    # paper tape punch, accelerating
    tp0, tp1 = T['tape'], T['circuits']
    t = tp0
    k = 0
    while t < tp1:
        u = (t - tp0) / (tp1 - tp0)
        rate = 8 * (1 + 2.0 * u ** 1.5)
        S.add(t, P(laptop_key('mech', 0.5 + 0.2 * (k % 2), seed=200 + k, hold=0.02), 0.25), -15.0 - 3 * u,
              {'room': 0.2})
        t += 1.0 / rate
        k += 1
    # circuits: a faint electrical hum and sparse data chirps
    d = T['mind_back'] - tp1 + 1.0
    n = ns(d)
    tt = tvec(n)
    hum = sum(a * np.sin(TWO_PI * 60 * h * tt) for h, a in [(1, 0.3), (2, 0.5), (3, 0.4), (5, 0.2), (7, 0.12)])
    hum = hum * 0.006 * pts_env(n, [(0, 0), (0.4, 1), (d - 1.0, 1), (d, 0)])
    S.add(tp1, P(hum, 0.0), -6.0, {'room': 0.2})
    for k in range(10):
        tt0 = tp1 + r.uniform(0.2, d - 1.2)
        m = ns(0.06)
        x = tvec(m)
        f = r.uniform(1800, 4200) * 2 ** (r.choice([-1, 1]) * x / 0.05)
        ch = np.sin(TWO_PI * np.cumsum(f) / SR) * np.sin(np.pi * x / x[-1]) ** 2 * 0.03
        S.add(tt0, P(ch, r.uniform(-0.8, 0.8)), -12.0, {'hall': 0.2, 'space': 0.2})
    # 155-160 builds: an airy rise into the rush
    S.add(T['build'] + 0.5, whoosh(T['rush'] - T['build'] - 0.5, 1.0, 250, 6500, seed=130, pans=(-0.5, 0.5),
                                   level=1.1, q=1.3), -9.0, {'space': 0.3})


def _rush(S, A, T):
    t0, tc = T['rush'], T['answer']
    with S.layer('rush'), A.layer('rush'):
        times = [t0 + 1.5, t0 + 3.4, t0 + 5.0, t0 + 6.3, t0 + 7.4, t0 + 8.3, t0 + 9.1, t0 + 9.8, t0 + 10.4,
                 t0 + 10.9, t0 + 11.35]
        for k, tw in enumerate(times):
            rise = 0.45 - 0.02 * k
            sgn = 1 if k % 2 else -1
            S.add(tw - rise, whoosh(rise, 0.5, 300, 7000, seed=140 + k, pans=(0.8 * sgn, -0.8 * sgn), level=0.9),
                  -10.0 + 0.4 * k, {'space': 0.2})
        # the final suck back into the question, cut at the answer
        d = 1.6
        sw = whoosh(d, 0.4, 400, 9000, seed=160, pans=(-0.2, 0.2), level=1.2, q=1.4, slope=-1.0)
        S.add(tc - d, sw[:, :ns(d)], -5.0, {'space': 0.2})
        w = whisper_field(tc - t0 + 0.5, 34, seed=150, syl=(0.05, 0.12), phrase=(0.4, 1.4), gap=(0.05, 0.5),
                          flow=1.6, env_pts=[(0, 0), (1.0, 0.7), (tc - t0 - 2, 1.0), (tc - t0, 1.3),
                                             (tc - t0 + 0.5, 0)])
        A.add(t0, w, -9.0, {'hall': 0.2, 'space': 0.3})


def _answer(S, A, T):
    # the lifts: a warm, rising chime, like a small bell in the wind
    sets = [['A5', 'C#6', 'E6', 'A6'], ['B5', 'E6', 'F#6', 'B6'], ['C#6', 'E6', 'A6', 'C#7']]
    for k, tl in enumerate(T['lifts']):
        nts = sets[min(k, 2)]
        for j, (dt, v) in enumerate([(0.0, 0.85), (0.14, 0.7), (0.31, 0.62), (0.55, 0.5)]):
            S.add(tl + dt, P(wind_chime(nts[j], v, seed=300 + 10 * k + j), -0.15 + 0.12 * j), -5.0,
                  {'hall': 0.25, 'space': 0.55})
        S.add(tl, whoosh(0.7, 1.2, 800, 4500, seed=310 + k, pans=(-0.1, 0.25), level=0.5, q=1.4), -14.0,
              {'space': 0.4})
    # the memory river: the same voices, now warm and near, murmuring
    tm0, tm1 = T['memory'] - 1.0, T['memory_end']
    with A.layer('mem'):
        d = tm1 - tm0
        w = whisper_field(d, 22, seed=320, syl=(0.16, 0.38), phrase=(1.0, 3.5), gap=(0.4, 2.0), lp_hz=1900.0,
                          fric=0.25, flow=0.2, scale=(0.85, 1.1),
                          env_pts=[(0, 0), (3.0, 0.5), (T['peak'] - tm0, 1.0), (d - 3, 0.8), (d, 0.5)])
        A.add(tm0, w, -10.0, {'hall': 0.35, 'space': 0.45})


def _title(S, A, T):
    tc = T['title_crack']
    # the point heats up for half a second: a faint ember sizzle
    pre = 0.5
    n = ns(pre)
    t = tvec(n)
    r = R(400)
    em = bp(r.standard_normal(n), 2500, 9000) * (t / pre) ** 2 * 0.02
    em = em * (1 - np.exp(-(pre - t) / 0.01))
    S.add(tc - pre, P(em, 0.0), -6.0, {'space': 0.3})
    S.add(tc, P(crack(soft=True, seed=401, twigs=T['twigs']), 0.0), -3.0, {'hall': 0.25, 'space': 0.9})
