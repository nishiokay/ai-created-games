const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const pauseBtn = document.getElementById('pause-btn');

canvas.style.height = 'auto';

const W = canvas.width;   // 420
const H = canvas.height;  // 620

// --- 定数 ---
const PUCK_R    = 14;
const PADDLE_R  = 30;
const GOAL_W    = 140;
const GOAL_X    = (W - GOAL_W) / 2;
const WALL_T    = 6;
const MAX_SPEED = 15;
const SCORE_WIN = 7;
const CPU_SPEED = 4.0;

const COL_TABLE  = '#061428';
const COL_LINE   = 'rgba(0,200,255,0.15)';
const COL_P1     = '#00e5ff';  // 下（あなた / P1）
const COL_P2     = '#ff4466';  // 上（CPU / P2）
const COL_PUCK   = '#ffe066';

// --- 効果音 ---
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playTone({ freq = 440, type = 'sine', vol = 0.3, attack = 0.005, decay = 0.12, startFreq = null } = {}) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.type = type;
  if (startFreq) {
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + decay * 0.5);
  } else {
    osc.frequency.setValueAtTime(freq, now);
  }
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, now + attack + decay);
  osc.start(now); osc.stop(now + attack + decay + 0.01);
}

function playWallHit()   { playTone({ freq: 600, type: 'square', vol: 0.15, attack: 0.003, decay: 0.06 }); }
function playPaddleHit() { playTone({ freq: 280, type: 'square', vol: 0.28, attack: 0.003, decay: 0.1, startFreq: 420 }); }

function playGoalSound(p1scored) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const notes = p1scored ? [440, 554, 660] : [330, 277, 220];
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'square'; osc.frequency.setValueAtTime(freq, now + i * 0.1);
    gain.gain.setValueAtTime(0.001, now + i * 0.1);
    gain.gain.linearRampToValueAtTime(0.18, now + i * 0.1 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3);
    osc.start(now + i * 0.1); osc.stop(now + i * 0.1 + 0.35);
  });
}

function playEndSound(win) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const melody = win ? [523, 659, 784, 1047] : [392, 330, 277, 220];
  const type   = win ? 'square' : 'sawtooth';
  melody.forEach((freq, i) => {
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = type; osc.frequency.setValueAtTime(freq, now + i * 0.14);
    gain.gain.setValueAtTime(0.001, now + i * 0.14);
    gain.gain.linearRampToValueAtTime(0.18, now + i * 0.14 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.28);
    osc.start(now + i * 0.14); osc.stop(now + i * 0.14 + 0.32);
  });
}

// --- 状態 ---
let puck, p1Paddle, p2Paddle;  // p1=下, p2=上
let p1Score, p2Score;
let phase;   // 'select' | 'ready' | 'playing' | 'scored' | 'gameover'
let vsAI;
let scorer, scoredTimer;
let paused = false;

// --- モード選択 ---
function showSelect() {
  phase  = 'select';
  paused = false;
  pauseBtn.textContent = '⏸ ポーズ';
}

// --- 初期化 ---
function initGame(ai) {
  vsAI    = ai;
  p1Score = 0;
  p2Score = 0;
  paused  = false;
  pauseBtn.textContent = '⏸ ポーズ';
  resetRound('cpu'); // 最初はp2(上)サーブ → p1(下)方向へ
}

function resetRound(serveSide) {
  const cx = W / 2, cy = H / 2;
  const angle = (Math.random() * 0.5 - 0.25);
  const speed = 5;
  const dir   = serveSide === 'cpu' ? 1 : -1; // 1=下方向, -1=上方向
  puck = {
    x: cx, y: cy,
    vx: Math.sin(angle) * speed * dir,
    vy: Math.cos(angle) * speed * dir
  };
  p1Paddle = { x: cx, y: H - PADDLE_R - 40, vy: 0 };
  p2Paddle = { x: cx, y:     PADDLE_R + 40        };
  phase    = 'ready';
  scoredTimer = 0;
}

