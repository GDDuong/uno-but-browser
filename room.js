import { COLORS, cardLabel } from './public/game/cards.js';
import { applyMove, createGame, playableCards, viewFor } from './public/game/rules.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const BOT_MS = 900;
const MAX_SEATS = 10;
const RULE_NAMES = { forcedPlay: 'forced play', stacking: 'stacking', sevenZero: '0\u20137' };

export const newCode = () =>
  Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

// ponytail: rooms live in memory until the process restarts. Prune idle rooms before this faces the internet.
export class Room {
  constructor(code) {
    this.code = code;
    this.members = [];
    this.creator = null;
    this.game = null;
    this.log = [];
    this.chat = [];
    this.rules = { forcedPlay: false, stacking: false, sevenZero: false };
    this.settings = { spectatorHands: true };
    this.round = 0;
    this.timer = 0;
    this.nextId = 0;
    this.emit = () => {};
  }

  byToken(token) {
    return this.members.find((m) => m.token === token);
  }

  join(name, { spectate = false } = {}) {
    const member = {
      id: ++this.nextId,
      token: crypto.randomUUID(),
      name: String(name).replace(/\s+/g, ' ').trim().slice(0, 20) || 'Player',
      seat: null,
      bot: false,
      watcher: Boolean(spectate),
    };

    if (!this.creator) this.creator = member;
    const seated = this.members.filter((m) => m.seat !== null).length;
    if (!spectate && !this.game && seated < MAX_SEATS) member.seat = seated;
    this.members.push(member);

    this.emit();
    return member;
  }

  kick(member, id) {
    if (member !== this.creator) throw new Error('Only the host can kick');
    const target = this.members.find((m) => m.id === Number(id) && !m.bot);
    if (!target || target === member) throw new Error('No such player');

    this.remove(target);
    return target;
  }

  leave(member) {
    this.remove(member);
  }

  spectate(member) {
    if (member.seat === null) return;

    if (this.game) {
      const seat = member.seat;
      member.seat = null;
      member.watcher = true;
      this.members.push({
        id: ++this.nextId,
        token: crypto.randomUUID(),
        name: member.name,
        seat,
        bot: true,
        watcher: false,
      });
      this.changed();
      return;
    }

    member.seat = null;
    member.watcher = true;
    this.seatMembers();
    this.emit();
  }

  remove(member) {
    if (this.game) {
      if (member.seat === null) {
        this.members = this.members.filter((m) => m !== member);
        this.emit();
        return;
      }
      // ponytail: a mid-round leaver becomes a bot in place so hands and turn order stay valid
      member.bot = true;
      this.changed();
      return;
    }

    this.members = this.members.filter((m) => m !== member);
    this.seatMembers();
    this.emit();
  }

  // People who chose to watch keep watching; overflow players take a seat when one opens.
  seatMembers() {
    let seat = 0;
    for (const m of this.members) if (m.seat !== null) m.seat = seat++;
    for (const m of this.members) if (m.seat === null && !m.watcher && seat < MAX_SEATS) m.seat = seat++;
  }

  setRules(member, rules) {
    if (member !== this.creator) throw new Error('Only the room creator can change the rules');
    if (this.game && this.game.phase !== 'over') throw new Error('Rules are locked once the round starts');

    this.rules = {
      forcedPlay: Boolean(rules?.forcedPlay),
      stacking: Boolean(rules?.stacking),
      sevenZero: Boolean(rules?.sevenZero),
    };
    this.emit();
  }

  setSettings(member, settings) {
    if (member !== this.creator) throw new Error('Only the host can change the table settings');

    this.settings = { spectatorHands: Boolean(settings?.spectatorHands) };
    this.emit();
  }

