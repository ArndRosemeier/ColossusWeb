// gamehub.ts - typed client for GameHub (https://games.futuremagic.de).
//
// A dependency-free TypeScript port of the server's /sdk.js with the same API, plus generics for
// your own state, delta and message types. Copy this single file into a game (e.g. src/net/gamehub.ts).
// Works in browsers and in Node >= 22 (global WebSocket).
//
//   const hub = connect<World, WorldDelta, Intent>({ app: "tank", appKey, name: "Arnd" });
//   await hub.ready;
//   hub.on("state", (world) => { ... });          // world: World
//   hub.on("delta", (delta) => { ... });          // delta: WorldDelta
//   hub.on("msg", (intent, from) => { ... });     // intent: Intent

export type RoomSummary = {
  id: string;           // 6-char join code, e.g. "K7Q2ZP"
  name: string;
  public: boolean;      // listed in the lobby?
  players: number;
  maxPlayers: number;
  meta: unknown;        // free-form, set by the host (mode, map, ...)
  host: number;         // player id of the current host
  createdAt: number;
};
export type PlayerInfo = { id: number; name: string };
export type CreateRoomOptions = { name?: string; public?: boolean; maxPlayers?: number; meta?: unknown };
export type RoomChanges = { name?: string; public?: boolean; meta?: unknown };
export type ConnectOptions = {
  /** Server root. Default https://games.futuremagic.de */
  url?: string;
  /** App id registered on the server, e.g. "tank". */
  app: string;
  /** For apps in "key" access mode. */
  appKey?: string;
  /** For apps in "cloudflare" access mode: routes through /access (player must be logged in). */
  access?: boolean;
  /** Display name shown to other players. */
  name?: string;
};
export type HubError = { code: string; req?: number };
export type JoinInfo = { you: number; host: number; players: PlayerInfo[] };

export type HubEvents<S, D, M> = {
  /** Full state from the host (also replayed to you on join). */
  state: (data: S, seq: number) => void;
  /** Incremental change; apply in arrival order after the latest state. */
  delta: (data: D, seq: number) => void;
  /** Free-form message from another player (e.g. an intent sent to the host). */
  msg: (data: M, from: number) => void;
  /** Raw bytes from another player. */
  binary: (bytes: Uint8Array, from: number) => void;
  joined: (room: RoomSummary, info: JoinInfo) => void;
  "player+": (player: PlayerInfo) => void;
  "player-": (id: number) => void;
  /** Host changed (migration). If id === hub.you, you now run the simulation. */
  host: (id: number) => void;
  room: (room: RoomSummary) => void;
  /** Public rooms of this app, after watchLobby(). */
  lobby: (rooms: RoomSummary[]) => void;
  /** Host only: the server wants a fresh full state (history got long or a joiner needs one). */
  "need-snapshot": () => void;
  /** You joined but part of the history was dropped; a fresh state follows from the host. */
  incomplete: () => void;
  error: (error: HubError) => void;
  close: (event: CloseEvent) => void;
};

export interface GameHub<S = unknown, D = unknown, M = unknown> {
  /** Resolves once connected and authorised; rejects if the server refused the connection. */
  readonly ready: Promise<{ you: number; name: string }>;
  readonly you: number | null;
  readonly host: number | null;
  readonly isHost: boolean;
  readonly room: RoomSummary | null;
  readonly players: PlayerInfo[];
  on<E extends keyof HubEvents<S, D, M>>(event: E, fn: HubEvents<S, D, M>[E]): () => void;
  listRooms(): Promise<RoomSummary[]>;
  watchLobby(onRooms: (rooms: RoomSummary[]) => void): () => void;
  create(room?: CreateRoomOptions): Promise<RoomSummary>;
  join(roomId: string): Promise<RoomSummary>;
  leave(): Promise<unknown>;
  setState(data: S): void;
  sendDelta(data: D): void;
  send(data: M, to?: number): void;
  /** Raw bytes to everyone else in the room (backed by a regular ArrayBuffer, not a SharedArrayBuffer). */
  sendBinary(bytes: Uint8Array<ArrayBuffer> | ArrayBuffer): void;
  setRoom(changes: RoomChanges): void;
  close(): void;
}

type Pending = { resolve: (m: any) => void; reject: (e: Error) => void };
type AnyFn = (...args: any[]) => void;

