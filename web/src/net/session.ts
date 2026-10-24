/**
 * The ONE live connection of online play: a GameHub socket, the lobby list, the
 * room this browser is in, and the host's duties when it is the host.
 *
 * `room.ts` holds the rules (pure); this class only moves them over the wire:
 *
 *  - **Everyone** mirrors the host's {@link RoomWorld} (`state` events), keeps a
 *    copy in `localStorage` (`activeGame.ts`) and sends intents to the host.
 *  - **The host** runs `hostHandle` on every intent, publishes the result with
 *    `setState`, answers `need-snapshot`, and keeps the lobby `meta` current.
 *  - **Host migration**: when the host leaves, GameHub promotes another player,
 *    who reconciles presence and continues from its copy (`PATTERNS.md` §5).
 *    Everyone re-sends `hello` to the new host, and a move that may have died
 *    with the old host is re-sent.
 *  - **A dropped socket reconnects** with backoff and rejoins the same room; the
 *    stable token (`identity.ts`) puts the player back in their seat.
 *
 * React reads it through {@link HubSession.subscribe} / {@link HubSession.getSnapshot}
 * (`useSyncExternalStore`). The constructor has NO side effects — nothing is
 * connected until {@link HubSession.start} — so `StrictMode`'s discarded
 * instances never open a socket.
 */

import type { GameState } from '../engine/types'
import { serializeGame, type SavedGameBlob } from '../persistence/saveGame'
import { forgetActiveGame, rememberActiveGame } from './activeGame'
import { describeFailure, NetError, type FailureDescription } from './failure'
import { connect as realConnect, type ConnectOptions, type GameHub, type RoomSummary } from './gamehub'
import { hubConfig as realHubConfig, type HubConfig } from './hubConfig'
import type { LocalPlayer } from './identity'
import {
  createWorld,
  hostDisconnect,
  hostHandle,
  hostReconcile,
  parseRoomMeta,
  parseWorld,
  roomMeta,
  seatOf,
  startWorld,
  type Intent,
  type RoomMeta,
  type RoomWorld,
} from './room'
import type { MoveSink } from './sync'

export type ConnectionPhase = 'idle' | 'connecting' | 'online' | 'reconnecting'

/** One Colossus room in the lobby list. */
export interface LobbyRoom {
  readonly code: string
  readonly name: string
  readonly meta: RoomMeta
  /** Connections in the room right now (players and watchers). */
  readonly connected: number
}

export interface SessionSnapshot {
  readonly connection: ConnectionPhase
  readonly isHost: boolean
  /** The room this browser is in, or null. */
  readonly code: string | null
  /** The latest world (live, or the local copy of a room that is gone). */
  readonly world: RoomWorld | null
  readonly rooms: readonly LobbyRoom[]
  readonly failure: FailureDescription | null
  /**
   * Bumped whenever the game screen must ADOPT `world.game`: a move by someone
   * else, Start, or a refusal of this client's own move. Not bumped for the echo
   * of this client's own accepted move, which it already shows.
   */
  readonly adoptSeq: number
  /** How many reconnect attempts in a row (0 while healthy). */
  readonly retries: number
}

export type HubConnect = (options: ConnectOptions) => GameHub<RoomWorld, never, Intent>

export interface HubSessionOptions {
  player: LocalPlayer
  /** Injectable for tests: the in-memory hub. */
  connect?: HubConnect
  config?: () => HubConfig
  /** Reconnect delay for the n-th consecutive attempt (ms). */
  retryDelayMs?: (attempt: number) => number
}

/** Spare connections above the game's seats: watchers and a reload's stale socket. */
const ROOM_SLACK = 4
const HUB_ROOM_CAP = 16

export function defaultRetryDelayMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
}

export class HubSession implements MoveSink {
  private readonly options: HubSessionOptions
  private player: LocalPlayer
  private hub: GameHub<RoomWorld, never, Intent> | null = null
  private offHub: Array<() => void> = []
  private snapshot: SessionSnapshot = {
    connection: 'idle',
    isHost: false,
    code: null,
    world: null,
    rooms: [],
    failure: null,
    adoptSeq: 0,
    retries: 0,
  }
  private readonly listeners = new Set<() => void>()
  private closed = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  /** The rev this client expects after its own in-flight moves; null when none. */
  private expectedRev: number | null = null
  /** The newest state this client sent and the host has not confirmed. */
  private unconfirmed: SavedGameBlob | null = null
  private lastMeta = ''
  /** This browser's saved copy, handed in before a rejoin (see `restoreCopy`). */
  private savedCopy: RoomWorld | null = null

