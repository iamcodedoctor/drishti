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
