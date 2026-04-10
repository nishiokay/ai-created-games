'use strict';
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

const COLS = 7, ROWS = 6, CELL = 78;
const TOP = 90;
canvas.width  = COLS * CELL; // 546
canvas.height = TOP + ROWS * CELL; // 558

const COL_P1    = '#e94560';
const COL_P2    = '#ffe066';
const COL_BG    = '#0d1b2a';
const COL_BOARD = '#0a2245';
const COL_EMPTY = '#081530';
const W = canvas.width, H = canvas.height;

// ── State ──────────────────────────────────────────
let board, player, phase, winCells, humanPlayer, hoverCol;
let aiPending = false, aiScore = null;
let undoStack, undosLeft;
let fallingPiece = null;
let worker = null;
// phases: 'setup' | 'playing' | 'over'

function initWorker() {
  if (worker) worker.terminate();
  worker = new Worker('connect4-worker.js');
  worker.onmessage = function({ data }) {
    aiPending = false;
    aiScore   = data.score;
    if (data.col >= 0) playCol(data.col);
  };
}

function newGame(humanP) {
  humanPlayer = humanP;
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  player    = 1;
  phase     = 'playing';
  winCells  = null;
  hoverCol  = -1;
  aiPending = false;
  aiScore   = null;
  undoStack = [];
  undosLeft = 3;
  fallingPiece = null;
  initWorker();
  if (player !== humanPlayer) triggerAI();
}

// ── Game logic ────────────────────────────────────
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

// ── AI via Web Worker ─────────────────────────────
function triggerAI() {
  aiPending = true;
  aiScore   = null;
  worker.postMessage({ board: board.map(r => [...r]), currentPlayer: player });
}

// ── Draw utilities ────────────────────────────────
function pColor(p) { return p === 1 ? COL_P1 : COL_P2; }
function pLabel(p) { return p === humanPlayer ? 'あなた' : 'CPU (完全解析)'; }
function colX(c)   { return c * CELL + CELL / 2; }
function cellY(r)  { return TOP + r * CELL + CELL / 2; }

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

// ── Score label ────────────────────────────────────
// score > 0: current player wins in (score) half-moves
// score = 0: draw
// score < 0: current player loses
function scoreLabel(score, forPlayer) {
  if (score === null) return '';
  // score is from CPU's (opponent) perspective after CPU chose move
  // positive = CPU wins, negative = CPU loses, 0 = draw
  const fromHuman = forPlayer === humanPlayer;
  if (score > 0)  return fromHuman ? 'CPU 勝勢' : 'あなた 勝勢';  // who the score favors
  if (score < 0)  return fromHuman ? 'あなた 勝勢' : 'CPU 勝勢';
  return '引き分け確定';
}

function scoreColor(score) {
  if (score === null) return '#8899aa';
  if (score > 0)  return COL_P2; // CPU wins (yellow)
  if (score < 0)  return COL_P1; // human wins (red)
  return '#8899aa';
}

// ── Drawing screens ───────────────────────────────
function drawSetup() {
  ctx.fillStyle = COL_BG; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#ff6600';
  ctx.font = 'bold 13px Arial, sans-serif';
  ctx.fillText('強い人向け', W/2, 48);

  ctx.fillStyle = '#00e5ff';
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.fillText('4目並べ', W/2, 82);

  ctx.fillStyle = '#6688aa'; ctx.font = '13px Arial, sans-serif';
  ctx.fillText('CPU は完全解析AIです。引き分け以上が目標！', W/2, 110);

  ctx.fillStyle = '#aaddff'; ctx.font = 'bold 12px Arial, sans-serif';
  ctx.fillText('先行・後攻を選んでください', W/2, 160);

  circle(W/2 - 98, 240, 20, COL_P1);
  ctx.fillStyle = '#aaa'; ctx.font = '11px Arial, sans-serif';
  ctx.fillText('あなた = 赤（先行）', W/2, 276);
  btn(W/2, 310, 210, 50, '先行でプレイ', COL_P1, false);

  circle(W/2 + 98, 360, 20, COL_P2);
  ctx.fillStyle = '#aaa'; ctx.font = '11px Arial, sans-serif';
  ctx.fillText('あなた = 黄（後攻）', W/2, 396);
  btn(W/2, 430, 210, 50, '後攻でプレイ', COL_P2, false);

  ctx.fillStyle = '#334455'; ctx.font = '11px Arial, sans-serif';
  ctx.fillText('※ 先行は最善手を続ければ必ず勝てます', W/2, 498);
  ctx.fillText('※ 後攻は引き分けが限界（最善手のとき）', W/2, 516);

  ctx.textAlign = 'left';
}

