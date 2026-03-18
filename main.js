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

// --- 状態 ---
let paddle, ball, bricks, score, lives, state;
// state: 'idle' | 'playing' | 'gameover' | 'clear'

function initGame() {
  paddle = { x: W / 2 - PADDLE_W / 2, y: H - 30, w: PADDLE_W, h: PADDLE_H, dx: 0 };
  ball = {
    x: W / 2, y: H - 50,
    vx: BALL_SPEED * (Math.random() < 0.5 ? 1 : -1),
    vy: -BALL_SPEED,
    launched: false
  };
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
  scoreEl.textContent = score;
  livesEl.textContent = lives;
  messageEl.textContent = 'タップ / クリック / SPACE でスタート';
  restartBtn.style.display = 'none';
}

// --- 入力 ---
const keys = {};
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if ((e.code === 'Space' || e.code === 'ArrowUp') && state === 'idle') launch();
});
document.addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('click', () => { if (state === 'idle') launch(); });
restartBtn.addEventListener('click', () => { initGame(); loop(); });

// マウス/タッチでパドル操作
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
  if (state === 'idle') launch();
}, { passive: false });

function launch() {
  ball.launched = true;
  state = 'playing';
  messageEl.textContent = '';
}

// --- 描画 ---
function draw() {
  ctx.clearRect(0, 0, W, H);

  // パドル
  ctx.fillStyle = '#e94560';
  roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 5);

  // ボール
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  // ブロック
  for (const b of bricks) {
    if (!b.alive) continue;
    ctx.fillStyle = b.color;
    roundRect(b.x, b.y, b.w, b.h, 3);
    // ハイライト
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(b.x + 2, b.y + 2, b.w - 4, 4);
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

// --- 更新 ---
function update() {
  // パドル移動
  if (keys['ArrowLeft'])  paddle.x = Math.max(0, paddle.x - PADDLE_SPEED);
  if (keys['ArrowRight']) paddle.x = Math.min(W - paddle.w, paddle.x + PADDLE_SPEED);

  if (!ball.launched) {
    // ボールをパドルに乗せる
    ball.x = paddle.x + paddle.w / 2;
    ball.y = paddle.y - BALL_R;
    return;
  }

  ball.x += ball.vx;
  ball.y += ball.vy;

  // 壁反射
  if (ball.x - BALL_R < 0)  { ball.x = BALL_R;      ball.vx *= -1; }
  if (ball.x + BALL_R > W)  { ball.x = W - BALL_R;  ball.vx *= -1; }
  if (ball.y - BALL_R < 0)  { ball.y = BALL_R;      ball.vy *= -1; }

  // パドル衝突
  if (
    ball.vy > 0 &&
    ball.x > paddle.x && ball.x < paddle.x + paddle.w &&
    ball.y + BALL_R > paddle.y && ball.y + BALL_R < paddle.y + paddle.h + BALL_SPEED
  ) {
    ball.y = paddle.y - BALL_R;
    // パドルの当たった位置で角度変化
    const hit = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
    ball.vx = BALL_SPEED * hit * 1.5;
    ball.vy = -Math.sqrt(BALL_SPEED * BALL_SPEED * 2.25 - ball.vx * ball.vx) || -BALL_SPEED;
  }

  // 落下
  if (ball.y - BALL_R > H) {
    lives--;
    livesEl.textContent = lives;
    if (lives <= 0) {
      state = 'gameover';
      messageEl.textContent = 'ゲームオーバー';
      restartBtn.style.display = 'inline-block';
    } else {
      // リセット
      ball.x = paddle.x + paddle.w / 2;
      ball.y = paddle.y - BALL_R;
      ball.vx = BALL_SPEED * (Math.random() < 0.5 ? 1 : -1);
      ball.vy = -BALL_SPEED;
      ball.launched = false;
      state = 'idle';
      messageEl.textContent = 'タップ / クリック / SPACE で再開';
    }
    return;
  }

  // ブロック衝突
  for (const b of bricks) {
    if (!b.alive) continue;
    if (
      ball.x + BALL_R > b.x && ball.x - BALL_R < b.x + b.w &&
      ball.y + BALL_R > b.y && ball.y - BALL_R < b.y + b.h
    ) {
      b.alive = false;
      score += 10;
      scoreEl.textContent = score;

      // 衝突面の判定
      const overlapLeft  = (ball.x + BALL_R) - b.x;
      const overlapRight = (b.x + b.w) - (ball.x - BALL_R);
      const overlapTop   = (ball.y + BALL_R) - b.y;
      const overlapBot   = (b.y + b.h) - (ball.y - BALL_R);
      const minH = Math.min(overlapLeft, overlapRight);
      const minV = Math.min(overlapTop, overlapBot);
      if (minH < minV) ball.vx *= -1;
      else             ball.vy *= -1;

      break;
    }
  }

  // クリア判定
  if (bricks.every(b => !b.alive)) {
    state = 'clear';
    messageEl.textContent = 'クリア！ おめでとう！';
    restartBtn.style.display = 'inline-block';
  }
}

// --- ゲームループ ---
let animId;
function loop() {
  update();
  draw();
  if (state !== 'gameover' && state !== 'clear') {
    animId = requestAnimationFrame(loop);
  }
}

initGame();
loop();
