import test from 'node:test';
import assert from 'node:assert/strict';
import { heroes } from '../dist/heroes.js';
import { newGame, matches } from '../dist/engine.js';
import { RESULT_DURATION_MS, resultRemaining, openQuestion, changeQuestionCell, answerQuestion, endQuestion, acknowledgeResult } from '../dist/turn-flow.js';
const setup=()=>newGame({names:['Аня','Бот'],mode:'bot',seconds:30,heroCount:heroes.length});
const correct=s=>heroes.find(h=>!s.used.includes(h.id)&&matches(h,s.question));

test('Changing cells preserves the question, deadline and bans, and places only the final choice',()=>{
  const s=setup();assert.equal(changeQuestionCell(s,heroes,0,1000),false);
  openQuestion(s,heroes,434,1000,()=>0);
  const question=s.question,deadline=s.deadline;
  for(const cell of [435,435,436,434,437])assert(changeQuestionCell(s,heroes,cell,15000));
  assert.equal(s.question,question);assert.equal(s.deadline,deadline);
  assert.equal(s.turn,1);assert.equal(s.player,0);assert.deepEqual(s.used,[]);
  assert.equal(s.board.filter(Boolean).length,0);
  assert.equal(answerQuestion(s,heroes,correct(s).name,16000).status,'correct');
  assert.equal(s.board[437],'X');assert.equal(s.board[434],null);
  assert.equal(s.result.cell,437);assert.equal(changeQuestionCell(s,heroes,438,16001),false);
});

test('Invalid or expired cell changes cannot alter the pending cell or extend a turn',()=>{
  const s=setup();s.board[435]='O';openQuestion(s,heroes,434,1000);
  const before=structuredClone(s);
  for(const cell of [-1,900,1.5,'436',null,435])assert.equal(changeQuestionCell(s,heroes,cell,2000),false);
  assert.deepEqual(s,before);
  assert.equal(changeQuestionCell(s,heroes,436,s.deadline),false);
  assert.equal(s.result.status,'timeout');assert.equal(s.result.cell,434);
  assert.equal(s.turn,2);assert.equal(s.board[436],null);assert.deepEqual(s.used,[]);
});

test('Correct result persists across reload and blocks next question during its one-second display',()=>{
  let s=setup();openQuestion(s,heroes,434,1000,()=>0);
  const hero=correct(s),traits=s.question.traits;
  assert.equal(answerQuestion(s,heroes,hero.name,2000).status,'correct');
  assert.equal(s.board[434],'X');assert.equal(s.player,1);
  s=JSON.parse(JSON.stringify(s));
  assert.equal(s.result.player,0);assert.equal(s.result.cell,434);
  assert.equal(s.result.answer,hero.name);assert.deepEqual(s.result.traits,traits);
  assert.equal(RESULT_DURATION_MS,1000);
  assert.equal(resultRemaining(s,2000),1000);
  assert.equal(resultRemaining(s,2999),1);
  assert.equal(resultRemaining(s,3000),0);
  assert.equal(resultRemaining(s,5000),0);
  assert.equal(openQuestion(s,heroes,435,3000),false);
  assert.equal(answerQuestion(s,heroes,hero.name,3000).status,'inactive');
  assert(acknowledgeResult(s));assert(openQuestion(s,heroes,435,3000));
});

test('Wrong result keeps its precise explanation, example and empty cell',()=>{
  const s=setup();openQuestion(s,heroes,434,1000);
  s.question={traits:[{kind:'attr',value:'int'},{kind:'role',value:'Disabler'}]};
  answerQuestion(s,heroes,'Enigma',2000);
  assert.equal(s.result.status,'wrong');assert.equal(s.result.answer,'Enigma');
  assert.match(s.result.feedback.text,/Универсал.*Интеллект/);
  assert(s.result.feedback.example);assert.equal(s.board[434],null);
  assert.equal(s.result.player,0);assert.equal(s.player,1);
});

test('Unknown input stays in the question; timeout and skip create one result only',()=>{
  const s=setup();openQuestion(s,heroes,434,1000);
  assert.equal(answerQuestion(s,heroes,'unknown!',2000).status,'unknown');
  assert.equal(s.result,undefined);assert.equal(s.phase,'quiz');
  endQuestion(s,heroes,'timeout');endQuestion(s,heroes,'timeout');
  assert.equal(s.result.status,'timeout');assert.equal(s.turn,2);assert.equal(s.log.length,1);
  acknowledgeResult(s);openQuestion(s,heroes,434,5000);
  endQuestion(s,heroes,'skip');assert.equal(s.result.status,'skip');assert.equal(s.turn,3);
});

test('Repeat and late submission have explicit outcomes',()=>{
  const s=setup();openQuestion(s,heroes,434,1000);const hero=correct(s);s.used.push(hero.id);
  answerQuestion(s,heroes,hero.name,2000);assert.equal(s.result.status,'repeated');
  acknowledgeResult(s);openQuestion(s,heroes,434,5000);
  answerQuestion(s,heroes,correct(s).name,35000);assert.equal(s.result.status,'timeout');
  assert.equal(s.board[434],null);
});

test('Winning answer retains a result before the final game screen',()=>{
  const s=setup();[430,431,432,433].forEach(i=>s.board[i]='X');
  openQuestion(s,heroes,434,1000);answerQuestion(s,heroes,correct(s).name,2000);
  assert.equal(s.phase,'finished');assert.equal(s.winner,0);
  assert.equal(s.result.status,'correct');assert.equal(s.result.player,0);
  assert.equal(resultRemaining(s,2500),500);
  acknowledgeResult(s);assert.equal(s.phase,'finished');assert.equal(s.result,null);
});

test('Timeout and skip display for one second without adding time on reload',()=>{
  for(const reason of ['timeout','skip']) {
    const s=setup();openQuestion(s,heroes,434,1000);
    endQuestion(s,heroes,reason,31000);
    const restored=JSON.parse(JSON.stringify(s));
    assert.equal(resultRemaining(restored,31500),500);
    assert.equal(resultRemaining(restored,32000),0);
    assert.equal(restored.result.status,reason);
    assert.equal(restored.board[434],null);
  }
});
