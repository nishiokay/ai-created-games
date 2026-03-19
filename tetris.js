const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
canvas.style.height = 'auto'; // CSS でアスペクト比を維持（スマホ対応）

// --- Sega Tetris (1988) 画面レイアウト ---
// スクリーン: 640×448 (System 16 解像度 320×224 の 2倍、等倍表示でくっきり)
// ブロック: 20×20px, フィールド: 10cols×20rows = 200×400px
const W = 640, H = 448;
const COLS = 10, ROWS = 20, BLOCK = 20;

// フィールド左上座標 (境界線の内側)
const FX = 222; // 左パネル216px + 境界4px + 2
const FY = 24;

// テトロミノ定義
const PIECES = [
  { shape: [[1,1,1,1]],        color: '#00f0f0' }, // I
  { shape: [[1,1],[1,1]],      color: '#f0f000' }, // O
  { shape: [[0,1,0],[1,1,1]],  color: '#a000f0' }, // T
  { shape: [[1,0,0],[1,1,1]],  color: '#f0a000' }, // J
  { shape: [[0,0,1],[1,1,1]],  color: '#0000f0' }, // L
  { shape: [[0,1,1],[1,1,0]],  color: '#00f000' }, // S
  { shape: [[1,1,0],[0,1,1]],  color: '#f00000' }, // Z
];

// Sega Tetris (1988) アーケード仕様
// スコア: 1=100, 2=400, 3=900, 4=2000 (レベル倍率なし)
const SCORE_TABLE = [0, 100, 400, 900, 2000];

// 落下速度テーブル: Sega Normal難度 (ms/マス)
const DROP_INTERVAL_TABLE = [800, 400, 300, 250, 200, 167, 133, 100, 67, 33];

// --- ハイスコア ---
const HS_KEY = 'tetris_highscores';
const HS_MAX = 5;

function loadHighScores() {
  try { return JSON.parse(localStorage.getItem(HS_KEY)) || []; }
  catch { return []; }
}

function saveHighScores(hs) {
  localStorage.setItem(HS_KEY, JSON.stringify(hs));
}

function isHighScore(s) {
  const hs = loadHighScores();
  return s > 0 && (hs.length < HS_MAX || s > hs[hs.length - 1].score);
}

function insertHighScore(name, s) {
  const hs = loadHighScores();
  hs.push({ name, score: s });
  hs.sort((a, b) => b.score - a.score);
  hs.splice(HS_MAX);
  saveHighScores(hs);
  return hs.findIndex(e => e.name === name && e.score === s);
}

// --- 状態 ---
let board, current, next, score, level, lines, state, dropTimer, dropInterval;
let nameChars, nameCursor, highlightRank;
let paused = false;

// --- BGM (Web Audio API) ---
let audioCtx = null, masterGain = null;
let bgmLoopTimeout = null;
let bgmActive = false, bgmMuted = false, bgmStarted = false;

const BPM = 160;
const BEAT = 60 / BPM; // 秒/四分音符

const NOTE_FREQ = {
  A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00
};

// BGM1: コロベイニキ (Sega Tetris 1988)
// [音名, 拍数]
const BGM1 = [
  // ─ Section A ×2 ─
  ['E5',1],['B4',.5],['C5',.5],['D5',1],['C5',.5],['B4',.5],
  ['A4',1],['A4',.5],['C5',.5],['E5',1],['D5',.5],['C5',.5],
  ['B4',1.5],['C5',.5],['D5',1],['E5',1],
  ['C5',1],['A4',1],['A4',2],

  ['E5',1],['B4',.5],['C5',.5],['D5',1],['C5',.5],['B4',.5],
  ['A4',1],['A4',.5],['C5',.5],['E5',1],['D5',.5],['C5',.5],
  ['B4',1.5],['C5',.5],['D5',1],['E5',1],
  ['C5',1],['A4',1],['A4',2],

  // ─ Section B ×2 ─
  ['D5',1],['D5',.5],['F5',.5],['A5',1],['G5',.5],['F5',.5],
  ['E5',1.5],['C5',.5],['E5',1],['D5',.5],['C5',.5],
  ['B4',1],['B4',.5],['C5',.5],['D5',1],['E5',1],
  ['C5',1],['A4',1],['A4',2],

  ['D5',1],['D5',.5],['F5',.5],['A5',1],['G5',.5],['F5',.5],
  ['E5',1.5],['C5',.5],['E5',1],['D5',.5],['C5',.5],
  ['B4',1.5],['C5',.5],['D5',1],['E5',1],
  ['C5',1],['A4',1],['A4',2],
];

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = bgmMuted ? 0 : 0.12;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function scheduleNote(freq, t, dur) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.connect(g);
  g.connect(masterGain);
  osc.type = 'square';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.35, t);
  g.gain.setValueAtTime(0.35, t + dur * 0.75);
  g.gain.linearRampToValueAtTime(0, t + dur);
  osc.start(t);
  osc.stop(t + dur + 0.01);
}

