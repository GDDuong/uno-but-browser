import { cardLabel } from './game/cards.js';
import { isPlayable, playableCards, topCard } from './game/rules.js';

const $ = (id) => document.getElementById(id);
const handEl = $('hand');
const pileEl = $('pile');
const drawBtn = $('draw');
const deckBtn = $('deck');

const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 };
const FACE_ORDER = { skip: 10, reverse: 11, draw2: 12, wild: 13, draw4: 14 };
const CORNER = { skip: 'S', reverse: 'R', draw2: '+2', wild: 'W', draw4: '+4' };
const RULE_KEYS = { ruleForced: 'forcedPlay', ruleStack: 'stacking', ruleSevenZero: 'sevenZero' };

const app = { snap: null, stream: null, error: '', pickCard: null, round: 0, lastTop: null, winKey: null };

const stored = () => JSON.parse(sessionStorage.getItem('uno') ?? 'null');
const esc = (text) => String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

async function send(path, data) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: stored()?.token, ...data }),
  });
  const body = await res.json().catch(() => ({}));

  app.error = res.ok ? '' : body.error || 'The table did not take that';
  if (!res.ok) render();
  return body;
}

async function join(name, code) {
  const res = await fetch('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, room: code || undefined }),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    $('lobbyError').textContent = body.error || 'Could not reach the table';
    return;
  }

  sessionStorage.setItem('uno', JSON.stringify(body));
  $('lobbyError').textContent = '';
  $('lobby').close();
  connect(body);
}

async function copy(text, target) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.readOnly = true;
    field.style.cssText = 'position:fixed;opacity:0';
    document.body.append(field);
    field.select();
    const done = document.execCommand('copy');
    field.remove();
    if (!done) return;
  }
  target.dataset.copied = '';
  setTimeout(() => delete target.dataset.copied, 1200);
}

function connect({ room, token }) {
  history.replaceState(null, '', `/?room=${room}`);
  app.stream?.close();
  app.stream = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
  app.stream.addEventListener('state', (event) => {
    app.snap = JSON.parse(event.data);
    app.error = '';
    render();
  });
  app.stream.addEventListener('error', () => {
    if (!app.snap) {
      app.stream.close();
      sessionStorage.removeItem('uno');
      $('lobbyError').textContent = 'That room closed. Start a fresh one or join another.';
      if (!$('lobby').open) $('lobby').showModal();
      return;
    }
    app.error = 'Lost the table. Reload to rejoin.';
    render();
  });
}

function render() {
  const snap = app.snap;
  if (!snap) return;

  const activeId = document.activeElement?.dataset?.id;
  const hadHandFocus = handEl.contains(document.activeElement);

  $('roomCode').textContent = snap.room;
  $('roomPill').hidden = false;
  const preRound = !snap.game || snap.game.phase === 'over';
  $('start').hidden = !snap.canStart || !preRound;
  $('botsField').hidden = $('start').hidden;
  document.body.dataset.color = snap.game?.activeColor ?? 'red';

  if (snap.game && snap.round !== app.round) {
    app.round = snap.round;
    handEl.classList.add('is-deal');
    setTimeout(() => handEl.classList.remove('is-deal'), 900);
  }

  renderSeats(snap);
  renderWait(snap);
  renderCenter(snap.game);
  renderHand(snap);
  renderTurn(snap);
  renderSwap(snap);
  renderChat(snap);
  renderWin(snap);

  if (hadHandFocus) {
    const same = activeId && handEl.querySelector(`.card--hand[data-id="${activeId}"]:not(:disabled)`);
    const target = same || handEl.querySelector('.card--hand:not(:disabled)') || (drawBtn.disabled ? handEl : drawBtn);
    target.focus();
  }
}

function renderSeats(snap) {
  const g = snap.game;
  const rows = g
    ? g.players.map((p) => ({
        name: p.name,
        count: p.handCount ?? p.hand.length,
        active: g.phase === 'playing' && p.id === g.current,
        winner: p.id === g.winner,
        you: p.id === snap.you,
      }))
    : snap.seats.map((m) => ({
        name: m.seat === null ? `${m.name} (watching)` : m.name,
        count: m.seat === null ? '' : '\u00b7',
        host: m.host,
        active: false,
        winner: false,
        you: m.seat === snap.you,
      }));

  $('seats').innerHTML = rows
    .map(
      (row) => `<li class="seat${row.active ? ' is-active' : ''}${row.winner ? ' is-winner' : ''}${row.you ? ' is-you' : ''}">
        <span class="seat__avatar" aria-hidden="true">${initials(row.name)}</span>
        <span class="seat__name">${esc(row.name)}</span>
        ${row.host ? '<span class="seat__host">host</span>' : ''}
        <span class="seat__count" aria-label="${row.count} cards">${row.count}</span>
      </li>`,
    )
    .join('');
}

