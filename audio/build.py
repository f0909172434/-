#!/usr/bin/env python3
"""Build the complete soundtrack of 卜 ORACLE.

    python3 audio/build.py            (from the repo root)

Reads film/timeline.json (the locked picture's EDL) for every sync point: the keystrokes are derived
from the chat ops exactly as overlay.js types them, the section times from the shots, cards and
audioCues, and the crack's fine twigs from the shared crack geometry (film/src/lib/crack.js).
Writes, into out/audio/:
    master.wav               48 kHz / 24-bit / stereo, exactly the film length
    stems/music.wav, stems/sfx.wav, stems/ambience.wav   (sum = master)
    overview.png             waveform, stem levels, loudness, spectrogram, sync marks
    qc.json                  machine-readable QC results (loudness, true peak, sync errors)
Everything is synthesised; no samples are used.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from dsp import SR, ns, make_ir, dc_block, hp, eq  # noqa: E402
import mix  # noqa: E402
import score  # noqa: E402
import sfx  # noqa: E402

ROOT = os.path.dirname(HERE)
TIMELINE = os.path.join(ROOT, 'film', 'timeline.json')
OUT = os.path.join(ROOT, 'out', 'audio')
NUM = r'(\d+(?:\.\d+)?)'

# twig start times (s after the snap) of crackGeometry() in film/src/lib/crack.js, used if node is unavailable
TWIGS_FALLBACK = [0.034, 0.039, 0.039, 0.061, 0.066, 0.067, 0.073, 0.083, 0.086, 0.086, 0.088, 0.091, 0.093,
                  0.096, 0.105, 0.113, 0.115, 0.131, 0.137, 0.143, 0.149, 0.152, 0.152, 0.156, 0.158, 0.159,
                  0.160, 0.183, 0.203, 0.207, 0.222, 0.246, 0.255, 0.267, 0.289]


def crack_twigs():
    """Start times of the visible twigs of the shared crack (so their micro-cracks land with the picture)."""
    js = ("import('" + os.path.join(ROOT, 'film', 'src', 'lib', 'crack.js').replace('\\', '/') + "')"
          ".then(m => console.log(JSON.stringify(m.crackGeometry().lines.filter(P => P.kind === 'twig' && "
          "P.L > 0.012).map(P => +P.t0.toFixed(4)))))")
    try:
        r = subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=20)
        tw = json.loads(r.stdout.strip())
        if tw:
            return sorted(tw), 'crack.js'
    except Exception:
        pass
    return TWIGS_FALLBACK, 'fallback'


def _mulberry32(seed):
    """film/src/lib/random.js mulberry32, bit-exact (uint32 arithmetic)."""
    st = [seed & 0xffffffff]
    imul = lambda a, b: (a * b) & 0xffffffff

    def nxt():
        st[0] = (st[0] + 0x6D2B79F5) & 0xffffffff
        t = st[0]
        t = imul(t ^ (t >> 15), t | 1)
        t ^= (t + imul(t ^ (t >> 7), t | 61)) & 0xffffffff
        return ((t ^ (t >> 14)) & 0xffffffff) / 4294967296.0
    return nxt


def mind_sync(t0):
    """Sync points of the finished mind scene (film/src/scenes/mind.js; local time + shot start t0).
    Falls back to the values the scene's author reported."""
    S = dict(bloom=27.30, cols=(31.0, 32.4), col_step=0.07, pour=32.7, touch=33.17, tail=34.52, arc=0.75,
             links=[(0, 2, 0.62, 34.0), (0, 3, 0.47, 34.5), (0, 4, 0.55, 35.0), (0, 5, 0.21, 36.0),
                    (1, 5, 0.12, 36.35), (2, 5, 0.18, 36.7), (3, 5, 0.09, 37.05), (4, 5, 0.14, 37.4),
                    (5, 6, 0.26, 37.75)],
             heads=[(0, 6, 0.3, 37.95 + 0.16 * k) for k in range(6)], lines=(39.0, 40.0), lit_end=42.3,
             src='reported')
    try:
        js = open(os.path.join(ROOT, 'film', 'src', 'scenes', 'mind.js'), encoding='utf-8').read()
        g = lambda name: float(re.search(r'\b' + name + r'\s*=\s*' + NUM, js).group(1))
        ext0, ext1, str0, cold = g('EXT0'), g('EXT1'), g('STR0'), g('COLD')
        S['cols'] = (t0 + ext0, t0 + ext1)
        S['col_step'] = cold
        S['pour'] = t0 + str0
        S['arc'] = g('ARC_DUR')
        S['lines'] = (t0 + g('T_QUERY'), t0 + g('T_REGION'))
        body = re.search(r'const LINKS = \[(.*?)\];', js, re.S).group(1)
        S['links'] = [(int(a), int(b), float(w), t0 + float(t)) for a, b, w, t in
                      re.findall(r'\[(\d+),\s*(\d+),\s*' + NUM + r',\s*' + NUM + r'\]', body)]
        nh, ht = int(g('HEADS')), g('HEAD_T')
        heads = []
        for h in range(1, nh + 1):           # the scene's own construction, same RNG stream
            rnd = _mulberry32(900 + h * 7)
            rint = lambda a, b: int(np.floor(a + (b + 1 - a) * rnd()))
            n_ = 4 + rint(0, 3)
            used = set()
            for k in range(n_):
                a = rint(0, 5)
                b = rint(a + 1, 6)
                if a * 8 + b in used:
                    continue
                used.add(a * 8 + b)
                rnd()                          # hh
                w = 0.08 + 0.45 * rnd() * rnd()
                heads.append((a, b, w, t0 + ht + 0.16 * (h - 1) + 0.07 * k))
        S['heads'] = sorted(heads, key=lambda x: x[3])
        S['src'] = 'mind.js'
    except Exception as e:  # pragma: no cover
        S['src'] = f'reported ({e})'
    return S


