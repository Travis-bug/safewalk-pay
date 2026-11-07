// Works out the expected take-home for the next cheques, using the same pay math as the SafeWalk app
// (hours x rate on that day, Ontario holiday pay, 4% vacation pay, CRA 2026 deductions).
// Usage: node build/budget-expected.mjs <export-dir> [YYYY-MM-DD today]
// <export-dir> holds data/users/me/tracker.json and data/users/me/tracker/{shifts,payments}/*.json (same export as build.mjs).
// Prints JSON: { today, cheques: [{ payday, periodStart, periodEnd, hours, shiftCount, loggedCount, gross, cpp, ei, tax, net, paid }] }
// Only cheques that haven't been paid yet are listed: the current pay period and the next one.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('Pass the export folder.'); process.exit(1); }
const me = path.join(path.resolve(dir), 'data/users/me');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
function coll(name) {
  const d = path.join(me, 'tracker', name);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => ({ id: f.slice(0, -5), ...readJson(path.join(d, f)) }));
}
const DEFAULTS = { rate: 18.95, rates: [], vacPct: 0, deductMode: 'cra', customPct: 0, periodDays: 14, periodsPerYear: 0, anchor: '2026-10-29', paydayOffset: 9 };
const st = Object.assign({}, DEFAULTS, readJson(path.join(me, 'tracker.json')));
const shifts = coll('shifts');
const payments = {};
for (const p of coll('payments')) payments[p.id] = p;

const HOLIDAYS = ['2026-09-07', '2026-10-12', '2026-12-25', '2026-12-26', '2027-01-01', '2027-02-15', '2027-03-26', '2027-05-24', '2027-07-01', '2027-09-06', '2027-10-11', '2027-12-25', '2027-12-26'];
const TAX = {
  cppRate: 0.0595, cppBaseRate: 0.0495, cppExempt: 3500, cppMax: 4230.45, cppBaseMax: 3519.45,
  eiRate: 0.0163, eiMax: 1123.07,
  fedA: [0, 58523, 117045, 181440, 258482], fedR: [0.14, 0.205, 0.26, 0.29, 0.33], fedK: [0, 3804, 10241, 15685, 26024],
  bpaf: 16452, cea: 1501, fedLow: 0.14,
  onA: [0, 53891, 107785, 150000, 220000], onV: [0.0505, 0.0915, 0.1116, 0.1216, 0.1316], onK: [0, 2210, 4376, 5876, 8076],
  bpaon: 12989, onLow: 0.0505, onS2: 300, surt1: 5818, surt2: 7446,
};
const r2 = (x) => Math.round(x * 100) / 100;
const dayNum = (iso) => { const p = String(iso).split('-').map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 864e5); };
const isoOf = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
function torontoToday() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date());
}
const todayIso = process.argv[3] || torontoToday();
const today = dayNum(todayIso);
const mm = (t) => { if (!t) return null; const a = t.split(':').map(Number); return a[0] * 60 + a[1]; };
const span = (a, b, brk) => { let d = mm(b) - mm(a); if (d <= 0) d += 1440; return Math.max(0, d - (Number(brk) || 0)); };

function rateList() {
  const h = Array.isArray(st.rates) ? st.rates : [];
  return h.filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.from || '') && Number(x.rate) > 0).slice().sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}
function rateOn(day) {
  const h = rateList();
  if (!h.length) return Number(st.rate) || 0;
  let r = Number(h[0].rate);
  h.forEach((x) => { if (dayNum(x.from) <= day) r = Number(x.rate); });
  return r;
}
const vacMul = () => 1 + (Number(st.vacPct) || 0) / 100;
const wagesOf = (mins, day) => (mins / 60) * rateOn(day);

