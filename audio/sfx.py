"""Sound design for 歸途: UI, impacts, whooshes, ambiences (all synthesised)."""
from __future__ import annotations

import numpy as np
from scipy import signal

from dsp import (SR, TWO_PI, n2m, mtof, ns, tvec, pts_env, asr, onepole, smooth_random, saw, square,
                 sine, colored_noise, lp, hp, bp, eq, tv_lowpass, tv_filter, pan, sat, fade, undb, haas, balance)
from instruments import cymbal, bell, glass, plink, taiko


def R(seed):
    return np.random.default_rng(seed)


def ease_io_cubic(x):
    x = np.clip(x, 0, 1)
    return np.where(x < 0.5, 4 * x ** 3, 1 - (-2 * x + 2) ** 3 / 2)


# ----------------------------------------------------------------------------
# building blocks
# ----------------------------------------------------------------------------
def boom(f0=60.0, f1=26.0, sweep=0.9, t60=4.0, noise=0.4, click=0.1, seed=0, drive=1.3):
    r = R(seed)
    n = ns(t60 + 0.6)
    t = tvec(n)
    f = f1 + (f0 - f1) * np.exp(-t / (sweep / 3))
    y = np.sin(TWO_PI * np.cumsum(f) / SR) * np.exp(-6.91 * t / t60) * np.minimum(t / 0.002, 1)
    nz = r.standard_normal(n)
    y += lp(nz, 160) * np.exp(-t / 0.18) * noise
    y += bp(nz, 900, 5000) * np.exp(-t / 0.004) * click
    y = sat(y, drive)
    return fade(y * 0.5, 0, 0.3)


def whoosh(rise=1.4, fall=1.0, f_lo=250.0, f_hi=5000.0, seed=0, pans=(-0.7, 0.6), level=1.0):
    """Swells to a peak at t=rise, then decays. Band-pass centre rides the envelope."""
    r = R(seed)
    n = ns(rise + fall)
    t = tvec(n)
    x = colored_noise(n, r, -2.0)
    up = np.clip(t / rise, 0, 1) ** 3
    dn = np.exp(-np.maximum(t - rise, 0) / (fall / 4))
    env = np.where(t < rise, up, dn)

    def mask(f, tt):
        e = np.interp(tt, t, env)
        fc = f_lo * (f_hi / f_lo) ** e
        lf = np.log2(np.maximum(f, 20))[:, None]
        return np.exp(-0.5 * ((lf - np.log2(fc)[None, :]) / 1.1) ** 2)
    y = tv_filter(x, mask, nper=1024, hop=256) * env
    p = np.interp(t, [0, rise, rise + fall], [pans[0], 0.5 * (pans[0] + pans[1]), pans[1]])
    return fade(pan(y * 0.25 * level, p), 0.01, 0.1)


def crackle(dur, density_pts, seed=0, band=(1000, 7000), amp=0.3, width=0.9):
    """Debris / particle crackle: impulse trains convolved with short kernels."""
    r = R(seed)
    n = ns(dur)
    dens = pts_env(n, density_pts)
    p = dens / SR
    ev = np.nonzero(r.random(n) < p)[0]
    out = np.zeros((2, n))
    groups = 4
    for g in range(groups):
        sel = ev[r.integers(0, groups, len(ev)) == g]
        if len(sel) == 0:
            continue
        imp = np.zeros((2, n))
        a = r.pareto(2.5, len(sel)) * 0.3 + 0.1
        a = np.minimum(a, 1.5) * r.choice([-1, 1], len(sel))
        pp = r.uniform(-width, width, len(sel))
        ang = (pp + 1) * np.pi / 4
        imp[0, sel] = a * np.cos(ang)
        imp[1, sel] = a * np.sin(ang)
        kl = ns(r.uniform(0.002, 0.008))
        lo = r.uniform(band[0], band[1] * 0.6)
        k = bp(r.standard_normal(kl), lo, min(lo * 3, band[1])) * np.exp(-np.arange(kl) / (kl / 4))
        for ch in range(2):
            out[ch] += signal.fftconvolve(imp[ch], k)[:n]
    return out * amp


def ui_blip(f=1975.5, vel=1.0, second=1.5):
    n = ns(0.3)
    t = tvec(n)
    y = np.zeros(n)
    for dt, ff in [(0.0, f), (0.055, f * second)]:
        tt = np.maximum(t - dt, 0)
        e = (t >= dt) * np.minimum(tt / 0.002, 1) * np.exp(-tt / 0.028)
        y += e * (np.sin(TWO_PI * ff * tt) + 0.12 * np.sin(TWO_PI * 3 * ff * tt))
    return fade(y * 0.15 * vel, 0, 0.02)


def tick(vel=1.0, seed=0, f=3200.0):
    r = R(seed)
    n = ns(0.03)
    t = tvec(n)
    y = hp(r.standard_normal(n), 2500) * np.exp(-t / 0.0012) * 0.5
    y += np.sin(TWO_PI * f * t) * np.exp(-t / 0.004) * 0.3
    return fade(y * vel * 0.1, 0, 0.005)