function renderWait(snap) {
  const waiting = !snap.game;
  $('wait').hidden = !waiting;
  $('roundRow').hidden = waiting;
  $('meta').hidden = waiting;
  handEl.parentElement.hidden = waiting;
  if (!waiting) return;

  $('waitCode').textContent = snap.room;
  $('waitSub').textContent = `${snap.seats.length} of ${snap.maxSeats} seats`;
  $('rules').disabled = !snap.canStart;
  for (const [inputId, key] of Object.entries(RULE_KEYS)) $(inputId).checked = Boolean(snap.rules[key]);
  $('waitNote').textContent = snap.canStart
    ? 'Bots sit down from the header. Start deals once two players are in.'
    : 'Only the host can change the house rules.';
}

function renderSwap(snap) {
  const g = snap.game;
  const mine = !!g && g.phase === 'playing' && g.pick && g.current === snap.you;
  const dialog = $('swap');
  if (!mine) {
    if (dialog.open) dialog.close();
    return;
  }

  $('swapList').innerHTML = g.players
    .filter((p) => p.id !== snap.you)
    .map(
      (p) => `<button class="btn btn--ghost" type="button" data-seat="${p.id}">${esc(p.name)} <small>${p.handCount ?? p.hand.length} cards</small></button>`,
    )
    .join('');
  if (!dialog.open) dialog.showModal();
}

function renderCenter(g) {
  if (!g) {
    pileEl.innerHTML = '';
    $('chip').className = 'chip';
    $('chip').textContent = 'lobby';
    $('dir').textContent = '';
    $('stack').hidden = true;
    return;
  }

  const top = topCard(g);
  pileEl.innerHTML = cardHTML(top, app.lastTop !== top.id ? 'is-new' : '');
  app.lastTop = top.id;
  pileEl.style.setProperty('--glow', `var(--${g.activeColor})`);

  const chip = $('chip');
  chip.className = `chip chip--${g.activeColor}`;
  chip.textContent = g.activeColor;
  $('dir').textContent = g.direction === 1 ? '\u21BB' : '\u21BA';

  const stack = $('stack');
  stack.hidden = !g.drawStack;
  stack.textContent = g.drawStack ? `+${g.drawStack} stacked` : '';
}

function renderHand(snap) {
  const g = snap.game;
  const me = g && snap.you !== null ? g.players[snap.you] : null;
  const hand = me ? [...me.hand].sort(byCardOrder) : [];
  const mid = (hand.length - 1) / 2;
  const yourTurn = !!g && g.phase === 'playing' && g.current === snap.you;

  handEl.style.setProperty('--ov', hand.length > 10 ? -0.42 : hand.length > 8 ? -0.28 : hand.length > 6 ? -0.16 : -0.1);
  handEl.innerHTML = hand
    .map((card, i) => {
      const playable = yourTurn && isPlayable(g, card);
      const cls = !yourTurn ? ' is-wait' : playable ? '' : ' is-off';
      const label = yourTurn && !playable ? `${cardLabel(card)}, cannot be played` : cardLabel(card);
      const style = `--rot:${(i - mid) * 2.4}deg;--lift:${Math.abs(i - mid) * 2.2}px;--i:${i}`;
      return `<button class="card card--${card.color} card--hand${cls}" data-id="${card.id}" style="${style}" aria-label="${label}"${playable ? '' : ' disabled'}>${cardInner(card)}</button>`;
    })
    .join('');
}

function renderTurn(snap) {
  const g = snap.game;
  const yourTurn = !!g && g.phase === 'playing' && g.current === snap.you;
  const plays = yourTurn ? playableCards(g) : [];
  const canDraw = yourTurn && !g.pending && !g.pick;

  let line;
  let hint;

  if (app.error) {
    line = app.error;
  } else if (!g) {
    line = `Room ${snap.room} \u2014 ${snap.canStart ? 'add bots and press Start.' : 'waiting for the creator to start.'}`;
  } else if (g.phase === 'over') {
    line = snap.log[0] ?? 'Round over.';
  } else {
    const whoseTurn = g.current === snap.you ? 'Your turn.' : `${g.players[g.current].name}'s turn.`;
    line = `${whoseTurn} ${snap.log[0] ?? ''}`.trim();
  }

  if (!g) hint = snap.you === null ? 'Spectating.' : 'Press Start when everyone is seated.';
  else if (g.phase === 'over') hint = 'Start a new round when you are ready.';
  else if (snap.you === null) hint = 'Spectating.';
  else if (!yourTurn) hint = 'Waiting on the table\u2026';
  else if (g.pick) hint = 'Pick who to swap hands with.';
  else if (g.pending) hint = 'Play the card you drew, or pass.';
  else if (g.drawStack > 0) hint = `Answer with a draw card, or take ${g.drawStack}.`;
  else if (plays.length) hint = 'Tap a card to play it.';
  else hint = 'No match yet. Draw a card.';

  $('status').textContent = line;
  $('hint').textContent = hint;
  drawBtn.disabled = !canDraw;
  deckBtn.disabled = !canDraw;
  $('pass').hidden = Boolean(g?.rules?.forcedPlay);
  $('pass').disabled = !(yourTurn && g.pending);
}

