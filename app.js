import { SUPABASE_URL, SUPABASE_KEY, DEFAULT_CATEGORIES, ALLOW_SIGNUP, APP_URL, CATEGORY_RENAMES, DEFAULT_INCOME_CATEGORIES } from './config.js';

const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');

// Demo-Modus (?demo): ohne Konto, Daten bleiben nur in diesem Browser.
const DEMO = new URLSearchParams(location.search).has('demo');

// ---------- Hilfsfunktionen ----------
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const today = () => iso(new Date());
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthEnd = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const monthLabel = (d) => d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
const dayLabel = (s) => parseISO(s).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = (s) => parseISO(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function parseAmount(str) {
  let s = String(str ?? '').replace(/[^0-9,.]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return s && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

let toastTimer;
function toast(text) {
  $toast.textContent = text;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2600);
}

function friendlyError(e) {
  if (e?.code === 'PGRST205' || e?.code === '42P01') {
    return 'Die Datenbank ist noch nicht eingerichtet. Führe supabase/schema.sql im Supabase SQL Editor aus.';
  }
  if (/Invalid login credentials/i.test(e?.message)) return 'E-Mail oder Passwort stimmt nicht.';
  if (/Email not confirmed/i.test(e?.message)) return 'Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Mail von Supabase).';
  if (/Signups not allowed/i.test(e?.message)) return 'Neue Konten können nicht erstellt werden.';
  if (/not_invited|Database error saving new user/i.test(e?.message)) {
    return 'Diese E-Mail-Adresse ist nicht eingeladen. Bitte die Person, die dich einladen möchte, genau diese Adresse einzutragen.';
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(e?.message)) return 'Keine Verbindung zum Server.';
  return e?.message || 'Unbekannter Fehler';
}

// ---------- Kalender-Farben ----------
const CAL_COLORS = [
  ['#3b6cf6', 'Blau'],
  ['#d9423a', 'Rot'],
  ['#1f9d57', 'Grün'],
  ['#e08a00', 'Orange'],
  ['#8e5bd9', 'Lila'],
  ['#d94a8c', 'Pink'],
  ['#12a3a3', 'Türkis'],
  ['#6b7280', 'Grau'],
];
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : 'var(--accent)');

// Welche Kalender ausgeblendet sind, merkt sich jedes Gerät für sich.
function loadHiddenCals() {
  try {
    return new Set(JSON.parse(localStorage.getItem('planer-hidden-cals')) || []);
  } catch {
    return new Set();
  }
}
function saveHiddenCals() {
  try {
    localStorage.setItem('planer-hidden-cals', JSON.stringify([...state.hiddenCals]));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

// Ausgeblendete Bereiche und Reiter, ebenfalls pro Gerät gemerkt.
function loadHiddenUI() {
  try {
    return new Set(JSON.parse(localStorage.getItem('planer-hidden-ui')) || []);
  } catch {
    return new Set();
  }
}
function saveHiddenUI() {
  try {
    localStorage.setItem('planer-hidden-ui', JSON.stringify([...state.hiddenUI]));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

// ---------- Zustand ----------
const state = {
  tab: 'heute',
  anim: 'view',
  calView: 'monat',
  openEv: null,
  showDone: false,
  fabOpen: false,
  justToggled: null,
  agenda: [],
  user: null,
  authMode: 'login',
  authMsg: null,
  authEmail: '',
  calMonth: monthStart(new Date()),
  selDate: today(),
  finMonth: monthStart(new Date()),
  prioFilter: 'alle',
  events: [],
  calendars: [],
  hiddenCals: loadHiddenCals(),
  hiddenUI: loadHiddenUI(),
  todos: [],
  tx: [],
  recurring: [],
  accounts: [],
  hist: [],
  accTx: [],
  finView: 'uebersicht',
  debts: [],
  todoLists: [],
  listFilter: 'alle',
  accDetail: null,
  accSeg: 'alle',
  lastAcc: null,
  aliases: {},
  isOwner: false,
  invites: [],
  categories: DEFAULT_CATEGORIES,
  incomeCategories: DEFAULT_INCOME_CATEGORIES,
  token: null,
  error: null,
};

// ---------- Datenzugriff ----------
let sb = null;
let db = null;

function supaDb() {
  const ok = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  return {
    async list(table, range) {
      let q = sb.from(table).select('*');
      if (range) q = q.gte(range.col, range.from).lte(range.col, range.to);
      return ok(await q);
    },
    async listEvents(from, to) {
      return ok(
        await sb
          .from('events')
          .select('*')
          .lte('date', to)
          .or(`end_date.gte.${from},and(end_date.is.null,date.gte.${from})`),
      );
    },
    // Alle Zeilen mit from <= col <= to (seitenweise, damit auch mehr als 1000 Zeilen ankommen).
    async listRange(table, col, from, to) {
      const all = [];
      for (let i = 0; ; i += 1000) {
        const page = ok(await sb.from(table).select('*').gte(col, from).lte(col, to).order('id').range(i, i + 999));
        all.push(...page);
        if (page.length < 1000) return all;
      }
    },
    async listAll(table) {
      const all = [];
      for (let from = 0; ; from += 1000) {
        const page = ok(await sb.from(table).select('*').order('id').range(from, from + 999));
        all.push(...page);
        if (page.length < 1000) return all;
      }
    },
    async insertMany(table, rows) {
      for (let i = 0; i < rows.length; i += 500) ok(await sb.from(table).insert(rows.slice(i, i + 500)));
    },
    async insert(table, row) {
      return ok(await sb.from(table).insert(row).select().single());
    },
    async update(table, id, patch) {
      return ok(await sb.from(table).update(patch).eq('id', id).select().single());
    },
    async remove(table, id) {
      return ok(await sb.from(table).delete().eq('id', id));
    },
    async updateWhere(table, col, value, patch) {
      const q = sb.from(table).update(patch);
      return ok(await (value === null ? q.is(col, null) : q.eq(col, value)));
    },
    async isOwner() {
      return ok(await sb.rpc('is_owner')) === true;
    },
    async getSettings() {
      return ok(await sb.from('user_settings').select('*').maybeSingle());
    },
    async saveSettings(patch) {
      return ok(await sb.from('user_settings').upsert({ user_id: state.user.id, ...patch }));
    },
  };
}

function localDb() {
  const KEY = 'planer-demo';
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  };
  const write = (d) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      /* Speicher nicht verfügbar */
    }
  };
  let mem = read();
  const rows = (t) => (mem[t] ||= []);
  return {
    async list(table, range) {
      return rows(table).filter((r) => !range || (r[range.col] >= range.from && r[range.col] <= range.to));
    },
    async listEvents(from, to) {
      return rows('events').filter((e) => e.date <= to && (e.end_date || e.date) >= from);
    },
    async listRange(table, col, from, to) {
      return rows(table).filter((r) => r[col] >= from && r[col] <= to);
    },
    async listAll(table) {
      return [...rows(table)];
    },
    async insertMany(table, list) {
      for (const row of list) rows(table).push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row });
      write(mem);
    },
    async insert(table, row) {
      const r = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row };
      rows(table).push(r);
      write(mem);
      return r;
    },
    async update(table, id, patch) {
      const r = rows(table).find((x) => x.id === id);
      Object.assign(r, patch);
      write(mem);
      return r;
    },
    async remove(table, id) {
      mem[table] = rows(table).filter((x) => x.id !== id);
      write(mem);
    },
    async updateWhere(table, col, value, patch) {
      for (const r of rows(table)) if ((r[col] ?? null) === value) Object.assign(r, patch);
      write(mem);
    },
    async isOwner() {
      return false;
    },
    async getSettings() {
      return mem.settings || null;
    },
    async saveSettings(patch) {
      mem.settings = { ...(mem.settings || {}), ...patch };
      write(mem);
    },
  };
}

async function loadEvents() {
  // Auch mehrtägige Termine laden, die vor dem Monat beginnen und in ihn hineinreichen.
  state.events = await db.listEvents(iso(monthStart(state.calMonth)), iso(monthEnd(state.calMonth)));
}
// Termine der nächsten 45 Tage für "Heute" und die Agenda.
async function loadAgenda() {
  state.agenda = await db.listEvents(today(), addDaysISO(45));
}
async function loadCalendars() {
  state.calendars = (await db.list('calendars')).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
}
async function loadTodos() {
  state.todos = await db.list('todos');
}
async function loadTx() {
  state.tx = await db.list('transactions', { col: 'date', from: iso(monthStart(state.finMonth)), to: iso(monthEnd(state.finMonth)) });
}
// Buchungen seit dem ältesten eingetragenen Kontostand, damit der aktuelle Stand berechnet werden kann.
async function loadAccountTx() {
  const dates = state.accounts.map((a) => a.balance_date).filter(Boolean).sort();
  state.accTx = dates.length ? await db.listRange('transactions', 'date', dates[0], today()) : [];
}

// Aktueller Kontostand = eingetragener Stand + alle Buchungen und fälligen festen Posten seitdem
// (Einnahme +, Ausgabe −). Feste Posten zählen ab ihrem Fälligkeitstag, Buchungen ab ihrem Datum.
// Am Stand-Tag selbst zählen nur Buchungen, die nach dem Eintragen des Standes angelegt wurden.
function balancesNow() {
  const t = today();
  const nowMonth = monthStart(new Date());
  const cache = new Map();
  const recOf = (m) => {
    const k = iso(m);
    if (!cache.has(k)) cache.set(k, recurringFor(m));
    return cache.get(k);
  };
  const out = new Map();
  for (const a of state.accounts) {
    const base = Number(a.balance);
    let delta = 0;
    if (a.balance_date) {
      const since = a.balance_date;
      const setAt = Date.parse(a.balance_set_at || a.created_at || '') || 0;
      for (const x of state.accTx) {
        const from = x.account_id === a.id;
        const to = x.to_account_id === a.id;
        if ((!from && !to) || x.date > t) continue;
        if (!(x.date > since || (x.date === since && Date.parse(x.created_at) > setAt))) continue;
        const amt = Number(x.amount);
        // Umbuchung: vom Quellkonto runter, aufs Zielkonto rauf. Sonst Einnahme +, Ausgabe −.
        if (x.type === 'umbuchung') delta += (from ? -amt : 0) + (to ? amt : 0);
        else delta += x.type === 'einnahme' ? amt : -amt;
      }
      for (let m = monthStart(parseISO(since)); m <= nowMonth; m = addMonths(m, 1)) {
        for (const x of recOf(m)) {
          if (x.account_id === a.id && x.date > since && x.date <= t) delta += x.type === 'einnahme' ? Number(x.amount) : -Number(x.amount);
        }
      }
    }
    out.set(a.id, { base, delta, value: Math.round((base + delta) * 100) / 100 });
  }
  return out;
}

async function loadAccounts() {
  state.accounts = (await db.list('accounts')).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
}
// Buchungen der letzten 6 Monate für den Rückblick.
async function loadHist() {
  const now = new Date();
  state.hist = await db.list('transactions', { col: 'date', from: iso(addMonths(monthStart(now), -5)), to: iso(monthEnd(now)) });
}
async function loadTodoLists() {
  state.todoLists = (await db.list('todo_lists')).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
}
async function loadDebts() {
  state.debts = await db.list('debts');
}
async function loadRecurring() {
  state.recurring = (await db.list('recurring')).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
}

// Abos sind Regeln, keine einzelnen Buchungen. Für jeden Monat wird berechnet, welche fällig sind.
// Ein abgelaufenes Abo bleibt als Regel gespeichert, damit vergangene Monate weiter stimmen.
function recurringFor(month) {
  const out = [];
  const last = monthEnd(month).getDate();
  for (const r of state.recurring) {
    const s = parseISO(r.start_date);
    const diff = (month.getFullYear() - s.getFullYear()) * 12 + month.getMonth() - s.getMonth();
    if (diff < 0 || diff % (r.interval_months || 1)) continue;
    const date = iso(new Date(month.getFullYear(), month.getMonth(), Math.min(s.getDate(), last)));
    if (date < r.start_date || (r.end_date && date > r.end_date)) continue;
    out.push({ recurringId: r.id, type: r.type, amount: r.amount, category: r.category, account_id: r.account_id, merchant: r.name, date, created_at: '' });
  }
  return out;
}

// Einladen darf nur der Inhaber (das zuerst angelegte Konto). Für alle anderen bleibt die Liste leer.
async function loadInvites() {
  state.isOwner = await db.isOwner();
  state.invites = state.isOwner ? (await db.list('invites')).sort((a, b) => a.email.localeCompare(b.email)) : [];
}

function inviteMailto(email) {
  const url = APP_URL;
  const subject = 'Einladung zum Planer';
  const body = `Hallo,\n\nich habe dich zu meiner Planer-App eingeladen (Kalender, To-Dos und Finanzen).\n\n1. Öffne ${url}\n2. Tippe auf „Mit Einladung registrieren“\n3. Registriere dich mit genau dieser E-Mail-Adresse: ${email}\n4. Bestätige den Link in der Mail, die du danach bekommst\n\nDu bekommst ein eigenes Konto mit eigenen Daten.`;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Alle Abbuchungen und Einnahmen aus Abos, die ab heute in den nächsten Tagen fällig werden.
function upcomingRecurring(days) {
  const now = new Date();
  const from = today();
  const to = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  const out = [];
  for (let i = 0; i <= Math.ceil(days / 28) + 1; i++) out.push(...recurringFor(addMonths(monthStart(now), i)));
  return out.filter((x) => x.date >= from && x.date <= to).sort((a, b) => a.date.localeCompare(b.date));
}

async function loadSettings() {
  const s = await db.getSettings();
  state.categories = s?.categories?.length ? s.categories : DEFAULT_CATEGORIES;
  state.incomeCategories = Array.isArray(s?.income_categories) ? s.income_categories : DEFAULT_INCOME_CATEGORIES;
  state.token = s?.api_token || null;
  state.aliases = s?.category_aliases || {};
}

async function refresh() {
  try {
    await Promise.all([loadEvents(), loadAgenda(), loadCalendars(), loadTodos(), loadTx(), loadHist(), loadAccounts(), loadRecurring(), loadDebts(), loadTodoLists(), loadSettings(), loadInvites()]);
    if (await applyConfigRenames()) await Promise.all([loadTx(), loadHist(), loadRecurring()]);
    await loadAccountTx();
    state.error = null;
  } catch (e) {
    state.error = friendlyError(e);
  }
  render();
}

// Führt eine Änderung aus, lädt danach neu und zeigt Fehler an.
async function run(fn, okText) {
  try {
    await fn();
    if (okText) toast(okText);
    await refresh();
    return true;
  } catch (e) {
    toast(friendlyError(e));
    return false;
  }
}

// ---------- Ansichten ----------
const $bar = document.getElementById('bar');
const $fab = document.getElementById('fab');
const $scrim = document.getElementById('scrim');

const ICONS = {
  heute: '<svg viewBox="0 0 24 24"><path d="M4 11.2L12 4.5l8 6.7"/><path d="M6.2 9.8V19h11.6V9.8"/><path d="M10 19v-5h4v5"/></svg>',
  kalender: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  todos: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.3l2.6 2.6 4.8-5.3"/></svg>',
  finanzen: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="3.5"/><path d="M3 10.5h18M15.5 15h2"/></svg>',
  mehr: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/></svg>',
};
const shown = (id) => !state.hiddenUI.has(id);
const TABS = [
  ['heute', 'Heute'],
  ['kalender', 'Kalender'],
  ['todos', 'To-Dos'],
  ['finanzen', 'Finanzen'],
  ['mehr', 'Mehr'],
];
const FAB_ITEMS = [
  ['event', 'Termin', ICONS.kalender],
  ['todo', 'To-Do', ICONS.todos],
  ['tx', 'Buchung', ICONS.finanzen],
];

// Leiste und Schnell-Hinzufügen bleiben dauerhaft stehen (nur ihr Zustand wird aktualisiert),
// dadurch kann sich der Marker in der Leiste weich von Tab zu Tab bewegen.
const visibleTabs = () => TABS.filter(([id]) => id === 'mehr' || shown(`tab:${id}`));
function buildBar() {
  const tabs = visibleTabs();
  $bar.innerHTML = `<nav style="--n:${tabs.length}"><i class="ind"></i>${tabs.map(([id, label]) => `<button class="tab" data-a="tab" data-tab="${id}">${ICONS[id]}<span>${label}</span></button>`).join('')}</nav>`;
}
buildBar();
$fab.innerHTML = `<div class="fab-menu">${FAB_ITEMS.map(([k, label, icon], i) => `<button class="fab-item" style="--d:${(FAB_ITEMS.length - 1 - i) * 45}" data-a="fabadd" data-k="${k}">${icon}${label}</button>`).join('')}</div>
  <button class="fab-main" data-a="fab" aria-label="Neu hinzufügen" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;

function updateBar() {
  const tabs = visibleTabs();
  if (!tabs.some(([id]) => id === state.tab)) state.tab = tabs[0][0];
  const i = tabs.findIndex(([id]) => id === state.tab);
  $bar.hidden = false;
  $bar.querySelector('nav').style.setProperty('--i', i);
  $bar.querySelectorAll('.tab').forEach((b, j) => {
    b.classList.toggle('on', j === i);
    b.setAttribute('aria-current', j === i ? 'page' : 'false');
  });
}
function updateFab() {
  $fab.hidden = state.tab === 'mehr';
  $fab.classList.toggle('open', state.fabOpen);
  $fab.querySelector('.fab-main').setAttribute('aria-expanded', String(state.fabOpen));
  document.body.classList.toggle('fab-open', state.fabOpen);
}

function head(title, sub = '', right = '') {
  return `<header class="head"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div><div class="head-r">${DEMO ? '<span class="badge">Demo</span>' : ''}${right}</div></header>`;
}

// ---------- kleine Helfer für Ansichten ----------
const addDaysISO = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const dayDiff = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
const relDay = (s) => {
  const d = dayDiff(today(), s);
  return d === 0 ? 'Heute' : d === 1 ? 'Morgen' : d === -1 ? 'Gestern' : d > 1 ? `In ${d} Tagen` : `Vor ${-d} Tagen`;
};
const durText = (st, en) => {
  const [h1, m1] = st.split(':').map(Number);
  const [h2, m2] = en.split(':').map(Number);
  const mins = h2 * 60 + m2 - (h1 * 60 + m1);
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h} Std. ${m} Min.` : `${h} Std.`) : `${m} Min.`;
};
const calMap = () => new Map(state.calendars.map((c) => [c.id, c]));
const isVisibleEv = (e, cm) => !cm.has(e.calendar_id) || !state.hiddenCals.has(e.calendar_id);
const evCovers = (e, date) => e.date <= date && date <= (e.end_date || e.date);
const byTime = (a, b) => (a.start_time || '').localeCompare(b.start_time || '');

