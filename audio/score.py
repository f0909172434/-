"""The score of 歸途 THE LONG WAY HOME (D minor -> D major).

Main Theme (Dm – B♭ – F – C), two 4-bar phrases:
  A:  F  G A | B♭. A | A  G F | G———         (stepwise, half cadence)
  B:  F  G A | F'(leap!) E D | C. A | G  E  -> D
Atom leitmotif: D6 – A6 – E7 (open fifths) on celesta + glass bell.
"""
from __future__ import annotations

import numpy as np

from dsp import SR, TWO_PI, n2m, mtof, ns, tvec, pan, fade, pts_env
from instruments import (strings_chord, strings_line, strings_spicc, brass_chord, brass_line,
                         braam, choir, choir_line, piano_note, atom_note, celesta, bell,
                         taiko, timpani, cymbal, pad, sub_drone, shepard, ensemble)

# ----------------------------------------------------------------------------
# harmony helpers
# ----------------------------------------------------------------------------
PC = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6,
      'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
CH = {'Dm': ['D', 'F', 'A'], 'Bb': ['Bb', 'D', 'F'], 'F': ['F', 'A', 'C'], 'C': ['C', 'E', 'G'],
      'Gm': ['G', 'Bb', 'D'], 'A': ['A', 'C#', 'E'], 'D': ['D', 'F#', 'A'], 'G': ['G', 'B', 'D'],
      'Bm': ['B', 'D', 'F#'], 'Am': ['A', 'C', 'E'], 'Eb': ['Eb', 'G', 'Bb']}


def pcs(ch):
    return [PC[x] for x in CH[ch]]


def tones(ch, lo, hi):
    lo, hi = int(n2m(lo)), int(n2m(hi))
    return [m for m in range(lo, hi + 1) if m % 12 in pcs(ch)]


def root(ch, octv):
    return 12 * (octv + 1) + pcs(ch)[0]


# theme data: (beat, beats, pitch)
THEME_A = [(0, 2, 'F4'), (2, 1, 'G4'), (3, 1, 'A4'), (4, 3, 'Bb4'), (7, 1, 'A4'),
           (8, 2, 'A4'), (10, 1, 'G4'), (11, 1, 'F4'), (12, 4, 'G4')]
THEME_B = [(0, 2, 'F4'), (2, 1, 'G4'), (3, 1, 'A4'), (4, 2, 'F5'), (6, 1, 'E5'), (7, 1, 'D5'),
           (8, 3, 'C5'), (11, 1, 'A4'), (12, 2, 'G4'), (14, 2, 'E4')]
THEME_A_MAJ = [(0, 2, 'F#4'), (2, 1, 'G4'), (3, 1, 'A4'), (4, 3, 'B4'), (7, 1, 'A4'),
               (8, 2, 'A4'), (10, 1, 'G4'), (11, 1, 'F#4'), (12, 2, 'G4'), (14, 2, 'E4')]
THEME_B_MAJ = [(0, 2, 'F#4'), (2, 1, 'G4'), (3, 1, 'A4'), (4, 2, 'F#5'), (6, 1, 'E5'), (7, 1, 'D5'),
               (8, 3, 'D5'), (11, 1, 'B4'), (12, 2, 'A4'), (14, 1, 'G4'), (15, 1, 'E4')]


def theme(th, beat, octv=0, vel=0.85, accent_leap=0.0, legato=1.0, beat_times=None):
    """-> [(t_rel, dur, midi, vel)].  beat_times: optional array mapping beat->time."""
    out = []
    for b, d, p in th:
        if beat_times is not None:
            t0 = float(np.interp(b, np.arange(len(beat_times)), beat_times))
            t1 = float(np.interp(b + d, np.arange(len(beat_times)), beat_times))
        else:
            t0, t1 = b * beat, (b + d) * beat
        m = n2m(p) + 12 * octv
        v = vel * (1 + accent_leap * (n2m(p) >= 74))
        out.append((t0, (t1 - t0) * legato, m, min(v, 1.0)))
    return out


def shift(notes, dt):
    return [(t + dt, d, m, v) for (t, d, m, v) in notes]


def pan_st(x, p):
    a = (p + 1) * np.pi / 4
    return x * np.array([[np.cos(a)], [np.sin(a)]]) * np.sqrt(2)


# ----------------------------------------------------------------------------
# reusable gestures
# ----------------------------------------------------------------------------
HALL = {'hall': 0.30, 'space': 0.15}
BIG = {'hall': 0.25, 'space': 0.45}
HUGE = {'hall': 0.2, 'space': 0.7}


def leitmotif(B, t, spacing=0.35, vel=0.8, db=0.0, send=None, layer='main', warm=False,
              notes=('D6', 'A6', 'E7')):
    send = send or {'hall': 0.2, 'space': 0.6}
    pans = [-0.25, 0.05, 0.3]
    for i, p in enumerate(notes):
        x = atom_note(p, vel * (1 - 0.06 * i), seed=11 + i, warm=warm)
        B.add(t + i * spacing, pan_st(x, pans[i % 3]), db, send, layer)


def timp_roll(B, t0, t1, pitch, v0, v1, rate=13.0, db=0.0, send=HALL, seed=0):
    r = np.random.default_rng(seed)
    t, i = t0, 0
    while t < t1:
        x = (t - t0) / max(t1 - t0, 1e-6)
        v = (v0 + (v1 - v0) * x ** 1.5) * r.uniform(0.85, 1.0)
        B.add(t, pan(timpani(pitch, v, variant=i), 0.15 * (-1) ** i) * 0.7071, db, send)
        t += r.uniform(0.9, 1.1) / rate
        i += 1


def cym_swell(B, t_end, dur=2.5, db=0.0, send=BIG, seed=0):
    c = cymbal(dur + 0.3, seed=seed)[::-1]
    c = fade(c, 0.4, 0.01)
    st = np.stack([c, np.concatenate([np.zeros(ns(0.011)), c[:-ns(0.011)]])])
    B.add(t_end - c.shape[0] / SR, st, db, send)


def grains(B, t0, t1, notes, density, db, seed=0, send=None, fin=2.0, fout=2.0):
    r = np.random.default_rng(seed)
    send = send or {'space': 0.9}
    count = int((t1 - t0) * density)
    for _ in range(count):
        t = r.uniform(t0, t1)
        d = r.uniform(0.05, 0.22)
        n = ns(d)
        tt = tvec(n)
        f = float(mtof(n2m(r.choice(notes)))) * (2 ** (r.normal(0, 0.03) / 12))
        g = np.sin(TWO_PI * f * tt + r.uniform(0, TWO_PI)) * np.hanning(n)
        g += 0.25 * np.sin(TWO_PI * 2 * f * tt) * np.hanning(n) ** 2
        env = min(1.0, (t - t0) / fin, (t1 - t) / fout) * r.uniform(0.3, 1.0)
        B.add(t, pan(g * 0.06 * env, r.uniform(-0.85, 0.85)), db, send)


