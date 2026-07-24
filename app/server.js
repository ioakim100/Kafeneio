/*
 * Kafeneío POS — local server
 * ----------------------------------------------------------------------
 * ONE file, ZERO dependencies. Run it on the PC or tablet that stays in
 * the shop; every waiter's phone connects to it over the same Wi-Fi.
 *
 *   1) Install Node.js 18+  (https://nodejs.org)
 *   2) node server.js
 *   3) Open the printed address on the shop tablet and each phone.
 *
 * Holds the single source of truth (in data.json), pushes live updates to
 * every device, and prints to any number of network thermal printers you
 * define — each menu item is routed to the printer you choose.
 */

const http = require("http");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const PORT = process.env.PORT || 3000;
const _emitWarning = process.emitWarning.bind(process);
process.emitWarning = (w, ...a) => { const s = (w && w.message) || String(w); if (/SQLite is an experimental/i.test(s)) return; return _emitWarning(w, ...a); };
const DATA_DIR = path.join(__dirname, "..", "data");        // all runtime data lives OUTSIDE the code folder
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
const DATA_FILE = path.join(DATA_DIR, "data.json");           // legacy/migration only
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const PUBLIC = path.join(__dirname, "public");
const uid = () => Math.random().toString(36).slice(2, 9);
const round2 = (n) => Math.round(n * 100) / 100;
const itemGross = (it) => round2((it.unit === "kg" ? it.price * (it.weight || 0) : it.price) * (it.qty || 1));
const qtyStr = (it) => it.unit === "kg" ? `${it.weight || 0} kg` : it.unit === "open" ? "" : `${it.qty} x`;

/* ---------------- seed ---------------- */
const SEED = {
  floors: [{ id: "f1", name: "Main Room" }, { id: "f2", name: "Garden" }],
  tables: [
    { id: "t1", name: "T1", seats: 2, floorId: "f1", x: 18, y: 22, shape: "square", size: "m" },
    { id: "t2", name: "T2", seats: 2, floorId: "f1", x: 42, y: 22, shape: "square", size: "m" },
    { id: "t3", name: "T3", seats: 4, floorId: "f1", x: 66, y: 22, shape: "square", size: "l" },
    { id: "t4", name: "T4", seats: 4, floorId: "f1", x: 18, y: 60, shape: "square", size: "l" },
    { id: "t5", name: "T5", seats: 6, floorId: "f1", x: 42, y: 60, shape: "square", size: "l" },
    { id: "t6", name: "T6", seats: 4, floorId: "f1", x: 66, y: 60, shape: "square", size: "m" },
    { id: "t7", name: "Bar 1", seats: 1, floorId: "f1", x: 88, y: 28, shape: "round", size: "s" },
    { id: "t8", name: "Bar 2", seats: 1, floorId: "f1", x: 88, y: 52, shape: "round", size: "s" },
    { id: "y1", name: "G1", seats: 4, floorId: "f2", x: 26, y: 28, shape: "round", size: "m" },
    { id: "y2", name: "G2", seats: 4, floorId: "f2", x: 58, y: 28, shape: "round", size: "m" },
    { id: "y3", name: "G3", seats: 2, floorId: "f2", x: 26, y: 66, shape: "round", size: "s" },
    { id: "y4", name: "G4", seats: 6, floorId: "f2", x: 58, y: 66, shape: "square", size: "l" },
  ],
  // Printers you can add/remove. Each menu item points at one via printerId.
  printers: [
    { id: "pk", name: "Kitchen", ip: "", color: "#D8735E", mode: "own", food: true },
    { id: "pb", name: "Bar", ip: "", color: "#E8A23D", mode: "rest" },
    { id: "pr", name: "Receipt", ip: "", color: "#7BC49A" },
  ],
  receiptPrinterId: "pr", // which printer prints the customer bill
  menu: [
    { id: "m1", name: "Espresso", price: 2.0, cat: "Coffee", printerId: "pb", options: [{ id: "o1", name: "Sugar", required: false, multi: false, choices: ["No sugar", "1 sugar", "2 sugar"] }] },
    { id: "m2", name: "Freddo Cappuccino", price: 3.5, cat: "Coffee", printerId: "pb", options: [{ id: "o1", name: "Sugar", required: true, multi: false, choices: ["Sketos", "Metrios", "Glykos"] }, { id: "o2", name: "Milk", required: false, multi: false, choices: ["Regular", "No milk", "Oat"] }] },
    { id: "m3", name: "Greek Coffee", price: 2.2, cat: "Coffee", printerId: "pb", options: [{ id: "o1", name: "Sugar", required: true, multi: false, choices: ["Sketos", "Metrios", "Glykos", "Vari glykos"] }] },
    { id: "m4", name: "Orange Juice", price: 4.0, cat: "Cold Drinks", printerId: "pb" },
    { id: "m5", name: "Still Water", price: 0.5, cat: "Cold Drinks", printerId: "pb" },
    { id: "m6", name: "Draft Beer", price: 5.0, cat: "Cold Drinks", printerId: "pb" },
    { id: "m7", name: "House Wine (glass)", price: 4.5, cat: "Cold Drinks", printerId: "pb" },
    { id: "m8", name: "Club Sandwich", price: 7.5, cat: "Food", printerId: "pk" },
    { id: "m9", name: "Greek Salad", price: 8.0, cat: "Food", printerId: "pk" },
    { id: "m10", name: "Cheeseburger", price: 11.0, cat: "Food", printerId: "pk" },
    { id: "m11", name: "Margherita Pizza", price: 9.5, cat: "Food", printerId: "pk" },
    { id: "m12", name: "French Fries", price: 4.0, cat: "Food", printerId: "pk" },
    { id: "m13", name: "Pasta Carbonara", price: 10.5, cat: "Food", printerId: "pk" },
    { id: "m14", name: "Cheesecake", price: 5.5, cat: "Dessert", printerId: "pb" },
    { id: "m15", name: "Baklava", price: 4.5, cat: "Dessert", printerId: "pb" },
    { id: "adj", name: "Charge / Discount", price: 0, cat: "Other", printerId: "", vat: 0, unit: "open" },
  ],
  waiters: [
    { id: "w0", name: "Manager", color: "#C98FE8", role: "admin", pin: "1234" },
    { id: "w1", name: "Maria", color: "#E8A23D", role: "waiter", pin: "1111" },
    { id: "w2", name: "Nikos", color: "#7BC49A", role: "waiter", pin: "2222" },
  ],
  shop: { name: "Kafeneío", vat: "", taxOffice: "", address: "", phone: "", dayStart: 5 },
  settings: { autoPrintPrep: true, autoPrintReceipt: true, lockToOpener: false, autoBackup: true, backupIntervalMin: 10, backupDir: "", backupKeepMonths: 12, orderBillOnSend: true, orderBillOnPay: false },
  meta: { lastBackupAt: null, lastBackupOk: true, lastBackupMsg: "" },
  counter: { n: 0, openedAt: null, bizDay: null },
  open: {},
  sales: [],
};

