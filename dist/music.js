const audio = document.querySelector('#music-audio');
const toggle = document.querySelector('#music-toggle');
const slider = document.querySelector('#music-volume');
const value = document.querySelector('#music-volume-value');
const status = document.querySelector('#music-status');
let started = false;
let muted = false;
let lastVolume = 5;
let playRequest = 0;
let userVolume = 0.05;
let fadeGain = 1;
let fadeTimer = null;

function applyVolume() {
  audio.volume = userVolume * fadeGain;
  audio.muted = muted;
}
applyVolume();
audio.loop = true;

function render() {
  const silent = muted || userVolume === 0;
  const label = silent ? 'Включить звук' : 'Выключить звук';
  toggle.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/>${silent?'<path d="m16 9 5 6m0-6-5 6"/>':'<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'}</svg>`;
  toggle.setAttribute('aria-label',label);
  toggle.title=label;
  toggle.setAttribute('aria-pressed', String(silent));
  slider.value = String(Math.round(userVolume * 100));
  value.textContent = `${slider.value}%`;
  slider.setAttribute('aria-valuetext', `${slider.value}%`);
  status.textContent = '';
}

async function play() {
  const request = ++playRequest;
  if (!started || muted || userVolume === 0) return;
  try { await audio.play(); }
  catch {
    if (request !== playRequest || muted || userVolume === 0) return;
    muted = true;
    applyVolume();
    render();
    status.textContent = 'Нажмите кнопку звука, чтобы запустить музыку';
  }
}

// Called directly from Start / Rematch to preserve the browser's user gesture.
export function startMatchMusic() {
  if (started) return;
  clearInterval(fadeTimer);fadeTimer = null;
  fadeGain = 1;
  audio.currentTime = 0;
  started = true;
  applyVolume();
  render();
  void play();
}

export function stopMatchMusic() {
  clearInterval(fadeTimer);fadeTimer = null;
  playRequest++;
  started = false;
  audio.pause();
  audio.currentTime = 0;
  fadeGain = 1;
  applyVolume();
  render();
}

export function fadeOutMatchMusic(duration = 1800) {
  if (!started) return;
  started = false;
  playRequest++;
  if (audio.paused || muted || userVolume === 0 || duration <= 0) { stopMatchMusic();return; }
  const began = Date.now();
  // This envelope changes the actual sound, never the player's volume setting.
  fadeTimer = setInterval(() => {
    fadeGain = Math.max(0, 1 - (Date.now() - began) / duration);
    applyVolume();
    if (fadeGain === 0) stopMatchMusic();
  }, 40);
}

toggle.addEventListener('click', () => {
  playRequest++;
  if (muted || userVolume === 0) {
    muted = false;
    if (userVolume === 0) userVolume = lastVolume / 100;
    applyVolume();
    render();
    void play();
  } else {
    muted = true;
    applyVolume();
    audio.pause();
    render();
  }
});

slider.addEventListener('input', () => {
  playRequest++;
  userVolume = Number(slider.value) / 100;
  if (userVolume > 0) lastVolume = Number(slider.value);
  muted = userVolume === 0;
  applyVolume();
  if (muted) audio.pause();
  render();
  if (started && !muted && audio.paused) void play();
});

audio.addEventListener('error', () => {
  status.textContent = 'Музыка недоступна. Игра продолжается без звука.';
});
render();
