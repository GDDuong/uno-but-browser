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

test('snapshot: spectators see every hand by default, the deck stays hidden', () => {
  const { room } = started();
  const watcher = room.join('Cass');
  assert.equal(watcher.seat, null);

  const view = room.snapshot(watcher);
  assert.equal(view.you, null);
  assert.ok(view.game.players.every((p) => p.hand.length === 7));
  assert.equal(view.game.deck.length, 0);
});

test('settings: only the host hides spectator hands, and the view follows', () => {
  const { room, a, b } = started();
  const watcher = room.join('Cass');
  assert.equal(room.snapshot(watcher).settings.spectatorHands, true);

  assert.throws(() => room.setSettings(b, { spectatorHands: false }), /host/);
  room.setSettings(a, { spectatorHands: false });

  const hidden = room.snapshot(watcher).game.players;
  assert.ok(hidden.every((p) => p.hand.length === 0 && p.handCount === 7));
  assert.equal(room.snapshot(b).game.players[1].hand.length, 7, 'players still see their own hand');
});

test('join: a player can choose to watch instead of sit', () => {
  const room = new Room('ABCD');
  const anna = room.join('Ana');
  const watcher = room.join('Cass', { spectate: true });
  const bo = room.join('Bo');

  assert.equal(watcher.seat, null);
  assert.equal(bo.seat, 1);

  room.leave(anna);
  assert.equal(watcher.seat, null, 'a chosen spectator stays a spectator');
  assert.equal(bo.seat, 0);
});

test('spectate: a seated player steps aside and seats close up', () => {
  const room = new Room('ABCD');
  const anna = room.join('Ana');
  const bo = room.join('Bo');

  room.spectate(anna);
  assert.equal(anna.seat, null);
  assert.equal(anna.watcher, true);
  assert.equal(bo.seat, 0);
  assert.equal(room.snapshot(anna).seats.find((m) => m.name === 'Ana').seat, null);
});

test('spectate: a mid-round player leaves a bot in their seat', () => {
  const { room, a, b } = started();
  const hand = room.game.players[0].hand.length;

  room.spectate(a);
  assert.equal(a.seat, null);
  assert.equal(room.snapshot(a).you, null);
  assert.equal(room.game.players.length, 2);
  assert.equal(room.game.players[0].hand.length, hand);
  assert.equal(room.members.find((m) => m.seat === 0).bot, true);
  assert.equal(b.seat, 1);
  assert.equal(room.snapshot(a).seats.filter((m) => m.seat !== null).length, 2);
});

test('join: extra people spectate once the ten seats are taken', () => {
  const room = new Room('ABCD');
  const members = Array.from({ length: 11 }, (_, i) => room.join(`P${i}`));

  assert.equal(members[9].seat, 9);
  assert.equal(members[10].seat, null);
  assert.deepEqual(
    room.snapshot(members[0]).seats.map((s) => s.host),
    [true, false, false, false, false, false, false, false, false, false, false],
  );
});

test('leave: a waiting player drops out and seats close up', () => {
  const room = new Room('ABCD');
  const a = room.join('Ana');
  const b = room.join('Bo');
  const c = room.join('Cass');

  room.leave(b);
  assert.deepEqual(room.snapshot(a).seats.map((s) => s.name), ['Ana', 'Cass']);
  assert.equal(c.seat, 1);
});

test('leave: a watcher takes the seat that opens up, up to ten', () => {
  const room = new Room('ABCD');
  const members = Array.from({ length: 12 }, (_, i) => room.join(`P${i}`));

  room.leave(members[0]);
  const seats = room.snapshot(members[1]).seats;
  assert.equal(seats.filter((s) => s.seat !== null).length, 10);
  assert.equal(members[11].seat, null);
});

test('leave: a mid-round player hands their seat to a bot', () => {
  const { room, b } = started();
  const hand = room.game.players[1].hand.length;

  room.leave(b);
  assert.equal(room.game.players.length, 2);
  assert.equal(room.game.players[1].hand.length, hand);
  assert.equal(room.members.find((m) => m.name === 'Bo').bot, true);
  assert.deepEqual(room.snapshot(room.members[0]).seats.map((s) => s.bot), [false, true]);
});

test('kick: only the host can remove players', () => {
  const room = new Room('ABCD');
  const a = room.join('Ana');
  const b = room.join('Bo');
  const c = room.join('Cass');

  assert.throws(() => room.kick(b, c.id), /host/);
  assert.equal(room.kick(a, c.id).name, 'Cass');
  assert.deepEqual(room.snapshot(a).seats.map((s) => s.name), ['Ana', 'Bo']);
});

test('start: watchers stay out of the deal', () => {
  const room = new Room('ABCD');
  const members = Array.from({ length: 11 }, (_, i) => room.join(`P${i}`));

  room.start(members[0], 0);
  assert.equal(room.game.players.length, 10);
  assert.equal(members[10].seat, null);
  assert.equal(room.snapshot(members[10]).you, null);
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