// --- 物理 ---
function clampWalls() {
  if (puck.x - PUCK_R < WALL_T) {
    puck.x = WALL_T + PUCK_R; puck.vx = Math.abs(puck.vx); playWallHit();
  }
  if (puck.x + PUCK_R > W - WALL_T) {
    puck.x = W - WALL_T - PUCK_R; puck.vx = -Math.abs(puck.vx); playWallHit();
  }
  if (puck.y - PUCK_R < WALL_T) {
    const inGoal = puck.x > GOAL_X && puck.x < GOAL_X + GOAL_W;
    if (!inGoal) { puck.y = WALL_T + PUCK_R; puck.vy = Math.abs(puck.vy); playWallHit(); }
  }
  if (puck.y + PUCK_R > H - WALL_T) {
    const inGoal = puck.x > GOAL_X && puck.x < GOAL_X + GOAL_W;
    if (!inGoal) { puck.y = H - WALL_T - PUCK_R; puck.vy = -Math.abs(puck.vy); playWallHit(); }
  }
}

function checkGoal() {
  // 上ゴール通過 → p1得点
  if (puck.y - PUCK_R < 0 && puck.x > GOAL_X && puck.x < GOAL_X + GOAL_W) {
    p1Score++; scorer = 'p1'; phase = 'scored'; scoredTimer = 90;
    if (p1Score >= SCORE_WIN) setTimeout(() => playEndSound(true),  60);
    else                      playGoalSound(true);
    return;
  }
  // 下ゴール通過 → p2得点
  if (puck.y + PUCK_R > H && puck.x > GOAL_X && puck.x < GOAL_X + GOAL_W) {
    p2Score++; scorer = 'p2'; phase = 'scored'; scoredTimer = 90;
    if (p2Score >= SCORE_WIN) setTimeout(() => playEndSound(false), 60);
    else                      playGoalSound(false);
  }
}

function paddleCollision(paddle) {
  const dx = puck.x - paddle.x, dy = puck.y - paddle.y;
  const dist = Math.hypot(dx, dy);
  const minDist = PUCK_R + PADDLE_R;
  if (dist >= minDist || dist === 0) return;

  const nx = dx / dist, ny = dy / dist;
  puck.x += nx * (minDist - dist);
  puck.y += ny * (minDist - dist);

  const padVy = paddle === p1Paddle ? p1Paddle.vy : 0;
  const dot   = puck.vx * nx + (puck.vy - padVy) * ny;
  if (dot >= 0) return;

  puck.vx -= 2 * dot * nx;
  puck.vy -= 2 * dot * ny;
  if (paddle === p1Paddle) puck.vy += padVy * 0.4;

  const speed = Math.hypot(puck.vx, puck.vy);
  if (speed > MAX_SPEED) { puck.vx = puck.vx / speed * MAX_SPEED; puck.vy = puck.vy / speed * MAX_SPEED; }
  if (speed < 4 && speed > 0) { puck.vx = puck.vx / speed * 4; puck.vy = puck.vy / speed * 4; }
  playPaddleHit();
}

function updateCPU() {
  let targetX;
  if (puck.y < H / 2) {
    targetX = puck.x;
  } else if (puck.vy < 0) {
    targetX = puck.x;
  } else {
    targetX = W / 2;
  }
  const dx = targetX - p2Paddle.x;
  p2Paddle.x += Math.sign(dx) * Math.min(Math.abs(dx), CPU_SPEED);
  p2Paddle.x  = Math.max(WALL_T + PADDLE_R, Math.min(W - WALL_T - PADDLE_R, p2Paddle.x));
  p2Paddle.y  = Math.max(WALL_T + PADDLE_R, Math.min(H / 2 - PADDLE_R, p2Paddle.y));
}

function update() {
  if (phase === 'select' || phase === 'ready' || phase === 'gameover') return;

  if (phase === 'scored') {
    scoredTimer--;
    if (scoredTimer <= 0) {
      if (p1Score >= SCORE_WIN || p2Score >= SCORE_WIN) phase = 'gameover';
      else resetRound(scorer);
    }
    return;
  }

  puck.x += puck.vx; puck.y += puck.vy;
  clampWalls();
  checkGoal();
  if (phase !== 'playing') return;

  paddleCollision(p1Paddle);
  paddleCollision(p2Paddle);
  if (vsAI) updateCPU();
}