def _js_consts(path, names):
    js = open(path, encoding='utf-8').read()
    out = {}
    for nm in names:
        m = re.search(r'\b' + nm + r'\s*=\s*(-?' + NUM[1:-1] + r')', js)
        if m:
            out[nm] = float(m.group(1))
    return js, out


def lineage_sync(t0):
    """Sync points of the finished lineage scene (film/src/scenes/lineage.js, local time + t0): Shao Yong's
    doubling (level n: child c's new line at t0 + D (0.42 + 0.48 c / (2^(n+1) - 1)); even c = yin, odd = yang),
    the 8 x 8 square, the ring (pair v lands at RING0 + RING_FLY + v RING_STEP), the climax, the binary flip, Leibniz's
    table (numeral v lands at FLY0 + v FLY_STEP + FLY_DUR, '&c.' after 32), tape, Williams tube, chip, die, mind."""
    L = dict(steps=[(131.62, 0.9), (132.55, 1.0), (134.5, 0.75), (135.3, 0.72), (136.08, 0.8)], reshape=137.0,
             ring=[138.75 + 0.04 * v for v in range(32)], climax=140.0, flips=[143.5 + 0.021 * v for v in range(64)],
             flip_dur=0.26, table=[146.13 + 0.112 * v for v in range(33)], etc=149.964, tape=150.0, tape_run=150.7,
             crt=(151.65, 152.85), chip=153.0, die=155.0, lift=157.0, accel=158.0, src='reported')
    try:
        js, c = _js_consts(os.path.join(ROOT, 'film', 'src', 'scenes', 'lineage.js'),
                           ['RESHAPE', 'RING0', 'RING_STEP', 'RING_FLY', 'CLIMAX', 'FLIP0', 'FLIP_STEP', 'FLIP_DUR',
                            'FLY0', 'FLY_STEP', 'FLY_DUR', 'TAPE0', 'TAPE_RUN', 'CRT0', 'PCB0', 'DIE0', 'MIND0'])
        st = re.search(r'const STEPS = \[(.*?)\];', js).group(1)
        L['steps'] = [(t0 + float(a), float(b)) for a, b in re.findall(r'\[' + NUM + r',\s*' + NUM + r'\]', st)]
        L['reshape'] = t0 + c['RESHAPE']
        L['ring'] = [t0 + c['RING0'] + c['RING_FLY'] + c['RING_STEP'] * v for v in range(32)]
        L['climax'] = t0 + c['CLIMAX']
        L['flips'] = [t0 + c['FLIP0'] + c['FLIP_STEP'] * v for v in range(64)]
        L['flip_dur'] = c['FLIP_DUR']
        L['table'] = [t0 + c['FLY0'] + c['FLY_STEP'] * v + c['FLY_DUR'] for v in range(33)]
        L['etc'] = t0 + c['FLY0'] + 32 * c['FLY_STEP'] + c['FLY_DUR'] + 0.25
        L['tape'], L['tape_run'] = t0 + c['TAPE0'], t0 + c['TAPE_RUN']
        L['crt'] = (t0 + c['CRT0'] + 0.35, t0 + c['CRT0'] + 1.55)
        L['chip'], L['die'], L['lift'] = t0 + c['PCB0'], t0 + c['DIE0'], t0 + c['MIND0']
        L['accel'] = t0 + c['MIND0'] + 1.0
        L['src'] = 'lineage.js'
    except Exception as e:  # pragma: no cover
        L['src'] = f'reported ({e})'
    L['levels'] = [[t + D * (0.42 + 0.48 * k / ((2 << n) - 1)) for k in range(2 << n)]
                   for n, (t, D) in enumerate(L['steps'], start=1)]
    return L


