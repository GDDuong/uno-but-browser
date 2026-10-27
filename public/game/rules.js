import { COLORS, buildDeck, shuffle } from './cards.js';

const HAND_SIZE = 7;
const DEFAULT_RULES = { forcedPlay: false, stacking: false, sevenZero: false };

export function createGame(names, { rules } = {}) {
  const deck = shuffle(buildDeck());
  const players = names.map((name, id) => ({ id, name, hand: deck.splice(0, HAND_SIZE) }));

  let first = deck.pop();
  while (first.color === 'wild') {
    deck.unshift(first);
    first = deck.pop();
  }

  return {
    players,
    deck,
    discard: [first],
    current: 0,
    direction: 1,
    activeColor: first.color,
    pending: null,
    drawStack: 0,
    pick: null,
    rules: { ...DEFAULT_RULES, ...rules },
    phase: 'playing',
    winner: null,
    // ponytail: an action card on the opening flip does not fire; add if players notice
  };
}

export const topCard = (state) => state.discard[state.discard.length - 1];

export function viewFor(state, viewerSeat, spectatorHands) {
  // Card ids carry no face info on the wire, so pending.cardId is safe to broadcast with the hands hidden.
  const seeAll = viewerSeat === null && spectatorHands;
  return {
    ...state,
    deck: [],
    deckCount: state.deck.length,
    players: state.players.map((p) =>
      p.id === viewerSeat || seeAll ? { ...p } : { id: p.id, name: p.name, hand: [], handCount: p.hand.length },
    ),
  };
}

const hasActiveColor = (state) => state.players[state.current].hand.some((c) => c.color === state.activeColor);

export function isPlayable(state, card) {
  if (state.phase !== 'playing' || state.pick) return false;
  if (state.pending) return state.pending.cardId === card.id;

  const draw = card.face === 'draw2' || card.face === 'draw4';
  if (state.drawStack > 0) return draw && (card.face === 'draw2' || !hasActiveColor(state));
  if (card.color === 'wild') return card.face !== 'draw4' || !hasActiveColor(state);
  return card.color === state.activeColor || card.face === topCard(state).face;
}

export function playableCards(state) {
  return state.players[state.current].hand.filter((card) => isPlayable(state, card));
}

export function applyMove(state, move) {
  if (state.phase !== 'playing') throw new Error('Game is over');
  const next = structuredClone(state);

  if (move.type === 'play') return play(next, move);
  if (move.type === 'draw') return draw(next);
  if (move.type === 'pass') return pass(next);
  if (move.type === 'swap') return swap(next, move);
  throw new Error(`Unknown move: ${move.type}`);
}

function play(state, move) {
  const player = state.players[state.current];
  const index = player.hand.findIndex((c) => c.id === move.cardId);
  if (index === -1) throw new Error('Card is not in your hand');

  const card = player.hand[index];
  if (!isPlayable(state, card)) throw new Error('That card does not match');
  if (card.color === 'wild' && !COLORS.includes(move.color)) throw new Error('Wild needs a color');

  player.hand.splice(index, 1);
  state.discard.push(card);
  state.activeColor = card.color === 'wild' ? move.color : card.color;
  state.pending = null;

  if (player.hand.length === 0) {
    state.phase = 'over';
    state.winner = player.id;
    return state;
  }

  playEffects(state, card);
  return state;
}

function draw(state) {
  if (state.pick) throw new Error('Pick who to swap with first');
  if (state.pending) throw new Error('You already drew this turn');

  if (state.drawStack > 0) {
    drawInto(state, state.current, state.drawStack);
    state.drawStack = 0;
    state.current = nextIndex(state, 1);
    return state;
  }

  const player = state.players[state.current];
  const card = takeCard(state);
  player.hand.push(card);
  state.pending = isPlayable(state, card) ? { cardId: card.id } : null;
  if (!state.pending) state.current = nextIndex(state, 1);
  return state;
}

function pass(state) {
  if (!state.pending) throw new Error('Nothing to pass');
  if (state.rules.forcedPlay) throw new Error('Forced play: you must play the card you drew');
  state.pending = null;
  state.current = nextIndex(state, 1);
  return state;
}

function swap(state, move) {
  if (!state.pick) throw new Error('Nothing to swap');
  const seat = Number(move.seat);
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.players.length || seat === state.current) {
    throw new Error('Pick another player');
  }

  exchangeHands(state, seat);
  state.pick = null;
  state.current = nextIndex(state, 1);
  return state;
}

function playEffects(state, card) {
  let skip = 0;

  if (state.rules.sevenZero && card.face === '0') rotateHands(state);
  if (state.rules.sevenZero && card.face === '7') {
    const others = state.players.filter((p) => p.id !== state.current);
    if (others.length === 1) {
      exchangeHands(state, others[0].id);
      state.current = nextIndex(state, 1);
    } else {
      state.pick = { type: 'swap' };
    }
    return;
  }

  if (card.face === 'reverse') {
    if (state.players.length === 2) skip = 1;
    else state.direction *= -1;
  } else if (card.face === 'skip') {
    skip = 1;
  } else if (card.face === 'draw2' || card.face === 'draw4') {
    if (state.rules.stacking) {
      state.drawStack += card.face === 'draw2' ? 2 : 4;
    } else {
      drawInto(state, nextIndex(state, 1), card.face === 'draw2' ? 2 : 4);
      skip = 1;
    }
  }

  state.current = nextIndex(state, 1 + skip);
}

function exchangeHands(state, seat) {
  const me = state.current;
  [state.players[me].hand, state.players[seat].hand] = [state.players[seat].hand, state.players[me].hand];
}

function rotateHands(state) {
  const n = state.players.length;
  const hands = state.players.map((p) => p.hand);
  state.players.forEach((p, i) => {
    p.hand = hands[(i - state.direction + n) % n];
  });
}

function nextIndex(state, steps) {
  const n = state.players.length;
  return (((state.current + state.direction * steps) % n) + n) % n;
}

function drawInto(state, index, count) {
  for (let i = 0; i < count; i++) state.players[index].hand.push(takeCard(state));
}

function takeCard(state) {
  if (!state.deck.length) {
    const top = state.discard.pop();
    state.deck = shuffle(state.discard);
    state.discard = [top];
  }
  return state.deck.pop();
}
