// Usage: npm run import -- <file.html|file.json>
// Clears the database and starts again from a prospect list (the CRM's HTML
// export or its JSON). The dataset is also kept in data/import/ so that
// "Reset data" and a fresh database start from it again.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb } from './db.ts';
import { config } from './config.ts';
import { todayLocal } from '../shared/dates.ts';
import { importCrm, parseCrmInput } from './import-crm.ts';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run import -- <file.html|file.json>');
  process.exit(1);
}
const dataset = parseCrmInput(readFileSync(file, 'utf8'));
mkdirSync(dirname(config.datasetPath), { recursive: true });
writeFileSync(config.datasetPath, JSON.stringify(dataset));

const db = openDb(config.dbPath);
const summary = importCrm(db, dataset, { today: config.today ?? todayLocal() });
db.close();
console.log(`Imported ${file} into ${config.dbPath}`);
console.table(summary);
console.log(`Dataset kept at ${config.datasetPath}`);
