// Password protection for a prospect list published on a public page.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportKey,
  generatePassword,
  importKey,
  isSealedDataset,
  keyForPassword,
  normalizePassword,
  openDataset,
  sealDataset,
} from '../../shared/dataset-crypto.ts';

const TEXT = JSON.stringify({ leads: [{ name: 'Contoh Grill', phone: '012-3456789' }] });
const ITER = 1000; // fast for tests; real data uses the default

describe('dataset encryption', () => {
  it('opens with the right password and keeps no plaintext', async () => {
    const sealed = await sealDataset(TEXT, 'abcd-efgh-jkmn-pqrs', ITER);
    assert.ok(isSealedDataset(sealed));
    assert.equal(sealed.iter, ITER);
    assert.ok(!JSON.stringify(sealed).includes('Contoh'));
    assert.equal(await openDataset(sealed, await keyForPassword(sealed, 'abcd-efgh-jkmn-pqrs')), TEXT);
  });

  it('ignores case, spaces and dashes in the password', async () => {
    const sealed = await sealDataset(TEXT, 'abcd-efgh-jkmn-pqrs', ITER);
    assert.equal(normalizePassword(' ABCD efgh-JKMN pqrs '), 'abcdefghjkmnpqrs');
    assert.equal(await openDataset(sealed, await keyForPassword(sealed, 'ABCD EFGH JKMN PQRS')), TEXT);
  });

  it('rejects a wrong password and tampered data', async () => {
    const sealed = await sealDataset(TEXT, 'abcd-efgh-jkmn-pqrs', ITER);
    await assert.rejects(async () => openDataset(sealed, await keyForPassword(sealed, 'abcd-efgh-jkmn-pqrt')));
    const ct = Buffer.from(sealed.ct, 'base64');
    ct[0] ^= 1;
    const tampered = { ...sealed, ct: ct.toString('base64') };
    await assert.rejects(async () => openDataset(tampered, await keyForPassword(sealed, 'abcd-efgh-jkmn-pqrs')));
  });

  it('a remembered key opens the data without the password', async () => {
    const sealed = await sealDataset(TEXT, 'abcd-efgh-jkmn-pqrs', ITER);
    const saved = await exportKey(await keyForPassword(sealed, 'abcd-efgh-jkmn-pqrs'));
    assert.equal(await openDataset(sealed, await importKey(saved)), TEXT);
  });

  it('every seal uses a fresh salt and IV', async () => {
    const a = await sealDataset(TEXT, 'abcd-efgh-jkmn-pqrs', ITER);
    const b = await sealDataset(TEXT, 'abcd-efgh-jkmn-pqrs', ITER);
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ct, b.ct);
  });

  it('refuses short passwords and generates strong ones', async () => {
    await assert.rejects(() => sealDataset(TEXT, 'short', ITER), /password_too_short/);
    const p = generatePassword();
    assert.match(p, /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    assert.ok(!/[01ilo]/.test(p));
    assert.notEqual(generatePassword(), p);
  });
});