def bone_sync():
    """Sync points of the finished bone scene (film/src/scenes/bone.js, absolute times) and its fire flicker."""
    B = dict(rod_in=101.3, touch=103.0, cut=104.604, snap=105.5, read=(113.5, 118.3), zoom=(125.4, 129.8),
             dim=(128.4, 130.2), breath=[], src='reported')
    try:
        js, c = _js_consts(os.path.join(ROOT, 'film', 'src', 'scenes', 'bone.js'),
                           ['T_ROD', 'T_TOUCH', 'T_CUT', 'T_SNAP', 'T_ZOOM0', 'T_ZOOM1'])
        B.update(rod_in=c['T_ROD'], touch=c['T_TOUCH'], cut=c['T_CUT'], snap=c['T_SNAP'],
                 zoom=(c['T_ZOOM0'], c['T_ZOOM1']))
        m = re.search(r'const breath = T => 1 (.*?);', js)
        B['breath'] = [(float(a), float(p), float(ph)) for a, p, ph in
                       re.findall(r'([\d.]+) \* Math\.sin\(2 \* Math\.PI \* T / ([\d.]+) \+ ([\d.]+)\)', m.group(1))]
        B['src'] = 'bone.js'
    except Exception as e:  # pragma: no cover
        B['src'] = f'reported ({e})'
    return B


