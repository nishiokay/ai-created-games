const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const COLS = 7, ROWS = 6, CELL = 78;
const TOP = 90;
canvas.width  = COLS * CELL;       // 546
canvas.height = TOP + ROWS * CELL; // 558
canvas.style.height = 'auto'; // CSS でアスペクト比を維持

const COL_P1    = '#e94560';
const COL_P2    = '#ffe066';
const COL_BG    = '#0d1b2a';
const COL_BOARD = '#0a2245';
const COL_EMPTY = '#081530';
const W = canvas.width, H = canvas.height;

// ── 状態 ──────────────────────────────────────────
let board, player, phase, winCells, vsAI, humanPlayer, hoverCol, aiPending;
let difficulty = 'normal';
let posScore = 0, posEvalDone = true; // 局面評価スコア (player1 視点)
// phase: 'select' | 'cpu_setup' | 'playing' | 'over'

function newGame(ai, humanP) {
  vsAI        = ai;
  humanPlayer = humanP;
  board       = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  player      = 1;
  phase       = 'playing';
  winCells    = null;
  hoverCol    = -1;
  aiPending   = false;
  TT.clear();
  posScore = 0; posEvalDone = true;
  if (vsAI && player !== humanPlayer) triggerAI();
}

// ── ゲームロジック ────────────────────────────────
function dropRow(col) {
  for (let r = ROWS - 1; r >= 0; r--) if (!board[r][col]) return r;
  return -1;
}

function checkWin(row, col) {
  const p = board[row][col];
  if (!p) return null;
  for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    const cells = [];
    for (let d = -3; d <= 3; d++) {
      const r = row + dr*d, c = col + dc*d;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === p) cells.push([r, c]);
      else cells.length = 0;
      if (cells.length >= 4) return [...cells];
    }
  }
  return null;
}

function isDraw() { return board[0].every(c => c !== 0); }

// ── 通常 minimax (easy / normal / hard) ──────────
function evalBoard(b, ai) {
  const hu = 3 - ai;
  let score = 0;
  function ws(w) {
    const me = w.filter(x => x === ai).length, op = w.filter(x => x === hu).length;
    if (me === 4) return 1000; if (op === 4) return -1000;
    if (me === 3 && op === 0) return 5; if (me === 2 && op === 0) return 2;
    if (op === 3 && me === 0) return -4; return 0;
  }
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS-4; c++)
      score += ws([b[r][c],b[r][c+1],b[r][c+2],b[r][c+3]]);
  for (let r = 0; r <= ROWS-4; r++)
    for (let c = 0; c < COLS; c++)
      score += ws([b[r][c],b[r+1][c],b[r+2][c],b[r+3][c]]);
  for (let r = 0; r <= ROWS-4; r++) {
    for (let c = 0; c <= COLS-4; c++)
      score += ws([b[r][c],b[r+1][c+1],b[r+2][c+2],b[r+3][c+3]]);
    for (let c = 3; c < COLS; c++)
      score += ws([b[r][c],b[r+1][c-1],b[r+2][c-2],b[r+3][c-3]]);
  }
  for (let r = 0; r < ROWS; r++) {
    if (b[r][3] === ai) score += 3;
    if (b[r][2] === ai || b[r][4] === ai) score += 2;
  }
  return score;
}

function hasWin(b, row, col, p) {
  for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    let n = 1;
    for(let i=1;i<4;i++){const r=row+dr*i,c=col+dc*i;if(r<0||r>=ROWS||c<0||c>=COLS||b[r][c]!==p)break;n++;}
    for(let i=1;i<4;i++){const r=row-dr*i,c=col-dc*i;if(r<0||r>=ROWS||c<0||c>=COLS||b[r][c]!==p)break;n++;}
    if (n >= 4) return true;
  }
  return false;
}

const COL_PREF = [3,2,4,1,5,0,6];

