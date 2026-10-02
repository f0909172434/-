"""Synthesised orchestra for 卜 ORACLE (first written for 歸途, extended).

Every instrument returns a stereo numpy array (2, n) at SR, starting at its
own t = 0.  Sustained instruments are normalised so that a full-level
sustained tone sits around -20 dBFS RMS; the score then sets levels in dB.
"""
from __future__ import annotations

import numpy as np
from scipy import signal

from dsp import (SR, TWO_PI, n2m, mtof, ns, tvec, pts_env, asr, onepole,
                 smooth_random, saw, square, colored_noise, lp, hp, bp, eq,
                 formant_bank, tv_lowpass, pan, sat, fade, undb)

REF_RMS = 0.1  # sustained full-level target (-20 dBFS)


def _rng(seed):
    return np.random.default_rng(seed)


def _norm(y, amp, target=REF_RMS):
    """Scale so that the RMS where the envelope is near full equals target."""
    an = amp / (np.max(amp) + 1e-12)
    m = an > 0.6
    if not np.any(m):
        m = an > 0.2
    r = np.sqrt(np.mean(y[:, m] ** 2)) / (np.mean(an[m]) + 1e-12)
    return y * (target / (r + 1e-12)) * np.max(amp)


# ----------------------------------------------------------------------------
# ensemble core: N detuned, vibrato'd, drifting, band-limited voices
# ----------------------------------------------------------------------------
_CTRL = 32  # control-rate decimation for pitch modulators


def _voice_mod(n, r, det, vib_rate, vib_depth, vib_delay, drift, vib_env=None):
    """Per-voice pitch multiplier (detune + delayed vibrato + drift), computed at
    control rate and linearly upsampled (all components are < 10 Hz)."""
    st = _CTRL
    m = (n + st - 1) // st
    tc = np.arange(m) * (st / SR)
    rate = vib_rate * r.uniform(0.9, 1.1) * (1 + 0.06 * smooth_random(n, 0.7, r, decim=st))
    vib = np.sin(TWO_PI * np.cumsum(rate) * (st / SR) + r.uniform(0, TWO_PI))
    if vib_env is None:
        ve = np.clip((tc - vib_delay) / 0.8, 0, 1)
    else:
        ve = np.asarray(vib_env)[::st][:m]
    cents = (r.normal(0, det) + vib_depth * r.uniform(0.7, 1.2) * vib * ve
             + drift * smooth_random(n, 0.9, r, decim=st))
    mult = 2.0 ** (cents / 1200.0)
    return np.interp(np.arange(n, dtype=np.float64), np.arange(m) * float(st), mult)


def ensemble(freq, n, r, voices=4, det=6.0, vib_rate=5.3, vib_depth=10.0,
             vib_delay=0.3, drift=3.0, pan_c=0.0, spread=0.3, wave='saw',
             jitter=0.02, vib_env=None, trem=0.0):
    L = np.zeros(n)
    R = np.zeros(n)
    t = tvec(n) if trem else None
    for v in range(voices):
        f = freq * _voice_mod(n, r, det, vib_rate, vib_depth, vib_delay, drift, vib_env)
        if wave == 'saw':
            y = saw(f, n, r.random())
        elif wave == 'square':
            y = square(f, n, r.random(), duty=r.uniform(0.35, 0.5))
        else:  # 'reed' – mix
            y = 0.7 * saw(f, n, r.random()) + 0.3 * square(f, n, r.random(), 0.42)
        d = int(r.uniform(0, jitter) * SR) if jitter else 0
        if d:
            y = np.concatenate([np.zeros(d), y[:n - d]])
        if trem:
            tr = r.uniform(11, 14.5)
            y = y * (1 - trem * (0.5 + 0.5 * np.sin(TWO_PI * tr * t + r.uniform(0, TWO_PI))))
        p = pan_c + (spread * (2.0 * v / (voices - 1) - 1.0) if voices > 1 else 0.0)
        p = float(np.clip(p + r.normal(0, 0.05), -1, 1))
        a = (p + 1) * np.pi / 4
        L += y * np.cos(a)
        R += y * np.sin(a)
    return np.stack([L, R]) * np.sqrt(2.0 / voices)


# ----------------------------------------------------------------------------
# line builder (legato melodies with glides and re-articulation)
# ----------------------------------------------------------------------------
def line_curves(notes, rel=1.0, glide=0.045, att=0.09, vib_delay=0.25):
    """notes: [(t, dur, pitch, vel)] relative to t=0.
    returns n, freq[n], amp[n], vib_env[n]"""
    notes = sorted(notes, key=lambda x: x[0])
    end = max(s + d for s, d, _, _ in notes)
    n = ns(end + rel)
    t = tvec(n)
    midi = np.full(n, n2m(notes[0][2]))
    target = np.zeros(n)
    vib_env = np.zeros(n)
    art = np.ones(n)
    prev_end = -1
    for s, d, p, v in notes:
        a, b = ns(s), ns(s + d)
        midi[a:] = n2m(p)
        target[a:b] = v
        seg = t[a:] - s
        ve = np.clip((seg - vib_delay) / 0.7, 0, 1)
        vib_env[a:b] = ve[:b - a]
        if abs(s - prev_end) < 0.05:  # legato re-articulation dip
            art[a:] *= 1 - 0.18 * np.exp(-seg / 0.07) * (seg >= 0)
        prev_end = s + d
    vib_env[b:] = vib_env[b - 1] if b > 0 else 0
    midi = onepole(midi, glide)
    fast = onepole(target, att)
    slow = onepole(target, rel / 4.0)
    amp = np.maximum(fast, slow) * art
    amp[-ns(0.05):] *= np.linspace(1, 0, ns(0.05))
    return n, mtof(midi), amp, vib_env


