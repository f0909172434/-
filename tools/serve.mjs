// Serve the repo for live playback in a desktop browser: http://localhost:8080/film/index.html?mode=play
import path from 'path'; import { fileURLToPath } from 'url';
import { startServer } from './server.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = +(process.env.PORT || 8080);
await startServer(root, port);
console.log(`http://localhost:${port}/film/index.html?mode=play   (add &t=60 to start at 1:00, &scale=0.5 for speed)`);