function minimax(b, depth, alpha, beta, isMax, ai) {
  const hu = 3 - ai;
  const valid = COL_PREF.filter(c => b[0][c] === 0);
  if (!valid.length) return { s: 0,             c: -1 };
  if (!depth)        return { s: evalBoard(b,ai), c: -1 };
  let bestC = valid[0];
  if (isMax) {
    let best = -Infinity;
    for (const c of valid) {
      let r = ROWS-1; while (r >= 0 && b[r][c]) r--;
      b[r][c] = ai;
      if (hasWin(b, r, c, ai)) { b[r][c] = 0; return { s: 100000 + depth, c }; }
      const { s } = minimax(b, depth-1, alpha, beta, false, ai);
      b[r][c] = 0;
      if (s > best) { best = s; bestC = c; }
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return { s: best, c: bestC };
  } else {
    let best = Infinity;
    for (const c of valid) {
      let r = ROWS-1; while (r >= 0 && b[r][c]) r--;
      b[r][c] = hu;
      if (hasWin(b, r, c, hu)) { b[r][c] = 0; return { s: -100000 - depth, c }; }
      const { s } = minimax(b, depth-1, alpha, beta, true, ai);
      b[r][c] = 0;
      if (s < best) { best = s; bestC = c; }
      beta = Math.min(beta, best);
      if (alpha >= beta) break;
    }
    return { s: best, c: bestC };
  }
}

// ── 置換表付き minimax (veryhard / depth 15) ─────
//
// Zobrist ハッシュ: 各 (row, col, player) に乱数を割り当て、
// 盤面状態を XOR で O(1) に更新・取り消しできる。
// 再帰時は hash を値渡しするので「戻し」は不要。
//
// 置換表 (TT): 同一局面を深さごとにキャッシュ。
// 局面数が大幅に削減され depth 15 が現実的な時間に収まる。

// Zobrist 乱数テーブル: ROWS × COLS × 2 (player 1/2)
const ZK = Array.from({ length: ROWS * COLS * 2 },
  () => (Math.random() * 0x80000000) | 0);

function zi(r, c, p) { return (r * COLS + c) * 2 + (p - 1); }

function computeHash(b) {
  let h = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (b[r][c]) h = (h ^ ZK[zi(r, c, b[r][c])]) | 0;
  return h;
}

// 置換表エントリのフラグ
const TT_EXACT = 0; // 厳密値
const TT_LOWER = 1; // 下限 (beta カットオフ)
const TT_UPPER = 2; // 上限 (alpha カットオフ)
const TT_MAX   = 1 << 20; // ~100万エントリ上限
const TT       = new Map();

function minimaxTT(b, depth, alpha, beta, isMax, ai, h) {
  const origAlpha = alpha, origBeta = beta;
  const hu = 3 - ai;

  // 置換表を参照
  const tte = TT.get(h);
  if (tte && tte.d >= depth) {
    if (tte.f === TT_EXACT) return { s: tte.s, c: tte.c };
    if (tte.f === TT_LOWER) alpha = Math.max(alpha, tte.s);
    if (tte.f === TT_UPPER) beta  = Math.min(beta,  tte.s);
    if (alpha >= beta) return { s: tte.s, c: tte.c };
  }

  const valid = COL_PREF.filter(c => b[0][c] === 0);
  if (!valid.length) return { s: 0,              c: -1 };
  if (!depth)        return { s: evalBoard(b, ai), c: -1 };

  let bestC = valid[0], bestS;

  if (isMax) {
    bestS = -Infinity;
    for (const c of valid) {
      let r = ROWS-1; while (r >= 0 && b[r][c]) r--;
      const nh = (h ^ ZK[zi(r, c, ai)]) | 0;
      b[r][c] = ai;
      if (hasWin(b, r, c, ai)) {
        b[r][c] = 0;
        TT.set(h, { d: depth, s: 100000 + depth, f: TT_EXACT, c });
        return { s: 100000 + depth, c };
      }
      const { s } = minimaxTT(b, depth-1, alpha, beta, false, ai, nh);
      b[r][c] = 0;
      if (s > bestS) { bestS = s; bestC = c; }
      alpha = Math.max(alpha, bestS);
      if (alpha >= beta) break;
    }
  } else {
    bestS = Infinity;
    for (const c of valid) {
      let r = ROWS-1; while (r >= 0 && b[r][c]) r--;
      const nh = (h ^ ZK[zi(r, c, hu)]) | 0;
      b[r][c] = hu;
      if (hasWin(b, r, c, hu)) {
        b[r][c] = 0;
        TT.set(h, { d: depth, s: -100000 - depth, f: TT_EXACT, c });
        return { s: -100000 - depth, c };
      }
      const { s } = minimaxTT(b, depth-1, alpha, beta, true, ai, nh);
      b[r][c] = 0;
      if (s < bestS) { bestS = s; bestC = c; }
      beta = Math.min(beta, bestS);
      if (alpha >= beta) break;
    }
  }

  // 置換表に書き込み（容量超過時は全クリア）
  if (TT.size >= TT_MAX) TT.clear();
  const flag = bestS <= origAlpha ? TT_UPPER
             : bestS >= origBeta  ? TT_LOWER
             : TT_EXACT;
  TT.set(h, { d: depth, s: bestS, f: flag, c: bestC });
  return { s: bestS, c: bestC };
}

// ── 難易度ごとの手の選択 ─────────────────────────
function chooseAICol(ai) {
  const copy = board.map(r => [...r]);
  const valid = COL_PREF.filter(c => copy[0][c] === 0);

  if (difficulty === 'easy') {
    // 即詰み・即ブロックのみ検出、他はランダム
    for (const c of valid) {
      let r = ROWS-1; while (r >= 0 && copy[r][c]) r--;
      copy[r][c] = ai;
      if (hasWin(copy, r, c, ai)) { copy[r][c] = 0; return c; }
      copy[r][c] = 0;
    }
    const hu = 3 - ai;
    for (const c of valid) {
      let r = ROWS-1; while (r >= 0 && copy[r][c]) r--;
      copy[r][c] = hu;
      if (hasWin(copy, r, c, hu)) { copy[r][c] = 0; return c; }
      copy[r][c] = 0;
    }
    return valid[Math.floor(Math.random() * valid.length)];
  }

  if (difficulty === 'normal') {
    const { c } = minimax(copy, 4, -Infinity, Infinity, true, ai);
    return c;
  }

  if (difficulty === 'hard') {
    const { c } = minimax(copy, 7, -Infinity, Infinity, true, ai);
    return c;
  }

  // veryhard: depth 15 + 置換表
  const h = computeHash(copy);
  const { c } = minimaxTT(copy, 15, -Infinity, Infinity, true, ai, h);
  return c;
}

function triggerAI() {
  aiPending = true;
  const ai = 3 - humanPlayer;
  // veryhard は時間がかかるので少し間を置いて描画を先に確定させる
  const delay = difficulty === 'veryhard' ? 50 : (difficulty === 'easy' ? 300 : 80);
  setTimeout(() => {
    const col = chooseAICol(ai);
    aiPending = false;
    if (col >= 0) playCol(col);
  }, delay);
}

// ── 局面評価 ──────────────────────────────────────
// player1 視点スコアを depth 4 で算出（どの難易度でも独立して実行）
function evalPosition() {
  if (phase !== 'playing') return;
  posEvalDone = false;
  setTimeout(() => {
    if (phase !== 'playing') { posEvalDone = true; return; }
    const copy = board.map(r => [...r]);
    // isMax=true なら player1 の番、false なら player2 の番
    const { s } = minimax(copy, 4, -Infinity, Infinity, player === 1, 1);
    posScore    = s;
    posEvalDone = true;
  }, 12);
}

// スコアを [-1, 1] に正規化（tanh でなめらかに）
function normalizeEval(s) {
  if (s >=  10000) return  1;
  if (s <= -10000) return -1;
  return Math.tanh(s / 25);
}

// 正規化値からラベル文字列
function evalLabel(n) {
  if (n >=  0.85) return '先行 勝勢';
  if (n >=  0.35) return '先行 有利';
  if (n >=  0.10) return 'やや先行 有利';
  if (n <= -0.85) return '後攻 勝勢';
  if (n <= -0.35) return '後攻 有利';
  if (n <= -0.10) return 'やや後攻 有利';
  return '互角';
}

// ── 描画ユーティリティ ────────────────────────────
function pColor(p) { return p === 1 ? COL_P1 : COL_P2; }
function pLabel(p) {
  if (!vsAI) return p === 1 ? 'プレイヤー1' : 'プレイヤー2';
  return p === humanPlayer ? 'あなた' : 'CPU';
}
function colX(c) { return c * CELL + CELL / 2; }
function cellY(r) { return TOP + r * CELL + CELL / 2; }

function circle(x, y, rad, fill, glowColor) {
  ctx.save();
  if (glowColor) { ctx.shadowColor = glowColor; ctx.shadowBlur = 26; }
  ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  if (fill !== COL_EMPTY) {
    ctx.beginPath();
    ctx.arc(x - rad*0.22, y - rad*0.22, rad*0.38, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fill();
  }
  ctx.restore();
}

function btn(cx, cy, bw, bh, text, accent, selected) {
  const x = cx - bw/2, y = cy - bh/2;
  ctx.fillStyle = selected ? accent + '33' : '#0e2040';
  ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 8); ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 8); ctx.stroke();
  ctx.fillStyle = selected ? '#fff' : accent;
  ctx.textAlign = 'center';
  ctx.font = `${selected ? 'bold ' : ''}16px Arial, sans-serif`;
  ctx.fillText(text, cx, cy + 6);
}