# ----------------------------------------------------------------------------
# STRINGS
# ----------------------------------------------------------------------------
SEC = {
    'vln': dict(lpd=3000, lpb=10000, hp=170, pan=-0.45, spread=0.3, voices=5, det=7,
                vib=(5.5, 13), bow=0.05,
                body=[('peak', 280, 2.0, 1.2), ('peak', 2700, 3.0, 1.0), ('highshelf', 9000, -3, 0.7)]),
    'vla': dict(lpd=2200, lpb=7000, hp=110, pan=-0.05, spread=0.25, voices=4, det=7,
                vib=(5.2, 12), bow=0.04,
                body=[('peak', 350, 2.0, 1.2), ('peak', 1800, 2.0, 1.0)]),
    'vc': dict(lpd=1500, lpb=5000, hp=50, pan=0.3, spread=0.25, voices=4, det=6,
               vib=(5.0, 11), bow=0.03,
               body=[('peak', 200, 2.5, 1.2), ('peak', 1200, 1.5, 1.0)]),
    'cb': dict(lpd=650, lpb=2000, hp=27, pan=0.5, spread=0.2, voices=3, det=5,
               vib=(4.6, 8), bow=0.02,
               body=[('peak', 110, 2.0, 1.2)]),
}


def _strings_render(freqs, amp, sec, r, bright=0.5, vib_env=None, trem=0.0,
                    vib_scale=1.0, normalise=True):
    p = SEC[sec]
    n = len(amp)
    x = np.zeros((2, n))
    for f in freqs:
        x += ensemble(f, n, r, voices=p['voices'], det=p['det'], vib_rate=p['vib'][0],
                      vib_depth=p['vib'][1] * vib_scale, drift=3.0, pan_c=p['pan'],
                      spread=p['spread'], vib_env=vib_env, trem=trem)
    x /= np.sqrt(len(freqs))
    x = hp(x, p['hp'])
    an = amp / (np.max(amp) + 1e-12)
    b = np.clip(bright * an ** 0.8, 0, 1)
    y = lp(x, p['lpd']) * (1 - b) + lp(x, p['lpb']) * b
    y = eq(y, p['body'])
    nz = bp(r.standard_normal((2, n)), 2200, 8000)
    y = y * amp + p['bow'] * 0.1 * nz * amp * an
    if normalise:
        y = _norm(y, amp)
    return y


def strings_chord(notes, dur, sec='vln', att=0.8, rel=1.5, dyn=None, bright=0.5,
                  seed=0, trem=0.0, vib_scale=1.0):
    r = _rng(seed)
    n = ns(dur + rel)
    amp = asr(n, att, rel)
    if dyn is not None:
        amp = amp * pts_env(n, dyn)
    freqs = [float(mtof(n2m(x))) for x in notes]
    return _strings_render(freqs, amp, sec, r, bright, trem=trem, vib_scale=vib_scale)


def strings_line(notes, sec='vln', rel=1.2, att=0.12, glide=0.05, bright=0.6,
                 dyn=None, seed=0, octaves=(0,)):
    r = _rng(seed)
    n, f, amp, ve = line_curves(notes, rel=rel, att=att, glide=glide)
    if dyn is not None:
        amp = amp * pts_env(n, dyn)
    freqs = [f * 2.0 ** o for o in octaves]
    return _strings_render(freqs, amp, sec, r, bright, vib_env=ve)


_SPICC_CACHE = {}


def strings_spicc(midi, vel, dur=0.22, sec='vc', seed=0, bright=0.6, voices=None):
    """Short bowed note (spiccato / marcato) for ostinati.  Cached on a coarse
    velocity grid with 5 round-robin variants per note."""
    vq = round(min(max(vel, 0.02), 1.2) * 20) / 20
    key = (int(round(n2m(midi))), vq, round(dur, 3), sec, seed % 5, round(bright, 2), voices)
    if key not in _SPICC_CACHE:
        _SPICC_CACHE[key] = _spicc(key[0], vq, dur, sec, seed % 5 + 17 * key[0], bright, voices)
    return _SPICC_CACHE[key]


def _spicc(midi, vel, dur, sec, seed, bright, voices):
    r = _rng(seed)
    p = SEC[sec]
    n = ns(dur + 0.25)
    t = tvec(n)
    f = float(mtof(n2m(midi)))
    x = ensemble(f, n, r, voices=voices or max(2, p['voices'] - 1), det=p['det'],
                 vib_depth=3.0, vib_delay=0.5, pan_c=p['pan'], spread=p['spread'], jitter=0.008)
    x = hp(x, p['hp'])
    a = np.minimum(t / 0.006, 1.0) * np.exp(-t / (dur * 0.55))
    a *= np.clip((dur + 0.25 - t) / 0.25, 0, 1)
    fc = p['lpd'] * (1 + 2.2 * bright * vel)
    y = lp(x, fc) * a
    y = eq(y, p['body'])
    nz = bp(r.standard_normal((2, n)), 1500, 7000) * np.exp(-t / 0.03)
    y += 0.1 * vel * nz
    return y * vel * 0.35


# ----------------------------------------------------------------------------
# BRASS
# ----------------------------------------------------------------------------
BR = {
    'hn': dict(fmin=280, fmax=2200, hp=45, pan=-0.15, spread=0.2, voices=4, det=4,
               vib=(4.8, 2.5), drive=1.3, eqs=[('peak', 450, 3.0, 1.0), ('highshelf', 3000, -6, 0.7)]),
    'tbn': dict(fmin=260, fmax=4000, hp=40, pan=0.25, spread=0.2, voices=3, det=5,
                vib=(4.8, 2.0), drive=1.8, eqs=[('peak', 1100, 3.0, 0.9)]),
    'tpt': dict(fmin=700, fmax=7000, hp=140, pan=0.05, spread=0.15, voices=3, det=4,
                vib=(5.2, 4.0), drive=1.5, eqs=[('peak', 1500, 3.0, 1.0)]),
    'tuba': dict(fmin=140, fmax=1100, hp=22, pan=0.4, spread=0.1, voices=2, det=4,
                 vib=(4.5, 1.5), drive=1.1, eqs=[('peak', 250, 2.0, 1.0)]),
}


