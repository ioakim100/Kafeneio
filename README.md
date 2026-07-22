# Kafeneío POS

A small restaurant/café point-of-sale you run on one computer or tablet in the shop.
Every waiter opens it in a phone browser on the same Wi-Fi. No accounts, no cloud, no build step.

## What it does
- **Floor plan per area** — multiple floors (Main Room, Garden, Terrace…). In *Arrange* mode (admin) drag tables to match the real room, and tap a table to change its **shape (square/round), size (S/M/L) and seats**.
- **Take orders** from any phone; every device sees the same tables update live. Colour-coded status: free / to send / preparing / served.
- **Build then send** — add drinks and food, then hit **Send order** once. Each item is routed to the printer you assigned it to. Add more later and send again — only the new items fire.
- **Any number of printers, your routing** — define printers in Setup (Kitchen, Bar, Grill…), mark one as the **Bill** printer, and pick which printer each menu item goes to. Every prep printer gets its own live tab where staff **tap items as delivered**; a ticket leaves the screen once fully delivered and stays only in All orders.
- **Roles** — an **Admin** (Manager) can do and see everything; **Waiters** only get the ordering screens. Set roles and PINs in Setup.
- **Split the bill** — several payments of any amount, cash or card/POS, until the balance hits zero.
- **Reports** (admin) — calendar of daily takings, cash vs card, products sold, per-waiter totals.

Default logins: **Manager** (admin), **Maria**, **Nikos** (waiters) — no PINs set.

## Run it
1. Install **Node.js 18+** — https://nodejs.org
2. In this folder, run:
   ```
   node server.js
   ```
3. It prints addresses, for example:
   ```
   On this computer:      http://localhost:3000
   On phones (same Wi-Fi): http://192.168.1.10:3000
   ```
4. Open the shop address on the tablet **and** on each waiter's phone. That's it — they're all connected.

Data is saved to `data.json` in this folder. Delete it (or use *Setup → Reset*) to start fresh.

## Printers
In **Setup → Printers** (admin): add a printer with a name and its IP address, mark one as **Bill** (the customer
receipt), and tap a printer's dot to recolour it. Then, per menu item, choose which printer it prints to. Add a
"Grill" or "Cold station" printer any time — it automatically gets its own tab.

Any ESC/POS thermal printer on the same network (Epson TM, Star TSP, Bixolon, Citizen, most generic ones) on the
standard port 9100 works. The server sends the ticket straight to the printer — nothing to install on the printer side.
Leave IPs blank to just use the on-screen receipt + your browser's print dialog while testing.

## Notes for real use
- **Firewall:** allow Node to accept incoming connections on port 3000 the first time you run it, or phones can't reach it.
- **Fixed address:** give the shop computer a static LAN IP (or a DHCP reservation) so the address doesn't change.
- **Offline:** the app itself runs entirely on your LAN. It currently loads React from a CDN for simplicity, so the
  very first load on each device needs internet once (the browser then caches it). For fully offline operation, those
  three library files can be downloaded into `/public` and referenced locally — ask and I'll wire that up.
- **Backups / owner access from home** is the natural next step: periodically sync `data.json` to the cloud so you can
  see reports remotely and never lose a day's sales.
