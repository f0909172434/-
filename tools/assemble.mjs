// Final edit: concatenate rendered segments in order, mux the mastered soundtrack, write out/the-long-way-home.mp4
import fs from 'fs'; import path from 'path'; import { execFileSync } from 'child_process'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TL = JSON.parse(fs.readFileSync(path.join(ROOT, 'film/timeline.json'), 'utf8'));
const segDir = path.join(ROOT, 'out/segments');
const segs = fs.readdirSync(segDir).filter(f => f.endsWith('.mkv') && fs.existsSync(path.join(segDir, f + '.done'))).sort();
const expected = Math.ceil(TL.duration * TL.fps / 240);
if (segs.length < expected) console.warn(`warning: ${segs.length}/${expected} segments present`);
const list = path.join(segDir, 'list.txt');
fs.writeFileSync(list, segs.map(f => `file '${path.join(segDir, f)}'`).join('\n'));
const audio = path.join(ROOT, 'out/audio/master.wav');
const out = path.join(ROOT, 'out/the-long-way-home.mp4');
const a = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
if (fs.existsSync(audio)) a.push('-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '320k', '-shortest');
a.push('-c:v', 'copy', '-movflags', '+faststart', '-metadata', `title=${TL.title.zh} ${TL.title.en}`, out);
execFileSync('ffmpeg', a, { stdio: 'inherit' });
console.log('->', path.relative(ROOT, out));
