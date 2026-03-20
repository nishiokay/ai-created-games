# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Server

```bash
npx http-server . -p 8080 --cors -c-1
```

`-c-1` disables caching. After editing files, a hard reload (`Ctrl+Shift+R`) in the browser is sufficient — no server restart needed.

## Architecture

This repository contains a game portal (`index.html`) and four standalone browser games, each self-contained in a single HTML + JS pair with no build step or dependencies.

### ポータル — `index.html`

Static page with card links to all four games. No JS.

### ブロック崩し (Breakout) — `breakout.html` / `main.js`

- `initGame()` resets all mutable state; `state` machine: `'idle'` → `'playing'` → `'gameover'` | `'clear'`
- `loop()` calls `update()` then `draw()` via `requestAnimationFrame`
- Collision response uses AABB overlap comparison to determine which axis to reflect
- **Multiple balls**: `balls` array (multi-ball item creates 4 extra balls at spread angles); ball death triggers life loss only when `balls.every(b => !b.launched)`
- **Item system**: every 20 bricks destroyed spawns a falling item (multiball / speed×2 / 5s invincible); `lastItemType` prevents consecutive same type; speed item guards `speedMultiplier === 1` to prevent stacking
- **Pause**: `paused` flag toggled by P key or `#pause-btn`; button lives in `#bottom-row` (below canvas, right of back link)

### テトリス — `tetris.html` / `tetris.js`

Follows Sega Tetris (1988) arcade specifications:
- **Screen**: 640×448px canvas (320×224 at 2×, rendered natively to avoid blur)
- **Scoring**: single=100, double=400, triple=900, tetris=2000 (no level multiplier)
- **Level progression**: every 4 lines cleared; drop speed via `DROP_INTERVAL_TABLE` (non-linear)
- All UI drawn on canvas — no HTML UI elements except `#pause-btn`
- Layout: left panel (score/level/lines/ranking) | center field (10×20, `BLOCK=20px`) | right panel (next piece/controls)
- `state` machine: `'title'` → `'playing'` → `'name_entry'` | `'gameover'`; title screen ensures user gesture before BGM starts
- **7-bag randomizer**: `pieceBag` shuffled on empty, guarantees each of 7 pieces before repeating; prevents consecutive same-piece runs
- High scores (top 5) persisted in `localStorage` under key `tetris_highscores`
- **Rotation**: counterclockwise only, no wall kicks (Sega system); Space = hard drop (non-original)
- BGM (Korobeiniki) via Web Audio API; `tryStartBGM()` called from all input handlers to satisfy autoplay policy

### 4目並べ (Connect Four) — `connect4.html` / `connect4.js`

- State phases: `'mode'` → `'cpu_setup'` | `'p2_setup'` → `'ready'` → `'playing'` → `'over'`
- CPU AI: minimax with alpha-beta pruning; difficulty controls search depth (easy/normal/hard/veryhard=9)
- Veryhard uses transposition table with Zobrist hashing; depth capped at 9 (depth=15 caused browser hang on first move as 後攻)
- Difficulty buttons laid out 2×2 (240px wide) to fit "とてもむずかしい" without overflow
- Difficulty label drawn at `x=54` (far left) to avoid overlapping status/turn text
- **Undo (待った)**: 3 uses per game; allowed during both `'playing'` and `'over'` phases; undo button click is checked before phase-based routing in click handler

### エアーホッケー (Air Hockey) — `airhockey.html` / `airhockey.js`

- Portrait canvas 420×620; player (cyan) at bottom, CPU/P2 (red) at top; goals are horizontal cutouts (`GOAL_W=140`) centered on each end wall
- State machine: `'select'` → `'ready'` → `'playing'` → `'scored'` → `'gameover'`; first to 7 wins
- **Mode select**: "CPU と対戦" or "2人で対戦" (2P designed for shared iPhone/iPad)
- **Multi-touch**: bottom-half touch → P1 paddle; top-half touch → P2 paddle (2P mode); each tracked by `touchId`
- **Physics**: circle-circle collision; paddle sticking prevented by checking `dot < 0` (relative velocity) before reflecting — uses `puck.vy - padVy` to account for moving paddle
- **CPU AI**: always chases puck when `puck.y < H/2` (own half), plus intercept when puck moving toward CPU
- **Sound**: Web Audio API synthesized effects (wall hit, paddle hit, goal fanfare, win/lose melodies); `ensureAudio()` called on first interaction