// --- 描画 ---
function drawTable() {
  ctx.fillStyle = COL_TABLE;
  ctx.fillRect(0, 0, W, H);

  // 左右の壁
  ctx.fillStyle = 'rgba(0,200,255,0.4)';
  ctx.fillRect(0, 0, WALL_T, H);
  ctx.fillRect(W - WALL_T, 0, WALL_T, H);

  // 上下の壁（ゴール外）
  ctx.fillRect(WALL_T, 0, GOAL_X - WALL_T, WALL_T);
  ctx.fillRect(GOAL_X + GOAL_W, 0, W - GOAL_X - GOAL_W - WALL_T, WALL_T);
  ctx.fillRect(WALL_T, H - WALL_T, GOAL_X - WALL_T, WALL_T);
  ctx.fillRect(GOAL_X + GOAL_W, H - WALL_T, W - GOAL_X - GOAL_W - WALL_T, WALL_T);

  // ゴールポスト
  for (const [px, py] of [[GOAL_X, 0], [GOAL_X + GOAL_W, 0], [GOAL_X, H], [GOAL_X + GOAL_W, H]]) {
    ctx.save();
    ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#00e5ff';
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ゴール塗り
  ctx.fillStyle = COL_P2 + '33';
  ctx.fillRect(GOAL_X, 0, GOAL_W, WALL_T + 2);
  ctx.fillStyle = COL_P1 + '33';
  ctx.fillRect(GOAL_X, H - WALL_T - 2, GOAL_W, WALL_T + 2);

  // センターライン
  ctx.strokeStyle = COL_LINE; ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.moveTo(WALL_T, H / 2); ctx.lineTo(W - WALL_T, H / 2); ctx.stroke();
  ctx.setLineDash([]);

  // センターサークル
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 55, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, WALL_T,     80, 0, Math.PI);         ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H - WALL_T, 80, Math.PI, Math.PI*2); ctx.stroke();
}

function drawScore() {
  const p1Label = vsAI ? 'あなた' : 'P1';
  const p2Label = vsAI ? 'CPU'    : 'P2';
  ctx.textAlign = 'center';

  ctx.fillStyle = COL_P2; ctx.shadowColor = COL_P2; ctx.shadowBlur = 12;
  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.fillText(p2Score, W / 2 + 44, H / 2 - 12);
  ctx.shadowBlur = 0;
  ctx.fillStyle = COL_P2 + '88'; ctx.font = '10px Arial, sans-serif';
  ctx.fillText(p2Label, W / 2 + 44, H / 2 + 4);

  ctx.fillStyle = COL_P1; ctx.shadowColor = COL_P1; ctx.shadowBlur = 12;
  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.fillText(p1Score, W / 2 - 44, H / 2 - 12);
  ctx.shadowBlur = 0;
  ctx.fillStyle = COL_P1 + '88'; ctx.font = '10px Arial, sans-serif';
  ctx.fillText(p1Label, W / 2 - 44, H / 2 + 4);

  ctx.textAlign = 'left';
}

