/**
 * Pure rendering-quality helpers (no DOM). Used by app.js and unit tests.
 * Does not invent extra graphics features — only clamps, budgets, and DPR steps.
 */

export const QUALITY_HIGH = 'high';
export const QUALITY_MEDIUM = 'medium';

/** Accept only known saved values; anything else is treated as unset. */
export function parseSavedQuality(raw) {
  if (raw === QUALITY_HIGH || raw === QUALITY_MEDIUM) return raw;
  return null;
}

export function defaultQuality({ isMobile, weakGpu, maxTex, cores } = {}) {
  const tex = maxTex == null ? 4096 : maxTex;
  const n = cores == null ? 8 : cores;
  if (isMobile || weakGpu || tex < 8192 || n <= 4) return QUALITY_MEDIUM;
  return QUALITY_HIGH;
}

export function resolveQuality(savedRaw, hints) {
  return parseSavedQuality(savedRaw) || defaultQuality(hints);
}

/**
 * Cap drawing buffer vs CSS pixels.
 * High: allow up to 2× (4K-class buffers on 2× displays) but never above devicePixelRatio.
 * Medium: stay at 1×. Not a FPS guarantee.
 */
export function dprCap(devicePixelRatio, quality, { highMax = 2, mediumMax = 1, width = 1, height = 1, maxDimension = 16384 } = {}) {
  const dpr = Number.isFinite(Number(devicePixelRatio)) && Number(devicePixelRatio) > 0 ? Number(devicePixelRatio) : 1;
  const low = quality !== QUALITY_HIGH;
  const cap = low ? mediumMax : highMax;
  const w = Math.max(1, width), h = Math.max(1, height);
  const pixelBudget = low ? 2560 * 1440 : 3840 * 2160;
  return Math.min(dpr, cap, Math.sqrt(pixelBudget / (w * h)), maxDimension / w, maxDimension / h);
}

export function stepDpr(current, fps, { dprMax, dprMin = 1, slowStreak, fastStreak, slowNeed = 2, fastNeed = 4, step = 0.25, slowFps = 48, fastFps = 58 } = {}) {
  let dpr = current;
  let slow = slowStreak;
  let fast = fastStreak;
  if (fps < slowFps) { slow++; fast = 0; }
  else if (fps > fastFps) { fast++; slow = 0; }
  else slow = fast = 0;
  let changed = false;
  if (slow >= slowNeed && dpr > dprMin) {
    dpr = Math.max(dprMin, dpr - step);
    slow = 0;
    changed = true;
  } else if (fast >= fastNeed && dpr < dprMax) {
    dpr = Math.min(dprMax, dpr + step);
    fast = 0;
    changed = true;
  }
  return { dpr, slow, fast, changed };
}

export function shouldRenderWhileHidden(hidden) {
  return !hidden;
}

/** Round opacity for CSS; skip writes when unchanged. */
export function labelOpacityCss(o) {
  return o.toFixed(2);
}
