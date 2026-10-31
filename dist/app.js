import { heroes } from './heroes.js';
import { startMatchMusic, stopMatchMusic, fadeOutMatchMusic } from './music.js';
import { isBotTurn, chooseBotCell, botAnswer } from './bot.js';
import { SIZE, ROLES, ATTRS, COLORS, newGame, normalize } from './engine.js';
import { ANSWER_SECONDS, resultRemaining, openQuestion, changeQuestionCell, answerQuestion, endQuestion, acknowledgeResult } from './turn-flow.js';
import { RoomClient } from './network.js';
import { readPlayerName, savePlayerName } from './player-name.js';
const $ = selector => document.querySelector(selector);
// A match lives only in this page's memory; a reload starts at the menu.
let state = null;
let selected = null;
let errorMessage = '';
let botTimer = null;
let resultTimer = null;
let renderedScreen = null;
let network = null, roomView = null, connection = 'connecting', clockOffset = 0;
let disconnectedClock = null;
let actionBusy = false, menuBusy = false, networkError = '', questionKey = null;
let changingCell = false;
const boardCenter=Math.floor((SIZE-1)/2);
let boardFocusIndex = boardCenter*(SIZE+1);
let centeredBoard = null;
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const playerName = () => state.settings.names[state.player];
const symbol = player => player === 0 ? '×' : '○';
const gameNow = () => network && roomView?.pausedAt != null ? roomView.pausedAt : network&&disconnectedClock!==null?disconnectedClock:Date.now() + (network ? clockOffset : 0);
const enteredPlayerName = () => {
  const name=$('#input-0').value.trim();savePlayerName(name);return name||'Игрок';
};
const canMove = () => Boolean((state?.phase==='ready'||(state?.phase==='quiz'&&changingCell))&&!state.result&&!isBotTurn(state)&&!actionBusy&&(!network||(connection==='connected'&&roomView?.pausedAt===null&&state.player===roomView.you)));
function applyRoom(snapshot) {
  const previous=state;
  roomView=snapshot;clockOffset=snapshot.serverNow-Date.now();networkError='';
  const next=snapshot.status==='active'?snapshot.state:null;
  if(next&&previous?.matchId===next.matchId) {
    next.board.forEach((mark,i)=>previous.board[i]=mark);next.board=previous.board;
  }
  state=next;
  if(state&&state.matchId!==previous?.matchId&&state.phase!=='finished') startMatchMusic();
  render();
  if(previous?.result&&!state?.result&&canMove()) requestAnimationFrame(()=>$(`[data-cell="${boardFocusIndex}"]`)?.focus({preventScroll:true}));
}
async function enterRoom(type) {
  if(menuBusy)return;
  const code=$('#room-code').value.trim().toUpperCase();
  if(type==='join'&&!/^[A-Z2-9]{6}$/.test(code)) { $('#menu-error').textContent='Введите код из 6 символов.';return; }
  menuBusy=true;$('#menu-error').textContent='';renderNetwork();
  const client=new RoomClient({onState:snapshot=>{if(network===client)applyRoom(snapshot);},onConnection:status=>{if(network===client){if(status!=='connected'&&disconnectedClock===null)disconnectedClock=Date.now()+clockOffset;if(status==='connected')disconnectedClock=null;connection=status;render();}}});
  try {
    const snapshot=await client.enter(type,enteredPlayerName(),code);
    network=client;connection='connecting';disconnectedClock=null;client.receive(snapshot);client.connect();
  } catch(error) { $('#menu-error').textContent=error.name==='TimeoutError'?'Сервер не отвечает. Попробуйте ещё раз.':error.message; }
  finally {menuBusy=false;renderNetwork();}
}
async function networkAction(type,fields={}) {
  if(!network||actionBusy||connection!=='connected')return;
  const client=network;actionBusy=true;networkError='';render();
  try {
    const response=await client.act(type,{matchId:state?.matchId,turn:state?.turn,...fields});
    if(network!==client)return;
    if(response.answerStatus==='unknown'&&$('#input-error')) $('#input-error').textContent='Выберите героя из списка или проверьте имя.';
  } catch(error) {if(network===client){networkError=error.message;if(type==='start'&&!state)stopMatchMusic();}}
  finally {if(network===client){actionBusy=false;if(type==='retarget')changingCell=false;render();}}
}
function renderNetwork() {
  for(const el of document.querySelectorAll('#setup-form input,#setup-form button')) el.disabled=menuBusy;
  const status=$('#connection-status');
  const message=network&&roomView?.status!=='closed'?(connection!=='connected'?'Соединение потеряно. Переподключаемся…':roomView?.pausedAt!==null?'Соперник отключился. Ждём возвращения…':networkError):'';
  status.textContent=message||'';status.classList.toggle('hidden',!message);
  $('#current-room').classList.toggle('hidden',!network);$('#current-room').textContent=network?roomView?.code||'':'';
  for(const el of document.querySelectorAll('#answer-form button,#skip-button,#change-cell')) el.disabled=Boolean(network&&(actionBusy||connection!=='connected'||roomView?.pausedAt!==null));
  if(!network||!roomView)return;
  $('#lobby-code').textContent=roomView.code;
  $('#lobby-players').innerHTML=roomView.players.map((p,i)=>`<div class="lobby-player"><span class="symbol ${i===0?'x':'o'}">${symbol(i)}</span><strong>${p?escape(p.name):'Ждём друга'}</strong><small>${p?(i===roomView.you?'Вы':p.connected?'Подключён':'Не в сети'):''}</small></div>`).join('');
  const invite=new URL(location.href);invite.search='';invite.hash='';invite.searchParams.set('room',roomView.code);$('#invite-link').value=invite.href;
  $('#local-room-note').classList.toggle('hidden',!['localhost','127.0.0.1','[::1]'].includes(location.hostname));
  const closed=roomView.status==='closed',ready=roomView.players.every(p=>p?.connected)&&connection==='connected';
  $('#start-room').classList.toggle('hidden',closed||roomView.you!==0);
  $('#start-room').disabled=!ready||actionBusy;
  $('#copy-invite').disabled=closed;
  $('#room-status').textContent=closed?roomView.reason:connection!=='connected'?'Подключаемся…':!roomView.players[1]?'Ожидаем друга':!ready?'Ожидаем подключения игроков':roomView.you===0?'Друг подключился. Можно начинать.':'Создатель комнаты начинает игру.';
  $('#room-error').textContent=networkError;
}
function expire() {
  if(network)return;
  if(state?.result && resultRemaining(state)===0) { continueAfterResult(); return; }
  if(state?.phase === 'quiz' && Date.now() >= state.deadline) { endQuestion(state, heroes, 'timeout');  render(); }
}
function renderBoard() {
  const playing = canMove();
  $('#cell-choice').classList.toggle('hidden',!changingCell);
  const board = $('#board');
  if(state&&centeredBoard!==state.board) boardFocusIndex=boardCenter*(SIZE+1);
  if(playing&&state.board[boardFocusIndex]) {
    const distance=index=>Math.abs(Math.floor(index/SIZE)-boardCenter)+Math.abs(index%SIZE-boardCenter);
    boardFocusIndex=state.board.reduce((best,value,index)=>!value&&(best===-1||distance(index)<distance(best))?index:best,-1);
  }
  board.style.setProperty('--board-size',SIZE);
  board.classList.toggle('can-place',playing);
  board.classList.toggle('is-o',state?.player===1);
  board.innerHTML = Array.from({length:SIZE*SIZE},(_,i)=>{
    const value = state?.board[i];
    const near=Math.floor(SIZE/4),far=SIZE-1-near;
    const star = [near*SIZE+near,near*SIZE+far,boardCenter*(SIZE+1),far*SIZE+near,far*SIZE+far].includes(i);
    return `<button type="button" class="cell ${value==='X'?'mark-x':value==='O'?'mark-o':''} ${state?.line.includes(i)?'win':''} ${state?.lastCell===i?'last':''} ${state?.pendingCell===i?'pending':''} ${star?'star':''}" data-cell="${i}" tabindex="${playing&&!value&&i===boardFocusIndex?0:-1}" aria-label="Строка ${Math.floor(i/SIZE)+1}, столбец ${i%SIZE+1}${value?`, ${value==='X'?'крестик':'нолик'}`:''}" ${!playing||value?'disabled':''}>${value==='X'?'×':value==='O'?'○':state?.pendingCell===i?'?':''}</button>`;
  }).join('');
  $('#board-overlay').classList.toggle('hidden',Boolean(state));
  if(state&&centeredBoard!==state.board) {
    centeredBoard=state.board;
    requestAnimationFrame(()=>{const shell=$('.board-shell');shell.scrollLeft=(shell.scrollWidth-shell.clientWidth)/2;shell.scrollTop=(shell.scrollHeight-shell.clientHeight)/2;});
  }
  for(let i=0;i<2;i++) {
    $(`#name-${i}`).textContent = state?state.settings.names[i]+(network&&roomView.you===i?' (вы)':''):`Игрок ${i+1}`;
    $(`#player-${i}`).classList.toggle('active',Boolean(state && state.player===i && state.phase!=='finished'));
  }
  $('#board-status').textContent = !state ? 'Ожидание игры' : state.phase==='finished' ? 'Партия завершена' : state.phase==='quiz' ? `Клетка ${Math.floor(state.pendingCell/SIZE)+1}:${state.pendingCell%SIZE+1} · ход ${state.turn}` : `Ход ${state.turn}`;
  $('#play-hint').textContent = !state?'':state.result?'':state.phase==='quiz'?(changingCell?'Выберите другую клетку':`${playerName()} отвечает…`):network?(state.player===roomView.you?'Ваш ход':`${playerName()} выбирает клетку`):isBotTurn(state)?'Бот выбирает клетку…':'Выберите клетку';
}
function renderGamePanel() {
  let panel = $('#game-panel');
  if(!state) {questionKey=null;return;}
  if(state.phase!=='quiz')questionKey=null;
  const player = `<div class="current-player"><span class="symbol ${state.player===0?'x':'o'}">${symbol(state.player)}</span><strong>${escape(playerName())}</strong><span class="turn-number">Ход ${state.turn}</span></div>`;
  const newButton = `<button class="button quiet new-game" id="new-game">В меню</button>`;
  if(state.phase==='ready') {
    panel.innerHTML = '';
  } else if(state.phase==='quiz') {
    if(network&&state.player!==roomView.you) {questionKey=null;return;}
    const key=`${state.matchId||'local'}:${state.turn}`;
    if(questionKey===key&&$('#answer-form')) {updateTimer();return;}
    questionKey=key;
    panel = $('#quiz-content');
    panel.innerHTML = player+`<div class="quiz-heading"><h2 id="quiz-title">Назовите героя</h2><div class="timer" id="timer" role="timer" aria-live="off" aria-label="Осталось секунд"><strong id="seconds">${Math.max(0,Math.ceil((state.deadline-Date.now())/1000))}</strong><small>с</small></div></div><div class="timer-track"><div id="timer-bar"></div></div><div class="traits">${state.question.traits.map(t=>`<div class="trait"><span class="trait-icon ${t.kind==='color'?'swatch '+t.value:''}">${t.kind==='attr'?'✦':t.kind==='role'?'⚑':''}</span><div><small>${t.kind==='role'?'Роль':t.kind==='attr'?'Атрибут':'Цвет'}</small><strong>${escape((t.kind==='role'?ROLES:t.kind==='attr'?ATTRS:COLORS)[t.value])}</strong></div></div>`).join('<span class="trait-plus">+</span>')}</div><form id="answer-form" autocomplete="off"><label class="answer-label" for="hero-input">Герой</label><div class="search-wrap"><input id="hero-input" placeholder="Имя героя" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="hero-results"><button id="hero-list-toggle" class="list-toggle" type="button" aria-label="Показать список героев">⌄</button><div class="hero-results hidden" id="hero-results" role="listbox" aria-label="Герои Dota 2"></div></div><p class="input-error" id="input-error" role="alert"></p><button type="submit" class="button primary full">Ответить</button></form><div class="quiz-secondary-actions"><button class="button quiet" type="button" id="change-cell">Сменить клетку</button><button class="button quiet skip-button" type="button" id="skip-button">Пропустить ход</button></div>`;
    if (isBotTurn(state)) {
      $('#answer-form').outerHTML = '<div class="bot-thinking" role="status"><span class="bot-pulse" aria-hidden="true">· · ·</span><strong>Бот отвечает…</strong></div>';
      $('.quiz-secondary-actions').remove();
      updateTimer();
    } else {
    if(state.question.notice) {
      const notice=document.createElement('p');notice.className='feedback success';notice.textContent=state.question.notice;
      panel.insertBefore(notice,panel.querySelector('.quiz-heading'));
    }
    const input=$('#hero-input');
    input.addEventListener('input',()=>{selected=null; errorMessage=''; $('#input-error').textContent=''; renderResults();});
    input.addEventListener('focus',()=>{if(normalize(input.value)) renderResults();});
    $('#hero-list-toggle').addEventListener('click',()=>{if($('#hero-results').classList.contains('hidden'))renderResults(true);else closeResults();});
    input.addEventListener('keydown',event=>{
      const options=[...document.querySelectorAll('[data-hero]')];
      if(event.key==='ArrowDown'||event.key==='ArrowUp') {event.preventDefault();if(!options.length||$('#hero-results').classList.contains('hidden')){renderResults(true);return;}const index=options.findIndex(el=>el.dataset.hero===String(selected)); const next=event.key==='ArrowDown'?(index+1)%options.length:(index<=0?options.length-1:index-1); selected=Number(options[next].dataset.hero);options.forEach((el,i)=>{el.classList.toggle('highlighted',i===next);el.setAttribute('aria-selected',i===next);});input.setAttribute('aria-activedescendant',options[next].id);options[next].scrollIntoView({block:'nearest'});}
      if(event.key==='Enter'&&selected!==null&&!$('#hero-results').classList.contains('hidden')) {event.preventDefault();chooseHero(selected);}
    });
    updateTimer(); requestAnimationFrame(()=>input.focus({preventScroll:true}));
    }
  } else {
    const won=Number.isInteger(state.winner);
    panel.innerHTML=`<div class="finish-icon" aria-hidden="true">${won?symbol(state.winner):'＝'}</div><h2 class="finish-title">${won?`${escape(state.settings.names[state.winner])} побеждает`:'Ничья'}</h2>${won?'':`<p class="muted">${state.winner==='exhausted'?'Все герои использованы.':'Поле заполнено.'}</p>`}<div class="match-stats"><div><strong>${state.board.filter(Boolean).length}</strong><span>ходов</span></div><div><strong>${state.used.length}</strong><span>героев</span></div></div><button class="button primary full" id="rematch">Сыграть ещё</button>`+newButton;
  }
  $('#answer-form')?.addEventListener('submit',event=>{event.preventDefault();startMatchMusic();if(network){void networkAction('answer',{answer:$('#hero-input').value});return;}const result=answerQuestion(state,heroes,$('#hero-input').value);if(result.status==='unknown'){errorMessage='Выберите героя из списка или проверьте имя.';$('#input-error').textContent=errorMessage;return;}render();});
  $('#skip-button')?.addEventListener('click',()=>{startMatchMusic();if(network){void networkAction('skip');return;}endQuestion(state,heroes,'skip');render();});
  $('#change-cell')?.addEventListener('click',chooseDifferentCell);
  $('#new-game')?.addEventListener('click',returnToMenu);
  if(network&&$('#rematch')) {$('#rematch').disabled=roomView.rematchVotes[roomView.you]||actionBusy||connection!=='connected'||roomView.pausedAt!==null;$('#rematch').textContent=roomView.rematchVotes[roomView.you]?'Ждём соперника…':'Сыграть ещё';}
  $('#rematch')?.addEventListener('click',()=>{if(network){void networkAction('rematch');return;}state=newGame(state.settings);startMatchMusic();render();});
}
function continueAfterResult() {
  if(network)return;
  if(!acknowledgeResult(state)) return;
  render();
  requestAnimationFrame(()=>{
    const target=state.phase==='finished'?$('#rematch'):!isBotTurn(state)?$(`[data-cell="${boardFocusIndex}"]`):null;
    target?.focus({preventScroll:true});
  });
}
function renderQuizDialog() {
  clearTimeout(resultTimer);resultTimer=null;
  const dialog=$('#quiz-dialog');
  if(changingCell) {if(dialog.open)dialog.close();return;}
  if(!state || (!state.result&&(state.phase!=='quiz'||(network&&state.player!==roomView.you)))) {
    if(dialog.open) dialog.close();
    $('#quiz-content').innerHTML='';
    return;
  }
  dialog.classList.toggle('showing-result',Boolean(state.result));
  if(state.result) {
    const result=state.result,correct=result.status==='correct';
    const titles={correct:'Верно!',wrong:'Неверно',repeated:'Герой уже использован',timeout:'Время вышло',skip:'Ход пропущен'};
    const finished=state.phase==='finished';
    const traits=result.traits.map(t=>escape((t.kind==='role'?ROLES:t.kind==='attr'?ATTRS:COLORS)[t.value])).join(' + ');
    const explanation=correct?`${escape(result.answer)} подходит по обоим признакам.`:escape(result.feedback.text);
    const next=finished?'Партия завершена':`Следующий ход: ${escape(playerName())}`;
    $('#quiz-content').innerHTML=`<div class="result-view ${correct?'is-correct':'is-incorrect'}"><div class="current-player"><span class="symbol ${result.player===0?'x':'o'}">${symbol(result.player)}</span><strong>${escape(state.settings.names[result.player])}</strong><span class="turn-number">Ход ${result.turn}</span></div><div class="result-icon" aria-hidden="true">${correct?'✓':result.status==='timeout'?'◷':result.status==='skip'?'→':'×'}</div><h2 id="quiz-title" tabindex="-1">${titles[result.status]||'Ход завершён'}</h2><p class="result-traits">${traits}</p><p class="result-explanation">${explanation}</p>${!correct&&result.feedback.example?`<p class="result-example">Подходящий герой: <strong>${escape(result.feedback.example)}</strong></p>`:''}<div class="result-consequence"><strong>${correct?`Символ ${symbol(result.player)} поставлен`:'Клетка осталась пустой'}</strong><span>${next}</span></div><div class="result-progress" aria-hidden="true"><span></span></div></div>`;
    const current=state;
    if(!network)resultTimer=setTimeout(()=>{if(state===current&&state.result===result) continueAfterResult();},resultRemaining(state));
    requestAnimationFrame(()=>$('#quiz-title')?.focus({preventScroll:true}));
  }
  if(!dialog.open) {
    dialog.showModal();
    if(!state.result&&!isBotTurn(state))requestAnimationFrame(()=>$('#hero-input')?.focus({preventScroll:true}));
  }
}
$('#resume-question').addEventListener('click',()=>{changingCell=false;render();});
function chooseDifferentCell() {
  if(changingCell||state?.phase!=='quiz'||state.result||isBotTurn(state)||(network&&state.player!==roomView.you))return;
  changingCell=true;closeResults();boardFocusIndex=state.pendingCell;render();
  requestAnimationFrame(()=>$(`[data-cell="${boardFocusIndex}"]`)?.focus({preventScroll:true}));
}
function dismissQuiz() {
  const results=$('#hero-results');
  if(results&&!results.classList.contains('hidden')){closeResults();return;}
  chooseDifferentCell();
}
$('#quiz-dialog').addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  event.preventDefault();event.stopPropagation();
  if(!event.repeat)dismissQuiz();
});
$('#quiz-dialog').addEventListener('cancel',event=>{
  event.preventDefault();
  dismissQuiz();
});
$('#quiz-dialog').addEventListener('close',()=>{
  if(!$('#quiz-dialog').open)chooseDifferentCell();
});
function chooseHero(id) { const h=heroes.find(h=>h.id===id);if(h){$('#hero-input').value=h.name;selected=null;$('#hero-input').focus();closeResults();} }
function closeResults() { $('#hero-results')?.classList.add('hidden');$('#hero-input')?.setAttribute('aria-expanded','false');$('#hero-input')?.removeAttribute('aria-activedescendant'); }
function renderResults(showAll=false) {
  const input=$('#hero-input');if(!input)return;
  const query=normalize(input.value);
  if(!query&&!showAll){closeResults();return;}
  selected=null;
  const filtered=heroes.filter(h=>!state.used.includes(h.id)&&[h.name,...h.aliases].some(a=>normalize(a).includes(query)));
  if(!showAll&&filtered.some(h=>[h.name,...h.aliases].some(a=>normalize(a)===query))){closeResults();return;}
  const found=showAll?filtered:filtered.slice(0,12);
  const box=$('#hero-results');box.innerHTML=found.length?found.map(h=>`<button type="button" role="option" tabindex="-1" aria-selected="false" id="hero-${h.id}" data-hero="${h.id}"><span>${escape(h.name)}</span></button>`).join(''):'<p class="no-results">Нет доступных героев с таким именем</p>';
  box.classList.remove('hidden');input.setAttribute('aria-expanded','true');
  box.querySelectorAll('[data-hero]').forEach(button=>button.addEventListener('click',()=>chooseHero(Number(button.dataset.hero))));
}
function renderDetails() {
  $('#match-details').classList.toggle('hidden',!state);$('#bans-desktop').classList.toggle('hidden',!state);if(!state)return;
  const count=`${state.used.length} / ${heroes.length}`;
  $('#used-count').textContent=count;$('#used-count-desktop').textContent=count;
  const names=state.used.map(id=>heroes.find(h=>h.id===id)?.name||'Герой').sort((a,b)=>a.localeCompare(b));
  const banned=names.length?names.map(name=>`<span class="used-hero">${escape(name)}</span>`).join(''):'<span class="empty-note">Пока пусто</span>';
  $('#used-heroes').innerHTML=banned;$('#used-heroes-desktop').innerHTML=banned;
  const labels={timeout:'время вышло',wrong:'неверный ответ',repeated:'повтор героя',skip:'пропуск хода'};
  $('#history').innerHTML=state.log.length?state.log.slice(0,20).map(e=>`<li><span class="history-symbol ${e.player===0?'x':'o'}">${symbol(e.player)}</span><span><strong>${escape(state.settings.names[e.player])}</strong><small>${e.type==='correct'?escape(e.hero)+' · верный ответ':labels[e.type]||'ход завершён'}</small></span><span class="history-turn">#${e.turn}</span></li>`).join(''):'<li class="empty-note">История начнётся с первого ответа</li>';
}
function updateTimer() {
  if(state?.phase!=='quiz')return;
  const left=Math.max(0,state.deadline-gameNow());
  $('#cell-choice-time').textContent=`${Math.ceil(left/1000)} с`;
  $('#cell-choice').classList.toggle('urgent',left<=5000);
  if(network&&state.player!==roomView.you)$('#play-hint').textContent=`${playerName()} отвечает · ${Math.ceil(left/1000)} с`;
  const seconds=$('#seconds');if(!seconds)return;
  seconds.textContent=Math.ceil(left/1000);$('#timer').classList.toggle('urgent',left<=5000);$('#timer-bar').style.width=`${Math.min(100,left/(state.settings.seconds*1000)*100)}%`;
}
function scheduleBot() {
  clearTimeout(botTimer); botTimer = null;
  if (network || !isBotTurn(state) || state.result) return;
  const current = state, turn = state.turn, phase = state.phase;
  botTimer = setTimeout(() => {
    if (state !== current || state.turn !== turn || state.phase !== phase || !isBotTurn(state) || state.result) return;
    if (phase === 'ready') {
      const index = chooseBotCell(state.board);
      if (index === null) { state.phase = 'finished'; state.winner = 'draw'; }
      else openQuestion(state, heroes, index);
    } else {
      const answer = botAnswer(state, heroes);
      if (answer) answerQuestion(state, heroes, answer);
      else endQuestion(state, heroes, 'skip');
    }
     render();
  }, phase === 'ready' ? 650 : 1100);
}
function render() {
  const phase=state?.phase||'setup';
  if(phase!=='quiz'||state.result||isBotTurn(state)||(network&&state.player!==roomView.you))changingCell=false;
  const screen=network&&roomView?.status!=='active'?'room':!state?'menu':phase==='finished'&&!state.result?'finish':'play';
  if(phase==='finished') fadeOutMatchMusic();
  else if(phase==='setup') stopMatchMusic();
  document.body.dataset.phase=phase;document.body.dataset.bot=String(isBotTurn(state));
  document.body.dataset.screen=screen;
  for(const name of ['menu','room','play','finish']) $(`#${name}-screen`).classList.toggle('hidden',name!==screen);
  renderBoard();renderGamePanel();renderQuizDialog();renderDetails();renderNetwork();scheduleBot();
  if(screen!==renderedScreen) {
    window.scrollTo({top:0,behavior:'instant'});
    requestAnimationFrame(()=>{
      const target=screen==='menu'?$('#menu-title'):screen==='room'?$('#room-screen h1'):screen==='finish'?$('#rematch'):canMove()?$(`[data-cell="${boardFocusIndex}"]`):null;
      target?.focus({preventScroll:true});
    });
  }
  renderedScreen=screen;
}
$('#board').addEventListener('focusin',event=>{
  const cell=event.target.closest('[data-cell]');if(!cell||cell.disabled)return;
  boardFocusIndex=Number(cell.dataset.cell);
  document.querySelectorAll('[data-cell][tabindex="0"]').forEach(el=>el.tabIndex=-1);cell.tabIndex=0;
});
$('#board').addEventListener('keydown',event=>{
  const cell=event.target.closest('[data-cell]');if(!cell||!canMove())return;
  if(event.key==='Escape'&&event.repeat){event.preventDefault();return;}
  if(changingCell&&event.key==='Escape'){event.preventDefault();changingCell=false;render();return;}
  const direction={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[event.key];
  if(!direction)return;event.preventDefault();
  let row=Math.floor(Number(cell.dataset.cell)/SIZE)+direction[0],col=Number(cell.dataset.cell)%SIZE+direction[1];
  while(row>=0&&row<SIZE&&col>=0&&col<SIZE){
    const target=$(`[data-cell="${row*SIZE+col}"]`);if(!target.disabled){target.focus({preventScroll:true});break;}
    row+=direction[0];col+=direction[1];
  }
});
$('#board').addEventListener('click',event=>{
  const cell=event.target.closest('[data-cell]');if(!cell||!canMove())return;
  startMatchMusic();
  if(changingCell) {
    if(network){void networkAction('retarget',{cell:Number(cell.dataset.cell)});return;}
    changeQuestionCell(state,heroes,Number(cell.dataset.cell));changingCell=false;render();return;
  }
  if(network){void networkAction('select',{cell:Number(cell.dataset.cell)});return;}
  if(openQuestion(state,heroes,Number(cell.dataset.cell)))render();
});
$('#setup-form').addEventListener('submit',event=>{
  event.preventDefault();
  if(new FormData(event.target).get('mode')!=='bot'){void enterRoom(invitedRoomCode()?'join':'create');return;}
  state=newGame({names:[enteredPlayerName(),'Бот'],mode:'bot',seconds:ANSWER_SECONDS,heroCount:heroes.length,theme:'dota'});
  startMatchMusic();
  render();
});
function invitedRoomCode() {
  const code=new URLSearchParams(location.search).get('room');
  return code&&/^[A-Z2-9]{6}$/i.test(code)?code.toUpperCase():null;
}
function updateMode() {
  const bot = $('[name="mode"]:checked').value === 'bot';
  const joining = !bot&&Boolean(invitedRoomCode());
  $('#network-options').classList.toggle('hidden',bot);
  $('#start-button').classList.toggle('hidden',joining);
  $('#start-button').textContent=bot?'Начать игру':'Создать комнату';
  $('#network-options>label').textContent=joining?'Код комнаты':'Или войдите по коду';
  $('#join-room').textContent=joining?'Подключиться':'Войти';
  $('#join-room').classList.toggle('primary',joining);
  $('#join-room').classList.toggle('quiet',!joining);
  $('#menu-error').textContent='';
}
document.querySelectorAll('[name="mode"]').forEach(radio=>radio.addEventListener('change',updateMode));
$('#rules-button').addEventListener('click',()=>$('#rules-dialog').showModal());
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$('#rules-dialog').close()));
$('[data-cancel]').addEventListener('click',()=>$('#reset-dialog').close());
function returnToMenu() {
  if(state){
    $('#input-0').value=state.settings.names[network?roomView.you:0];
    $(`[name="mode"][value="${state.settings.mode==='bot'?'bot':'network'}"]`).checked=true;
  }
  const previous=network;network=null;roomView=null;actionBusy=false;networkError='';questionKey=null;disconnectedClock=null;
  previous?.leave();state=null;$('#reset-dialog').close();history.replaceState(null,'',location.pathname);updateMode();render();
}
$('#confirm-reset').addEventListener('click',returnToMenu);
function requestMenu() {
  if(!state||state.phase==='finished'){returnToMenu();return;}
  $('#reset-dialog .muted').textContent=network?'Выход завершит партию для обоих игроков.':'Текущая партия будет завершена.';
  $('#reset-dialog').showModal();
}
$('#menu-button').addEventListener('click',requestMenu);
$('.brand').addEventListener('click',event=>{event.preventDefault();if(state||network)requestMenu();});
$('#leave-room').addEventListener('click',returnToMenu);
$('#join-room').addEventListener('click',()=>void enterRoom('join'));
$('#start-room').addEventListener('click',()=>{startMatchMusic();void networkAction('start');});
$('#room-code').addEventListener('input',event=>{event.target.value=event.target.value.toUpperCase().replace(/[^A-Z2-9]/g,'');});
$('#room-code').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void enterRoom('join');}});
$('#copy-invite').addEventListener('click',async()=>{
  try {await navigator.clipboard.writeText($('#invite-link').value);$('#room-status').textContent='Ссылка скопирована';}
  catch {$('#invite-link').focus();$('#invite-link').select();$('#room-status').textContent='Скопируйте выделенную ссылку';}
});
document.addEventListener('click',event=>{if(!event.target.closest('.search-wrap'))closeResults();});
document.addEventListener('visibilitychange',()=>{expire();updateTimer();});
window.addEventListener('pageshow',event=>{if(event.persisted&&network)returnToMenu();else expire();});
window.addEventListener('pagehide',()=>network?.leave());
setInterval(()=>{expire();updateTimer();},100);
const invitedRoom=invitedRoomCode();
if(invitedRoom)$('#room-code').value=invitedRoom;
$('#input-0').value=readPlayerName();
for(const event of ['input','change'])$('#input-0').addEventListener(event,()=>savePlayerName($('#input-0').value));
updateMode();render();
