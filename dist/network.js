export class RoomClient {
  constructor({ onState, onConnection }) { this.onState = onState;this.onConnection = onConnection;this.session = null;this.events = null;this.revision = -1; }
  async request(url, data, keepalive = false) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: keepalive ? undefined : AbortSignal.timeout(8000), keepalive });
    let result;
    try {result = await response.json();} catch {throw new Error('Сервер недоступен. Попробуйте ещё раз.');}
    if (!response.ok) throw new Error(result.error || 'Не удалось выполнить запрос.');
    return result;
  }
  async enter(type, name, code) {
    const result = await this.request(type === 'create' ? '/api/rooms' : `/api/rooms/${code}/join`, { name });
    this.session = { code: result.code, token: result.token, player: result.player };return result.snapshot;
  }
  receive(snapshot) {
    if (snapshot.revision <= this.revision) return;
    this.revision = snapshot.revision;this.snapshot = snapshot;this.onState(snapshot);
    if (snapshot.status === 'closed') this.stop();
  }
  connect() {
    const { code, token } = this.session;
    const events = new EventSource(`/api/rooms/${code}/events?token=${encodeURIComponent(token)}`);this.events = events;
    events.onopen = () => this.onConnection('connected');
    events.onerror = async () => {
      this.onConnection('reconnecting');
      try {
        const response = await fetch(`/api/rooms/${code}/state?token=${encodeURIComponent(token)}`,{signal:AbortSignal.timeout(8000)});
        if(this.events!==events)return;
        if([403,404,410].includes(response.status)) {
          const result=await response.json();
          this.receive({...this.snapshot,status:'closed',state:null,reason:result.error,revision:this.revision+1,serverNow:Date.now(),pausedAt:null});
        }
      } catch { /* EventSource retries temporary connection failures. */ }
    };
    events.onmessage = event => {
      let snapshot;try {snapshot=JSON.parse(event.data);} catch {this.onConnection('reconnecting');return;}
      this.receive(snapshot);
    };
  }
  async act(type, fields = {}) {
    const result = await this.request(`/api/rooms/${this.session.code}/action`, { ...fields, type, token: this.session.token });
    this.receive(result.snapshot);return result;
  }
  stop() { if(this.events) { this.events.close();this.events = null; } }
  leave() {
    if (this.session) void this.request(`/api/rooms/${this.session.code}/action`, { type: 'leave', token: this.session.token }, true).catch(() => {});
    this.stop();
  }
}