function drawGame() {
  ctx.fillStyle = COL_BG; ctx.fillRect(0, 0, W, H);

  // ── Top banner ────────────────────────────────
  if (phase === 'over') {
    const resultColor = winCells ? pColor(player) : '#8899aa';
    const resultText  = winCells
      ? `${pLabel(player)} の勝ち！`
      : '引き分け';
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = resultColor; ctx.fillRect(0, 0, W, TOP - 1);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = resultColor + '99'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, TOP-1); ctx.lineTo(W, TOP-1); ctx.stroke();
    ctx.lineWidth = 1;
    if (winCells) {
      ctx.save(); ctx.shadowColor = resultColor; ctx.shadowBlur = 20;
      circle(32, TOP/2, 15, resultColor); ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = resultColor;
    ctx.shadowColor = resultColor; ctx.shadowBlur = 12;
    ctx.font = 'bold 26px Arial, sans-serif';
    ctx.fillText(resultText, W/2, 33);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#556677'; ctx.font = '12px Arial, sans-serif';
    ctx.fillText('タップ / クリック / R キーでリスタート', W/2, 58);
  } else {
    // Turn / thinking indicator
    let statusText, statusColor;
    if (aiPending) {
      statusText  = 'CPU 思考中... (完全解析)';
      statusColor = pColor(player);
    } else {
      statusText  = `${pLabel(player)} のターン`;
      statusColor = pColor(player);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = statusColor;
    ctx.font = 'bold 20px Arial, sans-serif';
    ctx.fillText(statusText, W/2, 30);
    if (!aiPending) circle(W/2 - 92, 22, 9, pColor(player));

    // Perfect solver label (top-left)
    ctx.fillStyle = '#ff6600aa'; ctx.font = '11px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('完全解析', 6, 27);

    // Score indicator (below status)
    if (aiScore !== null) {
      const sc = scoreLabel(aiScore, player);
      const scCol = scoreColor(aiScore);
      ctx.fillStyle = scCol; ctx.textAlign = 'center';
      ctx.font = 'bold 11px Arial, sans-serif';
      ctx.fillText(sc, W/2, 52);
    }
  }

  // ── Undo button ──────────────────────────────
  {
    const active = undosLeft > 0 && undoStack.length > 0 && !aiPending && !fallingPiece
                   && (phase === 'playing' || phase === 'over');
    const bx = W - 108, by = 4, bw = 104, bh = 40;
    ctx.fillStyle = active ? '#0d2a1a' : '#151515';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8); ctx.fill();
    ctx.strokeStyle = active ? '#44dd88' : '#2a3a2a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8); ctx.stroke();
    ctx.fillStyle = active ? '#88ffaa' : '#3a5a3a';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.fillText(`↩ 待った (${undosLeft})`, bx + bw/2, by + bh/2);
    ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 1;
  }

  // ── Board background ──────────────────────────
  ctx.fillStyle = COL_BOARD;
  ctx.fillRect(0, TOP, W, ROWS * CELL);

  // Hover indicator
  if (phase === 'playing' && !aiPending && !fallingPiece && hoverCol >= 0 && hoverCol < COLS) {
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

  // Cells
  const winSet   = winCells ? new Set(winCells.map(([r,c]) => `${r},${c}`)) : null;
  const winPulse = winSet ? Math.sin(Date.now() * 0.005) * 0.35 + 0.65 : 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = colX(c), y = cellY(r), cell = board[r][c];
      const isWin = winSet && winSet.has(`${r},${c}`);
      circle(x, y, CELL/2-6, cell ? pColor(cell) : COL_EMPTY, isWin ? pColor(cell) : null);
      if (isWin) {
        ctx.save();
        ctx.strokeStyle = `rgba(255,255,255,${winPulse})`;
        ctx.lineWidth = 3.5;
        ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.arc(x, y, CELL/2-4, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
      }
    }
  }

  // Column dividers
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c*CELL, TOP); ctx.lineTo(c*CELL, H); ctx.stroke();
  }

  // Falling piece
  if (fallingPiece) {
    circle(colX(fallingPiece.col), fallingPiece.y, CELL/2-6,
      pColor(fallingPiece.player), pColor(fallingPiece.player));
  }

  ctx.textAlign = 'left';
}

