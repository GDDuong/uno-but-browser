import { COLORS, cardLabel } from './public/game/cards.js';
import { applyMove, createGame, playableCards, viewFor } from './public/game/rules.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const BOT_MS = 900;
const MAX_SEATS = 6;
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
    this.round = 0;
    this.timer = 0;
    this.emit = () => {};
  }

  byToken(token) {
    return this.members.find((m) => m.token === token);
  }

  join(name) {
    const member = {
      token: crypto.randomUUID(),
      name: String(name).replace(/\s+/g, ' ').trim().slice(0, 20) || 'Player',
      seat: null,
      bot: false,
    };

    if (!this.creator) this.creator = member;
    if (!this.game && this.members.filter((m) => !m.bot).length < MAX_SEATS) {
      member.seat = this.members.filter((m) => !m.bot).length;
    }
    this.members.push(member);

    this.emit();
    return member;
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

  start(member, bots = 0) {
    if (member !== this.creator) throw new Error('Only the room creator can start');

    clearTimeout(this.timer);
    this.members = this.members.filter((m) => !m.bot);
    this.members.forEach((m, i) => {
      m.seat = i;
    });

    const count = Math.max(0, Math.min(Number(bots), MAX_SEATS - this.members.length));
    for (let i = 0; i < count; i++) {
      this.members.push({ token: `bot-${i}`, name: `Bot ${i + 1}`, seat: this.members.length, bot: true });
    }
    if (this.members.length < 2) throw new Error('Needs two players. Add a friend or a bot.');

    this.game = createGame(this.members.map((m) => m.name), { rules: this.rules });
    this.round += 1;

    const on = Object.keys(RULE_NAMES).filter((key) => this.rules[key]).map((key) => RULE_NAMES[key]);
    this.log = [`Dealt to ${this.members.length}${on.length ? ` \u00b7 ${on.join(', ')}` : ''}. ${this.game.players[0].name} starts.`];
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
      name: member.name,
      canStart: member === this.creator,
      maxSeats: MAX_SEATS,
      rules: this.rules,
      seats: this.members.map((m) => ({ name: m.name, seat: m.seat, bot: m.bot, host: m === this.creator })),
      game: this.game ? viewFor(this.game, member.seat) : null,
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