def river_sync():
    """Sync points of the finished river scene (film/src/scenes/river.js, film/src/lib/riverrig.js), absolute times."""
    V = dict(q_land=49.4, dive=56.4, surge=[70, 74, 78, 82, 86, 92.3], era_mid=[72, 76, 80, 84, 89, 96],
             shake=(82.2, 83.4), rise=(83.25, 83.95), yarrow=[86.4, 87.0, 88.55, 89.15, 89.7],
             yao=[89.95, 90.3, 90.62, 90.94, 91.26, 91.58], hex_lines=[8, 7, 8, 7, 8, 7],
             ret_hold=(160.0, 160.5), ret_eras=[161.04, 161.98, 163.22, 164.40, 165.64, 166.98],
             converge=(170.0, 171.4), mem_write=[216.6, 217.9, 219.6], src='reported')
    try:
        rig = open(os.path.join(ROOT, 'film', 'src', 'lib', 'riverrig.js'), encoding='utf-8').read()
        js = open(os.path.join(ROOT, 'film', 'src', 'scenes', 'river.js'), encoding='utf-8').read()
        arr = lambda src, nm: [float(x) for x in re.findall(NUM, re.search(r'const ' + nm + r' = \[(.*?)\];', src).group(1))]
        V['era_mid'] = arr(rig, 'ERA_MID')
        sg = re.search(r'const SURGE = \[(.*)\];', rig).group(1)
        V['surge'] = [float(m[0]) for m in re.findall(r'\[' + NUM + r',\s*' + NUM + r',\s*' + NUM + r'\]', sg)]
        V['yao'] = arr(js, 'YAO_T')
        V['yarrow'] = [float(m) for m in re.findall(r"note\('[^']*',\s*-?[\d.]+,\s*-?[\d.]+,\s*" + NUM, js)][:5]
        m = re.search(r'G > ' + NUM + r' && G < ' + NUM + r' \? Math\.sin', js)
        V['shake'] = (float(m.group(1)), float(m.group(2)))
        m = re.search(r'const rise = easeInOutCubic\(smoothstep\(' + NUM + r',\s*' + NUM, js)
        V['rise'] = (float(m.group(1)), float(m.group(2)))
        m = re.search(r'const g0 = ' + NUM + r', g1 = ' + NUM, js)
        V['q_land'] = float(m.group(2))
        dat = open(os.path.join(ROOT, 'film', 'src', 'lib', 'riverdata.js'), encoding='utf-8').read()
        V['hex_lines'] = [int(x) for x in re.search(r'HEX = \{[^}]*lines: \[([\d,\s]+)\]', dat).group(1).split(',')]
        V['src'] = 'river.js'
    except Exception as e:  # pragma: no cover
        V['src'] = f'reported ({e})'
    return V


def chat_events(tl):
    """Keystrokes exactly as overlay.js msgState() reveals the text: type (first char at t0, then the
    per-char delay: array entry i, or its last entry, or a constant), del (one backspace every dt), send."""
    keys, lifts, todata, carets = [], [], None, {}
    for m in tl['chat']['messages']:
        role = m['role']
        text = []
        for op in m['ops']:
            kind, t0 = op[0], float(op[1])
            if kind == 'type':
                s, d = list(op[2]), op[3]
                ti = t0
                for i, ch in enumerate(s):
                    if i > 0:
                        ti += (d[i] if i < len(d) else d[-1]) if isinstance(d, list) else d
                    keys.append(dict(t=ti, kind='ai' if role == 'ai' else ('space' if ch == ' ' else 'key'),
                                     msg=m['id'], ch=ch, i=i, n=len(s)))
                    text.append(ch)
            elif kind == 'del':
                for i in range(int(op[2])):
                    keys.append(dict(t=t0 + i * float(op[3]), kind='bs', msg=m['id'], i=i, n=int(op[2])))
                    if text:
                        text.pop()
            elif kind == 'send':
                keys.append(dict(t=t0, kind='enter', msg=m['id']))
            elif kind == 'lift':
                lifts.append(t0)
            elif kind == 'caret':
                carets.setdefault(m['id'], t0)
        if m.get('toData'):
            todata = (float(m['toData'][0]), ''.join(text))
    keys.sort(key=lambda e: e['t'])
    return keys, sorted(lifts), todata, carets