def violin_harmonic(pitch, dur, seed=0):
    r = np.random.default_rng(seed)
    f = float(mtof(n2m(pitch)))
    n = ns(dur)
    t = tvec(n)
    vib = 1 + 0.0012 * np.sin(TWO_PI * 5.0 * t) * np.clip((t - 1.0) / 1.5, 0, 1)
    ph = np.cumsum(f * vib) / SR
    y = np.sin(TWO_PI * ph) + 0.06 * np.sin(TWO_PI * 2 * ph) + 0.025 * np.sin(TWO_PI * 3 * ph)
    from dsp import bp, colored_noise
    bow = bp(r.standard_normal(n), f * 0.8, f * 1.6) * 0.05
    env = np.minimum(t / 0.9, 1) ** 2 * np.clip((dur - t) / 2.5, 0, 1)
    env *= 1 + 0.06 * np.sin(TWO_PI * 0.3 * t)
    return pan((y + bow) * env * 0.08, -0.2)


def pulse_tick(pitch, vel, seed=0):
    """Soft synth pulse (filtered square) for the tree-of-life build."""
    from dsp import square, lp
    f = float(mtof(n2m(pitch)))
    n = ns(0.25)
    t = tvec(n)
    y = lp(square(f, n, 0.0, 0.3), 900 + 1500 * vel) * np.exp(-t / 0.06) * np.minimum(t / 0.002, 1)
    return pan(fade(y * 0.06 * vel, 0, 0.02), 0.0)


# ----------------------------------------------------------------------------
# the score, section by section
# ----------------------------------------------------------------------------
def render(M, T, log=print):
    """Render the whole score into bus M (layers: main / tree / night / free)."""
    _prologue(M, T)
    _act1(M, T)
    log('  music: prologue + act I forge')
    _fusion_collapse(M, T)
    log('  music: fusion + collapse')
    _supernova(M, T)
    log('  music: supernova + title')
    _drift(M, T)
    log('  music: act II drift / ignition / young earth')
    _ocean(M, T)
    with M.layer('tree'):
        _tree(M, T)
    log('  music: ocean + tree of life')
    with M.layer('night'):
        _night(M, T)
    log('  music: night / piano theme / lifetime')
    _return(M, T)
    log('  music: act IV return + climax')
    _home(M, T)
    log('  music: nursery / new world / home / credits')


def _prologue(M, T):
    t = T['presents_note']  # 13.4: single low piano note + airy shimmer
    M.add(t, piano_note('D1', 0.62, 3.4, seed=1), 6.0, {'hall': 0.25, 'space': 0.5})
    M.add(t + 0.004, piano_note('D2', 0.5, 3.4, seed=2), 2.0, {'hall': 0.25, 'space': 0.5})
    M.add(t + 0.1, pad(['A5', 'D6', 'E6'], 2.2, att=1.4, rel=1.8, cutoff=5000, sines=1.2,
                       air=0.6, seed=3), -26.0, HUGE)


def _act1(M, T):
    t0 = T['forge']  # 17
    tf = T['fusion']  # 33
    L = tf - t0
    M.add(t0, choir(['D2', 'D3'], L - 0.4, 'u', att=4.0, rel=0.6, seed=21,
                    dyn=[(0, 0.55), (9, 0.8), (L, 1.0)], morph=('a', [(0, 0), (8, 0), (L, 0.65)])),
          -9.0, BIG)
    M.add(t0 + 6, choir(['A2'], L - 6.4, 'u', att=4.0, rel=0.6, seed=22,
                        morph=('a', [(0, 0), (4, 0), (L - 6, 0.6)])), -14.0, BIG)
    M.add(t0, sub_drone('D1', L - 0.3, att=5.0, rel=0.4, seed=23), -4.0, None)
    M.add(t0 + 4, strings_chord(['D1', 'D2'], L - 4.3, 'cb', att=4.0, rel=0.4, seed=24,
                                dyn=[(0, 0.5), (L - 4, 1.0)], bright=0.4), -12.0, HALL)
    M.add(t0 + 8, strings_chord(['D2', 'A2'], L - 8.3, 'vc', att=4.0, rel=0.4, seed=25,
                                dyn=[(0, 0.5), (L - 8, 1.0)], bright=0.5), -13.0, HALL)
    # low brass swell into the white flash
    M.add(tf - 4.6, brass_chord(['D2', 'A2'], 4.4, 'tbn', att=4.2, rel=0.25, seed=26,
                                dyn=[(0, 0.3), (4.4, 1.0)]), -9.0, BIG)
    M.add(tf - 4.6, brass_chord(['D3', 'A3'], 4.4, 'hn', att=4.2, rel=0.25, seed=27,
                                dyn=[(0, 0.3), (4.4, 1.0)]), -11.0, BIG)
    timp_roll(M, tf - 2.6, tf - 0.05, 'D2', 0.15, 0.75, db=-6.0, seed=28)


