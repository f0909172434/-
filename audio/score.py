"""The score of 卜 ORACLE.

Key: A minor, built on the yu-mode pentatonic A C D E G (no semitones: any canon of it is consonant),
turning to A major (A B C# E F#) in the memory river.

The question motif Q is the sent question itself, seven notes for seven characters, shaped by the tones
of the Mandarin (high, falling, low, low, rising, light, and the unresolved question mark):

        她   會   好   起   來   嗎   ？
        E5   D5   A4   G4   C5   A4   D5        rhythm (beats): 1 2 1 1 1.5 .5 3

It is heard as seven glass tokens in the mind (29.0 + 0.35 i, sfx.py), becomes a canon in the river of
questions (every entry another person asking it), grows old on a solo bow, is hummed by a human voice
under 婦好, becomes Leibniz's clockwork subject, rushes back, is played once, very softly, under 'someone
loves someone very much', and returns in A major in the memory river, where it finally resolves.
"""
from __future__ import annotations

import numpy as np

from dsp import SR, TWO_PI, n2m, mtof, ns, tvec, pan, fade, pts_env, lp
from instruments import (strings_chord, strings_line, strings_spicc, choir, choir_line, piano_note, shepard,
                         glass_ping, bowed_glass, harpsichord, xun_line, solo_bowed_line, voice_line,
                         stone_chime, bronze_bell, data_pluck, blip)

PC = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6,
      'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
YU = ['A', 'C', 'D', 'E', 'G']                       # A yu mode (minor pentatonic)

Q = ['E5', 'D5', 'A4', 'G4', 'C5', 'A4', 'D5']        # 她 會 好 起 來 嗎 ？
Q_MAJ = ['E5', 'C#5', 'A4', 'F#4', 'B4', 'A4', 'C#5']  # the same contour in A major pentatonic
Q_PEAK = ['E5', 'C#5', 'A4', 'F#4', 'A5', 'F#5', 'E5']  # 來 leaps up at the climax of the memory river
Q_RHY = [(0, 1), (1, 2), (3, 1), (4, 1), (5, 1.5), (6.5, 0.5), (7, 3)]   # (beat, beats)

ROOMY = {'room': 0.1, 'hall': 0.3, 'space': 0.2}
HALL = {'hall': 0.3, 'space': 0.15}
BIG = {'hall': 0.25, 'space': 0.4}
HUGE = {'hall': 0.2, 'space': 0.65}
DATA = {'hall': 0.15, 'space': 0.45}


def P(x, p=0.0):
    return pan(x, p) * 0.7071


def m_(p, octv=0):
    return n2m(p) + 12 * octv


def motif(pitches, t0, beat, vel=0.8, octv=0, rhythm=Q_RHY, legato=0.97, last=None):
    """-> [(t, dur, midi, vel)] absolute times."""
    out = []
    for i, ((b, d), p) in enumerate(zip(rhythm, pitches)):
        if last is not None and i == len(pitches) - 1:
            d = last
        out.append((t0 + b * beat, d * beat * legato, m_(p, octv), vel))
    return out


def timed(pitches, times, durs, vel=0.8, octv=0):
    return [(t, d, m_(p, octv), vel) for p, t, d in zip(pitches, times, durs)]


def rel(notes, t0):
    return [(t - t0, d, m, v) for (t, d, m, v) in notes]


def pshift(pitches, steps, scale=YU):
    """Modal transposition inside the pentatonic set."""
    pcs = [PC[s] for s in scale]
    out = []
    for p in pitches:
        mm = int(round(m_(p)))
        o, pc = divmod(mm, 12)
        j = pcs.index(pc) + steps
        o += j // len(pcs)
        out.append(o * 12 + pcs[j % len(pcs)])
    return out


def line(M, kind, notes, db, send, seed, **kw):
    """Add a legato line (absolute-time notes) played by a line instrument."""
    t0 = notes[0][0]
    fn = {'str': strings_line, 'choir': choir_line, 'xun': xun_line, 'bow': solo_bowed_line,
          'voice': voice_line}[kind]
    M.add(t0, fn(rel(notes, t0), seed=seed, **kw), db, send)


def pno(M, t, p, v, d, db=6.0, send=None, seed=0):
    v = round(min(max(v, 0.04), 1.0) * 50) / 50
    d = round(max(d, 0.1) * 20) / 20
    M.add(t, piano_note(p, v, d, seed=seed), db, send or ROOMY)


def voices(M, t0, bars, parts, sec, db, send, seed, att=0.5, rel_=1.5, bright=0.5, dyn=None, glide=0.06):
    """Sustained harmony as smooth legato voices. bars: [(t, dur)], parts: [[pitch per bar] per voice]."""
    for j, ps in enumerate(parts):
        notes = [(t - t0, d, m_(p), 0.9) for (t, d), p in zip(bars, ps)]
        M.add(t0, strings_line(notes, sec, rel=rel_, att=att, glide=glide, bright=bright, dyn=dyn,
                               seed=seed + j), db, send)


# ============================================================================
def render(M, T, log=print):
    """The whole score into bus M (layers: main / pre / rush / mem)."""
    _listening(M, T)
    _mind(M, T)
    log('  music: listening tone, mind (data pattern, attention glass, the warm region)')
    _river(M, T)
    _upstream(M, T)
    log('  music: river of questions (canon), upstream (solo bow, drone)')
    _bone(M, T)
    _lineage(M, T)
    log('  music: bone (xun, stone chime, hummed Q), lineage (yin/yang bells, bloom, Leibniz, tape, circuits)')
    with M.layer('rush'):
        _rush(M, T)
    _answer(M, T)
    with M.layer('mem'):
        _memory(M, T)
    _title(M, T)
    log('  music: rush, answer piano, memory river (A major), title chord')