def _brass_render(freqs, amp, kind, r, bright=1.0, vib_env=None):
    p = BR[kind]
    n = len(amp)
    x = np.zeros((2, n))
    for f in freqs:
        x += ensemble(f, n, r, voices=p['voices'], det=p['det'], vib_rate=p['vib'][0],
                      vib_depth=p['vib'][1], drift=2.0, pan_c=p['pan'], spread=p['spread'],
                      vib_env=vib_env, wave='reed')
    x /= np.sqrt(len(freqs))
    x = hp(x, p['hp'])
    an = amp / (np.max(amp) + 1e-12)
    # amplitude-driven brightness: crossfade three static low-passes (fmin, mid, fmax)
    pos = 2.0 * np.clip(bright * an ** 1.4, 0, 1)
    xa = x * an
    fm = np.sqrt(p['fmin'] * p['fmax'])
    w0 = np.clip(1 - pos, 0, 1)
    w2 = np.clip(pos - 1, 0, 1)
    w1 = 1 - w0 - w2
    y = lp(xa, p['fmin']) * w0 + lp(xa, fm) * w1 + lp(xa, p['fmax']) * w2
    y = sat(y * p['drive'], 1.0 + 0.8 * bright) / p['drive']
    y = eq(y, p['eqs'])
    return _norm(y * np.max(amp), amp)


def brass_chord(notes, dur, kind='hn', att=0.5, rel=1.2, dyn=None, bright=1.0, seed=0):
    r = _rng(seed)
    n = ns(dur + rel)
    amp = asr(n, att, rel)
    if dyn is not None:
        amp = amp * pts_env(n, dyn)
    freqs = [float(mtof(n2m(x))) for x in notes]
    return _brass_render(freqs, amp, kind, r, bright)


def brass_line(notes, kind='hn', rel=1.0, att=0.1, glide=0.04, bright=1.0, dyn=None,
               seed=0, octaves=(0,)):
    r = _rng(seed)
    n, f, amp, ve = line_curves(notes, rel=rel, att=att, glide=glide)
    if dyn is not None:
        amp = amp * pts_env(n, dyn)
    return _brass_render([f * 2.0 ** o for o in octaves], amp, kind, r, bright, vib_env=ve)


def braam(notes, length=8.0, seed=0, peak_fc=3800.0, decay=3.0, drive=3.0):
    """Cinematic BRAAM: wide detuned saw/reed cluster, filter envelope that
    rips open then closes, heavy saturation, plus sub."""
    r = _rng(seed)
    n = ns(length)
    t = tvec(n)
    x = np.zeros((2, n))
    for nt in notes:
        f = float(mtof(n2m(nt)))
        x += ensemble(f, n, r, voices=6, det=14, vib_depth=0, drift=4, spread=0.8,
                      wave='reed', jitter=0.004)
    x /= np.sqrt(len(notes))
    amp = np.minimum(t / 0.012, 1) * (0.55 + 0.45 * np.exp(-t / 0.6)) * np.exp(-t / decay)
    amp *= np.clip((length - t) / 1.0, 0, 1)
    fc = 120 + (peak_fc - 120) * (np.minimum(t / 0.22, 1) ** 1.5) * np.exp(-np.maximum(t - 0.22, 0) / 1.4)
    fc = np.maximum(fc, 160)
    y = tv_lowpass(x * amp, fc, order=3, hop=128)
    y = sat(y * drive, 1.0) * 0.8
    y = eq(y, [('peak', 120, 4.0, 0.8), ('peak', 700, 3.0, 1.0), ('highshelf', 5000, -6, 0.7)])
    sub_f = float(mtof(n2m(notes[0])))
    sub = np.sin(TWO_PI * np.cumsum(np.full(n, sub_f) * (1 - 0.03 * np.minimum(t / 3, 1))) / SR)
    y += 0.6 * pan(sub * amp, 0)
    return y


# ----------------------------------------------------------------------------
# CHOIR (formant-filtered ensembles)
# ----------------------------------------------------------------------------
VOW = {
    'bass': {'a': [(600, 60, 0), (1040, 70, -7), (2250, 110, -9), (2450, 120, -9), (2750, 130, -20)],
             'o': [(400, 40, 0), (750, 80, -11), (2400, 100, -21), (2600, 120, -20), (2900, 120, -40)],
             'u': [(250, 60, 0), (600, 80, -20), (2400, 100, -32), (2675, 120, -28), (2950, 120, -36)]},
    'tenor': {'a': [(650, 80, 0), (1080, 90, -6), (2650, 120, -7), (2900, 130, -8), (3250, 140, -22)],
              'o': [(400, 70, 0), (800, 80, -10), (2600, 100, -12), (2800, 130, -12), (3000, 135, -26)],
              'u': [(350, 40, 0), (600, 60, -20), (2700, 100, -17), (2900, 120, -14), (3300, 120, -26)]},
    'alto': {'a': [(800, 80, 0), (1150, 90, -4), (2800, 120, -20), (3500, 130, -36), (4950, 140, -60)],
             'o': [(450, 70, 0), (800, 80, -9), (2830, 100, -16), (3500, 130, -28), (4950, 135, -55)],
             'u': [(325, 50, 0), (700, 60, -12), (2530, 170, -30), (3500, 180, -40), (4950, 200, -64)]},
    'soprano': {'a': [(800, 80, 0), (1150, 90, -6), (2900, 120, -32), (3900, 130, -20), (4950, 140, -50)],
                'o': [(450, 70, 0), (800, 80, -11), (2830, 100, -22), (3800, 130, -22), (4950, 135, -50)],
                'u': [(350, 50, 0), (600, 60, -16), (2700, 170, -35), (3800, 180, -40), (4950, 200, -60)]},
}


def _part(m):
    return 'bass' if m < 52 else 'tenor' if m < 60 else 'alto' if m < 68 else 'soprano'


def _choir_render(freq_list, part_list, amp, vowel, r, morph=None, vib_env=None, breath=0.06,
                  voices=6):
    n = len(amp)
    out = np.zeros((2, n))
    for f, part in zip(freq_list, part_list):
        src = ensemble(f, n, r, voices=voices, det=11, vib_rate=5.1, vib_depth=16, vib_delay=0.5,
                       drift=6, spread=0.55, vib_env=vib_env, jitter=0.03)
        src = lp(src, 700, order=1)
        src += breath * bp(r.standard_normal((2, n)), 300, 7000)
        if morph is None:
            y = formant_bank(src, VOW[part][vowel])
        else:
            v2, mpts = morph
            m = pts_env(n, mpts)
            y = formant_bank(src, VOW[part][vowel]) * (1 - m) + formant_bank(src, VOW[part][v2]) * m
        out += y
    out /= np.sqrt(len(freq_list))
    out = hp(out, 70)
    return _norm(out * amp, amp)


