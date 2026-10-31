import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_NAME_KEY, readPlayerName, savePlayerName } from '../dist/player-name.js';

function memory() {
  const data=new Map();
  return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
}

test('Names survive a new visit, edits replace the previous value and clearing removes it',()=>{
  const storage=memory();assert.equal(readPlayerName(storage),'');
  savePlayerName('  Аня  ',storage);assert.equal(readPlayerName(storage),'Аня');
  savePlayerName('Борис',storage);assert.equal(readPlayerName(storage),'Борис');
  savePlayerName('   ',storage);assert.equal(readPlayerName(storage),'');
  assert.equal(storage.data.has(PLAYER_NAME_KEY),false);
});

test('Stored values are bounded, control characters removed and only the name key changes',()=>{
  const storage=memory();storage.data.set('unrelated','keep');
  storage.data.set(PLAYER_NAME_KEY,'\n'+'Я'.repeat(30)+'\x7f');
  assert.equal(readPlayerName(storage),'Я'.repeat(22));
  savePlayerName('Иг\x00рок',storage);assert.equal(readPlayerName(storage),'Игрок');
  assert.deepEqual([...storage.data],[['unrelated','keep'],[PLAYER_NAME_KEY,'Игрок']]);
  storage.data.set(PLAYER_NAME_KEY,{});assert.equal(readPlayerName(storage),'');
});

test('Blocked storage access and quota failures do not interrupt the game',()=>{
  const blocked={getItem(){throw Error('SecurityError');},setItem(){throw Error('QuotaExceededError');},removeItem(){throw Error('SecurityError');}};
  assert.equal(readPlayerName(blocked),'');
  assert.doesNotThrow(()=>savePlayerName('Аня',blocked));
  assert.doesNotThrow(()=>savePlayerName('',blocked));
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('SecurityError');}});
  try {
    assert.equal(readPlayerName(),'');assert.doesNotThrow(()=>savePlayerName('Аня'));
    assert.doesNotThrow(()=>savePlayerName(''));
  } finally {
    if(previous)Object.defineProperty(globalThis,'localStorage',previous);
    else delete globalThis.localStorage;
  }
});
