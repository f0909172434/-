// Deliverables from out/oracle_master.mp4 (two-pass x264, sized to a target file size):
//   node tools/encode.mjs github    -> release/oracle_1080p.mp4   1920x1080, under 100 MB (GitHub's file limit)
//   node tools/encode.mjs preview   -> out/oracle_preview.mp4     960x540, ~20 MB (small enough to send in a chat)
//   node tools/encode.mjs hq        -> out/oracle_hq.mp4          1920x1080, CRF 16 (local archive)
// Options: --in <file> (default out/oracle_master.mp4), --mb <target size in MB>.
import fs from 'fs'; import path from 'path'; import { execFileSync } from 'child_process'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), preset = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const input = path.resolve(ROOT, opt('in', 'out/oracle_master.mp4'));
const P = {
  github: { out: 'release/oracle_1080p.mp4', mb: 92, scale: null, abr: 192 },
  preview: { out: 'out/oracle_preview.mp4', mb: 19.5, scale: '960:540', abr: 96 },
  hq: { out: 'out/oracle_hq.mp4', crf: 16, scale: null, abr: 320 },
}[preset];
if (!P) { console.log('usage: node tools/encode.mjs github|preview|hq [--in file] [--mb N]'); process.exit(1); }
const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input]).toString());
const out = path.join(ROOT, P.out);
fs.mkdirSync(path.dirname(out), { recursive: true });
const vf = P.scale ? ['-vf', `scale=${P.scale}:flags=lanczos`] : [];
const common = ['-c:v', 'libx264', '-preset', 'slow', '-tune', 'film', '-pix_fmt', 'yuv420p', '-x264-params', 'keyint=48:min-keyint=24', ...vf];
const run = a => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, ...a], { stdio: 'inherit', cwd: path.join(ROOT, 'out') });
if (P.crf) {
  run([...common, '-crf', String(P.crf), '-c:a', 'aac', '-b:a', `${P.abr}k`, '-movflags', '+faststart', out]);
} else {
  const mb = parseFloat(opt('mb', P.mb));
  const vk = Math.floor(mb * 8 * 1024 / dur - P.abr);           // kbit/s for video
  console.log(`${preset}: ${dur.toFixed(1)} s, target ${mb} MB -> video ${vk} kbps + audio ${P.abr} kbps`);
  const log = path.join(ROOT, 'out', `x264_${preset}`);
  run([...common, '-b:v', `${vk}k`, '-pass', '1', '-passlogfile', log, '-an', '-f', 'mp4', '/dev/null']);
  run([...common, '-b:v', `${vk}k`, '-pass', '2', '-passlogfile', log, '-c:a', 'aac', '-b:a', `${P.abr}k`, '-movflags', '+faststart', out]);
}
console.log('->', path.relative(ROOT, out), (fs.statSync(out).size / 1048576).toFixed(1), 'MB');
