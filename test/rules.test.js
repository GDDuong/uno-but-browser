import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck } from '../public/game/cards.js';
import { applyMove, createGame, isPlayable, playableCards, topCard } from '../public/game/rules.js';

let seq = 1000;
const card = (color, face) => ({ id: seq++, color, face });

function game({ hands, top = card('red', '5'), activeColor, current = 0, direction = 1, deck = [], rules = {} }) {
  const players = hands.map((hand, id) => ({ id, name: `P${id + 1}`, hand }));
  return {
    players,
    deck,
    discard: [top],
    current,
    direction,
    activeColor: activeColor ?? top.color,
    pending: null,
    drawStack: 0,
    pick: null,
    rules: { forcedPlay: false, stacking: false, sevenZero: false, ...rules },
    phase: 'playing',
    winner: null,
  };
}

test('deck: 108 cards, 25 per color, 8 wilds', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 108);
  for (const color of ['red', 'yellow', 'green', 'blue']) {
    assert.equal(deck.filter((c) => c.color === color).length, 25);
  }
  assert.equal(deck.filter((c) => c.color === 'wild').length, 8);
  assert.equal(new Set(deck.map((c) => c.id)).size, 108);
});

test('createGame: deals 7 each and opens on a non-wild card', () => {
  for (let i = 0; i < 100; i++) {
    const g = createGame(['A', 'B', 'C']);
    assert.deepEqual(g.players.map((p) => p.hand.length), [7, 7, 7]);
    assert.equal(g.deck.length, 108 - 21 - 1);
    assert.notEqual(topCard(g).color, 'wild');
    assert.equal(g.activeColor, topCard(g).color);
  }
});

test('playable: color match, number match, action match', () => {
  const g = game({
    hands: [[card('red', '7'), card('green', 'skip'), card('blue', '3')], []],
    top: card('red', 'skip'),
  });
  const [red7, greenSkip, blue3] = g.players[0].hand;
  assert.ok(isPlayable(g, red7), 'same color');
  assert.ok(isPlayable(g, greenSkip), 'same action');
  assert.ok(!isPlayable(g, blue3), 'neither color nor action');

  const g2 = game({ hands: [[card('blue', '5'), card('blue', '6')], []], top: card('red', '5') });
  assert.ok(isPlayable(g2, g2.players[0].hand[0]), 'same number');
  assert.ok(!isPlayable(g2, g2.players[0].hand[1]));
});

test('play: rejects cards that do not match', () => {
  const g = game({ hands: [[card('blue', '3')], []], top: card('red', '5') });
  assert.throws(() => applyMove(g, { type: 'play', cardId: g.players[0].hand[0].id }), /does not match/);
});

test('skip: jumps the next seat', () => {
  const g = game({ hands: [[card('red', 'skip'), card('red', '2')], [], []], top: card('red', '5') });
  const after = applyMove(g, { type: 'play', cardId: g.players[0].hand[0].id });
  assert.equal(after.current, 2);
});

test('reverse: flips direction with three players', () => {
  const g = game({ hands: [[card('red', 'reverse'), card('red', '2')], [], []], top: card('red', '5') });
  const after = applyMove(g, { type: 'play', cardId: g.players[0].hand[0].id });
  assert.equal(after.direction, -1);
  assert.equal(after.current, 2);
});

test('reverse: acts as a skip in a two player game', () => {
  const g = game({
    hands: [[card('red', 'reverse'), card('red', '2')], [card('blue', '1')]],
    top: card('red', '5'),
  });
  const after = applyMove(g, { type: 'play', cardId: g.players[0].hand[0].id });
  assert.equal(after.direction, 1);
  assert.equal(after.current, 0);
});

test('draw two: next player takes two and is skipped', () => {
  const g = game({
    hands: [[card('red', 'draw2'), card('red', '2')], [], []],
    top: card('red', '5'),
    deck: [card('green', '9'), card('green', '8')],
  });
  const after = applyMove(g, { type: 'play', cardId: g.players[0].hand[0].id });
  assert.equal(after.players[1].hand.length, 2);
  assert.equal(after.current, 2);
  assert.equal(after.deck.length, 0);
});

