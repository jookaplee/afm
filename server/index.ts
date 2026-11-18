import { resolve } from 'node:path';
import { config } from './config.ts';
import { isEmpty, openDb } from './db.ts';
import { seed } from './seed.ts';
import { todayLocal } from '../shared/dates.ts';
import { createApp } from './app.ts';

const today = () => config.today ?? todayLocal();
const db = openDb(config.dbPath);

if (isEmpty(db)) {
  const summary = seed(db, { today: today() });
  console.log(`Database was empty - generated demo data:`, summary);
}

const app = createApp({
  db,
  today,
  appName: config.appName,
  allowReset: config.allowReset,
  staticDir: process.env.NODE_ENV === 'production' ? resolve(config.root, 'dist') : undefined,
});

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