function getCanvasXY(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (W / rect.width),
    y: (e.clientY - rect.top)  * (H / rect.height),
  };
}
function hit(e, cx, cy, bw, bh) {
  const { x, y } = getCanvasXY(e);
  return x >= cx-bw/2 && x <= cx+bw/2 && y >= cy-bh/2 && y <= cy+bh/2;
}

// ── 難易度定義 ────────────────────────────────────
const DIFF_LEVELS = [
  { key: 'easy',     label: 'かんたん',          color: '#44dd88',
    desc: '即詰み・即ブロックのみ。ランダム。' },
  { key: 'normal',   label: 'ふつう',             color: '#ffe066',
    desc: '4手先読み。ミスあり。' },
  { key: 'hard',     label: 'むずかしい',         color: '#e94560',
    desc: '7手先読み。後攻でも勝機あり。' },
  { key: 'veryhard', label: 'とてもむずかしい',   color: '#cc44ff',
    desc: '15手先読み＋置換表。強敵。' },
];

// 難易度ボタン配置 (4 in a row)
// W=546: margin=26, btn_w=116, gap=10 → centers at 84,210,336,462
const DIFF_BTN_W  = 116, DIFF_BTN_H = 40, DIFF_BTN_Y = 128;
const DIFF_BTN_XS = [84, 210, 336, 462];

