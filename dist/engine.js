export const SIZE = 30;
export function expandSavedBoard(state) {
  if(!state?.board) return null;
  if(state.board.length===SIZE*SIZE) return state;
  const previousSize=15;
  if(state.board.length!==previousSize*previousSize) return null;
  const offset=Math.floor((SIZE-previousSize)/2);
  const remap=index=>index===null||index===undefined?null:(Math.floor(index/previousSize)+offset)*SIZE+index%previousSize+offset;
  const board=Array(SIZE*SIZE).fill(null);
  state.board.forEach((mark,index)=>{board[remap(index)]=mark;});
  return {...state,board,lastCell:remap(state.lastCell),pendingCell:remap(state.pendingCell),line:(state.line||[]).map(remap)};
}
export const ROLES = { Carry: 'Керри', Support: 'Поддержка', Nuker: 'Быстрый урон', Disabler: 'Контроль', Jungler: 'Лесник', Durable: 'Стойкость', Escape: 'Побег', Pusher: 'Осада', Initiator: 'Инициация' };
export const ATTRS = { str: 'Сила', agi: 'Ловкость', int: 'Интеллект', all: 'Универсал' };
export const COLORS = { red: 'Красный', blue: 'Синий', green: 'Зелёный', purple: 'Фиолетовый', yellow: 'Жёлтый', white: 'Белый', brown: 'Коричневый' };
export function normalize(value) { return String(value).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, ''); }
export function findHero(heroes, answer) { const key = normalize(answer); return heroes.find(h => [h.name, ...(h.aliases || [])].some(a => normalize(a) === key)); }
export function matches(hero, question) {
  return question.traits.every(t => t.kind === 'role' ? hero.roles.includes(t.value) : t.kind === 'attr' ? hero.attr === t.value : t.kind === 'color' && Object.hasOwn(COLORS, t.value) && hero.colors.includes(t.value));
}
export function makeQuestion(heroes, used, random = Math.random) {
  const available = heroes.filter(h => !used.includes(h.id));
  if (!available.length) return null;
  const pick = list => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  const hero = pick(available);
  const pairs = [[{ kind: 'role', value: pick(hero.roles) }, { kind: 'attr', value: hero.attr }]];
  const questionColors = (hero.questionColors ?? hero.colors).filter(color => Object.hasOwn(COLORS, color));
  if (questionColors.length) {
    pairs.push([{ kind: 'color', value: pick(questionColors) }, { kind: 'role', value: pick(hero.roles) }]);
    pairs.push([{ kind: 'color', value: pick(questionColors) }, { kind: 'attr', value: hero.attr }]);
  }
  return { traits: pick(pairs) };
}
export function refreshObsoleteQuestion(state, heroes, now = Date.now()) {
  if (state?.phase !== 'quiz') return false;
  const known = state.question?.traits?.every(t => Object.hasOwn(t.kind === 'color' ? COLORS : t.kind === 'role' ? ROLES : t.kind === 'attr' ? ATTRS : {}, t.value));
  const available = heroes.filter(hero => !state.used.includes(hero.id));
  if (known && available.some(hero => matches(hero, state.question))) return false;
  const question = makeQuestion(heroes, state.used);
  if (!question) { state.phase = 'finished'; state.winner = 'exhausted'; state.deadline = null; state.pendingCell = null; return true; }
  state.question = { ...question, notice: 'Спорная подсказка заменена. Время на новый вопрос восстановлено.' };
  state.deadline = now + state.settings.seconds * 1000;
  return true;
}
export function winningLine(board, index, size = SIZE) {
  const symbol = board[index];
  if (!symbol) return [];
  const row = Math.floor(index / size), col = index % size;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [index];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign, c = col + dc * sign;
      while (r >= 0 && c >= 0 && r < size && c < size && board[r * size + c] === symbol) {
        line.push(r * size + c); r += dr * sign; c += dc * sign;
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}
export function newGame(settings) {
  return { version: 2, settings, board: Array(SIZE * SIZE).fill(null), player: 0, phase: 'ready', used: [], log: [], turn: 1, question: null, deadline: null, line: [], winner: null, lastCell: null, pendingCell: null, feedback: null };
}
export function beginQuestion(state, heroes, index, now = Date.now(), random = Math.random) {
  if (state.phase !== 'ready' || !Number.isInteger(index) || index < 0 || index >= state.board.length || state.board[index]) return false;
  state.question = makeQuestion(heroes, state.used, random);
  if (!state.question) { state.phase = 'finished'; state.winner = 'exhausted'; return false; }
  state.pendingCell = index; state.deadline = now + state.settings.seconds * 1000;
  state.phase = 'quiz'; state.feedback = null;
  return true;
}
export function failTurn(state, heroes, reason) {
  if (state.phase !== 'quiz') return;
  const example = heroes.find(h => !state.used.includes(h.id) && matches(h, state.question));
  state.log.unshift({ player: state.player, type: reason, turn: state.turn });
  const messages = { timeout: 'Время вышло.', repeated: 'Герой уже использован.', wrong: 'Ответ не подходит.', skip: 'Ход пропущен.' };
  state.feedback = { type: 'error', text: messages[reason] || messages.wrong, example: example?.name || null };
  state.player = 1 - state.player; state.turn++; state.phase = 'ready'; state.deadline = null; state.pendingCell = null;
  if (state.used.length === heroes.length) { state.phase = 'finished'; state.winner = 'exhausted'; }
}
export function submitAnswer(state, heroes, answer, now = Date.now()) {
  if (state.phase !== 'quiz') return { status: 'inactive' };
  if (now >= state.deadline) { failTurn(state, heroes, 'timeout'); return { status: 'timeout' }; }
  const hero = findHero(heroes, answer);
  if (!hero) return { status: 'unknown' };
  if (state.used.includes(hero.id)) { failTurn(state, heroes, 'repeated'); return { status: 'repeated' }; }
  state.used.push(hero.id);
  if (!matches(hero, state.question)) {
    const mismatches=state.question.traits.filter(trait=>!matches(hero,{traits:[trait]}));
    const reasons=mismatches.map(trait=>trait.kind==='attr'?`${ATTRS[hero.attr]}, нужен ${ATTRS[trait.value]}`:trait.kind==='role'?`нет роли «${ROLES[trait.value]}»`:`не подходит цвет «${COLORS[trait.value]}»`);
    failTurn(state, heroes, 'wrong');
    state.feedback.text=`${hero.name} — ${reasons.join('; ')}.`;
    return { status: 'wrong' };
  }
  state.phase = 'place'; state.deadline = null;
  state.feedback = { type: 'success', text: `${hero.name} — верно! Выберите свободную клетку.`, example: null };
  state.log.unshift({ player: state.player, type: 'correct', hero: hero.name, turn: state.turn });
  placeMark(state, state.pendingCell);
  if (state.phase === 'ready') state.feedback = { type: 'success', text: `${hero.name} — верно.`, example: null };
  return { status: 'correct', hero };
}
export function placeMark(state, index) {
  if (state.phase !== 'place' || !Number.isInteger(index) || index < 0 || index >= state.board.length || state.board[index]) return false;
  state.board[index] = state.player === 0 ? 'X' : 'O'; state.lastCell = index; state.pendingCell = null;
  state.line = winningLine(state.board, index);
  if (state.line.length) { state.phase = 'finished'; state.winner = state.player; }
  else if (state.board.every(Boolean)) { state.phase = 'finished'; state.winner = 'draw'; }
  else if (state.used.length >= state.settings.heroCount) { state.phase = 'finished'; state.winner = 'exhausted'; }
  else { state.player = 1 - state.player; state.phase = 'ready'; state.turn++; state.question = null; state.feedback = null; }
  return true;
}
