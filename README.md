# UNO but Browser

A no-install UNO table for the browser: 4-letter rooms, bots, chat, house rules. Zero dependencies. Because Ubisoft sucks.

## Features

- **Rooms** — create one, share the 4-letter code or link, 2–10 seats
- **Bots** — optional, add 0–9 from the header
- **Spectators** — join with the room code as a watcher or toggle **Spectate / Sit in** in the room; they get their own list, and see every hand by default until the host hides it from the Table settings
- **Host tools** — kick players, disband the room; anyone can leave
- **Server-authoritative** — hands are redacted per player; spectators only see every hand while the host allows it
- **Chat** — table talk in a collapsible drawer
- **House rules** — forced play, stacking (+2/+4), 0–7 (rotate hands / swap hands)
- **Keyboard & mobile friendly** — focus rings, 44px touch targets, reduced-motion support

## Run it

Requires Node.js 20+.

```bash
npm start
```

Open http://localhost:3000. The server prints your LAN address on startup — give that URL to friends on the same Wi-Fi (and open it yourself as the host so **Copy link** shares the right address).

Set `PORT` to change the port:

```bash
PORT=8080 npm start
```

## Deploy on Render

1. Create a **Web Service** from this repo.
2. Build command: `npm install` (no dependencies, but that is Render's default). Start command: `npm start`.
3. Render supplies `PORT` and HTTPS automatically; SSE streams through its proxy.

Rooms live in memory, so a deploy, restart, or free-tier spin-down clears them.

## Test

```bash
npm test
```

Node's built-in test runner, no install step.

## Layout

| Path | What |
| --- | --- |
| `server.js` | HTTP server, static files, JSON API, SSE stream |
| `room.js` | Rooms, seats, bots, chat, timers |
| `public/game/cards.js` | Deck, card labels |
| `public/game/rules.js` | Pure rules engine (`createGame`, `applyMove`, `viewFor`) |
| `public/index.html` | Start screen, table, dialogs |
| `public/style.css` | Playful candy-felt design |
| `public/app.js` | View over server state |

## Notes

Rooms live in memory; restarting the server clears them. No accounts, no database, no build step.

Planned: voice chat, Show 'em No Mercy, UNO Flip.