def _fusion_collapse(M, T):
    t0 = T['fusion']  # 33, 96 BPM, bar = 2.5 s
    tcut = T['silence']  # 61.5
    bar = 2.5
    e8 = bar / 8
    chords = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A']
    acc = [1, .55, .7, .95, .55, .7, .9, .65]
    octs = [0, 0, 12, 0, 0, 12, 0, 12]
    k = 0
    for b, ch in enumerate(chords):
        tb = t0 + b * bar
        lvl = float(np.interp(b, [0, 3, 4, 6, 8, 11], [0.6, 0.66, 0.72, 0.82, 0.95, 1.0]))
        r2 = root(ch, 2)
        vt = tones(ch, 'D4', 'D5')[:3]
        hi = tones(ch, 'A4', 'A5')
        for i in range(8):
            t = tb + i * e8
            if t >= tcut - 0.02:
                break
            v = acc[i] * lvl
            k += 1
            M.add(t, strings_spicc(r2 + 12 + octs[i], v, dur=0.24, sec='vc', seed=k), -1.0, HALL)
            M.add(t, strings_spicc(r2 + octs[i], v, dur=0.27, sec='cb', seed=k + 500), -4.0, HALL)
            if b >= 2:
                M.add(t, strings_spicc(vt[[0, 1, 2, 1, 0, 1, 2, 1][i]], v * 0.8, dur=0.2, sec='vla',
                                       seed=k + 1000), -5.0, HALL)
            if b >= 7:
                for j in range(2):
                    tt = t + j * e8 / 2
                    if tt >= tcut - 0.02:
                        break
                    p = hi[(i * 2 + j) % len(hi)] + 12 * (b >= 10)
                    M.add(tt, strings_spicc(p, (0.55 + 0.35 * (j == 0)) * lvl, dur=0.12, sec='vln',
                                            seed=k * 3 + j), -6.0 + 1.5 * (b - 7), HALL)
        # soft core pulse (felt more than heard) then real taiko from bar 8
        if b < 8:
            M.add(tb, pan(taiko(0.3 + 0.04 * b, 'o', b), 0) * 0.7071, -10.0, HALL)
        else:
            pat = [(0, 1.0), (3, 0.6), (4, 0.85), (6, 0.7), (7, 0.55)] if b < 10 else \
                  [(0, 1.0), (2, .6), (3, .7), (4, .9), (5, .6), (6, .8), (7, .7)]
            for pos, v in pat:
                t = tb + pos * e8
                if t < tcut - 0.02:
                    M.add(t, pan(taiko(v, 'o', pos + b), 0.1 * ((pos % 2) * 2 - 1)) * 0.7071, -5.0, HALL)
            M.add(tb, brass_line([(0, 0.55, r2 + 12, 1.0)], 'tbn', rel=0.35, att=0.02, seed=60 + b),
                  -7.0, BIG)
            M.add(tb, brass_line([(0, 0.55, r2 + 7 + 12 if ch != 'A' else r2 + 19, 1.0)], 'hn',
                                 rel=0.35, att=0.02, seed=70 + b), -10.0, BIG)

    # sustained string pad after the atom is born (violins, high) -> tremolo cluster
    tl = T['lock1']  # 43.5
    M.add(tl + 0.3, strings_chord(['A5', 'D6'], 48.0 - tl - 0.3, 'vln', att=2.0, rel=0.8,
                                  dyn=[(0, 0.6), (4, 0.8)], seed=31), -13.0, BIG)
    M.add(48.0, strings_chord(['F5', 'A5', 'C6'], 5.0, 'vln', att=0.6, rel=0.5, seed=32), -12.0, BIG)
    M.add(53.0, strings_chord(['F5', 'A5', 'D6'], 2.5, 'vln', att=0.3, rel=0.3, seed=33, trem=0.6), -10.0, BIG)
    M.add(55.5, strings_chord(['F5', 'Bb5', 'D6'], 2.5, 'vln', att=0.2, rel=0.3, seed=34, trem=0.6), -9.0, BIG)
    M.add(58.0, strings_chord(['G5', 'Bb5', 'D6', 'G6'], 2.5, 'vln', att=0.2, rel=0.3, seed=35, trem=0.7),
          -8.0, BIG)
    M.add(60.5, strings_chord(['A5', 'C#6', 'E6', 'A6'], 1.1, 'vln', att=0.15, rel=0.05, seed=36, trem=0.7),
          -6.0, BIG)
    # choir crescendo through the collapse
    for tb, ch, nts in [(53.0, 'Dm', ['D3', 'A3', 'D4', 'F4']), (55.5, 'Bb', ['Bb2', 'F3', 'D4', 'F4']),
                        (58.0, 'Gm', ['G2', 'D3', 'Bb3', 'G4']), (60.5, 'A', ['A2', 'E3', 'C#4', 'A4'])]:
        d = min(2.5, tcut - tb)
        lv = float(np.interp(tb, [53, 60.5], [-12, -5]))
        M.add(tb, choir(nts, d - 0.05, 'a', att=0.4, rel=0.05, seed=int(tb * 10)), lv, BIG)
    # the atom is born: leitmotif on the 8th-note grid
    leitmotif(M, tl, spacing=e8, vel=0.9, db=0.0)
    # Shepard-tone riser 49 -> 61.5 (endless ascent), hard stop at the cut
    ts = T['collapse']
    sh = shepard(tcut - ts, [(0, 0.10), (6, 0.18), (tcut - ts, 0.42)], seed=41)
    n = sh.shape[1]
    env = pts_env(n, [(0, -40), (4, -22), (8, -12), (tcut - ts - 0.3, -2), (tcut - ts, 0)], db=True)
    M.add(ts, sh * env, -2.0, BIG)


def _supernova(M, T):
    t = T['supernova']  # 63
    M.add(t, braam(['D1', 'D2', 'A2', 'D3'], 9.0, seed=51, decay=3.2), -5.0, HUGE)
    M.add(t, braam(['D2', 'F3', 'A3'], 6.0, seed=52, decay=2.0, peak_fc=5000), -13.0, HUGE)
    tt = T['title']  # 65 full orchestra D minor, decays by 75
    L = 9.0
    dyn = [(0, 0.55), (1.5, 1.0), (3.5, 0.75), (7, 0.3), (L + 2.5, 0.0)]
    M.add(tt, strings_chord(['D5', 'F5', 'A5', 'D6'], L, 'vln', att=1.0, rel=2.5, dyn=dyn, seed=61, bright=0.8), -3.0, HUGE)
    M.add(tt, strings_chord(['A3', 'D4', 'F4', 'A4'], L, 'vla', att=1.0, rel=2.5, dyn=dyn, seed=62), -5.0, HUGE)
    M.add(tt, strings_chord(['D2', 'A2', 'D3'], L, 'vc', att=1.0, rel=2.5, dyn=dyn, seed=63), -4.0, HUGE)
    M.add(tt, strings_chord(['D1', 'D2'], L, 'cb', att=1.0, rel=2.5, dyn=dyn, seed=64), -6.0, HUGE)
    M.add(tt, brass_chord(['D3', 'F3', 'A3', 'D4'], L - 2, 'hn', att=0.9, rel=2.5, dyn=dyn, seed=65), -5.0, HUGE)
    M.add(tt, brass_chord(['D2', 'A2'], L - 3, 'tbn', att=0.9, rel=2.5, dyn=dyn, seed=66), -8.0, HUGE)
    M.add(tt, choir(['D3', 'A3', 'D4', 'F4', 'A4'], L, 'a', att=1.2, rel=3.0, dyn=dyn, seed=67), -3.0, HUGE)
    M.add(tt, pan(timpani('D2', 1.0), 0) * 0.7071, -2.0, BIG)
    timp_roll(M, tt + 0.15, tt + 2.2, 'D2', 0.6, 0.25, db=-9.0, seed=68)


