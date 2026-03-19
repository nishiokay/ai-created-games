const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const messageEl = document.getElementById('message');
const restartBtn = document.getElementById('restart');

canvas.style.height = 'auto'; // CSS でアスペクト比を維持（スマホ対応）

const W = canvas.width;
const H = canvas.height;

// --- 設定 ---
const PADDLE_W = 80, PADDLE_H = 10, PADDLE_SPEED = 6;
const BALL_R = 7, BALL_SPEED = 4;
const BRICK_COLS = 10, BRICK_ROWS = 5;
const BRICK_W = 42, BRICK_H = 16;
const BRICK_PAD = 4;
const BRICK_OFFSET_X = (W - (BRICK_COLS * (BRICK_W + BRICK_PAD) - BRICK_PAD)) / 2;
const BRICK_OFFSET_Y = 40;
const BRICK_COLORS = ['#e94560', '#f5a623', '#f8e71c', '#7ed321', '#4a90e2'];

const ITEM_W = 36, ITEM_H = 20, ITEM_FALL = 2;
const INVINCIBLE_DURATION = 300; // 5 秒 @ 60fps
const ITEM_COLORS  = { multiball: '#4a90e2', speed: '#f5a623', invincible: '#00e5ff' };
const ITEM_LABELS  = { multiball: '×5球', speed: '×2⚡', invincible: '★5s' };

// --- 状態 ---
let paddle, balls, bricks, score, lives, state;
// state: 'idle' | 'playing' | 'gameover' | 'clear'
let items = [], bricksDestroyed = 0, invincibleTimer = 0, speedMultiplier = 1;
let notification = null; // { text, color, timer }
let lastItemType = null; // 直前のアイテム種別（連続防止）
let paused = false;

// --- クリア演出 ---
let confetti = [];
let clearAnim = null; // { phase, timer }
const CONFETTI_COLORS = [
  '#e94560','#f5a623','#f8e71c','#7ed321','#4a90e2',
  '#b94fe8','#00e5ff','#ff82b2','#ffffff','#ffd700'
];

function startClear() {
  clearAnim = { phase: 'grow', timer: 0 };
  confetti = [];
}

function burstKusudama() {
  const cx = W / 2, cy = H / 2 - 20;
  for (let i = 0; i < 180; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 10;
    const isCircle = Math.random() < 0.25;
    confetti.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 5,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      w: Math.random() * 11 + 4,
      h: Math.random() * 6 + 3,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.45,
      gravity: 0.11 + Math.random() * 0.13,
      isCircle,
    });
  }
}

function updateCelebration() {
  if (!clearAnim) return;
  clearAnim.timer++;
  const t = clearAnim.timer;
  if (clearAnim.phase === 'grow'  && t >= 55) { clearAnim.phase = 'hold';      clearAnim.timer = 0; }
  if (clearAnim.phase === 'hold'  && t >= 28) { clearAnim.phase = 'burst';     clearAnim.timer = 0; burstKusudama(); }
  if (clearAnim.phase === 'burst' && t >= 22) { clearAnim.phase = 'celebrate'; clearAnim.timer = 0; }
  for (const p of confetti) {
    p.vy += p.gravity; p.x += p.vx; p.y += p.vy;
    p.rot += p.rotV; p.vx *= 0.99;
  }
  confetti = confetti.filter(p => p.y < H + 40);
}

function drawKusudama(cx, cy, r, tick) {
  if (r <= 0) return;
  const PETAL_COLS = ['#e94560','#f5a623','#f8e71c','#7ed321','#4a90e2','#b94fe8'];
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + tick * 0.035;
    ctx.save();
    ctx.rotate(a);
    ctx.fillStyle = PETAL_COLS[i];
    ctx.shadowColor = PETAL_COLS[i];
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.ellipse(0, -(r + 11), r * 0.44, r * 0.66, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.shadowBlur = 0;
  const grad = ctx.createRadialGradient(-r * 0.28, -r * 0.3, r * 0.04, 0, 0, r);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.3, '#ffb3d9');
  grad.addColorStop(1, '#c0175a');
  ctx.fillStyle = grad;
  ctx.shadowColor = '#ff4488';
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 1.8;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI + tick * 0.02;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, a, a + Math.PI);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.24, -r * 0.28, r * 0.22, r * 0.15, -Math.PI / 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(0, r); ctx.lineTo(0, r + 18); ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath(); ctx.moveTo(i * 2, r + 18); ctx.lineTo(i * 7, r + 34); ctx.stroke();
  }
  ctx.restore();
}

