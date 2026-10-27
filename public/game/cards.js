export const COLORS = ['red', 'yellow', 'green', 'blue'];

export function buildDeck() {
  const deck = [];
  let id = 0;
  const add = (color, face) => deck.push({ id: id++, color, face });

  for (const color of COLORS) {
    add(color, '0');
    for (let n = 1; n <= 9; n++) {
      add(color, String(n));
      add(color, String(n));
    }
    for (const face of ['skip', 'reverse', 'draw2']) {
      add(color, face);
      add(color, face);
    }
  }
  for (let i = 0; i < 4; i++) {
    add('wild', 'wild');
    add('wild', 'draw4');
  }

  return deck;
}

export function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

const FACE_NAME = { skip: 'Skip', reverse: 'Reverse', draw2: 'Draw two', wild: 'Wild', draw4: 'Wild draw four' };

export function cardLabel(card) {
  if (card.color === 'wild') return FACE_NAME[card.face];
  const face = FACE_NAME[card.face] ?? card.face;
  return `${card.color[0].toUpperCase()}${card.color.slice(1)} ${face}`;
}