function scheduleBGMCycle() {
  if (!bgmActive) return;
  const now = audioCtx.currentTime;
  let t = now, total = 0;
  for (const [note, beats] of BGM1) {
    const dur = beats * BEAT;
    if (NOTE_FREQ[note]) scheduleNote(NOTE_FREQ[note], t, dur * 0.88);
    t += dur; total += dur;
  }
  bgmLoopTimeout = setTimeout(scheduleBGMCycle, (total - 0.3) * 1000);
}

function startBGM() {
  ensureAudio();
  bgmActive = true;
  clearTimeout(bgmLoopTimeout);
  scheduleBGMCycle();
}

function stopBGM() {
  bgmActive = false;
  clearTimeout(bgmLoopTimeout);
  if (audioCtx) { audioCtx.close(); audioCtx = null; masterGain = null; }
}

function toggleMute() {
  bgmMuted = !bgmMuted;
  if (masterGain) masterGain.gain.value = bgmMuted ? 0 : 0.12;
}

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function randomPiece() {
  const p = PIECES[Math.floor(Math.random() * PIECES.length)];
  return {
    shape: p.shape.map(r => [...r]),
    color: p.color,
    x: Math.floor((COLS - p.shape[0].length) / 2),
    y: 0
  };
}

// Sega Tetris: 反時計回りのみ、ウォールキックなし
function rotate(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[cols - 1 - c][r] = shape[r][c];
  return result;
}

function isValid(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) {
        const nx = ox + c, ny = oy + r;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return false;
        if (ny >= 0 && board[ny][nx]) return false;
      }
  return true;
}

function lock() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c]) {
        const ny = current.y + r;
        if (ny < 0) { endGame(); return; }
        board[ny][current.x + c] = current.color;
      }
  clearLines();
  current = next;
  next = randomPiece();
  if (!isValid(current.shape, current.x, current.y)) endGame();
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(c => c !== 0)) {
      board.splice(r, 1);
      board.unshift(Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared > 0) {
    lines += cleared;
    score += SCORE_TABLE[cleared];
    // Sega仕様: 4ライン消去ごとにレベルアップ
    level = Math.floor(lines / 4) + 1;
    const idx = Math.min(level - 1, DROP_INTERVAL_TABLE.length - 1);
    dropInterval = DROP_INTERVAL_TABLE[idx];
  }
}


function endGame() {
  stopBGM();
  if (isHighScore(score)) {
    state = 'name_entry';
    nameChars = ['A', 'A', 'A'];
    nameCursor = 0;
    highlightRank = -1;
  } else {
    state = 'gameover';
  }
}

// --- 描画ユーティリティ ---
function drawBlock(color, px, py) {
  ctx.fillStyle = color;
  ctx.fillRect(px + 1, py + 1, BLOCK - 2, BLOCK - 2);
  // ハイライト
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(px + 1, py + 1, BLOCK - 2, 2);
}

function label(text, x, y, color = '#00e5ff', size = 13) {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px Arial, sans-serif`;
  ctx.fillText(text, x, y);
}

function value(text, x, y, color = '#ffffff', size = 16) {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px 'Courier New', monospace`;
  ctx.fillText(text, x, y);
}

// --- メイン描画 ---
function draw() {
  // 背景
  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, W, H);

  drawLeftPanel();
  drawField();
  drawRightPanel();

  if (state === 'gameover') drawGameOver();
  if (state === 'name_entry') drawNameEntry();
  if (paused) drawPause();
}

function drawPause() {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(FX - 2, FY - 2, COLS * BLOCK + 4, ROWS * BLOCK + 4);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe066';
  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.fillText('PAUSE', FX + COLS * BLOCK / 2, FY + ROWS * BLOCK / 2 - 12);
  ctx.fillStyle = '#aaddff';
  ctx.font = 'bold 12px Arial, sans-serif';
  ctx.fillText('P キー / ⏸ ボタンで再開', FX + COLS * BLOCK / 2, FY + ROWS * BLOCK / 2 + 14);
  ctx.textAlign = 'left';
}