// Ein Termin als Karte. Antippen klappt die Details auf (Zeit, Zeitraum, Kalender, Notiz, Aktionen).
function evHtml(e, ctx, cm) {
  const color = safeColor(cm.get(e.calendar_id)?.color);
  const multi = e.end_date && e.end_date > e.date;
  const st = e.start_time?.slice(0, 5);
  const en = e.end_time?.slice(0, 5);
  const first = !multi || e.date === ctx;
  const left = st && first ? `<b>${st}</b>${en && !multi ? `<small>${en}</small>` : ''}` : '<b>Ganztag</b>';
  const dur = st && en && !multi ? durText(st, en) : '';
  const dayNo = multi ? `Tag ${dayDiff(e.date, ctx) + 1} von ${dayDiff(e.date, e.end_date) + 1}` : '';
  const cal = cm.get(e.calendar_id)?.name;
  const meta = [cal, dur, dayNo].filter(Boolean).join(' · ');
  const rows = [
    ['Wann', multi ? `${fullDate(e.date)} – ${fullDate(e.end_date)}` : dayLabel(e.date)],
    ['Zeit', st ? `${st}${en ? ` – ${en}` : ''} Uhr${dur ? ` (${dur})` : ''}` : 'Ganztägig'],
    ['Kalender', cal || 'Ohne Kalender'],
    e.note ? ['Notiz', e.note] : null,
  ]
    .filter(Boolean)
    .map(([k, v]) => `<div class="evrow"><span>${k}</span><b>${esc(v)}</b></div>`)
    .join('');
  const open = state.openEv === e.id;
  return `<li class="ev ${open ? 'open' : ''}" data-id="${e.id}" style="--c:${color}">
    <button class="evtop" data-a="toggleev" data-id="${e.id}" aria-expanded="${open}">
      <span class="evtime">${left}</span><i class="evbar"></i>
      <span class="evmain"><span class="evtitle">${esc(e.title)}</span>${meta ? `<span class="evmeta">${esc(meta)}</span>` : ''}</span>
      <span class="chev">›</span>
    </button>
    <div class="evdetail"><div><div class="evinner">${rows}
      <div class="evact"><button class="btn small" data-a="editevent" data-id="${e.id}">Bearbeiten</button><button class="btn small danger" data-a="delevent" data-id="${e.id}">Löschen</button></div>
    </div></div></div></li>`;
}

// ---------- Heute ----------
const PRIO_ORDER = { hoch: 0, mittel: 1, niedrig: 2 };
const PRIO_LABEL = { hoch: 'Hoch', mittel: 'Mittel', niedrig: 'Niedrig' };

const listOf = (x) => state.todoLists.find((l) => l.id === x.list_id);
function listTag(x) {
  const l = listOf(x);
  return l && state.listFilter === 'alle' ? `<span class="sub ltag"><i style="background:${safeColor(l.color)}"></i>${esc(l.name)}</span>` : '';
}
function todoRow(x) {
  const t = today();
  const time = x.due_time ? x.due_time.slice(0, 5) : '';
  const overdue = !x.done && x.due_date && (x.due_date < t || (x.due_date === t && time && time < hm(new Date())));
  const when = x.due_date ? `${x.due_date === t ? 'Heute' : x.due_date === addDaysISO(1) ? 'Morgen' : shortDate(x.due_date)}${time ? `, ${time} Uhr` : ''}` : time ? `${time} Uhr` : '';
  const sub = when ? `<span class="sub ${overdue ? 'overdue' : ''}">${overdue ? 'Überfällig · ' : ''}${when}</span>` : '';
  return `<li class="row trow ${x.done ? 'done' : ''} ${state.justToggled === x.id ? 'arrive' : ''}" data-id="${x.id}">
    <button class="check ${x.done ? 'on' : ''}" data-a="toggletodo" data-id="${x.id}" aria-label="${x.done ? 'Als offen markieren' : 'Erledigen'}"><svg viewBox="0 0 24 24"><path d="M6.5 12.5l3.8 3.8 7.2-8"/></svg></button>
    <button class="main" data-a="edittodo" data-id="${x.id}"><span class="title">${esc(x.title)}</span>${sub}${listTag(x)}${x.note ? `<span class="sub tnote">${esc(x.note)}</span>` : ''}</button>
    <span class="prio ${x.priority}">${PRIO_LABEL[x.priority]}</span></li>`;
}

function viewToday() {
  const t = today();
  const now = new Date();
  const nowHM = hm(now);
  const cm = calMap();
  const ev = state.agenda.filter((e) => isVisibleEv(e, cm));
  const todayEv = ev.filter((e) => evCovers(e, t)).sort(byTime);
  const nextToday = todayEv.find((e) => e.start_time && e.start_time.slice(0, 5) >= nowHM);
  const later = ev
    .filter((e) => e.date > t)
    .sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))[0];
  const nxt = nextToday || later;

  // Hero: nächster Termin
  let hero;
  if (nxt) {
    const isToday = nxt.date <= t;
    const st = nxt.start_time?.slice(0, 5);
    let when;
    if (isToday && st) {
      const mins = Number(st.slice(0, 2)) * 60 + Number(st.slice(3)) - (now.getHours() * 60 + now.getMinutes());
      when = `Heute · ${st} Uhr · ${mins < 60 ? `in ${mins} Min.` : `in ${Math.floor(mins / 60)} Std. ${mins % 60 ? `${mins % 60} Min.` : ''}`}`;
    } else when = `${relDay(nxt.date)} · ${st ? `${st} Uhr` : 'ganztägig'}`;
    hero = `<section class="hero"><div class="hero-k">Als Nächstes</div><div class="hero-t">${esc(nxt.title)}</div><div class="hero-s">${esc(when)}</div>
      <div class="hero-b"><button data-a="goday" data-date="${isToday ? t : nxt.date}">Im Kalender ansehen</button></div></section>`;
  } else {
    hero = `<section class="hero"><div class="hero-k">Als Nächstes</div><div class="hero-t">Alles ruhig</div><div class="hero-s">In den nächsten Wochen steht nichts an.</div>
      <div class="hero-b"><button data-a="fabadd" data-k="event">Termin anlegen</button></div></section>`;
  }

  // To-Dos: überfällig oder heute fällig
  const dueTodos = state.todos
    .filter((x) => !x.done && x.due_date && x.due_date <= t)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] || (a.due_time || '99').localeCompare(b.due_time || '99'));

  // Geld
  const cur = monthStart(now);
  const mFrom = iso(cur);
  const mTo = iso(monthEnd(cur));
  const monthAll = [...state.hist.filter((x) => x.date >= mFrom && x.date <= mTo), ...recurringFor(cur)];
  const spent = monthFigures(cur, state.hist.filter((x) => x.date >= mFrom && x.date <= mTo)).fixExp;
  const bals = balancesNow();
  const bud = budgetNow();
  const soon = upcomingRecurring(7).slice(0, 3);
  const soonRows = soon
    .map((x) => {
      const d = parseISO(x.date);
      return `<li class="row"><span class="when"><b>${shortDate(x.date)}</b><small>${d.toLocaleDateString('de-DE', { weekday: 'short' })}</small></span>
        <button class="main" data-a="tab" data-tab="finanzen"><span class="title">${esc(x.merchant)}</span><span class="sub">${relDay(x.date)} · ${x.type === 'einnahme' ? 'Einnahme' : 'Abbuchung'}</span></button>
        <span class="amount ${x.type === 'einnahme' ? 'pos' : 'neg'}">${signedEur(x)}</span></li>`;
    })
    .join('');

  const hour = now.getHours();
  const greeting = hour < 5 ? 'Gute Nacht' : hour < 11 ? 'Guten Morgen' : hour < 17 ? 'Guten Tag' : 'Guten Abend';
  const evRows = todayEv
    .map((e) => {
      const st = e.start_time?.slice(0, 5);
      return `<li class="row"><i class="calbar" style="background:${safeColor(cm.get(e.calendar_id)?.color)}"></i><span class="time">${st || 'Ganztag'}</span>
        <button class="main" data-a="goday" data-date="${t}"><span class="title">${esc(e.title)}</span><span class="sub">${esc([cm.get(e.calendar_id)?.name, e.end_time ? `bis ${e.end_time.slice(0, 5)}` : ''].filter(Boolean).join(' · '))}</span></button></li>`;
    })
    .join('');

  return `${head(greeting, dayLabel(t))}
    ${shown('h:hero') ? hero : ''}
    ${shown('h:tiles') ? `<div class="tiles">
      <button class="tile" data-a="goday" data-date="${t}"><b>${todayEv.length}</b><span>Termine heute</span></button>
      <button class="tile" data-a="tab" data-tab="todos"><b>${dueTodos.length}</b><span>Heute fällig</span></button>
      <button class="tile" data-a="tab" data-tab="finanzen"><b>${eur.format(spent).replace(/,00(?=\s)/, '')}</b><span>Feste Ausgaben</span></button>
    </div>` : ''}
    ${shown('h:termine') ? `<section class="card"><h2>Termine heute</h2>${evRows ? `<ul class="list">${evRows}</ul>` : '<p class="empty">Keine Termine heute. Genieß den freien Tag ✨</p>'}</section>` : ''}
    ${shown('h:todos') ? `<section class="card"><h2>Zu erledigen</h2>
      ${dueTodos.length ? `<ul class="list">${dueTodos.slice(0, 5).map(todoRow).join('')}</ul>` : '<p class="empty">Nichts fällig. Alles im grünen Bereich ✅</p>'}
      ${dueTodos.length > 5 ? `<p class="hint" style="margin:8px 0 0">+ ${dueTodos.length - 5} weitere unter „To-Dos“.</p>` : ''}
    </section>` : ''}
    ${shown('h:geld') ? `<section class="card"><h2>Geld</h2>
      ${
        state.accounts.some((a) => a.active)
          ? `<button class="moneytop" data-a="gofin"><span>Frei verfügbar</span><b class="${bud.free < 0 ? 'c-red' : ''}">${eur.format(bud.free)}</b><small>Konten ${eur.format(bud.cash)}${bud.debt ? ` · Schulden −${eur.format(bud.debt)}` : ''} · Übrig nach Fixkosten ${eur.format(bud.left)}</small></button>
             <div class="minicards">${state.accounts
               .filter((a) => a.active)
               .map((a) => `<button class="mini ${brandOf(a).cls}" data-a="gofin" data-id="${a.id}"><span>${esc(a.name)}</span><b>${eur.format(bals.get(a.id).value)}</b></button>`)
               .join('')}</div>`
          : `<div class="stats" style="margin:0"><div class="stat" style="grid-column:1/-1"><span>Feste Ausgaben im ${now.toLocaleDateString('de-DE', { month: 'long' })}</span><b>${eur.format(spent)}</b></div></div>`
      }
      ${soonRows ? `<ul class="list" style="margin-top:10px">${soonRows}</ul>` : ''}
    </section>` : ''}`;
}

