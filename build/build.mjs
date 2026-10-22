// Builds the password-locked, view-only page (index.html) from an export of the app's data.
// Usage: STATICRYPT_PASSWORD=... node build/build.mjs <export-dir>
// <export-dir> holds data/users/me/tracker.json and data/users/me/tracker/{shifts,payments,changes}/*.json
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
  const d = path.join(me, 'tracker', name);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => ({ id: f.slice(0, -5), ...readJson(path.join(d, f)) }));
}
const settings = readJson(path.join(me, 'tracker.json'));
const shifts = coll('shifts');
const changes = coll('changes');
const payments = {};
for (const p of coll('payments')) { const { id, ...rest } = p; payments[id] = rest; }
if (!shifts.length) { console.error('No shifts found in the export; refusing to publish an empty page.'); process.exit(1); }

const snap = { builtAt: new Date().toISOString(), settings, shifts, payments, changes };
const tpl = fs.readFileSync(path.join(root, 'build/template.html'), 'utf8');
if (!tpl.includes('<!--SNAPSHOT-->')) { console.error('Template is missing the <!--SNAPSHOT--> marker.'); process.exit(1); }
const json = JSON.stringify(snap).replace(/</g, '\\u003c');
const html = tpl.replace('<!--SNAPSHOT-->', '<script>window.SAFEWALK_SNAPSHOT=' + json + ';</script>');

const tmp = path.join(root, '.build-tmp');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp);
fs.writeFileSync(path.join(tmp, 'index.html'), html);
try {
  execFileSync('npx', ['-y', 'staticrypt@3.5.4', path.join(tmp, 'index.html'), '-d', root, '--short', '--remember', '30',
    '--template-title', 'SafeWalk Shifts & Pay', '--template-instructions', 'Enter your password to see your shifts and pay.',
    '--template-button', 'Open', '--template-placeholder', 'Password', '--template-remember', 'Remember me for 30 days',
    '--template-error', 'That password didn’t work.', '--template-color-primary', '#17213A', '--template-color-secondary', '#EEF1F6'],
    { cwd: root, stdio: 'inherit', env: process.env });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('Built index.html: ' + shifts.length + ' shifts, ' + Object.keys(payments).length + ' pay stubs, ' + changes.length + ' changes.');
