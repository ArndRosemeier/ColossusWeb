# Online play over GameHub — design

**STATUS: BUILT** (ledger row 16). It replaces the ServerStore design (ledger rows
6–11, 15), whose full text is in git history (`git show 068b0af:docs/design/multiplayer.md`).

## 1 · The intent

The owner, verbatim:

> "I now have a dedicated game server (what you need to know is in the gameserver
> repo). I would like you to change our online functionality to that server instead."

GameHub (`https://games.futuremagic.de`, documented in the `gameserver` repo:
`README.md`, `docs/PROTOCOL.md`, `docs/PATTERNS.md`, `docs/LOBBY.md`) is a universal
in-memory relay: rooms with 6-character codes, a public lobby pushed over a
WebSocket, one **host** per room who publishes state, and messages between players.
It replaces ServerStore as the channel. What the owner felt with ServerStore — a 2 s
poll, keys to paste, a rate limiter to wait out, games to delete by hand — goes away.

## 2 · What changed, and what did not

| | ServerStore (before) | GameHub (now) |
| --- | --- | --- |
| Identity | a ServerStore key per player, validated by `whoami` | a random stable token in `localStorage` plus a typed name — nothing to paste |
| Lobby | list `game.` objects every 5 s | `watchLobby` — pushed by the server |
| A move | `PUT` a snapshot; others poll every 2 s | send the state to the host; the host checks it and `setState`s it to everyone at once |
| Who decides order | snapshot NAMES (`turn.seq.tag`) and fork detection | the host: a move names the `rev` it was built on; a stale one is refused |
| Turn authority | `actingPlayerIds`, client-side | the SAME `actingPlayerIds`, enforced by the host on every move |
| Persistence | the store keeps everything for ever | GameHub keeps nothing; every client keeps its copy, and a seated player can re-open the game |
| Cleanup | a delete flow (store keys lacked `delete`) | none needed — an empty room disappears after 60 s |
| Secrets | honour system (the shared state holds every legion) | unchanged |
| Dice | the thrower's faces travel in the state | unchanged |

## 3 · The model

- **App**: `colossusweb`, key mode. The key ships in the bundle (`VITE_GAMEHUB_KEY`,
  `web/src/net/hubConfig.ts`); it is not a secret.
- **Room meta** (what the lobby shows): `{kind:'colossus', v, gameId, variant, status,
  maxPlayers, members}`. Rooms of another kind or protocol version are not listed.
- **`RoomWorld`** (the host's `setState`): members (token, name, current connection),
  seats (tokens, fixed at Start in join order), `rev`, `lastBy`, and the game in the
  ONE save format (`serializeGame`).
- **Intents** to the host: `hello` (on every join, and again after a host change),
  `leave` (lobby only), `commit {base, game}`, `backup`. The host replies to one player
  with `rejected {code, message}` or `send-backup`.
- **The host's rules are pure** (`web/src/net/room.ts`): `game_full`, `not_seated`,
  `not_your_turn`, `stale_move`, `bad_world`.

### Quick moves
A player may make several moves before the first comes back. Each `commit` names the
rev it expects to follow (`base`), the client counts its own in-flight moves, and the
echo of its own accepted move is not re-adopted (it already shows it) — so a split
followed at once by a move does not flicker or get refused as stale.

### Host migration and reconnect
GameHub promotes the lowest remaining player id when the host leaves. The new host
reconciles presence against `hub.players`, applies any move of its own the old host
never confirmed, and republishes. Everyone else re-sends `hello` and any unconfirmed
move. A dropped socket reconnects with backoff (1 s … 30 s) and rejoins its room; the
token puts the player back in its seat.

### When the room is gone
GameHub deletes an empty room after 60 s and keeps nothing on disk. Every client
writes the latest world to `localStorage` (`colossusweb.online.v1`). On the setup
screen, a remembered game whose room is gone is offered as **Re-open game** (seated
players only); the others see it in the lobby as "(yours)" by its `gameId` and
**Rejoin**. If a rejoiner's copy is newer than the re-opened one, the host asks for it
and takes it.

### The lobby page
`apps.futuremagic.de/lobby/` lists a game once `apps.json` carries a `gamehub` block
for it (`docs/LOBBY.md` in the gameserver repo). The app honours its Join link,
`?room={code}`, by joining that room on load.

### cued.de
[cued](https://cued.de) (Frank Zimmer's friends' portal) can list the game as a guest
game: it frames `https://apps.futuremagic.de/ColossusWeb/` and appends a signed pass,
`#cued=<JWT>` (gameserver repo, `docs/CUED.md`). `web/src/net/cued.ts` is copied
verbatim from that repo; `web/src/net/cuedPlayer.ts` is the ONE reader.

- The pass is read once at startup, stripped from the address bar and kept for the
  tab. Without one the app is unchanged.
- **Display only** — the browser cannot verify the signature, and the cued key must
  never ship. The badge shows the cued name and avatar, and online play uses the cued
  name (locked in the lobby), so friends see each other under their cued names.
- A malformed pass is shown as `bad_cued_pass`; an expired one asks the player to
  reopen the game from cued and its name is not used.
- **Invitations**: a game created while the pass carries a `raum` puts it in the room
  meta (`cuedRaum`); a player whose pass carries the same `raum` joins that game by
  itself as soon as it is listed. This is ready for cued's invitation bridge.
- The sandbox forbids modal dialogs, top-window navigation and downloads; the app uses
  none. `apps.futuremagic.de` sends no `X-Frame-Options`/CSP, so it can be framed
  (checked 2026-10-24).
- Not built: results/HiScores to cued (needs a server endpoint holding the cued key).

## 4 · Limits

- 1 MiB per message: a 6-player AI game measured ~35 KB at round 22 (the log grows
  with the game), so a long game stays far below it.
- 60 messages/s per player: Colossus sends one message per move.
- The honour system is unchanged: any player's client could forge a state for its own
  turn, or read the hidden legions in the shared state. The host checks only WHOSE
  turn it is, not whether the move is legal.

## 5 · Owner actions

1. The app is registered on the box as `colossusweb` and its key was minted
   (2026-10-24). If it is ever re-registered, use `--max-players 13` or more: the
   largest variant has 9 seats and the client asks for 4 spare connections.
2. The key is committed in `web/.env` (the owner's call, 2026-10-24: the gameserver
   README says app keys are not secrets, since the bundle ships them anyway). Override
   it in `web/.env.local`. A build without any key shows `hub_not_configured`.
3. To list the game on cued: a member with the developer flag registers it at
   `https://cued.de/entwickler/` with the address `https://apps.futuremagic.de/ColossusWeb/`.
   The cued key it shows is a SECRET: the client does not need it, so keep it off the
   repo (it is only for a future server that verifies passes).
4. Optional: add the `gamehub` block to ColossusWeb's entry in `apps.json` —
   `{"app": "colossusweb", "key": "<the key>", "join": "?room={code}"}` — so the game
   shows on `apps.futuremagic.de/lobby/`.