def load_times(path):
    tl = json.load(open(path, encoding='utf-8'))
    shots = {s['id']: s for s in tl['shots']}
    cues = tl['audioCues']
    notes = []

    def cue_num(key, pattern, default, group=1):
        """A number from the audio cue whose text contains key (robust to edits of the live EDL)."""
        for c in cues:
            if key.lower() in c['cue'].lower():
                m = re.search(pattern, c['cue'])
                if m:
                    return float(m.group(group))
        notes.append(f'cue {key!r} / {pattern!r} not found, using {default}')
        return float(default)

    def card(style, lo, hi, default):
        for c in tl['cards']:
            if c['style'] == style and lo <= c['start'] <= hi:
                return float(c['start'])
        notes.append(f'card {style} in [{lo}, {hi}] not found, using {default}')
        return float(default)

    keys, lifts, todata, carets = chat_events(tl)
    msgs = {m['id']: m for m in tl['chat']['messages']}
    t_mem = shots['memory']
    T = dict(end=float(tl['duration']), fps=float(tl['fps']))
    T.update(
        car=cue_num('distant car', r'car at ~' + NUM, 1.5),
        ai_caret=float(next(o[1] for o in msgs['a0']['ops'] if o[0] == 'caret')) if 'a0' in msgs else 22.6,
        mind=float(shots['mind']['start']),
        river=float(shots['river_now']['start']),
        bone=float(shots['bone']['start']),
        lineage=float(shots['lineage']['start']),
        rush=float(shots['river_back']['start']),
        answer=float(shots['answer']['start']),
        answer_fade=float(shots['answer'].get('in', {}).get('dur', 0.8)),
        memory=float(t_mem['start']),
        memory_end=float(t_mem['end']),
        memory_fade=float(t_mem.get('out', {}).get('dur', 2.5)),
        title=float(shots['title']['start']),
        credits=float(shots['credits']['start']),
    )
    # toData: character i lights up at toData[0] + step*i
    td0, td_text = todata
    step = cue_num('dissolves into data', NUM + r'\s*\+\s*' + NUM + r'\s*\*\s*i', 0.09, group=2)
    T['todata'] = [td0 + step * i for i in range(len(td_text))]
    T['todata_text'] = td_text
    # mind
    p0 = cue_num('tokenisation', NUM + r'\s*\+\s*' + NUM + r'\s*\*\s*i', 29.0, group=1)
    ps = cue_num('tokenisation', NUM + r'\s*\+\s*' + NUM + r'\s*\*\s*i', 0.35, group=2)
    npings = int(cue_num('tokenisation', r'i\s*=\s*0\.\.(\d+)', 6)) + 1
    T['pings'] = [p0 + ps * i for i in range(npings)]
    T['vectors'] = (cue_num('vectors unroll', r'vectors unroll ' + NUM, 31.0),
                    cue_num('vectors unroll', r'vectors unroll ' + NUM + r'\s*[-–]\s*' + NUM, 34.0, group=2))
    T['attention'] = (cue_num('attention links', r'attention links ' + NUM, 34.0),
                      cue_num('attention links', r'attention links ' + NUM + r'\s*[-–]\s*' + NUM, 39.0, group=2))
    T['memory_region'] = cue_num('region of memory', r'at ' + NUM + r' a region of memory', 40.0)
    T['dive'] = (cue_num('dives', NUM + r'\s*[-–]\s*' + NUM + r' the camera dives', 43.0),
                 cue_num('dives', NUM + r'\s*[-–]\s*' + NUM + r' the camera dives', 45.0, group=2))
    T['river_card'] = card('ai', T['river'], T['river'] + 20, 50.0)
    T['mind_sync'] = mind_sync(T['mind'])
    T['rv'] = river_sync()
    # eras (upstream)
    era_keys = [('modem', 70), ('teleprinter', 74), ('quill', 78), ('bamboo', 82), ('yarrow', 86), ('fire crackle', 92)]
    T['eras'] = [cue_num('UPSTREAM', NUM + r'\s+(?:dry\s+)?' + k.split()[0], d) for k, d in era_keys]
    # bone
    T['rod'] = cue_num('BONE', r'hollow at ' + NUM, 103.0)
    T['crack'] = cue_num('BONE', r'CRACK at exactly ' + NUM, 105.5)
    T['bone_cards'] = [float(c['start']) for c in tl['cards'] if T['bone'] <= c['start'] < T['lineage']]
    T['fuhao'] = card('human', T['bone'], T['lineage'], 113.0)
    T['bone_sync'] = bone_sync()
    for k, k2 in (('rod', 'touch'), ('crack', 'snap')):
        if abs(T[k] - T['bone_sync'][k2]) > 1e-6:
            notes.append(f'bone.js {k2} = {T["bone_sync"][k2]} but the cue says {T[k]}; using the cue')
    # lineage
    T['yinyang'] = (cue_num('LINEAGE', r'hexagrams \(' + NUM + r'\s*[-–]\s*' + NUM + r'\)', 131.5),
                    cue_num('LINEAGE', r'hexagrams \(' + NUM + r'\s*[-–]\s*' + NUM + r'\)', 137.0, group=2))
    T['fuxi'] = cue_num('LINEAGE', r'at ' + NUM + r' the Fuxi circle', 140.0)
    T['flip'] = cue_num('LINEAGE', NUM + r' the hexagrams flip', 143.5)
    T['leibniz'] = cue_num('LINEAGE', r'at ' + NUM + r' Leibniz', 145.0)
    T['tape'] = cue_num('LINEAGE', r'at ' + NUM + r' the binary becomes paper tape', 150.0)
    T['circuits'] = cue_num('LINEAGE', NUM + r' circuits', 153.0)
    T['mind_back'] = cue_num('LINEAGE', NUM + r' back into the mind', 157.0)
    T['build'] = cue_num('LINEAGE', NUM + r'\s*[-–]\s*' + NUM + r' builds', 155.0)
    T['lin'] = lineage_sync(T['lineage'])
    # answer
    ai_ops = [(m['id'], o) for m in tl['chat']['messages'] if m['role'] == 'ai' and float(m['show'][0]) > T['answer']
              for o in m['ops']]
    T['ai_caret2'] = min(float(o[1]) for _, o in ai_ops if o[0] == 'caret')
    T['ai_first'] = min(float(o[1]) for _, o in ai_ops if o[0] == 'type')
    T['loves'] = cue_num('ANSWER', r'\(' + NUM + r'\) the softest piano', 188.6)
    T['quiet_from'] = cue_num('ANSWER', r'\(' + NUM + r'\): long silence', 196.0)
    T['soft_msgs'] = [m['id'] for m in tl['chat']['messages'] if m['role'] == 'human' and m['show'][0] > T['answer']]
    T['human_again'] = min(e['t'] for e in keys if e['msg'] in T['soft_msgs'])
    T['fridge_off'] = 0.5 * (T['quiet_from'] + T['human_again']) - 1.0
    T['lifts'] = lifts
    T['peak'] = cue_num('MEMORY RIVER', r'Peak ~' + NUM, 232.0)
    # title + credits
    tcard = card('oracle-title', T['title'], T['credits'], 246.0)
    T['title_crack'] = tcard + 0.5            # overlay.js: the snap is 0.5 s after the card starts
    cue_tc = cue_num('crack snaps again', NUM + r': the crack snaps again', T['title_crack'])
    if abs(cue_tc - T['title_crack']) > 1e-6:
        notes.append(f'title crack: card+0.5 = {T["title_crack"]} but cue says {cue_tc}; using the card')
    T['silent_by'] = cue_num('Credits', r'silence by ' + NUM, T['end'] - 1.0)
    T['keys'] = keys
    T['twigs'], T['twigs_src'] = crack_twigs()
    T['notes'] = notes
    marks = [(c['t'], re.split(r'[:(;,]', c['cue'])[0][:28]) for c in cues]
    return T, marks


