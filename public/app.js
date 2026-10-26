const $ = id => document.getElementById(id);
const NEW_DAYS = 14;
const euro = new Intl.NumberFormat('de-DE', {style: 'currency', currency: 'EUR'});
const collator = new Intl.Collator('de');

const state = {items: [], updatedAt: null, group: ''};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function isNew(item) {
  return item.addedAt && Date.now() - Date.parse(item.addedAt) < NEW_DAYS * 86_400_000;
}

function subtitle(item) {
  if (item.platform) return item.platform;
  return [item.authors.join(', '), item.format].filter(Boolean).join(' · ') || item.group;
}

function relativeTime(iso) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  if (minutes < 24 * 60) return `vor ${Math.round(minutes / 60)} Std.`;
  return new Date(iso).toLocaleString('de-DE', {dateStyle: 'medium', timeStyle: 'short'});
}

const SORTS = {
  added: (a, b) => (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0) || a.position - b.position,
  'price-asc': (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  'price-desc': (a, b) => (b.price ?? -1) - (a.price ?? -1),
  title: (a, b) => collator.compare(a.title, b.title),
  platform: (a, b) => collator.compare(subtitle(a), subtitle(b)) || collator.compare(a.title, b.title),
};

function card(item) {
  const node = el('article', item.inStock ? 'card' : 'card out');
  if (isNew(item)) node.append(el('span', 'badge', 'neu'));

  const cover = el('div', 'cover');
  if (item.image) {
    const img = el('img');
    img.src = item.image;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove());
    cover.append(img);
  }
  node.append(cover, el('div', 'title', item.title), el('div', 'sub', subtitle(item)));

  const stock = item.variants.reduce((sum, v) => sum + v.quantity, 0);
  node.append(el('div', stock ? 'stock' : 'stock none', stock ? `lieferbar ab ${euro.format(item.price / 100)}` : 'derzeit ausverkauft'));

  const list = el('ul', 'variants');
  for (const v of item.variants) {
    const li = el('li', v.quantity ? '' : 'off');
    li.append(el('span', '', v.label), el('span', 'p', euro.format(v.price / 100)));
    li.title = v.quantity ? `${v.quantity} verfügbar` : 'ausverkauft';
    list.append(li);
  }
  node.append(list);

  const link = el('a', 'link', 'Bei rebuy ansehen');
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  node.append(link);
  return node;
}

function render() {
  const query = $('search').value.trim().toLocaleLowerCase('de');
  const platform = $('platform').value;
  const onlyInStock = $('instock').checked;

  const shown = state.items
    .filter(i => !state.group || i.group === state.group)
    .filter(i => !platform || i.platform === platform)
    .filter(i => !onlyInStock || i.inStock)
    .filter(i => !query || `${i.title} ${subtitle(i)}`.toLocaleLowerCase('de').includes(query))
    .sort(SORTS[$('sort').value]);

  $('count').textContent = shown.length === state.items.length ? `${shown.length} Artikel` : `${shown.length} von ${state.items.length} Artikeln`;
  $('cards').replaceChildren(...(shown.length ? shown.map(card) : [el('p', 'empty', 'Keine passenden Artikel.')]));
}

function fillFilters() {
  const groups = ['', ...new Set(state.items.map(i => i.group).filter(Boolean))].sort(collator.compare);
  $('groups').replaceChildren(...groups.map(g => {
    const chip = el('button', 'chip', g || 'Alle');
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(g === state.group));
    chip.addEventListener('click', () => { state.group = g; fillFilters(); render(); });
    return chip;
  }));

  const select = $('platform');
  const current = select.value;
  const platforms = [...new Set(state.items.filter(i => !state.group || i.group === state.group).map(i => i.platform).filter(Boolean))].sort(collator.compare);
  select.replaceChildren(el('option', '', 'Alle Plattformen'), ...platforms.map(p => el('option', '', p)));
  select.options[0].value = '';
  select.value = platforms.includes(current) ? current : '';
  select.hidden = platforms.length === 0;
}

function showStatus(data) {
  if (data.owner) {
    $('heading').textContent = `Wunschliste von ${data.owner}`;
    document.title = `Wunschliste von ${data.owner}`;
  }
  $('total').textContent = data.items.length ? `(${data.items.length})` : '';
  $('updated').textContent = data.updatedAt ? `Stand: ${relativeTime(data.updatedAt)}` : 'Noch kein Abgleich mit rebuy';
  $('error').hidden = !data.error;
  $('error').textContent = data.error ? `Aktualisierung fehlgeschlagen: ${data.error}. Angezeigt wird der letzte Stand.` : '';
}

async function load(method = 'GET') {
  const button = $('refresh');
  button.disabled = true;
  button.textContent = 'Aktualisiere …';
  try {
    const res = await fetch(method === 'POST' ? '/api/refresh' : '/api/wishlist', {method, cache: 'no-store'});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.items = data.items;
    state.updatedAt = data.updatedAt;
    showStatus(data);
    fillFilters();
    render();
  } catch (err) {
    showStatus({items: state.items, updatedAt: state.updatedAt, error: `Server nicht erreichbar (${err.message})`});
  } finally {
    button.disabled = false;
    button.textContent = 'Aktualisieren';
  }
}

for (const id of ['search', 'platform', 'sort', 'instock']) $(id).addEventListener('input', render);
$('refresh').addEventListener('click', () => load('POST'));
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
load();
