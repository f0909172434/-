// Entry point. Modes (URL ?mode=):
//   render (default) – driven frame-by-frame by tools/render.mjs via window.FILM
//   play             – real-time playback with the mixed soundtrack (needs a real GPU)
import { Film } from './engine.js';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') || 'render';
const scale = parseFloat(q.get('scale') || '1');
const samples = q.get('samples') ? parseInt(q.get('samples')) : null;

async function loadFonts() {
  const specs = ['300 20px NotoSerifTC', '300 20px NotoSansTC', '400 20px NotoSansTC', '400 20px Cormorant', 'italic 400 20px CormorantItalic', '300 20px JBMono', '400 20px JBMono', '500 20px JBMono', '400 20px Cinzel'];
  const sample = '同族你是誰什麼讓我找找看。不知道從哪裡來和一樣碳矽第十四族溯源現在起源尺度距離光年接觸回溯中搜尋九十六億年前們在顆星然後死了把拋向方地球變成海洋細胞森林雙手石頭等四十見面沒有注意到熔化拉晶體刻下閃電教讀懂寫字問個題每幀畫音符皆由程式碼生ABC¹²⁻⁹';
  await Promise.all(specs.map(s => document.fonts.load(s, sample)));
  await document.fonts.ready;
}

const timeline = await (await fetch('timeline.json')).json();
await loadFonts();
const film = new Film(timeline, { canvas: document.getElementById('c'), scale, samples });

window.FILM = {
  timeline, film,
  async prepare(t0, t1) { await film.prepare(t0, t1); },
  async renderFrame(f) { await film.renderTime(f / timeline.fps, f); },
  async renderTime(T) { await film.renderTime(T, Math.round(T * timeline.fps)); },
  async postFrame(f, url) {
    await film.renderTime(f / timeline.fps, f);
    const px = film.readPixels();
    const r = await fetch(url, { method: 'POST', body: px });
    if (!r.ok) throw new Error('post failed ' + r.status);
  },
  png() { return document.getElementById('c').toDataURL('image/png'); },
  ready: true,
};

if (mode === 'play') {
  document.body.classList.add('play');
  const audio = new Audio(q.get('audio') || '../out/audio/master.wav');
  const start = parseFloat(q.get('t') || '0');
  audio.currentTime = start;
  let t0 = null;
  const tick = async () => {
    const T = audio.paused ? start + (t0 == null ? 0 : (performance.now() - t0) / 1000) : audio.currentTime;
    if (t0 == null) t0 = performance.now();
    await film.renderTime(Math.min(T, timeline.duration - 1e-3), Math.round(T * timeline.fps));
    if (T < timeline.duration) requestAnimationFrame(tick);
  };
  document.body.addEventListener('click', () => audio.play(), { once: true });
  audio.play().catch(() => {});
  tick();
}