function renderChat(snap) {
  const list = $('chatList');
  list.innerHTML = snap.chat
    .map((m) => `<li class="chat__msg"><span class="chat__who">${esc(m.from)}</span><span class="chat__text">${esc(m.text)}</span></li>`)
    .join('');
  list.scrollTop = list.scrollHeight;
}

function renderWin(snap) {
  const g = snap.game;
  const key = g && g.phase === 'over' ? `${snap.round}:${g.winner}` : null;
  if (!key || app.winKey === key) return;

  app.winKey = key;
  const dialog = $('over');
  $('overText').textContent = g.players[g.winner].id === snap.you ? 'You win' : `${g.players[g.winner].name} wins`;
  dialog.returnValue = '';
  dialog.showModal();
}

function playCard(cardId) {
  const card = app.snap.game.players[app.snap.you].hand.find((c) => c.id === cardId);
  if (!card) return;

  if (card.color === 'wild') {
    app.pickCard = cardId;
    const dialog = $('pick');
    dialog.returnValue = '';
    dialog.showModal();
    return;
  }
  send('/api/move', { move: { type: 'play', cardId } });
}

function beginRound() {
  app.winKey = null;
  send('/api/start', { bots: Number($('bots').value) });
}

handEl.addEventListener('click', (event) => {
  const button = event.target.closest('button.card--hand');
  if (!button || button.disabled) return;
  playCard(Number(button.dataset.id));
});

$('pick').addEventListener('click', (event) => {
  const swatch = event.target.closest('.swatch');
  if (!swatch) return;

  const cardId = app.pickCard;
  app.pickCard = null;
  $('pick').close();
  if (cardId !== null) send('/api/move', { move: { type: 'play', cardId, color: swatch.dataset.color } });
});

$('draw').addEventListener('click', () => send('/api/move', { move: { type: 'draw' } }));
$('deck').addEventListener('click', () => send('/api/move', { move: { type: 'draw' } }));
$('pass').addEventListener('click', () => send('/api/move', { move: { type: 'pass' } }));
$('start').addEventListener('click', beginRound);
$('again').addEventListener('click', () => {
  $('over').close();
  beginRound();
});

$('roomPill').addEventListener('click', () => copy(app.snap.room, $('roomPill')));
$('copyCode').addEventListener('click', () => copy(app.snap.room, $('copyCode')));
$('copyLink').addEventListener('click', () =>
  copy(`${location.origin}/?room=${app.snap.room}`, $('copyLink')),
);

$('rules').addEventListener('change', () => {
  const rules = {};
  for (const [id, key] of Object.entries(RULE_KEYS)) rules[key] = $(id).checked;
  send('/api/rules', { rules });
});

$('swap').addEventListener('cancel', (event) => event.preventDefault());
$('swap').addEventListener('click', (event) => {
  const choice = event.target.closest('[data-seat]');
  if (!choice) return;
  $('swap').close();
  send('/api/move', { move: { type: 'swap', seat: Number(choice.dataset.seat) } });
});

$('lobby').addEventListener('cancel', (event) => event.preventDefault());

$('lobbyForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('name').value;

  if (event.submitter?.value === 'join') {
    const code = $('code').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) {
      $('lobbyError').textContent = 'Room codes are four letters.';
      $('code').focus();
      return;
    }
    join(name, code);
    return;
  }

  join(name, '');
});

$('chatForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const field = $('chatText');
  send('/api/chat', { text: field.value });
  field.value = '';
});

function initials(name) {
  return name
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2);
}

const faceRank = (face) => (face.length === 1 ? Number(face) : FACE_ORDER[face]);

const byCardOrder = (a, b) =>
  COLOR_ORDER[a.color] - COLOR_ORDER[b.color] || faceRank(a.face) - faceRank(b.face) || a.id - b.id;

function cardInner(card) {
  const corner = CORNER[card.face] ?? card.face;
  return `<span class="card__corner">${corner}</span><span class="card__glyph">${glyph(card)}</span><span class="card__corner card__corner--br">${corner}</span>`;
}

function glyph(card) {
  if (card.face === 'skip') {
    return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6"/><path d="M6.5 17.5 17.5 6.5"/></svg>';
  }
  if (card.face === 'reverse') {
    return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h12l-3.2-3.2M19 15H7l3.2 3.2"/></svg>';
  }
  if (card.face === 'wild') return '<span class="pin"></span>';
  if (card.face === 'draw4') return '<span class="plus">+4</span><span class="rainbow"></span>';
  if (card.face === 'draw2') return '<span class="plus">+2</span>';
  return `<span class="num">${card.face}</span>`;
}

function cardHTML(card, cls = '') {
  return `<div class="card card--${card.color}${cls ? ` ${cls}` : ''}" role="img" aria-label="Discard pile: ${cardLabel(card)}">${cardInner(card)}</div>`;
}

const params = new URLSearchParams(location.search);
const saved = stored();

if (saved?.token && (!params.get('room') || params.get('room') === saved.room)) {
  connect(saved);
} else {
  $('code').value = params.get('room') ?? '';
  $('lobby').showModal();
}