def choir(notes, dur, vowel='a', att=1.2, rel=2.0, dyn=None, seed=0, morph=None,
          breath=0.06, voices=6):
    r = _rng(seed)
    n = ns(dur + rel)
    amp = asr(n, att, rel)
    if dyn is not None:
        amp = amp * pts_env(n, dyn)
    ms = [n2m(x) for x in notes]
    return _choir_render([float(mtof(m)) for m in ms], [_part(m) for m in ms], amp, vowel, r,
                         morph=morph, breath=breath, voices=voices)


def choir_line(notes, vowel='a', rel=1.5, att=0.15, glide=0.06, dyn=None, seed=0,
               octaves=(0,), morph=None):
    r = _rng(seed)
    n, f, amp, ve = line_curves(notes, rel=rel, att=att, glide=glide, vib_delay=0.35)
    if dyn is not None:
        amp = amp * pts_env(n, dyn)
    m0 = float(np.mean([n2m(x[2]) for x in notes]))
    return _choir_render([f * 2.0 ** o for o in octaves], [_part(m0 + 12 * o) for o in octaves],
                         amp, vowel, r, morph=morph, vib_env=ve)


# ----------------------------------------------------------------------------
# PIANO (additive, inharmonic, two-stage per-partial decay, hammer, soundboard)
# ----------------------------------------------------------------------------
_PIANO_CACHE = {}
_SB = None


def _soundboard():
    global _SB
    if _SB is None:
        r = _rng(77)
        n = ns(0.09)
        t = tvec(n)
        ir = r.standard_normal(n) * np.exp(-t / 0.014)
        ir = lp(ir, 5000)
        ir = eq(ir, [('peak', 180, 6, 1.0), ('peak', 600, 4, 1.2), ('peak', 2200, -3, 1.0)])
        _SB = ir / np.sqrt(np.sum(ir ** 2))
    return _SB


def piano_note(pitch, vel=0.6, dur=1.0, seed=0):
    midi = int(round(n2m(pitch)))
    key = (midi, round(vel, 2), round(dur, 2), seed % 3)
    if key in _PIANO_CACHE:
        return _PIANO_CACHE[key]
    r = _rng(midi * 131 + seed % 3)
    f0 = float(mtof(midi))
    B = 0.00038 * 2 ** ((midi - 60) / 12 * 1.0) if midi >= 48 else 0.00019 * 2 ** ((midi - 48) / 24)
    T0 = float(np.clip(15.0 * 2 ** (-(midi - 33) / 19.0), 1.0, 16.0))
    damped = midi < 89
    length = min(T0 * 0.8, dur + 0.6) if damped else T0 * 0.8
    length = max(length, 0.3)
    n = ns(length)
    t = tvec(n)
    k = np.arange(1, 90)
    fk = k * f0 * np.sqrt(1 + B * k * k)
    keep = fk < min(15000.0 if midi >= 50 else 9000.0, 0.45 * SR)
    k, fk = k[keep], fk[keep]
    p = 1.55 - 0.75 * vel
    ak = k ** (-p) * (np.abs(np.sin(np.pi * k * 0.118)) + 0.06)
    fcv = 700 + 6500 * vel ** 1.6
    ak = ak / np.sqrt(1 + (fk / fcv) ** 2)
    ak /= np.sqrt(np.sum(ak ** 2))
    sel = ak > 4e-3
    k, fk, ak = k[sel], fk[sel], ak[sel]
    Tk = T0 / (1 + (fk / 1100.0) ** 1.35 + 0.015 * (k - 1))
    y = np.zeros(n, np.float32)
    t32 = t.astype(np.float32)
    for f, a, T in zip(fk, ak, Tk):
        d = r.uniform(0.08, 0.35) * r.choice([-1, 1])
        ph1, ph2 = r.uniform(0, TWO_PI, 2)
        # truncate each partial once it has decayed below -80 dB
        m = min(n, ns(T * 1.25 * 80 / 60) + 1)
        tt = t32[:m]
        e1 = np.exp(np.float32(-6.91 / (T * 0.28)) * tt)
        e2 = np.exp(np.float32(-6.91 / (T * 1.25)) * tt)
        p1 = ((f * t[:m]) % 1.0).astype(np.float32)
        p2 = (((f + d) * t[:m]) % 1.0).astype(np.float32)
        y[:m] += np.float32(a) * (0.62 * e1 * np.sin(np.float32(TWO_PI) * p1 + np.float32(ph1))
                                  + 0.38 * e2 * np.sin(np.float32(TWO_PI) * p2 + np.float32(ph2)))
    y = y.astype(np.float64)
    y *= np.minimum(t / 0.0015, 1.0)
    if damped:
        y *= np.where(t < dur, 1.0, np.exp(-(t - dur) / (0.07 + 0.15 * (midi < 40))))
    # hammer
    hn = r.standard_normal(n)
    ham = bp(hn, 600, 2500 + 6000 * vel) * np.exp(-t / 0.004) * 0.10 * vel
    thump = lp(hn, 220) * np.exp(-t / 0.025) * 0.25 * vel
    y = y + ham + thump
    y = y + 0.35 * signal.fftconvolve(y, _soundboard())[:n]
    y = fade(y, 0.0, 0.03)
    reg = 1.0 + 0.25 * np.clip((60 - midi) / 24, 0, 1)
    y *= 0.22 * vel ** 1.4 * reg
    pp = float(np.clip((midi - 64) / 40.0, -0.6, 0.6))
    out = pan(y, pp) * 0.7071
    _PIANO_CACHE[key] = out
    return out


