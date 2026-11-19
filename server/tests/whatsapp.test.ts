// WhatsApp outreach: number classification, templates, recording messages and
// lead updates (synthetic data only).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.ts';
import { importCrm } from '../import-crm.ts';
import { createRouter } from '../routes.ts';
import { fillTemplate, missingPlaceholders, phoneInfo, waUrl } from '../../shared/whatsapp.ts';
import type { Paged, WaContact, WaMessageRow, WaSummary, WaTemplate } from '../../shared/types.ts';

const TODAY = '2026-11-19';
const AT = `${TODAY}T09:30:00.000Z`;
const rec = (name: string, phone: string, over: Record<string, unknown> = {}) => ({
  category: 'restoran_halal_western',
  name,
  owner: `PIC ${name}`,
  phone,
  salesValue: 100_000,
  primaryRegion: 'Johor',
  ...over,
});

function setup() {
  const db = openDb(':memory:');
  importCrm(
    db,
    {
      leads: [
        rec('Mobile Grill', '012-345 6789', { salesValue: 2_000_000 }),
        rec('Landline Cafe', '03-2201 9055'),
        rec('Broken Number', '12345'),
        rec('Shared One', '+60 17-111 2222'),
        rec('Shared Two', '017-1112222'),
      ],
    },
    { today: TODAY },
  );
  const { handle } = createRouter({ db, today: () => TODAY });
  const call = <T,>(method: string, path: string, body?: unknown, query: Record<string, unknown> = {}) => {
    const r = handle(method, path, query, body);
    return { status: r.status, body: r.body as T };
  };
  const ok = <T,>(method: string, path: string, body?: unknown, query: Record<string, unknown> = {}) => {
    const r = call<T>(method, path, body, query);
    assert.ok(r.status < 400, `${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const contact = (name: string) => ok<Paged<WaContact>>('GET', '/wa/contacts', undefined, { search: name }).rows[0];
  return { db, call, ok, contact };
}

describe('whatsapp helpers', () => {
  it('classifies Malaysian numbers and builds wa.me links', () => {
    assert.deepEqual(phoneInfo('012-345 6789'), { digits: '0123456789', intl: '60123456789', type: 'mobile' });
    assert.deepEqual(phoneInfo('+60 3-2201 9055'), { digits: '0322019055', intl: '60322019055', type: 'landline' });
    assert.equal(phoneInfo('1300-88-1234').intl, null);
    assert.equal(phoneInfo('12345').type, 'invalid');
    assert.equal(waUrl('60123456789', 'Salam & terima kasih'), 'https://wa.me/60123456789?text=Salam%20%26%20terima%20kasih');
  });

  it('fills placeholders and reports the ones still missing', () => {
    const text = fillTemplate('Salam {nama}, saya {nama_saya} dari {syarikat_saya}.', { nama: 'Puan A', nama_saya: '  ', syarikat_saya: 'Syarikat B' });
    assert.equal(text, 'Salam Puan A, saya {nama_saya} dari Syarikat B.');
    assert.deepEqual(missingPlaceholders(text), ['nama_saya']);
  });
});

describe('whatsapp api', () => {
  it('starts with the default templates, also after a fresh import', () => {
    const { db, ok } = setup();
    assert.equal(ok<WaTemplate[]>('GET', '/wa/templates').length, 4);
    importCrm(db, { leads: [rec('Lain', '019-0000000')] }, { today: TODAY });
    assert.equal(ok<WaTemplate[]>('GET', '/wa/templates').length, 4);
  });

  it('lists every lead number with its type and shared numbers', () => {
    const { ok, contact } = setup();
    const all = ok<Paged<WaContact>>('GET', '/wa/contacts');
    assert.equal(all.total, 5);
    assert.equal(all.rows[0].company, 'Mobile Grill', 'highest score first');
    assert.equal(contact('Mobile Grill').phone_type, 'mobile');
    assert.equal(contact('Landline Cafe').phone_type, 'landline');
    assert.equal(contact('Broken Number').intl, null);
    assert.equal(contact('Shared One').shared, 1);
    assert.equal(ok<Paged<WaContact>>('GET', '/wa/contacts', undefined, { type: 'mobile' }).total, 3);
    assert.equal(ok<Paged<WaContact>>('GET', '/wa/contacts', undefined, { search: '2201' }).total, 1);
    const s = ok<WaSummary>('GET', '/wa/summary');
    assert.deepEqual([s.withPhone, s.mobile, s.landline, s.invalid, s.shared, s.messages, s.todo], [5, 3, 1, 1, 2, 0, 3]);
  });

  it('records a message, marks the lead contacted and tracks replies', () => {
    const { ok, call, contact, db } = setup();
    const lead = contact('Mobile Grill');
    const tpl = ok<WaTemplate[]>('GET', '/wa/templates')[0];
    const msg = ok<WaMessageRow>('POST', '/wa/messages', { lead_id: lead.lead_id, template_id: tpl.id, body: 'Salam!', at: AT });
    assert.equal(msg.template_name, tpl.name);
    assert.equal(msg.created_at, AT);
    const l = db.prepare('SELECT status, mql_at FROM leads WHERE id = ?').get(lead.lead_id) as { status: string; mql_at: string };
    assert.deepEqual([l.status, l.mql_at], ['mql', TODAY]);
    const after = contact('Mobile Grill');
    assert.deepEqual([after.sent_count, after.last_sent_at, after.last_template], [1, AT, tpl.name]);
    // Contacted leads leave the "to do" list and show under "sent".
    const todo = ok<Paged<WaContact>>('GET', '/wa/contacts', undefined, { stage: 'todo' });
    assert.ok(!todo.rows.some((r) => r.lead_id === lead.lead_id));
    assert.equal(ok<Paged<WaContact>>('GET', '/wa/contacts', undefined, { stage: 'sent' }).total, 1);

    ok('PATCH', `/wa/leads/${lead.lead_id}`, { replied: true, at: AT });
    const replied = contact('Mobile Grill');
    assert.deepEqual([replied.wa_replied_at, replied.wa_status], [AT, 'yes']);
    assert.equal(ok<Paged<WaContact>>('GET', '/wa/contacts', undefined, { stage: 'replied' }).total, 1);

    // A number marked "no WhatsApp" drops out of the to-do list.
    const landline = contact('Landline Cafe');
    ok('PATCH', `/wa/leads/${landline.lead_id}`, { wa_status: 'no' });
    assert.ok(!ok<Paged<WaContact>>('GET', '/wa/contacts', undefined, { stage: 'todo' }).rows.some((r) => r.lead_id === landline.lead_id));
    assert.equal(call('PATCH', `/wa/leads/${landline.lead_id}`, { wa_status: 'maybe' }).status, 400);

    // A number that cannot take a chat is refused.
    assert.equal(call('POST', '/wa/messages', { lead_id: contact('Broken Number').lead_id, body: 'x' }).status, 400);
    assert.equal(call('POST', '/wa/messages', { lead_id: lead.lead_id, body: '  ' }).status, 400);

    const s = ok<WaSummary>('GET', '/wa/summary');
    assert.deepEqual([s.contacted, s.replied, s.messages, s.messagesToday, s.waYes, s.waNo], [1, 1, 1, 1, 1, 1]);
    assert.equal(ok<Paged<WaMessageRow>>('GET', '/wa/messages', undefined, { lead_id: lead.lead_id }).total, 1);
  });

  it('edits templates and settings with validation', () => {
    const { ok, call } = setup();
    assert.equal(call('POST', '/wa/templates', { name: '', body: 'x' }).status, 400);
    const t = ok<WaTemplate>('POST', '/wa/templates', { name: 'Raya', body: 'Selamat Hari Raya {nama}!' });
    assert.equal(ok<WaTemplate>('PATCH', `/wa/templates/${t.id}`, { name: 'Raya 2', body: 'Salam {nama}' }).name, 'Raya 2');
    assert.equal(call('DELETE', `/wa/templates/${t.id}`).status, 204);
    assert.equal(call('PATCH', `/wa/templates/${t.id}`, { name: 'x', body: 'y' }).status, 404);
    const s = ok<{ myName: string; company: string }>('PATCH', '/wa/settings', { myName: '  Ali  ', company: 'Syarikat Contoh', extra: 1 });
    assert.deepEqual(s, { myName: 'Ali', company: 'Syarikat Contoh' });
  });
});