// ---------- Kalender ----------
function viewCal() {
  const m = state.calMonth;
  const cm = calMap();
  const colorOf = (e) => safeColor(cm.get(e.calendar_id)?.color);
  const visible = state.events.filter((e) => isVisibleEv(e, cm));
  const switcher = `<div class="seg"><button class="${state.calView === 'monat' ? 'on' : ''}" data-a="calview" data-v="monat">Monat</button><button class="${state.calView === 'agenda' ? 'on' : ''}" data-a="calview" data-v="agenda">Agenda</button></div>`;
  const chips = state.calendars
    .map((c) => {
      const off = state.hiddenCals.has(c.id);
      return `<button class="calchip ${off ? 'off' : ''}" data-a="togglecal" data-id="${c.id}" aria-pressed="${!off}"><i style="background:${safeColor(c.color)}"></i>${esc(c.name)}</button>`;
    })
    .join('');
  const chipRow = `<div class="calchips">${chips}<button class="calchip add" data-a="addcal">+ Kalender</button></div>`;

  if (state.calView === 'agenda') return `${head('Kalender', 'Die nächsten 45 Tage')}${switcher}${chipRow}${viewAgenda(cm)}`;

  const offset = (m.getDay() + 6) % 7;
  const days = monthEnd(m).getDate();
  // Ein mehrtägiger Termin (z. B. Urlaub) gilt an jedem Tag von "date" bis "end_date".
  const colors = new Map();
  const mStart = iso(m);
  const mEnd = iso(monthEnd(m));
  for (const e of visible) {
    const from = e.date < mStart ? mStart : e.date;
    const to = (e.end_date || e.date) > mEnd ? mEnd : e.end_date || e.date;
    for (let d = parseISO(from); iso(d) <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      colors.set(iso(d), (colors.get(iso(d)) || new Set()).add(colorOf(e)));
    }
  }
  const t = today();
  let cells = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<div class="wd">${w}</div>`).join('');
  cells += '<span></span>'.repeat(offset);
  for (let d = 1; d <= days; d++) {
    const date = iso(new Date(m.getFullYear(), m.getMonth(), d));
    const cls = ['day', date === t ? 'today' : '', date === state.selDate ? 'sel' : ''].join(' ');
    const dots = [...(colors.get(date) || [])]
      .slice(0, 3)
      .map((c) => `<i style="background:${c}"></i>`)
      .join('');
    cells += `<button class="${cls}" data-a="selday" data-date="${date}" aria-label="${esc(dayLabel(date))}"><span class="n">${d}</span>${dots ? `<span class="dots">${dots}</span>` : ''}</button>`;
  }

  const sel = state.selDate;
  const sd = parseISO(sel);
  const list = visible.filter((e) => evCovers(e, sel)).sort(byTime);
  const dayCard = `<section class="card dayCard" id="dayDetail">
    <div class="dayhead"><div class="bigday">${sd.getDate()}</div>
      <div><div class="dname">${sd.toLocaleDateString('de-DE', { weekday: 'long' })}</div>
      <div class="dsub">${sd.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })} · ${relDay(sel)}${list.length ? ` · ${list.length} Termin${list.length > 1 ? 'e' : ''}` : ''}</div></div>
      <button class="btn small primary" data-a="addevent">+ Termin</button></div>
    ${list.length ? `<ul class="evlist">${list.map((e) => evHtml(e, sel, cm)).join('')}</ul>` : '<p class="empty">Keine Termine. Ein freier Tag ✨</p>'}
  </section>`;

  return `${head('Kalender')}${switcher}${chipRow}
    <div class="calhead mhead"><div><div class="mname">${m.toLocaleDateString('de-DE', { month: 'long' })}</div><div class="myear">${m.getFullYear()}</div></div>
      <div class="calctl"><button class="iconbtn" data-a="calprev" aria-label="Vorheriger Monat">‹</button><button class="pill" data-a="caltoday">Heute</button><button class="iconbtn" data-a="calnext" aria-label="Nächster Monat">›</button></div></div>
    <section class="card calcard"><div class="cal">${cells}</div></section>
    ${dayCard}`;
}

// Agenda: Termine der nächsten 45 Tage, nach Tag gruppiert.
function viewAgenda(cm) {
  const t = today();
  const groups = new Map();
  for (const e of state.agenda.filter((x) => isVisibleEv(x, cm)).sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))) {
    const day = e.date < t ? t : e.date;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(e);
  }
  if (!groups.size) return '<section class="card empty-card"><span class="emoji">🌤️</span><b>Nichts geplant</b><p>In den nächsten 45 Tagen stehen keine Termine an.</p></section>';
  return `<div class="agenda">${[...groups.entries()]
    .map(
      ([day, evs]) => `<div class="agenda-day">${relDay(day)} <small>${dayLabel(day)}</small></div><ul class="evlist">${evs.map((e) => evHtml(e, day, cm)).join('')}</ul>`,
    )
    .join('')}</div>`;
}

// ---------- To-Dos ----------
function viewTodos() {
  const t = today();
  const tom = addDaysISO(1);
  const week = addDaysISO(6);
  if (state.listFilter !== 'alle' && state.listFilter !== 'none' && !state.todoLists.some((l) => l.id === state.listFilter)) state.listFilter = 'alle';
  const inList = (x) => state.listFilter === 'alle' || (state.listFilter === 'none' ? !listOf(x) : x.list_id === state.listFilter);
  const filt = (x) => (state.prioFilter === 'alle' || x.priority === state.prioFilter) && inList(x);
  const openAll = state.todos.filter((x) => !x.done);
  const doneAll = state.todos.filter((x) => x.done);
  const sorter = (a, b) =>
    (a.due_date || '9999').localeCompare(b.due_date || '9999') ||
    PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] ||
    (a.due_time || '99:99').localeCompare(b.due_time || '99:99') ||
    (a.created_at || '').localeCompare(b.created_at || '');
  const gkey = (x) => (!x.due_date ? 'none' : x.due_date < t ? 'overdue' : x.due_date === t ? 'today' : x.due_date === tom ? 'tomorrow' : x.due_date <= week ? 'week' : 'later');
  const GROUPS = [
    ['overdue', 'Überfällig'],
    ['today', 'Heute'],
    ['tomorrow', 'Morgen'],
    ['week', 'Diese Woche'],
    ['later', 'Später'],
    ['none', 'Ohne Datum'],
  ];
  const open = openAll.filter(filt).sort(sorter);
  const sections = GROUPS.map(([k, label]) => {
    const items = open.filter((x) => gkey(x) === k);
    if (!items.length) return '';
    return `<div class="grp ${k === 'overdue' ? 'overdue' : ''}"><span>${label}</span><span class="gcount">${items.length}</span></div>
      <section class="card"><ul class="list">${items.map(todoRow).join('')}</ul></section>`;
  }).join('');

  const done = doneAll.filter(filt).sort((a, b) => (b.due_date || '').localeCompare(a.due_date || '') || (b.created_at || '').localeCompare(a.created_at || ''));
  const bumped = state.justToggled && doneAll.some((x) => x.id === state.justToggled);
  const doneCard = doneAll.length
    ? `<section class="card donecard"><button class="donehead" data-a="toggledone" aria-expanded="${state.showDone}"><span>Erledigt</span><span class="count ${bumped ? 'bump' : ''}">${doneAll.length}</span><span class="chev ${state.showDone ? 'open' : ''}">›</span></button>
        <div class="donebody ${state.showDone ? 'open' : ''}"><div>${done.length ? `<ul class="list">${done.map(todoRow).join('')}</ul>` : '<p class="empty">Keine erledigten To-Dos mit diesem Filter.</p>'}
        <button class="btn small danger clear" data-a="cleardone">Erledigte löschen</button></div></div></section>`
    : '';

  const total = state.todos.length;
  const ratio = total ? doneAll.length / total : 0;
  const ring = `<div class="ring" title="${doneAll.length} von ${total} erledigt"><svg viewBox="0 0 46 46"><circle class="bg" cx="23" cy="23" r="20"/><circle class="fg" cx="23" cy="23" r="20" style="stroke-dashoffset:${(125.7 * (1 - ratio)).toFixed(1)}"/></svg><b>${Math.round(ratio * 100)}%</b></div>`;
  const opt = (v, l) => `<option value="${v}" ${state.prioFilter === v ? 'selected' : ''}>${l}</option>`;
  const empty = !open.length
    ? `<section class="card empty-card"><span class="emoji">${openAll.length ? '🔎' : '🎉'}</span><b>${openAll.length ? 'Nichts mit diesem Filter' : 'Alles erledigt'}</b><p>${openAll.length ? 'Wähle oben eine andere Liste oder Priorität.' : 'Du hast keine offenen To-Dos.'}</p></section>`
    : '';

  const cnt = (id) => openAll.filter((x) => (id === 'alle' ? true : id === 'none' ? !listOf(x) : x.list_id === id)).length;
  const chip = (id, label, color) => `<button class="calchip ${state.listFilter === id ? 'sel' : ''}" data-a="todolist" data-id="${id}" aria-pressed="${state.listFilter === id}">${color ? `<i style="background:${safeColor(color)}"></i>` : ''}${esc(label)} <small>${cnt(id)}</small></button>`;
  const listChips = `<div class="calchips">${chip('alle', 'Alle')}${state.todoLists.map((l) => chip(l.id, l.name, l.color)).join('')}${state.todoLists.length && openAll.some((x) => !listOf(x)) ? chip('none', 'Ohne Liste') : ''}<button class="calchip add" data-a="addlist">+ Liste</button></div>`;
  const curList = state.todoLists.find((l) => l.id === state.listFilter);
  const listBar = curList ? `<div class="listbar"><span><i style="background:${safeColor(curList.color)}"></i>${esc(curList.name)}</span><button class="linkbtn" data-a="editlist" data-id="${curList.id}">Liste bearbeiten</button></div>` : '';

  return `${head('To-Dos', `${openAll.length} offen · ${doneAll.length} erledigt`, total ? ring : '')}
    ${listChips}${listBar}
    <div class="toolbar"><label>Priorität <select data-c="priofilter">${opt('alle', 'Alle')}${opt('hoch', 'Hoch')}${opt('mittel', 'Mittel')}${opt('niedrig', 'Niedrig')}</select></label></div>
    ${sections || empty}${doneCard}`;
}

const INTERVALS = { 1: 'monatlich', 3: 'vierteljährlich', 12: 'jährlich' };
const KINDS = { giro: 'Girokonto', kredit: 'Kreditkarte', anlage: 'Anlage / Depot', sonstig: 'Sonstiges' };
const fullDate = (s) => parseISO(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const num0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const accName = (id) => state.accounts.find((a) => a.id === id)?.name;
const sumOf = (list, type) => list.filter((x) => x.type === type).reduce((s, x) => s + Number(x.amount), 0);
const signedEur = (x) => `${x.type === 'einnahme' ? '+' : '−'}${eur.format(Number(x.amount))}`;
const FIN_VIEWS = [
  ['uebersicht', 'Übersicht'],
  ['planung', 'Planung'],
  ['kategorien', 'Kategorien'],
  ['rueckblick', 'Rückblick'],
];
const finViews = () => FIN_VIEWS.filter(([id]) => id === 'uebersicht' || shown(`fv:${id}`));

function finHead() {
  const seg = finViews().map(
    ([id, label]) => `<button class="${state.finView === id ? 'on' : ''}" data-a="finview" data-v="${id}" aria-pressed="${state.finView === id}">${label}</button>`,
  ).join('');
  return `${head('Finanzen')}<div class="seg" role="group" aria-label="Ansicht">${seg}</div>`;
}

function finMonthNav() {
  return `<div class="monthnav">
      <button class="iconbtn" data-a="finprev" aria-label="Vorheriger Monat">‹</button>
      <button class="linkbtn" data-a="fintoday"><strong>${monthLabel(state.finMonth)}</strong></button>
      <button class="iconbtn" data-a="finnext" aria-label="Nächster Monat">›</button>
    </div>`;
}

// Monatszahlen: Ausgaben sind nur die festen (Abos, Miete ...), Einnahmen die festen plus einmalige Extra-Einnahmen.
// Eine einmalige Einnahme mit gleichem Betrag wie ein fester Posten zählt nicht doppelt (z. B. Gehalt aus dem Bankimport).
function monthFigures(month, txList) {
  const fixed = recurringFor(month);
  const fixInc = sumOf(fixed, 'einnahme');
  const fixExp = sumOf(fixed, 'ausgabe');
  const amts = fixed.filter((x) => x.type === 'einnahme').map((x) => Number(x.amount));
  const extra = txList.filter((x) => x.type === 'einnahme' && !amts.includes(Number(x.amount))).reduce((s, x) => s + Number(x.amount), 0);
  return { fixInc, fixExp, extra, income: fixInc + extra, saldo: fixInc + extra - fixExp };
}

// ---------- Konten als Karten, Budget, Schulden ----------
const DEBT_KINDS = { klarna: 'Klarna / Später bezahlen', rate: 'Ratenzahlung', privat: 'Privat geliehen', sonstig: 'Sonstiges' };

// Marken-Optik pro Konto, erkannt am Namen. Eigene Wortmarken in den Markenfarben, keine Original-Logos.
function brandOf(a) {
  const n = a.name || '';
  if (/trade\s*republic/i.test(n)) return { cls: 'b-tr', logo: '<span class="logo"><i class="lg-sq">TR</i><span>Trade Republic</span></span>' };
  if (/adv[a-z]*nzia/i.test(n)) return { cls: 'b-adv', logo: '<span class="logo"><b class="lg-adv">advanzia</b><em>GOLD</em></span>' };
  if (/\bing\b/i.test(n)) return { cls: 'b-ing', logo: '<span class="logo"><i class="lg-pill">ING</i></span>' };
  if (/haspa|hamburger sparkasse/i.test(n)) return { cls: 'b-haspa', logo: '<span class="logo"><i class="lg-pill">Haspa</i></span>' };
  return { cls: 'b-def', logo: `<span class="logo"><i class="lg-sq">${esc((n.trim()[0] || '?').toUpperCase())}</i><span>${esc(n)}</span></span>` };
}

// Kreditkarte mit Limit: groß der noch verfügbare Betrag, darunter Balken und genutzter Anteil.
function cardBalance(a, b) {
  const limit = Number(a.credit_limit) || 0;
  if (a.kind !== 'kredit' || !limit) return `<span class="acard-bal">${eur.format(b.value)}</span>`;
  const used = Math.max(0, -b.value);
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return `<span class="acard-bal"><small>Verfügbar</small>${eur.format(limit - used)}</span>
    <span class="limit"><i style="width:${pct}%"></i></span>
    <span class="limit-t">Genutzt ${eur.format(used)} von ${eur.format(limit)}</span>`;
}

function accountCard(a, b) {
  const br = brandOf(a);
  const age = a.balance_date ? dayDiff(a.balance_date, today()) : null;
  const stale = age === null || age > 7;
  return `<button class="acard ${br.cls}" data-a="accopen" data-id="${a.id}" aria-label="${esc(a.name)} öffnen">
    <span class="acard-top">${br.logo}<span class="acard-kind">${KINDS[a.kind] || ''}</span></span>
    ${cardBalance(a, b)}
    <span class="acard-foot"><span>${esc(a.name)}</span>${stale ? '<span class="acard-warn">Stand prüfen</span>' : ''}</span></button>`;
}

function accountsRow() {
  const balances = balancesNow();
  const act = state.accounts.filter((a) => a.active);
  const idle = state.accounts.filter((a) => !a.active);
  const cards = act.map((a) => accountCard(a, balances.get(a.id))).join('');
  const idleRows = idle
    .map((a) => `<li class="row"><button class="main" data-a="editacc" data-id="${a.id}"><span class="title">${esc(a.name)}</span><span class="sub">${KINDS[a.kind] || ''} · nicht genutzt</span></button><span class="amount">${eur.format(balances.get(a.id).value)}</span></li>`)
    .join('');
  return `<div class="acards">${cards}<button class="acard add" data-a="addacc"><span class="plus">+</span><span>Konto hinzufügen</span></button></div>
    ${idle.length ? `<details class="idle"><summary>Nicht genutzte Konten (${idle.length})</summary><ul class="list">${idleRows}</ul></details>` : ''}`;
}

// Budget: "Frei verfügbar" ist das noch freie Kreditlimit der Kreditkarte (Advanzia), mit der du bezahlst.
// Die Kacheln zeigen alle Konten zusammen, die offenen Schulden, die Fixkosten des Monats und was nach Fixkosten und Einnahmen übrig bleibt.
function budgetNow() {
  const bals = balancesNow();
  const act = state.accounts.filter((a) => a.active);
  const cash = act.reduce((s, a) => s + bals.get(a.id).value, 0);
  const cards = act.filter((a) => a.kind === 'kredit');
  const free = cards.reduce((s, a) => s + (Number(a.credit_limit) || 0) + bals.get(a.id).value, 0);
  const openDebts = state.debts.filter((d) => !d.paid);
  const debt = openDebts.reduce((s, d) => s + Number(d.amount), 0);
  const cur = monthStart(new Date());
  const fig = monthFigures(cur, state.hist.filter((x) => x.date >= iso(cur) && x.date <= iso(monthEnd(cur))));
  return { cash, free, cardName: cards[0]?.name || '', hasLimit: cards.some((a) => Number(a.credit_limit) > 0), debt, debtCount: openDebts.length, fixExp: fig.fixExp, left: fig.saldo };
}

function budgetHero() {
  const b = budgetNow();
  if (!state.accounts.some((a) => a.active)) {
    return `<section class="budget"><div class="hero-k">Frei verfügbar</div><div class="budget-n">–</div><div class="hero-s">Lege dein erstes Konto an, dann rechnet die App dein Budget aus.</div></section>`;
  }
  const chip = (label, v, sign) => `<div><span>${label}</span><b>${sign}${eur0.format(Math.abs(v))}</b></div>`;
  return `<section class="budget"><div class="hero-k">Frei verfügbar</div>
    <div class="budget-n">${eur.format(b.free)}</div>
    <div class="budget-sub">${b.hasLimit ? `Noch freies Limit · ${esc(b.cardName)}` : 'Lege bei deiner Kreditkarte ein Kreditlimit fest'}</div>
    <div class="budget-chips two">
      ${chip('Konten gesamt', b.cash, b.cash < 0 ? '−' : '+')}
      ${chip(`Schulden${b.debtCount ? ` (${b.debtCount})` : ''}`, b.debt, '−')}
      ${chip('Fixkosten im Monat', b.fixExp, '−')}
      ${chip('Übrig nach Fixkosten', b.left, b.left < 0 ? '−' : '+')}
    </div></section>`;
}

function debtsCard() {
  const t = today();
  const open = state.debts.filter((d) => !d.paid).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.name.localeCompare(b.name));
  const paid = state.debts.filter((d) => d.paid).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const row = (d) => {
    const over = !d.paid && d.due_date && d.due_date < t;
    const due = d.due_date ? `${over ? 'überfällig seit' : 'fällig am'} ${fullDate(d.due_date)}` : 'ohne Fälligkeit';
    const sub = [DEBT_KINDS[d.kind], due, d.note].filter(Boolean).join(' · ');
    return `<li class="row debt ${d.paid ? 'done' : ''}"><button class="check ${d.paid ? 'on' : ''}" data-a="paydebt" data-id="${d.id}" aria-label="${d.paid ? 'Wieder als offen markieren' : 'Als bezahlt markieren'}"><svg viewBox="0 0 24 24"><path d="M6.5 12.5l3.8 3.8 7.2-8"/></svg></button>
      <button class="main" data-a="editdebt" data-id="${d.id}"><span class="title">${esc(d.name)}</span><span class="sub ${over ? 'overdue' : ''}">${esc(sub)}</span></button>
      <span class="amount">${eur.format(Number(d.amount))}</span></li>`;
  };
  const total = open.reduce((s, d) => s + Number(d.amount), 0);
  return `<section class="card"><h2>Schulden &amp; offene Zahlungen</h2>
    ${open.length ? `<ul class="list">${open.map(row).join('')}</ul><p class="sumline"><span>Offen gesamt: <b>${eur.format(total)}</b></span><span>${open.length} Posten</span></p>` : '<p class="hint" style="margin:0">Nichts offen. Trage hier Klarna-Käufe, Raten oder Geliehenes ein, damit sie dein Budget mindern.</p>'}
    ${paid.length ? `<details class="idle"><summary>Bezahlt (${paid.length})</summary><ul class="list">${paid.map(row).join('')}</ul></details>` : ''}
    <button class="btn block" data-a="adddebt" style="margin-top:10px">Schuld eintragen</button></section>`;
}

function debtForm(d) {
  openSheet({
    title: d ? 'Eintrag bearbeiten' : 'Neue Schuld',
    text: 'Zum Beispiel ein Klarna-Kauf, eine Rate oder Geld, das du jemandem schuldest. Offene Posten werden von deinem freien Budget abgezogen.',
    fields: [
      { name: 'name', label: 'Wofür / an wen', required: true, value: d?.name, placeholder: 'z. B. Klarna – Zalando' },
      [
        { name: 'amount', label: 'Offener Betrag (€)', required: true, inputmode: 'decimal', placeholder: '0,00', value: d ? String(d.amount).replace('.', ',') : '' },
        { name: 'kind', label: 'Art', type: 'select', value: d?.kind || 'klarna', options: Object.entries(DEBT_KINDS) },
      ],
      { name: 'due_date', label: 'Fällig am (optional)', type: 'date', value: d?.due_date },
      { name: 'note', label: 'Notiz (optional)', value: d?.note },
    ],
    onSave: (v) => {
      const amount = parseAmount(v.amount);
      if (amount === null || amount < 0) {
        toast('Bitte einen gültigen Betrag eingeben.');
        return false;
      }
      const row = { name: v.name, kind: v.kind, amount, due_date: v.due_date, note: v.note };
      return run(() => (d ? db.update('debts', d.id, row) : db.insert('debts', row)), 'Gespeichert');
    },
    onDelete: d && (() => run(() => db.remove('debts', d.id), 'Gelöscht')),
  });
}

// Detailansicht eines Kontos: alle Buchungen des Monats, neueste oben, nach Tagen gruppiert.
function viewAccountDetail() {
  const a = state.accounts.find((x) => x.id === state.accDetail);
  if (!a) {
    state.accDetail = null;
    return viewFinOverview();
  }
  const b = balancesNow().get(a.id);
  const br = brandOf(a);
  const t = today();
  const month = [...state.tx, ...recurringFor(state.finMonth)].filter((x) => x.account_id === a.id || x.to_account_id === a.id);
  // Richtung nach Art der Buchung, nicht nach dem Betrag: Auch eine Buchung über 0 € gehört zu Einnahmen oder Ausgaben.
  const dir = (x) => (x.type === 'umbuchung' ? (x.to_account_id === a.id ? 1 : -1) : x.type === 'einnahme' ? 1 : -1);
  const net = (x) => dir(x) * Number(x.amount);
  const inc = month.filter((x) => dir(x) > 0).reduce((s, x) => s + net(x), 0);
  const out = month.filter((x) => dir(x) < 0).reduce((s, x) => s - net(x), 0);
  const seg = state.accSeg;
  const shown = month
    .filter((x) => seg === 'alle' || (seg === 'ein' ? dir(x) > 0 : dir(x) < 0))
    .sort((p, q) => q.date.localeCompare(p.date) || (q.created_at || '').localeCompare(p.created_at || ''));
  const row = (x) => {
    const v = net(x);
    const up = dir(x) > 0;
    const transfer = x.type === 'umbuchung';
    const title = transfer ? x.merchant || 'Umbuchung' : x.merchant || x.note || x.category || (x.type === 'einnahme' ? 'Einnahme' : 'Ausgabe');
    const sub = [
      transfer ? `${accName(x.account_id) || '?'} → ${accName(x.to_account_id) || '?'}` : x.category || (x.type === 'ausgabe' && !x.recurringId ? 'Kategorie wählen' : ''),
      x.source === 'apple_pay' ? 'Apple Pay' : '',
      x.recurringId ? (x.date > t ? 'geplant' : 'fest') : '',
      !x.recurringId && Number(x.amount) === 0 ? 'Betrag fehlt, antippen' : '',
    ].filter(Boolean).join(' · ');
    const target = x.recurringId ? `data-a="editrec" data-id="${x.recurringId}"` : `data-a="edittx" data-id="${x.id}"`;
    return `<li class="row"><span class="dot ${up ? 'in' : 'out'}">${transfer ? '⇄' : up ? '↓' : '↑'}</span>
      <button class="main" ${target}><span class="title">${esc(title)}</span><span class="sub">${esc(sub)}</span></button>
      <span class="amount ${up ? 'pos' : 'neg'}">${up ? '+' : '−'}${eur.format(Math.abs(v))}</span></li>`;
  };
  let lastDay = '';
  const groups = shown
    .map((x) => {
      const head = x.date === lastDay ? '' : `<li class="dayh">${esc(relDay(x.date) === 'Heute' || relDay(x.date) === 'Gestern' ? `${relDay(x.date)} · ${dayLabel(x.date)}` : dayLabel(x.date))}</li>`;
      lastDay = x.date;
      return head + row(x);
    })
    .join('');
  const segBtn = ([id, label]) => `<button class="${seg === id ? 'on' : ''}" data-a="accseg" data-v="${id}" aria-pressed="${seg === id}">${label}</button>`;
  return `<div class="backrow"><button class="linkbtn" data-a="accback">‹ Alle Konten</button><button class="linkbtn" data-a="editacc" data-id="${a.id}">Bearbeiten</button></div>
    <section class="acard big ${br.cls}" aria-label="${esc(a.name)}">
      <span class="acard-top">${br.logo}<span class="acard-kind">${KINDS[a.kind] || ''}</span></span>
      ${cardBalance(a, b)}
      <span class="acard-foot"><span>${esc(a.name)}</span><span>${a.balance_date ? `Stand-Eintrag ${fullDate(a.balance_date)}` : 'noch kein Eintrag'}</span></span></section>
    ${finMonthNav()}
    <div class="stats"><div class="stat"><span>Eingänge</span><b class="c-green">+${eur.format(inc)}</b></div><div class="stat"><span>Ausgänge</span><b>−${eur.format(out)}</b></div></div>
    <div class="seg" role="group" aria-label="Filter">${[['alle', 'Alle'], ['ein', 'Einnahmen'], ['aus', 'Ausgaben']].map(segBtn).join('')}</div>
    <section class="card">${shown.length ? `<ul class="list bookings">${groups}</ul><p class="sumline"><span>${shown.length} Buchung${shown.length === 1 ? '' : 'en'}</span></p>` : '<p class="empty">Keine Buchungen in diesem Monat</p>'}
      <button class="btn block" data-a="addtx" style="margin-top:10px">Buchung hinzufügen</button></section>`;
}

const eur0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const secHead = (title, right = '') => `<div class="sec"><h3>${title}</h3>${right}</div>`;

function viewFinOverview() {
  const fig = monthFigures(state.finMonth, state.tx);
  const parts = [];
  if (shown('f:budget')) parts.push(budgetHero());
  if (shown('f:konten')) parts.push(secHead('Konten', '<button class="linkbtn" data-a="addacc">+ Konto</button>') + accountsRow());
  if (shown('f:monat')) {
    parts.push(`${secHead('Monat')}${finMonthNav()}
      <div class="trio">
        <div class="stat"><span>Einnahmen</span><b>${eur0.format(fig.income)}</b>${fig.extra > 0 ? `<small class="statnote">${eur0.format(fig.extra)} extra</small>` : ''}</div>
        <div class="stat"><span>Fixkosten</span><b>${eur0.format(fig.fixExp)}</b></div>
        <div class="stat saldo"><span>Saldo</span><b class="${fig.saldo < 0 ? 'c-red' : 'c-green'}">${eur0.format(fig.saldo)}</b></div>
      </div>`);
  }
  if (shown('f:schulden')) parts.push(debtsCard());
  return parts.join('') || '<p class="empty">Alles ausgeblendet. Unter „Mehr → Ansicht anpassen“ blendest du Bereiche wieder ein.</p>';
}

// Ausgaben (und Einnahmen) des Monats nach Kategorie, inklusive Apple Pay und Einkäufen.
function viewFinCategories() {
  const all = [...state.tx, ...recurringFor(state.finMonth)];
  const block = (type, title, empty) => {
    const byCat = new Map();
    for (const x of all) {
      if (x.type !== type) continue;
      const k = x.category || 'Ohne Kategorie';
      byCat.set(k, (byCat.get(k) || 0) + Number(x.amount));
    }
    const list = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const total = list.reduce((s, [, v]) => s + v, 0);
    const bars = list
      .map(
        ([k, v]) => `<div class="bar-row"><div class="bar-label"><span>${esc(k)}</span><span>${eur.format(v)} · ${Math.round((v / total) * 100)} %</span></div>
          <div class="bar"><i style="width:${Math.max(3, (v / list[0][1]) * 100)}%"></i></div></div>`,
      )
      .join('');
    return `<section class="card"><h2>${title}</h2>${bars || `<p class="empty">${empty}</p>`}${list.length ? `<p class="sumline"><span>Gesamt: <b>${eur.format(total)}</b></span></p>` : ''}</section>`;
  };
  return `${finMonthNav()}${block('ausgabe', 'Ausgaben nach Kategorie', 'Noch keine Ausgaben')}${block('einnahme', 'Einnahmen nach Kategorie', 'Noch keine Einnahmen')}`;
}

function upcomingCard() {
  const t = today();
  const next = upcomingRecurring(30);
  const shownRows = next.slice(0, 6);
  const rows = shownRows
    .map((x) => {
      const d = parseISO(x.date);
      const inDays = Math.round((d - parseISO(t)) / 864e5);
      const when = inDays === 0 ? 'heute' : inDays === 1 ? 'morgen' : `in ${inDays} Tagen`;
      const sub = `${when} · ${x.type === 'einnahme' ? 'Einnahme' : 'Abbuchung'}`;
      return `<li class="row"><span class="when"><b>${shortDate(x.date)}</b><small>${d.toLocaleDateString('de-DE', { weekday: 'short' })}</small></span>
        <button class="main" data-a="editrec" data-id="${x.recurringId}"><span class="title">${esc(x.merchant)}</span><span class="sub">${esc(sub)}</span></button>
        <span class="amount ${x.type === 'einnahme' ? 'pos' : 'neg'}">${signedEur(x)}</span></li>`;
    })
    .join('');
  return `<section class="card"><h2>Anstehend · nächste 30 Tage</h2>
    ${rows ? `<ul class="list">${rows}</ul>${next.length > shownRows.length ? `<p class="hint" style="margin:8px 0 0">+ ${next.length - shownRows.length} weitere</p>` : ''}` : '<p class="hint" style="margin:0">Nichts anstehend. Feste Einnahmen und Ausgaben trägst du weiter unten bei „Feste Posten“ ein.</p>'}</section>`;
}

// Feste Einnahmen und Ausgaben (Abos, Gehalt, Miete ...). "Bis" leer = unbefristet.
function recRow(r) {
  const span = r.end_date ? `${fullDate(r.start_date)} bis ${fullDate(r.end_date)}` : `ab ${fullDate(r.start_date)}, unbefristet`;
  const sub = [INTERVALS[r.interval_months], span, accName(r.account_id), r.category].filter(Boolean).join(' · ');
  return `<li class="row"><button class="main" data-a="editrec" data-id="${r.id}"><span class="title">${esc(r.name)}</span><span class="sub">${esc(sub)}</span></button>
    <span class="amount ${r.type === 'einnahme' ? 'pos' : 'neg'}">${signedEur(r)}</span></li>`;
}

function viewFinPlan() {
  const t = today();
  const live = (r) => !r.end_date || r.end_date >= t;
  const active = state.recurring.filter(live);
  const ended = state.recurring.filter((r) => !live(r));
  const perMonth = (type) => active.filter((r) => r.type === type && r.start_date <= t).reduce((s, r) => s + Number(r.amount) / (r.interval_months || 1), 0);
  const group = (type, title) => {
    const list = active.filter((r) => r.type === type).sort((a, b) => (a.end_date || '9999').localeCompare(b.end_date || '9999') || a.name.localeCompare(b.name));
    return `<div class="fgroup"><div class="fgroup-h"><span>${title}</span><b>${eur.format(perMonth(type))} / Monat</b></div>
      ${list.length ? `<ul class="list">${list.map(recRow).join('')}</ul>` : '<p class="hint" style="margin:0 0 4px">Noch nichts eingetragen.</p>'}</div>`;
  };
  // Prognose: nur feste Posten, für die nächsten 6 Monate.
  const months = [0, 1, 2, 3, 4, 5].map((i) => addMonths(monthStart(new Date()), i));
  const forecastRows = months
    .map((m) => {
      const list = recurringFor(m);
      const i = sumOf(list, 'einnahme');
      const e = sumOf(list, 'ausgabe');
      return `<tr><th scope="row">${m.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' })}</th><td>${num0.format(i)}</td><td>${num0.format(e)}</td><td class="${i - e < 0 ? 'c-red' : 'c-green'}">${num0.format(i - e)}</td></tr>`;
    })
    .join('');
  const horizon = iso(addMonths(monthStart(new Date()), 12));
  const notes = active
    .filter((r) => r.end_date && r.end_date <= horizon)
    .sort((a, b) => a.end_date.localeCompare(b.end_date))
    .map((r) => {
      const eq = eur.format(Number(r.amount) / (r.interval_months || 1));
      return r.type === 'einnahme'
        ? `<li><b>${esc(r.name)}</b> endet am ${fullDate(r.end_date)}. Danach fehlen dir ${eq} pro Monat, falls nichts Neues dazukommt.</li>`
        : `<li><b>${esc(r.name)}</b> endet am ${fullDate(r.end_date)}. Danach sparst du ${eq} pro Monat.</li>`;
    })
    .join('');
  const parts = [];
  if (shown('p:anstehend')) parts.push(upcomingCard());
  if (shown('p:prognose')) {
    parts.push(`<section class="card"><h2>Prognose · 6 Monate</h2>
      <div class="tablewrap"><table class="tbl"><thead><tr><th></th><th>Einnahmen</th><th>Ausgaben</th><th>Saldo</th></tr></thead><tbody>${forecastRows}</tbody></table></div>
      <p class="hint" style="margin:8px 0 0">Beträge in €, nur feste Posten. Ein Posten mit „Bis“ fällt danach automatisch weg.</p>
      ${notes ? `<ul class="notes">${notes}</ul>` : ''}</section>`);
  }
  if (shown('p:fest')) {
    parts.push(`<section class="card"><h2>Feste Posten</h2>
      ${group('einnahme', 'Einnahmen')}${group('ausgabe', 'Ausgaben &amp; Abos')}
      <div class="btnrow" style="margin-top:6px"><button class="btn small grow" data-a="addrec" data-type="einnahme">+ Einnahme</button><button class="btn small grow" data-a="addrec" data-type="ausgabe">+ Ausgabe</button></div>
      ${ended.length ? `<details class="idle"><summary>Beendet (${ended.length})</summary><ul class="list">${ended.map(recRow).join('')}</ul></details>` : ''}</section>`);
  }
  return parts.join('') || '<p class="empty">Alles ausgeblendet. Unter „Mehr → Ansicht anpassen“ blendest du Bereiche wieder ein.</p>';
}

