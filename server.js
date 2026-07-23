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

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const PUBLIC = path.join(__dirname, "public");
const uid = () => Math.random().toString(36).slice(2, 9);
const round2 = (n) => Math.round(n * 100) / 100;

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
  ],
  waiters: [
    { id: "w0", name: "Manager", color: "#C98FE8", role: "admin", pin: "1234" },
    { id: "w1", name: "Maria", color: "#E8A23D", role: "waiter", pin: "1111" },
    { id: "w2", name: "Nikos", color: "#7BC49A", role: "waiter", pin: "2222" },
  ],
  shop: { name: "Kafeneío", vat: "", taxOffice: "", address: "", phone: "", dayStart: 5 },
  open: {},
  sales: [],
};

/* ---------------- load + migrate ---------------- */
let state;
try { state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { state = null; }
if (!state) { state = JSON.parse(JSON.stringify(SEED)); }
migrate();
save();

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
  state.printers.forEach((p) => {
    if (p.mode === undefined) p.mode = p.all ? "all" : (/bar/i.test(p.name) ? "rest" : "own");
    if (p.food === undefined) p.food = /kitchen/i.test(p.name);
    if (p.port === undefined) p.port = 9100;
    if (p.width === undefined) p.width = "80";
  });
  // tables need a size
  state.tables.forEach((t) => { if (!t.size) t.size = "m"; if (!t.shape) t.shape = "square"; });
  // menu: station -> printerId
  const map = { kitchen: "pk", bar: "pb", none: "" };
  state.menu.forEach((m) => { if (m.printerId === undefined) m.printerId = map[m.station] ?? "pb"; delete m.station; if (m.vat === undefined) m.vat = m.cat === "Cold Drinks" ? 24 : 13; });
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
    if (it.sent === undefined) it.sent = true;
  }));
}

