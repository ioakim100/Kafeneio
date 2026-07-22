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

Default logins (change the PINs in Setup): **Manager** admin — PIN **1234**; **Maria** — **1111**; **Nikos** — **2222**. Everyone needs a PIN, so a customer opening the address can't get in.

Handy behaviours: pressing **Send order** fires silently and drops you back on the tables for the next one; a prep printer marked **All** gets a one-ticket copy of the whole order while items still go to their own stations; on a prep screen you can tap an item to mark it delivered and **undo** it from "Recently delivered"; and at payment you can switch to **Pick items** to charge one guest for just their items.

**Item choices (modifiers):** give any product questions like *Sugar: Sketos/Metrios/Glykos* or *Milk: yes/no* under **Setup → Menu → the sliders icon**. When a waiter taps that product it asks the questions, and the answers show on the order, the kitchen/bar ticket and the receipt. (The demo coffees already have sugar/milk choices.)

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
receipt), and set what each screen **Shows** — *Own items*, *All except food* (the Bar catch-all: every drink/other
item, skipping any station marked **Food**), or *Everything* (an expo copy). Then, per menu item, choose which printer
it prints to. Each non-Bill printer automatically gets its own tab.

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