function draw() {
  if (phase === 'setup') drawSetup();
  else                   drawGame();
}

// ── Play a column ─────────────────────────────────
function playCol(col) {
  if (col < 0 || col >= COLS) return;
  const row = dropRow(col);
  if (row < 0) return;
  if (player === humanPlayer) {
    undoStack.push({ board: board.map(r => [...r]), player, aiScore });
  }
  startFall(col, row, player);
}

// ── Falling animation ─────────────────────────────
function startFall(col, targetRow, p) {
  fallingPiece = { col, targetRow, y: 0, vy: 4, player: p, bounced: false };
}

function updateFall() {
  if (!fallingPiece) return;
  const fp = fallingPiece;
  const targetY = cellY(fp.targetRow);
  fp.vy += 0.9;
  fp.y  += fp.vy;
  if (fp.y >= targetY) {
    if (!fp.bounced && fp.vy > 6) {
      fp.y = targetY; fp.vy = -fp.vy * 0.28; fp.bounced = true;
    } else {
      fp.y = targetY;
      const { col, targetRow, player: p } = fp;
      fallingPiece = null;
      board[targetRow][col] = p;
      winCells = checkWin(targetRow, col);
      if (winCells || isDraw()) { phase = 'over'; return; }
      player = 3 - player;
      if (player !== humanPlayer) triggerAI();
    }
  }
}

// ── Undo ──────────────────────────────────────────
function undo() {
  if (undosLeft <= 0 || !undoStack.length || aiPending || fallingPiece) return;
  if (phase !== 'playing' && phase !== 'over') return;
  const snap = undoStack.pop();
  board    = snap.board;
  player   = snap.player;
  aiScore  = snap.aiScore;
  winCells = null;
  phase    = 'playing';
  undosLeft--;
  // Cancel any pending worker computation
  if (aiPending) { initWorker(); aiPending = false; }
}

// ── Input ─────────────────────────────────────────
canvas.addEventListener('mousemove', e => {
  if (phase !== 'playing' || aiPending) return;
  const { x } = getCanvasXY(e);
  hoverCol = Math.min(COLS-1, Math.max(0, Math.floor(x / CELL)));
});
canvas.addEventListener('mouseleave', () => { hoverCol = -1; });

canvas.addEventListener('click', e => {
  if (phase === 'setup') {
    if (hit(e, W/2, 310, 210, 50)) { newGame(1); return; }
    if (hit(e, W/2, 430, 210, 50)) { newGame(2); return; }
    return;
  }
  // Undo button
  if ((phase === 'playing' || phase === 'over') && hit(e, W-108+52, 4+20, 104, 40)) { undo(); return; }
  if (phase === 'over') { phase = 'setup'; return; }
  if (aiPending || fallingPiece || player !== humanPlayer) return;
  const { x } = getCanvasXY(e);
  playCol(Math.floor(x / CELL));
});

document.addEventListener('keydown', e => {
  if (e.code === 'KeyR') { phase = 'setup'; return; }
  if (e.code === 'KeyZ') { undo(); return; }
  if (phase !== 'playing' || aiPending || fallingPiece || player !== humanPlayer) return;
  if (e.code === 'ArrowLeft')  hoverCol = Math.max(0,      (hoverCol < 0 ? 3 : hoverCol) - 1);
  if (e.code === 'ArrowRight') hoverCol = Math.min(COLS-1, (hoverCol < 0 ? 3 : hoverCol) + 1);
  if (e.code === 'Enter' || e.code === 'Space') {
    e.preventDefault();
    if (hoverCol >= 0) playCol(hoverCol);
  }
});

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  canvas.dispatchEvent(new MouseEvent('click', { clientX: t.clientX, clientY: t.clientY, bubbles: true }));
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (phase !== 'playing' || aiPending || fallingPiece) return;
  const { x } = getCanvasXY(e.touches[0]);
  hoverCol = Math.min(COLS-1, Math.max(0, Math.floor(x / CELL)));
}, { passive: false });

// ── Main loop ─────────────────────────────────────
phase = 'setup';
(function loop() { updateFall(); draw(); requestAnimationFrame(loop); })();