// ── 画面描画 ──────────────────────────────────────
function drawSelect() {
  ctx.fillStyle = COL_BG; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#00e5ff';
  ctx.font = 'bold 34px Arial, sans-serif';
  ctx.fillText('4目並べ', W/2, 80);
  ctx.fillStyle = '#6688aa'; ctx.font = '13px Arial, sans-serif';
  ctx.fillText('縦・横・斜めに4つ並べると勝ち！', W/2, 108);
  circle(W/2 - 22, 152, 16, COL_P1); circle(W/2 + 22, 152, 16, COL_P2);
  btn(W/2, 232, 220, 54, 'CPU と対戦', '#00e5ff', false);
  btn(W/2, 310, 220, 54, '2人で対戦',  '#ffe066', false);
  ctx.textAlign = 'left';
}

function drawCpuSetup() {
  ctx.fillStyle = COL_BG; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#00e5ff';
  ctx.font = 'bold 22px Arial, sans-serif';
  ctx.fillText('CPU対戦の設定', W/2, 46);

  // ── 難易度 ──
  ctx.fillStyle = '#aaddff'; ctx.font = 'bold 12px Arial, sans-serif';
  ctx.fillText('難易度', W/2, 96);

  for (let i = 0; i < DIFF_LEVELS.length; i++) {
    const d = DIFF_LEVELS[i];
    btn(DIFF_BTN_XS[i], DIFF_BTN_Y, DIFF_BTN_W, DIFF_BTN_H, d.label, d.color, difficulty === d.key);
  }

  const sel = DIFF_LEVELS.find(d => d.key === difficulty);
  ctx.fillStyle = sel.color + 'bb'; ctx.font = '12px Arial, sans-serif';
  ctx.fillText(sel.desc, W/2, 168);

  // ── 先行・後攻 ──
  ctx.fillStyle = '#aaddff'; ctx.font = 'bold 12px Arial, sans-serif';
  ctx.fillText('先行・後攻', W/2, 212);

  circle(W/2 - 98, 265, 18, COL_P1);
  ctx.fillStyle = '#aaa'; ctx.font = '11px Arial, sans-serif';
  ctx.fillText('あなた = 赤（先行）', W/2, 300);
  btn(W/2, 334, 210, 48, '先行でプレイ', COL_P1, false);

  circle(W/2 + 98, 265, 18, COL_P2);
  ctx.fillStyle = '#aaa';
  ctx.fillText('あなた = 黄（後攻）', W/2, 404);
  btn(W/2, 438, 210, 48, '後攻でプレイ', COL_P2, false);

  ctx.textAlign = 'left';
}

