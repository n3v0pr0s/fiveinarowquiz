import { SIZE, matches, winningLine } from './engine.js';

export function isBotTurn(state) {
  return Boolean(state && state.settings.mode === 'bot' && state.player === 1 && ['ready', 'quiz'].includes(state.phase));
}

// The test bot knows the hero directory but uses the same answer validation as a person.
export function botAnswer(state, heroes) {
  if (!isBotTurn(state) || state.phase !== 'quiz') return null;
  return heroes.find(hero => !state.used.includes(hero.id) && matches(hero, state.question))?.name || null;
}

export function chooseBotCell(board, player = 1, size = SIZE) {
  const empty = board.flatMap((value, index) => value ? [] : [index]);
  if (!empty.length) return null;
  const own = player === 0 ? 'X' : 'O';
  const other = player === 0 ? 'O' : 'X';
  const center = (size - 1) / 2;
  const trial = board.slice();
  // Finish a five first, then prevent an immediate opponent victory.
  for (const mark of [own, other]) {
    for (const index of empty) {
      trial[index] = mark;
      const wins = winningLine(trial, index, size).length > 0;
      trial[index] = null;
      if (wins) return index;
    }
  }
  function score(index, mark) {
    const row = Math.floor(index / size), col = index % size;
    let total = 0;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      let length = 1, open = 0;
      for (const direction of [-1, 1]) {
        let r = row + dr * direction, c = col + dc * direction;
        while (r >= 0 && r < size && c >= 0 && c < size && board[r * size + c] === mark) {
          length++; r += dr * direction; c += dc * direction;
        }
        if (r >= 0 && r < size && c >= 0 && c < size && !board[r * size + c]) open++;
      }
      if (open) total += [0, 1, 12, 130, 2000, 100000][Math.min(5, length)] * open;
    }
    return total;
  }
  return empty.reduce((best, index) => {
    const value = score(index, own) + score(index, other) * 1.1 - (Math.abs(Math.floor(index / size) - center) + Math.abs(index % size - center)) * .1;
    return !best || value > best.value ? { index, value } : best;
  }, null).index;
}