# ----------------------------------------------------------------------------
def _listening_tone(M, t0, t1, peak_t, db):
    d = t1 - t0
    n = ns(d)
    t = tvec(n)
    f = float(mtof(n2m('E6')))
    y = np.sin(TWO_PI * f * t) + 0.06 * np.sin(TWO_PI * 2 * f * t + 0.3)
    env = pts_env(n, [(0, 0), (min(2.0, d * 0.4), 0.7), (peak_t - t0, 1.0), (d - 1.0, 0.7), (d, 0)])
    env *= 1 + 0.15 * np.sin(TWO_PI * 0.23 * t)
    M.add(t0, P(y * env * 0.01, 0.1), db, {'space': 0.5})


def _listening(M, T):
    # the AI's caret: silence, and a very faint high tone, as if something is listening
    _listening_tone(M, T['ai_caret'], T['mind'] + 1.4, T['todata'][0], -12.0)


def _mind(M, T):
    tm, pings, tw, tr = T['mind'], T['pings'], T['memory_region'], T['river']
    grid = pings[1] - pings[0]
    a0, a1 = T['attention']
    d0, d1 = T['dive']
    # low string drone underneath
    dur = tw + 0.4 - tm
    M.add(tm, strings_chord(['A1'], dur, 'cb', att=3.5, rel=1.4, seed=501, bright=0.2,
                            dyn=[(0, 0.6), (dur, 1.0)]), -13.0, HALL)
    M.add(tm + 1.0, strings_chord(['A2', 'E3'], dur - 1.0, 'vc', att=3.5, rel=1.4, seed=502, bright=0.25),
          -17.0, HALL)
    # the data pattern: tine plucks on the token grid, an additive process on Q
    masks = [{0, 3}, {0, 2, 3, 5}, {0, 1, 2, 3, 5, 6}, set(range(7))]
    s = 7
    while True:
        t = pings[0] + s * grid
        if t > tw + 0.3:
            break
        c = (s - 7) // 7
        k = s % 7
        fadeout = float(np.clip((tw + 0.5 - t) / 1.6, 0.25, 1.0))
        if k in masks[min(c, 3)]:
            M.add(t, P(data_pluck(Q[k], (0.42 + 0.08 * min(c, 3)) * fadeout, seed=s), -0.4 + 0.8 * k / 6),
                  -5.0, DATA)
        if s % 2 == 0:
            M.add(t, P(data_pluck('A3' if (s // 2) % 2 == 0 else 'E4', 0.35 * fadeout, seed=900 + s, t60=0.6),
                       0.1), -9.0, DATA)
        s += 1
    # attention: bowed glass, 她 reaches for 好 起 來 (glides), then 嗎 reaches for everything
    for k, (dt, p1) in enumerate([(0.0, 'A4'), (0.6, 'G4'), (1.2, 'C5')]):
        t = a0 + dt
        d = a1 + 0.4 - t
        M.add(t, P(bowed_glass([(0, 'E5'), (0.45, 'E5'), (1.35, p1)], d, att=0.45, rel=1.6, seed=510 + k,
                               dyn=[(0, 1.0), (d - 2.5, 1.0), (d, 0.55)]), -0.35 + 0.3 * k), -8.0, DATA)
    tq = a0 + 2.5
    M.add(tq, P(bowed_glass([(0, 'A4')], a1 + 0.5 - tq, att=0.4, rel=1.6, seed=520), 0.0), -9.0, DATA)
    for k, p in enumerate(['E5', 'D5', 'G4', 'C5', 'A5']):
        t = tq + 0.55 + 0.25 * k
        M.add(t, P(bowed_glass([(0, 'A4'), (0.15, 'A4'), (0.9, p)], a1 + 0.5 - t, att=0.5, rel=1.6,
                               seed=530 + k), -0.6 + 0.3 * k), -12.0, DATA)
    # the region of memory lights up: a warm chord (F major 9), swelling through the dive into the river
    d = tr + 0.6 - tw
    dyn = [(0, 0.35), (1.2, 0.8), (3.0, 0.7), (d0 - tw, 0.72), (d - 0.4, 1.0), (d, 0.9)]
    M.add(tw, strings_chord(['F1', 'F2'], d, 'cb', att=1.0, rel=1.2, seed=540, dyn=dyn), -10.0, BIG)
    M.add(tw, strings_chord(['F2', 'C3'], d, 'vc', att=1.0, rel=1.2, seed=541, dyn=dyn), -11.0, BIG)
    M.add(tw, strings_chord(['A3', 'E4', 'G4'], d, 'vla', att=1.2, rel=1.2, seed=542, dyn=dyn, bright=0.4),
          -12.0, BIG)
    M.add(tw + 0.3, strings_chord(['C5', 'E5'], d - 0.3, 'vln', att=1.5, rel=1.2, seed=543, dyn=dyn, bright=0.3),
          -15.0, BIG)
    M.add(tw + 0.2, choir(['F3', 'C4', 'A4'], d - 0.2, 'u', att=1.5, rel=1.2, seed=544, dyn=dyn), -14.0, HUGE)
    for j, (p, v) in enumerate([('F2', 0.34), ('C3', 0.3), ('A3', 0.28), ('E4', 0.26), ('G4', 0.26)]):
        pno(M, tw + 0.03 * j, p, v, 3.5, db=7.0, send=BIG, seed=j)


# ----------------------------------------------------------------------------
RIVER_CH = {'A': ('A1', ['A2', 'E3'], 'A', ['A2', 'E3', 'A3', 'C4', 'D4', 'E4']),
            'F': ('F1', ['F2', 'C3'], 'F', ['F2', 'C3', 'A3', 'C4', 'E4', 'G4']),
            'C': ('C2', ['C3', 'G3'], 'C', ['C3', 'G3', 'D4', 'E4', 'G4', 'A4']),
            'G': ('G1', ['G2', 'D3'], 'G', ['G2', 'D3', 'A3', 'D4', 'E4', 'G4']),
            'D': ('D2', ['D2', 'A2'], 'D', ['D3', 'A3', 'D4', 'E4', 'G4', 'A4'])}
VA_VOICES = {'A': ['E3', 'A3', 'C4'], 'F': ['E3', 'A3', 'C4'], 'C': ['E3', 'G3', 'D4'], 'G': ['E3', 'G3', 'D4'],
             'D': ['E3', 'A3', 'C4']}


def _river(M, T):
    t0 = T['river']                      # the pickup (她)
    beat = (T['eras'][0] - (t0 + 1.0)) / 24.0   # 6 bars of 4 beats from the first downbeat to 70 s
    b1 = t0 + beat
    prog = ['A', 'F', 'C', 'G', 'A', 'F']
    bars = [(b1 + 4 * beat * k, 4 * beat) for k in range(6)]
    lvl = [0.62, 0.7, 0.78, 0.86, 1.0, 0.85]
    dyn = [(0, 0.6), (8 * beat, 0.75), (16 * beat, 0.9), (17 * beat, 1.0), (22 * beat, 0.9), (24 * beat, 0.7),
           (25.5 * beat, 0.35)]
    # basses, cellos, violas: smooth legato harmony
    voices(M, b1, bars, [[RIVER_CH[c][0] for c in prog]], 'cb', -9.0, BIG, 600, dyn=dyn, att=0.8)
    voices(M, b1, bars, [[RIVER_CH[c][1][j] for c in prog] for j in range(2)], 'vc', -12.0, BIG, 610, dyn=dyn)
    voices(M, b1, bars, [[VA_VOICES[c][j] for c in prog] for j in range(3)], 'vla', -15.0, BIG, 620, dyn=dyn,
           bright=0.4)
    # violins II: a high pentatonic shimmer in the last two bars
    voices(M, bars[4][0], bars[4:], [['E5', 'E5'], ['A5', 'A5']], 'vln', -20.0, HUGE, 630, att=2.0,
           dyn=[(0, 0.5), (4 * beat, 1.0), (8 * beat, 0.6)], bright=0.3)
    # piano: flowing triplets (8th-note triplets), a river under the theme
    shape = [(0, 0), (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 4), (7, 3), (8, 2), (9, 1), (10, 2), (11, 3)]
    vels = [0.34, 0.22, 0.24, 0.28, 0.24, 0.26, 0.27, 0.22, 0.22, 0.25, 0.21, 0.23]
    for k, (c, (tb, _)) in enumerate(zip(prog + ['D'], bars + [(b1 + 24 * beat, 4 * beat)])):
        arp = RIVER_CH[c][3]
        g = lvl[k] if k < 6 else 0.6
        for i, j in shape:
            t = tb + i * beat / 3
            fadeout = 1.0 if k < 6 else max(0.0, 1 - i / 12) * 0.8
            if fadeout <= 0.05:
                continue
            pno(M, t, arp[j], vels[i] * g * fadeout * 1.1, beat * 0.9, db=7.0, send=BIG, seed=k * 12 + i)
    # the canon: the same question, entering again and again
    V1 = motif(Q, t0, beat, 0.85)
    line(M, 'str', V1, -6.0, BIG, 640, sec='vln', rel=1.6, att=0.18, bright=0.6, dyn=[(0, 0.85), (8, 1.0)])
    line(M, 'str', motif(Q, t0, beat, 0.8, octv=-1), -9.0, BIG, 641, sec='vc', rel=1.6, att=0.2, bright=0.5)
    for i, (t, d, mm, v) in enumerate(motif(Q, t0 + 5 * beat, beat, 0.5, octv=1)):     # the card: piano
        pno(M, t, mm, v, d, db=9.0, send=BIG, seed=40 + i)
        pno(M, t + 0.012, mm - 12, v * 0.75, d, db=9.0, send=BIG, seed=50 + i)
    V3 = motif(pshift(Q, 2), t0 + 10 * beat, beat, 0.8)
    line(M, 'str', V3, -8.0, BIG, 642, sec='vln', rel=1.6, att=0.2, bright=0.65)
    V4 = motif(Q, t0 + 15 * beat, beat, 0.9, octv=-2)
    line(M, 'str', V4, -6.0, BIG, 643, sec='vc', rel=1.8, att=0.22, bright=0.6)
    V5 = motif(Q, t0 + 20 * beat, beat, 0.6, octv=1, last=4.0)
    line(M, 'str', V5, -14.0, HUGE, 644, sec='vln', rel=2.5, att=0.4, bright=0.35,
         dyn=[(0, 1.0), (6, 0.9), (11, 0.4)])


# ----------------------------------------------------------------------------
def _upstream(M, T):
    e = T['eras']
    # 70-78: the strings thin out (D, then A)
    M.add(e[0], strings_chord(['D2', 'A2'], e[1] - e[0] + 0.6, 'vc', att=1.0, rel=2.2, seed=700,
                              dyn=[(0, 0.85), (4.6, 0.55)]), -13.0, HALL)
    M.add(e[0], strings_chord(['D1'], e[1] - e[0] + 0.6, 'cb', att=1.0, rel=2.2, seed=701,
                              dyn=[(0, 0.8), (4.6, 0.5)]), -13.0, HALL)
    M.add(e[0], strings_chord(['E3', 'G3', 'C4'], e[1] - e[0], 'vla', att=1.0, rel=2.4, seed=702,
                              dyn=[(0, 0.8), (4.0, 0.4)], bright=0.3), -17.0, HALL)
    M.add(e[1], strings_chord(['A2', 'E3'], e[3] - e[1] + 1.0, 'vc', att=2.0, rel=2.5, seed=703,
                              dyn=[(0, 0.7), (4, 0.6), (8.5, 0.3)], bright=0.25), -15.0, HALL)
    M.add(e[1], strings_chord(['A1'], e[4] - e[1], 'cb', att=2.0, rel=1.5, seed=704,
                              dyn=[(0, 0.7), (8, 0.55), (e[4] - e[1], 0.5)]), -14.0, HALL)
    # 78-86: one bowed voice remembers the question (older, sliding)
    off = [0.4, 1.2, 2.9, 3.7, 4.55, 5.8, 6.25]
    dur = [0.8, 1.7, 0.8, 0.85, 1.25, 0.45, 2.4]
    notes = timed(Q, [e[2] + o for o in off], dur, 0.8, octv=-1)
    line(M, 'bow', notes, -8.0, {'hall': 0.35, 'space': 0.3}, 710, rel=1.4, glide=0.12, nasal=0.8,
         dyn=[(0, 0.8), (3, 1.0), (7.5, 0.7)], pan_c=-0.1)
    # 86 -> the crack: a single low drone (gated at the crack)
    with M.layer('pre'):
        d = T['crack'] - e[4] + 0.3
        M.add(e[4], strings_chord(['A1'], d, 'cb', att=3.0, rel=0.3, seed=720, bright=0.15, vib_scale=0.3,
                                  dyn=[(0, 0.6), (8, 0.8), (T['rod'] - e[4], 0.9), (d, 1.0)]), -12.0, HALL)
        M.add(e[4] + 4.0, solo_bowed_line([(0, d - 4.0, 'A2', 0.5)], rel=0.3, att=3.0, nasal=0.4, vib_depth=4.0,
                                          seed=721), -19.0, {'hall': 0.3})


# ----------------------------------------------------------------------------
def _bone(M, T):
    tr, tc = T['rod'], T['crack']
    cards = T['bone_cards']           # [106, 113 (Fu Hao, human), 121, 128]
    fu = T['fuhao']
    with M.layer('pre'):              # the heat: a thin high harmonic rising with the hiss
        M.add(tr, strings_chord(['A5'], tc - tr + 0.2, 'vln', att=2.2, rel=0.1, seed=730, bright=0.15,
                                vib_scale=0.15, dyn=[(0, 0.3), (tc - tr, 1.0)]), -25.0, HALL)
    # silence after the crack; then the ancient voices
    t1 = tc + 2.1
    anc = {'hall': 0.35, 'space': 0.45}
    M.add(t1, P(stone_chime('A3', 0.6, seed=731), -0.1), -4.0, anc)
    d = cards[3] + 3.0 - t1
    M.add(t1 + 0.4, solo_bowed_line([(0, d, 'A2', 0.5)], rel=2.0, att=3.5, nasal=0.35, vib_depth=3.0, seed=732,
                                    dyn=[(0, 0.7), (d * 0.5, 1.0), (d, 0.6)]), -19.0, {'hall': 0.3, 'space': 0.3})
    M.add(t1 + 1.0, strings_chord(['A1'], d - 0.6, 'cb', att=4.0, rel=2.0, seed=733, bright=0.1, vib_scale=0.3),
          -22.0, HALL)
    xa = t1 + 1.0
    line(M, 'xun', timed(['A4', 'C5', 'D5', 'E5', 'D5'], [xa, xa + 1.0, xa + 1.6, xa + 3.0, xa + 3.5],
                         [1.0, 0.6, 1.4, 0.5, 1.1], 0.8), -8.0, anc, 740, pan_c=0.2)
    # 婦好: the human voice carries the question
    M.add(fu, P(stone_chime('D3', 0.45, seed=741), 0.1), -8.0, anc)
    b = 0.75
    hum = timed(Q, [fu + 0.2 + b * x for x in (0, 1, 3, 4, 5, 6.5, 7)], [b, 2 * b, b, b, 1.5 * b, 0.5 * b, 3.0],
                0.8, octv=-1)
    line(M, 'voice', hum, -5.0, {'hall': 0.35, 'space': 0.4}, 742, rel=1.6, glide=0.09, pan_c=-0.05)
    # he carved the question into the shell: the bow answers, the xun far above
    tc3 = cards[2]
    M.add(tc3, P(stone_chime('A2', 0.5, seed=743), -0.15), -6.0, anc)
    bow = timed(['G3', 'A3', 'C4', 'D4', 'E4', 'D4', 'A3'],
                [tc3 + x for x in (0.6, 1.3, 2.0, 3.2, 3.8, 5.4, 6.0)], [0.7, 0.7, 1.2, 0.6, 1.6, 0.6, 2.4], 0.75)
    line(M, 'bow', bow, -9.0, anc, 744, rel=1.5, glide=0.13, nasal=1.0, pan_c=0.15)
    line(M, 'xun', timed(['E5', 'D5'], [tc3 + 3.8, tc3 + 5.4], [1.6, 2.2], 0.5), -16.0, HUGE, 745, pan_c=-0.3)
    M.add(cards[3], P(stone_chime('E3', 0.4, seed=746), 0.05), -9.0, anc)


# ----------------------------------------------------------------------------
TRIGRAMS = [7, 6, 5, 4, 3, 2, 1, 0]         # 乾 兌 離 震 巽 坎 艮 坤 (Fuxi order, yang = 1, bottom line first)


def _lineage(M, T):
    g0, g1 = T['yinyang']                   # 131.5, 137
    tb = T['fuxi']                          # 140.0
    s16 = 0.125
    bell_send = {'hall': 0.3, 'space': 0.45}
    # under it all: a low A that grows toward the bloom
    d = tb - T['lineage'] + 0.3
    M.add(T['lineage'], strings_chord(['A1', 'A2'], d, 'cb', att=3.0, rel=0.4, seed=800,
                                      dyn=[(0, 0.4), (d * 0.6, 0.7), (d, 0.9)]), -13.0, HALL)
    # yin and yang: two bronze voices (low A, high E), trigram by trigram
    for k, v in enumerate(TRIGRAMS):
        for j in range(3):
            bit = (v >> (2 - j)) & 1
            t = g0 + (k * 3 + j) * s16
            M.add(t, P(bronze_bell('E5' if bit else 'A4', 0.75 if j == 0 else 0.55, seed=k * 3 + j, decay=0.7),
                       0.25 if bit else -0.25), -8.0, bell_send)
    # hexagrams: accelerating into a shimmering cloud
    ta = g0 + 24 * s16
    t, k = ta, 0
    while t < tb - 0.05:
        u = (t - ta) / (tb - ta)
        h = 63 - (k // 6) % 64
        j = k % 6
        bit = (h >> (5 - j)) & 1
        v = (0.45 + 0.35 * u) * (1.15 if j == 0 else 1.0)
        M.add(t, P(bronze_bell('E5' if bit else 'A4', v, seed=40 + k % 23, decay=0.55),
                   (0.3 if bit else -0.3) * (1 - 0.5 * u)), -9.0 + 2 * u, bell_send)
        if j == 0 and u > 0.25:
            M.add(t, P(bronze_bell('A5' if bit else 'A3', v * 0.7, seed=90 + k % 11, decay=0.5), 0.0), -14.0,
                  bell_send)
        t += s16 / (1 + 2.2 * u ** 1.3)
        k += 1
    # the approach (G sus) and the bloom: strings and choir, majestic, C major 6/9
    tp = g1 + 0.5
    dp = tb - tp
    up = [(0, 0.2), (dp, 1.0)]
    M.add(tp, strings_chord(['G2', 'D3'], dp, 'vc', att=dp * 0.8, rel=0.15, seed=810, dyn=up), -10.0, BIG)
    M.add(tp, strings_chord(['G3', 'A3', 'D4'], dp, 'vla', att=dp * 0.8, rel=0.15, seed=811, dyn=up), -12.0, BIG)
    M.add(tp + 0.5, choir(['G3', 'D4', 'A4'], dp - 0.5, 'u', att=dp * 0.7, rel=0.15, seed=812, dyn=up), -12.0, HUGE)
    db_ = T['flip'] + 1.6 - tb
    dyn = [(0, 0.6), (0.7, 1.0), (2.2, 0.9), (db_, 0.55)]
    M.add(tb, strings_chord(['C1', 'C2'], db_, 'cb', att=0.35, rel=2.5, seed=820, dyn=dyn), -6.0, HUGE)
    M.add(tb, strings_chord(['C2', 'G2', 'C3'], db_, 'vc', att=0.35, rel=2.5, seed=821, dyn=dyn), -7.0, HUGE)
    M.add(tb, strings_chord(['G3', 'C4', 'E4'], db_, 'vla', att=0.4, rel=2.5, seed=822, dyn=dyn), -8.0, HUGE)
    M.add(tb, strings_chord(['D5', 'E5', 'G5', 'A5'], db_, 'vln', att=0.45, rel=2.5, seed=823, dyn=dyn,
                            bright=0.8), -8.0, HUGE)
    M.add(tb, choir(['C3', 'G3', 'E4', 'A4', 'D5'], db_, 'a', att=0.5, rel=3.0, seed=824, dyn=dyn), -4.0, HUGE)
    for j, (p, v) in enumerate([('C1', 0.62), ('C2', 0.58), ('G2', 0.5), ('E3', 0.42), ('D4', 0.38)]):
        pno(M, tb + 0.012 * j, p, v, 4.0, db=6.0, send=HUGE, seed=60 + j)
    M.add(tb, P(bronze_bell('C4', 0.9, seed=830, decay=1.6), -0.1), -6.0, HUGE)
    M.add(tb, P(bronze_bell('C5', 0.7, seed=831, decay=1.4), 0.15), -10.0, HUGE)
    # Leibniz: harpsichord clockwork, the head of Q (5-4-1-7) falling through the circle of fifths
    tl = T['leibniz']
    beat = 0.5
    scale = [57, 59, 60, 62, 64, 65, 67]          # A minor from A3; diatonic index i -> midi
    deg = lambda i: scale[i % 7] + 12 * (i // 7)
    roots = {'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6}
    chords = ['A', 'D', 'G', 'C', 'F', 'B', 'E', 'A', 'D', 'E']
    nb = int(round((T['tape'] - tl) / beat))
    for b in range(nb):
        c = chords[b % len(chords)]
        r0 = roots[c]
        ti = r0 + 4
        while deg(ti) > 76:
            ti -= 7
        while deg(ti) < 65:
            ti += 7
        for i, dg in enumerate([ti, ti - 1, ti - 4, ti - 5]):
            t = tl + b * beat + i * s16
            M.add(t, P(harpsichord(deg(dg), 0.75 if i == 0 else 0.62, 0.11, seed=b * 4 + i, four=0.35), 0.2),
                  1.0, ROOMY)
        lo = deg(r0 - 7)
        if lo > 50:
            lo -= 12
        for i, mm in enumerate([lo, lo + 12]):
            M.add(tl + b * beat + i * 2 * s16, P(harpsichord(mm, 0.6, 0.22, seed=300 + b * 2 + i), -0.25), 1.0,
                  ROOMY)
    # the binary goes to paper tape: two-tone pulses accelerate into electronic precision
    tt0, tc = T['tape'], T['circuits']
    bits = ''.join(f'{x:08b}' for x in '她會好起來嗎？'.encode('utf-8'))
    t, k = tt0, 0
    while t < tc - 0.01:
        u = (t - tt0) / (tc - tt0)
        bit = bits[k % len(bits)] == '1'
        M.add(t, P(blip('E5' if bit else 'A4', 0.55 + 0.2 * u, 0.05 - 0.025 * u, 'square', 2600 + 2000 * u,
                        seed=k), 0.35 if k % 2 else -0.35), -5.0, ROOMY)
        t += s16 / (1 + 3.0 * u)
        k += 1
    # circuits: a precise arpeggiator, a soft pulse below, strings holding the harmony
    arps = {'A': ['A3', 'C4', 'E4', 'A4', 'C5', 'E5'], 'F': ['F3', 'A3', 'C4', 'E4', 'A4', 'C5'],
            'C': ['C4', 'E4', 'G4', 'C5', 'D5', 'E5'], 'G': ['G3', 'D4', 'G4', 'A4', 'D5', 'E5']}
    shape = [0, 1, 2, 3, 4, 5, 4, 3]
    tmind = T['mind_back']
    trush = T['rush']
    seq = ['A', 'F', 'C', 'G']
    t, k = tc, 0
    while t < trush - 0.01:
        bar = int((t - tc) / (4 * beat))
        c = seq[bar % 4]
        u = (t - tc) / (trush - tc)
        M.add(t, P(blip(arps[c][shape[k % 8]], 0.6 + 0.25 * u, 0.07, 'saw', 1400 + 2600 * u, seed=500 + k),
                   0.3 * np.sin(k * 0.7)), -8.0 + 2 * u, ROOMY)
        if k % 4 == 0:
            rt = {'A': 'A1', 'F': 'F1', 'C': 'C2', 'G': 'G1'}[c]
            M.add(t, P(_soft_kick(rt, 0.6 + 0.3 * u), 0.0), -4.0, {'room': 0.1})
        t += s16
        k += 1
    pads = [(tc + 2 * beat * 4 * i, c) for i, c in enumerate(['A', 'F', 'C', 'G', 'A', 'F'])]
    bars = [(t, 4 * beat) for t, _ in pads if t < trush]
    prog = [c for t, c in pads if t < trush]
    dyn = [(0, 0.4), (trush - tc, 1.0)]
    voices(M, tc, bars, [[RIVER_CH[c][1][0] for c in prog], [RIVER_CH[c][1][1] for c in prog]], 'vc', -12.0,
           BIG, 840, dyn=dyn)
    voices(M, tc, bars, [[VA_VOICES[c][j] for c in prog] for j in range(3)], 'vla', -15.0, BIG, 845, dyn=dyn)
    # back into the mind: the seven glass tokens again, then the build
    for i, p in enumerate(['E6', 'D6', 'A5', 'G5', 'C6', 'A5', 'D6']):
        M.add(tmind + 0.25 * i, P(glass_ping(p, 0.8, seed=860 + i, t60=1.2, click=0.4), -0.45 + 0.15 * i), -5.0,
              DATA)
    tbd = T['build']
    M.add(tbd, choir(['A3', 'E4', 'A4'], trush - tbd, 'u', att=trush - tbd - 0.5, rel=0.3, seed=870,
                     dyn=[(0, 0.3), (trush - tbd, 1.0)], morph=('a', [(0, 0), (trush - tbd, 0.8)])), -10.0, HUGE)
    M.add(tbd, strings_chord(['E5', 'A5'], trush - tbd, 'vln', att=trush - tbd - 0.5, rel=0.3, seed=871,
                             dyn=[(0, 0.3), (trush - tbd, 1.0)], bright=0.7), -11.0, BIG)


def _soft_kick(pitch, vel):
    f0 = float(mtof(n2m(pitch)))
    n = ns(0.5)
    t = tvec(n)
    f = f0 * (1 + 1.5 * np.exp(-t / 0.02))
    y = np.sin(TWO_PI * np.cumsum(f) / SR) * np.exp(-t / 0.16) * np.minimum(t / 0.002, 1)
    return fade(lp(y, 600) * 0.25 * vel, 0, 0.05)


# ----------------------------------------------------------------------------
def _rush(M, T):
    t0, tc = T['rush'], T['answer']
    D = tc - t0
    # tempo map: 120 -> 184 bpm (exponential)
    ts = np.linspace(0, D, 4000)
    bpm = 120.0 * (184.0 / 120.0) ** (ts / D)
    beats = np.concatenate([[0], np.cumsum(bpm[1:] / 60.0 * np.diff(ts))])
    tb = lambda b: t0 + float(np.interp(b, beats, ts))
    nbeats = beats[-1]
    prog = ['A', 'F', 'C', 'G', 'A', 'F', 'G', 'E', 'E']
    roots = {'A': 'A1', 'F': 'F1', 'C': 'C2', 'G': 'G1', 'E': 'E1'}
    hi = {'A': ['A4', 'C5', 'E5', 'A5'], 'F': ['A4', 'C5', 'F5', 'A5'], 'C': ['G4', 'C5', 'E5', 'G5'],
          'G': ['G4', 'B4', 'D5', 'G5'], 'E': ['G#4', 'B4', 'E5', 'G#5']}
    k = 0
    s = 0
    while True:
        b = s / 4.0
        if b >= nbeats - 0.02:
            break
        t = tb(b)
        bar = int(b // 4)
        c = prog[min(bar, len(prog) - 1)]
        u = (t - t0) / D
        r = roots[c]
        if s % 2 == 0:
            M.add(t, strings_spicc(m_(r, 1) + (12 if (s // 2) % 2 else 0), 0.55 + 0.4 * u, dur=0.18, sec='vc',
                                   seed=k), -3.0 + 2 * u, HALL)
            M.add(t, strings_spicc(m_(r) + (12 if (s // 2) % 2 else 0), 0.55 + 0.4 * u, dur=0.2, sec='cb',
                                   seed=k + 3), -6.0 + 2 * u, HALL)
        if bar >= 2:
            p = hi[c][[0, 1, 2, 3, 2, 1, 2, 3][s % 8]]
            M.add(t, strings_spicc(p, 0.45 + 0.45 * u, dur=0.11, sec='vln', seed=k + 7),
                  -9.0 + 4 * u, HALL)
        if u < 0.35:
            M.add(t, P(blip(hi[c][s % 4], 0.6 * (1 - u / 0.35), 0.05, 'saw', 3000, seed=k + 11), 0.3), -9.0, ROOMY)
        k += 1
        s += 1
    # the question rushing back (two statements, the second an octave up)
    for j, (b0, octv, db_) in enumerate([(1.0, 0, -6.0), (16.0, 1, -8.0)]):
        notes = [(tb(b0 + 0.5 * bb), (tb(b0 + 0.5 * (bb + dd)) - tb(b0 + 0.5 * bb)) * 0.95, m_(p, octv), 0.9)
                 for (bb, dd), p in zip(Q_RHY, Q)]
        line(M, 'str', notes, db_, BIG, 900 + j, sec='vln', rel=0.8, att=0.08, bright=0.8)
        line(M, 'str', [(t, d, mm - 12, v) for t, d, mm, v in notes], db_ - 3, BIG, 910 + j, sec='vla', rel=0.8,
             att=0.08, bright=0.7)
    # the swell: strings + choir, rising, unresolved (on the dominant) at the cut
    ts0 = tb(16.0)
    d = tc - ts0
    up = [(0, 0.35), (d - 0.3, 1.0), (d, 1.0)]
    M.add(ts0, strings_chord(['E5', 'A5', 'C6'], d, 'vln', att=d * 0.7, rel=0.05, seed=920, dyn=up, trem=0.5,
                             bright=0.9), -9.0, BIG)
    M.add(ts0, choir(['A3', 'E4', 'A4', 'C5'], d, 'a', att=d * 0.7, rel=0.05, seed=921, dyn=up), -8.0, HUGE)
    t_e = tb(28.0) if nbeats > 28.5 else tc - 1.5
    M.add(t_e, strings_chord(['E2', 'B2', 'E3', 'G#3'], tc - t_e, 'vc', att=0.3, rel=0.05, seed=922,
                             dyn=[(0, 0.8), (tc - t_e, 1.0)]), -6.0, BIG)
    M.add(t_e, choir(['E3', 'B3', 'E4', 'G#4'], tc - t_e, 'a', att=0.3, rel=0.05, seed=923), -7.0, HUGE)
    sh = shepard(tc - (t0 + 4.0), [(0, 0.12), (tc - t0 - 4.0, 0.45)], seed=930)
    sh *= pts_env(sh.shape[1], [(0, 0.0), (3, 0.4), (tc - t0 - 4.0, 1.0)])[None]
    M.add(t0 + 4.0, sh, -10.0, BIG)


# ----------------------------------------------------------------------------
def _answer(M, T):
    # the AI's caret again: the faint listening tone, until it begins to type
    _listening_tone(M, T['ai_caret2'], T['ai_first'] + 2.0, T['ai_first'], -15.0)
    # 'someone loves someone very much': the softest statement of the question, on the piano
    t0 = T['loves']
    b = 0.85
    for j, (p, v) in enumerate([('F2', 0.18), ('C3', 0.16), ('A3', 0.15)]):
        pno(M, t0 + 0.04 * j, p, v, 3.3, db=8.0, seed=70 + j)
    mel = motif(Q, t0 + 0.15, b, 0.27, last=5.0)
    for i, (t, d, mm, v) in enumerate(mel):
        pno(M, t, mm, v * (0.9 if i in (3, 5) else 1.0), d, db=8.0, seed=80 + i)
    tA = mel[3][0]
    for j, (p, v) in enumerate([('A2', 0.15), ('E3', 0.13)]):
        pno(M, tA + 0.05 * j, p, v, 2.5, db=8.0, seed=90 + j)
    tD = mel[6][0]
    for j, (p, v) in enumerate([('D3', 0.14), ('A3', 0.12), ('F4', 0.11)]):
        pno(M, tD + 0.06 * j, p, v, 4.5, db=8.0, seed=95 + j)


# ----------------------------------------------------------------------------
MEM_CB = {'A': 'A1', 'F#m': 'F#1', 'D': 'D2', 'E': 'E1', 'E2': 'E2'}
MEM_VC = {'A': ['A2', 'E3'], 'F#m': ['F#2', 'C#3'], 'D': ['D3', 'A3'], 'E': ['E2', 'B2'], 'E2': ['E3', 'B3']}
MEM_ARP = {'A': ['A2', 'E3', 'B3', 'C#4', 'E4', 'C#4', 'B3', 'E3'],
           'F#m': ['F#2', 'C#3', 'A3', 'C#4', 'E4', 'C#4', 'A3', 'C#3'],
           'D': ['D3', 'A3', 'E4', 'F#4', 'A4', 'F#4', 'E4', 'A3'],
           'E': ['E2', 'B2', 'E3', 'A3', 'B3', 'A3', 'E3', 'B2']}


def _memory(M, T):
    pk = T['peak']                              # the climax (232) is a downbeat
    beat = 1.0
    b0 = pk - 20 * beat                         # 212
    seq = ['A', 'F#m', 'D', 'E', 'F#m', 'D', 'E', 'A', 'A']
    bars = [(b0 + 4 * beat * k, 4 * beat) for k in range(len(seq))]
    lv = [0.35, 0.45, 0.55, 0.62, 0.75, 1.0, 0.85, 0.7, 0.5]
    dyn = [(0, 0.35), (8, 0.55), (12, 0.65), (16, 0.8), (20, 1.0), (24, 0.85), (28, 0.7), (33, 0.5)]
    va = {'A': ['A3', 'C#4', 'E4'], 'F#m': ['A3', 'C#4', 'E4'], 'D': ['F#3', 'A3', 'E4'], 'E': ['A3', 'B3', 'E4']}
    voices(M, b0, bars, [[MEM_CB['E2' if (c == 'E' and k == 6) else c] for k, c in enumerate(seq)]], 'cb', -10.0,
           HUGE, 1000, dyn=dyn, att=1.2)
    voices(M, b0, bars, [[MEM_VC['E2' if (c == 'E' and k == 6) else c][j] for k, c in enumerate(seq)]
                         for j in range(2)], 'vc', -12.0, HUGE, 1010, dyn=dyn, att=1.2)
    va_parts = [[va[c][j] for c in seq] for j in range(3)]
    va_parts[1][5] = 'B3'                       # the peak: D 6/9
    bars_va = bars[:6] + [(bars[6][0], 2 * beat), (bars[6][0] + 2 * beat, 2 * beat)] + bars[7:]
    for j in range(3):                          # the last E: sus4 resolves to the third (V -> I)
        va_parts[j] = va_parts[j][:7] + [va_parts[j][6]] + va_parts[j][7:]
    va_parts[0][7] = 'G#3'
    voices(M, b0, bars_va, va_parts, 'vla', -14.0, HUGE, 1020, dyn=dyn, att=1.4, bright=0.45)
    # high violins: a warm halo from the second phrase on
    voices(M, bars[3][0], bars[3:8], [['E5', 'E5', 'A5', 'E5', 'E5'], ['A5', 'C#6', 'F#5', 'B5', 'A5']], 'vln',
           -18.0, HUGE, 1040, att=2.0, dyn=[(0, 0.5), (8, 1.0), (16, 0.6)], bright=0.4)
    # piano: a slower, gentler flow (8ths)
    for k, (c, (tbar, _)) in enumerate(zip(seq, bars)):
        arp = MEM_ARP[c]
        for i in range(8):
            t = tbar + i * beat / 2
            if t > T['memory_end'] - 0.5:
                break
            v = [0.3, 0.2, 0.22, 0.24, 0.26, 0.22, 0.2, 0.2][i] * (0.55 + 0.6 * lv[k])
            if k == 0 and i < 4:
                v *= 0.6 + 0.1 * i               # the human is still typing
            pno(M, t, arp[i], v, beat * 0.8, db=7.0, send=BIG, seed=k * 8 + i)
    # the question, warm: cellos (with the piano an octave above), then violins + choir to the peak
    q1 = motif(Q_MAJ, pk - 13 * beat, beat, 0.85, octv=-1)
    line(M, 'str', q1, -5.0, HUGE, 1050, sec='vc', rel=1.8, att=0.25, bright=0.6)
    for i, (t, d, mm, v) in enumerate(q1):
        pno(M, t + 0.01, mm + 12, 0.36, d, db=8.0, send=BIG, seed=100 + i)
    q2 = motif(Q_PEAK, pk - 5 * beat, beat, 0.9)
    res = timed(['E5', 'F#5', 'E5', 'C#5', 'B4', 'A4'], [pk + 4, pk + 5, pk + 5.5, pk + 6, pk + 7, pk + 8],
                [1, 0.5, 0.5, 1, 1, 4.5], 0.85)
    song = q2[:-1] + [(q2[-1][0], 2.0, q2[-1][2], q2[-1][3])] + res
    dyn2 = [(0, 0.75), (5, 1.0), (9, 0.95), (13, 0.75), (17, 0.5)]
    line(M, 'str', song, -3.0, HUGE, 1060, sec='vln', rel=2.2, att=0.2, bright=0.75, dyn=dyn2, octaves=(0, -1))
    line(M, 'choir', song, -7.0, HUGE, 1061, vowel='u', rel=2.4, att=0.25, dyn=dyn2,
         morph=('a', [(0, 0.3), (5, 1.0)]))
    for i, (t, d, mm, v) in enumerate(song):
        pno(M, t + 0.012, mm + 12, 0.42 if i < 7 else 0.36, min(d, 2.5), db=8.0, send=BIG, seed=110 + i)
    # choir pad (oo -> ah) under the second half
    for k in range(3, 8):
        c = seq[k]
        nts = {'E': ['E3', 'B3', 'E4'], 'F#m': ['F#3', 'C#4', 'A4'], 'D': ['D3', 'A3', 'F#4'],
               'A': ['A2', 'E3', 'C#4', 'A4']}[c]
        M.add(bars[k][0], choir(nts, 4 * beat, 'u', att=1.0, rel=1.6, seed=1070 + k,
                                morph=('a', [(0, 0.2 if k < 5 else 0.6), (4, 0.4 if k < 5 else 0.8)])),
              -11.0 + 3 * (k == 5), HUGE)


# ----------------------------------------------------------------------------
def _title(M, T):
    tc = T['title_crack']
    t1 = tc + 0.45
    L = T['silent_by'] - t1
    big = {'hall': 0.25, 'space': 0.7}
    for j, (p, v) in enumerate([('A1', 0.5), ('E2', 0.42), ('A2', 0.38), ('C#3', 0.34), ('B3', 0.28),
                                ('E4', 0.25)]):
        pno(M, t1 + 0.03 * j, p, v, 9.0, db=7.0, send=big, seed=120 + j)
    dyn = [(0, 0.3), (2.5, 1.0), (6.0, 0.7), (L - 6, 0.2), (L - 2.5, 0.0)]
    M.add(t1, strings_chord(['A1'], L - 2.5, 'cb', att=2.0, rel=2.5, seed=1100, dyn=dyn, bright=0.2), -13.0, big)
    M.add(t1, strings_chord(['A2', 'E3'], L - 2.5, 'vc', att=2.0, rel=2.5, seed=1101, dyn=dyn, bright=0.25),
          -15.0, big)
    M.add(t1 + 0.3, strings_chord(['C#4', 'E4'], L - 3.0, 'vla', att=2.5, rel=2.5, seed=1102, dyn=dyn,
                                  bright=0.2), -19.0, big)
    M.add(t1 + 0.5, choir(['A2', 'E3', 'C#4'], L - 4.0, 'u', att=2.5, rel=3.0, seed=1103, dyn=dyn), -18.0, big)
    # credits: the question, once more, very far away, left unfinished
    tcr = T['credits'] + 0.8
    for i, p in enumerate(['E6', 'D6', 'A5']):
        M.add(tcr + 0.45 * i, P(glass_ping(p, 0.55 - 0.1 * i, seed=1110 + i, t60=2.5, click=0.15),
                                -0.2 + 0.2 * i), -16.0, HUGE)
