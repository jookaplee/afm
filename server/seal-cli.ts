// Usage: [DATASET_PASSWORD=...] npm run seal -- [dataset.json|crm.html] [out.json]
// Encrypts a prospect list so it can be published on the public GitHub Pages
// link: only the ciphertext (data/crm-dataset.sealed.json) is committed, and the
// page asks for the password before it shows any data. Without DATASET_PASSWORD
// a strong random password is generated and printed once — keep it safe; it is
// not stored anywhere.
import { readFileSync, writeFileSync } from 'node:fs';
import { config } from './config.ts';
import { parseCrmInput } from './import-crm.ts';
import { generatePassword, sealDataset } from '../shared/dataset-crypto.ts';

const SEALED_PATH = 'data/crm-dataset.sealed.json';

const input = process.argv[2] ?? config.datasetPath;
const out = process.argv[3] ?? SEALED_PATH;
const dataset = parseCrmInput(readFileSync(input, 'utf8'));
const given = process.env.DATASET_PASSWORD;
const password = given || generatePassword();
const sealed = await sealDataset(JSON.stringify(dataset), password);
writeFileSync(out, `${JSON.stringify(sealed)}\n`);
console.log(`Sealed ${dataset.leads.length} records from ${input} into ${out}`);
if (!given) console.log(`Password (shown once, keep it safe): ${password}`);