# ----------------------------------------------------------------------------
# CELESTA / BELLS / GLASS
# ----------------------------------------------------------------------------
def _additive(f0, ratios, amps, t60s, n, r, beat=0.0):
    t = tvec(n)
    y = np.zeros(n)
    for q, a, T in zip(ratios, amps, t60s):
        f = f0 * q
        if f >= 0.45 * SR:
            continue
        ph = r.uniform(0, TWO_PI)
        e = np.exp(-6.91 * t / T)
        if beat:
            d = beat * r.uniform(0.5, 1.5)
            y += a * e * 0.5 * (np.sin(TWO_PI * f * t + ph) + np.sin(TWO_PI * (f + d) * t + ph))
        else:
            y += a * e * np.sin(TWO_PI * f * t + ph)
    return y


def celesta(pitch, vel=0.8, length=None, seed=0):
    r = _rng(seed)
    m = n2m(pitch)
    f0 = float(mtof(m))
    T = 2.4 * 2 ** (-(m - 84) / 24)
    length = length or T * 1.2 + 0.3
    n = ns(length)
    t = tvec(n)
    y = _additive(f0, [1, 2.0, 2.76, 4.0, 5.40, 8.93], [1, 0.07, 0.16, 0.10, 0.05, 0.025],
                  [T, T * 0.4, T * 0.18, T * 0.15, T * 0.06, T * 0.03], n, r)
    y *= np.minimum(t / 0.0012, 1)
    click = hp(r.standard_normal(n), 2500) * np.exp(-t / 0.0015) * 0.12
    y = (y + click) * 0.25 * vel ** 1.2
    return fade(pan(y, 0.0) * 0.7071, 0, 0.05)


def bell(pitch, vel=0.8, length=None, seed=0, bright=1.0):
    """Glassy harmonic bell (shimmering pairs)."""
    r = _rng(seed + 5)
    m = n2m(pitch)
    f0 = float(mtof(m))
    T = 4.5 * 2 ** (-(m - 84) / 30)
    length = length or T * 1.1
    n = ns(length)
    t = tvec(n)
    ratios = [0.5, 1.0, 2.0, 3.0, 4.16, 5.43, 6.8]
    amps = [0.12, 1.0, 0.32 * bright, 0.15 * bright, 0.10 * bright, 0.05 * bright, 0.03 * bright]
    t60 = [T * 1.5, T * 1.3, T * 0.8, T * 0.5, T * 0.35, T * 0.25, T * 0.18]
    y = _additive(f0, ratios, amps, t60, n, r, beat=0.9)
    y *= np.minimum(t / 0.003, 1)
    return fade(pan(y * 0.18 * vel ** 1.2, 0.0) * 0.7071, 0, 0.1)


def atom_note(pitch, vel=0.8, seed=0, warm=False):
    """Leitmotif voice: celesta + glass bell (+ soft sine 'aura' when warm)."""
    c = celesta(pitch, vel, seed=seed)
    b = bell(pitch, vel * 0.9, seed=seed)
    n = max(c.shape[1], b.shape[1])
    y = np.zeros((2, n))
    y[:, :c.shape[1]] += 0.8 * c
    y[:, :b.shape[1]] += 0.55 * b
    if warm:
        f = float(mtof(n2m(pitch)))
        t = tvec(n)
        aura = np.sin(TWO_PI * f * t) * (1 - np.exp(-t / 0.4)) * np.exp(-t / 3.0) * 0.05 * vel
        y += pan(aura, 0) * 0.7071
    return y


def glass(pitch, vel=0.6, seed=0):
    r = _rng(seed + 9)
    f0 = float(mtof(n2m(pitch)))
    n = ns(3.0)
    t = tvec(n)
    y = _additive(f0, [1, 2.32, 4.25, 6.63], [1, 0.3, 0.12, 0.05], [2.6, 1.0, 0.45, 0.22], n, r, beat=1.3)
    y *= 1 - np.exp(-t / 0.006)
    return fade(y * 0.2 * vel, 0, 0.1)


def plink(pitch, vel=0.6, seed=0):
    r = _rng(seed + 13)
    f0 = float(mtof(n2m(pitch)))
    n = ns(0.9)
    t = tvec(n)
    f = f0 * (1 + 0.06 * (1 - np.exp(-t / 0.03)))
    ph = np.cumsum(f) / SR
    y = (np.sin(TWO_PI * ph) + 0.18 * np.sin(TWO_PI * 2 * ph + 1.0)) * np.exp(-t / 0.18)
    y *= np.minimum(t / 0.002, 1)
    y += 0.03 * hp(r.standard_normal(n), 3000) * np.exp(-t / 0.002)
    return fade(y * 0.25 * vel, 0, 0.05)


# ----------------------------------------------------------------------------
# PERCUSSION
# ----------------------------------------------------------------------------
_DRUM_CACHE = {}


def taiko(vel=1.0, size='o', variant=0):
    vb = round(min(max(vel, 0.05), 1.0) * 10) / 10
    key = ('taiko', size, vb, variant % 4)
    if key in _DRUM_CACHE:
        return _DRUM_CACHE[key]
    r = _rng(hash(key) % 2 ** 31)
    f0 = {'o': 54.0, 'm': 88.0, 's': 205.0}[size] * r.uniform(0.97, 1.03)
    base = {'o': 1.7, 'm': 1.0, 's': 0.45}[size]
    n = ns(base * 1.6 + 0.2)
    t = tvec(n)
    ratios = [1, 1.59, 2.14, 2.30, 2.65, 2.92, 3.16, 3.50]
    amps = [1, .55, .42, .3, .25, .18, .12, .08]
    tf = [1, .5, .42, .38, .33, .3, .27, .24]
    y = np.zeros(n)
    for q, a, k in zip(ratios, amps, tf):
        f = f0 * q * (1 + 0.32 * vb * np.exp(-t / 0.035))
        ph = np.cumsum(f) / SR
        y += a * np.exp(-6.91 * t / (base * k)) * np.sin(TWO_PI * ph + r.uniform(0, 1))
    nz = r.standard_normal(n)
    slap = bp(nz, 400, 3500) * np.exp(-t / 0.007) * 0.7 * vb
    skin = lp(nz, 900) * np.exp(-t / 0.045) * 0.35
    y = (y + slap + skin) * np.minimum(t / 0.0008, 1)
    y = sat(y * (1.2 + vb), 1.0) * 0.32 * vb ** 1.3
    out = fade(y, 0, 0.1)
    _DRUM_CACHE[key] = out
    return out


