import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomService } from '../server/rooms.mjs';
import { heroes } from '../dist/heroes.js';
import { matches } from '../dist/engine.js';

function fixture() {
  let now=1000;
  const service=new RoomService({now:()=>now,random:()=>0});
  const host=service.create('Аня'),guest=service.join(host.code,'Борис');
  const received=[[],[]];
  service.connect(host.code,host.token,s=>received[0].push(s));
  let disconnect=service.connect(host.code,guest.token,s=>received[1].push(s));
  const room=service.rooms.get(host.code);
  const act=(player,type,fields={})=>service.act(host.code,[host,guest][player].token,{type,matchId:room.state?.matchId,turn:room.state?.turn,...fields});
  act(0,'start');
  return {service,host,guest,room,received,act,setTime(value){now=value;},disconnect:()=>disconnect(),reconnect(){disconnect=service.connect(host.code,guest.token,s=>received[1].push(s));}};
}
const answer=state=>heroes.find(h=>!state.used.includes(h.id)&&matches(h,state.question)).name;

test('Only the acting player can retarget an active question without restarting it',()=>{
  const f=fixture();
  assert.throws(()=>f.act(0,'retarget',{cell:435}),e=>e.status===409);
  f.room.state.board[433]='O';f.act(0,'select',{cell:434});
  const question=structuredClone(f.room.state.question),deadline=f.room.state.deadline;
  f.setTime(10000);
  assert.throws(()=>f.act(1,'retarget',{cell:435}),e=>e.status===403);
  for(const cell of [433,-1,900,1.5,'435'])assert.throws(()=>f.act(0,'retarget',{cell}),e=>e.status===409);
  f.act(0,'retarget',{cell:435});f.act(0,'retarget',{cell:436});
  assert.deepEqual(f.room.state.question,question);assert.equal(f.room.state.deadline,deadline);
  assert.equal(f.room.state.pendingCell,436);assert.deepEqual(f.room.state.used,[]);
  assert.deepEqual(f.received[0].at(-1).state,f.received[1].at(-1).state);
  f.act(0,'answer',{answer:answer(f.room.state)});
  assert.equal(f.room.state.board[436],'X');assert.equal(f.room.state.board[434],null);
  assert.equal(f.room.state.result.cell,436);
  assert.throws(()=>f.act(1,'retarget',{cell:435}),e=>e.status===409);
});

test('A late retarget times out and cannot change either player\'s next turn',()=>{
  const f=fixture();f.act(0,'select',{cell:434});f.setTime(26000);
  assert.throws(()=>f.act(0,'retarget',{cell:435}));
  assert.equal(f.room.state.result.status,'timeout');assert.equal(f.room.state.result.cell,434);
  assert.equal(f.room.state.board.filter(Boolean).length,0);assert.equal(f.room.state.player,1);
  f.setTime(27000);f.service.tick();f.act(1,'select',{cell:436});
  assert.throws(()=>f.act(0,'retarget',{cell:437,turn:1}),e=>e.status===403);
  assert.equal(f.room.state.pendingCell,436);
});

test('Rooms have separate player credentials, two seats, and snapshots never expose tokens',()=>{
  const f=fixture();
  assert.notEqual(f.host.token,f.guest.token);
  assert.throws(()=>f.service.join(f.host.code,'Третий'),error=>error.status===409);
  assert.throws(()=>f.service.act(f.host.code,'invalid',{type:'leave'}),error=>error.status===403);
  assert(!JSON.stringify(f.received).includes(f.host.token));
  assert(!JSON.stringify(f.received).includes(f.guest.token));
  f.received[0].at(-1).state.board[0]='X';assert.equal(f.room.state.board[0],null);
});

test('Only the host starts a room, and only once both connections are present',()=>{
  const service=new RoomService(),host=service.create('Аня'),guest=service.join(host.code,'Борис');
  service.connect(host.code,host.token,()=>{});
  assert.throws(()=>service.act(host.code,host.token,{type:'start'}),error=>error.status===409);
  service.connect(host.code,guest.token,()=>{});
  assert.throws(()=>service.act(host.code,guest.token,{type:'start'}),error=>error.status===403);
  service.act(host.code,host.token,{type:'start'});
  assert.throws(()=>service.act(host.code,host.token,{type:'start'}),error=>error.status===409);
});

