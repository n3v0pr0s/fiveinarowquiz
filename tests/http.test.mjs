import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/http.mjs';
import { RoomService } from '../server/rooms.mjs';
import { heroes } from '../dist/heroes.js';
import { matches } from '../dist/engine.js';

test('HTTP rooms synchronize two authenticated event streams and reject invalid requests',async()=>{
  const server=createGameServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const controllers=[];
  const post=async(route,data,headers={})=>{
    const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
    return {status:response.status,...await response.json()};
  };
  async function events(session) {
    const controller=new AbortController();controllers.push(controller);
    const response=await fetch(`${base}/api/rooms/${session.code}/events?token=${session.token}`,{signal:controller.signal});
    assert.equal(response.status,200);
    const reader=response.body.getReader();let buffer='';
    return async predicate=>{
      while(true) {
        const end=buffer.indexOf('\n\n');
        if(end>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);if(block.startsWith('data: ')){const value=JSON.parse(block.slice(6));if(predicate(value))return value;}continue;}
        const read=await reader.read();if(read.done)throw Error('Stream ended');buffer+=new TextDecoder().decode(read.value);
      }
    };
  }
  try {
    assert.equal((await fetch(base+'/')).status,200);
    const host=await post('/api/rooms',{name:'Аня'});assert.equal(host.status,201);
    const guest=await post(`/api/rooms/${host.code}/join`,{name:'Борис'});assert.equal(guest.status,200);
    const hostEvents=await events(host),guestEvents=await events(guest);
    await hostEvents(s=>s.players.every(p=>p?.connected));await guestEvents(s=>s.players.every(p=>p?.connected));
    const start=await post(`/api/rooms/${host.code}/action`,{token:host.token,type:'start'});assert.equal(start.status,200);
    const {matchId,turn}=start.snapshot.state;
    const selected=await post(`/api/rooms/${host.code}/action`,{token:host.token,type:'select',cell:434,matchId,turn});assert.equal(selected.status,200);
    const one=await hostEvents(s=>s.state?.phase==='quiz'),two=await guestEvents(s=>s.state?.phase==='quiz');
    assert.deepEqual(one.state,two.state);assert.equal(one.you,0);assert.equal(two.you,1);
    const retarget=await post(`/api/rooms/${host.code}/action`,{token:host.token,type:'retarget',cell:435,matchId,turn});
    assert.equal(retarget.status,200);
    const movedOne=await hostEvents(s=>s.state?.pendingCell===435),movedTwo=await guestEvents(s=>s.state?.pendingCell===435);
    assert.deepEqual(movedOne.state,movedTwo.state);assert.deepEqual(movedOne.state.question,one.state.question);
    assert.equal(movedOne.state.deadline,one.state.deadline);assert.equal(movedOne.state.turn,turn);
    assert(!JSON.stringify(one).includes(host.token));
    assert.equal((await post(`/api/rooms/${host.code}/action`,{token:guest.token,type:'skip',matchId,turn})).status,403);
    assert.equal((await post('/api/rooms',{name:'Друг'},{Origin:'https://other.example'})).status,403);
    assert.equal((await post('/api/rooms',{name:'x'.repeat(5000)})).status,413);
    assert.equal((await fetch(base+`/api/rooms/${host.code}/events?token=bad`)).status,403);
    assert.equal((await fetch(base+`/api/rooms/${host.code}/state?token=bad`)).status,403);
    await post(`/api/rooms/${host.code}/action`,{token:host.token,type:'leave'});
    assert.equal((await guestEvents(s=>s.status==='closed')).status,'closed');
  } finally {
    for(const controller of controllers)controller.abort();
    server.rooms.shutdown();server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
});

test('A full HTTP match, win and mutual rematch use authoritative server state',async()=>{
  let now=1000;
  const server=createGameServer({rooms:new RoomService({now:()=>now})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,controllers=[];
  const post=async(route,data)=>{
    const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    assert(response.ok,await response.clone().text());return response.json();
  };
  try {
    const host=await post('/api/rooms',{name:'Аня'}),guest=await post(`/api/rooms/${host.code}/join`,{name:'Борис'});
    for(const session of [host,guest]) {
      const controller=new AbortController();controllers.push(controller);
      const stream=await fetch(`${base}/api/rooms/${host.code}/events?token=${session.token}`,{signal:controller.signal});
      assert.equal(stream.status,200);
    }
    let {snapshot}=await post(`/api/rooms/${host.code}/action`,{type:'start',token:host.token});
    const firstMatch=snapshot.state.matchId;
    for(let move=0;move<9;move++) {
      const token=move%2?guest.token:host.token;
      const cell=move%2?464+Math.floor(move/2):434+Math.floor(move/2);
      const selected=await post(`/api/rooms/${host.code}/action`,{type:'select',token,cell,turn:snapshot.state.turn,matchId:firstMatch});
      const hero=heroes.find(h=>!selected.snapshot.state.used.includes(h.id)&&matches(h,selected.snapshot.state.question));
      const answered=await post(`/api/rooms/${host.code}/action`,{type:'answer',token,answer:hero.name,turn:selected.snapshot.state.turn,matchId:firstMatch});
      assert.equal(answered.answerStatus,'correct');now+=1000;server.rooms.tick();
      snapshot=await (await fetch(`${base}/api/rooms/${host.code}/state?token=${host.token}`)).json();
    }
    assert.equal(snapshot.state.phase,'finished');assert.equal(snapshot.state.winner,0);assert.equal(snapshot.state.line.length,5);
    const vote=await post(`/api/rooms/${host.code}/action`,{type:'rematch',token:host.token,matchId:firstMatch});
    assert.deepEqual(vote.snapshot.rematchVotes,[true,false]);assert.equal(vote.snapshot.state.phase,'finished');
    const rematch=await post(`/api/rooms/${host.code}/action`,{type:'rematch',token:guest.token,matchId:firstMatch});
    assert.equal(rematch.snapshot.state.phase,'ready');assert.notEqual(rematch.snapshot.state.matchId,firstMatch);
    assert.equal(rematch.snapshot.state.board.filter(Boolean).length,0);assert.equal(rematch.snapshot.state.used.length,0);
  } finally {
    for(const controller of controllers)controller.abort();
    server.rooms.shutdown();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
});
