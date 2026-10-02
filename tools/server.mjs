// Tiny static file server rooted at the repo, plus a hook for raw frame uploads.
import http from 'http'; import fs from 'fs'; import path from 'path';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.png': 'image/png', '.mp3': 'audio/mpeg' };
export function startServer(root, port, onPost) {
  return new Promise(res => {
    const srv = http.createServer(async (q, s) => {
      const url = decodeURIComponent(q.url.split('?')[0]);
      if (q.method === 'POST' && onPost) {
        const chunks = []; for await (const c of q) chunks.push(c);
        try { await onPost(url, Buffer.concat(chunks)); s.statusCode = 200; s.end('ok'); }
        catch (e) { console.error(e); s.statusCode = 500; s.end(String(e)); }
        return;
      }
      const f = path.join(root, url);
      if (!f.startsWith(root)) { s.statusCode = 403; return s.end(); }
      fs.stat(f, (err, st) => {
        if (err || !st.isFile()) { s.statusCode = 404; return s.end('not found'); }
        s.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
        s.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(f).pipe(s);
      });
    });
    srv.listen(port, '127.0.0.1', () => res(srv));
  });
}