def _drift(M, T):
    t0 = T['drift']  # 76
    # ethereal pads
    for (t, nts, d) in [(t0, ['D3', 'A3', 'E4', 'F4'], 6.8), (t0 + 6, ['Bb2', 'F3', 'A3', 'D4'], 6.8),
                        (t0 + 12, ['F2', 'C3', 'G3', 'A3'], 6.8), (t0 + 18, ['C3', 'G3', 'D4', 'E4'], 4.2)]:
        M.add(t, pad(nts, d, att=2.8, rel=3.0, cutoff=1300, seed=int(t), air=0.25), -12.0, HUGE)
    M.add(t0, sub_drone('D2', 20.0, att=4, rel=3, seed=81, harm=0.1), -16.0, None)
    grains(M, t0 + 0.5, T['ignition'] - 1.0, ['D6', 'F6', 'G6', 'A6', 'C7', 'D7', 'E6', 'A5'],
           density=7.0, db=-6.0, seed=82)
    # atom, softly: reticle tracking
    leitmotif(M, T['lock2'], spacing=0.4, vel=0.55, db=-4.0, send=HUGE)
    # sparse piano: theme fragment, high & far
    frag = [(84.0, 'F5', 0.42, 1.6), (85.6, 'G5', 0.36, 0.7), (86.3, 'A5', 0.40, 0.8),
            (87.1, 'Bb5', 0.46, 2.4), (89.5, 'A5', 0.36, 1.8),
            (91.4, 'A5', 0.36, 1.0), (92.4, 'G5', 0.32, 0.6), (93.0, 'F5', 0.32, 1.0), (94.2, 'G5', 0.38, 3.0)]
    for t, p, v, d in frag:
        M.add(t, piano_note(p, v, d, seed=int(t)), 8.0, {'hall': 0.3, 'space': 0.75})
        M.add(t, piano_note(n2m(p) - 24, v * 0.6, d, seed=int(t) + 1), 6.0, {'hall': 0.3, 'space': 0.7})
    # build to the ignition
    ti = T['ignition']  # 101
    M.add(ti - 4.5, strings_chord(['C4', 'E4', 'G4', 'C5'], 4.4, 'vla', att=4.0, rel=0.3,
                                  dyn=[(0, 0.2), (4.4, 1.0)], seed=91), -11.0, BIG)
    M.add(ti - 4.0, choir(['C3', 'G3', 'E4', 'G4'], 3.9, 'u', att=3.5, rel=0.4, seed=92,
                          morph=('a', [(0, 0), (3.9, 0.8)])), -12.0, BIG)
    # IGNITION: first major colour (F major), bright voicing
    dyn = [(0, 0.7), (0.5, 1.0), (4.5, 0.75)]
    M.add(ti, strings_chord(['A4', 'C5', 'F5', 'A5'], 4.8, 'vln', att=0.35, rel=1.2, dyn=dyn, seed=93, bright=0.9), -5.0, BIG)
    M.add(ti, strings_chord(['F3', 'C4', 'F4'], 4.8, 'vla', att=0.35, rel=1.2, dyn=dyn, seed=94), -7.0, BIG)
    M.add(ti, strings_chord(['F2', 'C3'], 4.8, 'vc', att=0.35, rel=1.2, dyn=dyn, seed=95), -6.0, BIG)
    M.add(ti, strings_chord(['F1'], 4.8, 'cb', att=0.35, rel=1.2, dyn=dyn, seed=96), -8.0, BIG)
    M.add(ti, choir(['F3', 'C4', 'A4', 'C5'], 4.8, 'a', att=0.5, rel=1.5, dyn=dyn, seed=97), -7.0, BIG)
    M.add(ti, brass_chord(['F3', 'A3', 'C4'], 4.0, 'hn', att=0.4, rel=1.5, seed=98), -10.0, BIG)
    for i, p in enumerate(['F6', 'A6', 'C7', 'F7']):
        M.add(ti + 0.12 + 0.11 * i, pan_st(celesta(p, 0.5, seed=i), -0.3 + 0.2 * i), -6.0, HUGE)
    M.add(ti + 5.0, strings_chord(['C4', 'E4', 'G4', 'C5'], 2.0, 'vla', att=0.6, rel=1.0, seed=99), -9.0, BIG)
    M.add(ti + 5.0, strings_chord(['C3', 'G3'], 2.0, 'vc', att=0.6, rel=1.0, seed=100), -9.0, BIG)
    M.add(ti + 7.0, strings_chord(['Bb3', 'D4', 'F4', 'Bb4'], 2.2, 'vla', att=0.6, rel=1.2, seed=101), -10.0, BIG)
    M.add(ti + 7.0, strings_chord(['Bb1', 'Bb2'], 2.2, 'vc', att=0.6, rel=1.2, seed=102), -10.0, BIG)
    _young_earth(M, T)


def _young_earth(M, T):
    t0 = T['earth']  # 110
    peak = T['sunrise']  # 117
    bl = (peak - t0) / 3.0
    bars = [(t0, 'Dm', bl), (t0 + bl, 'Bb', bl), (t0 + 2 * bl, 'C', bl), (peak, 'F', 3.0), (peak + 3.0, 'C', 2.2)]
    for i, (t, ch, d) in enumerate(bars):
        lvl = [-12, -10, -8, -3, -9][i]
        att = 0.7 if i < 3 else 0.4
        M.add(t, strings_chord(tones(ch, 'A4', 'A5'), d, 'vln', att=att, rel=1.4, seed=110 + i,
                               bright=0.7), lvl, BIG)
        M.add(t, strings_chord(tones(ch, 'D3', 'D4'), d, 'vla', att=att, rel=1.4, seed=120 + i), lvl - 1, BIG)
        M.add(t, strings_chord([root(ch, 2), root(ch, 3)], d, 'vc', att=att, rel=1.4, seed=130 + i), lvl, BIG)
        M.add(t, strings_chord([root(ch, 1)], d, 'cb', att=att, rel=1.4, seed=140 + i), lvl - 2, BIG)
    beat = bl / 4
    horn = [(0, 2 * beat, 'F3', 0.8), (2 * beat, beat, 'G3', 0.8), (3 * beat, beat, 'A3', 0.85),
            (4 * beat, 3 * beat, 'Bb3', 0.9), (7 * beat, beat, 'A3', 0.8),
            (8 * beat, 2 * beat, 'G3', 0.85), (10 * beat, beat, 'A3', 0.9), (11 * beat, beat, 'Bb3', 0.95),
            (peak - t0, 3.0, 'C4', 1.0), (peak - t0 + 3.0, 1.8, 'A3', 0.75)]
    M.add(t0, brass_line(horn, 'hn', rel=1.5, att=0.12, seed=150), -6.0, BIG)
    M.add(peak, strings_line([(0, 1.0, 'A5', 0.9), (1.0, 2.0, 'C6', 1.0), (3.0, 2.0, 'A5', 0.8)], 'vln',
                             rel=1.6, seed=151, bright=0.9), -6.0, BIG)
    timp_roll(M, t0 + 2 * bl, peak - 0.05, 'C2', 0.15, 0.7, db=-7.0, seed=152)
    M.add(peak, pan(timpani('F2', 0.95), 0) * 0.7071, -3.0, BIG)
    cym_swell(M, peak, dur=2.3, db=-10.0, seed=153)
    M.add(peak, pan(cymbal(5.0, seed=154), 0.3) * 0.7071, -16.0, BIG)