// Rückblick: letzte 6 Monate als Tabelle, dazu Ausgaben je Kategorie und Monat.
function viewFinReview() {
  const months = [-5, -4, -3, -2, -1, 0].map((i) => addMonths(monthStart(new Date()), i));
  const data = months.map((m) => {
    const from = iso(m);
    const to = iso(monthEnd(m));
    const list = [...state.hist.filter((x) => x.date >= from && x.date <= to), ...recurringFor(m)];
    return { m, list, inc: sumOf(list, 'einnahme'), exp: sumOf(list, 'ausgabe') };
  });
  const label = (m) => m.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
  const sumRows = data
    .map((d) => `<tr><th scope="row">${label(d.m)}</th><td>${num0.format(d.inc)}</td><td>${num0.format(d.exp)}</td><td class="${d.inc - d.exp < 0 ? 'c-red' : 'c-green'}">${num0.format(d.inc - d.exp)}</td></tr>`)
    .join('');
  const full = data.slice(0, -1);
  const avg = full.length ? full.reduce((s, d) => s + d.exp, 0) / full.length : 0;
  const cats = new Map();
  data.forEach((d, i) => {
    for (const x of d.list) {
      if (x.type !== 'ausgabe') continue;
      const k = x.category || 'Ohne Kategorie';
      if (!cats.has(k)) cats.set(k, Array(data.length).fill(0));
      cats.get(k)[i] += Number(x.amount);
    }
  });
  const catList = [...cats.entries()].map(([k, v]) => [k, v, v.reduce((s, n) => s + n, 0)]).sort((a, b) => b[2] - a[2]);
  const catRows = catList
    .map(([k, v, tot]) => `<tr><th scope="row">${esc(k)}</th>${v.map((n) => `<td>${n ? num0.format(n) : '–'}</td>`).join('')}<td><b>${num0.format(tot)}</b></td></tr>`)
    .join('');
  const colTotals = data.map((d) => `<td><b>${num0.format(d.exp)}</b></td>`).join('');
  return `<section class="card"><h2>Die letzten 6 Monate</h2>
      <div class="tablewrap"><table class="tbl"><thead><tr><th></th><th>Einnahmen</th><th>Ausgaben</th><th>Saldo</th></tr></thead><tbody>${sumRows}</tbody></table></div>
      <p class="hint" style="margin:8px 0 0">Beträge in €. Der laufende Monat ist noch nicht abgeschlossen. Ø Ausgaben pro Monat (ohne laufenden Monat): <b>${eur.format(avg)}</b></p>
    </section>
    <section class="card"><h2>Wofür ausgegeben</h2>
      ${
        catRows
          ? `<div class="tablewrap"><table class="tbl cat"><thead><tr><th></th>${data.map((d) => `<th>${label(d.m)}</th>`).join('')}<th>Summe</th></tr></thead>
              <tbody>${catRows}</tbody><tfoot><tr><th scope="row">Gesamt</th>${colTotals}<td><b>${num0.format(data.reduce((s, d) => s + d.exp, 0))}</b></td></tr></tfoot></table></div>`
          : '<p class="empty">Noch keine Ausgaben</p>'
      }
    </section>`;
}

