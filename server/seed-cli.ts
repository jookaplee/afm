// Usage: npm run seed  (re-generates the demo database, anchored to today)
import { openDb } from './db.ts';
import { seed } from './seed.ts';
import { config } from './config.ts';
import { todayLocal } from '../shared/dates.ts';

const db = openDb(config.dbPath);
const today = config.today ?? todayLocal();
const t0 = performance.now();
const summary = seed(db, { today });
console.log(`Seeded ${config.dbPath} (anchor ${today}) in ${Math.round(performance.now() - t0)} ms`);
console.table(summary);
db.close();
