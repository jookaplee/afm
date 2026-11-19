import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  port: Number(process.env.PORT ?? 3001),
  dbPath: process.env.DB_PATH ?? resolve(root, 'data', 'afm.db'),
  /** Imported prospect list (see `npm run import`); used as the starting data when present. */
  datasetPath: process.env.DATASET_PATH ?? resolve(root, 'data', 'import', 'crm-dataset.json'),
  appName: process.env.APP_NAME ?? 'JOOSONS',
  /** Override "today" (YYYY-MM-DD) for reproducible demos and tests. */
  today: process.env.TODAY,
  /** Allow POST /api/admin/reset (re-generates demo data). Disabled in production unless set. */
  allowReset: process.env.ALLOW_RESET ? process.env.ALLOW_RESET === 'true' : process.env.NODE_ENV !== 'production',
};
