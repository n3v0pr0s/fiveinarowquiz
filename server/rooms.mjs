import { randomBytes, randomInt } from 'node:crypto';
import { heroes as defaultHeroes } from '../dist/heroes.js';
import { newGame } from '../dist/engine.js';
import { ANSWER_SECONDS, openQuestion, answerQuestion, endQuestion, acknowledgeResult } from '../dist/turn-flow.js';

export class RoomError extends Error {
  constructor(status, message) { super(message);this.status = status; }
}
const fail = (status, message) => { throw new RoomError(status, message); };
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const cleanName = name => {
  if (typeof name !== 'string' || name.trim().length > 22 || /[\x00-\x1f\x7f]/.test(name)) fail(400, 'Введите имя длиной до 22 символов.');
  return name.trim() || 'Игрок';
};

export class RoomService {
  constructor({ now = Date.now, heroes = defaultHeroes, random = Math.random, disconnectMs = 30000, maxRooms = 500 } = {}) {
    this.now = now;this.heroes = heroes;this.random = random;this.disconnectMs = disconnectMs;this.maxRooms = maxRooms;
    this.rooms = new Map();
  }
  create(name) {
    name = cleanName(name);this.tick();
    if (this.rooms.size >= this.maxRooms) fail(503, 'Сейчас слишком много комнат. Попробуйте позже.');
    let code;
    do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (this.rooms.has(code));
    const player = this.makePlayer(name);
    const room = { code, players: [player, null], status: 'waiting', state: null, revision: 0, createdAt: this.now(), pausedAt: null, votes: [false, false], listeners: new Map() };
    this.rooms.set(code, room);
    return { code, token: player.token, player: 0, snapshot: this.view(room, 0) };
  }
  makePlayer(name) { return { name, token: randomBytes(24).toString('hex'), connected: false, disconnectedAt: this.now() }; }
  room(code) {
    if (typeof code !== 'string' || !/^[A-Z2-9]{6}$/.test(code)) fail(404, 'Комната не найдена. Проверьте код.');
    const room = this.rooms.get(code);
    if (!room) fail(404, 'Комната не найдена или уже истекла.');
    if (room.status === 'closed') fail(410, room.reason);
    return room;
  }
  authenticate(code, token) {
    const room = this.room(code);
    const player = typeof token === 'string' ? room.players.findIndex(p => p?.token === token) : -1;
    if (player < 0) fail(403, 'Нет доступа к этой комнате.');
    return { room, player };
  }
  join(code, name) {
    name = cleanName(name);
    const room = this.room(code);
    if (room.players[1] || room.status !== 'waiting') fail(409, 'В комнате уже есть два игрока.');
    room.players[1] = this.makePlayer(name);this.broadcast(room);
    return { code, token: room.players[1].token, player: 1, snapshot: this.view(room, 1) };
  }
  view(room, player) {
    return { code: room.code, you: player, status: room.status, reason: room.reason || null, revision: room.revision, serverNow: this.now(), pausedAt: room.pausedAt,
      players: room.players.map(p => p ? { name: p.name, connected: p.connected } : null), rematchVotes: [...room.votes], state: room.state ? structuredClone(room.state) : null };
  }
  broadcast(room) {
    room.revision++;
    for (const [player, listener] of room.listeners) {
      try { listener.send(this.view(room, player)); } catch { listener.close(); }
    }
  }
  connect(code, token, send, close = () => {}) {
    const { room, player } = this.authenticate(code, token);
    const listener = { send, close }, previous = room.listeners.get(player);
    room.listeners.set(player, listener);previous?.close();
    room.players[player].connected = true;room.players[player].disconnectedAt = null;
    if (room.status === 'active' && room.pausedAt !== null && room.players.every(p => p?.connected)) {
      const pause = this.now() - room.pausedAt;
      if (room.state.phase === 'quiz') room.state.deadline += pause;
      if (room.state.result) room.state.result.dismissAt += pause;
      room.pausedAt = null;
    }
    this.broadcast(room);
    return () => {
      if (room.listeners.get(player) !== listener || room.status === 'closed') return;
      this.advance(room);
      room.listeners.delete(player);room.players[player].connected = false;room.players[player].disconnectedAt = this.now();
      if (room.status === 'active' && room.pausedAt === null) room.pausedAt = this.now();
      this.broadcast(room);
    };
  }
  start(room) {
    room.state = newGame({ names: room.players.map(p => p.name), mode: 'network', theme: 'dota', seconds: ANSWER_SECONDS, heroCount: this.heroes.length });
    room.state.matchId = randomBytes(12).toString('hex');
    room.status = 'active';room.pausedAt = null;room.votes = [false, false];
  }
  act(code, token, command) {
    const { room, player } = this.authenticate(code, token);
    if (!command || typeof command.type !== 'string') fail(400, 'Неизвестное действие.');
    if (command.type === 'leave') { this.close(room, `${room.players[player].name} вышел из комнаты.`);return { snapshot: this.view(room, player) }; }
    this.advance(room);
    if (room.status === 'closed') fail(410, room.reason);
    if (!room.players.every(p => p?.connected) || room.pausedAt !== null) fail(409, 'Ожидаем подключения обоих игроков.');
    if (command.type === 'start') {
      if (player !== 0) fail(403, 'Начать игру может создатель комнаты.');
      if (room.status !== 'waiting') fail(409, 'Партия уже началась.');
      this.start(room);this.broadcast(room);return { snapshot: this.view(room, player) };
    }
    const state = room.state;
    if (!state || command.matchId !== state.matchId) fail(409, 'Эта партия уже изменилась.');
    if (command.type === 'rematch') {
      if (state.phase !== 'finished' || state.result) fail(409, 'Сначала завершите текущую партию.');
      room.votes[player] = true;
      if (room.votes.every(Boolean)) this.start(room);
      this.broadcast(room);return { snapshot: this.view(room, player) };
    }
    if (state.player !== player) fail(403, 'Сейчас ход соперника.');
    if (command.turn !== state.turn || state.result || state.phase === 'finished') fail(409, 'Этот ход уже завершён.');
    let answerStatus;
    if (command.type === 'select') {
      if (!openQuestion(state, this.heroes, command.cell, this.now(), this.random)) fail(409, 'Выберите свободную клетку в свой ход.');
    } else if (command.type === 'answer') {
      if (typeof command.answer !== 'string' || command.answer.length > 100) fail(400, 'Проверьте имя героя.');
      if (state.phase !== 'quiz') fail(409, 'Сначала выберите клетку.');
      answerStatus = answerQuestion(state, this.heroes, command.answer, this.now()).status;
      if (answerStatus === 'unknown') return { answerStatus, snapshot: this.view(room, player) };
    } else if (command.type === 'skip') {
      if (state.phase !== 'quiz') fail(409, 'Сейчас нет активного вопроса.');
      endQuestion(state, this.heroes, 'skip', this.now());
    } else fail(400, 'Неизвестное действие.');
    this.broadcast(room);
    return { answerStatus, snapshot: this.view(room, player) };
  }
  advance(room) {
    if (room.status !== 'active' || room.pausedAt !== null) return;
    let changed = false;
    if (room.state.result && this.now() >= room.state.result.dismissAt) { acknowledgeResult(room.state);changed = true; }
    if (room.state.phase === 'quiz' && this.now() >= room.state.deadline) { endQuestion(room.state, this.heroes, 'timeout', this.now());changed = true; }
    if (changed) this.broadcast(room);
  }
  close(room, reason) {
    if (room.status === 'closed') return;
    room.status = 'closed';room.reason = reason;room.closedAt = this.now();
    for(const player of room.players)if(player)player.connected=false;
    this.broadcast(room);
    for (const listener of room.listeners.values()) listener.close();
    room.listeners.clear();
  }
  tick() {
    for (const [code, room] of this.rooms) {
      if (room.status === 'closed') { if (this.now() - room.closedAt >= 60000) this.rooms.delete(code);continue; }
      const missing = room.players.some(p => p && !p.connected && this.now() - p.disconnectedAt >= this.disconnectMs);
      if (missing) { this.close(room, 'Игрок не вернулся в комнату.');continue; }
      if (this.now() - room.createdAt >= (room.status === 'waiting' ? 15 * 60000 : 2 * 3600000)) { this.close(room, 'Время жизни комнаты истекло.');continue; }
      this.advance(room);
    }
  }
  shutdown() { for (const room of this.rooms.values()) this.close(room, 'Сервер перезапускается.');this.rooms.clear(); }
}
