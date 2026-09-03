import { expect, type Page } from '@playwright/test';

export interface State {
  score: number;
  lines: number;
  level: number;
  over: boolean;
  paused: boolean;
  mode: string;
  next: string;
  hold: string | null;
}

export interface Piece {
  type: string;
  x: number;
  y: number;
  cells: [number, number][];
  dir: { x: number; y: number; axis: 'v' | 'h'; name: string };
}

/** Load the page and wait for the game to be running with a live piece. */
export async function load(page: Page, query = ''): Promise<void> {
  await page.goto(`/index.html${query}`);
  await page.locator('#board').waitFor({ state: 'visible' });
  await expect.poll(() => page.evaluate(() => !!(window as any).sirtetris?.piece)).toBe(true);
}

export const state = (page: Page): Promise<State> =>
  page.evaluate(() => (window as any).sirtetris.state);

export const piece = (page: Page): Promise<Piece> =>
  page.evaluate(() => (window as any).sirtetris.piece);

/** Count of locked (non-null) cells in the settled grid. */
export const filledCount = (page: Page): Promise<number> =>
  page.evaluate(() =>
    ((window as any).sirtetris.grid as (string | null)[][])
      .flat()
      .filter((c) => c !== null).length,
  );

/** Every locked cell as [x, y], sorted. */
export const filledCells = (page: Page): Promise<[number, number][]> =>
  page.evaluate(() => {
    const g = (window as any).sirtetris.grid as (string | null)[][];
    const out: [number, number][] = [];
    g.forEach((row, y) => row.forEach((c, x) => c !== null && out.push([x, y])));
    return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  });

type TestSeam = {
  setGrid(rows: string[]): void;
  setPiece(type: string, x: number, y: number, dir: 'UP' | 'LEFT' | 'RIGHT'): void;
  lock(): void;
  spawn(): void;
};

export async function seam(page: Page, fn: (t: TestSeam) => void): Promise<void> {
  await page.evaluate(`(${fn.toString()})(window.__sirtetrisTest)`);
}
