import assert from 'node:assert/strict';
import test from 'node:test';
import { Room } from '../room.js';

function started(bots = 0) {
  const room = new Room('ABCD');
  const a = room.join('Ana');
  const b = room.join('Bo');
  room.start(a, bots);
  return { room, a, b };
}

test('start: seats joins in order and deals seven each', () => {
  const { room, a, b } = started();
  assert.equal(a.seat, 0);
  assert.equal(b.seat, 1);
  assert.equal(room.game.players.length, 2);
  assert.ok(room.game.players.every((p) => p.hand.length === 7));
});

test('start: only the creator can start', () => {
  const { room, b } = started();
  assert.throws(() => room.start(b, 0), /creator/);
});

test('start: a lone player needs company', () => {
  const room = new Room('ABCD');
  const solo = room.join('Solo');
  assert.throws(() => room.start(solo, 0), /two players/);
});

test('snapshot: hides every other hand and the draw pile', () => {
  const { room, a, b } = started();
  const view = room.snapshot(b);

  assert.equal(view.game.deck.length, 0);
  assert.ok(view.game.deckCount > 0);
  assert.deepEqual(view.game.players[0].hand, []);
  assert.equal(view.game.players[0].handCount, 7);
  assert.equal(view.game.players[1].hand.length, 7);
  assert.equal(view.you, 1);
});

test('snapshot: late joiners spectate with no hand at all', () => {
  const { room } = started();
  const watcher = room.join('Cass');
  assert.equal(watcher.seat, null);

  const view = room.snapshot(watcher);
  assert.equal(view.you, null);
  assert.ok(view.game.players.every((p) => p.hand.length === 0));
});

test('join: extra people spectate once the six seats are taken', () => {
  const room = new Room('ABCD');
  const members = Array.from({ length: 7 }, (_, i) => room.join(`P${i}`));

  assert.equal(members[5].seat, 5);
  assert.equal(members[6].seat, null);
  assert.deepEqual(
    room.snapshot(members[0]).seats.map((s) => s.host),
    [true, false, false, false, false, false, false],
  );
});

test('act: refuses a move out of turn', () => {
  const { room, b } = started();
  assert.throws(() => room.act(b, { type: 'draw' }), /Not your turn/);
});

test('act: plays from the hand, logs it, and passes the turn', () => {
  const { room, a } = started();
  const g = room.game;
  g.players[0].hand = [
    { id: 500, color: g.activeColor, face: '5' },
    { id: 501, color: 'wild', face: 'wild' },
  ];

  room.act(a, { type: 'play', cardId: 500 });
  assert.equal(room.game.current, 1);
  assert.equal(room.game.players[0].hand.length, 1);
  assert.match(room.log[0], /Ana played/);
});

test('botAct: makes a legal move when it is the bots seat', () => {
  const { room } = started(1);
  const bot = room.members.find((m) => m.bot);
  room.game.current = bot.seat;

  room.botAct(bot);
  assert.notEqual(room.game.current, bot.seat);
  assert.match(room.log[0], /Bot 1/);
  assert.notEqual(room.game.players[bot.seat].hand.length, 7);
});

test('say: chat is capped and visible to everyone', () => {
  const { room, a, b } = started();
  room.say(a, '   hi   there  ');
  room.say(b, 'x'.repeat(400));

  const chat = room.snapshot(a).chat;
  assert.equal(chat[0].text, 'hi there');
  assert.equal(chat[1].text.length, 200);
  assert.equal(room.snapshot(b).chat.length, 2);
});

test('rules: the creator sets them before the deal and everyone sees them', () => {
  const room = new Room('ABCD');
  const a = room.join('Ana');
  const b = room.join('Bo');

  room.setRules(a, { stacking: true, sevenZero: 'yes', junk: true });
  assert.deepEqual(room.snapshot(b).rules, { forcedPlay: false, stacking: true, sevenZero: true });
  assert.throws(() => room.setRules(b, { stacking: false }), /creator/);

  room.start(a, 0);
  assert.equal(room.game.rules.stacking, true);
  assert.throws(() => room.setRules(a, { stacking: false }), /locked/);
});

test('botAct: answers a seven by swapping with the shortest hand', () => {
  const { room } = started(1);
  const bot = room.members.find((m) => m.bot);
  room.game.current = bot.seat;
  room.game.pick = { type: 'swap' };
  room.game.players[0].hand = room.game.players[0].hand.slice(0, 4);

  room.botAct(bot);
  assert.equal(room.game.pick, null);
  assert.equal(room.game.players[0].hand.length, 7);
  assert.equal(room.game.players[bot.seat].hand.length, 4);
  assert.match(room.log[0], /swapped hands/);
});