function save() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)); } catch (e) { console.error("save failed", e); } }
const orderTotal = (o) => round2((o.items || []).reduce((s, x) => s + x.price * x.qty, 0));
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
const cols = (l, r, w = 42) => L(String(l) + " ".repeat(Math.max(1, w - String(l).length - String(r).length)) + String(r));
function buildTicket({ title, table, servedBy, items, total, payments, priced, width, shop }) {
  const W = width === "58" ? 32 : 48;
  const col = (l, r) => L(String(l) + " ".repeat(Math.max(1, W - String(l).length - String(r).length)) + String(r));
  const p = [B(CP.init), B(CP.center), B(CP.big), B(CP.boldOn), L(priced && shop && shop.name ? shop.name : title), B(CP.normal), B(CP.boldOff)];
  if (priced && shop) {                                   // business header on the customer bill
    if (shop.address) p.push(L(shop.address));
    const l2 = [shop.vat && ("AFM " + shop.vat), shop.taxOffice && ("DOY " + shop.taxOffice)].filter(Boolean).join("  ");
    if (l2) p.push(L(l2));
    if (shop.phone) p.push(L("Tel " + shop.phone));
  }
  if (table) p.push(B(CP.boldOn), L("Table " + table), B(CP.boldOff));
  if (servedBy) p.push(L("Served by " + servedBy));
  p.push(L(new Date().toLocaleString()), B(CP.left), L("-".repeat(W)));
  for (const it of items) {
    if (priced) p.push(col(`${it.qty} x ${it.name}`, "EUR " + (it.qty * it.price).toFixed(2)));
    else p.push(B(CP.boldOn), L(`${it.qty} x ${it.name}`), B(CP.boldOff));
    if (it.opts && it.opts.length) p.push(L("   >> " + it.opts.map((o) => o.values.join(", ")).join(" / ")));
    if (it.note) p.push(L("   >> " + it.note));
  }
  if (priced && typeof total === "number") {
    p.push(L("-".repeat(W)), B(CP.big), B(CP.boldOn), col("TOTAL", "EUR " + total.toFixed(2)), B(CP.normal), B(CP.boldOff));
    for (const pay of payments || []) p.push(L(`  ${pay.method === "card" ? "Card/POS" : "Cash"}: EUR ${pay.amount.toFixed(2)}`));
  }
  p.push(B(CP.feed(1)), B(CP.center), L("* * *"), B(CP.left), B(CP.feed(3)), B(CP.cut));
  return Buffer.concat(p);
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
async function printPrep(printer, tableName, waiterId, items) {
  const buf = buildTicket({ title: printer.name.toUpperCase(), table: tableName, servedBy: waiterName(waiterId), items, priced: false, width: printer.width });
  if (!printer.ip) return { name: printer.name, ok: false, reason: "no-ip" };
  try { await sendToPrinter(printer.ip, printer.port, buf); return { name: printer.name, ok: true }; }
  catch { return { name: printer.name, ok: false, reason: "offline" }; }
}
async function printReceipt(sale) {
  const pr = printerById(state.receiptPrinterId);
  const buf = buildTicket({ title: "RECEIPT", table: sale.tableName, servedBy: waiterName(sale.waiterId), items: sale.items, total: sale.total, payments: sale.payments, priced: true, width: pr && pr.width, shop: state.shop });
  if (!pr || !pr.ip) return { ok: false, reason: "no-ip" };
  try { await sendToPrinter(pr.ip, pr.port, buf); return { ok: true }; } catch { return { ok: false, reason: "offline" }; }
}

/* ---------------- actions ---------------- */
const ADMIN = new Set(["addProduct", "deleteProduct", "addFloor", "deleteFloor", "addTable", "deleteTable",
  "updateTable", "moveTable", "addPrinter", "updatePrinter", "deletePrinter", "setReceiptPrinter",
  "addWaiter", "updateWaiter", "deleteWaiter", "reset", "setShop"]);

async function handleAction(type, payload = {}, waiterId) {
  const actor = state.waiters.find((w) => w.id === waiterId);
  if (ADMIN.has(type) && (!actor || actor.role !== "admin")) return { ok: false, error: "admin_only" };
  let print = null, sale = null; const p = payload;
  switch (type) {
    case "addItem": {
      const o = state.open[p.tableId] || { items: [], openedAt: new Date().toISOString(), openedBy: waiterId, payments: [] };
      const hasOpts = p.item.opts && p.item.opts.length;
      const i = hasOpts ? -1 : o.items.findIndex((x) => x.id === p.item.id && !x.sent && !(x.opts && x.opts.length));
      if (i >= 0) o.items[i].qty += 1;
      else o.items.push({ ...p.item, opts: p.item.opts || null, lid: uid(), qty: 1, waiterId, sent: false, done: false, doneQty: 0, note: "" });
      state.open[p.tableId] = o; break;
    }
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
      for (const pr of state.printers) {
        if (pr.id === state.receiptPrinterId) continue;
        const items = prepNewly.filter((x) => printerReceives(pr, x));
        if (!items.length) continue;
        results.push(await printPrep(pr, t?.name, waiterId, items));
      }
      print = { ok: results.every((r) => r.ok), results, fired: newly.length };
      break;
    }
    case "printBill": {
      const o = state.open[p.tableId]; if (!o) break;
      const t = state.tables.find((x) => x.id === p.tableId);
      print = await printReceipt({ tableName: t?.name, waiterId, items: o.items, total: orderTotal(o), payments: o.payments });
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
        sale = { id: uid(), tableId: p.tableId, tableName: t?.name || "?", items: o.items, total, payments: o.payments,
          method: methods.length > 1 ? "split" : methods[0], waiterId: o.openedBy || waiterId, closedAt: new Date().toISOString() };
        state.sales.unshift(sale);
        delete state.open[p.tableId];
        print = await printReceipt(sale);
      }
      break;
    }
    case "moveTable": { const t = state.tables.find((x) => x.id === p.tableId); if (t) { t.x = p.x; t.y = p.y; } break; }
    case "updateTable": { const t = state.tables.find((x) => x.id === p.id); if (t) Object.assign(t, p.patch || {}); break; }
    case "addTable": state.tables.push({ id: uid(), name: p.name, seats: p.seats || 4, floorId: p.floorId, x: p.x ?? 50, y: p.y ?? 50, shape: p.shape || "square", size: p.size || "m" }); break;
    case "deleteTable": state.tables = state.tables.filter((t) => t.id !== p.id); break;
    case "addFloor": state.floors.push({ id: uid(), name: p.name }); break;
    case "deleteFloor": if (state.floors.length > 1) { state.floors = state.floors.filter((f) => f.id !== p.id); state.tables = state.tables.filter((t) => t.floorId !== p.id); } break;
    case "addProduct": state.menu.push({ id: uid(), name: p.name, price: p.price, cat: p.cat, printerId: p.printerId || "", vat: p.vat != null ? p.vat : 13 }); break;
    case "updateProduct": { const m = state.menu.find((x) => x.id === p.id); if (m) Object.assign(m, p.patch || {}); break; }
    case "deleteProduct": state.menu = state.menu.filter((m) => m.id !== p.id); break;
    case "addPrinter": state.printers.push({ id: uid(), name: p.name || "Printer", ip: p.ip || "", color: p.color || "#E8A23D" }); break;
    case "updatePrinter": { const pr = state.printers.find((x) => x.id === p.id); if (pr) Object.assign(pr, p.patch || {}); break; }
    case "deletePrinter": state.printers = state.printers.filter((x) => x.id !== p.id); if (state.receiptPrinterId === p.id) state.receiptPrinterId = ""; state.menu.forEach((m) => { if (m.printerId === p.id) m.printerId = ""; }); break;
    case "setReceiptPrinter": state.receiptPrinterId = p.id; break;
    case "setShop": state.shop = { ...state.shop, ...p }; break;
    case "addWaiter": state.waiters.push({ id: uid(), name: p.name, color: p.color || "#E8A23D", role: p.role === "admin" ? "admin" : "waiter", pin: p.pin || "" }); break;
    case "updateWaiter": { const w = state.waiters.find((x) => x.id === p.id); if (w) Object.assign(w, p.patch || {}); break; }
    case "deleteWaiter": state.waiters = state.waiters.filter((w) => w.id !== p.id); break;
    case "reset": state = JSON.parse(JSON.stringify(SEED)); break;
  }
  save(); broadcast();
  return { ok: true, print, sale };
}

/* ---------------- http ---------------- */
function serveStatic(res, file) {
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] || "text/plain";
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end("Not found"); } else { res.writeHead(200, { "Content-Type": mime }); res.end(data); } });
}
const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/api/state") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(publicState())); }
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
});
