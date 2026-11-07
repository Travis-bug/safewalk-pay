// Builds the password-locked Cheque Day page (budget/index.html) from an export of the budget app's data.
// Usage: STATICRYPT_PASSWORD=... EDITS_KEY=... node build/budget-build.mjs <export-dir>
// <export-dir> holds data/users/me/budget.json and data/users/me/budget/{cheques,bills}/*.json
// (ArtifactData with out_dir on the Cheque Day artifact writes exactly this layout).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = process.argv[2];
if (!dir) { console.error('Pass the export folder.'); process.exit(1); }
if (!process.env.STATICRYPT_PASSWORD) { console.error('Set STATICRYPT_PASSWORD.'); process.exit(1); }

const me = path.join(path.resolve(dir), 'data/users/me');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
function coll(name) {
  const d = path.join(me, 'budget', name);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => ({ id: f.slice(0, -5), ...readJson(path.join(d, f)) }));
}
const settingsFile = path.join(me, 'budget.json');
if (!fs.existsSync(settingsFile)) { console.error('No budget settings in the export; refusing to publish an empty page.'); process.exit(1); }
const settings = readJson(settingsFile);
const cheques = coll('cheques').map(({ id, ...c }) => ({ ...c, payday: c.payday || id }));
const bills = coll('bills');
if (!cheques.length && !bills.length) { console.error('No cheques or bills in the export; refusing to publish an empty page.'); process.exit(1); }

const snap = { builtAt: new Date().toISOString(), settings, cheques, bills };
// With EDITS_KEY set, a connected device can save edits (encrypted with this key) to budget-edits.json in the repo.
if (process.env.EDITS_KEY) snap.sync = { repo: process.env.SITE_REPO || 'Travis-bug/safewalk-pay', branch: 'main', path: 'budget-edits.json', key: process.env.EDITS_KEY };
const tpl = fs.readFileSync(path.join(root, 'build/budget-template.html'), 'utf8');
if (!tpl.includes('<!--SNAPSHOT-->')) { console.error('Template is missing the <!--SNAPSHOT--> marker.'); process.exit(1); }
const json = JSON.stringify(snap).replace(/</g, '\\u003c');
const body = tpl.replace('<!--SNAPSHOT-->', '<script>window.BUDGET_SNAPSHOT=' + json + ';</script>');
// The Claude artifact host adds this skeleton at publish time; a standalone page needs it itself.
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' +
  body + '</body></html>';

const tmp = path.join(root, '.build-tmp');
const out = path.join(root, 'budget');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(tmp, 'index.html'), html);
try {
  execFileSync('npx', ['-y', 'staticrypt@3.5.4', path.join(tmp, 'index.html'), '-d', out, '--short', '--remember', '30',
    '--template-title', 'Cheque Day', '--template-instructions', 'Enter your password to see your cheques and budget.',
    '--template-button', 'Open', '--template-placeholder', 'Password', '--template-remember', 'Remember me for 30 days',
    '--template-error', 'That password didn’t work.', '--template-color-primary', '#0F4C6E', '--template-color-secondary', '#EBF2EC'],
    { cwd: root, stdio: 'inherit', env: process.env });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('Built budget/index.html: ' + cheques.length + ' cheques, ' + bills.length + ' bills.');
