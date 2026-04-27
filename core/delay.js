// DRISHTI v1 — Delay Module
// Non-deterministic timing to avoid detection patterns.

/**
 * Sleep for a random duration between min and max milliseconds.
 * @param {number} min - Minimum delay in ms
 * @param {number} max - Maximum delay in ms
 * @returns {Promise<number>} Actual delay used
 */
export async function randomDelay(min = 500, max = 2000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise((resolve) => setTimeout(resolve, ms));
  return ms;
}

/**
 * Sleep for an exact duration.
 * @param {number} ms - Duration in milliseconds
 */
export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
