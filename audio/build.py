#!/usr/bin/env python3
"""Build the complete soundtrack of 歸途 THE LONG WAY HOME.

    python3 audio/build.py            (from the repo root)

Reads film/timeline.json (the locked picture's EDL) for every sync point and
writes, into out/audio/:
    master.wav               48 kHz / 24-bit / stereo, exactly the film length
    stems/music.wav, stems/sfx.wav, stems/ambience.wav   (sum = master)
    overview.png             waveform, stem levels, loudness, spectrogram
    qc.json                  machine-readable QC results
Everything is synthesised; no samples are used.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from dsp import SR, ns, make_ir, dc_block, hp, eq, integrated_lufs  # noqa: E402
import mix  # noqa: E402
import score  # noqa: E402
import sfx  # noqa: E402

ROOT = os.path.dirname(HERE)
TIMELINE = os.path.join(ROOT, 'film', 'timeline.json')
OUT = os.path.join(ROOT, 'out', 'audio')


def load_times(path):
    tl = json.load(open(path, encoding='utf-8'))
    shots = {s['id']: s for s in tl['shots']}
    cues = tl['audioCues']

    def cue(keys, default):
        """Time of the first audio cue whose text contains any of keys (robust to
        wording edits of the live EDL); falls back to the screenplay time."""
        for key in ([keys] if isinstance(keys, str) else keys):
            for c in cues:
                if key.lower() in c['cue'].lower():
                    return float(c['t'])
        print(f'  note: audio cue {keys!r} not found in timeline, using {default}')
        return float(default)

    def cue_num(keys, pattern, default):
        for key in ([keys] if isinstance(keys, str) else keys):
            for c in cues:
                if key.lower() in c['cue'].lower():
                    m = re.search(pattern, c['cue'])
                    if m:
                        return float(m.group(1))
        return float(default)

    def card(style, lo, hi, default):
        for c in tl['cards']:
            if c['style'] == style and lo <= c['start'] <= hi:
                return float(c['start'])
        return float(default)

    ret = tl['reticle']
    acq = [e['t'] for e in ret if e['type'] == 'acquire']
    rel = [e['t'] for e in ret if e['type'] == 'release']
    boot = shots['hud_boot']['start']
    col = shots['star_collapse']
    warn = col['hud']['warn']
    T = dict(
        end=float(tl['duration']),
        boot=boot,
        boot_lines=tl['boot']['lines'],
        glitch=boot + tl['boot']['glitchAt'],
        hard_cut=boot + tl['boot']['cutAt'],
        progress=(7.0, 8.5),  # overlay.js: progress bar fill window (relative to boot)
        presents_note=cue(['low piano note', 'presents'], 13.4),
        forge=shots['star_surface']['start'],
        fusion=shots['fusion']['start'],
        lock1=acq[0],
        collapse=col['start'],
        alarms=[col['start'] + warn['start'] + k for k in range(int(warn['countdownTo'] - warn['start']))],
        implosion=cue('implosion', 59.0),
        silence=cue('total silence', 61.5),
        supernova=shots['supernova']['start'],
        title=card('title', 60, 80, 65.0),
        drift=shots['remnant']['start'],
        lock2=acq[1],
        ignition=cue(['sol ignition', 'ignition'], 101.0),
        earth=shots['young_earth']['start'],
        sunrise=cue_num(['sunrise', 'young earth'], r'peaks at (\d+(?:\.\d+)?)', 117.0),
        release2=rel[1],
        ocean=shots['ocean']['start'],
        underwater=cue_num(['underwater', 'ocean'], r'at (\d+(?:\.\d+)?)', 128.0),
        lock3=acq[2],
        tree=shots['tree']['start'],
        night_cut=cue(['cut to silence', 'crickets'], 151.6),
        piano_theme=card('subtitle', shots['night_wide']['start'], shots['hand']['start'], 154.0),
        lock4=acq[3],
        release4=rel[3],
        heart=shots['lifetime']['start'],
        heart_stop=cue('heartbeat stops', 186.0),
        harmonic=cue(["choir 'ooh'", 'dissolve'], 187.0),
        act4=shots['red_giant']['start'],
        fire=cue(['fire roar', 'stripping'], 197.0),
        climax=shots['planetary']['start'],
        lock5=acq[4],
        nursery=shots['nursery']['start'],
        lost=[e['t'] for e in ret if e['type'] == 'lost'][0],
        newworld=shots['newworld']['start'],
        reacquire=[e['t'] for e in ret if e['type'] == 'reacquire'][0],
        home=[e['t'] for e in ret if e['type'] == 'status'][0],
        release_end=rel[-1],
        final_cards=shots['final_card']['start'],
        endtitle=shots['title_end']['start'],
        credits=shots['credits']['start'],
    )
    # derived sync points
    T['cells'] = [T['lock3'] + d for d in (-2.6, 0.0, 1.5, 2.5, 3.2, 3.7, 4.1, 4.45)]
    T['pings'] = [T['nursery'] + d for d in (0.8, 1.6, 2.3, 3.1, 3.6, 4.4, 4.9, 5.4)]
    marks = [(c['t'], re.split(r'[:(;,]', c['cue'])[0][:28]) for c in cues]
    return T, marks


def main():
    t_start = time.time()
    log = lambda *a: print(*a, flush=True)
    T, marks = load_times(TIMELINE)
    n = ns(T['end'])
    log(f'歸途 audio build: {T["end"]:.1f} s @ {SR} Hz ({n} samples)')

    layers_all = {'boot': (0.0, 20.0), 'night': (150.0, 200.0)}
    M = mix.Bus('music', n, {'tree': (136.0, 166.0), 'night': (150.0, 200.0)})
    S = mix.Bus('sfx', n, layers_all)
    A = mix.Bus('ambience', n, layers_all)

    # ---- music
    t = time.time()
    log('rendering music...')
    score.render(M, T, log)
    log(f'  music done in {time.time() - t:.1f} s')

    # ---- sound design + ambience
    t = time.time()
    log('rendering sound design...')
    sfx.render(S, A, T, log)
    log(f'  sfx done in {time.time() - t:.1f} s')

    # ---- underwater: low-pass sweep on music + ambience at the waterline
    tu = T['underwater']
    A.muffle('main', tu - 0.6, T['tree'] + 2.0, [(tu - 0.6, 40000), (tu - 0.12, 30000), (tu + 0.05, 2500),
                                                 (tu + 0.6, 380), (T['tree'] + 2.0, 380)])
    M.muffle('main', tu - 0.6, T['tree'] + 1.5, [(tu - 0.6, 40000), (tu - 0.1, 30000), (tu + 0.4, 1300),
                                                 (T['tree'] - 0.8, 1300), (T['tree'] + 1.2, 40000)])

    # ---- reverbs, gates, stems
    t = time.time()
    log('reverbs + gates...')
    irs = {'hall': make_ir(2.6, 2.2, 1.1, 4.0, predelay=0.022, seed=101, er_gain=0.4),
           'space': make_ir(6.5, 5.2, 2.6, 8.0, predelay=0.045, seed=202, er_gain=0.15)}
    wet = {'hall': 0.75, 'space': 0.8}
    g_sil = [(0, 1), (T['silence'] - 0.003, 1), (T['silence'], 0), (T['supernova'] - 0.002, 0), (T['supernova'], 1)]
    gates = {
        ('*', 'boot'): [(0, 1), (T['hard_cut'] - 0.002, 1), (T['hard_cut'], 0)],
        ('*', 'main'): g_sil,
        ('music', 'main'): g_sil + [(T['lost'] - 0.002, 1), (T['lost'] + 0.15, 0), (T['newworld'] - 0.05, 0),
                                    (T['newworld'], 1)],
        ('music', 'tree'): [(0, 1), (T['night_cut'] - 0.002, 1), (T['night_cut'] + 0.04, 0.12),
                            (T['night_cut'] + 1.2, 0)],
        ('*', 'night'): [(0, 1), (T['heart_stop'] - 0.3, 1), (T['heart_stop'], 0)],
    }
    stems = {}
    for B in (M, S, A):
        st = B.render(irs, wet, gates)
        st = hp(dc_block(st.astype(np.float64)), 24.0, order=4)
        if B.name == 'music':  # a little 'air' on the orchestra
            st = eq(st, [('highshelf', 6500.0, 3.5, 0.7)])
        stems[B.name] = st
        if B.truncated:
            log(f'  warning: truncated events on {B.name}: {B.truncated[:8]}')
    del M, S, A
    log(f'  reverbs done in {time.time() - t:.1f} s')

    # ---- master
    t = time.time()
    tt = np.arange(n) / SR
    fo = np.clip((T['end'] - 0.4 - tt) / 2.6, 0, 1)
    fo = 0.5 - 0.5 * np.cos(np.pi * fo)
    out, stems_out, minfo = mix.master(stems, target_lufs=-15.5, ceiling_dbtp=-1.0, fade_out=fo, log=log)
    assert out.shape == (2, n)
    os.makedirs(os.path.join(OUT, 'stems'), exist_ok=True)
    mix.write_wav24(os.path.join(OUT, 'master.wav'), out)
    for k, s in stems_out.items():
        mix.write_wav24(os.path.join(OUT, 'stems', f'{k}.wav'), s)
    log(f'  master + stems written in {time.time() - t:.1f} s')

    rep = mix.qc_report(out, stems_out, T, log)
    info = mix.read_wav_info(os.path.join(OUT, 'master.wav'))
    log(f"\nmaster.wav: {info['channels']} ch, {info['sr']} Hz, {info['bits']}-bit, {info['frames']} frames "
        f"= {info['seconds']:.6f} s")
    mix.overview_png(os.path.join(OUT, 'overview.png'), out, stems_out, T, marks, log)
    rep.update(minfo)
    rep['wav'] = info
    rep['heartbeats'] = T.get('_heartbeats')
    rep['build_seconds'] = time.time() - t_start
    json.dump(rep, open(os.path.join(OUT, 'qc.json'), 'w'), indent=1, default=float)
    log(f'\nbuild finished in {time.time() - t_start:.1f} s')


if __name__ == '__main__':
    main()
