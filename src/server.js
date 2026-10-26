import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RebuyClient, LoginError} from './rebuy.js';
import {WishlistStore} from './wishlist.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 18006);
const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data');
const STALE_MS = Number(process.env.STALE_MINUTES || 5) * 60_000;
const INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_HOURS || 6) * 3_600_000;
const MIN_GAP_MS = 60_000;
const LOGIN_BACKOFF_MS = 30 * 60_000;
const WAIT_FOR_REFRESH_MS = 15_000;
const OWNER_NAME = (process.env.OWNER_NAME || '').trim();

fs.mkdirSync(DATA_DIR, {recursive: true});
const store = new WishlistStore(DATA_DIR);
const client = new RebuyClient({
  email: process.env.REBUY_EMAIL,
  password: process.env.REBUY_PASSWORD,
  sessionFile: path.join(DATA_DIR, 'session.json'),
});

const status = {lastAttempt: 0, lastError: null, blockedUntil: 0, running: null};

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

// Startet einen Abgleich, sofern keiner läuft und die Sperrzeiten es erlauben.
function refresh() {
  if (status.running) return status.running;
  const now = Date.now();
  if (now - status.lastAttempt < MIN_GAP_MS || now < status.blockedUntil) return Promise.resolve();

  status.lastAttempt = now;
  status.running = client.fetchWishlist()
    .then(docs => {
      const {added, removed} = store.update(docs);
      status.lastError = null;
      log(`Abgleich ok: ${store.data.items.length} Artikel (+${added} / -${removed})`);
    })
    .catch(err => {
      // Nach einem gescheiterten Login lange warten, damit das Konto nicht gesperrt wird.
      if (err instanceof LoginError) status.blockedUntil = Date.now() + LOGIN_BACKOFF_MS;
      status.lastError = err.message;
      log(`Abgleich fehlgeschlagen: ${err.message}`);
    })
    .finally(() => { status.running = null; });
  return status.running;
}

const isStale = () => !store.data.updatedAt || Date.now() - Date.parse(store.data.updatedAt) > STALE_MS;

async function refreshAndWait() {
  const timeout = new Promise(resolve => setTimeout(resolve, WAIT_FOR_REFRESH_MS));
  await Promise.race([refresh(), timeout]);
}

function payload() {
  return {...store.data, owner: OWNER_NAME, error: status.lastError, refreshing: Boolean(status.running)};
}

function sendJson(res, code, body) {
  res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(body));
}

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' https://images.rebuy.com; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

const server = http.createServer(async (req, res) => {
  const {pathname} = new URL(req.url || '/', 'http://localhost');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

  try {
    if (req.method === 'GET' && pathname === '/api/wishlist') {
      if (isStale()) await refreshAndWait();
      return sendJson(res, 200, payload());
    }
    if (req.method === 'POST' && pathname === '/api/refresh') {
      await refreshAndWait();
      return sendJson(res, 200, payload());
    }
    if (req.method === 'GET' && pathname === '/healthz') {
      return sendJson(res, 200, {ok: true, updatedAt: store.data.updatedAt, items: store.data.items.length, error: status.lastError});
    }
    const file = req.method === 'GET' && STATIC[pathname];
    if (file) {
      res.writeHead(200, {'Content-Type': file[1], 'Cache-Control': 'no-cache'});
      return fs.createReadStream(path.join(root, 'public', file[0])).pipe(res);
    }
    sendJson(res, 404, {error: 'Nicht gefunden'});
  } catch (err) {
    log(`Fehler bei ${req.method} ${pathname}: ${err.message}`);
    sendJson(res, 500, {error: 'Interner Fehler'});
  }
});

server.listen(PORT, () => {
  log(`Wunschliste läuft auf Port ${PORT}`);
  refresh();
  setInterval(refresh, INTERVAL_MS).unref();
});

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
