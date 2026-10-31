import test from 'node:test';
import assert from 'node:assert/strict';
import { heroes } from '../dist/heroes.js';
import { SIZE, expandSavedBoard, newGame, beginQuestion, submitAnswer, winningLine, makeQuestion, matches, findHero, failTurn } from '../dist/engine.js';
const setup=()=>newGame({names:['Аня','Борис'],seconds:30,heroCount:heroes.length,theme:'dota'});
const correct=s=>heroes.find(h=>!s.used.includes(h.id)&&matches(h,s.question));
test('Windranger is accepted for green + universal and places the selected mark',()=>{
  const s=setup();beginQuestion(s,heroes,112,1000);
  s.question={traits:[{kind:'color',value:'green'},{kind:'attr',value:'all'}]};
  assert.equal(submitAnswer(s,heroes,'Windranger',2000).status,'correct');
  assert.equal(s.board[112],'X');assert.equal(s.player,1);
});
test('Previously omitted color tags are populated',()=>{
  for(const [name,color] of [['Windranger','green'],['Lion','purple'],['Ogre Magi','blue']]){
    assert(findHero(heroes,name).colors.includes(color));
  }
});
test('Enigma has control but is universal; an intellect answer explains the mismatch',()=>{
  const hero=findHero(heroes,'энигма');
  assert.equal(hero.attr,'all');assert(hero.roles.includes('Disabler'));
  assert(matches(hero,{traits:[{kind:'attr',value:'all'},{kind:'role',value:'Disabler'}]}));
  const s=setup();beginQuestion(s,heroes,112,1000);
  s.question={traits:[{kind:'attr',value:'int'},{kind:'role',value:'Disabler'}]};
  assert.equal(submitAnswer(s,heroes,'энигма',2000).status,'wrong');
  assert.match(s.feedback.text,/Enigma.*Универсал.*Интеллект/);
  assert.equal(s.board[112],null);assert.equal(s.player,1);
});
test('Every question has an unused valid answer, including the final hero',()=>{
  for(let seed=0;seed<heroes.length;seed++){
    const used=heroes.slice(0,seed).map(h=>h.id);
    for(const r of [0,.2,.5,.8,.999]) {const q=makeQuestion(heroes,used,()=>r);assert.equal(q.traits.length,2);assert(heroes.some(h=>!used.includes(h.id)&&matches(h,q)));}
  }
  assert.equal(makeQuestion(heroes,heroes.map(h=>h.id)),null);
});
test('Selecting a cell starts the clock; correct answer places exactly there and transfers turn',()=>{
  const s=setup();assert(beginQuestion(s,heroes,112,1000,()=>0));assert.equal(s.board[112],null);assert.equal(s.deadline,31000);
  assert.equal(submitAnswer(s,heroes,correct(s).name,2000).status,'correct');assert.equal(s.board[112],'X');assert.equal(s.player,1);assert.equal(s.phase,'ready');assert.equal(s.pendingCell,null);assert.equal(s.used.length,1);
  assert.equal(beginQuestion(s,heroes,112,3000),false);
  assert(beginQuestion(s,heroes,113,3000));assert.equal(submitAnswer(s,heroes,correct(s).name,4000).status,'correct');assert.equal(s.board[113],'O');
});
test('Wrong answer consumes the hero, releases cell, and transfers turn',()=>{
  const s=setup();beginQuestion(s,heroes,0,1000,()=>0);const wrong=heroes.find(h=>!matches(h,s.question));
  assert.equal(submitAnswer(s,heroes,wrong.name,2000).status,'wrong');assert(s.used.includes(wrong.id));assert.equal(s.board[0],null);assert.equal(s.player,1);assert.equal(s.phase,'ready');
});
test('Reused hero fails, even if they match the clues',()=>{
  const s=setup();beginQuestion(s,heroes,0,1000,()=>0);const h=correct(s);s.used.push(h.id);assert.equal(submitAnswer(s,heroes,h.name,2000).status,'repeated');assert.equal(s.board[0],null);assert.equal(s.player,1);
});
test('Deadline is absolute: late and double submissions cannot place symbols',()=>{
  const s=setup();beginQuestion(s,heroes,1,1000);const h=correct(s);assert.equal(submitAnswer(s,heroes,h.name,31000).status,'timeout');assert.equal(s.phase,'ready');assert.equal(s.player,1);assert.equal(submitAnswer(s,heroes,h.name,31001).status,'inactive');assert.equal(s.board.filter(Boolean).length,0);
});
test('Unknown name can be corrected within timer; aliases normalize',()=>{
  const s=setup();beginQuestion(s,heroes,1,1000);assert.equal(submitAnswer(s,heroes,'несуществующий герой',2000).status,'unknown');assert.equal(s.phase,'quiz');assert.equal(findHero(heroes,'  ANTI mage ').name,'Anti-Mage');assert.equal(findHero(heroes,'ПУДЖ').name,'Pudge');
});
test('All four win directions, overlines, and no wrapping at row borders',()=>{
  for(const step of [1,SIZE,SIZE+1,SIZE-1]){const board=Array(SIZE*SIZE).fill(null);const start=step===SIZE-1?SIZE-1:0;for(let k=0;k<5;k++)board[start+k*step]='X';assert.equal(winningLine(board,start+4*step).length,5);}
  const wrapped=Array(SIZE*SIZE).fill(null);[SIZE-2,SIZE-1,SIZE,SIZE+1,SIZE+2].forEach(i=>wrapped[i]='X');assert.equal(winningLine(wrapped,SIZE).length,0);
  const six=Array(SIZE*SIZE).fill(null);for(let i=0;i<6;i++)six[i]='O';assert.equal(winningLine(six,3).length,6);
});
test('Board is 30 by 30 and rejects out of bounds selections',()=>{
  const s=setup();assert.equal(SIZE,30);assert.equal(s.board.length,900);
  assert.equal(beginQuestion(s,heroes,900,1000),false);
  assert.equal(beginQuestion(s,heroes,899,1000),true);
});
test('Legacy matches expand without losing marks, a pending cell, bans, timer or winner',()=>{
  const old={...setup(),board:Array(225).fill(null),pendingCell:112,lastCell:0,line:[0,1,2,3,4],used:[21],deadline:12345,winner:0,phase:'finished'};
  for(let i=0;i<5;i++)old.board[i]='X';old.board[224]='O';
  const expanded=expandSavedBoard(old);
  const index=i=>(Math.floor(i/15)+7)*30+i%15+7;
  assert.equal(expanded.board.length,900);assert.equal(expanded.board[index(0)],'X');assert.equal(expanded.board[index(224)],'O');
  assert.equal(expanded.board.filter(Boolean).length,6);assert.equal(expanded.pendingCell,index(112));assert.equal(expanded.lastCell,index(0));
  assert.deepEqual(expanded.line,[0,1,2,3,4].map(index));assert.equal(expanded.deadline,12345);assert.deepEqual(expanded.used,[21]);assert.equal(expanded.winner,0);
  assert.equal(old.board.length,225);assert.equal(expandSavedBoard(expanded),expanded);assert.equal(expandSavedBoard({board:[]}),null);
});
test('Winning answer ends match and highlights line; last hero without victory draws',()=>{
  const s=setup();for(let i=0;i<4;i++)s.board[i]='X';beginQuestion(s,heroes,4,1000);submitAnswer(s,heroes,correct(s).name,2000);assert.equal(s.phase,'finished');assert.equal(s.winner,0);assert.equal(s.line.length,5);
  const end=setup();end.used=heroes.slice(0,-1).map(h=>h.id);beginQuestion(end,heroes,0,1000);submitAnswer(end,heroes,correct(end).name,2000);assert.equal(end.phase,'finished');assert.equal(end.winner,'exhausted');assert.equal(end.board[0],'X');
});
test('Exhausting all heroes with wrong answer ends match; skip keeps heroes available',()=>{
  const s=setup();beginQuestion(s,heroes,0,1000);failTurn(s,heroes,'skip');assert.equal(s.used.length,0);assert.equal(s.player,1);
  const end=setup();end.used=heroes.slice(0,-1).map(h=>h.id);beginQuestion(end,heroes,0,1000);const last=heroes.at(-1);end.question={traits:[{kind:'attr',value:last.attr==='str'?'agi':'str'}]};submitAnswer(end,heroes,last.name,2000);assert.equal(end.phase,'finished');assert.equal(end.winner,'exhausted');
});