function drawGame() {
  ctx.fillStyle = COL_BG; ctx.fillRect(0, 0, W, H);

  let statusText, statusColor;
  if (phase === 'over') {
    statusText  = winCells ? `${pLabel(player)} の勝ち！` : '引き分け';
    statusColor = winCells ? pColor(player) : '#aaaaaa';
  } else if (aiPending) {
    statusText  = difficulty === 'veryhard' ? 'CPU 思考中... (depth 15)' : 'CPU 思考中...';
    statusColor = pColor(player);
  } else {
    statusText  = `${pLabel(player)} のターン`;
    statusColor = pColor(player);
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = statusColor;
  ctx.font = 'bold 20px Arial, sans-serif';
  ctx.fillText(statusText, W/2, 30);

  if (phase === 'over') {
    ctx.fillStyle = '#6688aa'; ctx.font = '12px Arial, sans-serif';
    ctx.fillText('R キー またはクリックでリスタート', W/2, 54);
  } else {
    circle(W/2 - 82, 22, 9, pColor(player));
    if (vsAI) {
      const dl = DIFF_LEVELS.find(d => d.key === difficulty);
      ctx.fillStyle = dl.color + 'aa'; ctx.font = '11px Arial, sans-serif';
      ctx.fillText(dl.label, W/2 + 60, 27);
    }
  }

  // ── 局面評価バー ──
  {
    const BAR_W = 260, BAR_H = 9;
    const bx = W/2 - BAR_W/2, by = 50;
    const norm = normalizeEval(posScore);

    // 背景
    ctx.fillStyle = '#111e30';
    ctx.fillRect(bx, by, BAR_W, BAR_H);

    // 有利側を塗る
    if (norm > 0) {
      ctx.fillStyle = COL_P1;
      ctx.fillRect(W/2, by, norm * BAR_W/2, BAR_H);
    } else if (norm < 0) {
      ctx.fillStyle = COL_P2;
      const fw = -norm * BAR_W/2;
      ctx.fillRect(W/2 - fw, by, fw, BAR_H);
    }

    // 中央ライン
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(W/2 - 1, by, 2, BAR_H);

    // 先行 / 後攻 端ラベル
    ctx.font = '10px Arial, sans-serif';
    ctx.fillStyle = COL_P1 + 'cc'; ctx.textAlign = 'left';
    ctx.fillText('先', bx + 3, by + BAR_H - 1);
    ctx.fillStyle = COL_P2 + 'cc'; ctx.textAlign = 'right';
    ctx.fillText('後', bx + BAR_W - 3, by + BAR_H - 1);

    // 評価テキスト
    const labelStr = posEvalDone ? evalLabel(norm) : '...';
    const labelColor = norm >=  0.10 ? COL_P1
                     : norm <= -0.10 ? COL_P2
                     : '#8899aa';
    ctx.fillStyle = labelColor;
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px Arial, sans-serif';
    ctx.fillText(labelStr, W/2, by + BAR_H + 13);
  }

  ctx.fillStyle = COL_BOARD;
  ctx.fillRect(0, TOP, W, ROWS * CELL);

  if (phase === 'playing' && !aiPending && hoverCol >= 0 && hoverCol < COLS) {
    const r = dropRow(hoverCol);
    if (r >= 0) {
      const x = colX(hoverCol);
      ctx.fillStyle = pColor(player);
      ctx.beginPath();
      ctx.moveTo(x, TOP-10); ctx.lineTo(x-10, TOP-24); ctx.lineTo(x+10, TOP-24);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.28;
      circle(x, cellY(r), CELL/2-6, pColor(player));
      ctx.globalAlpha = 1;
    }
  }

  const winSet = winCells ? new Set(winCells.map(([r,c]) => `${r},${c}`)) : null;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = colX(c), y = cellY(r), cell = board[r][c];
      const isWin = winSet && winSet.has(`${r},${c}`);
      circle(x, y, CELL/2-6, cell ? pColor(cell) : COL_EMPTY, isWin ? pColor(cell) : null);
    }
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c*CELL, TOP); ctx.lineTo(c*CELL, H); ctx.stroke();
  }
  ctx.textAlign = 'left';
}

