import { resolve } from 'node:path';
import { config } from './config.ts';
import { isEmpty, openDb } from './db.ts';
import { existsSync, readFileSync } from 'node:fs';
import { seed } from './seed.ts';
import { importCrm, parseCrmInput } from './import-crm.ts';
import { todayLocal } from '../shared/dates.ts';
import { createApp } from './app.ts';
import { createServerAgent } from './agent-runner.ts';

const today = () => config.today ?? todayLocal();
const db = openDb(config.dbPath);

/** Starting data: the imported prospect list when present, else demo data. */
const resetBase = () => {
  if (existsSync(config.datasetPath)) {
    return importCrm(db, parseCrmInput(readFileSync(config.datasetPath, 'utf8')), { today: today() });
  }
  return seed(db, { today: today() });
};

if (isEmpty(db)) {
  const summary = resetBase();
  console.log(`Database was empty - loaded starting data:`, summary);
}

const agentRunner = config.agent ? createServerAgent({ db, today }) : undefined;

const app = createApp({
  db,
  today,
  appName: config.appName,
  allowReset: config.allowReset,
  resetBase,
  agentRunner,
  staticDir: process.env.NODE_ENV === 'production' ? resolve(config.root, 'dist') : undefined,
});

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
  agentRunner?.startAutopilot();
});

const shutdown = () => {
  agentRunner?.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
