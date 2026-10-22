// Reads the edits saved from the private site (edits.json, AES-GCM encrypted with EDITS_KEY).
//   node build/sync.mjs pull [out.json]  -> prints {opIds, writes}: database writes to apply in order
//                                          (one entry per document; add if_version for documents that already exist)
//   node build/sync.mjs ack <out.json>   -> removes the applied ops from edits.json (keeps any newer ones)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const file = path.join(root, 'edits.json');
const keyB64 = process.env.EDITS_KEY;
if (!keyB64) { console.error('Set EDITS_KEY.'); process.exit(1); }
const subtle = globalThis.crypto.subtle;
const key = await subtle.importKey('raw', Buffer.from(keyB64, 'base64'), 'AES-GCM', false, ['encrypt', 'decrypt']);

async function readOps() {
  if (!fs.existsSync(file)) return [];
  const box = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(box.iv, 'base64') }, key, Buffer.from(box.ct, 'base64'));
  const o = JSON.parse(Buffer.from(pt).toString('utf8'));
  return Array.isArray(o.ops) ? o.ops : [];
}
async function writeOps(ops) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, Buffer.from(JSON.stringify({ ops })));
  fs.writeFileSync(file, JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64'), ct: Buffer.from(ct).toString('base64') }));
}

const BASE = 'data/users/me/tracker';
const TARGET = {
  'shift.set': ['set', BASE + '/shifts'], 'shift.patch': ['update', BASE + '/shifts'], 'shift.del': ['delete', BASE + '/shifts'],
  'change.add': ['set', BASE + '/changes'], 'payment.set': ['set', BASE + '/payments'], 'payment.del': ['delete', BASE + '/payments'],
  'settings.patch': ['update', 'data/users/me'],
};
const SETTINGS_OK = ['rate', 'rates', 'rateConfirmed', 'vacPct', 'deductMode', 'customPct', 'periodDays', 'periodsPerYear', 'anchor', 'paydayOffset', 'banner'];
const ID_OK = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;

function collapse(ops) {
  const docs = new Map(), skipped = [];
  for (const op of ops) {
    const t = TARGET[op.type];
    const docId = op.type === 'settings.patch' ? 'tracker' : op.docId;
    if (!t || !ID_OK.test(String(docId || ''))) { skipped.push(op.id); continue; }
    let data = op.data && typeof op.data === 'object' ? JSON.parse(JSON.stringify(op.data)) : null;
    if (op.type === 'settings.patch') data = Object.fromEntries(Object.entries(data || {}).filter(([k]) => SETTINGS_OK.includes(k)));
    const k = t[1] + '|' + docId;
    const cur = docs.get(k);
    if (t[0] === 'delete') { docs.set(k, { op: 'delete', collection: t[1], doc_id: docId }); continue; }
    if (t[0] === 'set') { docs.set(k, { op: 'set', collection: t[1], doc_id: docId, data: data || {} }); continue; }
    // update
    if (cur && cur.op === 'delete') continue;
    if (cur && cur.op === 'set') { for (const [f, v] of Object.entries(data || {})) { if (v && typeof v === 'object' && v.__delete__) delete cur.data[f]; else cur.data[f] = v; } continue; }
    if (cur) Object.assign(cur.data, data || {}); else docs.set(k, { op: 'update', collection: t[1], doc_id: docId, data: data || {} });
  }
  return { writes: [...docs.values()], skipped };
}

const cmd = process.argv[2];
if (cmd === 'pull') {
  const ops = await readOps();
  const { writes, skipped } = collapse(ops);
  const out = JSON.stringify({ count: ops.length, opIds: ops.map((o) => o.id), skipped, writes, ops: ops.map((o) => ({ id: o.id, at: o.at, type: o.type, docId: o.docId })) }, null, 1);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], out);
  console.log(out);
} else if (cmd === 'ack') {
  const done = new Set(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).opIds || []);
  const left = (await readOps()).filter((o) => !done.has(o.id));
  await writeOps(left);
  console.log('Removed ' + done.size + ' applied edit(s); ' + left.length + ' newer edit(s) kept.');
} else {
  console.error('Usage: node build/sync.mjs pull [out.json] | ack <out.json>');
  process.exit(1);
}
