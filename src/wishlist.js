// Umwandeln der rebuy-Rohdaten, Abgleich mit dem letzten Stand und Speicherung.
import fs from 'node:fs';
import path from 'node:path';

// rebuy zeigt nur diese Zustände an; A4 hat zwar einen Preis, ist im Shop aber nicht wählbar.
const GRADES = {NEW: 'Neu', A1: 'Exzellent', A2: 'Sehr gut', A3: 'Gut'};
const HISTORY_KEEP = 10;
const SHRINK_LIMIT = 0.7;

const slug = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');

export function normalize(doc) {
  const id = Number(doc?.id);
  const title = String(doc?.name ?? '').trim();
  if (!Number.isInteger(id) || id <= 0 || !title) return null;

  const variants = (doc.variants ?? [])
    .filter(v => v.label in GRADES && v.price > 0)
    .map(v => ({grade: v.label, label: GRADES[v.label], price: v.price, quantity: Math.max(0, v.quantity | 0)}));
  const available = variants.filter(v => v.quantity > 0);
  const image = doc.thumbs_cover_urls?.['350x350'] ?? '';
  const isBook = doc.root_category_name === 'Bücher';

  return {
    id,
    title,
    group: String(doc.root_category_name ?? ''),
    platform: isBook ? '' : String(doc.category_name ?? ''),
    authors: Array.isArray(doc.authors) ? doc.authors.map(String) : [],
    format: String(doc.book_format ?? ''),
    releaseDate: doc.street_date ?? null,
    url: `https://www.rebuy.de/i,${id}/${slug(doc.category_sanitized_name)}/${slug(doc.product_sanitized_name)}`,
    image: image.startsWith('https://images.rebuy.com/') ? image : '',
    variants,
    inStock: available.length > 0,
    price: available.length ? Math.min(...available.map(v => v.price)) : null,
  };
}

export class WishlistStore {
  #pendingShrink = null;

  constructor(dataDir) {
    this.file = path.join(dataDir, 'wishlist.json');
    this.historyDir = path.join(dataDir, 'history');
    fs.mkdirSync(this.historyDir, {recursive: true});
    this.data = this.#load();
  }

  // Übernimmt einen frischen Abruf. Gibt {added, removed} zurück.
  update(docs) {
    const items = docs.map(normalize).filter(Boolean);
    const previous = this.data.items;
    if (!items.length && previous.length) throw new Error('rebuy liefert eine leere Liste – letzter Stand bleibt erhalten');

    // Starker Schwund wird erst übernommen, wenn zwei Abrufe hintereinander dasselbe Ergebnis liefern.
    const signature = items.map(i => i.id).sort().join(',');
    if (previous.length >= 10 && items.length < previous.length * SHRINK_LIMIT && this.#pendingShrink !== signature) {
      this.#pendingShrink = signature;
      throw new Error(`Nur noch ${items.length} statt ${previous.length} Artikel – wird erst nach Bestätigung durch den nächsten Abruf übernommen`);
    }
    this.#pendingShrink = null;

    const now = new Date().toISOString();
    const known = new Map(previous.map(i => [i.id, i]));
    const firstImport = previous.length === 0;
    items.forEach((item, position) => {
      item.position = position;
      // Beim Erstimport ist das Hinzufügedatum unbekannt (null) und muss das bei späteren Abrufen bleiben.
      if (known.has(item.id)) item.addedAt = known.get(item.id).addedAt;
      else item.addedAt = firstImport ? null : now;
    });

    const ids = new Set(items.map(i => i.id));
    const added = items.filter(i => !known.has(i.id)).length;
    const removed = previous.filter(i => !ids.has(i.id)).length;

    this.data = {updatedAt: now, items};
    this.#write(this.file, this.data);
    if (added || removed || firstImport) this.#snapshot(now);
    return {added, removed};
  }

  #load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(data.items)) return data;
    } catch {
      // Noch kein Abruf erfolgt.
    }
    return {updatedAt: null, items: []};
  }

  #snapshot(timestamp) {
    this.#write(path.join(this.historyDir, `${timestamp.replace(/[:.]/g, '-')}.json`), this.data);
    const files = fs.readdirSync(this.historyDir).filter(f => f.endsWith('.json')).sort();
    for (const old of files.slice(0, -HISTORY_KEEP)) fs.rmSync(path.join(this.historyDir, old));
  }

  #write(file, data) {
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data));
    fs.renameSync(temp, file);
  }
}