function drawCelebration() {
  if (!clearAnim) return;
  const { phase, timer } = clearAnim;
  const cx = W / 2, cy = H / 2 - 20;
  ctx.fillStyle = 'rgba(8, 4, 22, 0.78)';
  ctx.fillRect(0, 0, W, H);
  if (phase === 'grow') {
    const r = (timer / 55) * 58;
    const wobble = Math.sin(timer * 0.4) * 2 * (timer / 55);
    drawKusudama(cx, cy + wobble, r, timer);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + timer * 0.07;
      const d = 70 + Math.sin(timer * 0.2 + i) * 12;
      ctx.fillStyle = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      ctx.globalAlpha = 0.6 + Math.sin(timer * 0.3 + i) * 0.4;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (phase === 'hold') {
    const wobble = Math.sin(timer * 0.5) * 4;
    drawKusudama(cx, cy + wobble, 58, 55 + timer);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + timer * 0.1;
      const d = 72 + Math.sin(timer * 0.4 + i) * 15;
      ctx.fillStyle = '#ffd700';
      ctx.globalAlpha = 0.5 + Math.sin(timer * 0.6 + i) * 0.5;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (phase === 'burst') {
    const t = timer / 22;
    const burstR = 58 + t * 140;
    ctx.save();
    ctx.globalAlpha = Math.max(0, (1 - t) * 0.95);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, burstR);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, '#ffe0f0');
    grad.addColorStop(1, 'rgba(255,100,180,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, burstR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (const p of confetti) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 5;
    if (p.isCircle) {
      ctx.beginPath();
      ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    ctx.restore();
  }
  ctx.shadowBlur = 0;
  if (phase === 'burst' || phase === 'celebrate') {
    const textAlpha = phase === 'burst' ? Math.min(1, timer / 14) : 1;
    const pulse = phase === 'celebrate' ? 1 + Math.sin(clearAnim.timer * 0.09) * 0.025 : 1;
    ctx.save();
    ctx.translate(cx, cy - 10);
    ctx.scale(pulse, pulse);
    ctx.globalAlpha = textAlpha;
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 36;
    ctx.fillStyle = '#ffe066';
    ctx.font = 'bold 72px Arial, sans-serif';
    ctx.fillText('CLEAR!', 0, 0);
    ctx.shadowColor = '#ff6b9d';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffb3d9';
    ctx.font = 'bold 22px Arial, sans-serif';
    ctx.fillText(`スコア: ${score}`, 0, 42);
    ctx.restore();
  }
}

// --- アイテム ---
function spawnItem(bx, by) {
  const types = ['multiball', 'speed', 'invincible'].filter(t => t !== lastItemType);
  const type = types[Math.floor(Math.random() * types.length)];
  lastItemType = type;
  items.push({ x: bx + BRICK_W / 2 - ITEM_W / 2, y: by, type });
}

function applyItem(type) {
  if (type === 'multiball') {
    // 生きているボールの最初のものを基準に4球追加
    const ref = balls.find(b => b.launched) || balls[0];
    const speed = BALL_SPEED * speedMultiplier;
    const angles = [-60, -30, 30, 60]; // 度
    for (const deg of angles) {
      const rad = deg * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      balls.push({
        x: ref.x, y: ref.y,
        vx: ref.vx * cos - ref.vy * sin,
        vy: ref.vx * sin + ref.vy * cos,
        launched: true
      });
    }
    // 速度の大きさを正規化
    for (let i = balls.length - 4; i < balls.length; i++) {
      const b = balls[i];
      const mag = Math.hypot(b.vx, b.vy);
      b.vx = b.vx / mag * speed;
      b.vy = b.vy / mag * speed;
    }
    showNotification('×5 マルチボール!', ITEM_COLORS.multiball);
  } else if (type === 'speed') {
    if (speedMultiplier === 1) {
      speedMultiplier = 2;
      for (const b of balls) { b.vx *= 2; b.vy *= 2; }
    }
    showNotification('スピード×2!', ITEM_COLORS.speed);
  } else if (type === 'invincible') {
    invincibleTimer = INVINCIBLE_DURATION;
    showNotification('無敵 5秒!', ITEM_COLORS.invincible);
  }
}

function updateItems() {
  for (const it of items) {
    it.y += ITEM_FALL;
  }
  // パドルとの衝突
  items = items.filter(it => {
    const ix = it.x, iy = it.y;
    if (
      ix + ITEM_W > paddle.x && ix < paddle.x + paddle.w &&
      iy + ITEM_H > paddle.y && iy < paddle.y + paddle.h
    ) {
      applyItem(it.type);
      return false;
    }
    return it.y < H + ITEM_H;
  });
}

function drawItems() {
  for (const it of items) {
    const color = ITEM_COLORS[it.type];
    const label = ITEM_LABELS[it.type];
    // カプセル背景
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(it.x, it.y, ITEM_W, ITEM_H, ITEM_H / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // テキスト
    ctx.fillStyle = '#fff';
    ctx.font = `bold 10px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, it.x + ITEM_W / 2, it.y + ITEM_H / 2);
    ctx.restore();
  }
}

function drawEffects() {
  // 無敵インジケータ
  if (invincibleTimer > 0) {
    const frac = invincibleTimer / INVINCIBLE_DURATION;
    const x = 4, y = H - 18, bw = 80, bh = 10;
    ctx.fillStyle = 'rgba(0,229,255,0.2)';
    ctx.beginPath();
    ctx.roundRect(x, y, bw, bh, 5);
    ctx.fill();
    ctx.fillStyle = '#00e5ff';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.roundRect(x, y, bw * frac, bh, 5);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = '9px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('★無敵', x + 4, y + bh / 2);
  }
  // スピード表示
  if (speedMultiplier > 1) {
    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('⚡×2', 4, H - 32);
  }
  // ボール数
  if (balls.length > 1) {
    ctx.fillStyle = '#4a90e2';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`● ×${balls.length}`, W - 4, H - 32);
  }
}

function showNotification(text, color) {
  notification = { text, color, timer: 120 };
}

function drawNotification() {
  if (!notification || notification.timer <= 0) return;
  const alpha = Math.min(1, notification.timer / 30);
  const scale = notification.timer > 90 ? 1 + (notification.timer - 90) / 30 * 0.3 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2, H / 2 - 60);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = notification.color;
  ctx.shadowBlur = 20;
  ctx.fillStyle = notification.color;
  ctx.font = 'bold 26px Arial, sans-serif';
  ctx.fillText(notification.text, 0, 0);
  ctx.restore();
  notification.timer--;
}

// --- ゲーム初期化 ---
function createServeBall() {
  return {
    x: paddle.x + paddle.w / 2,
    y: paddle.y - BALL_R,
    vx: BALL_SPEED * (Math.random() < 0.5 ? 1 : -1),
    vy: -BALL_SPEED,
    launched: false
  };
}

function initGame() {
  paddle = { x: W / 2 - PADDLE_W / 2, y: H - 30, w: PADDLE_W, h: PADDLE_H, dx: 0 };
  balls = [createServeBall()];
  items = [];
  bricksDestroyed = 0;
  invincibleTimer = 0;
  speedMultiplier = 1;
  lastItemType = null;
  notification = null;
  paused = false;
  bricks = [];
  for (let r = 0; r < BRICK_ROWS; r++) {
    for (let c = 0; c < BRICK_COLS; c++) {
      bricks.push({
        x: BRICK_OFFSET_X + c * (BRICK_W + BRICK_PAD),
        y: BRICK_OFFSET_Y + r * (BRICK_H + BRICK_PAD),
        w: BRICK_W, h: BRICK_H,
        color: BRICK_COLORS[r],
        alive: true
      });
    }
  }
  score = 0;
  lives = 3;
  state = 'idle';
  clearAnim = null;
  confetti = [];
  scoreEl.textContent = score;
  livesEl.textContent = lives;
  messageEl.textContent = 'タップ / クリック / SPACE でスタート';
  restartBtn.style.display = 'none';
}

// --- 入力 ---
const keys = {};
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyP' && (state === 'playing' || paused)) {
    paused = !paused;
    return;
  }
  if (paused) return;
  if ((e.code === 'Space' || e.code === 'ArrowUp') && state === 'idle') launch();
});
document.addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('click', () => { if (state === 'idle') launch(); });
restartBtn.addEventListener('click', () => { initGame(); loop(); });

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (W / rect.width);
  paddle.x = Math.max(0, Math.min(W - paddle.w, mx - paddle.w / 2));
});

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = (e.touches[0].clientX - rect.left) * (W / rect.width);
  paddle.x = Math.max(0, Math.min(W - paddle.w, mx - paddle.w / 2));
}, { passive: false });

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (state === 'idle') { launch(); return; }
  if (state === 'playing' || paused) paused = !paused;
}, { passive: false });

function launch() {
  for (const b of balls) b.launched = true;
  state = 'playing';
  messageEl.textContent = '';
}

// --- 描画 ---
function draw() {
  ctx.clearRect(0, 0, W, H);

  if (state === 'clear') {
    drawCelebration();
    return;
  }

  // パドル
  ctx.fillStyle = '#e94560';
  roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 5);

  // ボール（複数）
  for (const b of balls) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    if (invincibleTimer > 0) {
      ctx.fillStyle = '#00e5ff';
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 12;
    } else {
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = 0;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // ブロック
  for (const b of bricks) {
    if (!b.alive) continue;
    ctx.fillStyle = b.color;
    roundRect(b.x, b.y, b.w, b.h, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(b.x + 2, b.y + 2, b.w - 4, 4);
  }

  drawItems();
  drawEffects();
  drawNotification();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

// --- 更新 ---
function update() {
  // パドル移動
  if (!paused && keys['ArrowLeft'])  paddle.x = Math.max(0, paddle.x - PADDLE_SPEED);
  if (!paused && keys['ArrowRight']) paddle.x = Math.min(W - paddle.w, paddle.x + PADDLE_SPEED);

  // 未発射ボールをパドルに乗せる
  for (const b of balls) {
    if (!b.launched) {
      b.x = paddle.x + paddle.w / 2;
      b.y = paddle.y - BALL_R;
    }
  }

  // 無敵タイマー
  if (invincibleTimer > 0) invincibleTimer--;

  // アイテム更新
  updateItems();

  // ボール更新
  for (const b of balls) {
    if (!b.launched) continue;

    b.x += b.vx;
    b.y += b.vy;

    // 壁反射
    if (b.x - BALL_R < 0) { b.x = BALL_R;     b.vx *= -1; }
    if (b.x + BALL_R > W) { b.x = W - BALL_R; b.vx *= -1; }
    if (b.y - BALL_R < 0) { b.y = BALL_R;     b.vy *= -1; }

    // パドル衝突
    if (
      b.vy > 0 &&
      b.x > paddle.x && b.x < paddle.x + paddle.w &&
      b.y + BALL_R > paddle.y && b.y + BALL_R < paddle.y + paddle.h + Math.abs(b.vy)
    ) {
      b.y = paddle.y - BALL_R;
      const hit = (b.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
      const speed = BALL_SPEED * speedMultiplier;
      b.vx = speed * hit * 1.5;
      b.vy = -Math.sqrt(speed * speed * 2.25 - b.vx * b.vx) || -speed;
      continue;
    }

    // 落下判定
    if (b.y - BALL_R > H) {
      b._dead = true;
      continue;
    }

    // ブロック衝突
    for (const br of bricks) {
      if (!br.alive) continue;
      if (
        b.x + BALL_R > br.x && b.x - BALL_R < br.x + br.w &&
        b.y + BALL_R > br.y && b.y - BALL_R < br.y + br.h
      ) {
        br.alive = false;
        score += 10;
        scoreEl.textContent = score;
        bricksDestroyed++;
        if (bricksDestroyed % 20 === 0) spawnItem(br.x, br.y);
        if (invincibleTimer > 0) {
          // 無敵: ブロックを壊すが反射しない（連続破壊）
          break;
        }
        // 衝突面判定 + 押し出し
        const overlapLeft  = (b.x + BALL_R) - br.x;
        const overlapRight = (br.x + br.w) - (b.x - BALL_R);
        const overlapTop   = (b.y + BALL_R) - br.y;
        const overlapBot   = (br.y + br.h) - (b.y - BALL_R);
        const minH = Math.min(overlapLeft, overlapRight);
        const minV = Math.min(overlapTop, overlapBot);
        if (minH < minV) {
          b.vx *= -1;
          b.x += overlapLeft < overlapRight ? -overlapLeft : overlapRight;
        } else {
          b.vy *= -1;
          b.y += overlapTop < overlapBot ? -overlapTop : overlapBot;
        }
        break;
      }
    }
  }

  // 死亡ボール除去
  balls = balls.filter(b => !b._dead);

  // 発射済みボールが全滅したらライフを減らす
  if (state === 'playing' && balls.every(b => !b.launched)) {
    lives--;
    livesEl.textContent = lives;
    speedMultiplier = 1;
    invincibleTimer = 0;
    items = [];
    if (lives <= 0) {
      state = 'gameover';
      messageEl.textContent = 'ゲームオーバー';
      restartBtn.style.display = 'inline-block';
    } else {
      balls = [createServeBall()];
      state = 'idle';
      messageEl.textContent = 'タップ / クリック / SPACE で再開';
    }
    return;
  }

  // クリア判定
  if (bricks.every(b => !b.alive)) {
    state = 'clear';
    startClear();
    messageEl.textContent = '';
    restartBtn.style.display = 'inline-block';
  }
}

function drawPause() {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe066';
  ctx.font = 'bold 48px Arial, sans-serif';
  ctx.shadowColor = '#ffe066';
  ctx.shadowBlur = 20;
  ctx.fillText('PAUSE', W / 2, H / 2 - 10);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#aaa';
  ctx.font = '14px Arial, sans-serif';
  ctx.fillText('P キー / タップで再開', W / 2, H / 2 + 22);
  ctx.textAlign = 'left';
}

// --- ゲームループ ---
let animId;
function loop() {
  if (paused) {
    draw();
    drawPause();
    animId = requestAnimationFrame(loop);
    return;
  }
  if (state === 'clear') {
    updateCelebration();
  } else {
    update();
  }
  draw();
  if (state !== 'gameover') {
    animId = requestAnimationFrame(loop);
  }
}

initGame();
loop();
