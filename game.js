/*
 * sirtetris - a symmetric stacking puzzle
 *
 * Original implementation. No third-party code or assets. The seven
 * tetrominoes are the complete set of 4-cell polyominoes (a mathematical
 * fact, not an authored work); colours, board, timing, scoring, rendering
 * and the alternating-gravity rule below are all original to this file.
 */

(() => {
  "use strict";

  const COLS = 16;
  const ROWS = 16;
  const CELL = 30; // board canvas is COLS*CELL x ROWS*CELL

  // ---- pieces -------------------------------------------------------------
  const SHAPES = {
    I: [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    O: [
      [1, 1],
      [1, 1],
    ],
    T: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    S: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ],
    Z: [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ],
    J: [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    L: [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
  };

  // Muted, deliberately non-standard palette.
  const COLORS = {
    I: "#5ec8d8",
    O: "#e8c15a",
    T: "#b07fd4",
    S: "#7fce6b",
    Z: "#e07a7a",
    J: "#6d8fd8",
    L: "#e0a05a",
  };

  const TYPES = Object.keys(SHAPES);

  // ---- gravity modes ----------------------------------------------------
  // The modes alternate every piece: a vertical "rise" from the floor, then
  // a horizontal slide that alternates the wall it comes from, and repeat.
  const DIR = {
    UP: { x: 0, y: -1, axis: "v", name: "rising  ↑" },
    LEFT: { x: -1, y: 0, axis: "h", name: "sliding  ←" },
    RIGHT: { x: 1, y: 0, axis: "h", name: "sliding  →" },
  };

  // ---- state ----------------------------------------------------------
  let grid, piece, nextType, holdType, canHold;
  let pieceCount, horizFromLeft;
  let score, lines, level;
  let dropMs, dropAcc, lastT;
  let running, over, paused;

  const board = document.getElementById("board");
  const bctx = board.getContext("2d");
  const nextCv = document.getElementById("next");
  const nctx = nextCv.getContext("2d");
  const holdCv = document.getElementById("hold");
  const hctx = holdCv.getContext("2d");

  const els = {
    mode: document.getElementById("mode"),
    score: document.getElementById("score"),
    lines: document.getElementById("lines"),
    level: document.getElementById("level"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlaySub: document.getElementById("overlay-sub"),
  };

  // ---- helpers ------------------------------------------------------------
  const makeGrid = () =>
    Array.from({ length: ROWS }, () => Array(COLS).fill(null));

  const emptyRow = () => Array(COLS).fill(null);

  function rotateCW(m) {
    const n = m.length;
    const r = Array.from({ length: n }, () => Array(n).fill(0));
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) r[x][n - 1 - y] = m[y][x];
    return r;
  }
  const rotateCCW = (m) => rotateCW(rotateCW(rotateCW(m)));

  function cells(p) {
    const out = [];
    for (let y = 0; y < p.matrix.length; y++)
      for (let x = 0; x < p.matrix.length; x++)
        if (p.matrix[y][x]) out.push([p.x + x, p.y + y]);
    return out;
  }

  function collides(p, g = grid) {
    return cells(p).some(
      ([gx, gy]) =>
        gx < 0 ||
        gx >= COLS ||
        gy < 0 ||
        gy >= ROWS ||
        g[gy][gx] !== null,
    );
  }

  // 7-bag randomiser
  let bag = [];
  function nextFromBag() {
    if (bag.length === 0) {
      bag = TYPES.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop();
  }

  function currentDir() {
    if (pieceCount % 2 === 0) return DIR.UP;
    return horizFromLeft ? DIR.RIGHT : DIR.LEFT;
  }

  function spawnPiece(type) {
    const dir = currentDir();
    const matrix = SHAPES[type].map((r) => r.slice());
    const n = matrix.length;
    let x, y;
    if (dir === DIR.UP) {
      x = ((COLS - n) / 2) | 0;
      y = ROWS - n;
    } else if (dir === DIR.LEFT) {
      x = COLS - n;
      y = ((ROWS - n) / 2) | 0;
    } else {
      x = 0;
      y = ((ROWS - n) / 2) | 0;
    }
    return { type, matrix, x, y, dir };
  }

  // The piece enters along its edge wherever there is room; only a fully
  // blocked entry edge is game over.
  function resolveSpawn(p) {
    if (!collides(p)) return true;
    const perp = p.dir.axis === "v" ? "x" : "y";
    const span = Math.max(COLS, ROWS);
    for (let d = 1; d < span; d++) {
      for (const s of [d, -d]) {
        p[perp] += s;
        if (!collides(p)) return true;
        p[perp] -= s;
      }
    }
    return false;
  }

  function newPiece() {
    piece = spawnPiece(nextType);
    nextType = nextFromBag();
    canHold = true;
    els.mode.textContent = piece.dir.name;
    drawNext();
    if (!resolveSpawn(piece)) endGame();
  }

  // ---- gravity + locking ------------------------------------------------
  function step() {
    const d = piece.dir;
    piece.x += d.x;
    piece.y += d.y;
    if (collides(piece)) {
      piece.x -= d.x;
      piece.y -= d.y;
      lockPiece();
    }
    dropAcc = 0;
  }

  function hardDrop() {
    const d = piece.dir;
    while (!collides(piece)) {
      piece.x += d.x;
      piece.y += d.y;
      score += 1;
    }
    piece.x -= d.x;
    piece.y -= d.y;
    lockPiece();
  }

  function lockPiece() {
    for (const [gx, gy] of cells(piece)) grid[gy][gx] = piece.type;
    clearLines(piece.dir.axis);
    pieceCount++;
    if (pieceCount % 2 === 0) horizFromLeft = !horizFromLeft; // toggle after each horizontal piece
    updateStats();
    newPiece();
  }

  // Any full row and any full column clears, every lock. The gap left by
  // cleared *rows* closes toward the ceiling (vertical mode); the gap left by
  // cleared *columns* closes toward the wall the piece came from (horizontal
  // mode). The lines parallel to the direction of travel simply blank out.
  function clearLines(axis) {
    const fullRows = [];
    for (let y = 0; y < ROWS; y++)
      if (grid[y].every((c) => c !== null)) fullRows.push(y);

    const fullCols = [];
    for (let x = 0; x < COLS; x++) {
      let all = true;
      for (let y = 0; y < ROWS; y++)
        if (grid[y][x] === null) { all = false; break; }
      if (all) fullCols.push(x);
    }

    const cleared = fullRows.length + fullCols.length;
    if (cleared) {
      const rowSet = new Set(fullRows);
      const colSet = new Set(fullCols);
      for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++)
          if (rowSet.has(y) || colSet.has(x)) grid[y][x] = null;

      if (axis === "v" && fullRows.length) {
        const kept = grid.filter((_, y) => !rowSet.has(y));
        while (kept.length < ROWS) kept.push(emptyRow());
        grid = kept;
      } else if (axis === "h" && fullCols.length) {
        const padLeft = piece.dir === DIR.RIGHT; // came from the left wall
        for (let y = 0; y < ROWS; y++) {
          const keep = grid[y].filter((_, x) => !colSet.has(x));
          const pad = Array(fullCols.length).fill(null);
          grid[y] = padLeft ? [...pad, ...keep] : [...keep, ...pad];
        }
      }

      lines += cleared;
      // rising reward for clearing several lines at once
      score += 50 * cleared * (cleared + 1) * level;
      const newLevel = 1 + Math.floor(lines / 10);
      if (newLevel !== level) {
        level = newLevel;
        dropMs = Math.max(90, 800 - (level - 1) * 65);
      }
    }
  }

  // ---- player actions -------------------------------------------------
  function tryMove(dx, dy) {
    piece.x += dx;
    piece.y += dy;
    if (collides(piece)) {
      piece.x -= dx;
      piece.y -= dy;
      return false;
    }
    return true;
  }

  function tryRotate(cw) {
    const before = piece.matrix;
    piece.matrix = cw ? rotateCW(before) : rotateCCW(before);
    // small kick search along both axes
    const kicks = [0, 1, -1, 2, -2];
    for (const a of kicks) {
      for (const b of kicks) {
        piece.x += a;
        piece.y += b;
        if (!collides(piece)) return;
        piece.x -= a;
        piece.y -= b;
      }
    }
    piece.matrix = before;
  }

  function doHold() {
    if (!canHold) return;
    const cur = piece.type;
    if (holdType === null) {
      holdType = cur;
      newPiece();
    } else {
      const swap = holdType;
      holdType = cur;
      piece = spawnPiece(swap);
      els.mode.textContent = piece.dir.name;
      if (!resolveSpawn(piece)) endGame();
    }
    canHold = false;
    drawHold();
  }

  // Move across the direction of travel; the two keys that point along
  // travel are soft / (reverse = ignored).
  function handleDirKey(key) {
    const d = piece.dir;
    if (d.axis === "v") {
      if (key === "ArrowLeft") tryMove(-1, 0);
      else if (key === "ArrowRight") tryMove(1, 0);
      else if (key === "ArrowUp") step(); // soft drop toward ceiling
    } else {
      if (key === "ArrowUp") tryMove(0, -1);
      else if (key === "ArrowDown") tryMove(0, 1);
      else if (
        (key === "ArrowLeft" && d === DIR.LEFT) ||
        (key === "ArrowRight" && d === DIR.RIGHT)
      )
        step(); // soft drop toward the wall
    }
  }

  // ---- rendering -----------------------------------------------------
  function drawCell(ctx, x, y, size, type, ghost) {
    const c = COLORS[type];
    if (ghost) {
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.5;
      ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = c;
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(x + 1, y + 1, size - 2, 3);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(x + 1, y + size - 4, size - 2, 3);
  }

  function ghostPiece() {
    const g = { ...piece, matrix: piece.matrix, x: piece.x, y: piece.y };
    const d = piece.dir;
    while (!collides(g)) {
      g.x += d.x;
      g.y += d.y;
    }
    g.x -= d.x;
    g.y -= d.y;
    return g;
  }

  function drawBoard() {
    bctx.clearRect(0, 0, board.width, board.height);

    // grid lines
    bctx.strokeStyle = "#1b1e26";
    bctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      bctx.beginPath();
      bctx.moveTo(x * CELL, 0);
      bctx.lineTo(x * CELL, ROWS * CELL);
      bctx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      bctx.beginPath();
      bctx.moveTo(0, y * CELL);
      bctx.lineTo(COLS * CELL, y * CELL);
      bctx.stroke();
    }

    // settled blocks
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (grid[y][x]) drawCell(bctx, x * CELL, y * CELL, CELL, grid[y][x], false);

    if (piece && !over) {
      for (const [gx, gy] of cells(ghostPiece()))
        drawCell(bctx, gx * CELL, gy * CELL, CELL, piece.type, true);
      for (const [gx, gy] of cells(piece))
        drawCell(bctx, gx * CELL, gy * CELL, CELL, piece.type, false);
    }

    // arrow marking where the current piece travels
    if (piece && !over) drawDirArrow(piece.dir);
  }

  function drawDirArrow(d) {
    bctx.fillStyle = "rgba(111,183,201,0.5)";
    bctx.save();
    const w = board.width;
    const h = board.height;
    bctx.beginPath();
    if (d === DIR.UP) {
      bctx.moveTo(w / 2, 8);
      bctx.lineTo(w / 2 - 9, 24);
      bctx.lineTo(w / 2 + 9, 24);
    } else if (d === DIR.LEFT) {
      bctx.moveTo(8, h / 2);
      bctx.lineTo(24, h / 2 - 9);
      bctx.lineTo(24, h / 2 + 9);
    } else {
      bctx.moveTo(w - 8, h / 2);
      bctx.lineTo(w - 24, h / 2 - 9);
      bctx.lineTo(w - 24, h / 2 + 9);
    }
    bctx.closePath();
    bctx.fill();
    bctx.restore();
  }

  function drawMini(ctx, cv, type) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!type) return;
    const m = SHAPES[type];
    const n = m.length;
    const size = 24;
    const offX = (cv.width - n * size) / 2;
    const offY = (cv.height - n * size) / 2;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (m[y][x])
          drawCell(ctx, offX + x * size, offY + y * size, size, type, false);
  }
  const drawNext = () => drawMini(nctx, nextCv, nextType);
  const drawHold = () => drawMini(hctx, holdCv, holdType);

  function updateStats() {
    els.score.textContent = score;
    els.lines.textContent = lines;
    els.level.textContent = level;
  }

  // ---- loop ---------------------------------------------------------
  function frame(t) {
    if (!running) return;
    const dt = t - lastT;
    lastT = t;
    if (!paused && !over) {
      dropAcc += dt;
      if (dropAcc >= dropMs) step();
    }
    drawBoard();
    requestAnimationFrame(frame);
  }

  // ---- lifecycle --------------------------------------------------
  function reset() {
    grid = makeGrid();
    bag = [];
    pieceCount = 0;
    horizFromLeft = false;
    holdType = null;
    canHold = true;
    score = 0;
    lines = 0;
    level = 1;
    dropMs = 800;
    dropAcc = 0;
    over = false;
    paused = false;
    nextType = nextFromBag();
    newPiece();
    updateStats();
    hideOverlay();
    drawHold();
    syncPauseBtn();
    if (!running) {
      running = true;
      lastT = performance.now();
      requestAnimationFrame(frame);
    }
  }

  function endGame() {
    over = true;
    showOverlay("game over", "press R / tap here to play again");
    syncPauseBtn();
  }

  function showOverlay(title, sub) {
    els.overlayTitle.textContent = title;
    els.overlaySub.textContent = sub;
    els.overlay.classList.remove("hidden");
  }
  const hideOverlay = () => els.overlay.classList.add("hidden");

  function togglePause() {
    if (over) return;
    paused = !paused;
    if (paused) showOverlay("paused", "press P / tap here to resume");
    else {
      hideOverlay();
      lastT = performance.now();
    }
    syncPauseBtn();
  }

  // ---- input ------------------------------------------------------
  const repeatable = new Set([
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
  ]);
  let repeatKey = null;
  let repeatTimer = null;

  function startRepeat(key) {
    stopRepeat();
    repeatKey = key;
    repeatTimer = setTimeout(() => {
      repeatTimer = setInterval(() => {
        if (!paused && !over) handleDirKey(key);
      }, 55);
    }, 160);
  }
  function stopRepeat() {
    clearTimeout(repeatTimer);
    clearInterval(repeatTimer);
    repeatTimer = null;
    repeatKey = null;
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(k))
      e.preventDefault();

    if (k === "r" || k === "R") return reset();
    if (k === "p" || k === "P") return togglePause();
    if (over || paused) return;

    if (k === " ") return hardDrop();
    if (k === "z" || k === "Z") return tryRotate(false);
    if (k === "x" || k === "X") return tryRotate(true);
    if (k === "c" || k === "C") return doHold();

    if (repeatable.has(k)) {
      if (e.repeat) return; // we run our own repeat
      handleDirKey(k);
      startRepeat(k);
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === repeatKey) stopRepeat();
  });
  window.addEventListener("blur", stopRepeat);

  // ---- touch input --------------------------------------------------
  // The on-screen pad maps straight onto the arrow keys, so handleDirKey's
  // per-mode logic (strafe vs. soft drop) is reused unchanged.
  const TOUCH_KEY = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
  };

  function doAction(act) {
    if (act === "pause") {
      if (over) reset();
      else togglePause();
      return;
    }
    if (over || paused) return;
    if (act === "rotate") return tryRotate(true);
    if (act === "drop") return hardDrop();
    if (act === "hold") return doHold();
    if (TOUCH_KEY[act]) handleDirKey(TOUCH_KEY[act]);
  }

  const touchPad = document.getElementById("touch");
  if (touchPad) {
    for (const btn of touchPad.querySelectorAll("button[data-act]")) {
      const act = btn.dataset.act;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        doAction(act);
        syncPauseBtn();
        if (TOUCH_KEY[act]) startRepeat(TOUCH_KEY[act]);
      });
      const release = () => stopRepeat();
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointercancel", release);
      btn.addEventListener("pointerleave", release);
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
    }
  }

  // Tap (not drag) on the board rotates.
  let tapStart = null;
  board.addEventListener("pointerdown", (e) => {
    tapStart = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  board.addEventListener("pointerup", (e) => {
    if (!tapStart) return;
    const moved = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y);
    const quick = Date.now() - tapStart.t < 400;
    tapStart = null;
    if (moved < 12 && quick && !over && !paused) tryRotate(true);
  });

  els.overlay.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (over) reset();
    else if (paused) togglePause();
  });

  const pauseBtn = document.getElementById("pauseBtn");
  function syncPauseBtn() {
    if (pauseBtn) pauseBtn.textContent = over ? "restart" : paused ? "resume" : "pause";
  }

  // ---- read-only introspection (console tinkering + tests) ----------
  window.sirtetris = {
    get grid() {
      return grid.map((r) => r.slice());
    },
    get piece() {
      return piece && { ...piece, cells: cells(piece) };
    },
    get state() {
      return {
        score,
        lines,
        level,
        over,
        paused,
        mode: piece && piece.dir.name,
        next: nextType,
        hold: holdType,
      };
    },
  };

  // Test-only seam (opt in with ?test in the URL) for deterministic setups.
  if (/[?&]test\b/.test(location.search)) {
    window.__sirtetrisTest = {
      // rows: array of strings; "." is empty, any other char fills the cell
      // (a tetromino letter picks that colour, anything else falls back to I).
      setGrid(rows) {
        grid = makeGrid();
        rows.forEach((row, y) => {
          if (y >= ROWS) return;
          for (let x = 0; x < Math.min(row.length, COLS); x++) {
            const c = row[x];
            if (c !== "." && c !== " ")
              grid[y][x] = SHAPES[c] ? c : "I";
          }
        });
      },
      setPiece(type, x, y, dirKey) {
        piece = {
          type,
          matrix: SHAPES[type].map((r) => r.slice()),
          x,
          y,
          dir: DIR[dirKey],
        };
      },
      lock: () => lockPiece(),
      spawn: () => newPiece(),
      hardDrop: () => hardDrop(),
      step: () => step(),
      clear: (axis) => clearLines(axis),
    };
  }

  reset();
})();
