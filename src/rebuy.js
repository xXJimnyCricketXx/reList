// Zugriff auf die interne rebuy-API: Login, Session-Cookies, Abruf aller Wunschlisten-Seiten.
import fs from 'node:fs';

const BASE = 'https://www.rebuy.de';
const MAX_PAGES = 100;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  'Accept-Language': 'de-DE,de;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
};

export class LoginError extends Error {}
class AuthExpired extends Error {}

export class RebuyClient {
  #cookies = new Map();

  constructor({email, password, sessionFile = null}) {
    this.email = email;
    this.password = password;
    this.sessionFile = sessionFile;
    this.#loadSession();
  }

  // Holt alle Seiten der Wunschliste. Bei abgelaufener Session wird genau einmal neu eingeloggt.
  async fetchWishlist() {
    if (!this.#cookies.has('rde_session')) await this.login();
    try {
      return await this.#fetchAllPages();
    } catch (err) {
      if (!(err instanceof AuthExpired)) throw err;
      await this.login();
      return await this.#fetchAllPages();
    }
  }

  async login() {
    if (!this.email || !this.password) throw new LoginError('REBUY_EMAIL und REBUY_PASSWORD sind nicht gesetzt');
    this.#cookies.clear();
    // Die Login-Seite setzt das Session-Cookie, an das sich der Login hängt.
    await this.#request('/auth', {headers: {Accept: 'text/html'}});
    const res = await this.#request('/api/login', {
      method: 'POST',
      headers: {Accept: 'application/json', 'Content-Type': 'application/json', Origin: BASE, Referer: `${BASE}/auth`},
      body: JSON.stringify({username: this.email, password: this.password}),
    });
    if (!res.ok) {
      const message = await res.json().then(j => j.message).catch(() => '');
      throw new LoginError(`rebuy-Login fehlgeschlagen (HTTP ${res.status})${message ? `: ${message}` : ''}`);
    }
    this.#saveSession();
  }

  async #fetchAllPages() {
    const docs = new Map();
    let total = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.#request(`/api/wishlist-view?page=${page}`, {headers: {Accept: 'application/json'}});
      if ([401, 403, 412].includes(res.status) || (res.status >= 300 && res.status < 400)) throw new AuthExpired();
      if (!res.ok) throw new Error(`rebuy antwortet auf Seite ${page} mit HTTP ${res.status}`);

      const products = (await res.json())?.searchResponse?.products;
      if (!products || !Array.isArray(products.docs)) throw new Error(`Unerwartetes Antwortformat auf Seite ${page}`);
      total ??= products.numFound;
      for (const doc of products.docs) docs.set(doc.id, doc);
      if (!products.docs.length || docs.size >= total) break;
    }
    this.#saveSession();
    if (docs.size !== total) throw new Error(`Unvollständiger Abruf: ${docs.size} von ${total} Artikeln`);
    return [...docs.values()];
  }

  async #request(path, {headers = {}, ...options} = {}) {
    const res = await fetch(BASE + path, {
      ...options,
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: {...HEADERS, ...headers, Cookie: this.#cookieHeader()},
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = value === 'deleted' || attrs.some(a => /^\s*max-age=0\s*$/i.test(a));
      if (expired) this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
    return res;
  }

  #cookieHeader() {
    return [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  #loadSession() {
    if (!this.sessionFile) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
      if (saved.email === this.email) this.#cookies = new Map(Object.entries(saved.cookies));
    } catch {
      // Keine oder kaputte Session-Datei: beim nächsten Abruf wird neu eingeloggt.
    }
  }

  #saveSession() {
    if (!this.sessionFile) return;
    const data = JSON.stringify({email: this.email, savedAt: new Date().toISOString(), cookies: Object.fromEntries(this.#cookies)});
    fs.writeFileSync(this.sessionFile, data, {mode: 0o600});
  }
}