function bracket(A, th) { let i = 0; for (let j = 0; j < th.length; j++) if (A >= th[j]) i = j; return i; }
function ohp(A) {
  if (A <= 20000) return 0;
  if (A <= 36000) return Math.min(300, 0.06 * (A - 20000));
  if (A <= 48000) return Math.min(450, 300 + 0.06 * (A - 36000));
  if (A <= 72000) return Math.min(600, 450 + 0.25 * (A - 48000));
  if (A <= 200000) return Math.min(750, 600 + 0.25 * (A - 72000));
  return Math.min(900, 750 + 0.25 * (A - 200000));
}
function calc(gross) {
  const P = Number(st.periodsPerYear) || Math.round(365 / (Number(st.periodDays) || 14));
  if (gross <= 0) return { gross: 0, cpp: 0, ei: 0, tax: 0, net: 0 };
  if (st.deductMode === 'custom') { const d = r2((gross * (Number(st.customPct) || 0)) / 100); return { gross: r2(gross), cpp: 0, ei: 0, tax: d, net: r2(gross - d) }; }
  const cpp = Math.max(0, TAX.cppRate * (gross - TAX.cppExempt / P));
  const cppBase = (cpp * TAX.cppBaseRate) / TAX.cppRate, f5 = cpp - cppBase;
  const ei = TAX.eiRate * gross;
  const A = Math.max(0, P * (gross - f5));
  const credBase = Math.min(P * cppBase, TAX.cppBaseMax) + Math.min(P * ei, TAX.eiMax);
  const fi = bracket(A, TAX.fedA);
  const T3 = TAX.fedR[fi] * A - TAX.fedK[fi] - TAX.fedLow * TAX.bpaf - TAX.fedLow * credBase - Math.min(TAX.fedLow * A, TAX.fedLow * TAX.cea);
  const fed = Math.max(0, T3) / P;
  const oi = bracket(A, TAX.onA);
  const T4 = Math.max(0, TAX.onV[oi] * A - TAX.onK[oi] - TAX.onLow * TAX.bpaon - TAX.onLow * credBase);
  const V1 = 0.2 * Math.max(0, T4 - TAX.surt1) + 0.36 * Math.max(0, T4 - TAX.surt2);
  const S = Math.min(T4 + V1, Math.max(0, 2 * TAX.onS2 - (T4 + V1)));
  const prov = Math.max(0, T4 + V1 - S + ohp(A)) / P;
  const out = { gross: r2(gross), cpp: r2(cpp), ei: r2(ei), tax: r2(r2(fed) + r2(prov)) };
  out.net = r2(out.gross - r2(out.cpp + out.ei + out.tax));
  return out;
}

const list = shifts.map((s) => {
  const day = dayNum(s.date);
  const planMins = span(s.start || '00:00', s.end || '00:00', s.breakMin);
  const hasDf = s.dfHours != null && s.dfHours !== '' && !isNaN(Number(s.dfHours));
  const actMins = hasDf ? Math.round(Number(s.dfHours) * 60) : (s.actualIn && s.actualOut ? span(s.actualIn, s.actualOut, s.actualBreak) : null);
  return { id: s.id, day, planMins, actMins, active: s.status === 'scheduled' };
});
const L = Number(st.periodDays) || 14, a0 = dayNum(st.anchor || DEFAULTS.anchor), off = Number(st.paydayOffset) || 0;
function periodOf(day) { const start = a0 + Math.floor((day - a0) / L) * L; return { start, end: start + L - 1, payday: start + L - 1 + off }; }
function holidayBase(hday) {
  const wk = hday - ((((hday - a0) % 7) + 7) % 7), from = wk - 28, to = wk - 1;
  let w = 0;
  list.forEach((s) => { if (s.active && s.day >= from && s.day <= to) w += wagesOf(s.actMins != null ? s.actMins : s.planMins, s.day); });
  return r2(w / 20);
}

// The pay period whose cheque comes next: the most recent one that has ended but isn't paid yet, else the current one.
const cur = periodOf(today);
const prev = periodOf(cur.start - 1);
const periods = [];
if (prev.payday >= today && !payments[isoOf(prev.start)]) periods.push(prev);
periods.push(cur, periodOf(cur.end + 1));

const out = periods.slice(0, 2).filter((p) => !payments[isoOf(p.start)]).map((p) => {
  let mins = 0, wages = 0, count = 0, logged = 0;
  list.forEach((s) => {
    if (!s.active || s.day < p.start || s.day > p.end) return;
    const m = s.actMins != null ? s.actMins : s.planMins;
    mins += m; wages += wagesOf(m, s.day); count++; if (s.actMins != null) logged++;
  });
  let hol = 0;
  HOLIDAYS.forEach((h) => { const d = dayNum(h); if (d >= p.start && d <= p.end) hol += holidayBase(d); });
  const base = r2(r2(wages) + r2(hol)), vac = r2(base * (vacMul() - 1));
  const c = calc(r2(base + vac));
  // partial: the pay period isn't over yet, so more shifts may still be added.
  return { payday: isoOf(p.payday), periodStart: isoOf(p.start), periodEnd: isoOf(p.end), hours: r2(mins / 60), shiftCount: count, loggedCount: logged, holidayPay: r2(hol), gross: c.gross, cpp: c.cpp, ei: c.ei, tax: c.tax, net: c.net, partial: today <= p.end };
});
console.log(JSON.stringify({ today: todayIso, cheques: out }, null, 1));
