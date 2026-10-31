import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RoomService, RoomError } from './rooms.mjs';

const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });res.end(JSON.stringify(body)); };
function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new RoomError(415, 'Ожидается JSON.');
  return new Promise((resolve, reject) => {
    const chunks = [];let length = 0, failed = false;
    req.on('data', chunk => {
      length += chunk.length;
      if (length > 4096) { if (!failed) reject(new RoomError(413, 'Слишком большой запрос.'));failed = true;return; }
      if (!failed) chunks.push(chunk);
    });
    req.on('end', () => { if (!failed) { try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();resolve(parsed); } catch { reject(new RoomError(400, 'Некорректный JSON.')); } } });
    req.on('error', reject);
  });
}
export function createGameServer({ rooms = new RoomService() } = {}) {
  const heartbeat = new Set();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (req.headers.origin) {
          let origin;
          try { origin = new URL(req.headers.origin); } catch { throw new RoomError(403, 'Недопустимый источник запроса.'); }
          if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) throw new RoomError(403, 'Недопустимый источник запроса.');
        }
        if (req.method === 'POST' && url.pathname === '/api/rooms') return json(res, 201, rooms.create((await body(req)).name));
        const match = /^\/api\/rooms\/([A-Z2-9]{6})\/(join|action|events|state)$/.exec(url.pathname);
        if (!match) throw new RoomError(404, 'Запрос не найден.');
        const [, code, operation] = match;
        if (req.method === 'GET' && operation === 'state') {
          const { room, player } = rooms.authenticate(code,url.searchParams.get('token'));
          return json(res,200,rooms.view(room,player));
        }
        if (req.method === 'POST' && operation === 'join') return json(res, 200, rooms.join(code, (await body(req)).name));
        if (req.method === 'POST' && operation === 'action') {
          const command = await body(req);return json(res, 200, rooms.act(code, command.token, command));
        }
        if (req.method === 'GET' && operation === 'events') {
          rooms.authenticate(code, url.searchParams.get('token'));
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });res.flushHeaders();
          const disconnect = rooms.connect(code, url.searchParams.get('token'), snapshot => res.write(`data: ${JSON.stringify(snapshot)}\n\n`), () => res.end());
          const ping = setInterval(() => res.write(': keepalive\n\n'), 15000);ping.unref();heartbeat.add(ping);
          res.on('close', () => { clearInterval(ping);heartbeat.delete(ping);disconnect(); });return;
        }
        throw new RoomError(405, 'Метод не поддерживается.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new RoomError(405, 'Метод не поддерживается.');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new RoomError(400, 'Некорректный адрес.'); }
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) throw new RoomError(403, 'Нет доступа.');
      let data;
      try { data = await readFile(file); } catch { throw new RoomError(404, 'Файл не найден.'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Ошибка сервера. Попробуйте ещё раз.' });
      else res.end();
    }
  });
  const clock = setInterval(() => rooms.tick(), 100);clock.unref();
  server.on('close', () => { clearInterval(clock);for (const ping of heartbeat) clearInterval(ping);rooms.shutdown(); });
  server.rooms = rooms;return server;
}
