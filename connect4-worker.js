// Perfect Connect4 solver — Web Worker
// Bitboard negamax with alpha-beta pruning + transposition table
// Based on Pascal Pons' solver algorithm

const COLS = 7, ROWS = 6, H7 = 7; // H7: bits per column (6 playable + 1 sentinel)

// Precomputed bit masks
const BOTTOM_MASKS = Array.from({ length: COLS }, (_, c) => 1n << BigInt(c * H7));
const TOP_MASKS    = Array.from({ length: COLS }, (_, c) => 1n << BigInt(ROWS - 1 + c * H7));

// Lowest bit per column (pre-summed for BOTTOM constant)
const BOTTOM = BOTTOM_MASKS.reduce((a, b) => a | b, 0n);

// Check if a position has any 4-in-a-row
function alignment(pos) {
  let m;
  m = pos & (pos >> 7n); if (m & (m >> 14n)) return true; // horizontal
  m = pos & (pos >> 1n); if (m & (m >>  2n)) return true; // vertical
  m = pos & (pos >> 8n); if (m & (m >> 16n)) return true; // diagonal /
  m = pos & (pos >> 6n); if (m & (m >> 12n)) return true; // diagonal \
  return false;
}

// Score: positive = current player wins, 0 = draw, negative = loses
// |score| = (remaining empty cells + 1) / 2
const MAX_SCORE =  Math.floor((COLS * ROWS + 1) / 2 - 3); //  18
const MIN_SCORE = -Math.floor(COLS * ROWS / 2 - 3);        // -18

// Fixed-size transposition table
const TT_SIZE = 8388617; // large prime ~8M entries
const TT_KEYS = new BigInt64Array(TT_SIZE);
const TT_VALS = new Int8Array(TT_SIZE);

function ttGet(key) {
  const idx = Number(key % BigInt(TT_SIZE));
  return TT_KEYS[idx] === key ? TT_VALS[idx] : 0;
}
function ttPut(key, val) {
  const idx = Number(key % BigInt(TT_SIZE));
  TT_KEYS[idx] = key;
  TT_VALS[idx] = val;
}
function ttReset() { TT_KEYS.fill(0n); TT_VALS.fill(0); }

// Unique position key: pos + mask + bottom_row_mask
function posKey(pos, mask) { return pos + mask + BOTTOM; }

// Column search order: center columns first (better pruning)
const COL_ORDER = [3, 2, 4, 1, 5, 0, 6];

function negamax(pos, mask, moves, alpha, beta) {
  if (moves >= COLS * ROWS) return 0; // draw

  // Check if current player can win on next move
  for (let i = 0; i < COLS; i++) {
    const c = COL_ORDER[i];
    if (mask & TOP_MASKS[c]) continue; // column full
    const nm = mask | (mask + BOTTOM_MASKS[c]);
    if (alignment(pos | (nm ^ mask))) {
      return Math.floor((COLS * ROWS + 1 - moves) / 2);
    }
  }

  // Upper bound tightening
  const max = Math.floor((COLS * ROWS - 1 - moves) / 2);
  if (beta > max) { beta = max; if (alpha >= beta) return beta; }

  // Transposition table lookup
  const key = posKey(pos, mask);
  const ttv = ttGet(key);
  if (ttv > 0) {
    const lb = ttv + MIN_SCORE - 1;
    if (lb > alpha) { alpha = lb; if (alpha >= beta) return alpha; }
  } else if (ttv < 0) {
    const ub = ttv + MAX_SCORE;
    if (ub < beta) { beta = ub; if (alpha >= beta) return beta; }
  }

  // Recurse over columns
  for (let i = 0; i < COLS; i++) {
    const c = COL_ORDER[i];
    if (mask & TOP_MASKS[c]) continue;
    const nm = mask | (mask + BOTTOM_MASKS[c]);
    // After playing c, opponent becomes the current player (pos and mask flipped)
    const score = -negamax(mask ^ pos, nm, moves + 1, -beta, -alpha);
    if (score >= beta) { ttPut(key, score - MIN_SCORE + 1); return score; }
    if (score > alpha) alpha = score;
  }

  ttPut(key, alpha - MAX_SCORE);
  return alpha;
}

// Find the best column to play; also returns the score of that move
function bestMove(pos, mask, moves) {
  if (moves === 0) return { col: 3, score: MAX_SCORE }; // center is always optimal first move

  // First pass: check for immediate win
  for (let i = 0; i < COLS; i++) {
    const c = COL_ORDER[i];
    if (mask & TOP_MASKS[c]) continue;
    const nm = mask | (mask + BOTTOM_MASKS[c]);
    if (alignment(pos | (nm ^ mask))) return { col: c, score: Math.floor((COLS * ROWS + 1 - moves) / 2) };
  }

  let bestCol = -1, bestScore = -Infinity;
  for (let i = 0; i < COLS; i++) {
    const c = COL_ORDER[i];
    if (mask & TOP_MASKS[c]) continue;
    const nm = mask | (mask + BOTTOM_MASKS[c]);
    const score = -negamax(mask ^ pos, nm, moves + 1, -MAX_SCORE, MAX_SCORE);
    if (score > bestScore) { bestScore = score; bestCol = c; }
  }

  // Fallback if all columns somehow skipped
  if (bestCol < 0) bestCol = COL_ORDER.find(c => !(mask & TOP_MASKS[c]));
  return { col: bestCol, score: bestScore };
}

// Convert game board (row 0=top, 1/2 = player pieces) to bitboard
// Bitboard: bit = col*7 + row_from_bottom
function boardToBitboard(board, currentPlayer) {
  let pos = 0n, mask = 0n;
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (board[r][c]) {
        const bitrow = ROWS - 1 - r; // row 0 = top of array → bottom of bitboard
        const bit = BigInt(c * H7 + bitrow);
        mask |= 1n << bit;
        if (board[r][c] === currentPlayer) pos |= 1n << bit;
      }
    }
  }
  return { pos, mask };
}

self.onmessage = function({ data }) {
  const { board, currentPlayer } = data;
  ttReset();
  const { pos, mask } = boardToBitboard(board, currentPlayer);
  let moveCount = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (board[r][c]) moveCount++;
  const { col, score } = bestMove(pos, mask, moveCount);
  self.postMessage({ col, score });
};
