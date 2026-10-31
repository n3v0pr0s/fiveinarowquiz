import test from 'node:test';
import assert from 'node:assert/strict';

let instance = 0;
async function withFadingMusic(run) {
  const originals = { document: globalThis.document, now: Date.now, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
  let now = 1000, tick = null, music;
  const element = () => ({ addEventListener(type, fn) { this[type] = fn; }, setAttribute() {}, textContent: '', value: '5' });
  const audio = { ...element(), paused: true, currentTime: 0, volume: 0, muted: false, plays: 0, play() { this.plays++;this.paused=false;return Promise.resolve(); }, pause() { this.paused=true; } };
  const toggle=element(),slider=element(),value=element(),status=element();
  const elements={'#music-audio':audio,'#music-toggle':toggle,'#music-volume':slider,'#music-volume-value':value,'#music-status':status};
  globalThis.document={querySelector:selector=>elements[selector]};
  Date.now=()=>now;
  globalThis.setInterval=fn=>{tick=fn;return 1;};
  globalThis.clearInterval=()=>{tick=null;};
  try {
    music=await import(`../dist/music.js?fade-test=${++instance}`);
    await run({ ...music,audio,toggle,slider,value,advance(ms) { now+=ms;tick?.(); } });
  } finally {
    music?.stopMatchMusic();
    globalThis.document=originals.document;Date.now=originals.now;
    globalThis.setInterval=originals.setInterval;globalThis.clearInterval=originals.clearInterval;
  }
}

test('Music stops on match end and volume or mute cannot restart it until the next match', async () => {
  const originalDocument = globalThis.document;
  const element = () => ({ addEventListener(type, fn) { this[type] = fn; }, setAttribute() {}, textContent: '', value: '5' });
  const audio = { ...element(), paused: true, currentTime: 0, volume: 0, muted: false, plays: 0, play() { this.plays++;this.paused=false;return Promise.resolve(); }, pause() { this.paused=true; } };
  const toggle=element(),slider=element(),value=element(),status=element();
  const elements={'#music-audio':audio,'#music-toggle':toggle,'#music-volume':slider,'#music-volume-value':value,'#music-status':status};
  globalThis.document={querySelector:selector=>elements[selector]};
  try {
    const {startMatchMusic,stopMatchMusic}=await import('../dist/music.js');
    assert.equal(audio.volume,0.05);assert.equal(audio.loop,true);assert.equal(audio.paused,true);
    startMatchMusic();assert.equal(audio.paused,false);assert.equal(audio.plays,1);
    audio.currentTime=40;startMatchMusic();assert.equal(audio.currentTime,40);assert.equal(audio.plays,1);
    stopMatchMusic();assert.equal(audio.paused,true);assert.equal(audio.currentTime,0);
    slider.value='12';slider.input();assert.equal(audio.volume,0.12);assert.equal(audio.plays,1);
    toggle.click();toggle.click();assert.equal(audio.paused,true);assert.equal(audio.plays,1);
    startMatchMusic();assert.equal(audio.paused,false);assert.equal(audio.plays,2);
    stopMatchMusic();assert.equal(audio.paused,true);
  } finally { globalThis.document=originalDocument; }
});

test('Victory fades the sound over 1.8 seconds without moving the volume slider',()=>withFadingMusic(({startMatchMusic,fadeOutMatchMusic,audio,slider,value,toggle,advance})=>{
  startMatchMusic();slider.value='12';slider.input();audio.currentTime=40;
  fadeOutMatchMusic();advance(450);
  assert.equal(audio.volume,.09);assert.equal(audio.paused,false);
  assert.equal(slider.value,'12');assert.equal(value.textContent,'12%');
  fadeOutMatchMusic();advance(450);
  assert.equal(audio.volume,.06); // Re-rendering the end screen must not restart the fade.
  slider.value='20';slider.input();assert.equal(audio.volume,.1);
  assert.equal(value.textContent,'20%');assert.equal(audio.plays,1);
  advance(900);
  assert.equal(audio.paused,true);assert.equal(audio.currentTime,0);
  assert.equal(slider.value,'20');assert.equal(value.textContent,'20%');
  toggle.click();toggle.click();assert.equal(audio.plays,1);
  startMatchMusic();assert.equal(audio.volume,.2);assert.equal(audio.plays,2);
}));

test('A rematch during the fade cancels the old fade and starts at the chosen volume',()=>withFadingMusic(({startMatchMusic,fadeOutMatchMusic,audio,slider,advance})=>{
  startMatchMusic();slider.value='10';slider.input();audio.currentTime=50;
  fadeOutMatchMusic();advance(900);assert.equal(audio.volume,.05);
  startMatchMusic();assert.equal(audio.currentTime,0);assert.equal(audio.volume,.1);
  advance(2000);assert.equal(audio.paused,false);assert.equal(audio.volume,.1);
  audio.currentTime=2;startMatchMusic();assert.equal(audio.currentTime,2);assert.equal(audio.plays,2);
}));

test('Mute before starting a game remains muted, including at match end',()=>withFadingMusic(({startMatchMusic,fadeOutMatchMusic,audio,toggle,slider,advance})=>{
  toggle.click();startMatchMusic();assert.equal(audio.paused,true);assert.equal(audio.plays,0);
  fadeOutMatchMusic();advance(2000);assert.equal(slider.value,'5');
  toggle.click();assert.equal(audio.plays,0);
  startMatchMusic();assert.equal(audio.plays,1);assert.equal(audio.volume,.05);
}));

test('Returning to the menu cancels a pending fade and cannot affect a later game',()=>withFadingMusic(({startMatchMusic,stopMatchMusic,fadeOutMatchMusic,audio,advance})=>{
  startMatchMusic();fadeOutMatchMusic();advance(500);stopMatchMusic();
  assert.equal(audio.paused,true);assert.equal(audio.currentTime,0);
  startMatchMusic();advance(2000);assert.equal(audio.paused,false);assert.equal(audio.volume,.05);
}));
