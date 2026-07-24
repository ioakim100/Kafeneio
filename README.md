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
> **First unzip the folder!** Don't run anything from inside the `.zip`. On Windows: right-click `kafeneio-pos.zip`
> → **Extract All…**. On Mac: double-click the zip. Then open the launcher from the **extracted folder**.

**Easiest — just double-click (no typing):**
- **Windows:** double-click **`PDA.bat`**
- **Mac:** double-click **`PDA (Mac).command`** (first time: right-click → Open, to get past the security prompt)
- **Linux:** run **`PDA (Linux).sh`**

A small window opens (leave it open while the shop is running) and your **browser opens the app automatically**. To
stop, close that window. You still need **Node.js** installed once — the launcher will tell you and link to
https://nodejs.org if it's missing.

**Windows makes the pretty icon for you:** the first time you run `PDA.bat`, it automatically drops a **“PDA” icon
(coffee cup) on your Desktop**. From then on, the shop just double-clicks that Desktop icon — no folders, no typing.

**On the tablet/phone:** open the address in the browser, then use *Add to Home screen* — it installs with the same
coffee-cup icon and opens full-screen like a real app.

The launcher works from **any location** — it always uses its own folder, so move the extracted `kafeneio-pos` folder
wherever you like (Desktop, `C:\KafeneioPOS`, a USB stick…) and it still runs.

**Or from a terminal:**
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

(To stop the browser from opening automatically, start with `NO_OPEN=1`.)

Data is saved to `data.json` in this folder. Delete it (or use *Setup → Reset*) to start fresh.

## Backups (so a dead computer never loses your data)
Everything lives in one file (`data.json`) and the app keeps working **with no internet** — the backups just ride
along. In **Setup → Backup & restore** (admin):
- **Automatic backups** run while the app is open (default every 10 min) and on shutdown. Snapshots are
  **compressed (.gz)** and **self-cleaning** — all from the last 24h, then one per day for two weeks, then one per
  month, deleting anything past the “keep history” window (default 12 months). The folder never grows out of control.
- **Cloud / off-machine folder:** paste the path of a **Dropbox / Google Drive / OneDrive** folder (or a USB / network
  drive). The app writes a snapshot there too; your cloud app uploads it when there's internet, and if there isn't, it
  waits and syncs later. This is what protects you if the computer dies.
- **Back up now** forces one immediately. **Restore…** lists every snapshot (cloud folder + local) — pick one to load.
- **Dead computer?** Install the app on a new one, set the **same** cloud folder, open **Restore…**, pick the latest —
  you're exactly where you left off. (If you copy the whole app folder including `backups/`, it even auto-restores on
  first start.)

## Where to run it (PC, mini-PC, Raspberry Pi… or an Android tablet)
There are two roles: **one device runs the server** (`node server.js`) and holds the shared data; **all the other
devices are just browsers** pointing at it. They must be on the **same Wi-Fi/network**.

- **Clients — any browser.** Android tablets, iPads, phones and PCs all work as terminals: open `http://<server-ip>:3000`.
  Nothing to install on them. Add it to the home screen for an app-like feel.
- **Server — easiest on a computer.** Windows, macOS or Linux with Node.js. For an always-on shop setup, a cheap
  mini-PC or a **Raspberry Pi** left running is ideal (low power, silent). Whatever runs the server should stay on
  while you're open, and ideally have a fixed local IP.
- **Server on an Android tablet (advanced, no PC needed).** Install the **Termux** app, then inside it run
  `pkg install nodejs`, copy this folder over, and `node server.js`. That same tablet can also be a client (open
  `http://localhost:3000`). It works, but a tablet is fussier than a small always-on PC/Pi, so use this only if you
  don't want a separate machine.

Recommended shop setup: one always-on **mini-PC or Raspberry Pi** as the server, and **Android tablets + phones** as
the terminals.

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
