# UNO but Browser

A no-install UNO table for the browser: 4-letter rooms, bots, chat, house rules. Zero dependencies. Because Ubisoft sucks.

## Features

- **Rooms** — create one, share the 4-letter code or link, 2–6 seats
- **Bots** — fill empty seats, from the header
- **Server-authoritative** — hands are redacted per player, so nobody can peek or cheat
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
