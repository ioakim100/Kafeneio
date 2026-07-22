/*
 * Kafeneío POS — local server
 * ----------------------------------------------------------------------
 * ONE file, ZERO dependencies. Run it on the PC or tablet that stays in
 * the shop; every waiter's phone connects to it over the same Wi-Fi.
 *
 *   1) Install Node.js 18+  (https://nodejs.org)
 *   2) node server.js
 *   3) It prints the address to open, e.g.  http://192.168.1.10:3000
 *      Open that on the shop tablet AND on each waiter's phone.
 *
 * The server holds the single source of truth (tables, orders, sales,
 * waiters) in data.json, pushes live updates to every device, and prints
 * straight to the kitchen / receipt thermal printers over TCP 9100.
 */

const http = require("http");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const PUBLIC = path.join(__dirname, "public");

/* ---------------- seed / persistence ---------------- */
const SEED = {
  floors: [{ id: "f1", name: "Main Room" }, { id: "f2", name: "Garden" }],
  tables: [
    { id: "t1", name: "T1", seats: 2, floorId: "f1", x: 18, y: 22, shape: "square" },
    { id: "t2", name: "T2", seats: 2, floorId: "f1", x: 42, y: 22, shape: "square" },
    { id: "t3", name: "T3", seats: 4, floorId: "f1", x: 66, y: 22, shape: "square" },
    { id: "t4", name: "T4", seats: 4, floorId: "f1", x: 18, y: 60, shape: "square" },
    { id: "t5", name: "T5", seats: 6, floorId: "f1", x: 42, y: 60, shape: "square" },
    { id: "t6", name: "T6", seats: 4, floorId: "f1", x: 66, y: 60, shape: "square" },
    { id: "t7", name: "Bar 1", seats: 1, floorId: "f1", x: 88, y: 28, shape: "round" },
    { id: "t8", name: "Bar 2", seats: 1, floorId: "f1", x: 88, y: 52, shape: "round" },
    { id: "y1", name: "G1", seats: 4, floorId: "f2", x: 26, y: 28, shape: "round" },
    { id: "y2", name: "G2", seats: 4, floorId: "f2", x: 58, y: 28, shape: "round" },
    { id: "y3", name: "G3", seats: 2, floorId: "f2", x: 26, y: 66, shape: "round" },
    { id: "y4", name: "G4", seats: 6, floorId: "f2", x: 58, y: 66, shape: "square" },
  ],
  menu: [
    { id: "m1", name: "Espresso", price: 2.0, cat: "Coffee", station: "bar" },
    { id: "m2", name: "Freddo Cappuccino", price: 3.5, cat: "Coffee", station: "bar" },
    { id: "m3", name: "Greek Coffee", price: 2.2, cat: "Coffee", station: "bar" },
    { id: "m4", name: "Orange Juice", price: 4.0, cat: "Cold Drinks", station: "bar" },
    { id: "m5", name: "Still Water", price: 0.5, cat: "Cold Drinks", station: "none" },
    { id: "m6", name: "Draft Beer", price: 5.0, cat: "Cold Drinks", station: "bar" },
    { id: "m7", name: "House Wine (glass)", price: 4.5, cat: "Cold Drinks", station: "bar" },
    { id: "m8", name: "Club Sandwich", price: 7.5, cat: "Food", station: "kitchen" },
    { id: "m9", name: "Greek Salad", price: 8.0, cat: "Food", station: "kitchen" },
    { id: "m10", name: "Cheeseburger", price: 11.0, cat: "Food", station: "kitchen" },
    { id: "m11", name: "Margherita Pizza", price: 9.5, cat: "Food", station: "kitchen" },
    { id: "m12", name: "French Fries", price: 4.0, cat: "Food", station: "kitchen" },
    { id: "m13", name: "Pasta Carbonara", price: 10.5, cat: "Food", station: "kitchen" },
    { id: "m14", name: "Cheesecake", price: 5.5, cat: "Dessert", station: "none" },
    { id: "m15", name: "Baklava", price: 4.5, cat: "Dessert", station: "none" },
  ],
  waiters: [
    { id: "w1", name: "Maria", color: "#E8A23D", pin: "" },
    { id: "w2", name: "Nikos", color: "#7BC49A", pin: "" },
  ],
  printers: { kitchenIp: "", receiptIp: "" },
  open: {},   // tableId -> { items:[{id,name,price,station,qty,waiterId}], openedAt, openedBy, payments:[], bumped }
  sales: [],  // closed tickets
};

let state;
try { state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
catch { state = SEED; save(); }
// make sure newer fields exist if loading an older file
for (const k of Object.keys(SEED)) if (state[k] === undefined) state[k] = SEED[k];

function save() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)); } catch (e) { console.error("save failed", e); } }
const uid = () => Math.random().toString(36).slice(2, 9);
const round2 = (n) => Math.round(n * 100) / 100;
const orderTotal = (o) => round2((o.items || []).reduce((s, x) => s + x.price * x.qty, 0));
const waiterName = (id) => (state.waiters.find((w) => w.id === id) || {}).name || "—";