export function connect<S = unknown, D = unknown, M = unknown>(options: ConnectOptions): GameHub<S, D, M> {
  const { url = "https://games.futuremagic.de", app, appKey, access = false, name } = options;
  if (!app) throw new Error("gamehub: options.app is required");
  const base = url.replace(/\/+$/, "") + (access ? "/access" : "");
  const httpBase = base.replace(/^ws/, "http");
  const wsBase = base.replace(/^http/, "ws");
  const appPath = "/v1/apps/" + encodeURIComponent(app);
  const query = appKey ? "?key=" + encodeURIComponent(appKey) : "";

  const handlers = new Map<string, Set<AnyFn>>();
  const pending = new Map<number, Pending>();
  const lobbyRooms = new Map<string, RoomSummary>();
  let you: number | null = null;
  let host: number | null = null;
  let room: RoomSummary | null = null;
  let players = new Map<number, PlayerInfo>();
  let reqSeq = 0;
  let readyDone = false;
  let resolveReady!: (v: { you: number; name: string }) => void;
  let rejectReady!: (e: Error) => void;
  const ready = new Promise<{ you: number; name: string }>((res, rej) => { resolveReady = res; rejectReady = rej; });
  ready.catch(() => {});

  const emit = (event: string, ...args: unknown[]) => {
    for (const fn of handlers.get(event) ?? []) {
      try { fn(...args); } catch (e) { console.error("gamehub handler error:", e); }
    }
  };
  const ws = new WebSocket(wsBase + appPath + "/ws" + query);
  ws.binaryType = "arraybuffer";
  const raw = (msg: object) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const request = (msg: object) => new Promise<any>((resolve, reject) => {
    const req = ++reqSeq;
    pending.set(req, { resolve, reject });
    raw({ ...msg, req });
  });

  ws.onopen = () => { if (name) raw({ t: "hello", name }); };
  ws.onerror = () => emit("error", { code: "socket_error" });
  ws.onclose = (e) => {
    if (!readyDone) { readyDone = true; rejectReady(new Error("gamehub: could not connect (" + e.code + ")")); }
    for (const p of pending.values()) p.reject(new Error("gamehub: connection closed"));
    pending.clear();
    emit("close", e);
  };
  ws.onmessage = (ev: MessageEvent) => {
    if (typeof ev.data !== "string") {
      const buf = new Uint8Array(ev.data as ArrayBuffer);
      const from = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0);
      emit("binary", buf.subarray(4), from);
      return;
    }
    let m: any;
    try { m = JSON.parse(ev.data); } catch { return; }
    switch (m.t) {
      case "welcome":
        you = m.you;
        if (!readyDone) { readyDone = true; resolveReady({ you: m.you, name: m.name }); }
        break;
      case "joined":
        room = m.room; host = m.host;
        players = new Map((m.players as PlayerInfo[]).map((p) => [p.id, p]));
        emit("joined", m.room, { you: m.you, host: m.host, players: m.players });
        if (m.state.snapshot !== null) emit("state", m.state.snapshot, m.state.snapshotSeq);
        for (const d of m.state.deltas) emit("delta", d.data, d.seq);
        if (m.state.complete === false) emit("incomplete");
        break;
      case "state": emit("state", m.data, m.seq); break;
      case "delta": emit("delta", m.data, m.seq); break;
      case "msg": emit("msg", m.data, m.from); break;
      case "player+": players.set(m.player.id, m.player); emit("player+", m.player); break;
      case "player-": players.delete(m.id); emit("player-", m.id); break;
      case "host": host = m.id; emit("host", m.id); break;
      case "room": room = m.room; emit("room", m.room); break;
      case "rooms":
        lobbyRooms.clear();
        for (const r of m.rooms as RoomSummary[]) lobbyRooms.set(r.id, r);
        emit("lobby", [...lobbyRooms.values()]);
        break;
      case "room+": lobbyRooms.set(m.room.id, m.room); emit("lobby", [...lobbyRooms.values()]); break;
      case "room-": lobbyRooms.delete(m.id); emit("lobby", [...lobbyRooms.values()]); break;
      case "left": room = null; host = null; players.clear(); break;
      case "need-snapshot": emit("need-snapshot"); break;
      case "error": emit("error", m); break;
    }
    if (m.req !== undefined && pending.has(m.req)) {
      const p = pending.get(m.req)!;
      pending.delete(m.req);
      if (m.t === "error") p.reject(Object.assign(new Error("gamehub: " + m.code), { code: m.code }));
      else p.resolve(m);
    }
  };

  return {
    ready,
    get you() { return you; },
    get host() { return host; },
    get isHost() { return you !== null && you === host; },
    get room() { return room; },
    get players() { return [...players.values()]; },
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn as AnyFn);
      return () => { handlers.get(event)?.delete(fn as AnyFn); };
    },
    async listRooms() {
      const headers: Record<string, string> = {};
      if (appKey) headers["x-app-key"] = appKey;
      const r = await fetch(httpBase + appPath + "/rooms", { headers, credentials: access ? "include" : "omit" });
      if (!r.ok) throw new Error("gamehub: rooms HTTP " + r.status);
      return ((await r.json()) as { rooms: RoomSummary[] }).rooms;
    },
    watchLobby(onRooms) {
      const off = this.on("lobby", onRooms);
      raw({ t: "lobby", on: true });
      return () => { off(); raw({ t: "lobby", on: false }); };
    },
    create(opts = {}) { return request({ t: "create", room: opts }).then((m) => m.room as RoomSummary); },
    join(roomId) { return request({ t: "join", id: roomId }).then((m) => m.room as RoomSummary); },
    leave() { return request({ t: "leave" }); },
    setState(data) { raw({ t: "state", data }); },
    sendDelta(data) { raw({ t: "delta", data }); },
    send(data, to) { raw(to === undefined ? { t: "msg", data } : { t: "msg", data, to }); },
    sendBinary(bytes) { if (ws.readyState === 1) ws.send(bytes); },
    setRoom(changes) {
      const m: Record<string, unknown> = { t: "meta" };
      if (changes.name !== undefined) m.name = changes.name;
      if (changes.public !== undefined) m.public = changes.public;
      if (changes.meta !== undefined) m.meta = changes.meta;
      raw(m);
    },
    close() { ws.close(1000); },
  };
}
