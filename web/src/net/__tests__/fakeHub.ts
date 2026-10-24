/**
 * An in-memory GameHub: the server's room/host/relay rules from the gameserver
 * repo's `docs/PROTOCOL.md`, behind the same `GameHub` interface the real client
 * (`net/gamehub.ts`) exposes — so `HubSession` is exercised end to end without a
 * network. Every delivery is asynchronous (a macrotask), as it is on a socket.
 *
 * Modelled: welcome/ready, create/join/leave with codes, public lobby
 * (`watchLobby`, `listRooms`), host = creator, host migration to the LOWEST
 * remaining id, `setState` replayed to late joiners, `msg` to one player or
 * everyone else, `setRoom`, `not_host` / `no_such_room` / `room_full` refusals,
 * an empty room kept until `expireEmptyRooms()` (the server's 60 s), and a
 * dropped socket (`drop`).
 */

import type {
  ConnectOptions,
  CreateRoomOptions,
  GameHub,
  HubEvents,
  PlayerInfo,
  RoomChanges,
  RoomSummary,
} from '../gamehub'

type AnyFn = (...args: unknown[]) => void

interface Room {
  summary: RoomSummary
  members: Set<FakeClient>
  snapshot: unknown
  seq: number
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export class FakeHubServer {
  private nextId = 1
  private nextRoom = 1
  readonly rooms = new Map<string, Room>()
  readonly clients = new Set<FakeClient>()
  /** Every connect() call, so a test can assert what a client sent. */
  readonly connects: ConnectOptions[] = []
  /** When set, the next connections are refused (bad key). */
  refuse = false

  connect = (options: ConnectOptions): GameHub<never, never, never> => {
    this.connects.push(options)
    const client = new FakeClient(this, this.nextId++, options.name ?? '')
    this.clients.add(client)
    if (this.refuse || !options.appKey) {
      setTimeout(() => client.serverClose(1006), 0)
    } else {
      setTimeout(() => client.welcome(), 0)
    }
    return client as unknown as GameHub<never, never, never>
  }

  /** Let every pending delivery happen. */
  async settle(rounds = 20): Promise<void> {
    for (let i = 0; i < rounds; i++) await tick()
  }

  /** The server forgets empty rooms (it does so after 60 s). */
  expireEmptyRooms(): void {
    for (const [code, room] of this.rooms) {
      if (room.members.size === 0) {
        this.rooms.delete(code)
        this.lobbyRemove(code)
      }
    }
  }

  // --- internals used by FakeClient -----------------------------------------

  publicRooms(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((room) => room.summary.public && room.members.size > 0)
      .map((room) => ({ ...room.summary, players: room.members.size }))
  }

  lobbyChanged(room: Room): void {
    for (const client of this.clients) {
      if (!client.watchingLobby) continue
      if (room.summary.public && room.members.size > 0) {
        client.deliver(() => client.lobbyUpsert({ ...room.summary, players: room.members.size }))
      } else {
        client.deliver(() => client.lobbyDelete(room.summary.id))
      }
    }
  }

  lobbyRemove(code: string): void {
    for (const client of this.clients) {
      if (client.watchingLobby) client.deliver(() => client.lobbyDelete(code))
    }
  }

  createRoom(client: FakeClient, options: CreateRoomOptions): Room {
    const code = `R${String(this.nextRoom++).padStart(5, '0')}`
    const room: Room = {
      summary: {
        id: code,
        name: options.name ?? 'room',
        public: options.public ?? true,
        players: 0,
        maxPlayers: options.maxPlayers ?? 16,
        meta: options.meta ?? null,
        host: client.id,
        createdAt: Date.now(),
      },
      members: new Set(),
      snapshot: null,
      seq: 0,
    }
    this.rooms.set(code, room)
    return room
  }

  leaveRoom(client: FakeClient): void {
    const room = client.currentRoom
    if (room === null) return
    room.members.delete(client)
    client.currentRoom = null
    for (const other of room.members) other.deliver(() => other.playerLeft(client.id))
    if (room.summary.host === client.id && room.members.size > 0) {
      const next = Math.min(...[...room.members].map((m) => m.id))
      room.summary.host = next
      for (const other of room.members) other.deliver(() => other.hostChanged(next))
    }
    this.lobbyChanged(room)
  }
}

export class FakeClient {
  readonly server: FakeHubServer
  readonly id: number
  name: string
  private readonly handlers = new Map<string, Set<AnyFn>>()
  private readonly lobby = new Map<string, RoomSummary>()
  currentRoom: Room | null = null
  watchingLobby = false
  open = false
  private closedFlag = false
  private hostId: number | null = null
  private playersMap = new Map<number, PlayerInfo>()
  private resolveReady!: (v: { you: number; name: string }) => void
  private rejectReady!: (e: Error) => void
  readonly ready: Promise<{ you: number; name: string }>
  /** Everything this client sent with `send`, for assertions. */
  readonly sent: Array<{ data: unknown; to?: number }> = []

  constructor(server: FakeHubServer, id: number, name: string) {
    this.server = server
    this.id = id
    this.name = name
    this.ready = new Promise((res, rej) => {
      this.resolveReady = res
      this.rejectReady = rej
    })
    this.ready.catch(() => {})
  }

  deliver(fn: () => void): void {
    setTimeout(() => {
      if (!this.closedFlag) fn()
    }, 0)
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(event) ?? []) fn(...args)
  }

  welcome(): void {
    this.open = true
    this.resolveReady({ you: this.id, name: this.name })
  }

