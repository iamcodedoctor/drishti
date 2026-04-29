// DRISHTI v1 — Human Behavior Simulator
// Non-deterministic mouse, keyboard, scroll, and idle behaviors.

import { randomDelay } from './delay.js';

/**
 * Type text character-by-character with random delays between keystrokes.
 * Mimics human typing with variable speed.
 * @param {import('playwright').Page} page
 * @param {string} selector - CSS selector for input element
 * @param {string} text - Text to type
 * @param {{ min: number, max: number }} keystrokeDelay - Delay range between chars
 */
export async function humanType(page, selector, text, keystrokeDelay = { min: 80, max: 220 }) {
  await page.click(selector);
  await randomDelay(200, 500);

  for (const char of text) {
    await page.type(selector, char, { delay: 0 });
    const pause = Math.floor(
      Math.random() * (keystrokeDelay.max - keystrokeDelay.min + 1)
    ) + keystrokeDelay.min;
    await new Promise((r) => setTimeout(r, pause));

    // Occasional longer pause mid-word (simulates thinking)
    if (Math.random() < 0.05) {
      await randomDelay(300, 800);
    }
  }
}

/**
 * Move mouse to random positions on the page.
 * @param {import('playwright').Page} page
 * @param {number} moves - Number of movements
 */
export async function randomMouseMove(page, moves = 3) {
  const viewport = page.viewportSize() || { width: 1366, height: 768 };

  for (let i = 0; i < moves; i++) {
    const x = Math.floor(Math.random() * (viewport.width * 0.8)) + (viewport.width * 0.1);
    const y = Math.floor(Math.random() * (viewport.height * 0.6)) + (viewport.height * 0.1);

    await page.mouse.move(x, y, {
      steps: Math.floor(Math.random() * 10) + 5,
    });

    await randomDelay(200, 600);
  }
}

/**
 * Scroll the page randomly to simulate reading.
 * @param {import('playwright').Page} page
 * @param {number} scrolls - Number of scroll actions
 */
export async function randomScroll(page, scrolls = 3) {
  for (let i = 0; i < scrolls; i++) {
    const direction = Math.random() > 0.2 ? 1 : -1; // 80% down, 20% up
    const distance = Math.floor(Math.random() * 400) + 100;

    await page.mouse.wheel(0, distance * direction);
    await randomDelay(500, 1500);
  }
}

/**
 * Idle on the page for a random duration (simulates reading/thinking).
 * @param {import('playwright').Page} page
 * @param {{ min: number, max: number }} duration
 */
export async function idle(page, duration = { min: 3000, max: 8000 }) {
  // Optionally move mouse slightly during idle
  if (Math.random() > 0.5) {
    await randomMouseMove(page, 1);
  }
  await randomDelay(duration.min, duration.max);
}

/**
 * Scroll in short, uneven wheel bursts (SERP-style reading).
 * @param {import('playwright').Page} page
 */
export async function humanUnevenScroll(page) {
  const bursts = Math.floor(Math.random() * 5) + 4;
  for (let i = 0; i < bursts; i++) {
    const down = Math.random() > 0.12;
    const delta = Math.floor(Math.random() * 140) + 35;
    await page.mouse.wheel(0, down ? delta : -Math.floor(delta * 0.55));
    await randomDelay(60, 420);
    if (Math.random() < 0.22) await randomDelay(180, 900);
  }
}

/**
 * Move pointer toward an element with slight overshoot, then correct (reaching for a link).
 * @param {import('playwright').Page} page
 * @param {import('playwright').ElementHandle|null} el
 * @param {{ overshoot?: number }} opts
 */
export async function humanHoverElement(page, el, opts = {}) {
  if (!el) return;
  const box = await el.boundingBox();
  if (!box) return;
  const overshoot = opts.overshoot ?? 10 + Math.floor(Math.random() * 8);
  const tx = box.x + box.width * (0.28 + Math.random() * 0.44);
  const ty = box.y + box.height * (0.25 + Math.random() * 0.5);
  const vp = page.viewportSize() || { width: 1366, height: 768 };
  const fx = Math.floor(Math.random() * vp.width * 0.25) + 40;
  const fy = Math.floor(Math.random() * vp.height * 0.35) + 40;
  await page.mouse.move(fx, fy, { steps: 2 });
  const missX = tx + (Math.random() - 0.5) * overshoot * 2;
  const missY = ty + (Math.random() - 0.5) * overshoot * 2;
  await page.mouse.move(missX, missY, {
    steps: 12 + Math.floor(Math.random() * 18),
  });
  await randomDelay(40, 220);
  await page.mouse.move(tx, ty, { steps: 6 + Math.floor(Math.random() * 12) });
}

/**
 * Focus control via mouse move + click at a point inside the element box.
 * @param {import('playwright').Page} page
 * @param {import('playwright').ElementHandle|null} el
 */
export async function humanClickElement(page, el) {
  if (!el) return;
  await humanHoverElement(page, el);
  await randomDelay(80, 320);
  const box = await el.boundingBox();
  if (!box) return;
  const cx = box.x + box.width * (0.35 + Math.random() * 0.3);
  const cy = box.y + box.height * (0.35 + Math.random() * 0.3);
  await page.mouse.click(cx, cy);
}

/**
 * Type text with per-key delays after the active element is already focused.
 * @param {import('playwright').Page} page
 * @param {string} text
 * @param {{ min: number, max: number }} keystrokeDelay
 */
export async function humanTypeFocused(page, text, keystrokeDelay = { min: 80, max: 220 }) {
  for (const char of text) {
    await page.keyboard.type(char, { delay: 0 });
    const pause =
      Math.floor(Math.random() * (keystrokeDelay.max - keystrokeDelay.min + 1)) +
      keystrokeDelay.min;
    await new Promise((r) => setTimeout(r, pause));
    if (Math.random() < 0.06) await randomDelay(280, 750);
  }
}
