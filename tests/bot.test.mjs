import test from 'node:test';
import assert from 'node:assert/strict';
import { heroes } from '../dist/heroes.js';
import { newGame, beginQuestion, submitAnswer, failTurn, matches, SIZE } from '../dist/engine.js';
import { isBotTurn, chooseBotCell, botAnswer } from '../dist/bot.js';
const setup = () => newGame({ mode: 'bot', names: ['Игрок', 'Бот'], seconds: 30, heroCount: heroes.length });

test('Bot acts only on its own active turns in bot mode', () => {
  const state = setup();
  assert.equal(isBotTurn(state), false);
  state.player = 1;
  assert.equal(isBotTurn(state), true);
  state.phase = 'finished';
  assert.equal(isBotTurn(state), false);
  state.phase = 'ready'; state.settings.mode = 'human';
  assert.equal(isBotTurn(state), false);
});

test('Bot opens in center, picks only free cells, and does not mutate board', () => {
  const board = Array(SIZE*SIZE).fill(null);
  const center=Math.floor((SIZE-1)/2)*(SIZE+1);
  assert.equal(chooseBotCell(board), center);
  board[center] = 'X';
  const before = board.slice();
  const move = chooseBotCell(board);
  assert.equal(board[move], null);
  assert.deepEqual(board, before);
  assert.equal(chooseBotCell(Array(SIZE*SIZE).fill('X')), null);
});

test('Bot completes its own five before blocking an opponent five', () => {
  const board = Array(SIZE*SIZE).fill(null);
  for (let i = 0; i < 4; i++) { board[i] = 'X'; board[SIZE + i] = 'O'; }
  assert.equal(chooseBotCell(board), SIZE + 4);
});

test('Bot blocks immediate threats in all four directions', () => {
  for (const step of [1, SIZE, SIZE+1, SIZE-1]) {
    const board = Array(SIZE*SIZE).fill(null), start = step === SIZE-1 ? SIZE-1 : 0;
    for (let i = 0; i < 4; i++) board[start + step * i] = 'X';
    assert.equal(chooseBotCell(board), start + step * 4);
  }
});

test('Bot uses an unused valid hero through the ordinary quiz and placement flow', () => {
  const state = setup();
  beginQuestion(state, heroes, 112, 1000);
  failTurn(state, heroes, 'skip');
  const index = chooseBotCell(state.board);
  beginQuestion(state, heroes, index, 2000);
  const answer = botAnswer(state, heroes);
  const hero = heroes.find(h => h.name === answer);
  assert(matches(hero, state.question));
  assert(!state.used.includes(hero.id));
  assert.equal(submitAnswer(state, heroes, answer, 3000).status, 'correct');
  assert.equal(state.board[index], 'O');
  assert.equal(state.player, 0);
  assert(state.used.includes(hero.id));
  assert.equal(botAnswer(state, heroes), null);
});

test('Bot respects timeout and can resume a serialized question', () => {
  const state = setup(); state.player = 1;
  beginQuestion(state, heroes, 112, 1000);
  const restored = JSON.parse(JSON.stringify(state));
  assert(isBotTurn(restored));
  assert(botAnswer(restored, heroes));
  assert.equal(submitAnswer(restored, heroes, botAnswer(restored, heroes), 31000).status, 'timeout');
  assert.equal(restored.board[112], null);
  assert.equal(restored.player, 0);
});

test('Repeated bot turns can play a whole match without stalling or reusing heroes', () => {
  const state = setup();
  for (let turn = 0; turn < heroes.length && state.phase !== 'finished'; turn++) {
    const index = chooseBotCell(state.board, state.player);
    assert.notEqual(index, null);
    assert(beginQuestion(state, heroes, index, 1000 + turn * 1000));
    const hero = heroes.find(h => !state.used.includes(h.id) && matches(h, state.question));
    assert.equal(submitAnswer(state, heroes, hero.name, 1100 + turn * 1000).status, 'correct');
  }
  assert.equal(state.phase, 'finished');
  assert.equal(new Set(state.used).size, state.used.length);
  assert.equal(state.used.length, state.board.filter(Boolean).length);
});
