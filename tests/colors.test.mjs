import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { heroes } from '../dist/heroes.js';
import { COLORS, makeQuestion, matches, newGame, refreshObsoleteQuestion } from '../dist/engine.js';

const sample = { id: 1, name: 'Example', attr: 'str', roles: ['Carry'], colors: ['green', 'blue'], questionColors: ['green'] };

test('Every bundled hero matches its audited entry and the original roles and attribute', () => {
  const audit = JSON.parse(readFileSync(new URL('../data/color-audit.json', import.meta.url), 'utf8'));
  const source = JSON.parse(readFileSync(new URL('../data/heroes-source.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(audit).length, heroes.length);
  assert.equal(Object.values(source).filter(h => h.roles.length).length, heroes.length);
  for (const hero of heroes) {
    assert.deepEqual(hero.colors, audit[hero.name].colors, hero.name);
    assert.deepEqual(hero.questionColors, audit[hero.name].questionColors, hero.name);
    assert(hero.colors.every(color => Object.hasOwn(COLORS, color)), hero.name);
    assert(hero.questionColors.every(color => hero.colors.includes(color)), hero.name);
    assert.equal(hero.attr, source[hero.id].primary_attr, hero.name);
    assert.deepEqual(hero.roles, source[hero.id].roles, hero.name);
  }
});

test('Only confident colors generate clues; accepted secondary colors still match', () => {
  for (const random of [0, .25, .5, .75, .999]) {
    const question = makeQuestion([sample], [], () => random);
    assert(question.traits.filter(t => t.kind === 'color').every(t => t.value === 'green'));
    assert(matches(sample, question));
  }
  assert(matches(sample, { traits: [{ kind: 'color', value: 'blue' }, { kind: 'attr', value: 'str' }] }));
});

test('Ambiguous appearances use role + attribute while remaining valid color answers', () => {
  const hero = { ...sample, questionColors: [] };
  const question = makeQuestion([hero], [], () => .999);
  assert.deepEqual(question.traits.map(t => t.kind), ['role', 'attr']);
  assert(matches(hero, { traits: [{ kind: 'color', value: 'blue' }] }));
});

test('Retired dark and gold categories cannot generate or validate clues', () => {
  assert(!Object.hasOwn(COLORS, 'dark'));
  assert(!Object.hasOwn(COLORS, 'gold'));
  const hero = { ...sample, colors: ['dark', 'gold'], questionColors: ['dark', 'gold'] };
  const question = makeQuestion([hero], [], () => .999);
  assert(question.traits.every(t => t.kind !== 'color'));
  assert(!matches(hero, { traits: [{ kind: 'color', value: 'dark' }] }));
});

test('Saved questions using retired clues are replaced without losing the cell or a turn', () => {
  for (const retired of ['dark', 'gold']) {
    const state = newGame({ names: ['A', 'B'], seconds: 30, heroCount: 1 });
    state.phase = 'quiz'; state.pendingCell = 112; state.deadline = 1000;
    state.question = { traits: [{ kind: 'color', value: retired }, { kind: 'attr', value: 'str' }] };
    assert(refreshObsoleteQuestion(state, [sample], 5000));
    assert.equal(state.pendingCell, 112); assert.equal(state.player, 0);
    assert.equal(state.deadline, 35000); assert.equal(state.turn, 1);
    assert.equal(state.used.length, 0); assert(matches(sample, state.question));
  }
});

test('Reloading a valid question does not extend the timer', () => {
  const state = newGame({ names: ['A', 'B'], seconds: 30, heroCount: 1 });
  state.phase = 'quiz'; state.pendingCell = 112; state.deadline = 1000;
  state.question = { traits: [{ kind: 'role', value: 'Carry' }, { kind: 'attr', value: 'str' }] };
  assert.equal(refreshObsoleteQuestion(state, [sample], 5000), false);
  assert.equal(state.deadline, 1000);
});
