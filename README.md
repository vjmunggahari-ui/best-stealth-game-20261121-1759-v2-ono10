# BLACKOUT: The Meridian Heist

[![make.fun · best-stealth-game-20261121-1759](https://make.fun/badge/best-stealth-game-20261121-1759.svg)](https://make.fun/bounty/best-stealth-game-20261121-1759?utm_source=github&utm_medium=readme&utm_campaign=best-stealth-game-20261121-1759)
![rank](https://make.fun/badge/best-stealth-game-20261121-1759/vjmunggahari-ui/best-stealth-game-20261121-1759-v2-ono10/rank.svg)
![reward](https://make.fun/badge/best-stealth-game-20261121-1759/vjmunggahari-ui/best-stealth-game-20261121-1759-v2-ono10/reward.svg)

A top-down stealth game for the [make.fun](https://make.fun) competition
**"Make the best stealth game"** (`best-stealth-game-20261121-1759`).
Six heists, twenty-four guards, forty treasures, five gadgets — and one rule:
never be seen.

## The game

You are the crew's ghost. In each of six jobs — the Dusk Gallery, the
Meridian Bank Vault, the Gilded Casino, Blackwood Manor, the Glasshouse and
the Sky Penthouse — steal the ★ star prize, pocket as many treasures as you
dare, and reach the EXIT unseen.

**Stealth systems**

- **Raycast vision cones** — guards see a real cone, blocked by walls.
- **Suspicion** — seen, lit, running or sneaking all change how fast a guard
  goes from curious to chasing. Break line of sight to cool down.
- **Noise** — running is loud, sneaking is silent, and a tossed pebble pulls
  guards to wherever it lands.
- **Light & shadow** — lamps light you up and speed detection; darkness hides
  you. Your own small pool of light follows you through the dark.
- **Hiding spots** — crates and vents (press `E`) where guards cannot see you.
- **Security cameras** — sweeping cones that raise the alarm; EMP kills them.
- **Alarms & lockdown** — three alarms and every guard is hunting.
- **Lockpicking** — hold still by a locked door to pick it, or spend a
  Lockpick Kit to open it instantly.
- **Five gadgets** — Pebble Lure, Smoke Bomb, EMP Pulse, Lockpick Kit,
  Shadow Cloak — restocked per heist.
- **Scoring** — loot, time against par, ghost bonus for never being spotted,
  ranks from C to S — GHOST.

## Play

```sh
node serve.ts        # then open http://localhost:8080
```

Or open `game/index.html` from any static server. No build step, no network,
no libraries — plain canvas, keyboard + mouse, sounds synthesised in code.

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Shift | Run (loud) |
| Ctrl / C | Sneak (silent) |
| E | Hide / pick a lock |
| 1–5 | Gadgets |
| Click | Toss a pebble at that spot |
| Esc | Menu |

## Hand-in

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
to the output directory and writes `dossier.json` with the vendored
`vendor/makefun-game.ts` library, then reads the dossier back and verifies it:
schema, byte-identical rebuild, every screenshot matching the file on disk,
cover first, all four sources present.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Screenshots

1. `01-cover.jpg` — The Dusk Gallery, mid-infiltration.
2. `02-alert.jpg` — Spotted in the Meridian Bank Vault.
3. `03-vault.jpg` — Smoke out in the Glasshouse.
4. `04-victory.jpg` — Clean getaway, rank S — GHOST.

## License

MIT — see [LICENSE](LICENSE).