test('Server checks turn, question, repeated requests and publishes the same board to both players',()=>{
  const f=fixture();
  assert.throws(()=>f.act(1,'select',{cell:434}),error=>error.status===403);
  assert.throws(()=>f.act(0,'answer',{answer:'Axe'}),error=>error.status===409);
  f.act(0,'select',{cell:434});
  assert.equal(f.room.state.deadline,26000);
  assert.throws(()=>f.act(0,'select',{cell:435}),error=>error.status===409);
  assert.equal(f.act(0,'answer',{answer:'not a hero'}).answerStatus,'unknown');
  const stale={turn:1,matchId:f.room.state.matchId};
  f.act(0,'answer',{answer:answer(f.room.state)});
  assert.equal(f.room.state.board[434],'X');assert.equal(f.room.state.used.length,1);
  assert.deepEqual(f.received[0].at(-1).state,f.received[1].at(-1).state);
  assert.throws(()=>f.act(1,'select',{cell:435}),error=>error.status===409);
  f.setTime(2000);f.service.tick();
  assert.equal(f.room.state.result,null);
  assert.throws(()=>f.act(1,'select',{cell:434}),error=>error.status===409);
  f.act(1,'select',{cell:435});
  assert.throws(()=>f.act(1,'skip',stale),error=>error.status===409);
  f.act(1,'skip');assert.equal(f.room.state.board[435],null);
});

test('Wrong answer consumes a hero and the server owns the timeout even without client actions',()=>{
  const f=fixture();f.act(0,'select',{cell:0});
  const wrong=heroes.find(h=>!matches(h,f.room.state.question));
  f.act(0,'answer',{answer:wrong.name});assert.equal(f.room.state.result.status,'wrong');
  assert(f.room.state.used.includes(wrong.id));assert.equal(f.room.state.board[0],null);
  f.setTime(2000);f.service.tick();f.act(1,'select',{cell:1});
  f.setTime(27000);f.service.tick();assert.equal(f.room.state.result.status,'timeout');assert.equal(f.room.state.player,0);
});

test('A late answer cannot bypass the server deadline',()=>{
  const f=fixture();f.act(0,'select',{cell:0});const correct=answer(f.room.state);
  f.setTime(26000);assert.throws(()=>f.act(0,'answer',{answer:correct}));
  assert.equal(f.room.state.board[0],null);assert.equal(f.room.state.used.length,0);
  assert.equal(f.room.state.result.status,'timeout');
});

test('Disconnect pauses the question, reconnect keeps remaining time, and an old stream cannot disconnect a new one',()=>{
  const f=fixture();f.act(0,'select',{cell:0});
  f.setTime(6000);f.disconnect();assert.equal(f.room.pausedAt,6000);
  f.setTime(16000);f.service.tick();assert.equal(f.room.state.phase,'quiz');
  assert.throws(()=>f.act(0,'skip'),error=>error.status===409);
  f.reconnect();assert.equal(f.room.pausedAt,null);assert.equal(f.room.state.deadline,36000);
  f.setTime(35999);f.service.tick();assert.equal(f.room.state.phase,'quiz');
  f.setTime(36000);f.service.tick();assert.equal(f.room.state.result.status,'timeout');
  const stale=f.service.connect(f.host.code,f.host.token,()=>{});
  f.service.connect(f.host.code,f.host.token,()=>{});stale();
  assert.equal(f.room.players[0].connected,true);
});

test('A win is shared, rematch requires both players and resets bans and match identity',()=>{
  const f=fixture();[0,1,2,3].forEach(i=>f.room.state.board[i]='X');
  const oldMatch=f.room.state.matchId;
  f.act(0,'select',{cell:4});f.act(0,'answer',{answer:answer(f.room.state)});
  assert.equal(f.room.state.winner,0);assert.equal(f.received[1].at(-1).state.phase,'finished');
  f.setTime(2000);f.service.tick();f.act(0,'rematch');assert.equal(f.room.state.matchId,oldMatch);
  f.act(1,'rematch');assert.notEqual(f.room.state.matchId,oldMatch);
  assert.equal(f.room.state.used.length,0);assert.equal(f.room.state.board.filter(Boolean).length,0);
  assert.throws(()=>f.act(0,'select',{cell:0,matchId:oldMatch}),error=>error.status===409);
});

test('Leave and failed reconnect close the room for both players; expired rooms are removed',()=>{
  const f=fixture();f.disconnect();f.setTime(31000);f.service.tick();
  assert.equal(f.received[0].at(-1).status,'closed');
  assert.throws(()=>f.service.join(f.host.code,'Друг'),error=>error.status===410);
  f.setTime(91000);f.service.tick();assert.equal(f.service.rooms.size,0);
  const g=fixture();g.act(0,'leave');assert.equal(g.received[1].at(-1).status,'closed');
});

test('Room limits and name validation bound resources',()=>{
  const service=new RoomService({maxRooms:1});
  assert.throws(()=>service.create('x'.repeat(23)),error=>error.status===400);
  assert.throws(()=>service.create('\n'),error=>error.status===400);
  const host=service.create('Аня');assert.equal(host.snapshot.players[0].name,'Аня');
  assert.throws(()=>service.create('Борис'),error=>error.status===503);
});