/* ---------------- storage: SQLite (built-in) with JSON fallback ---------------- */
const DB_FILE = path.join(DATA_DIR, "data.db");
let db = null, useSqlite = false;
try {
  const { DatabaseSync } = require("node:sqlite");
  db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
  db.exec("CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);");
  db.exec("CREATE TABLE IF NOT EXISTS sales(id TEXT PRIMARY KEY, closedAt TEXT, waiterId TEXT, total REAL, data TEXT);");
  useSqlite = true;
} catch (e) {
  console.log("  (node:sqlite unavailable — falling back to a JSON file. Node 22.5+ / 24+ recommended.)");
}

let state;
let dirty = false;

const cfgFromState = () => { const { sales, ...cfg } = state; return cfg; };
function persistConfig() {
  if (useSqlite) { try { db.prepare("INSERT INTO kv(k,v) VALUES('config',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(JSON.stringify(cfgFromState())); } catch (e) { console.error("db config save failed", e); } }
  else { try { fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)); } catch (e) { console.error("save failed", e); } }
}
function insertSale(s) { if (useSqlite) { try { db.prepare("INSERT OR REPLACE INTO sales(id,closedAt,waiterId,total,data) VALUES(?,?,?,?,?)").run(s.id, s.closedAt || "", s.waiterId || "", s.total || 0, JSON.stringify(s)); } catch (e) { console.error("db sale save failed", e); } } }
function replaceSales(arr) {
  if (!useSqlite) return;
  try { db.exec("BEGIN"); db.exec("DELETE FROM sales"); const st = db.prepare("INSERT OR REPLACE INTO sales(id,closedAt,waiterId,total,data) VALUES(?,?,?,?,?)");
    for (const s of (arr || [])) st.run(s.id, s.closedAt || "", s.waiterId || "", s.total || 0, JSON.stringify(s)); db.exec("COMMIT"); }
  catch (e) { try { db.exec("ROLLBACK"); } catch {} console.error("db sales replace failed", e); }
}
function loadSales() { if (!useSqlite) return state && state.sales ? state.sales : []; try { return db.prepare("SELECT data FROM sales ORDER BY closedAt DESC").all().map((r) => JSON.parse(r.data)); } catch { return []; } }
function applyFullState(data) {
  if (!data || !Array.isArray(data.tables) || !Array.isArray(data.menu)) throw new Error("not a valid backup file");
  state = { ...data, sales: Array.isArray(data.sales) ? data.sales : [] };
  migrate();
  if (useSqlite) { replaceSales(state.sales); persistConfig(); } else { save(); }
  broadcast();
}

/* ---------------- load + migrate ---------------- */
function boot() {
  let raw = null, salesFromDb = null, source = "seed";
  if (useSqlite) {
    try { const row = db.prepare("SELECT v FROM kv WHERE k='config'").get(); if (row) { raw = JSON.parse(row.v); source = "db"; } } catch {}
    if (raw) salesFromDb = loadSales();
  }
  if (!raw) {                                              // upgrading from an older flat layout? old data.db/.json sat next to server.js
    try { const oldDb = path.join(__dirname, "data.db"); if (!useSqlite && fs.existsSync(path.join(__dirname, "data.json"))) { raw = JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8")); source = "legacy-json (old layout)"; }
      else if (fs.existsSync(oldDb)) { const { DatabaseSync } = require("node:sqlite"); const odb = new DatabaseSync(oldDb, { readOnly: true }); const row = odb.prepare("SELECT v FROM kv WHERE k='config'").get(); if (row) { raw = JSON.parse(row.v); salesFromDb = odb.prepare("SELECT data FROM sales ORDER BY closedAt DESC").all().map((r) => JSON.parse(r.data)); source = "old layout db"; } odb.close(); } } catch {}
  }
  if (!raw) { try { if (fs.existsSync(DATA_FILE)) { raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); source = "legacy-json"; } } catch {} }
  if (!raw) { try { const p = path.join(BACKUP_DIR, "latest.json"); if (fs.existsSync(p)) { raw = JSON.parse(fs.readFileSync(p, "utf8")); source = "backup"; } } catch {} }
  if (!raw) { raw = JSON.parse(JSON.stringify(SEED)); source = "seed"; }
  state = { ...raw, sales: salesFromDb || (Array.isArray(raw.sales) ? raw.sales : []) };
  migrate();
  if (useSqlite) { if (source !== "db") replaceSales(state.sales); persistConfig(); } else { save(); }
  console.log("  storage: " + (useSqlite ? "SQLite (" + source + ")" : "JSON file"));
}
boot();

function migrate() {
  for (const k of Object.keys(SEED)) if (state[k] === undefined) state[k] = SEED[k];
  // old printers object -> list
  if (!Array.isArray(state.printers)) {
    const old = state.printers || {};
    state.printers = [
      { id: "pk", name: "Kitchen", ip: old.kitchenIp || "", color: "#D8735E" },
      { id: "pb", name: "Bar", ip: "", color: "#E8A23D" },
      { id: "pr", name: "Receipt", ip: old.receiptIp || "", color: "#7BC49A" },
    ];
    state.receiptPrinterId = "pr";
  }
  const rp = state.printers.find((p) => p.id === state.receiptPrinterId);
  if (!rp || /kitchen|bar|κουζ|μπαρ/i.test(rp.name)) {   // a Kitchen/Bar must never be the bill printer, or its tab vanishes
    let r = state.printers.find((p) => /receipt|bill|ταμ|apodei|katast/i.test(p.name));
    if (!r) { r = { id: "pr", name: "Receipt", ip: "", color: "#7BC49A" }; state.printers.push(r); }
    state.receiptPrinterId = r.id;
  }
  if (state.shop && state.shop.dayStart === undefined) state.shop.dayStart = 5;
  state.settings = state.settings || {};
  if (state.settings.autoBackup === undefined) state.settings.autoBackup = true;
  if (state.settings.backupIntervalMin === undefined) state.settings.backupIntervalMin = 10;
  if (state.settings.backupDir === undefined) state.settings.backupDir = "";
  if (state.settings.backupKeepMonths === undefined) state.settings.backupKeepMonths = 12;
  if (state.settings.orderBillOnSend === undefined) state.settings.orderBillOnSend = true;
  if (state.settings.orderBillOnPay === undefined) state.settings.orderBillOnPay = false;
  state.meta = state.meta || { lastBackupAt: null, lastBackupOk: true, lastBackupMsg: "" };
  if (!state.counter) state.counter = { n: 0, openedAt: null };
  state.printers.forEach((p) => {
    if (p.mode === undefined) p.mode = p.all ? "all" : (/bar/i.test(p.name) ? "rest" : "own");
    if (p.food === undefined) p.food = /kitchen/i.test(p.name);
    if (p.port === undefined) p.port = 9100;
    if (p.width === undefined) p.width = "80";
    if (p.priced === undefined) p.priced = false;
    if (p.billOnSend === undefined) p.billOnSend = false;
  });
  // tables need a size
  state.tables.forEach((t) => { if (!t.size) t.size = "m"; if (!t.shape) t.shape = "square"; });
  // menu: station -> printerId
  const map = { kitchen: "pk", bar: "pb", none: "" };
  state.menu.forEach((m) => { if (m.printerId === undefined) m.printerId = map[m.station] ?? "pb"; delete m.station; if (m.vat === undefined) m.vat = m.cat === "Cold Drinks" ? 24 : 13; if (m.unit === undefined) m.unit = "each"; });
  if (!state._adjSeeded) { if (!state.menu.some((m) => m.unit === "open")) state.menu.push({ id: uid(), name: "Charge / Discount", price: 0, cat: "Other", printerId: "", vat: 0, unit: "open" }); state._adjSeeded = true; }
  // waiters: role + ensure an admin exists
  state.waiters.forEach((w) => { if (!w.role) w.role = "waiter"; });
  if (!state.waiters.some((w) => w.role === "admin"))
    state.waiters.unshift({ id: "w0", name: "Manager", color: "#C98FE8", role: "admin", pin: "" });
  // open orders: line ids, printerId, done
  Object.values(state.open).forEach((o) => (o.items || []).forEach((it) => {
    if (!it.lid) it.lid = uid();
    if (it.printerId === undefined) { const m = state.menu.find((x) => x.id === it.id); it.printerId = m ? m.printerId : (map[it.station] ?? ""); }
    if (it.done === undefined) it.done = false;
    if (it.doneQty === undefined) it.doneQty = it.done ? it.qty : 0;
    if (it.unit === undefined) it.unit = "each";
    if (it.weight === undefined) it.weight = 0;
    if (it.sent === undefined) it.sent = true;
  }));
}

function save() { dirty = true; persistConfig(); }
/* ---------------- backups (offline-first) ---------------- */
function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch {} }
function readBackupFile(p) { const buf = fs.readFileSync(p); return JSON.parse((p.endsWith(".gz") ? zlib.gunzipSync(buf) : buf).toString("utf8")); }
/* keep: everything <24h, one/day for 14 days, one/month beyond, delete older than keepMonths */
function pruneRetention(dir) {
  let files;
  try { files = fs.readdirSync(dir).filter((f) => /^kafeneio-.*\.(json|json\.gz)$/.test(f) && !/latest/.test(f)); } catch { return; }
  const now = Date.now();
  const info = files.map((f) => { let m = 0; try { m = fs.statSync(path.join(dir, f)).mtime.getTime(); } catch {} return { f, m }; }).sort((a, b) => b.m - a.m);
  const keepMonths = (state.settings && state.settings.backupKeepMonths) || 12;
  const keep = new Set(), seenDay = new Set(), seenMonth = new Set();
  for (const { f, m } of info) {
    const ageDays = (now - m) / 86400000, d = new Date(m);
    if (ageDays > keepMonths * 31) continue;                          // too old → delete
    if (now - m <= 24 * 3600000) { keep.add(f); continue; }           // all within 24h
    if (ageDays <= 14) { const k = d.toISOString().slice(0, 10); if (!seenDay.has(k)) { seenDay.add(k); keep.add(f); } continue; } // 1/day, 14d
    const k = d.toISOString().slice(0, 7); if (!seenMonth.has(k)) { seenMonth.add(k); keep.add(f); }                              // 1/month beyond
  }
  if (info[0]) keep.add(info[0].f);                                   // always keep newest
  for (const { f } of info) if (!keep.has(f)) try { fs.unlinkSync(path.join(dir, f)); } catch {}
}
function writeSnapshot(reason) {
  const json = JSON.stringify(state);
  const gz = zlib.gzipSync(Buffer.from(json));
  const now = new Date();
  const ts = now.toISOString().replace(/:/g, "-").replace("T", "_").slice(0, 19);
  let ok = true, msg = "";
  try { ensureDir(BACKUP_DIR); fs.writeFileSync(path.join(BACKUP_DIR, `kafeneio-${ts}.json.gz`), gz); fs.writeFileSync(path.join(BACKUP_DIR, "latest.json"), json); pruneRetention(BACKUP_DIR); }
  catch (e) { ok = false; msg = "local: " + e.message; }
  const dir = state.settings && state.settings.backupDir;
  if (dir) {
    try { ensureDir(dir);
      fs.writeFileSync(path.join(dir, "kafeneio-latest.json"), json);
      fs.writeFileSync(path.join(dir, `kafeneio-${ts}.json.gz`), gz);
      pruneRetention(dir); }
    catch (e) { ok = false; msg = (msg ? msg + "; " : "") + "folder: " + e.message; }
  }
  state.meta = { lastBackupAt: now.toISOString(), lastBackupOk: ok, lastBackupMsg: msg, reason: reason || "" };
  persistConfig();
  dirty = false; broadcast();
  return { ok, msg, at: state.meta.lastBackupAt };
}
function listBackups() {
  const out = [];
  const scan = (dir, source) => { try { for (const f of fs.readdirSync(dir)) { if (!/\.(json|json\.gz)$/.test(f)) continue; const st = fs.statSync(path.join(dir, f)); out.push({ name: f, source, dir, size: st.size, at: st.mtime.toISOString() }); } } catch {} };
  scan(BACKUP_DIR, "local");
  if (state.settings && state.settings.backupDir) scan(state.settings.backupDir, "folder");
  out.sort((a, b) => b.at.localeCompare(a.at));
  return out.slice(0, 200);
}
function restoreFromFile(dir, name) { applyFullState(readBackupFile(path.join(dir, name))); }
const orderTotal = (o) => round2((o.items || []).reduce((s, x) => s + itemGross(x), 0));
const waiterName = (id) => (state.waiters.find((w) => w.id === id) || {}).name || "—";
const printerById = (id) => state.printers.find((p) => p.id === id);
function printerReceives(pr, item) {
  if (!item.printerId || item.printerId === state.receiptPrinterId) return false;
  const mode = pr.mode || (pr.all ? "all" : "own");
  if (mode === "all") return true;                                   // expo: everything
  if (mode === "rest") { const q = printerById(item.printerId); return !!q && !q.food; } // everything except food
  return item.printerId === pr.id;                                   // own items only
}

