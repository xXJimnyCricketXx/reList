// Prüft Login und Abruf ohne Server: node --env-file=.env src/check.js
import {RebuyClient} from './rebuy.js';
import {normalize} from './wishlist.js';

try {
  const client = new RebuyClient({email: process.env.REBUY_EMAIL, password: process.env.REBUY_PASSWORD});
  await client.login();
  console.log('Login ok');

  const items = (await client.fetchWishlist()).map(normalize).filter(Boolean);
  const groups = Object.groupBy(items, i => i.platform || i.group);
  console.log(`${items.length} Artikel, davon ${items.filter(i => i.inStock).length} lieferbar`);
  for (const [name, list] of Object.entries(groups)) console.log(`  ${name}: ${list.length}`);
  console.log('Beispiel:', JSON.stringify(items[0], null, 2));
} catch (err) {
  console.error(`Fehler: ${err.message}`);
  process.exit(1);
}