def qc_plan(T):
    """Sync checks (name, t, band, stem, window) and structural silences."""
    ks = T['keys']
    human0 = [e for e in ks if e['kind'] in ('key', 'space') and e['msg'] not in T['soft_msgs']]
    bss = [e for e in ks if e['kind'] == 'bs']
    ais = [e for e in ks if e['kind'] == 'ai']
    soft = [e for e in ks if e['msg'] in T['soft_msgs']]
    enter = [e for e in ks if e['kind'] == 'enter']
    W = (-0.035, 0.035)
    checks = []
    for e in human0[:3] + human0[5:7] + human0[-2:]:
        checks.append((f'key {e["ch"]} ({e["msg"]})', e['t'], (1000, 8000), 'sfx', W))
    for e in [bss[0], bss[2], bss[5], bss[-1]]:
        checks.append((f'backspace {e["msg"]}#{e["i"]}', e['t'], (1000, 8000), 'sfx', W))
    for e in enter:
        checks.append(('Enter (send)', e['t'], (500, 8000), 'sfx', W))
    for j, t in enumerate(T['todata']):
        checks.append((f'toData tick {j}', t, (2000, 9000), 'sfx', (-0.03, 0.03)))
    for j, t in enumerate(T['pings']):
        checks.append((f'token ping {j}', t, (600, 6000), 'sfx', (-0.08, 0.08)))
    for e in [ais[0], ais[5], ais[-12], ais[-1]]:
        checks.append((f'AI tick {e["ch"]} ({e["msg"]})', e['t'], (4000, 12000), 'sfx', W))
    for e in soft[:2] + soft[-1:]:
        checks.append((f'key {e["ch"]} ({e["msg"]})', e['t'], (1000, 8000), 'sfx', W))
    checks.append(('CRACK 卜', T['crack'], (1500, 12000), 'sfx', (-0.1, 0.1)))
    checks.append(('CRACK 卜 (master)', T['crack'], (1500, 12000), 'master', (-0.1, 0.1)))
    checks.append(('Fuxi bloom (circle closes)', T['fuxi'], (30, 90), 'music', (-0.05, 0.05)))
    L = T['lin']
    for v in (0, 16, 32):
        checks.append((f'Leibniz numeral {v}', L['table'][v], (1500, 9000), 'music', (-0.04, 0.04)))
    checks.append(('yin/yang level 1 c0', L['levels'][0][0], (300, 4000), 'music', (-0.05, 0.05)))
    for j, t in enumerate(T['lifts']):
        checks.append((f'lift chime {j + 1}', t, (1000, 6000), 'sfx', (-0.06, 0.06)))
    checks.append(('title crack', T['title_crack'], (1000, 8000), 'sfx', (-0.1, 0.1)))
    checks.append(('title crack (master)', T['title_crack'], (1000, 8000), 'master', (-0.1, 0.1)))
    silences = [(T['crack'] + 0.6, T['crack'] + 1.9, 'after the crack'),
                (T['answer'] + 0.02, T['answer'] + 0.5, 'cut to the answer'),
                (T['quiet_from'] + 3.5, T['human_again'] - 0.1, 'long silence (answer)'),
                (T['memory_end'] + 0.05, T['title_crack'] - 0.55, 'black before the title'),
                (T['silent_by'], T['end'], 'end of credits')]
    return checks, silences