function draw() {
  if      (phase === 'select')    drawSelect();
  else if (phase === 'cpu_setup') drawCpuSetup();
  else                            drawGame();
}

// ── 入力 ──────────────────────────────────────────
canvas.addEventListener('mousemove', e => {
  if (phase !== 'playing' || aiPending) return;
  const { x } = getCanvasXY(e);
  hoverCol = Math.min(COLS-1, Math.max(0, Math.floor(x / CELL)));
});
canvas.addEventListener('mouseleave', () => { hoverCol = -1; });

canvas.addEventListener('click', e => {
  if (phase === 'select') {
    if (hit(e, W/2, 232, 220, 54)) { phase = 'cpu_setup'; return; }
    if (hit(e, W/2, 310, 220, 54)) { newGame(false, 1);   return; }
    return;
  }
  if (phase === 'cpu_setup') {
    for (let i = 0; i < DIFF_LEVELS.length; i++) {
      if (hit(e, DIFF_BTN_XS[i], DIFF_BTN_Y, DIFF_BTN_W, DIFF_BTN_H)) {
        difficulty = DIFF_LEVELS[i].key; return;
      }
    }
    if (hit(e, W/2, 334, 210, 48)) { newGame(true, 1); return; }
    if (hit(e, W/2, 438, 210, 48)) { newGame(true, 2); return; }
    return;
  }
  if (phase === 'over') { phase = 'select'; return; }
  if (aiPending || (vsAI && player !== humanPlayer)) return;
  const { x } = getCanvasXY(e);
  playCol(Math.floor(x / CELL));
});

document.addEventListener('keydown', e => {
  if (e.code === 'KeyR') { phase = 'select'; return; }
  if (phase !== 'playing' || aiPending) return;
  if (vsAI && player !== humanPlayer) return;
  if (e.code === 'ArrowLeft')  hoverCol = Math.max(0,      (hoverCol < 0 ? 3 : hoverCol) - 1);
  if (e.code === 'ArrowRight') hoverCol = Math.min(COLS-1, (hoverCol < 0 ? 3 : hoverCol) + 1);
  if (e.code === 'Enter' || e.code === 'Space') {
    e.preventDefault();
    if (hoverCol >= 0) playCol(hoverCol);
  }
});

// ── プレイ処理 ────────────────────────────────────
function playCol(col) {
  if (col < 0 || col >= COLS) return;
  const row = dropRow(col);
  if (row < 0) return;
  board[row][col] = player;
  winCells = checkWin(row, col);
  if (winCells || isDraw()) { phase = 'over'; return; }
  player = 3 - player;
  if (vsAI && player !== humanPlayer) triggerAI();
  evalPosition(); // 手を打つたびに局面評価を更新
}

// ── タッチ対応 ────────────────────────────────────
// touchend → click をシミュレート（getCanvasXY がスケール補正済み）
canvas.addEventListener('touchend', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  canvas.dispatchEvent(new MouseEvent('click', {
    clientX: t.clientX, clientY: t.clientY, bubbles: true,
  }));
}, { passive: false });

// touchmove → ホバー列更新
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (phase !== 'playing' || aiPending) return;
  const { x } = getCanvasXY(e.touches[0]);
  hoverCol = Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL)));
}, { passive: false });

// ── メインループ ──────────────────────────────────
phase = 'select';
(function loop() { draw(); requestAnimationFrame(loop); })();
