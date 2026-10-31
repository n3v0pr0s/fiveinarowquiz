import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomClient } from '../dist/network.js';

test('A stale HTTP snapshot cannot undo a newer stream update, and closed rooms stop retrying',()=>{
  const original=globalThis.EventSource,received=[];
  class Events { constructor(url){this.url=url;this.closed=false;}close(){this.closed=true;} }
  globalThis.EventSource=Events;
  try {
    const client=new RoomClient({onState:s=>received.push(s),onConnection:()=>{}});
    client.session={code:'ABCDEF',token:'private'};client.connect();const stream=client.events;
    stream.onmessage({data:JSON.stringify({revision:2,status:'active'})});
    client.receive({revision:1,status:'waiting'});client.receive({revision:2,status:'active'});
    assert.equal(received.length,1);assert.equal(received[0].status,'active');
    stream.onmessage({data:JSON.stringify({revision:3,status:'closed'})});
    assert.equal(stream.closed,true);assert.equal(client.events,null);
  } finally {globalThis.EventSource=original;}
});

test('Restarted or expired server rooms become a closed room instead of an endless reconnect',async()=>{
  const originals={events:globalThis.EventSource,fetch:globalThis.fetch},received=[];
  class Events {close(){this.closed=true;}}
  globalThis.EventSource=Events;
  globalThis.fetch=async()=>({status:404,json:async()=>({error:'Комната не найдена.'})});
  try {
    const client=new RoomClient({onState:s=>received.push(s),onConnection:()=>{}});
    client.session={code:'ABCDEF',token:'private'};client.receive({revision:5,status:'active',code:'ABCDEF'});client.connect();
    await client.events.onerror();
    assert.equal(received.at(-1).status,'closed');assert.equal(received.at(-1).reason,'Комната не найдена.');assert.equal(client.events,null);
  } finally {globalThis.EventSource=originals.events;globalThis.fetch=originals.fetch;}
});