/* ---------------- live sync (SSE) ---------------- */
const clients = new Set();
function publicState() {
  // never expose PINs to devices
  return { ...state, waiters: state.waiters.map(({ pin, ...w }) => w) };
}
function broadcast() {
  const data = "data: " + JSON.stringify(publicState()) + "\n\n";
  for (const res of clients) { try { res.write(data); } catch {} }
}

/* ---------------- ESC/POS printing ---------------- */
const ESC = 0x1b, GS = 0x1d;
const P = {
  init: [ESC, 0x40], boldOn: [ESC, 0x45, 1], boldOff: [ESC, 0x45, 0],
  center: [ESC, 0x61, 1], left: [ESC, 0x61, 0],
  big: [GS, 0x21, 0x11], normal: [GS, 0x21, 0x00],
  feed: (n) => [ESC, 0x64, n], cut: [GS, 0x56, 0x42, 0x00],
};
const L = (s = "") => Buffer.from(s + "\n", "latin1");
const B = (a) => Buffer.from(a);
function cols(l, r, w = 42) { const s = Math.max(1, w - String(l).length - String(r).length); return L(String(l) + " ".repeat(s) + String(r)); }

function buildTicket({ title, table, servedBy, items, total, payments, isKitchen }) {
  const p = [B(P.init), B(P.center), B(P.big), B(P.boldOn), L(title), B(P.normal), B(P.boldOff)];
  if (table) { p.push(B(P.boldOn), L("Table " + table), B(P.boldOff)); }
  if (servedBy) p.push(L("Served by " + servedBy));
  p.push(L(new Date().toLocaleString()), B(P.left), L("-".repeat(42)));
  for (const it of items) {
    if (isKitchen) p.push(B(P.boldOn), L(`${it.qty} x ${it.name}`), B(P.boldOff));
    else p.push(cols(`${it.qty} x ${it.name}`, "EUR " + (it.qty * it.price).toFixed(2)));
  }
  if (!isKitchen && typeof total === "number") {
    p.push(L("-".repeat(42)), B(P.big), B(P.boldOn), cols("TOTAL", "EUR " + total.toFixed(2), 21), B(P.normal), B(P.boldOff));
    for (const pay of payments || []) p.push(L(`  ${pay.method === "card" ? "Card/POS" : "Cash"}: EUR ${pay.amount.toFixed(2)}`));
  }
  p.push(B(P.feed(1)), B(P.center), L("* * *"), B(P.left), B(P.feed(3)), B(P.cut));
  return Buffer.concat(p);
}
function sendToPrinter(ip, buffer) {
  return new Promise((resolve, reject) => {
    if (!ip) return reject(new Error("no-printer"));
    const s = new net.Socket(); s.setTimeout(4000);
    s.connect(9100, ip, () => s.write(buffer, () => s.end()));
    s.on("close", () => resolve(true));
    s.on("timeout", () => { s.destroy(); reject(new Error("offline")); });
    s.on("error", () => reject(new Error("offline")));
  });
}
async function printKitchen(tableId, waiterId) {
  const o = state.open[tableId]; if (!o) return { ok: false, reason: "no-order" };
  const t = state.tables.find((x) => x.id === tableId);
  const items = o.items.filter((x) => x.station === "kitchen");
  if (!items.length) return { ok: false, reason: "no-items" };
  const buf = buildTicket({ title: "KITCHEN", table: t?.name, servedBy: waiterName(waiterId), items, isKitchen: true });
  try { await sendToPrinter(state.printers.kitchenIp, buf); return { ok: true }; }
  catch (e) { return { ok: false, reason: state.printers.kitchenIp ? "offline" : "no-printer" }; }
}
async function printReceipt(sale) {
  const buf = buildTicket({ title: "KAFENEIO", table: sale.tableName, servedBy: waiterName(sale.waiterId),
    items: sale.items, total: sale.total, payments: sale.payments, isKitchen: false });
  try { await sendToPrinter(state.printers.receiptIp, buf); return { ok: true }; }
  catch (e) { return { ok: false, reason: state.printers.receiptIp ? "offline" : "no-printer" }; }
}