  start(member, bots = 0) {
    if (member !== this.creator) throw new Error('Only the room creator can start');

    clearTimeout(this.timer);
    this.members = this.members.filter((m) => !m.bot);
    this.seatMembers();

    const seated = this.members.filter((m) => m.seat !== null);
    const count = Math.max(0, Math.min(Number(bots), MAX_SEATS - seated.length));
    for (let i = 0; i < count; i++) {
      this.members.push({ id: ++this.nextId, token: `bot-${i}`, name: `Bot ${i + 1}`, seat: seated.length + i, bot: true });
    }
    const players = this.members.filter((m) => m.seat !== null);
    if (players.length < 2) throw new Error('Needs two players. Add a friend or a bot.');

    this.game = createGame(players.map((m) => m.name), { rules: this.rules });
    this.round += 1;

    const on = Object.keys(RULE_NAMES).filter((key) => this.rules[key]).map((key) => RULE_NAMES[key]);
    this.log = [`Dealt to ${players.length}${on.length ? ` \u00b7 ${on.join(', ')}` : ''}. ${this.game.players[0].name} starts.`];
    this.changed();
  }

  act(member, move) {
    const before = this.game;
    if (!before || before.phase !== 'playing') throw new Error('No game running');
    if (member.seat !== before.current) throw new Error('Not your turn');

    this.game = applyMove(before, move);
    this.log.unshift(describe(before, move, this.game));
    this.log.length = Math.min(this.log.length, 6);
    this.changed();
  }

  say(member, text) {
    const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!clean) return;

    this.chat.push({ from: member.name, text: clean });
    this.chat = this.chat.slice(-50);
    this.emit();
  }

  changed() {
    clearTimeout(this.timer);
    const game = this.game;
    if (game?.phase === 'playing') {
      const bot = this.members.find((m) => m.seat === game.current && m.bot);
      if (bot) this.timer = setTimeout(() => this.botAct(bot), BOT_MS);
    }
    this.emit();
  }

  botAct(member) {
    const game = this.game;
    if (!game || game.phase !== 'playing' || game.current !== member.seat) return;

    if (game.pick) {
      const others = game.players.filter((p) => p.id !== member.seat);
      const target = others.reduce((best, p) => (p.hand.length < best.hand.length ? p : best));
      this.act(member, { type: 'swap', seat: target.id });
      return;
    }

    const plays = playableCards(game);
    const card = plays[Math.floor(Math.random() * plays.length)];

    if (!card) {
      this.act(member, game.pending ? { type: 'pass' } : { type: 'draw' });
      return;
    }
    const move = { type: 'play', cardId: card.id };
    if (card.color === 'wild') move.color = bestColor(game, member.seat);
    this.act(member, move);
  }

  snapshot(member) {
    return {
      room: this.code,
      round: this.round,
      you: member.seat,
      youId: member.id,
      name: member.name,
      canStart: member === this.creator,
      maxSeats: MAX_SEATS,
      rules: this.rules,
      settings: this.settings,
      seats: this.members.map((m) => ({ id: m.id, name: m.name, seat: m.seat, bot: m.bot, host: m === this.creator })),
      game: this.game ? viewFor(this.game, member.seat, this.settings.spectatorHands) : null,
      log: this.log,
      chat: this.chat,
    };
  }
}

function bestColor(state, seat) {
  const counts = Object.fromEntries(COLORS.map((color) => [color, 0]));
  for (const card of state.players[seat].hand) {
    if (card.color !== 'wild') counts[card.color]++;
  }
  return COLORS.reduce((best, color) => (counts[color] > counts[best] ? color : best), COLORS[0]);
}

function describe(before, move, after) {
  const player = before.players[before.current];

  if (move.type === 'swap') return `${player.name} swapped hands with ${after.players[move.seat].name}.`;
  if (move.type === 'draw') {
    const drew = after.players[before.current].hand.length - player.hand.length;
    return `${player.name} drew ${drew} card${drew === 1 ? '' : 's'}.`;
  }
  if (move.type === 'pass') return `${player.name} passed.`;

  const card = player.hand.find((c) => c.id === move.cardId);
  const label = cardLabel(card);
  if (after.phase === 'over') return `${player.name} wins by playing ${label}!`;
  if (before.rules.sevenZero && card.face === '0') return `${player.name} played ${label} \u2014 hands rotate.`;
  if (after.drawStack > 0) return `${player.name} played ${label} \u2014 stack at ${after.drawStack}.`;
  return `${player.name} played ${label}${card.color === 'wild' ? ` (${move.color})` : ''}.`;
}