function viewFin() {
  if (state.accDetail) return `${head('Finanzen')}${viewAccountDetail()}`;
  if (!finViews().some(([id]) => id === state.finView)) state.finView = 'uebersicht';
  const body = { uebersicht: viewFinOverview, planung: viewFinPlan, kategorien: viewFinCategories, rueckblick: viewFinReview }[state.finView]();
  return `${finHead()}${body}`;
}

const UI_GROUPS = [
  ['Reiter unten', [['tab:heute', 'Heute'], ['tab:kalender', 'Kalender'], ['tab:todos', 'To-Dos'], ['tab:finanzen', 'Finanzen']]],
  ['Startseite', [['h:hero', 'Nächster Termin'], ['h:tiles', 'Kacheln'], ['h:termine', 'Termine heute'], ['h:todos', 'Zu erledigen'], ['h:geld', 'Geld']]],
  ['Finanzen: Reiter oben', [['fv:planung', 'Planung'], ['fv:kategorien', 'Kategorien'], ['fv:rueckblick', 'Rückblick']]],
  ['Finanzen: Übersicht', [['f:budget', 'Frei verfügbar'], ['f:konten', 'Konten'], ['f:monat', 'Monatszahlen'], ['f:schulden', 'Schulden']]],
  ['Finanzen: Planung', [['p:anstehend', 'Anstehend'], ['p:prognose', 'Prognose'], ['p:fest', 'Feste Posten']]],
];

function viewSettings() {
  const chipsOf = (list, k) =>
    list
      .map((c, i) => `<span class="chip"><button class="chipname" data-a="rencat" data-k="${k}" data-i="${i}" aria-label="${esc(c)} umbenennen">${esc(c)}</button><button data-a="delcat" data-k="${k}" data-i="${i}" aria-label="${esc(c)} entfernen">×</button></span>`)
      .join('');
  const chips = state.categories
    .map((c, i) => `<span class="chip"><button class="chipname" data-a="rencat" data-k="exp" data-i="${i}" aria-label="${esc(c)} umbenennen">${esc(c)}</button><button data-a="delcat" data-k="exp" data-i="${i}" aria-label="${esc(c)} entfernen">×</button></span>`)
    .join('');
  const account = DEMO
    ? `<p class="hint">Demo-Modus: Die Daten liegen nur in diesem Browser und werden nicht synchronisiert.</p>
       <button class="btn block" data-a="exitdemo">Demo beenden und anmelden</button>`
    : `<p class="hint">Angemeldet als ${esc(state.user?.email)}</p><button class="btn block" data-a="logout">Abmelden</button>`;
  const rpc = `${SUPABASE_URL}/rest/v1/rpc/add_expense`;
  const connect = DEMO
    ? '<p class="hint">Im Demo-Modus nicht verfügbar. Melde dich an, um Apple Pay und das Widget zu verbinden.</p>'
    : state.token
      ? `<p class="hint">Dein geheimes Token. Wer es kennt, kann Ausgaben eintragen und die Widget-Übersicht lesen.</p>
         <div class="code">${esc(state.token)}</div>
         <div class="btnrow"><button class="btn small" data-a="copytoken">Token kopieren</button><button class="btn small danger" data-a="gentoken">Neu erzeugen</button></div>
         <details style="margin-top:14px"><summary>Apple-Pay-Kurzbefehl einrichten</summary>
           <ol class="steps">
             <li>Kurzbefehle-App → <b>Automation</b> → <b>+</b> → <b>Transaktion</b>. Karte auswählen, „Sofort ausführen“ → Weiter → „Neue leere Automation“.</li>
             <li>Aktion <b>Liste</b> hinzufügen und deine Kategorien eintragen.</li>
             <li>Aktion <b>Aus Liste auswählen</b> (Hinweis: „Kategorie?“).</li>
             <li>Aktion <b>Inhalte von URL abrufen</b>, Methode <b>POST</b>, URL:
               <div class="code">${esc(rpc)}</div>
               Header <b>apikey</b>:
               <div class="code">${esc(SUPABASE_KEY)}</div>
               Anforderungstext <b>JSON</b> mit vier Textfeldern:<br>
               <b>p_token</b> = dein Token<br>
               <b>p_amount</b> = Kurzbefehlseingabe → Betrag<br>
               <b>p_merchant</b> = Kurzbefehlseingabe → Händler<br>
               <b>p_category</b> = Ausgewähltes Objekt</li>
           </ol>
           <p class="hint">Die ausführliche Anleitung steht in ANLEITUNG.md.</p>
         </details>`
      : `<p class="hint">Erzeuge ein Token, damit der Apple-Pay-Kurzbefehl Ausgaben eintragen und das Widget deine Übersicht lesen kann.</p>
         <button class="btn primary block" data-a="gentoken">Token erzeugen</button>`;
  return `${head('Einstellungen')}
    <section class="card"><h2>Konto</h2>${account}</section>
    <section class="card"><h2>Ansicht anpassen</h2>
      <p class="hint" style="margin-top:0">Schalte aus, was du nicht brauchst. Das gilt nur für dieses Gerät.</p>
      ${UI_GROUPS.map(([title, items]) => `<div class="swgroup"><h4>${title}</h4>${items.map(([id, label]) => `<label class="swrow"><span>${label}</span><input type="checkbox" class="sw" data-a="toggleui" data-id="${id}" ${shown(id) ? 'checked' : ''}></label>`).join('')}</div>`).join('')}
    </section>
    <section class="card"><h2>Darstellung</h2>
      <div class="swatches">${ACCENTS.map(([c, n]) => `<button class="sw ${(getLook().accent || ACCENTS[0][0]) === c ? 'on' : ''}" style="--c:${c}" data-a="setaccent" data-c="${c}" aria-label="${n}"></button>`).join('')}</div>
      <div class="seg" style="margin:0">${[['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, l]) => `<button class="${getLook().theme === v ? 'on' : ''}" data-a="settheme" data-t="${v}">${l}</button>`).join('')}</div>
    </section>
    <section class="card"><h2>Kategorien für Ausgaben</h2><p class="hint">Tippe auf eine Kategorie, um sie umzubenennen. Bestehende Buchungen werden mit umbenannt.</p><div class="chips">${chips}</div>
      <form class="inline" data-f="addcat"><input name="cat" placeholder="Neue Kategorie" maxlength="40" aria-label="Neue Kategorie"><button class="btn">Hinzufügen</button></form>
      ${suggestedCategories().length ? `<button class="btn block" data-a="addsuggested" style="margin-top:10px">${suggestedCategories().length} Vorschläge hinzufügen</button><p class="hint" style="margin:6px 0 0">${esc(suggestedCategories().join(', '))}</p>` : ''}
    </section>
    <section class="card"><h2>Kategorien für Einnahmen</h2><p class="hint">Z. B. Gehalt. Sie erscheinen bei „Einnahme“ in der Kategorie-Auswahl.</p><div class="chips">${chipsOf(state.incomeCategories, 'inc')}</div>
      <form class="inline" data-f="addinc"><input name="cat" placeholder="Neue Kategorie" maxlength="40" aria-label="Neue Einnahme-Kategorie"><button class="btn">Hinzufügen</button></form>
    </section>
    ${
      state.isOwner
        ? `<section class="card"><h2>Personen einladen</h2>
      <p class="hint">Nur eingeladene E-Mail-Adressen können sich ein Konto erstellen. Jede Person bekommt ein eigenes Konto mit eigenen Daten und sieht deine Einträge nicht.</p>
      ${
        state.invites.length
          ? `<ul class="list">${state.invites
              .map(
                (i) =>
                  `<li class="row"><span class="main"><span class="title">${esc(i.email)}</span></span><a class="btn small" href="${esc(inviteMailto(i.email))}">Mail</a><button class="btn small danger" data-a="delinvite" data-id="${i.id}" aria-label="Einladung für ${esc(i.email)} zurückziehen">Entfernen</button></li>`,
              )
              .join('')}</ul>`
          : ''
      }
      <form class="inline" data-f="invite" style="margin-top:10px"><input name="email" type="email" required placeholder="E-Mail-Adresse" aria-label="E-Mail-Adresse der Person" autocomplete="off"><button class="btn">Einladen</button></form>
    </section>`
        : ''
    }
    <section class="card"><h2>Kalender</h2>
      ${
        state.calendars.length
          ? `<ul class="list">${state.calendars
              .map(
                (c) =>
                  `<li class="row"><i class="caldot" style="background:${safeColor(c.color)}"></i><button class="main" data-a="editcal" data-id="${c.id}"><span class="title">${esc(c.name)}</span></button><span class="sub">Bearbeiten</span></li>`,
              )
              .join('')}</ul>`
          : '<p class="hint">Lege Kalender an, z. B. Privat, Arbeit oder Uni. Jeder bekommt eine eigene Farbe.</p>'
      }
      <button class="btn block" data-a="addcal" style="margin-top:10px">Neuer Kalender</button>
    </section>
    <section class="card"><h2>Kalender importieren</h2>
      <p class="hint">Termine aus Apple Kalender, Google Kalender oder Outlook übernehmen: dort den Kalender als .ics-Datei exportieren und hier auswählen. Bereits vorhandene Termine werden übersprungen.</p>
      <label class="btn block">.ics-Datei auswählen<input type="file" accept=".ics,text/calendar" data-c="icsfile" hidden></label>
    </section>
    <section class="card"><h2>Apple Pay &amp; Widget</h2>${connect}</section>`;
}

function renderAuth() {
  const signup = state.authMode === 'signup';
  $app.dataset.anim = '';
  $app.innerHTML = `<div class="auth">
    <h1>Planer</h1><p>Kalender, To-Dos und Finanzen auf allen Geräten.</p>
    ${state.authMsg ? `<div class="msg ${state.authMsg.err ? 'err' : ''}">${esc(state.authMsg.text)}</div>` : ''}
    <form data-f="auth">
      <label class="field"><span>E-Mail</span><input name="email" type="email" autocomplete="email" required value="${esc(state.authEmail)}"></label>
      <label class="field"><span>Passwort</span><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required></label>
      <button class="btn primary block">${signup ? 'Konto erstellen' : 'Anmelden'}</button>
    </form>
    ${ALLOW_SIGNUP ? `<div class="center"><button class="linkbtn" data-a="authmode">${signup ? 'Ich habe schon ein Konto' : 'Mit Einladung registrieren'}</button></div>` : ''}
  </div>`;
}

function render() {
  const authed = state.user || DEMO;
  document.body.classList.toggle('auth-mode', !authed);
  if (!authed) {
    $bar.hidden = true;
    $fab.hidden = true;
    return renderAuth();
  }
  const view = { heute: viewToday, kalender: viewCal, todos: viewTodos, finanzen: viewFin, mehr: viewSettings }[state.tab]();
  // Eintritts-Animationen laufen nur nach einem Wechsel (Tab, Monat, Tag), nicht bei jedem Neuzeichnen.
  $app.dataset.anim = state.anim || '';
  state.anim = null;
  $app.innerHTML = `${state.error ? `<div class="msg err">${esc(state.error)}</div>` : ''}<main class="page" data-view="${state.tab}">${view}</main>`;
  state.justToggled = null;
  updateBar();
  updateFab();
}

// ---------- Formular-Sheet ----------
function fieldHTML(f) {
  if (Array.isArray(f)) return `<div class="two">${f.map(fieldHTML).join('')}</div>`;
  const v = esc(f.value ?? '');
  const req = f.required ? 'required' : '';
  let input;
  if (f.type === 'select') {
    input = `<select name="${f.name}" ${req}>${f.options
      .map(([val, label]) => `<option value="${esc(val)}" ${String(f.value ?? '') === String(val) ? 'selected' : ''}>${esc(label)}</option>`)
      .join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea name="${f.name}" rows="4" ${req} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>${v}</textarea>`;
  } else {
    input = `<input name="${f.name}" type="${f.type || 'text'}" value="${v}" ${req} ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} autocomplete="off">`;
  }
  return `<label class="field" ${f.showIf ? `data-if="${esc(f.showIf)}"` : ''}><span>${esc(f.label)}</span>${input}</label>`;
}

// Schließt das Sheet mit Animation.
function closeSheet() {
  if (!$sheet.open || $sheet.classList.contains('closing')) return;
  $sheet.classList.add('closing');
  setTimeout(() => {
    $sheet.close();
    $sheet.classList.remove('closing');
  }, 250);
}