def main():
    t_start = time.time()
    log = lambda *a: print(*a, flush=True)
    T, marks = load_times(TIMELINE)
    for nmsg in T['notes']:
        log('  note: ' + nmsg)
    n = ns(T['end'])
    log(f'卜 ORACLE audio build: {T["end"]:.1f} s @ {SR} Hz ({n} samples); {len(T["keys"])} keystrokes, '
        f'{len(T["twigs"])} crack twigs ({T["twigs_src"]})')

    tc, ta, tm1 = T['crack'], T['answer'], T['memory_end']
    lay_pre = (T['eras'][4] - 2.0, tc + 1.0)
    lay_rush = (T['rush'] - 2.0, ta + 2.0)
    lay_mem = (T['lifts'][0] - 1.0 if T['lifts'] else T['memory'] - 3.0, tm1 + 4.0)
    M = mix.Bus('music', n, {'pre': lay_pre, 'rush': lay_rush, 'mem': lay_mem})
    S = mix.Bus('sfx', n, {'pre': lay_pre, 'rush': lay_rush})
    A = mix.Bus('ambience', n, {'fire': (T['eras'][5] - 2.0, T['lineage'] + 6.0), 'rush': lay_rush,
                                'mem': lay_mem})

    t = time.time()
    log('rendering music...')
    score.render(M, T, log)
    log(f'  music done in {time.time() - t:.1f} s')
    t = time.time()
    log('rendering sound design...')
    sfx.render(S, A, T, log)
    log(f'  sfx done in {time.time() - t:.1f} s')

    t = time.time()
    log('reverbs + gates...')
    irs = {'room': make_ir(0.45, 0.35, 0.25, 1.2, predelay=0.003, seed=11, er_gain=0.6, hf=8000.0),
           'hall': make_ir(2.4, 2.0, 1.0, 4.0, predelay=0.02, seed=101, er_gain=0.4),
           'space': make_ir(6.0, 5.0, 2.6, 8.0, predelay=0.04, seed=202, er_gain=0.15)}
    wet = {'room': 0.6, 'hall': 0.75, 'space': 0.8}
    f0 = tm1 - T['memory_fade']
    mem_gate = [(0, 1.0)] + [(f0 + u * (tm1 - f0), 0.5 + 0.5 * np.cos(np.pi * u)) for u in np.linspace(0, 1, 16)]
    gates = {
        ('*', 'pre'): [(0, 1), (tc - 0.002, 1), (tc + 0.012, 0)],
        ('*', 'rush'): [(0, 1), (ta - 0.03, 1), (ta, 0)],
        ('*', 'mem'): mem_gate,
        ('ambience', 'fire'): [(0, 1), (T['rod'], 1), (T['rod'] + 0.5, 0.6), (tc - 0.002, 0.6), (tc + 0.06, 0.05),
                               (tc + 2.2, 0.05), (tc + 6.0, 0.6),
                               (T['lineage'] + 6.0, 0.6)],
    }
    stems = {}
    for B in (M, S, A):
        st = B.render(irs, wet, gates)
        st = hp(dc_block(st.astype(np.float64)), 24.0, order=4)
        if B.name == 'music':
            st = eq(st, [('lowshelf', 100.0, -1.5, 0.7), ('highshelf', 7000.0, 4.0, 0.7)])
        stems[B.name] = st
        if B.truncated:
            log(f'  warning: truncated events on {B.name}: {B.truncated[:8]}')
    del M, S, A
    log(f'  reverbs done in {time.time() - t:.1f} s')

    t = time.time()
    tt = np.arange(n) / SR
    fo = np.clip((T['silent_by'] + 0.6 - tt) / 1.6, 0, 1)
    fo = 0.5 - 0.5 * np.cos(np.pi * fo)
    out, stems_out, minfo = mix.master(stems, target_lufs=-16.0, ceiling_dbtp=-1.0, fade_out=fo, log=log)
    assert out.shape == (2, n)
    os.makedirs(os.path.join(OUT, 'stems'), exist_ok=True)
    mix.write_wav24(os.path.join(OUT, 'master.wav'), out)
    for k, s in stems_out.items():
        mix.write_wav24(os.path.join(OUT, 'stems', f'{k}.wav'), s)
    log(f'  master + stems written in {time.time() - t:.1f} s')

    checks, silences = qc_plan(T)
    rep = mix.qc_report(out, stems_out, checks, silences, log)
    info = mix.read_wav_info(os.path.join(OUT, 'master.wav'))
    log(f"\nmaster.wav: {info['channels']} ch, {info['sr']} Hz, {info['bits']}-bit, {info['frames']} frames "
        f"= {info['seconds']:.6f} s")
    sync_marks = [(c[1], c[0]) for c in checks]
    mix.overview_png(os.path.join(OUT, 'overview.png'), out, stems_out, marks, sync_marks, log)
    rep.update(minfo)
    rep['wav'] = info
    rep['times'] = {k: v for k, v in T.items() if k not in ('keys', 'notes')}
    rep['keystrokes'] = [(round(e['t'], 4), e['kind'], e.get('ch', '')) for e in T['keys']]
    rep['notes'] = T['notes']
    rep['build_seconds'] = time.time() - t_start
    json.dump(rep, open(os.path.join(OUT, 'qc.json'), 'w', encoding='utf-8'), indent=1, default=float,
              ensure_ascii=False)
    log(f'\nbuild finished in {time.time() - t_start:.1f} s')


if __name__ == '__main__':
    main()