function drawLeftPanel() {
  const x = 4;

  // スコア
  label('SCORE', x, 22);
  value(String(score).padStart(7, '0'), x, 42, '#ffe066');

  // レベル
  label('LEVEL', x, 68);
  value(String(level), x, 88, '#ffe066');

  // ライン
  label('LINES', x, 114);
  value(String(lines), x, 134, '#ffe066');

  // ランキング
  label('RANKING', x, 164);
  const hs = loadHighScores();
  for (let i = 0; i < HS_MAX; i++) {
    const py = 178 + i * 44;
    const isNew = (i === highlightRank);
    label(`${i + 1}.`, x, py + 14, isNew ? '#ffe066' : '#aaddff', 12);
    if (hs[i]) {
      label(hs[i].name, x + 24, py + 14, isNew ? '#ffe066' : '#ffffff', 12);
      label(String(hs[i].score).padStart(7, '0'), x, py + 30, isNew ? '#ffe066' : '#cccccc', 12);
    } else {
      label('---', x + 24, py + 14, '#666688', 12);
      label('-------', x, py + 30, '#666688', 12);
    }
  }
}

function drawField() {
  // フィールド外枠
  ctx.strokeStyle = '#4488cc';
  ctx.lineWidth = 1;
  ctx.strokeRect(FX - 2, FY - 2, COLS * BLOCK + 4, ROWS * BLOCK + 4);

  // フィールド背景
  ctx.fillStyle = '#060f1a';
  ctx.fillRect(FX, FY, COLS * BLOCK, ROWS * BLOCK);

  // グリッド
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 0.5;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      ctx.strokeRect(FX + c * BLOCK, FY + r * BLOCK, BLOCK, BLOCK);

  // 固定ブロック
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c]) drawBlock(board[r][c], FX + c * BLOCK, FY + r * BLOCK);

  // ゴーストピース
  let ghostY = current.y;
  while (isValid(current.shape, current.x, ghostY + 1)) ghostY++;
  if (ghostY !== current.y) {
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        if (current.shape[r][c]) {
          ctx.fillStyle = 'rgba(255,255,255,0.1)';
          ctx.fillRect(FX + (current.x + c) * BLOCK + 1, FY + (ghostY + r) * BLOCK + 1, BLOCK - 2, BLOCK - 2);
        }
  }

  // 現在のピース
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(current.color, FX + (current.x + c) * BLOCK, FY + (current.y + r) * BLOCK);
}

