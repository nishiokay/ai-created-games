# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Server

```bash
npx http-server . -p 8080 --cors -c-1
```

`-c-1` disables caching. After editing files, a hard reload (`Ctrl+Shift+R`) in the browser is sufficient — no server restart needed.

## Architecture

This repository contains a game portal (`index.html`) and two standalone browser games, each self-contained in a single HTML + JS pair with no build step or dependencies.

### ポータル — `index.html`

Static page linking to both games. No JS.

### ブロック崩し (Breakout) — `breakout.html` / `main.js`

Single-file game loop pattern:
- Constants at top define all sizes/speeds
- `initGame()` resets all mutable state (`paddle`, `ball`, `bricks`, `score`, `lives`, `state`)
- `state` machine: `'idle'` → `'playing'` → `'gameover'` | `'clear'`
- `loop()` calls `update()` then `draw()` each frame via `requestAnimationFrame`
- Collision response uses AABB overlap comparison to determine which axis to reflect

### テトリス — `tetris.html` / `tetris.js`

Follows Sega Tetris (1988) arcade specifications:
- **Screen**: 640×448px canvas (equivalent to System 16's 320×224 at 2×, rendered natively to avoid blur)
- **Scoring**: single=100, double=400, triple=900, tetris=2000 (no level multiplier)
- **Level progression**: every 4 lines cleared
- **Drop speed**: lookup table `DROP_INTERVAL_TABLE` (not linear), matching Sega Normal difficulty
- All UI (score, level, lines, ranking, next piece, controls) is drawn on the canvas — there are no HTML UI elements
- Layout: left panel (score/level/lines/ranking) | center field (10×20, `BLOCK=20px`) | right panel (next piece/controls)
- `state` machine: `'playing'` → `'name_entry'` | `'gameover'`
- High scores (top 5) are persisted in `localStorage` under key `tetris_highscores`
- Name entry uses arrow keys to cycle A–Z across 3 character slots, Enter/Space to confirm
- **Rotation**: counterclockwise only, no wall kicks (Sega Rotation system)
- **Hard drop**: Space key (non-original, added for playability)