function openSheet({ title, text, fields = [], saveLabel = 'Speichern', onSave, onDelete }) {
  $sheet.innerHTML = `<form><div class="grab"></div><h3>${esc(title)}</h3>${text ? `<p class="hint">${esc(text)}</p>` : ''}${fields.map(fieldHTML).join('')}
    <div class="btnrow">
      ${onDelete ? '<button type="button" class="btn danger" data-s="del">Löschen</button>' : ''}
      <button type="button" class="btn" data-s="cancel">Abbrechen</button>
      <button class="btn primary grow">${esc(saveLabel)}</button>
    </div></form>`;
  const form = $sheet.querySelector('form');
  // Felder mit data-if="feld=wert" (oder "feld!=wert") sind nur sichtbar, solange die Bedingung gilt.
  // Mehrere Bedingungen: "a&b" (alle) oder "a|b" (eine).
  const syncVisibility = () => {
    for (const el of form.querySelectorAll('[data-if]')) {
      // "a|b" = eine der Bedingungen genügt, "a&b" = alle müssen gelten.
      const test = (cond) => {
        const m = cond.match(/^(.+?)(!?=)(.*)$/);
        const current = form.elements[m[1]]?.value;
        return m[2] === '=' ? current === m[3] : current !== m[3];
      };
      el.hidden = !el.dataset.if.split('|').some((alt) => alt.split('&').every(test));
      for (const c of el.querySelectorAll('input, select, textarea')) c.disabled = el.hidden;
    }
  };
  form.addEventListener('change', syncVisibility);
  syncVisibility();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const values = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim() === '' ? null : String(v).trim()]));
    if ((await onSave(values)) !== false) closeSheet();
  };
  $sheet.querySelector('[data-s="cancel"]').onclick = () => closeSheet();
  if (onDelete) {
    $sheet.querySelector('[data-s="del"]').onclick = async () => {
      if ((await onDelete()) !== false) closeSheet();
    };
  }
  $sheet.showModal();
}
$sheet.addEventListener('click', (e) => {
  if (e.target === $sheet) closeSheet();
});

// Auswahlfeld "Kalender" für Formulare. Über "+ Neuer Kalender" lässt sich direkt im Formular
// ein Kalender mit Name und Farbe anlegen; die beiden Zusatzfelder erscheinen nur dann.
const NEW_CAL = '__new__';
function calendarField(value) {
  const known = state.calendars.some((c) => c.id === value);
  const used = new Set(state.calendars.map((c) => c.color));
  const nextColor = (CAL_COLORS.find(([c]) => !used.has(c)) || CAL_COLORS[0])[0];
  return [
    {
      name: 'calendar_id',
      label: 'Kalender',
      type: 'select',
      value: known ? value : '',
      options: [['', 'Ohne Kalender'], ...state.calendars.map((c) => [c.id, c.name]), [NEW_CAL, '+ Neuer Kalender …']],
    },
    [
      { name: 'new_cal_name', label: 'Name des neuen Kalenders', placeholder: 'z. B. Privat', showIf: `calendar_id=${NEW_CAL}` },
      { name: 'new_cal_color', label: 'Farbe', type: 'select', value: nextColor, options: CAL_COLORS, showIf: `calendar_id=${NEW_CAL}` },
    ],
  ];
}

function newCalendarMissingName(v) {
  if (v.calendar_id !== NEW_CAL || v.new_cal_name) return false;
  toast('Bitte einen Namen für den neuen Kalender eingeben.');
  return true;
}

// Legt bei Bedarf den neuen Kalender an und liefert die Formularwerte mit echter calendar_id zurück.
async function resolveCalendar({ new_cal_name, new_cal_color, ...v }) {
  if (v.calendar_id === NEW_CAL) {
    const cal = await db.insert('calendars', { name: new_cal_name, color: new_cal_color });
    v.calendar_id = cal.id;
  }
  return v;
}

function calendarForm(cal) {
  const used = new Set(state.calendars.map((c) => c.color));
  const nextColor = (CAL_COLORS.find(([c]) => !used.has(c)) || CAL_COLORS[0])[0];
  openSheet({
    title: cal ? 'Kalender bearbeiten' : 'Neuer Kalender',
    text: cal ? 'Beim Löschen bleiben die Termine erhalten, sie gehören dann zu keinem Kalender mehr.' : '',
    fields: [
      { name: 'name', label: 'Bezeichnung', required: true, value: cal?.name, placeholder: 'z. B. Privat, Arbeit, Uni' },
      { name: 'color', label: 'Farbe', type: 'select', value: cal?.color || nextColor, options: CAL_COLORS },
    ],
    onSave: (v) => run(() => (cal ? db.update('calendars', cal.id, v) : db.insert('calendars', v)), 'Gespeichert'),
    onDelete: cal && (() => run(() => db.remove('calendars', cal.id), 'Gelöscht')),
  });
}

function eventForm(ev) {
  openSheet({
    title: ev ? 'Termin bearbeiten' : 'Neuer Termin',
    fields: [
      { name: 'title', label: 'Titel', required: true, value: ev?.title },
      [
        { name: 'date', label: 'Von', type: 'date', required: true, value: ev?.date || state.selDate },
        { name: 'end_date', label: 'Bis (optional)', type: 'date', value: ev?.end_date },
      ],
      [
        { name: 'start_time', label: 'Beginn', type: 'time', value: ev?.start_time?.slice(0, 5) },
        { name: 'end_time', label: 'Ende', type: 'time', value: ev?.end_time?.slice(0, 5) },
      ],
      ...calendarField(ev ? ev.calendar_id : state.lastCal),
      // Beim Bearbeiten: Kalender nur für diesen Termin oder für alle Termine mit demselben Titel setzen
      // (z. B. alle Termine einer importierten Serie).
      ...(ev
        ? [
            {
              name: 'scope',
              label: 'Kalender zuweisen für',
              type: 'select',
              value: 'one',
              options: [
                ['one', 'Nur diesen Termin'],
                ['all', `Alle Termine „${ev.title}“`],
                ['none', 'Alle Termine ohne Kalender'],
              ],
            },
          ]
        : []),
      { name: 'note', label: 'Notiz', value: ev?.note },
    ],
    onSave: ({ scope, ...raw }) => {
      if (raw.end_date && raw.end_date < raw.date) {
        toast('„Bis“ liegt vor „Von“.');
        return false;
      }
      if (raw.end_date === raw.date) raw.end_date = null;
      if (newCalendarMissingName(raw)) return false;
      return run(async () => {
        const v = await resolveCalendar(raw);
        state.lastCal = v.calendar_id;
        if (ev) await db.update('events', ev.id, v);
        else await db.insert('events', v);
        if (ev && scope === 'all') await db.updateWhere('events', 'title', ev.title, { calendar_id: v.calendar_id });
        if (ev && scope === 'none' && v.calendar_id) await db.updateWhere('events', 'calendar_id', null, { calendar_id: v.calendar_id });
        state.selDate = v.date;
        state.calMonth = monthStart(parseISO(v.date));
      }, 'Gespeichert');
    },
    onDelete: ev && (() => run(() => db.remove('events', ev.id), 'Gelöscht')),
  });
}

function listForm(list) {
  const used = new Set(state.todoLists.map((l) => l.color));
  const nextColor = (CAL_COLORS.find(([c]) => !used.has(c)) || CAL_COLORS[0])[0];
  openSheet({
    title: list ? 'Liste bearbeiten' : 'Neue Liste',
    text: list ? 'Beim Löschen bleiben die To-Dos erhalten, sie gehören dann zu keiner Liste mehr.' : 'Zum Beispiel Uni, Privat, Arbeit oder Wichtig.',
    fields: [
      { name: 'name', label: 'Bezeichnung', required: true, value: list?.name, placeholder: 'z. B. Uni, Wichtig, Freizeit' },
      { name: 'color', label: 'Farbe', type: 'select', value: list?.color || nextColor, options: CAL_COLORS },
    ],
    onSave: (v) =>
      run(async () => {
        if (list) await db.update('todo_lists', list.id, v);
        else state.listFilter = (await db.insert('todo_lists', v)).id;
      }, 'Gespeichert'),
    onDelete:
      list &&
      (() =>
        run(async () => {
          await db.remove('todo_lists', list.id);
          if (state.listFilter === list.id) state.listFilter = 'alle';
        }, 'Gelöscht')),
  });
}

function todoForm(td) {
  openSheet({
    title: td ? 'To-Do bearbeiten' : 'Neues To-Do',
    fields: [
      { name: 'title', label: 'Was ist zu tun?', required: true, value: td?.title },
      [
        { name: 'priority', label: 'Priorität', type: 'select', value: td?.priority || 'mittel', options: Object.entries(PRIO_LABEL) },
        { name: 'due_date', label: 'Fällig am', type: 'date', value: td?.due_date },
      ],
      ...(state.todoLists.length
        ? [{ name: 'list_id', label: 'Liste', type: 'select', value: (td ? listOf(td)?.id : state.todoLists.find((l) => l.id === state.listFilter)?.id) || '', options: [['', 'Keine Liste'], ...state.todoLists.map((l) => [l.id, l.name])] }]
        : []),
      { name: 'due_time', label: 'Uhrzeit (optional)', type: 'time', value: td?.due_time?.slice(0, 5) },
      { name: 'note', label: 'Notiz (optional)', type: 'textarea', value: td?.note, placeholder: 'Details, Links, woran du denken willst …' },
    ],
    onSave: (v) => {
      // Eine Uhrzeit ohne Datum hat keinen Bezugstag, deshalb gilt sie für heute.
      if (v.due_time && !v.due_date) v.due_date = today();
      return run(() => (td ? db.update('todos', td.id, v) : db.insert('todos', { ...v, done: false })), 'Gespeichert');
    },
    onDelete: td && (() => run(() => db.remove('todos', td.id), 'Gelöscht')),
  });
}

// Kategorie-Auswahl je nach Art: bei Ausgabe die Ausgaben-Kategorien, bei Einnahme die Einnahme-Kategorien.
// Beide Felder heißen "category"; gespeichert wird nur das gerade sichtbare.
function categoryFields(type, value) {
  const isInc = type === 'einnahme';
  const list = (base, own) => {
    const l = [...base];
    if (own && value && !l.includes(value)) l.unshift(value);
    return [['', 'Ohne Kategorie'], ...l.map((c) => [c, c])];
  };
  return [
    { name: 'category', label: 'Kategorie', type: 'select', value: isInc ? '' : value || '', options: list(state.categories, !isInc), showIf: 'type=ausgabe' },
    { name: 'category', label: 'Kategorie', type: 'select', value: isInc ? value || '' : '', options: list(state.incomeCategories, isInc), showIf: 'type=einnahme' },
  ];
}

// Auswahl "Konto": nur genutzte Konten (das aktuell gewählte bleibt auch dann sichtbar, wenn es nicht mehr genutzt wird).
function accountField(selected) {
  if (!state.accounts.length) return [];
  const opts = state.accounts.filter((a) => a.active || a.id === selected).map((a) => [a.id, a.name]);
  return [{ name: 'account_id', label: 'Konto', type: 'select', value: selected || '', options: [['', 'Kein Konto'], ...opts] }];
}

// Konto-Auswahl für Buchungen. Bei "Umbuchung" gibt es "Von Konto" und "Nach Konto", sonst ein Feld "Konto".
// Beide "account_id"-Felder gehören zusammen; gespeichert wird nur das sichtbare.
function txAccountFields(tx, defAcc) {
  if (!state.accounts.length) return [];
  const isTransfer = tx?.type === 'umbuchung';
  const from = isTransfer ? tx.account_id : tx ? tx.account_id : defAcc;
  const defFrom = state.accounts.find((a) => a.active && a.kind === 'giro')?.id || defAcc;
  const defTo = state.accounts.find((a) => a.active && a.kind === 'kredit' && a.id !== defFrom)?.id || '';
  const opts = (sel) => state.accounts.filter((a) => a.active || a.id === sel).map((a) => [a.id, a.name]);
  const fromSel = isTransfer ? from : defFrom;
  const toSel = isTransfer ? tx.to_account_id : defTo;
  return [
    { name: 'account_id', label: 'Konto', type: 'select', value: tx ? from : defAcc, options: [['', 'Kein Konto'], ...opts(from)], showIf: 'type!=umbuchung' },
    [
      { name: 'account_id', label: 'Von Konto', type: 'select', value: fromSel || '', options: [['', 'Bitte wählen'], ...opts(fromSel)], showIf: 'type=umbuchung' },
      { name: 'to_account_id', label: 'Nach Konto', type: 'select', value: toSel || '', options: [['', 'Bitte wählen'], ...opts(toSel)], showIf: 'type=umbuchung' },
    ],
  ];
}

function txForm(tx, preset = {}) {
  const inMonth = iso(monthStart(state.finMonth)) === iso(monthStart(new Date()));
  const defAcc = preset.acc || state.accounts.find((a) => a.id === state.lastAcc && a.active)?.id || state.accounts.find((a) => a.active)?.id || '';
  const type0 = tx?.type || preset.type || 'ausgabe';
  openSheet({
    title: tx ? 'Buchung bearbeiten' : 'Neue Buchung',
    text: tx?.type === 'umbuchung' ? 'Eine Umbuchung verschiebt Geld zwischen deinen Konten. Sie zählt nicht als Einnahme oder Ausgabe.' : '',
    fields: [
      [
        { name: 'type', label: 'Art', type: 'select', value: type0, options: [['ausgabe', 'Ausgabe'], ['einnahme', 'Einnahme'], ['umbuchung', 'Umbuchung (zwischen Konten)']] },
        { name: 'amount', label: 'Betrag (€)', required: true, inputmode: 'decimal', placeholder: '0,00', value: tx ? String(tx.amount).replace('.', ',') : '' },
      ],
      ...categoryFields(type0, tx?.category),
      ...txAccountFields(tx, defAcc),
      { name: 'merchant', label: 'Händler / Bezeichnung', value: tx?.merchant, placeholder: 'z. B. Kartenausgleich' },
      // Neu: einmalig oder wiederkehrend (z. B. Gehalt) mit Zeitraum. "Bis" leer = unbefristet.
      ...(tx
        ? []
        : [
            {
              name: 'repeat',
              label: 'Wiederholung',
              type: 'select',
              value: '0',
              options: [['0', 'Einmalig'], ['1', 'Jeden Monat'], ['3', 'Jedes Quartal'], ['12', 'Jedes Jahr']],
              showIf: 'type!=umbuchung',
            },
          ]),
      { name: 'date', label: 'Datum', type: 'date', required: true, value: tx?.date || (inMonth ? today() : iso(state.finMonth)), showIf: tx ? '' : 'repeat=0|type=umbuchung' },
      ...(tx
        ? []
        : [
            [
              { name: 'start_date', label: 'Von', type: 'date', required: true, value: inMonth ? today() : iso(state.finMonth), showIf: 'repeat!=0&type!=umbuchung' },
              { name: 'end_date', label: 'Bis (leer = unbefristet)', type: 'date', showIf: 'repeat!=0&type!=umbuchung' },
            ],
          ]),
      { name: 'note', label: 'Notiz', value: tx?.note },
    ],
    onSave: (v) => {
      const amount = parseAmount(v.amount);
      if (amount === null) {
        toast('Bitte einen gültigen Betrag eingeben.');
        return false;
      }
      if (v.type === 'umbuchung') {
        if (!v.account_id || !v.to_account_id || v.account_id === v.to_account_id) {
          toast('Bitte zwei verschiedene Konten wählen.');
          return false;
        }
      } else if (v.account_id) state.lastAcc = v.account_id;
      // Wiederkehrend: wird als fester Posten gespeichert und zählt in jedem fälligen Monat mit.
      if (!tx && v.repeat && v.repeat !== '0') {
        if (v.end_date && v.end_date < v.start_date) {
          toast('„Bis“ liegt vor „Von“.');
          return false;
        }
        const rec = {
          name: v.merchant || v.category || (v.type === 'einnahme' ? 'Einnahme' : 'Ausgabe'),
          type: v.type,
          amount,
          category: v.category,
          account_id: v.account_id ?? null,
          interval_months: Number(v.repeat),
          start_date: v.start_date,
          end_date: v.end_date,
        };
        return run(async () => {
          await db.insert('recurring', rec);
          state.finView = 'planung';
        }, v.type === 'einnahme' ? 'Feste Einnahme gespeichert' : 'Feste Ausgabe gespeichert');
      }
      const { repeat, start_date, end_date, ...single } = v;
      const row = { ...single, amount };
      // Umbuchung: Zielkonto, keine Kategorie. Sonst Zielkonto leeren (z. B. nach dem Umstellen der Art).
      row.to_account_id = v.type === 'umbuchung' ? v.to_account_id : null;
      if (v.type === 'umbuchung') row.category = null;
      return run(async () => {
        if (tx) await db.update('transactions', tx.id, row);
        else await db.insert('transactions', { ...row, source: 'manuell' });
        state.finMonth = monthStart(parseISO(v.date));
      }, 'Gespeichert');
    },
    onDelete: tx && (() => run(() => db.remove('transactions', tx.id), 'Gelöscht')),
  });
}