def timpani(pitch, vel=1.0, variant=0, length=3.5):
    vb = round(min(max(vel, 0.05), 1.0) * 20) / 20
    key = ('timp', int(n2m(pitch)), vb, variant % 3)
    if key in _DRUM_CACHE:
        return _DRUM_CACHE[key]
    r = _rng(hash(key) % 2 ** 31)
    f0 = float(mtof(n2m(pitch)))
    n = ns(length)
    t = tvec(n)
    y = _additive(f0, [0.62, 1.0, 1.5, 1.98, 2.44, 2.94, 3.36],
                  [0.45, 1.0, 0.5, 0.33, 0.22, 0.11, 0.07],
                  [0.3, 3.0, 2.1, 1.7, 1.3, 0.9, 0.6], n, r)
    nz = r.standard_normal(n)
    y += lp(nz, 700 + 1500 * vb) * np.exp(-t / 0.008) * 0.6
    y *= np.minimum(t / 0.001, 1)
    out = fade(y * 0.3 * vb ** 1.3, 0, 0.1)
    _DRUM_CACHE[key] = out
    return out


def cymbal(length=5.0, seed=0, bright=1.0):
    """Suspended cymbal / crash: inharmonic square cluster + noise."""
    r = _rng(seed + 31)
    n = ns(length)
    t = tvec(n)
    freqs = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * r.uniform(1.4, 1.7)
    m = np.zeros(n)
    for f in freqs:
        m += square(f * r.uniform(0.99, 1.01), n, r.random())
    m = bp(m, 3000, 12000)
    nz = hp(r.standard_normal(n), 4000)
    y = 0.5 * m + nz
    env = np.exp(-6.91 * t / length) * np.minimum(t / 0.002, 1)
    y = lp(y, 9000 + 5000 * bright) * env
    return y / (np.sqrt(np.mean(y[:ns(0.5)] ** 2)) + 1e-9) * 0.1


# ----------------------------------------------------------------------------
# PADS, DRONES, SHEPARD
# ----------------------------------------------------------------------------
def pad(notes, dur, att=2.0, rel=3.0, cutoff=1400.0, dyn=None, seed=0, voices=3, det=9.0,
        sines=0.5, air=0.0):
    r = _rng(seed)
    n = ns(dur + rel)
    amp = asr(n, att, rel)
    if dyn is not None:
        amp = amp * pts_env(n, dyn)
    x = np.zeros((2, n))
    s = np.zeros(n)
    t = tvec(n)
    for nt in notes:
        f = float(mtof(n2m(nt)))
        x += ensemble(f, n, r, voices=voices, det=det, vib_rate=3.8, vib_depth=4, drift=4,
                      spread=0.8, jitter=0)
        s += np.sin(TWO_PI * f * t + r.uniform(0, TWO_PI)) * (1 + 0.15 * smooth_random(n, 0.3, r))
    x /= np.sqrt(len(notes))
    s /= np.sqrt(len(notes))
    m = 0.5 + 0.5 * smooth_random(n, 0.12, r)
    y = lp(x, cutoff * 0.55) * (1 - m) + lp(x, cutoff * 1.5) * m
    y = lp(y, cutoff * 2.5)
    y += sines * pan(s, 0) * 0.7
    if air:
        y += air * hp(colored_noise(n, r, -3, channels=2), 6000) * 0.3
    return _norm(hp(y, 35) * amp, amp)


def sub_drone(pitch, dur, att=3.0, rel=3.0, dyn=None, seed=0, harm=0.25):
    r = _rng(seed)
    n = ns(dur + rel)
    t = tvec(n)
    f = float(mtof(n2m(pitch)))
    amp = asr(n, att, rel) * (1 + 0.08 * smooth_random(n, 0.4, r))
    if dyn is not None:
        amp = amp * pts_env(n, dyn)
    y = np.sin(TWO_PI * f * t) + harm * np.sin(TWO_PI * 2 * f * t + 0.3) + 0.4 * harm * np.sin(TWO_PI * 3 * f * t)
    return pan(y * amp * 0.14, 0) * 0.7071


def shepard(dur, rate_pts, fmin=22.0, ncomp=9, center=700.0, sigma=1.5, seed=0):
    """Shepard–Risset glissando (endlessly rising). rate in octaves/s."""
    r = _rng(seed)
    n = ns(dur)
    rate = pts_env(n, rate_pts)
    pos = np.cumsum(rate) / SR
    c = np.log2(center / fmin)
    out = np.zeros((2, n))
    for ch, det in enumerate([0.0, 6.0]):
        y = np.zeros(n)
        for k in range(ncomp):
            o = (k + pos) % ncomp
            f = fmin * 2 ** o * 2 ** (det / 1200)
            a = np.exp(-0.5 * ((o - c) / sigma) ** 2)
            ph = np.cumsum(f) / SR + r.random()
            y += a * (np.sin(TWO_PI * ph) + 0.3 * np.sin(TWO_PI * 2 * ph) + 0.12 * np.sin(TWO_PI * 3 * ph))
        out[ch] = y
    out /= np.sqrt(np.mean(out ** 2)) + 1e-9
    return out * REF_RMS


# ============================================================================
# 卜 ORACLE additions: glass and data voices, ancient voices, keyboard and electronics.
# Percussive / one-shot voices return MONO arrays (the caller pans); lines return stereo.
# ============================================================================
def glass_ping(pitch, vel=0.7, seed=0, t60=1.6, click=0.25, bright=1.0):
    """Crystalline ping (a glass struck by a tiny hammer). The click puts the onset exactly at t = 0."""
    r = _rng(seed + 101)
    f0 = float(mtof(n2m(pitch)))
    n = ns(t60 * 1.1 + 0.05)
    t = tvec(n)
    y = _additive(f0, [1, 2.32, 4.25, 6.63, 9.38],
                  [1, 0.32 * bright, 0.14 * bright, 0.06 * bright, 0.025 * bright],
                  [t60, t60 * 0.45, t60 * 0.22, t60 * 0.12, t60 * 0.07], n, r, beat=0.7)
    y *= np.minimum(t / 0.0007, 1)
    y += click * hp(r.standard_normal(n), 3000) * np.exp(-t / 0.0009)
    return fade(y * 0.16 * vel, 0, 0.05)