  serverClose(code: number): void {
    if (this.closedFlag) return
    this.closedFlag = true
    if (!this.open) this.rejectReady(new Error(`gamehub: could not connect (${code})`))
    this.open = false
    this.server.leaveRoom(this)
    this.server.clients.delete(this)
    this.watchingLobby = false
    for (const fn of this.handlers.get('close') ?? []) fn({ code })
  }

  /** The network drops this socket (no `leave` sent). */
  drop(): void {
    this.serverClose(1006)
  }

  lobbyUpsert(room: RoomSummary): void {
    this.lobby.set(room.id, room)
    this.emit('lobby', [...this.lobby.values()])
  }

  lobbyDelete(code: string): void {
    this.lobby.delete(code)
    this.emit('lobby', [...this.lobby.values()])
  }

  playerLeft(id: number): void {
    this.playersMap.delete(id)
    this.emit('player-', id)
  }

  hostChanged(id: number): void {
    this.hostId = id
    this.emit('host', id)
  }

  // --- the GameHub interface ------------------------------------------------

  get you(): number | null {
    return this.open ? this.id : null
  }
  get host(): number | null {
    return this.hostId
  }
  get isHost(): boolean {
    return this.open && this.hostId === this.id
  }
  get room(): RoomSummary | null {
    return this.currentRoom?.summary ?? null
  }
  get players(): PlayerInfo[] {
    return [...this.playersMap.values()]
  }

  on<E extends keyof HubEvents<unknown, unknown, unknown>>(event: E, fn: HubEvents<unknown, unknown, unknown>[E]): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(fn as AnyFn)
    return () => {
      this.handlers.get(event)?.delete(fn as AnyFn)
    }
  }

  async listRooms(): Promise<RoomSummary[]> {
    return this.server.publicRooms()
  }

  watchLobby(onRooms: (rooms: RoomSummary[]) => void): () => void {
    const off = this.on('lobby', onRooms)
    // Like the real client: a message sent before the socket is open is dropped.
    if (!this.open) return off
    this.watchingLobby = true
    const rooms = this.server.publicRooms()
    this.deliver(() => {
      this.lobby.clear()
      for (const room of rooms) this.lobby.set(room.id, room)
      this.emit('lobby', [...this.lobby.values()])
    })
    return () => {
      off()
      this.watchingLobby = false
    }
  }

  private async request<T>(fn: () => T): Promise<T> {
    await tick()
    if (this.closedFlag) throw new Error('gamehub: connection closed')
    const result = fn()
    await tick()
    return result
  }

  private refuse(code: string): never {
    throw Object.assign(new Error('gamehub: ' + code), { code })
  }

  create(options: CreateRoomOptions = {}): Promise<RoomSummary> {
    return this.request(() => {
      if (this.currentRoom !== null) this.refuse('already_in_room')
      const room = this.server.createRoom(this, options)
      this.enter(room)
      return room.summary
    })
  }

  join(code: string): Promise<RoomSummary> {
    return this.request(() => {
      if (this.currentRoom !== null) this.refuse('already_in_room')
      const room = this.server.rooms.get(code.toUpperCase())
      if (room === undefined) this.refuse('no_such_room')
      if (room.members.size >= room.summary.maxPlayers) this.refuse('room_full')
      if (room.members.size === 0) room.summary.host = this.id
      this.enter(room)
      return room.summary
    })
  }

  private enter(room: Room): void {
    for (const other of room.members) {
      const info = { id: this.id, name: this.name }
      other.deliver(() => {
        other.playersMap.set(info.id, info)
        other.emit('player+', info)
      })
    }
    room.members.add(this)
    this.currentRoom = room
    this.hostId = room.summary.host
    this.playersMap = new Map([...room.members].map((m) => [m.id, { id: m.id, name: m.name }]))
    this.emit('joined', room.summary, { you: this.id, host: room.summary.host, players: this.players })
    if (room.snapshot !== null) this.emit('state', structuredClone(room.snapshot), room.seq)
    this.server.lobbyChanged(room)
  }

  leave(): Promise<unknown> {
    return this.request(() => {
      this.server.leaveRoom(this)
      this.hostId = null
      this.playersMap.clear()
      return { t: 'left' }
    })
  }

  setState(data: unknown): void {
    const room = this.currentRoom
    if (room === null || !this.open) return
    if (room.summary.host !== this.id) {
      this.deliver(() => this.emit('error', { code: 'not_host' }))
      return
    }
    room.seq += 1
    room.snapshot = structuredClone(data)
    const seq = room.seq
    for (const other of room.members) {
      if (other === this) continue
      const copy = structuredClone(data)
      other.deliver(() => other.emit('state', copy, seq))
    }
  }

  sendDelta(): void {
    throw new Error('Colossus never sends deltas')
  }

  send(data: unknown, to?: number): void {
    const room = this.currentRoom
    if (room === null || !this.open) return
    this.sent.push({ data: structuredClone(data), to })
    for (const other of room.members) {
      if (other === this) continue
      if (to !== undefined && other.id !== to) continue
      const copy = structuredClone(data)
      other.deliver(() => other.emit('msg', copy, this.id))
    }
  }

  sendBinary(): void {
    throw new Error('Colossus never sends binary')
  }

  setRoom(changes: RoomChanges): void {
    const room = this.currentRoom
    if (room === null || room.summary.host !== this.id) return
    if (changes.name !== undefined) room.summary.name = changes.name
    if (changes.public !== undefined) room.summary.public = changes.public
    if (changes.meta !== undefined) room.summary.meta = structuredClone(changes.meta)
    this.server.lobbyChanged(room)
  }

  close(): void {
    this.serverClose(1000)
  }
}