test('wild: needs a color and sets the active color', () => {
  const g = game({ hands: [[card('wild', 'wild'), card('red', '2')], []], top: card('red', '5') });
  const wild = g.players[0].hand[0];
  assert.throws(() => applyMove(g, { type: 'play', cardId: wild.id }), /color/);
  const after = applyMove(g, { type: 'play', cardId: wild.id, color: 'green' });
  assert.equal(after.activeColor, 'green');
  assert.equal(after.current, 1);
});

test('wild draw four: illegal while holding the active color', () => {
  const held = game({ hands: [[card('wild', 'draw4'), card('red', '3')], []], top: card('red', '5') });
  assert.ok(!isPlayable(held, held.players[0].hand[0]));

  const free = game({ hands: [[card('wild', 'draw4'), card('blue', '3')], []], top: card('red', '5') });
  assert.ok(isPlayable(free, free.players[0].hand[0]));
});

test('draw: keeps the turn when the drawn card is playable', () => {
  const g = game({ hands: [[card('blue', '3')], [card('blue', '4')]], top: card('red', '5'), deck: [card('red', '9')] });
  const drawn = applyMove(g, { type: 'draw' });
  assert.equal(drawn.current, 0);
  assert.deepEqual(drawn.pending, { cardId: drawn.players[0].hand.at(-1).id });
  assert.equal(playableCards(drawn).length, 1);

  const played = applyMove(drawn, { type: 'play', cardId: drawn.pending.cardId });
  assert.equal(played.current, 1);
  assert.equal(played.pending, null);
});

test('draw: passes the turn when the drawn card does not fit', () => {
  const g = game({ hands: [[card('blue', '3')], [card('blue', '4')]], top: card('red', '5'), deck: [card('green', '9')] });
  const after = applyMove(g, { type: 'draw' });
  assert.equal(after.current, 1);
  assert.equal(after.pending, null);
  assert.equal(after.players[0].hand.length, 2);
});

test('draw: allowed even while holding a playable card', () => {
  const g = game({ hands: [[card('red', '3')], []], top: card('red', '5'), deck: [card('green', '9')] });
  const after = applyMove(g, { type: 'draw' });
  assert.equal(after.players[0].hand.length, 2);
  assert.equal(after.current, 1);
});

test('deck: recycles the discard pile and keeps the top card', () => {
  const g = game({ hands: [[card('blue', '3')], [card('blue', '4')]], top: card('red', '5'), deck: [] });
  g.discard = [card('green', '1'), card('green', '2'), card('red', '5')];

  const after = applyMove(g, { type: 'draw' });
  assert.equal(after.discard.length, 1);
  assert.equal(topCard(after).face, '5');
  assert.equal(after.players[0].hand.length, 2);
  assert.equal(after.deck.length, 1);
});

test('win: emptying your hand ends the game', () => {
  const g = game({ hands: [[card('red', '9')], [card('blue', '4')]], top: card('red', '5') });
  const after = applyMove(g, { type: 'play', cardId: g.players[0].hand[0].id });
  assert.equal(after.phase, 'over');
  assert.equal(after.winner, 0);
  assert.throws(() => applyMove(after, { type: 'draw' }), /over/);
});

test('applyMove: leaves the input state untouched', () => {
  const g = game({ hands: [[card('red', '7'), card('red', '8')], [card('blue', '1')]], top: card('red', '5') });
  const before = structuredClone(g);
  applyMove(g, { type: 'play', cardId: g.players[0].hand[0].id });
  assert.deepEqual(g, before);
});

test('forced play: the drawn match must be played, not passed', () => {
  const g = game({
    hands: [[card('blue', '3')], [card('blue', '4')]],
    top: card('red', '5'),
    deck: [card('red', '9')],
    rules: { forcedPlay: true },
  });
  const drawn = applyMove(g, { type: 'draw' });
  assert.throws(() => applyMove(drawn, { type: 'pass' }), /Forced play/);
  assert.equal(applyMove(drawn, { type: 'play', cardId: drawn.pending.cardId }).current, 1);
});