def bowed_glass(pts, dur, att=0.6, rel=1.2, dyn=None, seed=0, harm=0.12, noise=0.05, beat=0.7):
    """Glass harmonica: an almost pure, slightly beating tone that can glide.
    pts: [(t, pitch), ...] pitch targets, linearly interpolated in semitones (glides)."""
    r = _rng(seed + 202)
    n = ns(dur + rel)
    t = tvec(n)
    midi = np.interp(t, [p[0] for p in pts], [n2m(p[1]) for p in pts])
    f = mtof(midi) * (1 + 0.0008 * np.sin(TWO_PI * 4.4 * t + r.uniform(0, TWO_PI)))
    amp = asr(n, att, rel) * (1 + 0.05 * smooth_random(n, 2.5, r))
    if dyn is not None:
        amp = amp * pts_env(n, dyn)
    ph1 = np.cumsum(f) / SR
    ph2 = np.cumsum(f + beat) / SR
    y = 0.5 * (np.sin(TWO_PI * ph1) + np.sin(TWO_PI * ph2 + 1.0))
    y += harm * np.sin(2 * TWO_PI * ph1 + 0.4) + 0.35 * harm * np.sin(3 * TWO_PI * ph1 + 1.1)
    y += noise * lp(r.standard_normal(n), 260) * np.sin(TWO_PI * ph1) * 3.0   # wet-finger friction
    return y * amp * 0.1


def harpsichord(pitch, vel=0.7, dur=0.2, seed=0, four=0.0):
    """Plucked harpsichord string (additive, plucked near the nut), quill click and damper.
    four > 0 adds the 4' (octave) register."""
    midi = int(round(n2m(pitch)))
    key = ('hpsd', midi, round(dur, 2), seed % 3, round(four, 2))
    if key in _PIANO_CACHE:
        return _PIANO_CACHE[key]
    r = _rng(midi * 17 + seed % 3)
    T0 = float(np.clip(7.0 * 2 ** (-(midi - 48) / 18.0), 0.8, 9.0))
    L = min(T0, dur + 0.3)
    n = ns(L)
    t = tvec(n)
    y = np.zeros(n)
    for reg, gain in ((0, 1.0), (12, four)):
        if gain <= 0:
            continue
        f0 = float(mtof(midi + reg))
        k = np.arange(1, 61)
        fk = k * f0 * np.sqrt(1 + 2e-5 * k * k)
        keep = fk < 15000
        k, fk = k[keep], fk[keep]
        ak = np.abs(np.sin(np.pi * k * 0.13)) / k ** 0.8 + 0.01
        ak /= np.sqrt(np.sum(ak ** 2))
        Tk = T0 / (1 + (fk / 2500.0) ** 1.3)
        for f, a, T in zip(fk, ak, Tk):
            y += gain * a * np.exp(-6.91 * t / T) * np.sin(TWO_PI * f * t + r.uniform(0, TWO_PI))
    y *= np.minimum(t / 0.0004, 1)
    nz = r.standard_normal(n)
    y += bp(nz, 2000, 10000) * np.exp(-t / 0.0015) * 0.18 + lp(nz, 900) * np.exp(-t / 0.006) * 0.12
    y *= np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.035))
    rel = np.maximum(t - dur, 0)
    y += lp(nz, 1200) * (t >= dur) * np.exp(-rel / 0.004) * 0.05
    y = fade(y * 0.2 * vel ** 1.2, 0.0, 0.02)
    _PIANO_CACHE[key] = y
    return y


def xun_line(notes, rel=0.5, att=0.1, glide=0.05, dyn=None, seed=0, breath=0.45, pan_c=0.0):
    """Xun (殷墟-era clay vessel flute): a near-pure tone carried on breath, scooped attacks."""
    r = _rng(seed + 303)
    n, f, amp, ve = line_curves(notes, rel=rel, att=att, glide=glide, vib_delay=0.35)
    if dyn is not None:
        amp = amp * pts_env(n, dyn)
    t = tvec(n)
    mod = 1 + 0.006 * ve * np.sin(TWO_PI * 4.3 * t + r.uniform(0, TWO_PI)) + 0.0025 * smooth_random(n, 1.3, r)
    ph = np.cumsum(f * mod) / SR
    tone = np.sin(TWO_PI * ph) + 0.06 * np.sin(3 * TWO_PI * ph) + 0.02 * np.sin(2 * TWO_PI * ph + 0.5)
    nz = r.standard_normal(n)
    core = lp(nz, 240) * np.sin(TWO_PI * ph) * 2.2
    air = bp(nz, 1200, 6500) * 0.25
    chiff = np.zeros(n)
    for s, d, p, v in notes:
        a = ns(s)
        if a < n:
            tt = t[a:] - s
            chiff[a:] += v * np.exp(-tt / 0.035)
    an = amp / (np.max(amp) + 1e-12)
    y = (tone + breath * core) * amp + breath * air * amp * an + bp(nz, 700, 4500) * chiff * 0.25 * breath
    y = hp(y, 110)
    return _norm(pan(y, pan_c) * 0.7071, amp)


def solo_bowed_line(notes, rel=0.6, att=0.18, glide=0.11, dyn=None, seed=0, nasal=1.0, pan_c=0.0,
                    vib_depth=22.0, vib_rate=5.6):
    """A single bowed string with sliding portamento and expressive vibrato (between a viola and an erhu)."""
    r = _rng(seed + 404)
    n, f, amp, ve = line_curves(notes, rel=rel, att=att, glide=glide, vib_delay=0.28)
    if dyn is not None:
        amp = amp * pts_env(n, dyn)
    t = tvec(n)
    rate = vib_rate * (1 + 0.05 * smooth_random(n, 0.8, r))
    vib = np.sin(TWO_PI * np.cumsum(rate) / SR + r.uniform(0, TWO_PI))
    cents = vib_depth * ve * vib + 4.0 * smooth_random(n, 1.4, r)
    src = saw(f * 2 ** (cents / 1200.0), n, r.random())
    y = eq(hp(src, 240), [('peak', 900, 7.0 * nasal, 1.6), ('peak', 2400, 4.0 * nasal, 1.8),
                         ('peak', 4600, -6.0, 1.0)])
    y = lp(y, 6500)
    an = amp / (np.max(amp) + 1e-12)
    y = y * amp + bp(r.standard_normal(n), 1800, 7000) * 0.06 * amp * an
    return _norm(pan(y, pan_c) * 0.7071, amp)