/* ---------------- actions (all mutations go through here) ---------------- */
async function handleAction(type, payload = {}, waiterId) {
  let print = null, sale = null;
  const p = payload;
  switch (type) {
    case "addItem": {
      const o = state.open[p.tableId] || { items: [], openedAt: new Date().toISOString(), openedBy: waiterId, payments: [], bumped: false };
      const i = o.items.findIndex((x) => x.id === p.item.id);
      if (i >= 0) o.items[i].qty += 1;
      else o.items.push({ ...p.item, qty: 1, waiterId });
      o.bumped = false; state.open[p.tableId] = o; break;
    }
    case "changeQty": {
      const o = state.open[p.tableId]; if (!o) break;
      o.items[p.index].qty += p.delta;
      o.items = o.items.filter((x) => x.qty > 0);
      if (!o.items.length) delete state.open[p.tableId]; break;
    }
    case "removeItem": {
      const o = state.open[p.tableId]; if (!o) break;
      o.items.splice(p.index, 1);
      if (!o.items.length) delete state.open[p.tableId]; break;
    }
    case "sendKitchen": print = await printKitchen(p.tableId, waiterId); break;
    case "printBill": {
      const o = state.open[p.tableId]; if (!o) break;
      const t = state.tables.find((x) => x.id === p.tableId);
      print = await printReceipt({ tableName: t?.name, waiterId, items: o.items, total: orderTotal(o), payments: o.payments });
      break;
    }
    case "pay": {
      const o = state.open[p.tableId]; if (!o) break;
      o.payments = o.payments || [];
      o.payments.push({ amount: round2(p.amount), method: p.method, waiterId, at: new Date().toISOString() });
      const total = orderTotal(o);
      const paid = round2(o.payments.reduce((s, x) => s + x.amount, 0));
      if (paid + 0.005 >= total) {
        const t = state.tables.find((x) => x.id === p.tableId);
        const methods = [...new Set(o.payments.map((x) => x.method))];
        sale = { id: uid(), tableId: p.tableId, tableName: t?.name || "?", items: o.items,
          total, payments: o.payments, method: methods.length > 1 ? "split" : methods[0],
          waiterId: o.openedBy || waiterId, closedAt: new Date().toISOString() };
        state.sales.unshift(sale);
        delete state.open[p.tableId];
        print = await printReceipt(sale);        // auto-print final receipt
      }
      break;
    }
    case "moveTable": { const t = state.tables.find((x) => x.id === p.tableId); if (t) { t.x = p.x; t.y = p.y; } break; }
    case "addTable": state.tables.push({ id: uid(), name: p.name, seats: p.seats || 4, floorId: p.floorId, x: p.x ?? 50, y: p.y ?? 50, shape: p.shape || "square" }); break;
    case "deleteTable": state.tables = state.tables.filter((t) => t.id !== p.id); break;
    case "addFloor": state.floors.push({ id: uid(), name: p.name }); break;
    case "deleteFloor": if (state.floors.length > 1) { state.floors = state.floors.filter((f) => f.id !== p.id); state.tables = state.tables.filter((t) => t.floorId !== p.id); } break;
    case "addProduct": state.menu.push({ id: uid(), name: p.name, price: p.price, cat: p.cat, station: p.station }); break;
    case "deleteProduct": state.menu = state.menu.filter((m) => m.id !== p.id); break;
    case "addWaiter": state.waiters.push({ id: uid(), name: p.name, color: p.color || "#E8A23D", pin: p.pin || "" }); break;
    case "deleteWaiter": state.waiters = state.waiters.filter((w) => w.id !== p.id); break;
    case "bumpKitchen": { const o = state.open[p.tableId]; if (o) o.bumped = true; break; }
    case "setPrinters": state.printers = { ...state.printers, ...p }; break;
    case "reset": state = JSON.parse(JSON.stringify(SEED)); break;
  }
  save(); broadcast();
  return { ok: true, print, sale };
}

/* ---------------- HTTP ---------------- */
function serveStatic(res, file) {
  const ext = path.extname(file);
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[ext] || "text/plain";
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": mime }); res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  if (url === "/api/state") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(publicState())); }

  if (url === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("data: " + JSON.stringify(publicState()) + "\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (url === "/api/login" && req.method === "POST") {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { name, pin } = JSON.parse(body || "{}");
      const w = state.waiters.find((x) => x.name === name);
      const ok = w && (!w.pin || w.pin === (pin || ""));
      res.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ok ? { ok: true, waiter: { id: w.id, name: w.name, color: w.color } } : { ok: false }));
    });
    return;
  }

  if (url === "/api/action" && req.method === "POST") {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { type, payload, waiterId } = JSON.parse(body || "{}");
        const result = await handleAction(type, payload, waiterId);
        res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(result));
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: e.message })); }
    });
    return;
  }

  // static client
  if (url === "/" ) return serveStatic(res, path.join(PUBLIC, "index.html"));
  const safe = path.normalize(url).replace(/^(\.\.[/\\])+/, "");
  return serveStatic(res, path.join(PUBLIC, safe));
});

server.listen(PORT, "0.0.0.0", () => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) for (const n of nets[name]) if (n.family === "IPv4" && !n.internal) ips.push(n.address);
  console.log("\n  Kafeneío POS is running.\n");
  console.log("  On this computer:      http://localhost:" + PORT);
  ips.forEach((ip) => console.log("  On phones (same Wi-Fi): http://" + ip + ":" + PORT));
  console.log("\n  Open that address on the shop tablet and on every waiter's phone.\n");
});