def _ocean(M, T):
    t0 = T['ocean']  # 122
    for (t, nts, d) in [(t0, ['D3', 'A3', 'E4', 'F4'], 5.5), (t0 + 5.5, ['Bb2', 'F3', 'A3', 'D4'], 5.5),
                        (t0 + 11, ['D3', 'A3', 'E4', 'F4', 'A4'], 3.6), (t0 + 14.5, ['C3', 'G3', 'E4'], 1.6)]:
        M.add(t, strings_chord(nts, d, 'vla', att=2.0, rel=1.6, seed=int(t * 3), bright=0.3), -15.0, BIG)
        M.add(t, pad(nts, d, att=2.0, rel=2.0, cutoff=1100, seed=int(t * 5)), -17.0, HUGE)
    # the atom in the first cell: leitmotif above the water (free layer: not muffled)
    leitmotif(M, T['lock3'], spacing=0.35, vel=0.6, db=-5.0, send=HUGE, layer='free')


def _tree(M, T):
    t0 = T['tree']  # 138
    tc = T['night_cut']  # 151.6
    # accelerando 96 -> 146 BPM
    dur = tc - t0
    ts = np.linspace(0, dur, 4000)
    bpm = 96 * (146 / 96) ** (ts / dur)
    beats = np.concatenate([[0], np.cumsum(bpm[1:] / 60 * np.diff(ts))])
    nb = int(beats[-1] * 4)
    chords = ['Dm', 'Bb', 'F', 'C']
    k = 0
    for s in range(nb):  # sixteenths
        b16 = s / 4.0
        t = t0 + float(np.interp(b16, beats, ts))
        if t >= tc - 0.03:
            break
        bar = int(b16 // 4)
        ch = chords[bar % 4]
        prog = (t - t0) / dur
        tn = tones(ch, 'D4', 'D6')
        arp = [0, 1, 2, 3, 4, 3, 2, 1]
        k += 1
        # violas: rising arpeggio from the start
        M.add(t, strings_spicc(tn[arp[s % 8] % len(tn)], 0.45 + 0.4 * prog, dur=0.13, sec='vla', seed=k),
              -8.0 + 3 * prog, HALL)
        # violins an octave up from bar 2
        if bar >= 2:
            M.add(t, strings_spicc(tn[arp[(s + 2) % 8] % len(tn)] + 12, 0.4 + 0.45 * prog, dur=0.11,
                                   sec='vln', seed=k + 7000), -10.0 + 4 * prog, HALL)
        if s % 2 == 0:  # eighths: cello roots + pulse
            r2 = root(ch, 2)
            if bar >= 1:
                M.add(t, strings_spicc(r2 + (12 if (s // 2) % 2 else 0), 0.55 + 0.4 * prog, dur=0.2,
                                       sec='vc', seed=k + 9000), -4.0 + 2 * prog, HALL)
            M.add(t, pulse_tick(r2 + 24, 0.5 + 0.5 * prog, seed=k), -6.0 + 3 * prog, HALL)
        if s % 4 == 0 and bar >= 3:  # timpani on beats
            M.add(t, pan(timpani('D2' if ch in ('Dm', 'Bb') else 'A1', 0.45 + 0.4 * prog, variant=s), 0) * 0.7071,
                  -6.0, HALL)
    # swells
    M.add(t0 + 6.5, strings_chord(['D5', 'F5', 'A5', 'D6'], dur - 6.5, 'vln', att=dur - 7, rel=0.05,
                                  dyn=[(0, 0.4), (dur - 6.5, 1.0)], seed=171, bright=0.9), -9.0, BIG)
    M.add(t0 + 8.0, choir(['D3', 'A3', 'D4', 'F4', 'A4'], dur - 8.0, 'a', att=dur - 8.5, rel=0.05, seed=172,
                          dyn=[(0, 0.3), (dur - 8, 1.0)]), -8.0, BIG)
    M.add(t0 + 9.0, brass_chord(['D3', 'A3', 'D4', 'F4'], dur - 9.0, 'hn', att=dur - 9.5, rel=0.05, seed=173,
                                dyn=[(0, 0.3), (dur - 9, 1.0)]), -8.0, BIG)
    M.add(t0 + 9.0, brass_chord(['D2', 'A2'], dur - 9.0, 'tbn', att=dur - 9.5, rel=0.05, seed=174,
                                dyn=[(0, 0.3), (dur - 9, 1.0)]), -9.0, BIG)
    timp_roll(M, tc - 2.2, tc - 0.04, 'D2', 0.3, 0.95, rate=16, db=-5.0, seed=175)
    cym_swell(M, tc, dur=2.4, db=-9.0, seed=176)


def _night(M, T):
    t1 = T['piano_theme']  # 154
    tl = T['lock4']  # 167
    bar = (tl - t1) / 4.0  # 3.25 s
    beat = bar / 4
    chords = ['Dm', 'Bb', 'F', 'C']
    # phrase A (melody one octave up, intimate)
    A = shift(theme(THEME_A, beat, octv=1, vel=0.5), t1)
    B = shift(theme(THEME_B, beat, octv=1, vel=0.52, accent_leap=0.12), tl)
    mel = A + B + [(tl + 4 * bar, 2 * bar, n2m('D5'), 0.46)]
    for i, (t, d, m, v) in enumerate(mel):
        rub = 0.012 * np.sin(i * 1.7)
        M.add(t + rub, piano_note(m, v, d * 0.98, seed=i), 9.0, {'hall': 0.35, 'space': 0.35})
    # left hand
    lh_chords = chords + chords + ['Dm', 'Bb']
    for b, ch in enumerate(lh_chords):
        tb = t1 + b * bar
        r2 = root(ch, 2)
        fifth = r2 + 7
        third = tones(ch, n2m('A3'), n2m('A4'))[0]
        if b < 4:  # phrase A: half notes, root + fifth
            for h in range(2):
                M.add(tb + h * 2 * beat, piano_note(r2, 0.3 - 0.04 * h, 2 * beat, seed=b * 2 + h), 9.0,
                      {'hall': 0.35, 'space': 0.3})
                M.add(tb + h * 2 * beat + 0.02, piano_note(fifth + 12 * (h == 1), 0.24, 2 * beat, seed=b * 2 + h + 50),
                      9.0, {'hall': 0.35, 'space': 0.3})
        else:  # phrase B: flowing 8ths
            pat = [r2, fifth, r2 + 12, third, fifth + 12, third, r2 + 12, fifth]
            for i, p in enumerate(pat):
                if b >= 8 and i >= 4 and b == 9:
                    break
                v = [0.32, 0.22, 0.24, 0.22, 0.26, 0.22, 0.24, 0.2][i] * (0.85 if b >= 8 else 1.0)
                M.add(tb + i * beat / 2, piano_note(p, v, beat * (2.0 - i / 8 * 2.0) + 0.2, seed=b * 9 + i), 9.0,
                      {'hall': 0.35, 'space': 0.3})
    # the leitmotif woven into the piano (same three notes) as the reticle finds the child's hand
    for i, p in enumerate(['D6', 'A6', 'E7']):
        M.add(tl + 0.2 + i * 0.45, piano_note(p, 0.36 - 0.03 * i, 2.5, seed=40 + i), 9.0, {'hall': 0.3, 'space': 0.6})
    leitmotif(M, tl + 0.2, spacing=0.45, vel=0.3, db=-14.0, send=HUGE)
    # final fading chord of the lifetime (Bb add9), then the heartbeat stops
    tb = t1 + 9 * bar
    M.add(tb + 0.3, piano_note('C6', 0.22, 2.0, seed=91), 9.0, {'hall': 0.35, 'space': 0.5})
    M.add(tb + 0.9, piano_note('D5', 0.2, 1.6, seed=92), 9.0, {'hall': 0.35, 'space': 0.5})
    # strings swell beneath the lifetime (177 -> 186)
    th = T['heart']  # 177
    ts = T['heart_stop']  # 186
    for t, nts, d in [(176.75, ['C3', 'G3', 'E4'], 3.25), (180.0, ['D3', 'A3', 'F4', 'A4'], 3.25),
                      (183.25, ['Bb2', 'F3', 'D4', 'C5'], ts - 183.25 - 0.25)]:
        lv = float(np.interp(t, [176.75, 180, 183.25], [-17, -12, -14]))
        M.add(t, strings_chord(nts, d, 'vla', att=1.6, rel=0.4 if t > 183 else 1.4, seed=int(t),
                               dyn=None if t < 183 else [(0, 1.0), (d, 0.25)]), lv, BIG)
        M.add(t, strings_chord([nts[0], nts[1]], d, 'vc', att=1.6, rel=0.4 if t > 183 else 1.4, seed=int(t) + 1,
                               dyn=None if t < 183 else [(0, 1.0), (d, 0.25)]), lv - 2, BIG)
    # one bar of silence, then a single high violin harmonic
    th2 = T['harmonic']  # 187
    M.add(th2, violin_harmonic('A6', 6.0, seed=5), 0.0, {'hall': 0.3, 'space': 0.6}, layer='free')
    # choir 'ooh' rising as the particles lift to the stars
    M.add(th2 + 0.4, choir(['D4', 'F4', 'A4'], 3.6, 'u', att=3.0, rel=1.4, seed=193,
                           dyn=[(0, 0.4), (3.6, 1.0)]), -13.0, HUGE, layer='free')
    M.add(th2 + 1.8, choir(['D5'], 2.2, 'u', att=2.0, rel=1.4, seed=194, dyn=[(0, 0.4), (2.2, 1.0)]), -18.0, HUGE,
          layer='free')


def _return(M, T):
    t0 = T['act4']  # 191
    tc = T['climax']  # 207
    bar = (tc - t0) / 4.0  # 4 s
    beat = bar / 4
    s8 = beat / 2  # 0.5
    chords = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'F', 'C']
    acc = [1, .55, .7, .95, .55, .7, .9, .65]
    octs = [0, 0, 12, 0, 0, 12, 0, 12]
    k = 0
    for b, ch in enumerate(chords):
        tb = t0 + b * bar
        prog = b / 7
        r2 = root(ch, 2)
        lvl = [0.55, 0.62, 0.72, 0.85, 1.0, 1.0, 1.0, 0.9][b]
        # 8ths at 0.25 s (120bpm feel) celli/basses ostinato
        for i in range(16):
            t = tb + i * 0.25
            v = acc[i % 8] * lvl
            k += 1
            M.add(t, strings_spicc(r2 + 12 + octs[i % 8], v, dur=0.2, sec='vc', seed=k + 20000), -1.0, HALL)
            M.add(t, strings_spicc(r2 + octs[i % 8], v, dur=0.22, sec='cb', seed=k + 21000), -4.0, HALL)
            if b >= 2:
                vt = tones(ch, 'D4', 'D5')[:3]
                M.add(t, strings_spicc(vt[[0, 1, 2, 1][i % 4]], v * 0.8, dur=0.16, sec='vla', seed=k + 22000),
                      -6.0, HALL)
        # taiko
        if b < 2:
            pat = [(0, 0.75), (6, 0.55), (8, 0.7), (14, 0.5)]
        elif b < 4:
            pat = [(0, 0.95), (3, 0.5), (6, 0.7), (8, 0.9), (10, 0.5), (11, 0.6), (12, 0.75), (14, 0.65)]
        elif b < 7:
            pat = [(0, 1.0), (3, 0.6), (4, .5), (6, 0.8), (8, 1.0), (10, .6), (11, .7), (12, .85), (13, .5),
                   (14, .8), (15, .6)]
        else:
            pat = [(0, 0.95), (6, 0.6), (8, 0.7)]
        for pos, v in pat:
            M.add(tb + pos * 0.25, pan(taiko(v, 'o', pos + b), 0.1 * ((pos % 3) - 1)) * 0.7071,
                  -7.0 if b >= 4 else -6.0, HALL)
            if b >= 2 and pos % 4 != 0:
                M.add(tb + pos * 0.25, pan(taiko(v * 0.7, 'm', pos), 0.35) * 0.7071, -9.0, HALL)
        # sustained string chords
        if b < 4:
            M.add(tb, strings_chord(tones(ch, 'A3', 'A4'), bar, 'vla', att=0.8, rel=0.8, seed=230 + b),
                  -12.0 + 2.5 * b, BIG)
            if b >= 1:
                M.add(tb, strings_chord(tones(ch, 'A4', 'D6'), bar, 'vln', att=0.8, rel=0.8, seed=240 + b,
                                        bright=0.7, trem=0.5 if b == 3 else 0.0), -14.0 + 2.5 * b, BIG)
            if b >= 1:
                M.add(tb, choir(tones(ch, 'D3', 'D4'), bar, 'u' if b < 2 else 'a', att=1.0, rel=0.8,
                                seed=250 + b), -13.0 + 2 * b, BIG)
            if b >= 2:
                M.add(tb, brass_chord([r2, r2 + 7], bar, 'tbn', att=0.6, rel=0.6, seed=260 + b,
                                      dyn=[(0, 0.6), (bar, 0.9 if b == 2 else 1.0)]), -10.0 + 2 * (b - 2), BIG)
        else:
            dl = -2.5 if b < 7 else -6.5
            M.add(tb, strings_chord(tones(ch, 'A3', 'A4'), bar, 'vla', att=0.3, rel=1.2, seed=330 + b), -4.0 + dl, BIG)
            M.add(tb, strings_chord(tones(ch, 'D4', 'A5')[-4:], bar, 'vln', att=0.3, rel=1.2, seed=340 + b,
                                    bright=0.8), -6.0 + dl, BIG)
            M.add(tb, strings_chord([r2 - 12, r2], bar, 'cb', att=0.3, rel=1.2, seed=345 + b), -5.0 + dl, BIG)
            M.add(tb, choir(tones(ch, 'D3', 'A4'), bar, 'a', att=0.5, rel=1.6, seed=350 + b), -3.0 + dl, HUGE)
            M.add(tb, brass_chord(tones(ch, 'D3', 'D4'), bar, 'hn', att=0.3, rel=1.2, seed=360 + b), -6.0 + dl, BIG)
            M.add(tb, brass_chord([r2, r2 + 7, r2 + 12], bar, 'tbn', att=0.2, rel=1.2, seed=370 + b), -5.0 + dl, BIG)
            M.add(tb, brass_chord([r2 - 12], bar, 'tuba', att=0.2, rel=1.2, seed=375 + b), -7.0 + dl, BIG)
            tp = {'Dm': 'D2', 'Bb': 'A1', 'F': 'F2', 'C': 'C2'}[ch]
            M.add(tb, pan(timpani(tp, 1.0 if b < 7 else 0.7), 0) * 0.7071, -5.0, BIG)
    # melody: phrase A in celli + horns (191-207), phrase B soaring at the climax (207-223)
    A = theme(THEME_A, beat, octv=-1, vel=0.85)
    M.add(t0, strings_line(A, 'vc', rel=1.0, seed=300, bright=0.8,
                           dyn=[(0, 0.75), (16, 1.0)]), -1.0, BIG)
    M.add(t0 + 2 * bar, strings_line(shift(theme(THEME_A[5:], beat, octv=0, vel=0.85), -2 * bar), 'vln', rel=1.0,
                                     seed=303, bright=0.8), -5.0, BIG)
    M.add(t0, brass_line(A, 'hn', rel=1.0, seed=301, dyn=[(0, 0.6), (8, 0.8), (16, 1.0)]), -6.0, BIG)
    # build into the climax
    timp_roll(M, tc - 2.0, tc - 0.04, 'D2', 0.25, 0.95, rate=15, db=-4.0, seed=310)
    cym_swell(M, tc, dur=3.0, db=-6.0, seed=311)
    for i in range(8):  # small taiko fill
        M.add(tc - 1.0 + i * 0.125, pan(taiko(0.5 + 0.06 * i, 'm', i), 0.3 - 0.08 * i) * 0.7071, -6.0, HALL)
    M.add(tc - 4.0, brass_chord(['C3', 'G3', 'C4', 'E4'], 3.95, 'hn', att=3.6, rel=0.05, seed=312,
                                dyn=[(0, 0.3), (3.95, 1.0)]), -6.0, BIG)
    # CLIMAX
    M.add(tc, braam(['D1', 'D2', 'A2'], 6.0, seed=320, decay=2.5, peak_fc=3000, drive=2.5), -11.0, HUGE)
    M.add(tc, pan(cymbal(6.0, seed=321), -0.3) * 0.7071, -8.0, BIG)
    Bm = theme(THEME_B, beat, octv=1, vel=0.95, accent_leap=0.05) + [(16 * beat, 3.0, n2m('D5'), 0.75)]
    dynB = [(0, 0.85), (4, 1.0), (12, 1.0), (16, 0.75), (19, 0.4)]
    M.add(tc, strings_line(Bm, 'vln', rel=2.0, seed=322, bright=1.0, dyn=dynB, octaves=(0, -1)), -1.0, HUGE)
    M.add(tc, choir_line(Bm, 'a', rel=2.0, seed=323, dyn=dynB), -3.0, HUGE)
    M.add(tc, brass_line(theme(THEME_B, beat, octv=0, vel=0.95), 'hn', rel=1.5, seed=324, dyn=dynB), -2.0, BIG)
    M.add(tc + bar, brass_line(shift(theme(THEME_B[3:], beat, octv=0, vel=0.9), -bar), 'tpt', rel=1.5, seed=325,
                               dyn=[(0, 0.8), (3, 1.0), (10, 0.7)]), -11.0, BIG)
    # the atom, tracked through the fire: bells over the full orchestra
    leitmotif(M, T['lock5'], spacing=0.35, vel=1.0, db=1.0, send=HUGE)


def _home(M, T):
    # nursery: strings + choir pad
    tn = T['nursery']  # 222
    tl = T['lost']  # 228
    M.add(tn, strings_chord(['A4', 'D5', 'E5'], tl - tn, 'vln', att=1.8, rel=0.3, seed=401, bright=0.4), -12.0, HUGE)
    M.add(tn, strings_chord(['D3', 'A3', 'F4'], tl - tn, 'vla', att=1.8, rel=0.3, seed=402), -13.0, HUGE)
    M.add(tn + 0.5, choir(['D4', 'A4'], tl - tn - 0.5, 'u', att=2.0, rel=0.3, seed=403), -12.0, HUGE)
    M.add(tn, pad(['D3', 'A3', 'E4'], tl - tn, att=2.5, rel=0.3, cutoff=1500, seed=404), -16.0, HUGE)
    # SIGNAL LOST: music drops to a single high sustained note (free layer: survives the cut)
    tw = T['newworld']  # 234
    tr = T['reacquire']  # 242
    M.add(tl, strings_chord(['A5'], tw - tl + 1.5, 'vln', att=0.25, rel=2.0, seed=410, bright=0.3,
                            vib_scale=0.3, dyn=[(0, 1.0), (2, 0.8), (6, 0.6), (8, 0.3)]),
          -15.0, HUGE, layer='free')
    # the new world: high pad, waiting (open fifths, no third)
    M.add(tw, pad(['A4', 'E5', 'A5'], tr - tw, att=3.0, rel=1.0, cutoff=3500, seed=420, air=0.4,
                  dyn=[(0, 0.6), (tr - tw, 1.0)]), -15.0, HUGE)
    M.add(tw + 1.0, strings_chord(['E6'], tr - tw - 1.0, 'vln', att=3.0, rel=0.8, seed=421, vib_scale=0.4,
                                  bright=0.2), -21.0, HUGE)
    M.add(tw + 4.0, strings_chord(['D2', 'A2'], tr - tw - 4.0, 'vc', att=3.0, rel=0.6, seed=422,
                                  dyn=[(0, 0.5), (tr - tw - 4, 1.0)]), -17.0, BIG)
    # REACQUIRE: the leitmotif in full, resolving to D MAJOR
    leitmotif(M, tr, spacing=0.35, vel=0.95, db=-1.0, send=HUGE, warm=True)
    for i, p in enumerate(['F#6', 'D7']):
        M.add(tr + 1.2 + 0.25 * i, pan_st(atom_note(p, 0.6, seed=30 + i), 0.2 - 0.3 * i), -6.0, HUGE)
    tb = tr + 1.0  # bloom
    bloom = [(0, 0.35), (1.5, 1.0), (2.5, 0.85)]
    M.add(tb, strings_chord(['F#5', 'A5', 'D6'], 2.6, 'vln', att=1.2, rel=1.2, dyn=bloom, seed=430, bright=0.7), -6.0, HUGE)
    M.add(tb, strings_chord(['D4', 'F#4', 'A4'], 2.6, 'vla', att=1.2, rel=1.2, dyn=bloom, seed=431), -7.0, HUGE)
    M.add(tb, strings_chord(['D3', 'A3'], 2.6, 'vc', att=1.2, rel=1.2, dyn=bloom, seed=432), -7.0, HUGE)
    M.add(tb, strings_chord(['D2'], 2.6, 'cb', att=1.2, rel=1.2, dyn=bloom, seed=433), -9.0, HUGE)
    M.add(tr + 0.5, choir(['D4', 'F#4', 'A4', 'D5'], 3.0, 'a', att=1.8, rel=1.2, dyn=bloom, seed=434), -6.0, HUGE)
    M.add(tb, brass_chord(['D3', 'F#3', 'A3'], 2.6, 'hn', att=1.2, rel=1.2, dyn=bloom, seed=435), -12.0, BIG)
    # theme phrase B in D major (strings + choir), the leap lands on the chime
    t5 = tr + 2.5  # 244.5
    beat = 0.625
    Bmaj = theme(THEME_B_MAJ, beat, octv=1, vel=0.85, accent_leap=0.08) + [(16 * beat, 3.2, n2m('D5'), 0.6)]
    dyn = [(0, 0.8), (3, 1.0), (8, 0.9), (10, 0.75), (13, 0.3)]
    M.add(t5, strings_line(Bmaj, 'vln', rel=2.0, seed=440, bright=0.8, dyn=dyn), -5.0, HUGE)
    M.add(t5, choir_line(Bmaj, 'o', rel=2.0, seed=441, dyn=dyn, octaves=(-1,)), -10.0, HUGE)
    hm = [('D', 2.5), ('G', 2.5), ('Bm', 2.5), ('A', 2.5), ('D', 4.0)]
    t = t5
    for i, (ch, d) in enumerate(hm):
        lv = [-8, -8, -9, -10, -13][i]
        M.add(t, strings_chord(tones(ch, 'D4', 'D5'), d, 'vla', att=0.6, rel=1.5, seed=450 + i), lv, HUGE)
        M.add(t, strings_chord([root(ch, 2), root(ch, 3)], d, 'vc', att=0.6, rel=1.5, seed=460 + i), lv, HUGE)
        M.add(t, strings_chord([root(ch, 1) if ch != 'D' else root(ch, 2)], d, 'cb', att=0.6, rel=1.5,
                               seed=470 + i), lv - 2, HUGE)
        M.add(t, choir(tones(ch, 'D3', 'A3'), d, 'a', att=0.8, rel=1.5, seed=480 + i), lv - 4, HUGE)
        t += d
    # final cards: solo piano, final phrase of the main theme in D major
    tp = t5 + 10.0  # 254.5
    te = T['endtitle']  # 262
    bt = np.array([0, .5, 1, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.45, 4.9, 5.35, 5.8, 6.25, 6.7, 7.1, te - tp])
    A = shift(theme(THEME_A_MAJ, 0, octv=1, vel=0.48, beat_times=bt), tp)
    for i, (t, d, m, v) in enumerate(A):
        M.add(t, piano_note(m, v, d, seed=i + 3), 9.0, {'hall': 0.35, 'space': 0.45})
    for (bb, nts, v) in [(0, ['D2', 'A2', 'F#3'], 0.3), (4, ['G2', 'D3', 'B3'], 0.28), (8, ['A2', 'D3', 'F#3'], 0.27),
                         (12, ['A1', 'E2', 'G3', 'C#4'], 0.27)]:
        t = tp + float(np.interp(bb, np.arange(len(bt)), bt))
        for j, p in enumerate(nts):
            M.add(t + 0.05 * j, piano_note(p, v - 0.03 * j, 1.9, seed=j + bb), 9.0, {'hall': 0.35, 'space': 0.4})
    # end title: last D major chord, long tail
    for j, (p, v) in enumerate([('D1', 0.4), ('D2', 0.36), ('A2', 0.3), ('F#3', 0.3), ('D4', 0.3), ('D5', 0.42),
                                ('F#5', 0.3), ('A5', 0.3)]):
        M.add(te + 0.04 * j, piano_note(p, v, 6.0, seed=j + 70), 9.0, {'hall': 0.35, 'space': 0.6})
    endd = [(0, 0.3), (2.0, 1.0), (5.0, 0.7), (9.0, 0.0)]
    M.add(te, strings_chord(['D5', 'F#5', 'A5'], 7.0, 'vln', att=2.0, rel=2.5, dyn=endd, seed=490, bright=0.4), -12.0, HUGE)
    M.add(te, strings_chord(['D3', 'A3', 'F#4'], 7.0, 'vla', att=2.0, rel=2.5, dyn=endd, seed=491), -12.0, HUGE)
    M.add(te, strings_chord(['D2'], 7.0, 'cb', att=2.0, rel=2.5, dyn=endd, seed=492), -15.0, HUGE)
    M.add(te + 0.3, choir(['D4', 'F#4', 'A4'], 6.5, 'a', att=2.5, rel=3.0, dyn=endd, seed=493), -13.0, HUGE)
    # credits: ambient pad + leitmotif echo, fading to silence by 281
    tc = T['credits']  # 269
    end = T['end']
    M.add(tc - 1.0, pad(['D3', 'A3', 'E4', 'F#4'], end - tc - 2.5, att=3.5, rel=3.0, cutoff=1600, seed=500,
                        air=0.3, dyn=[(0, 1.0), (6, 0.8), (end - tc - 2, 0.25)]), -15.0, HUGE)
    leitmotif(M, tc + 2.0, spacing=0.5, vel=0.5, db=-8.0, send=HUGE, warm=True)
    leitmotif(M, tc + 6.5, spacing=0.6, vel=0.32, db=-14.0, send=HUGE, warm=True)
