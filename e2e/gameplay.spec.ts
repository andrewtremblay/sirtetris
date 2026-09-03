import { test, expect } from '@playwright/test';
import { load, state, piece, filledCount, filledCells, seam } from './helpers';

test.beforeEach(async ({ page }) => {
  await load(page);
});

test('starts fresh: empty board, zeroed stats, rising mode', async ({ page }) => {
  const s = await state(page);
  expect(s).toMatchObject({ score: 0, lines: 0, level: 1, over: false, paused: false });
  expect(s.mode).toContain('rising');
  expect(await filledCount(page)).toBe(0);

  const p = await piece(page);
  expect(p.cells).toHaveLength(4);
  for (const [x, y] of p.cells) {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(16);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(16);
  }
});

test('hard drop locks the piece and scores', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect.poll(() => filledCount(page)).toBe(4);
  expect((await state(page)).score).toBeGreaterThan(0);
});

test('modes alternate rising -> sliding -> rising', async ({ page }) => {
  expect((await state(page)).mode).toContain('rising');
  await page.keyboard.press('Space');
  await expect.poll(() => state(page).then((s) => s.mode)).toContain('sliding');
  await page.keyboard.press('Space');
  await expect.poll(() => state(page).then((s) => s.mode)).toContain('rising');
});

test('the sliding side alternates left then right', async ({ page }) => {
  await page.keyboard.press('Space'); // lock piece 0 (rising)
  await expect.poll(() => state(page).then((s) => s.mode)).toContain('sliding');
  expect((await state(page)).mode).toContain('←'); // first slide comes from the right

  await page.keyboard.press('Space'); // lock piece 1 (sliding)
  await page.keyboard.press('Space'); // lock piece 2 (rising)
  await expect.poll(() => state(page).then((s) => s.mode)).toContain('sliding');
  expect((await state(page)).mode).toContain('→'); // second slide comes from the left
});

test('strafing moves the piece across the direction of travel', async ({ page }) => {
  const minX = (p: { cells: [number, number][] }) => Math.min(...p.cells.map((c) => c[0]));
  const before = minX(await piece(page));
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const after = minX(await piece(page));
  expect(after).toBeLessThan(before);
});

test('rotation changes the piece footprint', async ({ page }) => {
  await load(page, '?test');
  await seam(page, (t) => t.setPiece('T', 6, 6, 'UP'));
  // shape normalised to its own bounding box, so a stray gravity step between
  // the two reads can't masquerade as a rotation
  const shape = () =>
    piece(page).then((p) => {
      const mx = Math.min(...p.cells.map((c) => c[0]));
      const my = Math.min(...p.cells.map((c) => c[1]));
      return JSON.stringify(
        p.cells.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]),
      );
    });
  const before = await shape();
  await page.keyboard.press('x');
  expect(await shape()).not.toBe(before);
});

test('hold stashes the current piece', async ({ page }) => {
  const held = (await piece(page)).type;
  await page.keyboard.press('c');
  await expect.poll(() => state(page).then((s) => s.hold)).toBe(held);
  expect((await piece(page)).type).not.toBe(null);
});

test('pause halts play and can be resumed', async ({ page }) => {
  await page.keyboard.press('p');
  expect((await state(page)).paused).toBe(true);
  await expect(page.locator('#overlay')).toBeVisible();
  await page.keyboard.press('p');
  expect((await state(page)).paused).toBe(false);
  await expect(page.locator('#overlay')).toBeHidden();
});

test('restart clears the board and stats', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect.poll(() => filledCount(page)).toBe(4);
  await page.keyboard.press('r');
  await expect.poll(() => filledCount(page)).toBe(0);
  expect((await state(page)).score).toBe(0);
});

test.describe('deterministic line clears (?test seam)', () => {
  test.beforeEach(async ({ page }) => {
    await load(page, '?test');
  });

  test('a full row clears and collapses toward the ceiling', async ({ page }) => {
    await seam(page, (t) => {
      const rows = Array.from({ length: 16 }, () => '.'.repeat(16));
      rows[15] = '#'.repeat(14) + '..'; // row 15 filled except x=14,15
      t.setGrid(rows);
      t.setPiece('O', 14, 14, 'UP'); // fills (14,14)(15,14)(14,15)(15,15)
      t.lock();
    });

    expect((await state(page)).lines).toBe(1);
    expect((await state(page)).score).toBeGreaterThan(0);
    // only the O's upper half survives, now resting one row above the floor
    expect(await filledCells(page)).toEqual([
      [14, 14],
      [15, 14],
    ]);
  });

  test('a full column clears and collapses toward the entry wall', async ({ page }) => {
    await seam(page, (t) => {
      const rows = Array.from({ length: 16 }, (_, y) =>
        y < 2 ? '.'.repeat(16) : '.'.repeat(15) + '#', // col 15 filled for y>=2
      );
      t.setGrid(rows);
      t.setPiece('O', 14, 0, 'LEFT'); // fills (14,0)(15,0)(14,1)(15,1) -> col 15 complete
      t.lock();
    });

    expect((await state(page)).lines).toBe(1);
    // column 15 gone; the O's other half shifts left into column 14
    expect(await filledCells(page)).toEqual([
      [14, 0],
      [14, 1],
    ]);
  });

  test('no room to spawn is game over', async ({ page }) => {
    await seam(page, (t) => {
      // board full except one hole per row on the diagonal: no line is complete,
      // but no tetromino fits anywhere
      const rows = Array.from({ length: 16 }, (_, i) =>
        '#'.repeat(i) + '.' + '#'.repeat(15 - i),
      );
      t.setGrid(rows);
      t.spawn();
    });
    expect((await state(page)).over).toBe(true);
  });
});