  constructor(options: HubSessionOptions) {
    this.options = options
    this.player = options.player
  }

  // --- React binding ------------------------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): SessionSnapshot => this.snapshot

  private update(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of [...this.listeners]) listener()
  }

  private fail(error: unknown): void {
    this.update({ failure: describeFailure(error) })
  }

  get you(): number | null {
    return this.hub?.you ?? null
  }

  get token(): string {
    return this.player.token
  }

  setPlayer(player: LocalPlayer): void {
    if (player.token !== this.player.token) throw new NetError('bad_identity', 'the token cannot change')
    this.player = player
  }

  // --- connection ---------------------------------------------------------

  /** Connect and watch the lobby. Idempotent; resolves when online. */
  async start(): Promise<void> {
    // A closed session may be started again (React's StrictMode closes and
    // re-opens effects once in development).
    this.closed = false
    if (this.hub !== null) {
      await this.hub.ready
      return
    }
    this.open('connecting')
    await this.hub!.ready
  }

  private open(phase: 'connecting' | 'reconnecting'): void {
    let config: HubConfig
    try {
      config = (this.options.config ?? realHubConfig)()
    } catch (error) {
      this.fail(error)
      throw error
    }
    const connect = this.options.connect ?? (realConnect as unknown as HubConnect)
    const hub = connect({
      url: config.url,
      app: config.app,
      appKey: config.appKey,
      access: config.access,
      name: this.player.name || 'Player',
    })
    this.hub = hub
    this.update({ connection: phase })
    this.offHub = [
      hub.on('state', (data) => this.onState(data)),
      hub.on('msg', (data, from) => this.onMsg(data, from)),
      hub.on('player-', (id) => this.onPlayerLeft(id)),
      hub.on('host', (id) => this.onHostChanged(id)),
      hub.on('need-snapshot', () => {
        if (hub.isHost) this.publish()
      }),
      hub.on('error', (error) => {
        if (error.code !== 'socket_error') this.fail(new NetError(error.code, `the game server said ${error.code}`))
      }),
      hub.on('close', () => this.onClose(hub)),
    ]
    hub.ready.then(
      () => {
        if (this.hub !== hub) return
        // Only once the socket is OPEN: the client drops anything sent before.
        this.offHub.push(hub.watchLobby((rooms) => this.onLobby(rooms)))
        this.update({ connection: 'online', retries: 0, failure: null })
        if (phase === 'reconnecting' && this.snapshot.code !== null) {
          void this.rejoin(this.snapshot.code)
        }
      },
      (error: unknown) => {
        if (this.hub === hub) this.fail(new NetError('connect_failed', String((error as Error)?.message ?? error)))
      },
    )
  }

  private detach(): void {
    for (const off of this.offHub) off()
    this.offHub = []
  }

  private onClose(hub: GameHub<RoomWorld, never, Intent>): void {
    if (this.hub !== hub) return
    this.detach()
    this.hub = null
    if (this.closed) return
    const retries = this.snapshot.retries + 1
    this.update({ connection: 'reconnecting', isHost: false, retries })
    const delay = (this.options.retryDelayMs ?? defaultRetryDelayMs)(retries)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.closed) return
      try {
        this.open('reconnecting')
      } catch {
        // `open` already put `hub_not_configured` on the surface.
      }
    }, delay)
  }

  /** Close for good (the app unmounts). */
  close(): void {
    this.closed = true
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.detach()
    this.hub?.close()
    this.hub = null
    this.update({ connection: 'idle', isHost: false })
  }

  private requireHub(): GameHub<RoomWorld, never, Intent> {
    if (this.hub === null || this.hub.you === null) {
      throw new NetError('connection_closed', 'not connected to the game server')
    }
    return this.hub
  }

  // --- lobby ----------------------------------------------------------------

  private onLobby(rooms: RoomSummary[]): void {
    const ours: LobbyRoom[] = []
    for (const room of rooms) {
      const meta = parseRoomMeta(room.meta)
      if (meta === null) continue
      ours.push({ code: room.id, name: room.name, meta, connected: room.players })
    }
    ours.sort((a, b) => a.name.localeCompare(b.name))
    this.update({ rooms: ours })
  }

  /**
   * Hand the session this browser's saved copy before rejoining, so the `hello`
   * names its rev and a host holding an OLDER copy asks for this one.
   */
  restoreCopy(world: RoomWorld): void {
    this.savedCopy = world
    if (this.snapshot.world === null) this.update({ world })
  }

  /** The newest copy of `gameId` this browser holds: the live world, or a restored copy. */
  private newestCopy(gameId: string | null): RoomWorld | null {
    const live = this.snapshot.world
    const saved = this.savedCopy
    const candidates = [live, saved].filter(
      (w): w is RoomWorld => w !== null && (gameId === null || w.gameId === gameId),
    )
    return candidates.sort((a, b) => b.rev - a.rev)[0] ?? null
  }

  /** A live room created for this cued invitation room (`raum`), if any. */
  findRoomForCued(raum: string): LobbyRoom | null {
    return this.snapshot.rooms.find((room) => room.meta.cuedRaum === raum) ?? null
  }

  /** A live room holding this game (it was re-opened under a new code). */
  findRoomFor(gameId: string): LobbyRoom | null {
    return this.snapshot.rooms.find((room) => room.meta.gameId === gameId) ?? null
  }

  /** Create a game; this browser becomes its host and first player. */
  async create(options: {
    displayName: string
    variant: string
    maxPlayers: number
    /** The cued invitation room this game is for (`cued.ts` `room`), if any. */
    cuedRaum?: string | null
  }): Promise<void> {
    await this.start()
    const hub = this.requireHub()
    const world = createWorld({
      displayName: options.displayName,
      variant: options.variant,
      maxPlayers: options.maxPlayers,
      creator: this.player,
      conn: hub.you,
      cuedRaum: options.cuedRaum ?? null,
    })
    await this.openRoom(world)
  }

  /** Re-open a game from this browser's copy, in a new room. */
  async reopen(copy: RoomWorld): Promise<void> {
    await this.start()
    const hub = this.requireHub()
    const world: RoomWorld = {
      ...copy,
      members: copy.members.map((m) => ({ ...m, conn: m.token === this.player.token ? hub.you : null })),
    }
    await this.openRoom(world)
  }

  private async openRoom(world: RoomWorld): Promise<void> {
    const hub = this.requireHub()
    try {
      const room = await hub.create({
        name: world.displayName,
        public: true,
        maxPlayers: Math.min(HUB_ROOM_CAP, world.maxPlayers + ROOM_SLACK),
        meta: roomMeta(world),
      })
      this.lastMeta = JSON.stringify(roomMeta(world))
      this.expectedRev = null
      this.unconfirmed = null
      this.setWorld(world, room.id, true)
      hub.setState(world)
      this.update({ isHost: true, failure: null })
    } catch (error) {
      this.fail(error)
      throw error
    }
  }

  /** Join a room by code (from the list, a link, or a resume). */
  async join(code: string): Promise<void> {
    await this.start()
    const hub = this.requireHub()
    try {
      if (hub.room !== null) await hub.leave()
      await hub.join(code)
      this.expectedRev = null
      this.unconfirmed = null
      this.afterJoin(code)
    } catch (error) {
      this.fail(error)
      throw error
    }
  }

  private async rejoin(code: string): Promise<void> {
    const hub = this.hub
    if (hub === null) return
    try {
      await hub.join(code)
      this.afterJoin(code)
    } catch (error) {
      // The room is gone: keep the copy, so the player can re-open it.
      this.update({ code: null, isHost: false })
      this.fail(error)
    }
  }

  private afterJoin(code: string): void {
    const hub = this.requireHub()
    this.update({ code, isHost: hub.isHost, failure: null })
    if (hub.isHost) {
      // We re-entered an empty room: the server replayed its last state (if any)
      // into `onState`, and we continue from it as host.
      if (this.snapshot.world === null) {
        throw new NetError('no_such_room', `room ${code} has no game in it`)
      }
      this.takeOverAsHost()
    } else {
      this.sendHello()
    }
  }

  /** Leave the room. In a lobby this also gives up the place in the game. */
  async leave(): Promise<void> {
    const hub = this.hub
    const world = this.snapshot.world
    if (hub !== null && hub.room !== null) {
      if (world?.status === 'lobby') {
        if (hub.isHost) {
          // The creator leaving a lobby closes it for everyone.
        } else if (hub.host !== null) {
          hub.send({ t: 'leave', token: this.player.token }, hub.host)
        }
      }
      try {
        await hub.leave()
      } catch (error) {
        this.fail(error)
      }
    }
    forgetActiveGame()
    this.savedCopy = null
    this.expectedRev = null
    this.unconfirmed = null
    this.update({ code: null, world: null, isHost: false })
  }

  // --- the world ------------------------------------------------------------

  private setWorld(world: RoomWorld, code: string | null, adopt: boolean): void {
    rememberActiveGame(code ?? this.snapshot.code ?? '', world)
    this.update({
      world,
      code: code ?? this.snapshot.code,
      adoptSeq: adopt ? this.snapshot.adoptSeq + 1 : this.snapshot.adoptSeq,
    })
  }

  private onState(data: unknown): void {
    // Only the host sends `state`, so a host sees one only as the replay when it
    // re-enters an empty room; it keeps its own copy if that is newer.
    let world: RoomWorld
    try {
      world = parseWorld(data)
    } catch (error) {
      this.fail(error)
      return
    }
    const previous = this.snapshot.world
    if (this.hub?.isHost && previous !== null && previous.gameId === world.gameId && previous.rev >= world.rev) {
      return
    }
    // Our own move coming back: the screen already shows it (or something newer).
    const ownEcho =
      world.lastBy === this.player.token &&
      this.expectedRev !== null &&
      world.rev <= this.expectedRev &&
      previous !== null &&
      previous.gameId === world.gameId
    if (this.expectedRev !== null && world.rev >= this.expectedRev) {
      this.expectedRev = null
      this.unconfirmed = null
    }
    const gameChanged = previous === null || previous.gameId !== world.gameId || previous.rev !== world.rev
    this.setWorld(world, null, gameChanged && !ownEcho)
  }

  /** The host publishes its world: to the room, the lobby meta, and its own screen. */
  private publish(adopt = false): void {
    const hub = this.hub
    const world = this.snapshot.world
    if (hub === null || world === null || !hub.isHost) return
    hub.setState(world)
    const meta = JSON.stringify(roomMeta(world))
    if (meta !== this.lastMeta) {
      this.lastMeta = meta
      hub.setRoom({ meta: roomMeta(world) })
    }
    this.setWorld(world, null, adopt)
  }

  private onMsg(intent: Intent, from: number): void {
    const hub = this.hub
    if (hub === null || typeof intent !== 'object' || intent === null) return
    if (hub.isHost) {
      const world = this.snapshot.world
      if (world === null) return
      const outcome = hostHandle(world, intent, from)
      if (outcome.world !== world) {
        this.snapshot = { ...this.snapshot, world: outcome.world }
        // A move by someone else: the host's own screen adopts it.
        this.publish(outcome.world.rev !== world.rev)
      }
      if (outcome.reply !== null) hub.send(outcome.reply, from)
      return
    }
    if (from !== hub.host) return
    if (intent.t === 'rejected' && intent.code === 'game_full') {
      this.fail(new NetError(intent.code, intent.message))
      void this.leave()
    } else if (intent.t === 'rejected') {
      // Our move was refused: drop the optimistic state and show the host's.
      this.expectedRev = null
      this.unconfirmed = null
      this.update({
        failure: describeFailure(new NetError(intent.code, intent.message)),
        adoptSeq: this.snapshot.adoptSeq + 1,
      })
    } else if (intent.t === 'send-backup') {
      const copy = this.newestCopy(this.snapshot.world?.gameId ?? null)
      if (copy !== null) hub.send({ t: 'backup', world: copy }, from)
    }
  }

  private onPlayerLeft(id: number): void {
    const hub = this.hub
    const world = this.snapshot.world
    if (hub === null || world === null || !hub.isHost) return
    const next = hostDisconnect(world, id)
    if (next !== world) {
      this.snapshot = { ...this.snapshot, world: next }
      this.publish()
    }
  }

  private onHostChanged(id: number): void {
    const hub = this.hub
    if (hub === null) return
    if (id === hub.you) {
      this.takeOverAsHost()
    } else {
      this.update({ isHost: false })
      this.sendHello()
      this.resendUnconfirmed()
    }
  }

  private takeOverAsHost(): void {
    const hub = this.requireHub()
    let world = this.snapshot.world
    if (world === null) return
    // The previous host's view of who is connected may be stale.
    world = hostReconcile(world, new Set(hub.players.map((p) => p.id)))
    // Our own presence, through the same rule everyone else's goes through.
    world = hostHandle(world, this.helloIntent(), hub.you!).world
    // A move of ours the old host never confirmed: apply it now, as host.
    if (this.unconfirmed !== null) {
      const base = this.expectedRev === null ? world.rev : this.expectedRev - 1
      world = hostHandle(
        world,
        { t: 'commit', token: this.player.token, base: Math.min(base, world.rev), game: this.unconfirmed },
        hub.you!,
      ).world
    }
    this.expectedRev = null
    this.unconfirmed = null
    this.snapshot = { ...this.snapshot, world, isHost: true }
    this.lastMeta = ''
    this.publish()
    this.update({ isHost: true })
  }

  private helloIntent(): Intent {
    const world = this.newestCopy(this.snapshot.world?.gameId ?? null)
    return {
      t: 'hello',
      token: this.player.token,
      name: this.player.name || 'Player',
      heldRev: world?.rev ?? null,
      gameId: world?.gameId ?? null,
    }
  }

  private sendHello(): void {
    const hub = this.hub
    if (hub === null || hub.host === null || hub.isHost) return
    hub.send(this.helloIntent(), hub.host)
  }

  private resendUnconfirmed(): void {
    const hub = this.hub
    const world = this.snapshot.world
    if (hub === null || hub.host === null || world === null || this.unconfirmed === null) return
    hub.send({ t: 'commit', token: this.player.token, base: world.rev, game: this.unconfirmed }, hub.host)
    this.expectedRev = world.rev + 1
  }

  // --- the game -------------------------------------------------------------

  /** Host only: Start the game with this opening state. */
  startGame(opening: GameState): void {
    const hub = this.requireHub()
    const world = this.snapshot.world
    if (world === null) throw new NetError('not_in_room', 'not in a game')
    if (!hub.isHost) throw new NetError('not_host', 'only the host can start the game')
    const started = startWorld(world, serializeGame(opening))
    this.snapshot = { ...this.snapshot, world: started }
    this.publish(true)
  }

  /** Send this client's new state as its move ({@link MoveSink}). */
  commit(state: GameState): void {
    const hub = this.hub
    const world = this.snapshot.world
    if (world === null) return
    const game = serializeGame(state)
    if (hub === null || hub.you === null) {
      // Offline: keep it, and send it when the room is back.
      this.unconfirmed = game
      this.fail(new NetError('connection_closed', 'not connected — your move will be sent on reconnect'))
      return
    }
    if (hub.isHost) {
      const outcome = hostHandle(world, { t: 'commit', token: this.player.token, base: world.rev, game }, hub.you)
      if (outcome.world !== world) {
        this.snapshot = { ...this.snapshot, world: outcome.world, failure: null }
        this.publish()
      } else if (outcome.reply?.t === 'rejected') {
        this.update({
          failure: describeFailure(new NetError(outcome.reply.code, outcome.reply.message)),
          adoptSeq: this.snapshot.adoptSeq + 1,
        })
      }
      return
    }
    if (hub.host === null) return
    const base = this.expectedRev ?? world.rev
    hub.send({ t: 'commit', token: this.player.token, base, game }, hub.host)
    this.expectedRev = base + 1
    this.unconfirmed = game
  }

  /** This client's seat in the current world, or -1. */
  seat(): number {
    const world = this.snapshot.world
    return world === null ? -1 : seatOf(world, this.player.token)
  }
}