function recForm(rec, presetType) {
  const type = rec?.type || presetType || 'ausgabe';
  const income = type === 'einnahme';
  const defAcc = rec ? rec.account_id : state.accounts.find((a) => a.active && a.kind === 'giro')?.id || state.accounts.find((a) => a.active)?.id || '';
  openSheet({
    title: income ? (rec ? 'Feste Einnahme bearbeiten' : 'Neue feste Einnahme') : rec ? 'Feste Ausgabe bearbeiten' : 'Neue feste Ausgabe',
    text: income
      ? '„Bis“ ist der letzte Tag, an dem du diese Einnahme bekommst, z. B. bis zum Jobwechsel. Ohne „Bis“ läuft sie unbefristet. Eine neue Stelle trägst du als weitere Einnahme mit „Von“ ein.'
      : 'Mit „Bis“ endet die Ausgabe an diesem Tag und fällt danach automatisch weg. Ohne „Bis“ läuft sie unbefristet.',
    fields: [
      { name: 'name', label: 'Bezeichnung', required: true, value: rec?.name, placeholder: income ? 'z. B. Gehalt, Kindergeld' : 'z. B. Netflix, Miete, Handyvertrag' },
      [
        { name: 'type', label: 'Art', type: 'select', value: type, options: [['ausgabe', 'Ausgabe'], ['einnahme', 'Einnahme']] },
        { name: 'amount', label: 'Betrag (€)', required: true, inputmode: 'decimal', placeholder: '0,00', value: rec ? String(rec.amount).replace('.', ',') : '' },
      ],
      [
        { name: 'interval_months', label: 'Rhythmus', type: 'select', value: rec?.interval_months || 1, options: Object.entries(INTERVALS) },
      ],
      ...categoryFields(type, rec ? rec.category : !income && state.categories.includes('Abo') ? 'Abo' : income && state.incomeCategories.includes('Gehalt') ? 'Gehalt' : ''),
      ...accountField(defAcc),
      [
        { name: 'start_date', label: 'Von', type: 'date', required: true, value: rec?.start_date || today() },
        { name: 'end_date', label: 'Bis (leer = unbefristet)', type: 'date', value: rec?.end_date },
      ],
    ],
    onSave: (v) => {
      const amount = parseAmount(v.amount);
      if (amount === null) {
        toast('Bitte einen gültigen Betrag eingeben.');
        return false;
      }
      if (v.end_date && v.end_date < v.start_date) {
        toast('„Bis“ liegt vor „Von“.');
        return false;
      }
      const row = { ...v, amount, interval_months: Number(v.interval_months) };
      return run(() => (rec ? db.update('recurring', rec.id, row) : db.insert('recurring', row)), 'Gespeichert');
    },
    onDelete: rec && (() => run(() => db.remove('recurring', rec.id), 'Gelöscht')),
  });
}

// Kontostand: "12.345,67", bei anderen Konten auch mit Minus (Dispo).
function parseBalance(str) {
  const neg = /[-−–]/.test(String(str));
  const n = parseAmount(String(str).replace(/[-−–]/g, ''));
  return n === null ? null : neg ? -n : n;
}

function accForm(acc) {
  const cur = acc ? balancesNow().get(acc.id) : null;
  const shown = acc ? (acc.kind === 'kredit' ? Math.abs(cur.value) : cur.value) : '';
  openSheet({
    title: acc ? 'Konto bearbeiten' : 'Neues Konto',
    text: `${
      acc
        ? `Aktuell berechnet: ${eur.format(cur.value)}. Das ist dein Eintrag vom ${fullDate(acc.balance_date)} (${eur.format(cur.base)}) plus alle Buchungen und fälligen festen Posten seitdem. `
        : 'Gib den Stand ein, den dein Konto jetzt hat. Ab dann rechnet die App neue Buchungen automatisch dazu. '
    }Weicht der Betrag von deiner Bank ab, trage hier den richtigen ein. Bei einer Kreditkarte gibst du das Limit und den noch verfügbaren Betrag ein.`,
    fields: [
      { name: 'name', label: 'Bezeichnung', required: true, value: acc?.name, placeholder: 'z. B. ING, Trade Republic' },
      [
        { name: 'kind', label: 'Art', type: 'select', value: acc?.kind || 'giro', options: Object.entries(KINDS) },
        { name: 'active', label: 'Wird genutzt', type: 'select', value: acc && !acc.active ? '0' : '1', options: [['1', 'Ja'], ['0', 'Nein']] },
      ],
      { name: 'credit_limit', label: 'Kreditlimit (€)', showIf: 'kind=kredit', inputmode: 'decimal', placeholder: '6000', value: acc?.credit_limit ? String(acc.credit_limit).replace('.', ',') : '' },
      [
        { name: 'balance', label: 'Kontostand (€)', required: true, showIf: 'kind!=kredit', placeholder: '0,00', value: acc ? String(shown).replace('.', ',') : '' },
        { name: 'avail', label: 'Noch verfügbar (€)', required: true, showIf: 'kind=kredit', inputmode: 'decimal', placeholder: '0,00', value: acc && acc.credit_limit ? String(Math.round((Number(acc.credit_limit) + cur.value) * 100) / 100).replace('.', ',') : '' },
        { name: 'balance_date', label: 'Stand vom', type: 'date', value: today() },
      ],
    ],
    onSave: (v) => {
      let balance;
      let limit = null;
      if (v.kind === 'kredit') {
        // Kreditkarte: Limit und noch verfügbarer Betrag; intern wird der genutzte Betrag als Minus gespeichert.
        limit = parseAmount(v.credit_limit);
        const avail = parseAmount(v.avail);
        if (limit === null || avail === null) {
          toast('Bitte Kreditlimit und verfügbaren Betrag eingeben.');
          return false;
        }
        balance = -(limit - avail);
      } else {
        balance = parseBalance(v.balance);
        if (balance === null) {
          toast('Bitte einen gültigen Kontostand eingeben.');
          return false;
        }
      }
      // Ändert sich der Betrag nicht (z. B. nur der Name), bleibt der alte Eintrag samt Datum bestehen.
      const unchanged = acc && acc.balance_date && Math.abs(balance - cur.value) < 0.005;
      const row = { name: v.name, kind: v.kind, active: v.active === '1', credit_limit: limit };
      if (!unchanged) Object.assign(row, { balance, balance_date: v.balance_date || today(), balance_set_at: new Date().toISOString() });
      return run(() => (acc ? db.update('accounts', acc.id, row) : db.insert('accounts', row)), 'Gespeichert');
    },
    onDelete: acc && (() => run(() => db.remove('accounts', acc.id), 'Gelöscht')),
  });
}

// Benennt eine Kategorie um. Bestehende Buchungen und feste Posten werden mit umbenannt.
// Der alte Name bleibt als Alias gespeichert, damit der Apple-Pay-Kurzbefehl weiter funktioniert.
async function doRename(old, name) {
  const cats = state.categories.map((c) => (c === old ? name : c));
  const aliases = { ...state.aliases };
  for (const k of Object.keys(aliases)) if (aliases[k] === old) aliases[k] = name;
  aliases[old] = name;
  await db.saveSettings({ categories: cats, category_aliases: aliases });
  await db.updateWhere('transactions', 'category', old, { category: name });
  await db.updateWhere('recurring', 'category', old, { category: name });
  state.categories = cats;
  state.aliases = aliases;
}

function renameCategory(i, k = 'exp') {
  if (k === 'inc') return renameIncomeCategory(i);
  const old = state.categories[i];
  openSheet({
    title: 'Kategorie umbenennen',
    text: 'Der Apple-Pay-Kurzbefehl darf den alten Namen weiter senden, er wird automatisch in den neuen umgewandelt.',
    fields: [{ name: 'name', label: 'Name', required: true, value: old }],
    onSave: (v) => {
      const name = v.name.trim();
      if (name === old) return true;
      if (state.categories.includes(name)) {
        toast('Diese Kategorie gibt es schon.');
        return false;
      }
      return run(() => doRename(old, name), 'Umbenannt');
    },
  });
}

// Einnahme-Kategorien: Umbenennen ändert auch bestehende Buchungen und feste Posten mit diesem Namen.
function renameIncomeCategory(i) {
  const old = state.incomeCategories[i];
  openSheet({
    title: 'Kategorie umbenennen',
    fields: [{ name: 'name', label: 'Name', required: true, value: old }],
    onSave: (v) => {
      const name = v.name.trim();
      if (name === old) return true;
      if (state.incomeCategories.includes(name)) {
        toast('Diese Kategorie gibt es schon.');
        return false;
      }
      return run(async () => {
        await db.saveSettings({ income_categories: state.incomeCategories.map((c, j) => (j === i ? name : c)) });
        await db.updateWhere('transactions', 'category', old, { category: name });
        await db.updateWhere('recurring', 'category', old, { category: name });
      }, 'Umbenannt');
    },
  });
}

// Führt die Umbenennungen aus config.js (CATEGORY_RENAMES) aus, sobald der alte Name noch vorkommt.
async function applyConfigRenames() {
  let changed = false;
  for (const [old, name] of Object.entries(CATEGORY_RENAMES)) {
    if (!state.categories.includes(old) || state.categories.includes(name)) continue;
    await doRename(old, name);
    changed = true;
  }
  return changed;
}

// Vorschläge: Standard-Kategorien, die es (dem Namen nach) noch nicht gibt.
const catKey = (c) => c.toLowerCase().replace(/[^a-zäöüß]/g, '').slice(0, 6);
function suggestedCategories() {
  const have = new Set(state.categories.map(catKey));
  return DEFAULT_CATEGORIES.filter((c) => !have.has(catKey(c)));
}

// ---------- Kalender-Import (.ics) ----------
const icsUnescape = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function parseIcsDate(v) {
  const m = v.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { d: new Date(+y, mo - 1, +d), allDay: true };
  // "Z" = Weltzeit, wird in die Ortszeit des Geräts umgerechnet. Sonst gilt die Uhrzeit wie angegeben.
  return { d: z ? new Date(Date.UTC(+y, mo - 1, +d, +h, +mi, +(s || 0))) : new Date(+y, mo - 1, +d, +h, +mi), allDay: false };
}

function parseICS(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = [];
  let cur = null;
  let nested = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = { exdates: [] };
      nested = 0;
      continue;
    }
    if (!cur) continue;
    if (line === 'END:VEVENT') {
      if (cur.start) out.push(cur);
      cur = null;
      continue;
    }
    if (line.startsWith('BEGIN:')) nested++;
    else if (line.startsWith('END:')) nested--;
    else if (!nested) {
      const m = line.match(/^([A-Za-z0-9-]+)((?:;[^=;:]+=(?:"[^"]*"|[^;:]*))*):(.*)$/);
      if (!m) continue;
      const name = m[1].toUpperCase();
      const val = m[3];
      if (name === 'SUMMARY') cur.title = icsUnescape(val).trim();
      else if (name === 'DESCRIPTION') cur.desc = icsUnescape(val).trim();
      else if (name === 'LOCATION') cur.loc = icsUnescape(val).trim();
      else if (name === 'UID') cur.uid = val;
      else if (name === 'DTSTART') cur.start = parseIcsDate(val);
      else if (name === 'DTEND') cur.end = parseIcsDate(val);
      else if (name === 'RRULE') cur.rrule = val;
      else if (name === 'RECURRENCE-ID') cur.overrides = parseIcsDate(val);
      else if (name === 'STATUS' && val.trim() === 'CANCELLED') cur.cancelled = true;
      else if (name === 'EXDATE') {
        for (const v of val.split(',')) {
          const d = parseIcsDate(v);
          if (d) cur.exdates.push(iso(d.d));
        }
      }
    }
  }
  // Einzeln geänderte Termine einer Serie ersetzen den ursprünglichen Serientermin.
  for (const ev of out) {
    if (!ev.overrides) continue;
    const master = out.find((x) => x.uid === ev.uid && x.rrule);
    if (master) master.exdates.push(iso(ev.overrides.d));
  }
  return out;
}

// Liefert die Starttermine einer Serie. Seltene, komplexe Regeln (z. B. "jeder 2. Dienstag im Monat")
// werden nicht aufgelöst; dann kommt nur der erste Termin zurück.
function icsOccurrences(ev, horizon) {
  const start = ev.start.d;
  if (!ev.rrule) return { dates: [start], simplified: false };
  const r = Object.fromEntries(ev.rrule.split(';').map((p) => p.split('=')));
  const byday = (r.BYDAY || '').split(',').filter(Boolean);
  const supported = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.FREQ);
  if (!supported || r.BYSETPOS || byday.some((x) => /\d/.test(x)) || (byday.length && !['DAILY', 'WEEKLY'].includes(r.FREQ))) {
    return { dates: [start], simplified: true };
  }
  const interval = Math.max(1, +r.INTERVAL || 1);
  const count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? parseIcsDate(r.UNTIL) : null;
  let end = horizon;
  if (until) {
    const u = new Date(until.d.getFullYear(), until.d.getMonth(), until.d.getDate(), 23, 59, 59);
    if (u < end) end = u;
  }
  const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const [Y, M, D] = [start.getFullYear(), start.getMonth(), start.getDate()];
  const at = (y, m, d) => new Date(y, m, d, start.getHours(), start.getMinutes());
  const dates = [];
  const done = (d) => d > end || dates.length >= count;
  if (r.FREQ === 'DAILY') {
    for (let i = 0; i < 5000; i++) {
      const d = at(Y, M, D + i * interval);
      if (done(d)) break;
      if (!byday.length || byday.includes(DOW[d.getDay()])) dates.push(d);
    }
  } else if (r.FREQ === 'WEEKLY') {
    const days = byday.length ? byday.map((x) => DOW.indexOf(x)) : [start.getDay()];
    const monday = D - ((start.getDay() + 6) % 7);
    outer: for (let w = 0; w < 2000; w++) {
      for (let off = 0; off < 7; off++) {
        const d = at(Y, M, monday + w * 7 * interval + off);
        if (d < start) continue;
        if (done(d)) break outer;
        if (days.includes(d.getDay())) dates.push(d);
      }
    }
  } else {
    const step = r.FREQ === 'MONTHLY' ? interval : interval * 12;
    for (let i = 0; i < 2000; i++) {
      const d = at(Y, M + i * step, D);
      if (done(d)) break;
      if (d.getDate() === D) dates.push(d); // z. B. der 31. existiert nicht in jedem Monat
    }
  }
  return { dates, simplified: false };
}