_HUM = [(290, 70, 0.0), (640, 90, -9.0), (2300, 140, -28.0), (2850, 190, -33.0)]


def voice_line(notes, rel=0.9, att=0.22, glide=0.08, dyn=None, seed=0, formants=None, breath=0.05,
               pan_c=0.0, vib_depth=18.0):
    """One warm human voice humming ('oo'), with natural vibrato, jitter and breath."""
    r = _rng(seed + 505)
    n, f, amp, ve = line_curves(notes, rel=rel, att=att, glide=glide, vib_delay=0.4)
    if dyn is not None:
        amp = amp * pts_env(n, dyn)
    t = tvec(n)
    rate = 5.2 * (1 + 0.06 * smooth_random(n, 0.7, r))
    cents = (vib_depth * ve * np.sin(TWO_PI * np.cumsum(rate) / SR + r.uniform(0, TWO_PI))
             + 3.0 * smooth_random(n, 7.0, r))
    src = lp(saw(f * 2 ** (cents / 1200.0), n, r.random()), 800, order=1)
    y = formant_bank(src, formants or _HUM) + 0.25 * lp(src, 380)
    an = amp / (np.max(amp) + 1e-12)
    y = y * amp * (1 + 0.04 * smooth_random(n, 9.0, r)) + breath * bp(r.standard_normal(n), 400, 3200) * amp * an
    return _norm(pan(hp(y, 70), pan_c) * 0.7071, amp)


def stone_chime(pitch, vel=0.7, seed=0, length=None):
    """Qing 磬, the Shang stone chime: clear, slightly inharmonic, a soft wooden mallet."""
    r = _rng(seed + 606)
    m = n2m(pitch)
    f0 = float(mtof(m))
    T = 3.2 * 2 ** (-(m - 57) / 24)
    n = ns(length or T * 1.1)
    t = tvec(n)
    y = _additive(f0, [1, 2.27, 3.73, 5.42, 7.37, 9.6], [1, 0.42, 0.26, 0.14, 0.07, 0.035],
                  [T, T * 0.5, T * 0.3, T * 0.18, T * 0.1, T * 0.06], n, r, beat=0.35)
    y *= np.minimum(t / 0.0012, 1)
    y += bp(r.standard_normal(n), 500, 4500) * np.exp(-t / 0.004) * 0.22
    return fade(y * 0.2 * vel, 0, 0.1)


def bronze_bell(pitch, vel=0.7, seed=0, decay=1.0, bright=1.0):
    """Bianzhong-like bronze bell (hum, prime, minor-third tierce, quint, nominal...), fairly short."""
    r = _rng(seed + 707)
    m = n2m(pitch)
    f0 = float(mtof(m))
    T = 1.7 * decay * 2 ** (-(m - 69) / 24)
    n = ns(T * 1.25 + 0.05)
    t = tvec(n)
    y = _additive(f0, [0.5, 1.0, 1.19, 1.5, 2.0, 2.66, 3.17, 4.2],
                  [0.22, 1.0, 0.45, 0.22, 0.32 * bright, 0.16 * bright, 0.1 * bright, 0.05 * bright],
                  [T * 1.3, T, T * 0.8, T * 0.6, T * 0.5, T * 0.32, T * 0.24, T * 0.14], n, r, beat=0.6)
    y *= np.minimum(t / 0.0008, 1)
    y += bp(r.standard_normal(n), 900, 6000) * np.exp(-t / 0.0025) * 0.18 * bright
    return fade(y * 0.17 * vel, 0, 0.05)


def wind_chime(pitch, vel=0.6, seed=0, decay=1.0):
    """A small bell in the wind: thin free-bar partials, long shimmer, soft brass clapper."""
    r = _rng(seed + 808)
    m = n2m(pitch)
    f0 = float(mtof(m))
    T = 3.2 * decay * 2 ** (-(m - 84) / 24)
    n = ns(T * 1.1 + 0.05)
    t = tvec(n)
    y = _additive(f0, [1, 2.76, 5.40, 8.93], [1, 0.26, 0.09, 0.035], [T, T * 0.42, T * 0.2, T * 0.1], n, r,
                  beat=0.9)
    y *= np.minimum(t / 0.0015, 1)
    y += bp(r.standard_normal(n), 2500, 9000) * np.exp(-t / 0.0012) * 0.12
    return fade(lp(y, 9000) * 0.16 * vel, 0, 0.1)


def data_pluck(pitch, vel=0.6, seed=0, t60=0.9):
    """Soft tine pluck (kalimba-like) for the data pattern."""
    r = _rng(seed + 909)
    f0 = float(mtof(n2m(pitch)))
    n = ns(t60 * 1.1 + 0.03)
    t = tvec(n)
    y = _additive(f0, [1, 2.0, 5.95], [1, 0.08, 0.13], [t60, t60 * 0.35, t60 * 0.07], n, r)
    y *= np.minimum(t / 0.001, 1)
    y += hp(r.standard_normal(n), 2500) * np.exp(-t / 0.0008) * 0.08
    return fade(y * 0.18 * vel, 0, 0.03)


def blip(pitch, vel=0.6, dur=0.08, wave='square', cutoff=2500.0, seed=0, duty=0.5):
    """Short electronic pulse (filtered square / saw)."""
    r = _rng(seed + 1001)
    f = float(mtof(n2m(pitch)))
    n = ns(dur + 0.06)
    t = tvec(n)
    osc = square(f, n, r.random() * 0.0, duty) if wave == 'square' else saw(f, n, 0.0)
    env = np.minimum(t / 0.0015, 1) * np.exp(-t / max(dur * 0.55, 0.004))
    y = lp(osc * env, cutoff, order=2)
    return fade(y * 0.07 * vel, 0, 0.01)
