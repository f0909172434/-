// Headless renderer. Drives film/index.html in Chromium (WebGL via SwiftShader or a real GPU).
//
//   node tools/render.mjs stills --times 20,44.5,63.2 [--scale 0.5] [--out out/stills] [--sheet name]
//   node tools/render.mjs shot <shotId> [--step 2] [--scale 0.5]      -> stills across a shot + contact sheet
//   node tools/render.mjs video [--from 0] [--to 281] [--workers 2] [--chunk 240] [--scale 1]
//
// Video segments are written to out/segments/ and are resumable (finished chunks are skipped).
import { chromium } from 'playwright-core';
import fs from 'fs'; import path from 'path'; import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { startServer } from './server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TL = JSON.parse(fs.readFileSync(path.join(ROOT, 'film/timeline.json'), 'utf8'));
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const scale = parseFloat(opt('scale', cmd === 'video' ? '1' : '0.5'));
const W = Math.round(TL.width * scale), H = Math.round(TL.height * scale);
const PORT = 8700 + Math.floor(Math.random() * 200);

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = '/opt/pw-browsers';
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base).sort().reverse()) {
      const p = path.join(base, d, 'chrome-linux', 'chrome');
      if (d.startsWith('chromium-') && fs.existsSync(p)) return p;
    }
  }
  return undefined; // let playwright find its own
}