function icsToRows(text) {
  const horizon = new Date();
  horizon.setFullYear(horizon.getFullYear() + 2);
  const rows = [];
  let simplified = 0;
  for (const ev of parseICS(text)) {
    if (ev.cancelled) continue;
    const occ = icsOccurrences(ev, horizon);
    if (occ.simplified) simplified++;
    const durMs = ev.end ? ev.end.d - ev.start.d : 0;
    const note = [ev.loc, ev.desc].filter(Boolean).join(' · ').replace(/\s+/g, ' ').slice(0, 300) || null;
    const title = (ev.title || '(Ohne Titel)').slice(0, 200);
    for (const d of occ.dates) {
      if (ev.exdates.includes(iso(d))) continue;
      if (ev.start.allDay) {
        // Mehrtägige ganztägige Termine (z. B. Urlaub) werden als ein Termin mit Von/Bis eingetragen.
        const days = Math.max(1, Math.round(durMs / 864e5) || 1);
        const last = days > 1 ? iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days - 1)) : null;
        rows.push({ title, date: iso(d), end_date: last, start_time: null, end_time: null, note });
      } else {
        const e = new Date(d.getTime() + durMs);
        rows.push({ title, date: iso(d), end_date: null, start_time: hm(d), end_time: durMs > 0 && iso(e) === iso(d) ? hm(e) : null, note });
      }
    }
  }
  return { rows, simplified };
}

async function importICS(file) {
  if (!file) return;
  try {
    const { rows, simplified } = icsToRows(await file.text());
    if (!rows.length) return toast('In der Datei wurden keine Termine gefunden.');
    const key = (r) => `${r.title}|${r.date}|${(r.start_time || '').slice(0, 5)}`;
    const have = new Set((await db.listAll('events')).map(key));
    const fresh = [];
    for (const r of rows) {
      const k = key(r);
      if (have.has(k)) continue;
      have.add(k);
      fresh.push(r);
    }
    if (!fresh.length) return toast('Alle Termine aus der Datei sind schon vorhanden.');
    const skipped = rows.length - fresh.length;
    const info = [
      skipped ? `${skipped} sind schon vorhanden und werden übersprungen.` : '',
      'Serientermine werden bis zwei Jahre in die Zukunft eingetragen.',
      simplified ? `Serien mit komplexer Regel (${simplified}) werden nur einmal eingetragen.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    openSheet({
      title: `${fresh.length} Termine importieren?`,
      text: info,
      saveLabel: 'Importieren',
      fields: calendarField(state.lastCal),
      onSave: (raw) =>
        !newCalendarMissingName(raw) &&
        run(async () => {
          const v = await resolveCalendar(raw);
          await db.insertMany('events', fresh.map((r) => ({ ...r, calendar_id: v.calendar_id || null })));
        }, `${fresh.length} Termine importiert`),
    });
  } catch (e) {
    toast(friendlyError(e));
  }
}

// ---------- Aussehen (Akzentfarbe, Hell/Dunkel) ----------
const ACCENTS = [
  ['#5b5cf0', 'Indigo'],
  ['#2f80ed', 'Blau'],
  ['#0ea5a4', 'Türkis'],
  ['#16a34a', 'Grün'],
  ['#f97316', 'Orange'],
  ['#e11d74', 'Pink'],
  ['#8b5cf6', 'Violett'],
];
function getLook() {
  try {
    return { accent: localStorage.getItem('planer-accent') || '', theme: localStorage.getItem('planer-theme') || 'auto' };
  } catch {
    return { accent: '', theme: 'auto' };
  }
}
function applyLook() {
  const { accent, theme } = getLook();
  const root = document.documentElement;
  if (/^#[0-9a-f]{6}$/i.test(accent)) root.style.setProperty('--accent', accent);
  else root.style.removeProperty('--accent');
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}
function setLook(patch) {
  try {
    if ('accent' in patch) localStorage.setItem('planer-accent', patch.accent);
    if ('theme' in patch) localStorage.setItem('planer-theme', patch.theme);
  } catch {
    /* Speicher nicht verfügbar */
  }
  applyLook();
  render();
}

// Scrollt weich zur Tagesansicht unter dem Monat.
function scrollToDay() {
  requestAnimationFrame(() => document.getElementById('dayDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// ---------- Aktionen ----------
function setCalMonth(m) {
  state.calMonth = m;
  const t = today();
  state.selDate = iso(monthStart(parseISO(t))) === iso(m) ? t : iso(m);
  return refresh();
}

const actions = {
  tab: (el) => {
    state.fabOpen = false;
    if (state.tab === el.dataset.tab) return window.scrollTo({ top: 0, behavior: 'smooth' });
    state.tab = el.dataset.tab;
    state.anim = 'view';
    render();
    window.scrollTo(0, 0);
  },
  fab: () => {
    state.fabOpen = !state.fabOpen;
    updateFab();
  },
  fabadd: (el) => {
    state.fabOpen = false;
    updateFab();
    if (el.dataset.k === 'tx') txForm(null, state.tab === 'finanzen' && state.accDetail ? { acc: state.accDetail } : {});
    else ({ event: eventForm, todo: todoForm })[el.dataset.k]();
  },
  addtx: () => txForm(null, { acc: state.accDetail, type: state.accSeg === 'ein' ? 'einnahme' : 'ausgabe' }),
  toggleui: (el) => {
    const id = el.dataset.id;
    if (state.hiddenUI.has(id)) state.hiddenUI.delete(id);
    else state.hiddenUI.add(id);
    saveHiddenUI();
    if (id.startsWith('tab:')) {
      buildBar();
      updateBar();
    }
  },
  addevent: () => eventForm(),
  todolist: (el) => {
    state.listFilter = el.dataset.id;
    render();
  },
  addlist: () => listForm(),
  editlist: (el) => listForm(state.todoLists.find((l) => l.id === el.dataset.id)),
  selday: (el) => {
    state.selDate = el.dataset.date;
    state.openEv = null;
    state.anim = 'day';
    render();
    scrollToDay();
  },
  goday: (el) => {
    state.tab = 'kalender';
    state.calView = 'monat';
    state.selDate = el.dataset.date;
    state.calMonth = monthStart(parseISO(el.dataset.date));
    state.openEv = null;
    state.anim = 'view';
    window.scrollTo(0, 0);
    return refresh().then(scrollToDay);
  },
  calview: (el) => {
    state.calView = el.dataset.v;
    state.anim = 'view';
    render();
    window.scrollTo(0, 0);
  },
  calprev: () => ((state.anim = 'prev'), setCalMonth(addMonths(state.calMonth, -1))),
  calnext: () => ((state.anim = 'next'), setCalMonth(addMonths(state.calMonth, 1))),
  caltoday: () => ((state.anim = 'view'), setCalMonth(monthStart(new Date()))),
  toggleev: (el) => {
    // Ohne Neuzeichnen, damit das Aufklappen weich animiert.
    const li = el.closest('.ev');
    const was = li.classList.contains('open');
    document.querySelectorAll('.ev.open').forEach((x) => {
      x.classList.remove('open');
      x.querySelector('.evtop')?.setAttribute('aria-expanded', 'false');
    });
    if (!was) {
      li.classList.add('open');
      el.setAttribute('aria-expanded', 'true');
    }
    state.openEv = was ? null : li.dataset.id;
  },
  delevent: (el) => {
    if (!confirm('Diesen Termin löschen?')) return;
    state.openEv = null;
    return run(() => db.remove('events', el.dataset.id), 'Gelöscht');
  },
  toggledone: (el) => {
    state.showDone = !state.showDone;
    const card = el.closest('.donecard');
    card.querySelector('.donebody').classList.toggle('open', state.showDone);
    card.querySelector('.chev').classList.toggle('open', state.showDone);
    el.setAttribute('aria-expanded', String(state.showDone));
  },
  cleardone: () => {
    const done = state.todos.filter((x) => x.done);
    if (!done.length || !confirm(`${done.length} erledigte To-Dos endgültig löschen?`)) return;
    return run(async () => {
      for (const x of done) await db.remove('todos', x.id);
    }, 'Erledigte gelöscht');
  },
  setaccent: (el) => setLook({ accent: el.dataset.c }),
  settheme: (el) => setLook({ theme: el.dataset.t }),
  finprev: () => ((state.finMonth = addMonths(state.finMonth, -1)), refresh()),
  finnext: () => ((state.finMonth = addMonths(state.finMonth, 1)), refresh()),
  fintoday: () => ((state.finMonth = monthStart(new Date())), refresh()),
  delinvite: (el) => run(() => db.remove('invites', el.dataset.id), 'Einladung zurückgezogen'),
  finview: (el) => {
    state.finView = el.dataset.v;
    state.accDetail = null;
    render();
    window.scrollTo(0, 0);
  },
  accopen: (el) => {
    state.accDetail = el.dataset.id;
    state.accSeg = 'alle';
    state.anim = 'next';
    render();
    window.scrollTo(0, 0);
  },
  accback: () => {
    state.accDetail = null;
    state.anim = 'prev';
    render();
    window.scrollTo(0, 0);
  },
  accseg: (el) => {
    state.accSeg = el.dataset.v;
    render();
  },
  adddebt: () => debtForm(),
  editdebt: (el) => debtForm(state.debts.find((x) => x.id === el.dataset.id)),
  paydebt: (el) => {
    const d = state.debts.find((x) => x.id === el.dataset.id);
    if (d) run(() => db.update('debts', d.id, { paid: !d.paid }), d.paid ? 'Wieder offen' : 'Als bezahlt markiert');
  },
  gofin: (el) => {
    state.tab = 'finanzen';
    state.finView = 'uebersicht';
    state.accDetail = el.dataset.id || null;
    state.accSeg = 'alle';
    state.anim = 'view';
    render();
    window.scrollTo(0, 0);
  },
  addacc: () => accForm(),
  editacc: (el) => accForm(state.accounts.find((x) => x.id === el.dataset.id)),
  rencat: (el) => renameCategory(Number(el.dataset.i), el.dataset.k),
  addsuggested: () => run(() => db.saveSettings({ categories: [...state.categories, ...suggestedCategories()] }), 'Kategorien hinzugefügt'),
  addrec: (el) => recForm(null, el.dataset.type),
  editrec: (el) => recForm(state.recurring.find((x) => x.id === el.dataset.id)),
  addcal: () => calendarForm(),
  editcal: (el) => calendarForm(state.calendars.find((x) => x.id === el.dataset.id)),
  togglecal: (el) => {
    const id = el.dataset.id;
    if (state.hiddenCals.has(id)) state.hiddenCals.delete(id);
    else state.hiddenCals.add(id);
    saveHiddenCals();
    render();
  },
  editevent: (el) => eventForm([...state.events, ...state.agenda].find((x) => x.id === el.dataset.id)),
  edittodo: (el) => todoForm(state.todos.find((x) => x.id === el.dataset.id)),
  edittx: (el) => txForm(state.tx.find((x) => x.id === el.dataset.id)),
  toggletodo: (el) => {
    // Erst die Abhak-Animation zeigen (Haken, Zeile klappt zu), dann speichern. Das To-Do landet danach
    // im Bereich "Erledigt" bzw. wieder bei den offenen.
    const td = state.todos.find((x) => x.id === el.dataset.id);
    if (!td || el.dataset.busy) return;
    el.dataset.busy = '1';
    const willDone = !td.done;
    el.classList.toggle('on', willDone);
    el.closest('.row')?.classList.add(willDone ? 'completing' : 'restoring');
    state.justToggled = td.id;
    setTimeout(async () => {
      if (!(await run(() => db.update('todos', td.id, { done: willDone })))) {
        state.justToggled = null;
        render();
      }
    }, 480);
  },
  delcat: (el) => {
    const i = Number(el.dataset.i);
    if (el.dataset.k === 'inc') return run(() => db.saveSettings({ income_categories: state.incomeCategories.filter((_, j) => j !== i) }));
    return run(() => db.saveSettings({ categories: state.categories.filter((_, j) => j !== i) }));
  },
  gentoken: () => {
    if (state.token && !confirm('Neues Token erzeugen? Das alte funktioniert danach nicht mehr, Kurzbefehl und Widget müssen angepasst werden.')) return;
    const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => pad(b.toString(16))).join('');
    return run(() => db.saveSettings({ api_token: token }), 'Token erzeugt');
  },
  copytoken: async () => {
    try {
      await navigator.clipboard.writeText(state.token);
      toast('Token kopiert');
    } catch {
      toast('Kopieren nicht möglich – bitte Text markieren.');
    }
  },
  logout: () => sb.auth.signOut(),
  authmode: () => {
    state.authMode = state.authMode === 'login' ? 'signup' : 'login';
    state.authMsg = null;
    state.authEmail = $app.querySelector('[name=email]')?.value || '';
    render();
  },
  demo: () => (location.search = '?demo'),
  exitdemo: () => (location.search = ''),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (el) actions[el.dataset.a]?.(el);
});

document.addEventListener('change', (e) => {
  if (e.target.dataset.c === 'priofilter') {
    state.prioFilter = e.target.value;
    render();
  }
  if (e.target.dataset.c === 'icsfile') {
    const file = e.target.files[0];
    e.target.value = '';
    importICS(file);
  }
});

document.addEventListener('submit', async (e) => {
  const kind = e.target.dataset.f;
  if (!kind) return;
  e.preventDefault();
  const data = new FormData(e.target);
  if (kind === 'addinc') {
    const cat = String(data.get('cat') || '').trim();
    if (!cat || state.incomeCategories.includes(cat)) return;
    await run(() => db.saveSettings({ income_categories: [...state.incomeCategories, cat] }));
  }
  if (kind === 'addcat') {
    const cat = String(data.get('cat') || '').trim();
    if (!cat || state.categories.includes(cat)) return;
    await run(() => db.saveSettings({ categories: [...state.categories, cat] }));
  }
  if (kind === 'invite') {
    const email = String(data.get('email') || '').trim().toLowerCase();
    if (!email) return;
    if (state.invites.some((i) => i.email === email)) return toast('Diese Adresse ist schon eingeladen.');
    const saved = await run(() => db.insert('invites', { email }), 'Eingeladen');
    // Die Einladungs-Mail wird im eigenen Mail-Programm vorbereitet und von dort verschickt.
    if (saved) location.href = inviteMailto(email);
  }
  if (kind === 'auth') {
    const email = String(data.get('email')).trim();
    const password = String(data.get('password'));
    state.authEmail = email;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      if (state.authMode === 'signup') {
        const { data: res, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!res.session) {
          state.authMode = 'login';
          state.authMsg = { text: 'Fast geschafft: Bestätige den Link in der E-Mail von Supabase und melde dich dann hier an.' };
          render();
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      state.authMsg = { text: friendlyError(err), err: true };
      render();
    } finally {
      btn.disabled = false;
    }
  }
});

// ---------- Start ----------
let channel = null;
let syncTimer;
function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb
    .channel('sync')
    .on('postgres_changes', { event: '*', schema: 'public' }, () => {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(refresh, 250);
    })
    .subscribe();
}

async function start() {
  if (DEMO) {
    db = localDb();
    return refresh();
  }
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch {
    state.authMsg = { text: 'Keine Verbindung zum Server. Prüfe deine Internetverbindung und lade die Seite neu.', err: true };
    return render();
  }
  db = supaDb();
  sb.auth.onAuthStateChange((event, session) => {
    const before = state.user?.id;
    state.user = session?.user || null;
    if (state.user?.id === before && event !== 'INITIAL_SESSION') return;
    // Nicht direkt im Callback weitere Supabase-Aufrufe starten.
    setTimeout(() => {
      if (state.user) {
        state.authMsg = null;
        subscribe();
        refresh();
      } else {
        if (channel) sb.removeChannel(channel);
        channel = null;
        render();
      }
    }, 0);
  });
}

// Mitteilungs-Schleier schließt das Schnell-Hinzufügen-Menü.
$scrim.addEventListener('click', () => {
  state.fabOpen = false;
  updateFab();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.fabOpen) {
    state.fabOpen = false;
    updateFab();
  }
});
// Kopfzeile bekommt beim Scrollen einen Glas-Hintergrund und wird kleiner.
window.addEventListener('scroll', () => document.body.classList.toggle('scrolled', window.scrollY > 24), { passive: true });
// Im Monat nach links/rechts wischen = nächster/voriger Monat.
let swipe = null;
document.addEventListener(
  'touchstart',
  (e) => {
    swipe = e.target.closest('.calcard') && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  },
  { passive: true },
);
document.addEventListener(
  'touchend',
  (e) => {
    if (!swipe) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipe.x;
    const dy = t.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) (dx < 0 ? actions.calnext : actions.calprev)();
  },
  { passive: true },
);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (state.user || DEMO) && !$sheet.open) refresh();
});

applyLook();
start();