function drawRightPanel() {
  const rx = FX + COLS * BLOCK + 8;

  // NEXT
  label('NEXT', rx, 22);
  const s = next.shape;
  const nBlockSize = 16;
  const nOffX = rx + Math.floor((5 * nBlockSize - s[0].length * nBlockSize) / 2);
  const nOffY = 30;
  for (let r = 0; r < s.length; r++)
    for (let c = 0; c < s[r].length; c++)
      if (s[r][c]) {
        ctx.fillStyle = next.color;
        ctx.fillRect(nOffX + c * nBlockSize + 1, nOffY + r * nBlockSize + 1, nBlockSize - 2, nBlockSize - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(nOffX + c * nBlockSize + 1, nOffY + r * nBlockSize + 1, nBlockSize - 2, 3);
      }

  // 操作説明
  const gy = 140;
  label('← →  移動',       rx, gy,      '#ccddff', 12);
  label('↓   落下',       rx, gy + 20, '#ccddff', 12);
  label('↑/Z 回転(反時計)', rx, gy + 40, '#ccddff', 12);
  label('SPC ハードドロップ', rx, gy + 60, '#ccddff', 12);
  label('P   ' + (paused ? '再開' : 'ポーズ'),         rx, gy + 80, paused ? '#ffe066' : '#ccddff', 12);
  label('M   ' + (bgmMuted ? 'ミュート中' : 'BGM ON'), rx, gy + 100, bgmMuted ? '#ff6666' : '#88ffcc', 12);
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(FX - 2, FY - 2, COLS * BLOCK + 4, ROWS * BLOCK + 4);

  ctx.fillStyle = '#e94560';
  ctx.font = 'bold 20px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('GAME OVER', FX + COLS * BLOCK / 2, FY + ROWS * BLOCK / 2 - 12);
  ctx.fillStyle = '#aaddff';
  ctx.font = 'bold 12px Arial, sans-serif';
  ctx.fillText('SPACE / タップ でリスタート', FX + COLS * BLOCK / 2, FY + ROWS * BLOCK / 2 + 10);
  ctx.textAlign = 'left';
}

function drawNameEntry() {
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(FX - 2, FY - 2, COLS * BLOCK + 4, ROWS * BLOCK + 4);

  const cx = FX + COLS * BLOCK / 2;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe066';
  ctx.font = 'bold 16px Arial, sans-serif';
  ctx.fillText('NEW RECORD!', cx, FY + 70);

  ctx.fillStyle = '#aaddff';
  ctx.font = 'bold 12px Arial, sans-serif';
  ctx.fillText('↑↓:文字  ←→:移動  Enter:決定', cx, FY + 100);
  ctx.fillText('タッチ: 上下スワイプ=文字 左右=移動 タップ=決定', cx, FY + 118);

  // 文字スロット
  const slotW = 36, slotH = 40, gap = 8;
  const totalW = 3 * slotW + 2 * gap;
  const slotX = cx - totalW / 2;
  const slotY = FY + 134;

  for (let i = 0; i < 3; i++) {
    const bx = slotX + i * (slotW + gap);
    ctx.fillStyle = i === nameCursor ? '#1a1a4a' : '#0a0a1a';
    ctx.fillRect(bx, slotY, slotW, slotH);
    ctx.strokeStyle = i === nameCursor ? '#ffe066' : '#4466aa';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, slotY, slotW, slotH);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 22px 'Courier New', monospace`;
    ctx.fillText(nameChars[i], bx + slotW / 2, slotY + slotH - 8);
  }
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;
}

// --- 入力 ---
document.addEventListener('keydown', e => {
  // ブラウザのオートプレイ制限: 初回キー操作でBGM開始
  if (!bgmStarted) {
    bgmStarted = true;
    if (state === 'playing') startBGM();
  }

  // M: ミュート切替
  if (e.code === 'KeyM') { toggleMute(); return; }

  // P: ポーズ切替
  if (e.code === 'KeyP' && (state === 'playing' || paused)) {
    paused = !paused;
    if (paused) {
      if (audioCtx) audioCtx.suspend();
    } else {
      if (audioCtx) audioCtx.resume();
    }
    return;
  }

  if (paused) return;

  if (state === 'name_entry') {
    e.preventDefault();
    switch (e.code) {
      case 'ArrowUp':
        nameChars[nameCursor] = String.fromCharCode(
          nameChars[nameCursor] === 'A' ? 90 : nameChars[nameCursor].charCodeAt(0) - 1);
        break;
      case 'ArrowDown':
        nameChars[nameCursor] = String.fromCharCode(
          nameChars[nameCursor] === 'Z' ? 65 : nameChars[nameCursor].charCodeAt(0) + 1);
        break;
      case 'ArrowLeft':  nameCursor = Math.max(0, nameCursor - 1); break;
      case 'ArrowRight': nameCursor = Math.min(2, nameCursor + 1); break;
      case 'Enter': case 'Space': {
        const name = nameChars.join('');
        highlightRank = insertHighScore(name, score);
        state = 'gameover';
        break;
      }
    }
    return;
  }

  if (state === 'gameover') {
    if (e.code === 'Space' || e.code === 'Enter') startGame();
    return;
  }

  if (state !== 'playing') return;
  switch (e.code) {
    case 'ArrowLeft':
      if (isValid(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (isValid(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      if (isValid(current.shape, current.x, current.y + 1)) { current.y++; score++; }
      else lock();
      break;
    case 'ArrowUp': case 'KeyZ': case 'KeyX': {
      // Sega仕様: 反時計回りのみ、ウォールキックなし
      const rotated = rotate(current.shape);
      if (isValid(rotated, current.x, current.y))
        current.shape = rotated;
      break;
    }
    case 'Space':
      e.preventDefault();
      while (isValid(current.shape, current.x, current.y + 1)) current.y++;
      lock();
      break;
  }
});

// --- ゲームループ ---
let lastTime = 0;
function gameLoop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;

  if (state === 'playing' && !paused) {
    dropTimer += dt;
    if (dropTimer >= dropInterval) {
      dropTimer = 0;
      if (isValid(current.shape, current.x, current.y + 1)) current.y++;
      else lock();
    }
  }

  draw();
  requestAnimationFrame(gameLoop);
}

function startGame() {
  board = createBoard();
  current = randomPiece();
  next = randomPiece();
  score = 0; level = 1; lines = 0;
  dropInterval = DROP_INTERVAL_TABLE[0]; dropTimer = 0;
  highlightRank = -1;
  paused = false;
  const pb = document.getElementById('pause-btn');
  if (pb) pb.textContent = '⏸ ポーズ';
  state = 'playing';
  if (bgmStarted) startBGM();
}

startGame();
lastTime = performance.now();
requestAnimationFrame(gameLoop);

// --- モバイルタッチ対応 ---
(function setupMobileControls() {
  // タッチデバイス検出時にボタンを表示
  window.addEventListener('touchstart', () => {
    document.getElementById('touch-controls').style.display = 'flex';
  }, { once: true });

  // キャンバスタッチ: BGM開始 / ゲームオーバー再スタート / ネームエントリ
  let touchX0 = 0, touchY0 = 0;

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    touchX0 = e.touches[0].clientX;
    touchY0 = e.touches[0].clientY;
    if (!bgmStarted) {
      bgmStarted = true;
      if (state === 'playing') startBGM();
    }
    if (state === 'gameover') startGame();
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    if (state !== 'name_entry') return;
    const dx = e.changedTouches[0].clientX - touchX0;
    const dy = e.changedTouches[0].clientY - touchY0;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 20) {
      // 左右スワイプ: カーソル移動
      if (dx < 0) nameCursor = Math.max(0, nameCursor - 1);
      else        nameCursor = Math.min(2, nameCursor + 1);
    } else if (Math.abs(dy) > 20) {
      // 上下スワイプ: 文字変更
      if (dy < 0) nameChars[nameCursor] = String.fromCharCode(
        nameChars[nameCursor] === 'A' ? 90 : nameChars[nameCursor].charCodeAt(0) - 1);
      else        nameChars[nameCursor] = String.fromCharCode(
        nameChars[nameCursor] === 'Z' ? 65 : nameChars[nameCursor].charCodeAt(0) + 1);
    } else {
      // タップ: 決定
      const name = nameChars.join('');
      highlightRank = insertHighScore(name, score);
      state = 'gameover';
    }
  }, { passive: true });

  // ボタン設定ヘルパー
  function heldBtn(id, action) {
    const el = document.getElementById(id);
    if (!el) return;
    let iv = null;
    el.addEventListener('touchstart', e => {
      e.preventDefault();
      action();
      iv = setInterval(action, 80);
    }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); clearInterval(iv); }, { passive: false });
    el.addEventListener('touchcancel', () => clearInterval(iv));
  }

  function tapBtn(id, action) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', e => { e.preventDefault(); action(); }, { passive: false });
  }

  heldBtn('tc-left', () => {
    if (state === 'playing' && !paused && isValid(current.shape, current.x - 1, current.y)) current.x--;
  });
  heldBtn('tc-right', () => {
    if (state === 'playing' && !paused && isValid(current.shape, current.x + 1, current.y)) current.x++;
  });
  heldBtn('tc-down', () => {
    if (state !== 'playing' || paused) return;
    if (isValid(current.shape, current.x, current.y + 1)) { current.y++; score++; }
    else lock();
  });
  tapBtn('tc-rotate', () => {
    if (state !== 'playing' || paused) return;
    const rotated = rotate(current.shape);
    if (isValid(rotated, current.x, current.y)) current.shape = rotated;
  });
  tapBtn('tc-drop', () => {
    if (state !== 'playing' || paused) return;
    while (isValid(current.shape, current.x, current.y + 1)) current.y++;
    lock();
  });
  // 共通ポーズボタン
  const pauseBtnEl = document.getElementById('pause-btn');
  pauseBtnEl.addEventListener('touchstart', e => {
    e.preventDefault();
    if (state !== 'playing' && !paused) return;
    paused = !paused;
    pauseBtnEl.textContent = paused ? '▶ 再開' : '⏸ ポーズ';
    if (paused) {
      if (audioCtx) audioCtx.suspend();
    } else {
      if (audioCtx) audioCtx.resume();
    }
  }, { passive: false });
  pauseBtnEl.addEventListener('click', () => {
    if (state !== 'playing' && !paused) return;
    paused = !paused;
    pauseBtnEl.textContent = paused ? '▶ 再開' : '⏸ ポーズ';
    if (paused) {
      if (audioCtx) audioCtx.suspend();
    } else {
      if (audioCtx) audioCtx.resume();
    }
  });
})();