test('stacking: draw cards pile up and the taker loses the turn', () => {
  const g = game({
    hands: [
      [card('red', 'draw2'), card('red', '1')],
      [card('green', 'draw2'), card('green', '1')],
      [card('blue', '1')],
    ],
    top: card('red', '5'),
    deck: [card('yellow', '1'), card('yellow', '2'), card('yellow', '3'), card('yellow', '4')],
    rules: { stacking: true },
  });

  const first = applyMove(g, { type: 'play', cardId: g.players[0].hand[0].id });
  assert.equal(first.drawStack, 2);
  assert.equal(first.current, 1, 'the next player gets to answer');
  assert.equal(first.players[2].hand.length, 1, 'nobody drew yet');

  const second = applyMove(first, { type: 'play', cardId: first.players[1].hand[0].id });
  assert.equal(second.drawStack, 4);
  assert.equal(second.current, 2);

  const taken = applyMove(second, { type: 'draw' });
  assert.equal(taken.players[2].hand.length, 5);
  assert.equal(taken.drawStack, 0);
  assert.equal(taken.current, 0);
});

test('stacking: only draw cards answer a stack', () => {
  const g = game({
    hands: [[card('red', 'draw2'), card('red', '1')], [card('red', '9')]],
    top: card('red', '5'),
    rules: { stacking: true },
  });
  const after = applyMove(g, { type: 'play', cardId: g.players[0].hand[0].id });
  assert.equal(isPlayable(after, after.players[1].hand[0]), false);
});

test('zero: rotating hands sends every hand forward in play order', () => {
  const g = game({
    hands: [
      [card('red', '0'), card('red', '1')],
      [card('blue', '2'), card('blue', '3')],
      [card('green', '4')],
    ],
    top: card('red', '5'),
    rules: { sevenZero: true },
  });

  const after = applyMove(g, { type: 'play', cardId: g.players[0].hand[0].id });
  assert.deepEqual(after.players[0].hand.map((c) => c.face), ['4']);
  assert.deepEqual(after.players[1].hand.map((c) => c.face), ['1']);
  assert.deepEqual(after.players[2].hand.map((c) => c.face), ['2', '3']);
  assert.equal(after.current, 1);
});

test('seven: picks a hand to swap with', () => {
  const g = game({
    hands: [
      [card('red', '7'), card('red', '1')],
      [card('blue', '2'), card('blue', '3')],
      [card('green', '4')],
    ],
    top: card('red', '5'),
    rules: { sevenZero: true },
  });

  const picked = applyMove(g, { type: 'play', cardId: g.players[0].hand[0].id });
  assert.ok(picked.pick);
  assert.throws(() => applyMove(picked, { type: 'draw' }), /swap/);
  assert.equal(playableCards(picked).length, 0);

  const after = applyMove(picked, { type: 'swap', seat: 2 });
  assert.deepEqual(after.players[0].hand.map((c) => c.face), ['4']);
  assert.deepEqual(after.players[2].hand.map((c) => c.face), ['1']);
  assert.equal(after.pick, null);
  assert.equal(after.current, 1);
  assert.throws(() => applyMove(after, { type: 'swap', seat: 1 }), /Nothing to swap/);
});

test('seven: a two player table swaps straight away', () => {
  const g = game({
    hands: [[card('red', '7'), card('red', '1')], [card('blue', '2')]],
    top: card('red', '5'),
    rules: { sevenZero: true },
  });

  const after = applyMove(g, { type: 'play', cardId: g.players[0].hand[0].id });
  assert.equal(after.pick, null);
  assert.deepEqual(after.players[0].hand.map((c) => c.face), ['2']);
  assert.deepEqual(after.players[1].hand.map((c) => c.face), ['1']);
  assert.equal(after.current, 1);
});