def lock_click(vel=1.0, seed=0):
    """Subtle reticle snap: tick + lower tock."""
    n = ns(0.12)
    y = np.zeros(n)
    a = tick(1.0, seed, 3400.0)
    b = tick(0.7, seed + 1, 1500.0)
    y[:len(a)] += a
    y[ns(0.035):ns(0.035) + len(b)] += b
    return pan(y * vel, 0.1)


# ----------------------------------------------------------------------------
# PROLOGUE
# ----------------------------------------------------------------------------
def _glitch_gate(n, t0_rel, dur, seed):
    """On/off chop pattern over [t0_rel, t0_rel+dur] (1 elsewhere)."""
    r = R(seed)
    g = np.ones(n)
    a, b = ns(t0_rel), min(n, ns(t0_rel + dur))
    i = a
    while i < b:
        L = ns(r.uniform(0.01, 0.06))
        g[i:i + L] = r.choice([0.0, 0.3, 1.0, 1.4], p=[0.35, 0.2, 0.3, 0.15])
        i += L
    return onepole(g, 0.0015)


def prologue(S, A, T):
    tcut = T['hard_cut']  # 12.6
    tg = T['glitch']  # 11.6
    # sub rumble from silence
    n = ns(tcut)
    r = R(1)
    t = tvec(n)
    rum = lp(colored_noise(n, r, -6.0, channels=2), 90, order=4)
    rum += 0.6 * pan(np.sin(TWO_PI * 31.0 * t + 0.4 * smooth_random(n, 0.3, r)) * (0.7 + 0.3 * smooth_random(n, 0.25, r)), 0)
    env = np.clip(t / 3.0, 0, 1) ** 2.2 * (1 + 0.25 * np.clip((t - 3) / 9, 0, 1))
    env *= _glitch_gate(n, tg, tcut - tg, 2)
    rum = fade(rum * env, 0.0, 0.004)
    A.add(0.0, hp(rum, 28, order=2), -20.0, {'hall': 0.1})
    # data hum (3.0 -> cut)
    t0 = T['boot']
    n = ns(tcut - t0)
    t = tvec(n)
    hum = lp(saw(73.42, n) + 0.5 * saw(146.83 * 1.002, n), 260, order=4)
    chat = bp(r.standard_normal(n), 2500, 8000) * np.repeat(r.random(n // 1900 + 1), 1900)[:n] ** 3
    henv = np.clip(t / 0.6, 0, 1) * _glitch_gate(n, tg - t0, tcut - tg, 3)
    A.add(t0, fade(pan(hum * 0.05 + chat * 0.015, 0) * henv, 0.0, 0.004), -18.0, {'hall': 0.15})
    # frame lines unfold
    nn = ns(0.6)
    tt = tvec(nn)
    f = 300 * 2 ** (2.2 * np.clip(tt / 0.45, 0, 1))
    sw = np.sin(TWO_PI * np.cumsum(f) / SR) * np.sin(np.pi * np.clip(tt / 0.6, 0, 1)) ** 2
    S.add(t0, pan(sw * 0.05, 0) + haas(sw * 0.03, 9), -14.0, {'hall': 0.3})
    # boot lines: blip + typing ticks (46 chars/s, as drawn by the overlay)
    for i, ln in enumerate(T['boot_lines']):
        tl = t0 + ln['t']
        S.add(tl, pan(ui_blip(1567.98 if i else 1318.5, 1.0), 0.0), -12.0, {'hall': 0.35})
        nch = len(ln['text'])
        for c in range(nch):
            if ln['text'][c] == ' ':
                continue
            S.add(tl + 0.04 + c / 46.0, pan(tick(R(c).uniform(0.4, 1.0), c, R(c + 9).uniform(2600, 4200)),
                                             R(c).uniform(-0.3, 0.3)), -20.0, {'hall': 0.15})
    # progress bar: SYNCHRONISING TEMPORAL AXIS (easeInOutCubic, 10.0 -> 11.5)
    pb0 = T['boot'] + T['progress'][0]
    pb1 = T['boot'] + T['progress'][1]
    n = ns(pb1 - pb0 + 0.06)
    t = tvec(n)
    p = ease_io_cubic(t / (pb1 - pb0))
    f = 280 * 2 ** (2.6 * np.round(p * 100) / 100)
    tone = np.sin(TWO_PI * np.cumsum(f) / SR) + 0.25 * square(f * 2, n)
    tone = lp(tone, 3000) * np.clip(t / 0.15, 0, 1) * (0.5 + 0.5 * p)
    S.add(pb0, fade(pan(tone * 0.03, 0), 0.01, 0.06), -12.0, {'hall': 0.3})
    S.add(pb1, pan(ui_blip(2349.3, 0.9, 2.0), 0), -12.0, {'hall': 0.3})
    # glitch burst (digital stutter)
    S.add(tg, glitch(tcut - tg, seed=7), -9.0, {'hall': 0.15})
    # HARD CUT boom (free: survives the cut gate)
    S.add(tcut, pan(boom(58, 27, 1.0, 4.5, noise=0.5, click=0.25, seed=8), 0) * 0.7071, -3.0,
          {'hall': 0.2, 'space': 0.55}, layer='free')


def glitch(dur, seed=0):
    r = R(seed)
    n = ns(dur)
    y = np.zeros((2, n))
    i = 0
    last = None
    while i < n:
        L = ns(r.uniform(0.012, 0.07))
        L = min(L, n - i)
        prog = i / n
        kind = r.choice(['sq', 'noise', 'crush', 'gap', 'stutter'], p=[0.3, 0.25, 0.2, 0.1, 0.15])
        if kind == 'stutter' and last is not None:
            sl = last[:, :min(last.shape[1], ns(r.uniform(0.008, 0.02)))]
            seg = np.tile(sl, L // sl.shape[1] + 1)[:, :L]
        else:
            if kind == 'sq':
                m = square(r.uniform(150, 3200), L) * 0.5
            elif kind == 'noise':
                lo = r.uniform(200, 5000)
                m = bp(r.standard_normal(L), lo, min(lo * r.uniform(1.5, 4), 20000)) * 1.2
            elif kind == 'crush':
                h = r.integers(6, 48)
                m = np.repeat(r.uniform(-1, 1, L // h + 1), h)[:L] * 0.4
            else:
                m = np.zeros(L)
            seg = pan(fade(m, 0.001, 0.001) * r.uniform(0.3, 1.0) * (0.5 + 0.7 * prog), r.uniform(-0.8, 0.8))
            last = seg
        y[:, i:i + L] += seg[:, :L]
        i += L
    return y * 0.35


# ----------------------------------------------------------------------------
# ACT I: plasma, fusion, collapse, supernova
# ----------------------------------------------------------------------------
def plasma(dur, seed=0, pulse=0.0):
    r = R(seed)
    n = ns(dur)
    t = tvec(n)
    b = colored_noise(n, r, -6.0, channels=2)
    pk = colored_noise(n, r, -3.0, channels=2)
    m1 = 0.5 + 0.5 * smooth_random(n, 0.6, r)
    m2 = 0.5 + 0.5 * smooth_random(n, 1.3, r)
    y = lp(b, 140) * 1.0 + lp(pk, 500) * m1 * 0.5 + bp(pk, 600, 2200) * m2 ** 2 * 0.18
    # convection whumps
    for _ in range(int(dur * 0.5)):
        c = r.uniform(0, dur)
        w = r.uniform(0.6, 1.6)
        e = np.exp(-0.5 * ((t - c) / (w / 3)) ** 2)
        y += lp(b, 90) * e * r.uniform(0.4, 1.0)
    if pulse:
        y *= 1 + pulse * np.sin(TWO_PI * 0.55 * t - np.pi / 2)
    y += 0.12 * crackle(dur, [(0, 6), (dur, 6)], seed + 1, band=(800, 4000), amp=0.6)
    return hp(y, 38, order=2) * 0.12


def act1(S, A, T):
    t0, tf = T['forge'], T['fusion']
    # plasma roar (17 -> 33), under the 3 s fade-in
    pl = plasma(tf - t0 + 0.4, seed=11)
    n = pl.shape[1]
    pl *= pts_env(n, [(0, 0), (3.0, 0.7), (tf - t0 - 2, 1.0), (tf - t0, 1.15), (tf - t0 + 0.4, 0)])
    A.add(t0, pl, -6.0, {'hall': 0.25})
    # white flash whoosh into the core
    S.add(tf - 1.5, whoosh(1.5, 1.1, 200, 7000, seed=12, pans=(-0.6, 0.5)), -3.0, {'hall': 0.3, 'space': 0.3})
    S.add(tf, pan(boom(90, 45, 0.5, 1.6, noise=0.3, click=0.05, seed=13), 0) * 0.7071, -12.0, {'space': 0.3})
    # fusion: particle blizzard (33 -> 49)
    tc = T['collapse']
    d = tc - tf + 1.5
    n = ns(d)
    r = R(14)
    t = tvec(n)
    blz = crackle(d, [(0, 220), (d, 260)], seed=15, band=(1500, 12000), amp=0.35)
    hiss = bp(colored_noise(n, r, -1.0, channels=2), 2500, 11000) * (0.4 + 0.6 * smooth_random(n, 3.0, r) ** 2) * 0.05
    zips = np.zeros((2, n))
    for _ in range(int(d * 2.5)):
        c = r.uniform(0, d - 0.2)
        L = ns(r.uniform(0.04, 0.12))
        tt = tvec(L)
        f = r.uniform(1800, 5000) * 2 ** (r.choice([-1, 1]) * tt / 0.1)
        z = np.sin(TWO_PI * np.cumsum(f) / SR) * np.sin(np.pi * tt / tt[-1]) ** 2 * r.uniform(0.02, 0.06)
        p0 = r.uniform(-0.9, 0.9)
        zips[:, ns(c):ns(c) + L] += pan(z, np.linspace(p0, -p0, L))
    fz = (blz + hiss + zips) * pts_env(n, [(0, 0), (0.3, 1), (d - 2.5, 1), (d, 0)])[None]
    A.add(tf, fz, -6.0, {'hall': 0.35})
    # the atom is born: collision flash + lock click
    tl = T['lock1']
    S.add(tl, pan(boom(120, 60, 0.3, 1.0, noise=0.2, click=0.1, seed=16), 0) * 0.7071, -14.0, {'space': 0.4})
    sp = hp(R(17).standard_normal(ns(1.5)), 5000) * np.exp(-tvec(ns(1.5)) / 0.25) * np.minimum(tvec(ns(1.5)) / 0.003, 1)
    S.add(tl, pan(sp * 0.04, 0) + haas(sp * 0.03, 7), -6.0, {'space': 0.5})
    S.add(tl + 0.5, lock_click(1.0, 18), -14.0, {'hall': 0.2})
    # the sick, pulsing star (49 -> 61.5) - roar returns, pulsing
    ts = T['silence']
    pl2 = plasma(ts - tc, seed=19, pulse=0.45)
    n = pl2.shape[1]
    pl2 *= pts_env(n, [(0, 0), (1.5, 0.8), (ts - tc - 0.02, 1.4), (ts - tc, 0)])
    A.add(tc, pl2, -6.0, {'hall': 0.25})
    # warning alarms every second (filtered, subtle)
    for k, t in enumerate(T['alarms']):
        S.add(t, alarm(seed=k), -16.0 + 1.2 * k, {'hall': 0.4})
    # implosion: reverse cymbal suck + pitch-down groan, ending exactly at the cut
    ti = T['implosion']
    c = cymbal(ts - ti + 0.4, seed=20)[::-1][-ns(ts - ti):]
    c = fade(c, 0.3, 0.003)
    S.add(ti, haas(c, 11) * 1.1, -4.0, {'hall': 0.2})
    S.add(ti, groan(ts - ti, seed=21), -6.0, {'hall': 0.2})
    rs = rev_swell(ts - ti, seed=22)
    S.add(ti, rs, -8.0, None)
    # 61.5–63.0 total black: only a faint high tinnitus sine (free layer)
    d = T['supernova'] - ts
    n = ns(d)
    tt = tvec(n)
    tin = np.sin(TWO_PI * 7040 * tt) * np.clip(tt / 0.35, 0, 1) * np.clip((d - tt) / 0.05, 0, 1)
    tin *= 1 + 0.15 * np.sin(TWO_PI * 0.7 * tt)
    S.add(ts, pan(tin * 0.02, 0.05), -23.0, None, layer='free')
    supernova(S, A, T)


def alarm(seed=0):
    n = ns(0.6)
    t = tvec(n)
    f = 520 * 2 ** (-0.35 * np.clip(t / 0.45, 0, 1))
    y = square(f, n, 0.0, 0.5) + 0.5 * saw(f * 1.5, n)
    y = bp(y, 300, 1300) * np.minimum(t / 0.03, 1) * np.clip((0.5 - t) / 0.1, 0, 1)
    return pan(y * 0.06, 0.25) + haas(y * 0.03, 15)


def groan(dur, seed=0):
    r = R(seed)
    n = ns(dur)
    t = tvec(n)
    x = np.zeros(n)
    for p in [38, 39, 33]:
        f = float(mtof(p)) * 2 ** (-2.2 * (t / dur) ** 1.4)
        x += saw(f * r.uniform(0.995, 1.005), n, r.random())
    fc = 900 * 2 ** (-1.5 * t / dur)
    y = tv_lowpass(x, fc, order=2)
    y = sat(y * 2.0, 1.0) * (t / dur) ** 1.6
    return fade(pan(y * 0.12, 0), 0.05, 0.003)


def rev_swell(dur, seed=0):
    """Sucking noise sweep (band-pass falls as it swells) for the implosion."""
    r = R(seed)
    n = ns(dur)
    t = tvec(n)
    x = colored_noise(n, r, -1.5, channels=2)
    env = (t / dur) ** 3

    def mask(f, tt):
        fc = 6000 * 2 ** (-3.5 * np.clip(tt / dur, 0, 1))
        lf = np.log2(np.maximum(f, 20))[:, None]
        return np.exp(-0.5 * ((lf - np.log2(fc)[None, :]) / 0.9) ** 2)
    y = tv_filter(x, mask, 1024, 256) * env
    return fade(y * 0.25, 0.1, 0.003)


def supernova(S, A, T):
    t = T['supernova']
    r = R(31)
    L = 14.0
    n = ns(L)
    tt = tvec(n)
    # 1. impact kick + crack
    S.add(t, pan(boom(115, 30, 0.6, 3.5, noise=0.8, click=0.6, seed=32, drive=2.0), 0) * 0.7071, 1.0,
          {'hall': 0.25, 'space': 0.5})
    crack = bp(r.standard_normal(ns(1.0)), 700, 9000) * np.exp(-tvec(ns(1.0)) / 0.05) * np.minimum(tvec(ns(1.0)) / 0.001, 1)
    S.add(t, haas(crack * 0.5, 6), -2.0, {'space': 0.5})
    # 2. sub drop 70 -> 22 Hz
    f = 22 + 48 * np.exp(-tt / 1.3)
    sub = np.sin(TWO_PI * np.cumsum(f) / SR) * np.minimum(tt / 0.02, 1) * np.exp(-6.91 * tt / 8.0)
    S.add(t, pan(sat(sub * 1.5, 1.2) * 0.45, 0) * 0.7071, 0.0, None)
    # 3. crash
    S.add(t, haas(cymbal(7.0, seed=33, bright=1.0), 9), -2.0, {'space': 0.6})
    # 4. shock-wave roar (brown noise with closing lowpass)
    roar = colored_noise(n, r, -5.0, channels=2)
    fc = 200 + 3800 * np.exp(-tt / 0.8)
    roar = tv_lowpass(roar, fc, order=2) * np.minimum(tt / 0.01, 1) * np.exp(-6.91 * tt / 11.0)
    S.add(t, roar * 0.22, 0.0, {'hall': 0.2, 'space': 0.3})
    # 5. debris crackle
    dc = crackle(11.0, [(0, 140), (1.5, 90), (5, 25), (11, 2)], seed=34, band=(700, 9000), amp=0.7)
    dc *= pts_env(dc.shape[1], [(0, 0), (0.15, 1), (8, 0.6), (11, 0)])[None]
    S.add(t + 0.2, dc, -6.0, {'hall': 0.3, 'space': 0.5})
    # 6. low debris thumps
    for k in range(9):
        tk = t + 0.8 + r.exponential(1.8) * (1 + k * 0.3)
        if tk < t + 11:
            S.add(tk, pan(taiko(r.uniform(0.2, 0.45), 'm', k), r.uniform(-0.7, 0.7)), -16.0, {'space': 0.5})


# ----------------------------------------------------------------------------
# ACT II: drift, ignition, earth
# ----------------------------------------------------------------------------
def space_wind(dur, seed=0, lo=250, hi=2500):
    r = R(seed)
    n = ns(dur)
    x = colored_noise(n, r, -3.0, channels=2)
    c = smooth_random(n, 0.15, r, 0, 1)
    y = lp(x, lo) * (1 - c) + bp(x, lo, hi) * c * 0.6
    return y * (0.6 + 0.4 * smooth_random(n, 0.2, r, 0, 1)) * 0.06


def act2(S, A, T):
    t0, ti = T['drift'], T['ignition']
    w = space_wind(ti - t0 + 2.0, seed=41)
    w *= pts_env(w.shape[1], [(0, 0), (2.0, 1), (ti - t0 - 1, 1), (ti - t0 + 2, 0)])[None]
    A.add(t0, w, -12.0, {'space': 0.4})
    S.add(T['lock2'] + 0.5, lock_click(0.8, 42), -18.0, {'hall': 0.3})
    # warm swell into the ignition, then a soft impact
    d = 4.0
    n = ns(d)
    t = tvec(n)
    r = R(43)
    sw = tv_lowpass(colored_noise(n, r, -4.0, channels=2), 300 + 2500 * (t / d) ** 2)
    sw = sw * (t / d) ** 3 * 0.2
    sw += pan(np.sin(TWO_PI * 87.3 * t) * (t / d) ** 3 * 0.08, 0)
    S.add(ti - d, fade(sw, 0.2, 0.01), -6.0, {'space': 0.4})
    S.add(ti, pan(boom(80, 40, 0.8, 2.8, noise=0.25, click=0.03, seed=44), 0) * 0.7071, -6.0, {'space': 0.5})
    fl = hp(r.standard_normal(ns(2.5)), 3000) * np.exp(-tvec(ns(2.5)) / 0.5) * 0.05
    S.add(ti, haas(fl, 8), -10.0, {'space': 0.6})
    # release tick at 121.6
    S.add(T['release2'], lock_click(0.5, 45), -22.0, {'hall': 0.3})


# ----------------------------------------------------------------------------
# ACT III: ocean, cells, night, heartbeat
# ----------------------------------------------------------------------------
def ocean_waves(dur, seed=0):
    r = R(seed)
    n = ns(dur)
    t = tvec(n)
    env = np.zeros(n)
    c = r.uniform(0.5, 2.0)
    while c < dur + 3:
        rise, decay = r.uniform(1.5, 2.6), r.uniform(2.0, 3.6)
        a = r.uniform(0.6, 1.0)
        e = np.where(t < c, np.exp(-((c - t) / (rise / 2.2)) ** 2), np.exp(-(t - c) / (decay / 2.5)))
        env = np.maximum(env, a * e)
        c += r.uniform(4.8, 7.5)
    x = colored_noise(n, r, -2.5, channels=2)
    fc = 350 + 4200 * env ** 1.5
    y = tv_lowpass(x, fc, order=2) * (0.18 + env)
    foam = hp(colored_noise(n, r, 0.0, channels=2), 3500) * np.maximum(onepole(env, 0.8) - env * 0.6, 0) ** 2
    surf = lp(colored_noise(n, r, -3.0, channels=2), 500) * 0.25
    return hp(y + 0.5 * foam + surf, 45, order=2) * 0.12


def bubbles(t0, t1, density, seed=0, f_range=(250, 1400)):
    r = R(seed)
    out = []
    t = t0
    while t < t1:
        t += r.exponential(1.0 / density)
        f0 = r.uniform(*f_range)
        L = ns(r.uniform(0.03, 0.12))
        tt = tvec(L)
        f = f0 * (1 + 2.5 * tt / tt[-1])
        y = np.sin(TWO_PI * np.cumsum(f) / SR) * np.exp(-tt / (tt[-1] / 3)) * np.minimum(tt / 0.002, 1)
        out.append((t, pan(y * r.uniform(0.01, 0.05), r.uniform(-0.8, 0.8))))
    return out


def act3(S, A, T):
    to, tu, tt0 = T['ocean'], T['underwater'], T['tree']
    w = ocean_waves(tt0 - to + 1.5, seed=51)
    w *= pts_env(w.shape[1], [(0, 0), (1.0, 1), (tt0 - to - 0.5, 1), (tt0 - to + 1.5, 0)])[None]
    A.add(to, w, -3.0, {'hall': 0.15})
    # underwater bed (gets muffled with the rest of the ambience)
    d = tt0 - tu + 1.5
    n = ns(d)
    r = R(52)
    uw = lp(colored_noise(n, r, -5.0, channels=2), 220) * (0.7 + 0.3 * smooth_random(n, 0.3, r))
    uw *= pts_env(n, [(0, 0), (0.3, 1), (d - 1.5, 1), (d, 0)])[None]
    A.add(tu, hp(uw, 35) * 0.2, -8.0, {'hall': 0.2})
    # the plunge: splash bright for 120 ms, then muffled
    n = ns(1.5)
    t = tvec(n)
    sp = colored_noise(n, r, -1.0, channels=2) * np.exp(-t / 0.25) * np.minimum(t / 0.01, 1)
    sp = tv_lowpass(sp, 9000 * np.exp(-t / 0.12) + 300, order=2)
    S.add(tu - 0.08, sp * 0.15, -4.0, {'hall': 0.3})
    for tb, b in bubbles(tu, tu + 1.2, 35, seed=53):
        S.add(tb, b, -6.0, {'hall': 0.3}, layer='free')
    for tb, b in bubbles(tu + 1.2, tt0, 4, seed=54):
        S.add(tb, b, -10.0, {'hall': 0.3}, layer='free')
    # cell division plinks (accelerating: 2, 4, 8, ...)
    notes = ['D6', 'A5', 'F6', 'C6', 'E6', 'A6', 'D7', 'G6']
    for k, tp in enumerate(T['cells']):
        x = plink(notes[k % len(notes)], 0.7, seed=k)
        S.add(tp, pan(x, (-1) ** k * 0.3 * (k % 3)), -8.0, {'hall': 0.3, 'space': 0.4}, layer='free')
    S.add(T['lock3'] + 0.5, lock_click(0.7, 55), -18.0, {'hall': 0.3}, layer='free')


def crickets(dur, seed=0, n_cr=6):
    r = R(seed)
    n = ns(dur)
    t = tvec(n)
    out = np.zeros((2, n))
    for c in range(n_cr):
        fc = r.uniform(3900, 5300)
        rate = r.uniform(1.6, 3.2)
        pulses = r.integers(2, 5)
        pr = r.uniform(26, 38)
        ph = (t * rate + r.random()) % 1.0
        tin = ph / rate
        pulse_idx = tin * pr
        on = (pulse_idx < pulses).astype(float)
        pe = np.sin(np.pi * (pulse_idx % 1.0)) ** 2 * on
        dist = 0.4 + 0.6 * (0.5 + 0.5 * smooth_random(n, 0.05, r))
        y = (np.sin(TWO_PI * fc * t) + 0.12 * np.sin(TWO_PI * 2 * fc * t)) * pe * dist * r.uniform(0.3, 1.0)
        out += pan(y, r.uniform(-0.9, 0.9))
    bed = bp(colored_noise(n, r, 0.0, channels=2), 4000, 5600)
    bed *= (0.5 + 0.5 * np.sin(TWO_PI * 31 * t))[None] * 0.15
    return lp(out + bed, 9000) * 0.02


def night_wind(dur, seed=0):
    r = R(seed)
    n = ns(dur)
    x = colored_noise(n, r, -3.0, channels=2)
    gust = 0.5 + 0.5 * smooth_random(n, 0.18, r)
    fc = 250 + 900 * gust
    y = tv_lowpass(x, fc, order=2) * (0.3 + 0.7 * gust)
    return y * 0.05


def heartbeat(vel=1.0, seed=0):
    r = R(seed)
    n = ns(0.75)
    t = tvec(n)
    y = np.zeros(n)
    for dt, f0, a in [(0.0, 58.0, 1.0), (0.27, 66.0, 0.7)]:
        tt = np.maximum(t - dt, 0)
        f = f0 * (1 - 0.3 * np.minimum(tt / 0.08, 1))
        e = (t >= dt) * np.minimum(tt / 0.006, 1) * np.exp(-tt / 0.07)
        y += a * e * np.sin(TWO_PI * np.cumsum(f) / SR)
        y += a * 0.3 * lp(r.standard_normal(n), 140) * e
    return fade(lp(y, 300) * 0.5 * vel, 0, 0.02)


def act3_night(S, A, T):
    tn = T['night_cut']  # 151.6
    ts = T['heart_stop']  # 186
    d = ts - tn
    cr = crickets(d + 0.3, seed=61)
    cr *= pts_env(cr.shape[1], [(0, 0), (0.6, 1), (d - 6, 0.9), (d - 0.4, 0.7), (d, 0), (d + 0.3, 0)])[None]
    A.add(tn, cr, 0.0, {'hall': 0.3})
    wd = night_wind(d + 0.3, seed=62)
    wd *= pts_env(wd.shape[1], [(0, 0), (1.0, 1), (d - 0.4, 1), (d, 0), (d + 0.3, 0)])[None]
    A.add(tn, wd, -3.0, {'hall': 0.2})
    # after the silence the wind returns, gently, with the particles
    te = T['act4']
    w2 = night_wind(te - T['harmonic'] + 1.0, seed=63)
    w2 *= pts_env(w2.shape[1], [(0, 0), (2.0, 0.8), (te - T['harmonic'], 0.5), (te - T['harmonic'] + 1, 0)])[None]
    A.add(T['harmonic'] + 0.5, w2, -5.0, {'space': 0.4}, layer='free')
    S.add(T['lock4'] + 0.5, lock_click(0.4, 64), -26.0, {'hall': 0.3})
    S.add(T['release4'], lock_click(0.3, 65), -28.0, {'hall': 0.3})
    # heartbeat: 72 bpm slowing to ~40, stops before 186
    th = T['heart']
    t = th
    beats = []
    while True:
        bpm = float(np.interp(t, [th, ts - 0.5], [72, 40]))
        beats.append(t)
        t += 60.0 / bpm
        if t > ts - 0.95:
            break
    for k, tb in enumerate(beats):
        v = float(np.interp(k, [0, len(beats) - 1], [1.0, 0.65]))
        S.add(tb, pan(heartbeat(v, seed=k), 0) * 0.7071, -2.0, {'hall': 0.12})
    T['_heartbeats'] = beats


# ----------------------------------------------------------------------------
# ACT IV: red giant fire, climax, nursery, signal lost, new world
# ----------------------------------------------------------------------------
def fire_roar(dur, seed=0):
    r = R(seed)
    n = ns(dur)
    t = tvec(n)
    b = colored_noise(n, r, -5.0, channels=2)
    w = colored_noise(n, r, -2.0, channels=2)
    gust = 0.5 + 0.5 * smooth_random(n, 0.5, r)
    y = lp(b, 220) + tv_lowpass(w, 500 + 2500 * gust, order=2) * gust * 0.35
    y += 0.25 * crackle(dur, [(0, 30), (dur, 60)], seed + 1, band=(500, 5000), amp=0.8)
    return hp(y, 35, order=2) * 0.12


def act4(S, A, T):
    t0, tf, tc = T['act4'], T['fire'], T['climax']
    # red giant: deep rumble from the fade-in
    rg = plasma(tc - t0 + 0.8, seed=71)
    rg *= pts_env(rg.shape[1], [(0, 0), (1.5, 0.6), (tc - t0, 0.8), (tc - t0 + 0.8, 0)])[None]
    A.add(t0, rg, -9.0, {'hall': 0.2})
    # atmospheric stripping: fire/wind roar from 197
    fr = fire_roar(tc - tf + 1.0, seed=72)
    fr *= pts_env(fr.shape[1], [(0, 0), (2.5, 0.6), (tc - tf - 0.2, 1.2), (tc - tf + 1.0, 0)])[None]
    A.add(tf, fr, -4.0, {'hall': 0.25})
    # white flash: whoosh + impact
    S.add(tc - 1.4, whoosh(1.4, 1.2, 250, 8000, seed=73, pans=(0.6, -0.5)), 0.0, {'hall': 0.3, 'space': 0.3})
    S.add(tc, pan(boom(100, 32, 0.6, 3.0, noise=0.6, click=0.4, seed=74, drive=1.8), 0) * 0.7071, -3.0,
          {'hall': 0.25, 'space': 0.5})
    # planetary nebula: soft cosmic wind
    tn = T['nursery']
    w = space_wind(tn - tc + 6, seed=75, lo=300, hi=3000)
    w *= pts_env(w.shape[1], [(0, 0), (3, 1), (tn - tc + 4, 1), (tn - tc + 6, 0)])[None]
    A.add(tc, w, -12.0, {'space': 0.4})
    S.add(T['lock5'] + 0.5, lock_click(0.8, 76), -16.0, {'hall': 0.3})
    # nursery: star ignitions = soft glassy pings
    pitches = ['A6', 'D7', 'E7', 'F6', 'C7', 'A6', 'G6', 'D7', 'E6']
    r = R(77)
    for k, tp in enumerate(T['pings']):
        S.add(tp, pan(glass(pitches[k % len(pitches)], r.uniform(0.5, 0.9), seed=k), r.uniform(-0.8, 0.8)),
              -8.0, {'hall': 0.2, 'space': 0.7})
    # SIGNAL LOST
    tl = T['lost']
    for k in range(3):  # beeps on the 5 Hz blink
        S.add(tl + 0.4 * k, error_beep(1.0 - 0.2 * k, seed=k), -9.0, {'hall': 0.3})
    st = static(5.5, seed=78)
    S.add(tl, st, -9.0, {'hall': 0.2})
    n = ns(0.6)
    tt = tvec(n)
    drop = np.sin(TWO_PI * np.cumsum(2200 * 2 ** (-3.3 * tt / 0.6)) / SR) * np.exp(-tt / 0.25)
    S.add(tl, pan(drop * 0.04, 0), -8.0, {'hall': 0.3})
    # new world: alien water lapping + gentle wind
    tw, tr, tf2 = T['newworld'], T['reacquire'], T['final_cards']
    d = tf2 - tw + 1.0
    la = lapping(d, seed=79)
    la *= pts_env(la.shape[1], [(0, 0), (2.5, 1), (d - 3, 1), (d - 0.6, 0.2), (d, 0)])[None]
    A.add(tw, la, -2.0, {'hall': 0.3})
    wd = night_wind(d, seed=80) * 0.7
    wd *= pts_env(wd.shape[1], [(0, 0), (3.0, 1), (d - 3, 1), (d, 0)])[None]
    A.add(tw, wd, -6.0, {'space': 0.3})
    # reacquire: lock click; STATUS HOME: soft chime
    S.add(tr + 0.5, lock_click(0.8, 81), -18.0, {'hall': 0.3})
    th = T['home']
    S.add(th, balance(bell('A6', 0.55, seed=82), -0.15), -6.0, {'hall': 0.2, 'space': 0.7})
    S.add(th + 0.09, balance(bell('D7', 0.45, seed=83), 0.2), -8.0, {'hall': 0.2, 'space': 0.7})
    S.add(T['release_end'], lock_click(0.3, 84), -26.0, {'hall': 0.3})
    # end title: very soft low boom
    S.add(T['endtitle'], pan(boom(50, 30, 1.0, 5.0, noise=0.2, click=0.0, seed=85), 0) * 0.7071, -14.0,
          {'space': 0.6})


def error_beep(vel=1.0, seed=0):
    n = ns(0.2)
    t = tvec(n)
    y = square(466.16, n, 0.0, 0.5) + square(493.88, n, 0.3, 0.5)
    y = bp(y, 300, 3000) * np.minimum(t / 0.004, 1) * np.clip((0.18 - t) / 0.01, 0, 1)
    return pan(y * 0.05 * vel, 0.1)


def static(dur, seed=0):
    r = R(seed)
    n = ns(dur)
    t = tvec(n)
    x = bp(colored_noise(n, r, -0.5, channels=2), 800, 9000)
    gate = np.repeat(r.choice([0.15, 0.6, 1.0, 1.0], n // 480 + 1), 480)[:n]
    gate = onepole(gate, 0.002)
    env = np.minimum(t / 0.01, 1) * np.exp(-t / 1.4) + 0.02 * np.exp(-t / 3)
    y = x * gate * env * 0.12 + 0.3 * crackle(dur, [(0, 150), (dur, 10)], seed + 1, band=(1500, 9000), amp=0.5) * env
    return fade(y, 0.002, 0.5)


def lapping(dur, seed=0):
    r = R(seed)
    n = ns(dur)
    t = tvec(n)
    env = np.zeros(n)
    fizz = np.zeros(n)
    c = r.uniform(0.3, 1.0)
    while c < dur:
        rise, dec = r.uniform(0.25, 0.5), r.uniform(0.6, 1.2)
        a = r.uniform(0.5, 1.0)
        e = np.where(t < c, np.exp(-((c - t) / rise) ** 2), np.exp(-(t - c) / dec))
        env += a * e
        f = np.where(t < c + 0.15, 0, np.exp(-(t - c - 0.15) / 0.5)) * (t > c + 0.15)
        fizz += a * f
        c += r.uniform(2.2, 3.6)
    x = colored_noise(n, r, -2.0, channels=2)
    y = tv_lowpass(x, 400 + 1800 * np.minimum(env, 1.5), order=2) * env
    y += hp(colored_noise(n, r, 0.0, channels=2), 4000) * fizz * 0.12
    y += lp(colored_noise(n, r, -4.0, channels=2), 180) * 0.15
    return y * 0.1


def render(S, A, T, log=print):
    """Render sound design into S (sfx) and ambience into A (layers: boot / main / night / free)."""
    with S.layer('boot'), A.layer('boot'):
        prologue(S, A, T)
    log('  sfx: prologue (rumble, boot UI, glitch, boom)')
    act1(S, A, T)
    log('  sfx: act I (plasma, fusion, collapse, supernova)')
    act2(S, A, T)
    act3(S, A, T)
    log('  sfx: act II/III (space wind, ignition, ocean, cells)')
    with S.layer('night'), A.layer('night'):
        act3_night(S, A, T)
    log('  sfx: night (crickets, wind, heartbeat)')
    act4(S, A, T)
    log('  sfx: act IV (fire, climax, pings, signal lost, shore, chime)')
