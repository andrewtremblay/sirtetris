import { test, expect } from '@playwright/test';
import { load, state, piece, filledCount, seam } from './helpers';

test.describe('mobile / touch', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch-only behaviour');

  test.beforeEach(async ({ page }) => {
    await load(page);
  });

  test('the on-screen pad is shown and the desktop hold panel is hidden', async ({ page }) => {
    await expect(page.locator('#touch')).toBeVisible();
    await expect(page.locator('.hold-panel')).toBeHidden();
  });

  test('the board fits within the viewport', async ({ page }) => {
    const vw = page.viewportSize()!.width;
    const box = (await page.locator('#board').boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(vw);
    expect(box.x).toBeGreaterThanOrEqual(0);
    // no horizontal scrolling of the page
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollW).toBeLessThanOrEqual(vw + 1);
  });

  test('the drop button locks a piece', async ({ page }) => {
    await page.locator('.tb[data-act="drop"]').tap();
    await expect.poll(() => filledCount(page)).toBe(4);
  });

  test('the arrow buttons strafe the piece', async ({ page }) => {
    const minX = (p: { cells: [number, number][] }) => Math.min(...p.cells.map((c) => c[0]));
    const before = minX(await piece(page));
    await page.locator('.tb[data-act="left"]').tap();
    await page.locator('.tb[data-act="left"]').tap();
    expect(minX(await piece(page))).toBeLessThan(before);
  });

  test('tapping the board rotates the piece', async ({ page }) => {
    await load(page, '?test');
    await seam(page, (t) => t.setPiece('T', 6, 6, 'UP'));
    const shape = () =>
      piece(page).then((p) => {
        const mx = Math.min(...p.cells.map((c) => c[0]));
        const my = Math.min(...p.cells.map((c) => c[1]));
        return JSON.stringify(
          p.cells.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]),
        );
      });
    const before = await shape();
    await page.locator('#board').tap({ position: { x: 40, y: 40 } });
    expect(await shape()).not.toBe(before);
  });

  test('the pad pause button toggles pause and relabels', async ({ page }) => {
    const btn = page.locator('#pauseBtn');
    await btn.tap();
    expect((await state(page)).paused).toBe(true);
    await expect(btn).toHaveText('resume');
    await btn.tap();
    expect((await state(page)).paused).toBe(false);
    await expect(btn).toHaveText('pause');
  });
});

test.describe('desktop layout', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop-only behaviour');

  test('the on-screen pad is hidden', async ({ page }) => {
    await load(page);
    await expect(page.locator('#touch')).toBeHidden();
  });
});
