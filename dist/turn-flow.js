import { beginQuestion, submitAnswer, failTurn, findHero } from './engine.js';

export const ANSWER_SECONDS = 25;
export const RESULT_DURATION_MS = 1000;
// Keep feedback visible briefly before allowing the next turn.
export function resultRemaining(state, now = Date.now()) {
  return state?.result ? Math.max(0, state.result.dismissAt - now) : 0;
}
const snapshot = state => ({ player: state.player, turn: state.turn, cell: state.pendingCell, traits: state.question.traits.map(trait => ({ ...trait })) });
export function openQuestion(state, heroes, cell, now = Date.now(), random = Math.random) {
  return !state.result && beginQuestion(state, heroes, cell, now, random);
}
export function changeQuestionCell(state, heroes, cell, now = Date.now()) {
  if (state.result || state.phase !== 'quiz') return false;
  if (now >= state.deadline) { endQuestion(state, heroes, 'timeout', now);return false; }
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.board.length || state.board[cell]) return false;
  state.pendingCell = cell;
  return true;
}
export function answerQuestion(state, heroes, answer, now = Date.now()) {
  if (state.result || state.phase !== 'quiz') return { status: 'inactive' };
  const turn = snapshot(state);
  const result = submitAnswer(state, heroes, answer, now);
  if (!['unknown', 'inactive'].includes(result.status)) {
    state.result = { ...turn, status: result.status, answer: findHero(heroes, answer)?.name || null, feedback: { ...state.feedback }, dismissAt: now + RESULT_DURATION_MS };
  }
  return result;
}
export function endQuestion(state, heroes, reason, now = Date.now()) {
  if (state.result || state.phase !== 'quiz') return;
  const turn = snapshot(state);
  failTurn(state, heroes, reason);
  state.result = { ...turn, status: reason, answer: null, feedback: { ...state.feedback }, dismissAt: now + RESULT_DURATION_MS };
}
export function acknowledgeResult(state) {
  if (!state?.result) return false;
  state.result = null;
  state.feedback = null;
  return true;
}