function drawPaddle(x, y, col) {
  ctx.save();
  ctx.shadowColor = col; ctx.shadowBlur = 18;
  ctx.strokeStyle = col; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, PADDLE_R, 0, Math.PI * 2); ctx.stroke();
  const grad = ctx.createRadialGradient(x - PADDLE_R * 0.25, y - PADDLE_R * 0.25, 2, x, y, PADDLE_R);
  grad.addColorStop(0, col + '55'); grad.addColorStop(1, col + '18');
  ctx.fillStyle = grad; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath(); ctx.arc(x - PADDLE_R * 0.22, y - PADDLE_R * 0.22, PADDLE_R * 0.28, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawPuck() {
  ctx.save();
  ctx.shadowColor = COL_PUCK; ctx.shadowBlur = 22;
  const grad = ctx.createRadialGradient(puck.x - 4, puck.y - 4, 1, puck.x, puck.y, PUCK_R);
  grad.addColorStop(0, '#fff8cc'); grad.addColorStop(1, COL_PUCK);
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(puck.x, puck.y, PUCK_R, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawGoalLabels() {
  const p1Label = vsAI ? 'あなたのゴール' : 'P1 GOAL';
  const p2Label = vsAI ? 'CPU GOAL'       : 'P2 GOAL';
  ctx.textAlign = 'center'; ctx.font = '10px Arial, sans-serif';
  ctx.fillStyle = COL_P2 + '66'; ctx.fillText(p2Label, W / 2, 18);
  ctx.fillStyle = COL_P1 + '66'; ctx.fillText(p1Label, W / 2, H - 6);
  ctx.textAlign = 'left';
}

function drawSelect() {
  ctx.fillStyle = COL_TABLE; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#00e5ff';
  ctx.font = 'bold 32px Arial, sans-serif';
  ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 16;
  ctx.fillText('AIR HOCKEY', W / 2, 100);
  ctx.shadowBlur = 0;

  // パック飾り
  ctx.save();
  ctx.shadowColor = COL_PUCK; ctx.shadowBlur = 20;
  const g = ctx.createRadialGradient(W/2-4, 148, 1, W/2, 152, 22);
  g.addColorStop(0, '#fff8cc'); g.addColorStop(1, COL_PUCK);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(W / 2, 152, 22, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // ボタン
  drawBtn(W / 2, 260, 260, 52, 'CPU と対戦', COL_P1);
  drawBtn(W / 2, 330, 260, 52, '2人で対戦', COL_P2);

  ctx.fillStyle = '#446'; ctx.font = '12px Arial, sans-serif';
  ctx.fillText('先に ' + SCORE_WIN + ' 点取った方の勝ち', W / 2, 395);
  ctx.textAlign = 'left';
}

function drawBtn(cx, cy, bw, bh, label, col) {
  const x = cx - bw / 2, y = cy - bh / 2;
  ctx.fillStyle = col + '22';
  ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 10); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 10); ctx.stroke();
  ctx.fillStyle = col;
  ctx.font = 'bold 18px Arial, sans-serif';
  ctx.fillText(label, cx, cy + 7);
}

function hitBtn(cx, cy, bw, bh, ex, ey) {
  return ex > cx - bw/2 && ex < cx + bw/2 && ey > cy - bh/2 && ey < cy + bh/2;
}

function drawOverlay() {
  if (phase === 'ready') {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe066'; ctx.font = 'bold 24px Arial, sans-serif';
    ctx.shadowColor = '#ffe066'; ctx.shadowBlur = 16;
    ctx.fillText('タップでスタート', W / 2, H / 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#aaa'; ctx.font = '13px Arial, sans-serif';
    if (!vsAI) {
      ctx.fillText('P1（下）・P2（上）それぞれ自分側をタッチ', W / 2, H / 2 + 26);
    } else {
      ctx.fillText('あなたは下側', W / 2, H / 2 + 26);
    }
    ctx.textAlign = 'left';
  }

  if (phase === 'scored') {
    const alpha = Math.min(1, scoredTimer / 30);
    ctx.fillStyle = `rgba(0,0,0,${0.4 * alpha})`; ctx.fillRect(0, 0, W, H);
    const col   = scorer === 'p1' ? COL_P1 : COL_P2;
    const label = scorer === 'p1' ? (vsAI ? 'あなた' : 'P1') : (vsAI ? 'CPU' : 'P2');
    ctx.globalAlpha = alpha; ctx.textAlign = 'center';
    ctx.fillStyle = col; ctx.font = 'bold 38px Arial, sans-serif';
    ctx.shadowColor = col; ctx.shadowBlur = 24;
    ctx.fillText(`${label} ゴール！`, W / 2, H / 2);
    ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }

  if (phase === 'gameover') {
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    const p1win = p1Score >= SCORE_WIN;
    const col   = p1win ? COL_P1 : COL_P2;
    const label = p1win ? (vsAI ? 'あなたの勝ち！' : 'P1 の勝ち！')
                        : (vsAI ? 'CPU の勝ち！'   : 'P2 の勝ち！');
    ctx.fillStyle = col; ctx.font = 'bold 38px Arial, sans-serif';
    ctx.shadowColor = col; ctx.shadowBlur = 28;
    ctx.fillText(label, W / 2, H / 2 - 20);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#aaa'; ctx.font = '14px Arial, sans-serif';
    ctx.fillText('タップでモード選択に戻る', W / 2, H / 2 + 16);
    ctx.textAlign = 'left';
  }

  if (paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.58)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe066'; ctx.font = 'bold 44px Arial, sans-serif';
    ctx.shadowColor = '#ffe066'; ctx.shadowBlur = 20;
    ctx.fillText('PAUSE', W / 2, H / 2 - 10);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#aaa'; ctx.font = '13px Arial, sans-serif';
    ctx.fillText('⏸ ボタン / P キーで再開', W / 2, H / 2 + 20);
    ctx.textAlign = 'left';
  }
}

function draw() {
  if (phase === 'select') { drawSelect(); return; }
  drawTable();
  drawGoalLabels();
  drawScore();
  drawPaddle(p1Paddle.x, p1Paddle.y, COL_P1);
  drawPaddle(p2Paddle.x, p2Paddle.y, COL_P2);
  if (phase !== 'gameover') drawPuck();
  drawOverlay();
}

// --- ゲームループ ---
function loop() {
  if (!paused) update();
  draw();
  requestAnimationFrame(loop);
}

// --- タッチ入力 ---
// タッチ位置のY座標でどちらのパドルか判定（上半分=P2, 下半分=P1）
function getCanvasPos(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (W / rect.width),
    y: (clientY - rect.top)  * (H / rect.height)
  };
}

function applyToP1(cx, cy) {
  const prevY = p1Paddle.y;
  p1Paddle.x = Math.max(WALL_T + PADDLE_R, Math.min(W - WALL_T - PADDLE_R, cx));
  p1Paddle.y = Math.max(H / 2 + PADDLE_R, Math.min(H - WALL_T - PADDLE_R, cy));
  p1Paddle.vy = p1Paddle.y - prevY;
}

function applyToP2(cx, cy) {
  p2Paddle.x = Math.max(WALL_T + PADDLE_R, Math.min(W - WALL_T - PADDLE_R, cx));
  p2Paddle.y = Math.max(WALL_T + PADDLE_R, Math.min(H / 2 - PADDLE_R, cy));
}

// マウス（P1のみ）
canvas.addEventListener('mousemove', e => {
  if (phase === 'select' || phase === 'gameover') return;
  const { x, y } = getCanvasPos(e.clientX, e.clientY);
  applyToP1(x, y);
});

canvas.addEventListener('click', e => {
  ensureAudio();
  const { x, y } = getCanvasPos(e.clientX, e.clientY);
  handleTap(x, y);
});

// マルチタッチ
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  ensureAudio();
  for (const t of e.changedTouches) {
    const { x, y } = getCanvasPos(t.clientX, t.clientY);
    handleTap(x, y);
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const { x, y } = getCanvasPos(t.clientX, t.clientY);
    if (phase === 'playing' || phase === 'ready') {
      if (y >= H / 2) {
        applyToP1(x, y);
      } else if (!vsAI) {
        applyToP2(x, y);
      }
    }
  }
}, { passive: false });

function handleTap(x, y) {
  if (phase === 'select') {
    if (hitBtn(W/2, 260, 260, 52, x, y)) { initGame(true);  return; }
    if (hitBtn(W/2, 330, 260, 52, x, y)) { initGame(false); return; }
    return;
  }
  if (phase === 'gameover') { showSelect(); return; }
  if (phase === 'ready' && !paused) { phase = 'playing'; return; }
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') togglePause();
});
pauseBtn.addEventListener('click', togglePause);

function togglePause() {
  if (phase === 'select' || phase === 'ready' || phase === 'gameover') return;
  paused = !paused;
  pauseBtn.textContent = paused ? '▶ 再開' : '⏸ ポーズ';
}

// --- 起動 ---
showSelect();
loop();