/* ---------------- live sync ---------------- */
const clients = new Set();
const publicState = () => ({ ...state, waiters: state.waiters.map(({ pin, ...w }) => w) });
function broadcast() { const d = "data: " + JSON.stringify(publicState()) + "\n\n"; for (const r of clients) { try { r.write(d); } catch {} } }

/* ---------------- ESC/POS ---------------- */
const ESC = 0x1b, GS = 0x1d;
const CP = { init: [ESC, 0x40], boldOn: [ESC, 0x45, 1], boldOff: [ESC, 0x45, 0], center: [ESC, 0x61, 1], left: [ESC, 0x61, 0],
  big: [GS, 0x21, 0x11], normal: [GS, 0x21, 0x00], feed: (n) => [ESC, 0x64, n], cut: [GS, 0x56, 0x42, 0x00] };
const L = (s = "") => Buffer.from(s + "\n", "latin1");
const B = (a) => Buffer.from(a);
const grDate = (d) => { const s = d.toLocaleDateString("el-GR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); return s.charAt(0).toUpperCase() + s.slice(1); };
const grTime = (d) => d.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const itemLabel = (it) => it.unit === "kg" ? `${it.weight || 0} kg  ${it.name}` : it.unit === "open" ? it.name : (it.qty > 1 ? `${it.qty}x  ${it.name}` : it.name);
const pad2 = (label, val, n = 10) => String(label).padEnd(n) + String(val);
const cols = (l, r, w = 42) => L(String(l) + " ".repeat(Math.max(1, w - String(l).length - String(r).length)) + String(r));
function vatRows(items) {
  const m = {};
  for (const it of items) { const g = itemGross(it); const r = it.vat != null ? it.vat : 0; const net = g / (1 + r / 100); (m[r] = m[r] || { rate: r, net: 0, vat: 0 }); m[r].net += net; m[r].vat += g - net; }
  return Object.values(m).sort((a, b) => a.rate - b.rate);
}
function buildTicket({ title, table, servedBy, items, total, payments, priced, width, shop, notLegal, proforma, thanks, docNo, floor, full }) {
  const W = width === "58" ? 32 : 48;
  const now = new Date();
  const col = (l, r) => L(String(l) + " ".repeat(Math.max(1, W - String(l).length - String(r).length)) + String(r));
  const p = [B(CP.init), B(CP.center)];
  if (priced && shop && shop.name) {                      // customer bill: business header on top
    p.push(B(CP.big), B(CP.boldOn), L(shop.name), B(CP.normal), B(CP.boldOff));
    if (shop.address) p.push(L(shop.address));
    const l2 = [shop.vat && ("ΑΦΜ " + shop.vat), shop.taxOffice && ("ΔΟΥ " + shop.taxOffice)].filter(Boolean).join("  ");
    if (l2) p.push(L(l2));
    if (shop.phone) p.push(L("Τηλ " + shop.phone));
  }
  if (proforma) p.push(B(CP.boldOn), L("ΔΕΛΤΙΟ ΠΑΡΑΓΓΕΛΙΑΣ"), B(CP.boldOff));
  p.push(L(grDate(now)), L(grTime(now)));
  if (docNo) p.push(L("Αρ. " + docNo));
  p.push(B(CP.boldOn), L("=".repeat(W)), B(CP.boldOff), B(CP.feed(1)), B(CP.left));
  for (const it of items) {
    if (priced) { p.push(B(CP.boldOn), col(itemLabel(it), "€ " + itemGross(it).toFixed(2)), B(CP.boldOff));
      if (full && it.unit === "each" && it.qty > 1) p.push(L("   " + it.qty + " x € " + it.price.toFixed(2)));
      if (full && it.unit === "kg") p.push(L("   " + (it.weight || 0) + " kg x € " + it.price.toFixed(2) + "/kg"));
    } else p.push(B(CP.big), B(CP.boldOn), L(itemLabel(it)), B(CP.normal), B(CP.boldOff));
    if (it.opts && it.opts.length) p.push(L("   » " + it.opts.map((o) => o.values.join(", ")).join(" / ")));
    if (it.note) p.push(L("   » " + it.note));
  }
  if (priced && typeof total === "number") {
    p.push(L("-".repeat(W)));
    if (full) { const rows = vatRows(items); const netT = rows.reduce((s, v) => s + v.net, 0);
      p.push(col("Καθαρή αξία", "€ " + netT.toFixed(2)));
      for (const v of rows) p.push(col("ΦΠΑ " + v.rate + "%", "€ " + v.vat.toFixed(2)));
      p.push(L("-".repeat(W))); }
    p.push(B(CP.big), B(CP.boldOn), col("ΣΥΝΟΛΟ", "€ " + total.toFixed(2)), B(CP.normal), B(CP.boldOff));
    for (const pay of payments || []) p.push(L("  " + (pay.method === "card" ? "Κάρτα" : "Μετρητά") + ": € " + pay.amount.toFixed(2)));
  }
  if (!proforma) p.push(B(CP.feed(1)), L("-".repeat(W)));
  if (!proforma && floor) p.push(L(pad2("Αίθουσα", floor)));
  if (!proforma && table) p.push(B(CP.boldOn), L(pad2("Τραπέζι", table)), B(CP.boldOff));
  if (!proforma && servedBy) p.push(L(pad2("Βάρδια", servedBy)));
  if (notLegal) p.push(B(CP.feed(1)), B(CP.center), B(CP.boldOn), L("ΔΕΛΤΙΟ ΠΑΡΑΓΓΕΛΙΑΣ"), L("ΟΧΙ ΝΟΜΙΜΗ ΑΠΟΔΕΙΞΗ"), B(CP.boldOff), B(CP.left));
  if (proforma) p.push(B(CP.feed(1)), B(CP.center), L("Δεν αποτελεί νόμιμη απόδειξη"), B(CP.left));
  if (thanks || proforma) p.push(B(CP.feed(1)), B(CP.center), B(CP.boldOn), L("Ευχαριστούμε!"), B(CP.boldOff), B(CP.left));
  p.push(B(CP.feed(4)), B(CP.cut));
  return Buffer.concat(p);
}
function ticketText({ title, table, servedBy, items, total, payments, priced, width, shop, notLegal, proforma, thanks, docNo, floor, full }) {
  const W = width === "58" ? 32 : 48;
  const now = new Date();
  const line = "-".repeat(W), thick = "=".repeat(W);
  const col = (l, r) => { l = String(l); r = String(r); return l + " ".repeat(Math.max(1, W - l.length - r.length)) + r; };
  const center = (s) => { s = String(s); const pad = Math.max(0, Math.floor((W - s.length) / 2)); return " ".repeat(pad) + s; };
  const out = [];
  if (priced && shop && shop.name) {
    out.push(center(shop.name));
    if (shop.address) out.push(center(shop.address));
    const l2 = [shop.vat && ("ΑΦΜ " + shop.vat), shop.taxOffice && ("ΔΟΥ " + shop.taxOffice)].filter(Boolean).join("  ");
    if (l2) out.push(center(l2));
    if (shop.phone) out.push(center("Τηλ " + shop.phone));
  }
  if (proforma) out.push(center("ΔΕΛΤΙΟ ΠΑΡΑΓΓΕΛΙΑΣ"));
  out.push(center(grDate(now)), center(grTime(now)));
  if (docNo) out.push(center("Αρ. " + docNo));
  out.push(thick, "");
  for (const it of items) {
    out.push(priced ? col(itemLabel(it), "€ " + itemGross(it).toFixed(2)) : itemLabel(it));
    if (full && it.unit === "each" && it.qty > 1) out.push("   " + it.qty + " x € " + it.price.toFixed(2));
    if (full && it.unit === "kg") out.push("   " + (it.weight || 0) + " kg x € " + it.price.toFixed(2) + "/kg");
    if (it.opts && it.opts.length) out.push("   » " + it.opts.map((o) => o.values.join(", ")).join(" / "));
    if (it.note) out.push("   » " + it.note);
  }
  if (priced && typeof total === "number") {
    out.push(line);
    if (full) { const rows = vatRows(items); const netT = rows.reduce((s, v) => s + v.net, 0);
      out.push(col("Καθαρή αξία", "€ " + netT.toFixed(2)));
      for (const v of rows) out.push(col("ΦΠΑ " + v.rate + "%", "€ " + v.vat.toFixed(2)));
      out.push(line); }
    out.push(col("ΣΥΝΟΛΟ", "€ " + total.toFixed(2)));
    for (const pay of payments || []) out.push("  " + (pay.method === "card" ? "Κάρτα" : "Μετρητά") + ": € " + pay.amount.toFixed(2));
  }
  if (!proforma) out.push("", line);
  if (!proforma && floor) out.push(pad2("Αίθουσα", floor));
  if (!proforma && table) out.push(pad2("Τραπέζι", table));
  if (!proforma && servedBy) out.push(pad2("Βάρδια", servedBy));
  if (notLegal) out.push("", center("ΔΕΛΤΙΟ ΠΑΡΑΓΓΕΛΙΑΣ"), center("ΟΧΙ ΝΟΜΙΜΗ ΑΠΟΔΕΙΞΗ"));
  if (proforma) out.push("", center("Δεν αποτελεί νόμιμη απόδειξη"));
  if (thanks || proforma) out.push("", center("Ευχαριστούμε!"));
  return out.join("\n");
}
function sendToPrinter(ip, port, buffer) {
  return new Promise((resolve, reject) => {
    if (!ip) return reject(new Error("no-ip"));
    const s = new net.Socket(); s.setTimeout(4000);
    s.connect(port || 9100, ip, () => s.write(buffer, () => s.end()));
    s.on("close", () => resolve(true));
    s.on("timeout", () => { s.destroy(); reject(new Error("offline")); });
    s.on("error", () => reject(new Error("offline")));
  });
}
/* --- TESTING: dump every printout to the terminal so we can perfect the layout.
       Turn off later with env  PRINT_DEBUG=0  (or just remove this block).      --- */
const PRINT_DEBUG = process.env.PRINT_DEBUG !== "0";
function logTicket(dest, args) {
  if (!PRINT_DEBUG) return;
  const w = args.width === "58" ? 32 : 48;
  const bar = "=".repeat(w + 4);
  const body = ticketText(args).split("\n").map((l) => "  " + l).join("\n");
  console.log("\n" + bar + "\n  🖨  PRINT → " + dest + "   (" + (args.width === "58" ? "58" : "80") + "mm)\n" + bar + "\n" + body + "\n" + bar + "\n");
}

async function printPrep(printer, tableName, waiterId, items) {
  const priced = !!printer.priced;
  const total = priced ? round2(items.reduce((s, x) => s + itemGross(x), 0)) : undefined;
  const args = { title: printer.name.toUpperCase(), table: tableName, servedBy: waiterName(waiterId), items, priced, total, width: printer.width, notLegal: priced };
  logTicket(printer.name + (printer.ip ? " @ " + printer.ip : " (no IP set)"), args);
  const buf = buildTicket(args);
  if (!printer.ip) return { name: printer.name, ok: false, reason: "no-ip" };
  try { await sendToPrinter(printer.ip, printer.port, buf); return { name: printer.name, ok: true }; }
  catch { return { name: printer.name, ok: false, reason: "offline" }; }
}
async function printReceipt(sale) {
  const pr = printerById(state.receiptPrinterId);
  const args = { title: "RECEIPT", table: sale.tableName, servedBy: waiterName(sale.waiterId), floor: sale.floorName, items: sale.items, total: sale.total, payments: sale.payments, priced: true, full: true, docNo: sale.no ? String(sale.no).padStart(4, "0") : undefined, width: pr && pr.width, shop: state.shop, thanks: true };
  logTicket((pr ? pr.name : "Receipt") + (pr && pr.ip ? " @ " + pr.ip : " (no IP set)"), args);
  const buf = buildTicket(args);
  if (!pr || !pr.ip) return { ok: false, reason: "no-ip" };
  try { await sendToPrinter(pr.ip, pr.port, buf); return { ok: true }; } catch { return { ok: false, reason: "offline" }; }
}
/* ---- business day + Z (computed live from sales, never stored) ---- */
function bizDayKey(d) {
  const start = (state.shop && state.shop.dayStart) || 0;
  const x = new Date((typeof d === "number" ? d : new Date(d).getTime()) - start * 3600000);
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
}
function aggZ(arr) {
  let gross = 0, cash = 0, card = 0, first = null, last = null; const rates = {}; const byW = {};
  for (const s of arr) {
    gross += s.total || 0;
    const t = new Date(s.closedAt).getTime(); if (first == null || t < first) first = t; if (last == null || t > last) last = t;
    for (const it of (s.items || [])) { const g = itemGross(it); const r = it.vat != null ? it.vat : 0; const net = g / (1 + r / 100); (rates[r] = rates[r] || { rate: r, net: 0, vat: 0, gross: 0 }); rates[r].net += net; rates[r].vat += g - net; rates[r].gross += g; }
    for (const p of (s.payments || [])) { if (p.method === "card") card += p.amount; else cash += p.amount; }
    const w = s.waiterId || "?"; (byW[w] = byW[w] || { n: 0, g: 0 }); byW[w].n += 1; byW[w].g += s.total || 0;
  }
  const net = Object.values(rates).reduce((s, v) => s + v.net, 0), vat = Object.values(rates).reduce((s, v) => s + v.vat, 0);
  return { count: arr.length, gross: round2(gross), net: round2(net), vat: round2(vat), cash: round2(cash), card: round2(card), first, last, rates: Object.values(rates).sort((a, b) => a.rate - b.rate), byW };
}
function zLines(agg, label, W) {
  const col = (l, r) => { l = String(l); r = String(r); return l + " ".repeat(Math.max(1, W - l.length - r.length)) + r; };
  const center = (s) => { s = String(s); return " ".repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s; };
  const o = [];
  if (state.shop && state.shop.name) o.push(center(state.shop.name));
  o.push(center("ΑΝΑΦΟΡΑ Ζ (ΣΥΓΚΕΝΤΡΩΤΙΚΗ)"));
  if (label) o.push(center(label));
  o.push("=".repeat(W), "");
  o.push(col("Αποδείξεις", String(agg.count)));
  if (agg.first) o.push(col("Πρώτη", grTime(new Date(agg.first))));
  if (agg.last) o.push(col("Τελευταία", grTime(new Date(agg.last))));
  o.push(col("Τζίρος", "€ " + agg.gross.toFixed(2)));
  o.push(col("Καθαρή αξία", "€ " + agg.net.toFixed(2)));
  for (const v of agg.rates) o.push(col("ΦΠΑ " + v.rate + "%", "€ " + v.vat.toFixed(2)));
  o.push("-".repeat(W));
  o.push(col("Μετρητά", "€ " + agg.cash.toFixed(2)));
  o.push(col("Κάρτα", "€ " + agg.card.toFixed(2)));
  const ws = Object.keys(agg.byW);
  if (ws.length) { o.push("-".repeat(W), "Ανά σερβιτόρο:"); for (const w of ws) o.push(col("  " + waiterName(w), agg.byW[w].n + " · € " + agg.byW[w].g.toFixed(2))); }
  o.push("", center("Δεν αποτελεί νόμιμο Ζ"));
  return o;
}
function buildZTicket(agg, label, width) {
  const W = width === "58" ? 32 : 48;
  const p = [B(CP.init), B(CP.center), B(CP.boldOn)];
  const lines = zLines(agg, label, W);
  lines.forEach((l, i) => { if (i === 2) p.push(B(CP.boldOff), B(CP.left)); p.push(L(l)); });
  p.push(B(CP.feed(4)), B(CP.cut));
  return Buffer.concat(p);
}
function zTicketText(agg, label, width) { return zLines(agg, label, width === "58" ? 32 : 48).join("\n"); }
async function printOrderBill(printer, items) {                // ΔΕΛΤΙΟ ΠΑΡΑΓΓΕΛΙΑΣ — items with prices, NO total (total only on the pay receipt)
  const args = { items, payments: [], priced: true, width: printer.width, shop: state.shop, proforma: true };
  logTicket(printer.name + (printer.ip ? " @ " + printer.ip : " (no IP set)") + " · ΔΕΛΤΙΟ ΠΑΡΑΓΓΕΛΙΑΣ", args);
  const buf = buildTicket(args);
  if (!printer.ip) return { name: printer.name, ok: false, reason: "no-ip" };
  try { await sendToPrinter(printer.ip, printer.port, buf); return { name: printer.name, ok: true }; }
  catch { return { name: printer.name, ok: false, reason: "offline" }; }
}

/* ---------------- actions ---------------- */
const ADMIN = new Set(["addProduct", "deleteProduct", "addFloor", "deleteFloor", "addTable", "deleteTable",
  "updateTable", "moveTable", "addPrinter", "updatePrinter", "deletePrinter", "setReceiptPrinter",
  "addWaiter", "updateWaiter", "deleteWaiter", "reset", "setShop", "setSetting", "seedDemoSales",
  "setBackup", "backupNow", "listBackups", "restoreBackup", "importData", "closeDay", "printZ"]);

function consolidate(o) {                                   // merge identical SENT products into one line (same id, unit each, same note, no options, not paid)
  const paid = new Set(); for (const p of (o.payments || [])) for (const ln of (p.lines || [])) paid.add(ln.lid);
  const out = [];
  for (const it of o.items) {
    const canMerge = it.sent && it.unit === "each" && !(it.opts && it.opts.length) && !paid.has(it.lid);
    if (canMerge) {
      const m = out.find((x) => x.sent && x.id === it.id && x.unit === "each" && !(x.opts && x.opts.length) && (x.note || "") === (it.note || "") && !paid.has(x.lid));
      if (m) { m.qty += it.qty; m.doneQty = (m.doneQty || 0) + (it.doneQty || 0); continue; }
    }
    out.push(it);
  }
  o.items = out;
}
async function handleAction(type, payload = {}, waiterId) {
  const actor = state.waiters.find((w) => w.id === waiterId);
  if (ADMIN.has(type) && (!actor || actor.role !== "admin")) return { ok: false, error: "admin_only" };
  const OWN = new Set(["addItem", "changeQty", "removeItem", "setNote", "placeOrder", "printBill", "pay"]);
  if (state.settings && state.settings.lockToOpener && actor && actor.role === "waiter" && OWN.has(type)) {
    const o = state.open[payload.tableId];
    if (o && o.openedBy && o.openedBy !== actor.id) return { ok: false, error: "locked" };
  }
  let print = null, sale = null; const p = payload;
  switch (type) {
    case "addItem": {
      const o = state.open[p.tableId] || { items: [], openedAt: new Date().toISOString(), openedBy: waiterId, payments: [] };
      const noMerge = (p.item.opts && p.item.opts.length) || p.item.unit === "kg" || p.item.unit === "open";
      const i = noMerge ? -1 : o.items.findIndex((x) => x.id === p.item.id && !x.sent && !(x.opts && x.opts.length) && x.unit !== "kg" && x.unit !== "open");
      if (i >= 0) o.items[i].qty += 1;
      else o.items.push({ ...p.item, unit: p.item.unit || "each", weight: p.item.weight || 0, opts: p.item.opts || null, lid: uid(), qty: 1, waiterId, sent: false, done: false, doneQty: 0, note: "" });
      state.open[p.tableId] = o; break;
    }
    case "setWeight": { const o = state.open[p.tableId]; if (o && o.items[p.index]) o.items[p.index].weight = Math.max(0, parseFloat(p.weight) || 0); break; }
    case "setPrice": { const o = state.open[p.tableId]; if (o && o.items[p.index]) o.items[p.index].price = round2(parseFloat(p.price) || 0); break; }
    case "changeQty": { const o = state.open[p.tableId]; if (!o) break; const it = o.items[p.index]; if (it) { it.qty += p.delta; it.doneQty = Math.min(it.doneQty || 0, Math.max(0, it.qty)); it.done = it.qty > 0 && it.doneQty >= it.qty; } o.items = o.items.filter((x) => x.qty > 0); if (!o.items.length) delete state.open[p.tableId]; break; }
    case "removeItem": { const o = state.open[p.tableId]; if (!o) break; o.items.splice(p.index, 1); if (!o.items.length) delete state.open[p.tableId]; break; }
    case "setNote": { const o = state.open[p.tableId]; if (o && o.items[p.index]) o.items[p.index].note = p.note; break; }
    case "setDone": { const o = state.open[p.tableId]; if (o) { const it = o.items.find((x) => x.lid === p.lid); if (it) { it.done = p.done; it.doneQty = p.done ? it.qty : 0; it.doneAt = p.done ? new Date().toISOString() : null; } } break; }
    case "setDoneQty": { const o = state.open[p.tableId]; if (o) { const it = o.items.find((x) => x.lid === p.lid); if (it) { it.doneQty = Math.max(0, Math.min(it.qty, p.qty)); it.done = it.doneQty >= it.qty; it.doneAt = it.doneQty > 0 ? new Date().toISOString() : null; } } break; }
    case "bumpStation": { const o = state.open[p.tableId]; if (o) o.items.forEach((x) => { if (x.printerId === p.printerId && x.sent && !x.done) { x.doneQty = x.qty; x.done = true; x.doneAt = new Date().toISOString(); } }); break; }
    case "bumpList": { const o = state.open[p.tableId]; if (o) o.items.forEach((x) => { if ((p.lids || []).includes(x.lid)) { x.doneQty = x.qty; x.done = true; x.doneAt = new Date().toISOString(); } }); break; }
    case "placeOrder": {
      const o = state.open[p.tableId]; if (!o) { print = { ok: false }; break; }
      const t = state.tables.find((x) => x.id === p.tableId);
      const newly = o.items.filter((x) => !x.sent);
      newly.forEach((x) => { x.sent = true; x.placedAt = new Date().toISOString(); });
      const prepNewly = newly.filter((x) => x.printerId && x.printerId !== state.receiptPrinterId);
      const results = [];
      if (state.settings.autoPrintPrep) {
        for (const pr of state.printers) {
          if (pr.id === state.receiptPrinterId) continue;
          const items = prepNewly.filter((x) => printerReceives(pr, x));
          if (!items.length) continue;
          results.push(await printPrep(pr, t?.name, waiterId, items));
        }
      }
      if (state.settings.orderBillOnSend) { const rp = printerById(state.receiptPrinterId); if (rp) results.push(await printOrderBill(rp, newly)); }
      consolidate(o);
      print = { ok: results.every((r) => r.ok), results, fired: newly.length, muted: !state.settings.autoPrintPrep };
      break;
    }
    case "printBill": {
      const o = state.open[p.tableId]; if (!o) break;
      const t = state.tables.find((x) => x.id === p.tableId);
      print = await printReceipt({ tableName: t?.name, waiterId, items: o.items, total: orderTotal(o), payments: o.payments });
      break;
    }
    case "printOrder": {                                    // manual: print the ΔΕΛΤΙΟ ΠΑΡΑΓΓΕΛΙΑΣ on demand
      const o = state.open[p.tableId]; if (!o) { print = { ok: false }; break; }
      const rp = printerById(state.receiptPrinterId);
      print = rp ? await printOrderBill(rp, o.items) : { ok: false, reason: "no-receipt-printer" };
      break;
    }
    case "pay": {
      const o = state.open[p.tableId]; if (!o) break;
      o.payments = o.payments || [];
      o.payments.push({ amount: round2(p.amount), method: p.method, waiterId, at: new Date().toISOString(), lines: p.lines || null });
      const total = orderTotal(o), paid = round2(o.payments.reduce((s, x) => s + x.amount, 0));
      if (paid + 0.005 >= total) {
        const t = state.tables.find((x) => x.id === p.tableId);
        const methods = [...new Set(o.payments.map((x) => x.method))];
        state.counter = state.counter || { n: 0, openedAt: null, bizDay: null };
        const bd = bizDayKey(Date.now());
        if (state.counter.bizDay && state.counter.bizDay !== bd) state.counter = { n: 0, openedAt: new Date().toISOString(), bizDay: bd };  // new business day → numbering restarts
        if (!state.counter.bizDay) state.counter.bizDay = bd;
        const no = (state.counter.n || 0) + 1; state.counter.n = no; if (!state.counter.openedAt) state.counter.openedAt = new Date().toISOString();
        const fl = state.floors.find((f) => f.id === (t && t.floorId));
        sale = { id: uid(), no, tableId: p.tableId, tableName: t?.name || "?", floorName: fl ? fl.name : "", items: o.items, total, payments: o.payments,
          method: methods.length > 1 ? "split" : methods[0], waiterId: o.openedBy || waiterId, closedAt: new Date().toISOString() };
        state.sales.unshift(sale);
        insertSale(sale);
        delete state.open[p.tableId];
        print = state.settings.autoPrintReceipt ? await printReceipt(sale) : { ok: false, reason: "off" };
        if (state.settings.orderBillOnPay) { const rp = printerById(state.receiptPrinterId); if (rp) await printOrderBill(rp, sale.items); }
      }
      break;
    }
    case "moveTable": { const t = state.tables.find((x) => x.id === p.tableId); if (t) { t.x = p.x; t.y = p.y; } break; }
    case "updateTable": { const t = state.tables.find((x) => x.id === p.id); if (t) Object.assign(t, p.patch || {}); break; }
    case "addTable": {
      const others = state.tables.filter((t) => t.floorId === p.floorId);
      let x = p.x, y = p.y;
      if (x == null || y == null) {
        const cand = [];
        for (let gy = 16; gy <= 84; gy += 15) for (let gx = 12; gx <= 88; gx += 12) cand.push({ x: gx, y: gy });
        let best = cand[0], bestD = -1;
        for (const c of cand) {
          if (!others.length) { best = c; break; }
          let d = 1e9; for (const t of others) { const dx = t.x - c.x, dy = t.y - c.y; d = Math.min(d, dx * dx + dy * dy); }
          if (d > 12 * 12) { best = c; break; }   // first slot comfortably clear of every existing table
          if (d > bestD) { bestD = d; best = c; }  // else remember the most-spacious slot
        }
        x = best.x; y = best.y;
      }
      state.tables.push({ id: uid(), name: p.name, seats: p.seats || 4, floorId: p.floorId, x, y, shape: p.shape || "square", size: p.size || "m" });
      break;
    }
    case "deleteTable": state.tables = state.tables.filter((t) => t.id !== p.id); break;
    case "addFloor": state.floors.push({ id: uid(), name: p.name }); break;
    case "deleteFloor": if (state.floors.length > 1) { state.floors = state.floors.filter((f) => f.id !== p.id); state.tables = state.tables.filter((t) => t.floorId !== p.id); } break;
    case "addProduct": state.menu.push({ id: uid(), name: p.name, price: p.price, cat: p.cat, printerId: p.printerId || "", vat: p.vat != null ? p.vat : 13, unit: p.unit === "kg" ? "kg" : (p.unit === "open" ? "open" : "each") }); break;
    case "updateProduct": { const m = state.menu.find((x) => x.id === p.id); if (m) Object.assign(m, p.patch || {}); break; }
    case "deleteProduct": state.menu = state.menu.filter((m) => m.id !== p.id); break;
    case "addPrinter": state.printers.push({ id: uid(), name: p.name || "Printer", ip: p.ip || "", color: p.color || "#E8A23D" }); break;
    case "updatePrinter": { const pr = state.printers.find((x) => x.id === p.id); if (pr) Object.assign(pr, p.patch || {}); break; }
    case "deletePrinter": state.printers = state.printers.filter((x) => x.id !== p.id); if (state.receiptPrinterId === p.id) state.receiptPrinterId = ""; state.menu.forEach((m) => { if (m.printerId === p.id) m.printerId = ""; }); break;
    case "setReceiptPrinter": state.receiptPrinterId = p.id; break;
    case "setShop": state.shop = { ...state.shop, ...p }; break;
    case "setSetting": state.settings = { ...state.settings, ...p }; break;
    case "setBackup": state.settings = { ...state.settings, ...(p || {}) }; break;
    case "backupNow": return { ok: true, backup: writeSnapshot("manual") };
    case "listBackups": return { ok: true, backups: listBackups() };
    case "restoreBackup": { try { restoreFromFile(p.dir, p.name); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } }
    case "closeDay": { const prev = (state.counter && state.counter.n) || 0; state.counter = { n: 0, openedAt: new Date().toISOString() }; return { ok: true, closed: { count: prev } }; }
    case "reprintSale": { const s = state.sales.find((x) => x.id === p.id); print = s ? await printReceipt(s) : { ok: false, reason: "not-found" }; break; }
    case "printZ": {
      const arr = state.sales.filter((s) => { const d = bizDayKey(s.closedAt); return (!p.from || d >= p.from) && (!p.to || d <= p.to); });
      const agg = aggZ(arr); const pr = printerById(state.receiptPrinterId); const W = pr && pr.width === "58" ? 32 : 48;
      if (PRINT_DEBUG) { const bar = "=".repeat(W + 4); console.log("\n" + bar + "\n  🖨  PRINT → " + (pr ? pr.name : "Receipt") + " · ΑΝΑΦΟΡΑ Ζ   (" + (pr && pr.width === "58" ? "58" : "80") + "mm)\n" + bar + "\n" + zTicketText(agg, p.label || "", pr && pr.width).split("\n").map((l) => "  " + l).join("\n") + "\n" + bar + "\n"); }
      if (pr && pr.ip) { try { await sendToPrinter(pr.ip, pr.port, buildZTicket(agg, p.label || "", pr.width)); print = { ok: true }; } catch { print = { ok: false, reason: "offline" }; } }
      else print = { ok: false, reason: pr ? "no-ip" : "no-receipt-printer" };
      break;
    }
    case "importData": { try { applyFullState(p.data); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } }
    case "seedDemoSales": {
      const menu = state.menu.length ? state.menu : [{ id: "d", name: "Coffee", price: 2, vat: 13, printerId: "pb" }];
      const ws = state.waiters.length ? state.waiters : [{ id: "w0" }];
      const now = Date.now(); const out = [];
      for (let d = 0; d < 365; d++) {
        const orders = 1 + Math.floor(Math.random() * 3);
        for (let k = 0; k < orders; k++) {
          const nItems = 1 + Math.floor(Math.random() * 4); const items = [];
          for (let j = 0; j < nItems; j++) { const m = menu[Math.floor(Math.random() * menu.length)]; items.push({ lid: uid(), id: m.id, name: m.name, price: m.price, vat: m.vat != null ? m.vat : 13, printerId: m.printerId || "", qty: 1 + Math.floor(Math.random() * 2), opts: null, note: "" }); }
          const total = round2(items.reduce((s, x) => s + itemGross(x), 0));
          const method = Math.random() < 0.5 ? "cash" : "card";
          const w = ws[Math.floor(Math.random() * ws.length)];
          const closedAt = new Date(now - d * 86400000 - Math.floor(Math.random() * 12 * 3600000)).toISOString();
          out.push({ id: uid(), tableId: "demo", tableName: "T" + (1 + Math.floor(Math.random() * 20)), items, total, payments: [{ amount: total, method, waiterId: w.id, at: closedAt }], method, waiterId: w.id, closedAt, demo: true });
        }
      }
      state.sales = out.concat(state.sales);
      replaceSales(state.sales);
      break;
    }
    case "preview": {
      const o = state.open[p.tableId]; const t = state.tables.find((x) => x.id === p.tableId);
      const items = o ? o.items : [];
      const unsent = items.filter((x) => !x.sent); const base = unsent.length ? unsent : items;
      const prepBase = base.filter((x) => x.printerId && x.printerId !== state.receiptPrinterId);
      const prep = [];
      for (const pr of state.printers) {
        if (pr.id === state.receiptPrinterId) continue;
        const its = prepBase.filter((x) => printerReceives(pr, x));
        if (!its.length) continue;
        const total = pr.priced ? round2(its.reduce((s, x) => s + itemGross(x), 0)) : undefined;
        prep.push({ name: pr.name, width: pr.width || "80", text: ticketText({ title: pr.name.toUpperCase(), table: t?.name, servedBy: waiterName(waiterId), items: its, priced: !!pr.priced, total, width: pr.width, notLegal: !!pr.priced }) });
      }
      const rp = printerById(state.receiptPrinterId);
      const receipt = { name: rp ? rp.name : "Receipt", width: (rp && rp.width) || "80", text: ticketText({ title: "RECEIPT", table: t?.name, servedBy: waiterName(o ? (o.openedBy || waiterId) : waiterId), items, total: round2(items.reduce((s, x) => s + itemGross(x), 0)), payments: o ? o.payments : [], priced: true, width: rp && rp.width, shop: state.shop }) };
      return { ok: true, preview: { prep, receipt } };
    }
    case "addWaiter": state.waiters.push({ id: uid(), name: p.name, color: p.color || "#E8A23D", role: ["admin", "manager", "waiter", "kitchen"].includes(p.role) ? p.role : "waiter", pin: p.pin || "" }); break;
    case "updateWaiter": { const w = state.waiters.find((x) => x.id === p.id); if (w) Object.assign(w, p.patch || {}); break; }
    case "deleteWaiter": state.waiters = state.waiters.filter((w) => w.id !== p.id); break;
    case "reset": state = JSON.parse(JSON.stringify(SEED)); migrate(); replaceSales(state.sales); break;
  }
  save(); broadcast();
  return { ok: true, print, sale };
}

/* ---------------- http ---------------- */
function serveStatic(res, file) {
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" }[path.extname(file)] || "text/plain";
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end("Not found"); } else { res.writeHead(200, { "Content-Type": mime }); res.end(data); } });
}
const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/api/state") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(publicState())); }
  if (url === "/api/export") {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="kafeneio-data-' + new Date().toISOString().slice(0, 10) + '.json"' });
    return res.end(JSON.stringify(state, null, 2));
  }
  if (url === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("data: " + JSON.stringify(publicState()) + "\n\n"); clients.add(res); req.on("close", () => clients.delete(res)); return;
  }
  if (url === "/api/login" && req.method === "POST") {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => { const { name, pin } = JSON.parse(b || "{}"); const w = state.waiters.find((x) => x.name === name);
      const ok = w && (!w.pin || w.pin === (pin || ""));
      res.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ok ? { ok: true, waiter: { id: w.id, name: w.name, color: w.color, role: w.role } } : { ok: false })); });
    return;
  }
  if (url === "/api/action" && req.method === "POST") {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", async () => { try { const { type, payload, waiterId } = JSON.parse(b || "{}");
      const r = await handleAction(type, payload, waiterId); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(r)); }
      catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: e.message })); } });
    return;
  }
  if (url === "/") return serveStatic(res, path.join(PUBLIC, "index.html"));
  return serveStatic(res, path.join(PUBLIC, path.normalize(url).replace(/^(\.\.[/\\])+/, "")));
});
server.listen(PORT, "0.0.0.0", () => {
  const nets = os.networkInterfaces(); const ips = [];
  for (const n of Object.keys(nets)) for (const x of nets[n]) if (x.family === "IPv4" && !x.internal) ips.push(x.address);
  console.log("\n  Kafeneío POS is running.\n");
  console.log("  On this computer:      http://localhost:" + PORT);
  ips.forEach((ip) => console.log("  On phones (same Wi-Fi): http://" + ip + ":" + PORT));
  console.log("\n  Log in as Manager for full access; waiters see only ordering.\n");
  console.log("  (Leave this window open while the shop is running.)\n");
  try { writeSnapshot("startup"); } catch {}
  setInterval(() => {
    const s = state.settings || {};
    if (!s.autoBackup || !dirty) return;
    const last = state.meta && state.meta.lastBackupAt ? Date.parse(state.meta.lastBackupAt) : 0;
    if ((Date.now() - last) / 60000 >= (s.backupIntervalMin || 10)) { try { writeSnapshot("auto"); } catch {} }
  }, 60000);
  if (process.env.NO_OPEN !== "1") {                       // auto-open the browser on the shop device
    const url = "http://localhost:" + PORT;
    try {
      const { spawn } = require("child_process");
      const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
      const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
      spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    } catch {}
  }
});
["SIGINT", "SIGTERM"].forEach((sig) => process.on(sig, () => { try { writeSnapshot("shutdown"); } catch {} process.exit(0); }));