async function openPage() {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--disable-gpu-watchdog', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}]`, m.text()); });
  page.on('pageerror', e => console.log('[page exception]', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/film/index.html?scale=${scale}`);
  await page.waitForFunction(() => window.FILM && window.FILM.ready, null, { timeout: 120000 });
  return { browser, page };
}

async function stills(times, outDir, sheetName) {
  fs.mkdirSync(outDir, { recursive: true });
  const srv = await startServer(ROOT, PORT);
  const { browser, page } = await openPage();
  const files = [];
  for (const T of times) {
    const t0 = Date.now();
    await page.evaluate(async T => { await window.FILM.prepare(T, T); await window.FILM.renderTime(T); }, T);
    const data = await page.evaluate(() => window.FILM.png());
    const f = path.join(outDir, `t${T.toFixed(2).padStart(7, '0')}.png`);
    fs.writeFileSync(f, Buffer.from(data.split(',')[1], 'base64'));
    files.push(f);
    console.log(`still T=${T} -> ${path.relative(ROOT, f)} (${Date.now() - t0} ms)`);
  }
  await browser.close(); srv.close();
  if (sheetName && files.length > 1) contactSheet(files, path.join(outDir, sheetName + '.png'), times);
  return files;
}

function contactSheet(files, out, times) {
  // 3 columns, each tile 640 wide, annotated with timestamps
  const cols = Math.min(3, files.length); const rows = Math.ceil(files.length / cols);
  const inputs = files.flatMap(f => ['-i', f]);
  const tw = 640, th = Math.round(640 * TL.height / TL.width);
  let filt = files.map((_, i) => `[${i}:v]scale=${tw}:${th},drawtext=text='${times[i].toFixed(2)}s':x=8:y=8:fontsize=18:fontcolor=yellow:box=1:boxcolor=black@0.6[v${i}]`).join(';');
  const pads = files.length < rows * cols ? rows * cols - files.length : 0;
  for (let i = 0; i < pads; i++) filt += `;color=black:s=${tw}x${th}:d=1[p${i}]`;
  const labels = files.map((_, i) => `[v${i}]`).join('') + Array.from({ length: pads }, (_, i) => `[p${i}]`).join('');
  const layout = Array.from({ length: rows * cols }, (_, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|');
  filt += `;${labels}xstack=inputs=${rows * cols}:layout=${layout}`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filt, '-frames:v', '1', out]);
  console.log('contact sheet ->', path.relative(ROOT, out));
}

async function video() {
  const fps = TL.fps;
  const from = parseFloat(opt('from', '0')), to = parseFloat(opt('to', String(TL.duration)));
  const workers = parseInt(opt('workers', '2')), chunk = parseInt(opt('chunk', '240'));
  const segDir = path.join(ROOT, opt('out', 'out/segments'));
  fs.mkdirSync(segDir, { recursive: true });
  const f0 = Math.round(from * fps), f1 = Math.round(to * fps);
  // chunks aligned to a global grid so partial re-renders reuse the same segment names
  const jobs = [];
  for (let a = Math.floor(f0 / chunk) * chunk; a < f1; a += chunk) {
    const b = Math.min(a + chunk, Math.round(TL.duration * fps));
    const name = path.join(segDir, `seg_${String(a).padStart(6, '0')}.mkv`);
    if (fs.existsSync(name + '.done') && !flag('force')) continue;
    jobs.push({ a, b, name });
  }
  console.log(`${jobs.length} chunks to render with ${workers} workers at ${W}x${H}`);
  const sinks = {};
  const srv = await startServer(ROOT, PORT, async (url, body) => {
    const m = url.match(/^\/frame\/(\d+)\/(\d+)$/); if (!m) throw new Error('bad url');
    const sink = sinks[m[1]];
    if (body.length !== W * H * 4) throw new Error(`frame size ${body.length}`);
    if (!sink.stdin.write(body)) await new Promise(r => sink.stdin.once('drain', r));
  });
  const outH = Math.round(TL.outputHeight * scale), padY = Math.round((outH - H) / 2);
  const tStart = Date.now(); let framesDone = 0; const totalFrames = jobs.reduce((s, j) => s + j.b - j.a, 0);
  async function worker(id) {
    const { browser, page } = await openPage();
    while (jobs.length) {
      const job = jobs.shift();
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-',
        '-vf', `vflip,pad=${W}:${outH}:0:${padY}:black`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-tune', 'grain',
        '-pix_fmt', 'yuv420p', '-x264-params', 'keyint=48:min-keyint=24', job.name], { stdio: ['pipe', 'inherit', 'inherit'] });
      const done = new Promise((res, rej) => ff.on('exit', c => c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
      sinks[id] = ff;
      await page.evaluate(async ([a, b, fps]) => window.FILM.prepare(a / fps, (b - 1) / fps), [job.a, job.b, fps]);
      for (let f = job.a; f < job.b; f++) {
        await page.evaluate(async ([f, url]) => window.FILM.postFrame(f, url), [f, `/frame/${id}/${f}`]);
        framesDone++;
        if (framesDone % 24 === 0) {
          const el = (Date.now() - tStart) / 1000, rate = framesDone / el;
          process.stdout.write(`\r${framesDone}/${totalFrames} frames  ${rate.toFixed(2)} fps  ETA ${((totalFrames - framesDone) / rate / 60).toFixed(1)} min   `);
        }
      }
      ff.stdin.end(); await done;
      fs.writeFileSync(job.name + '.done', '');
      console.log(`\n[worker ${id}] ${path.basename(job.name)} done`);
    }
    await browser.close();
  }
  await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));
  srv.close();
  console.log(`\nall chunks done in ${((Date.now() - tStart) / 60000).toFixed(1)} min`);
}

if (cmd === 'stills') {
  const times = opt('times', '20').split(',').map(Number);
  await stills(times, path.join(ROOT, opt('out', 'out/stills')), opt('sheet', times.length > 1 ? 'sheet' : null));
} else if (cmd === 'shot') {
  const id = args[1]; const s = TL.shots.find(x => x.id === id);
  if (!s) { console.error('unknown shot', id, '\nshots:', TL.shots.map(x => x.id).join(' ')); process.exit(1); }
  const step = parseFloat(opt('step', '2')); const times = [];
  for (let t = s.start + 0.02; t < s.end; t += step) times.push(+t.toFixed(3));
  if (times[times.length - 1] < s.end - 0.5) times.push(+(s.end - 0.05).toFixed(3));
  await stills(times, path.join(ROOT, opt('out', `out/stills/${id}`)), id);
} else if (cmd === 'video') {
  await video();
} else {
  console.log('usage: node tools/render.mjs stills|shot|video ...');
}
process.exit(0);
