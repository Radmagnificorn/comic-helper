/**
 * canvasLayout.ts – Pure layout math for the stacked-frame Konva stage.
 *
 * All functions are stateless so they can be called from CanvasComposer and,
 * if ever needed, from tests or the export path without importing Konva.
 */
import type { Frame } from '../types';

/** Vertical gap (in canvas px) between stacked frames. */
export const FRAME_GAP = 6;

/**
 * Extra space (canvas px) added below the last frame so its resize handle
 * stays hit-testable. Never included in exports.
 */
export const STAGE_BOTTOM_PADDING = 8;

/**
 * Konva `name` tag applied to all overlay/UI nodes (selection outline,
 * resize handles, mask handles, tail-tip handles) that must be hidden during
 * PNG export.
 */
export const UI_NODE_NAME = 'ui-overlay';

/** Width in canvas px (assumed equal across all frames; 0 if no frames). */
export function canvasWidth(frames: Frame[]): number {
  return frames[0]?.width ?? 0;
}

/** Total stage height in canvas pixels, including inter-frame gaps. */
export function totalCanvasHeight(frames: Frame[]): number {
  if (frames.length === 0) return 0;
  return frames.reduce((sum, f) => sum + f.height, 0) + (frames.length - 1) * FRAME_GAP;
}

/** Y offset (in canvas pixels) of frame at index `i`. */
export function frameOffsetY(frames: Frame[], i: number): number {
  let y = 0;
  for (let k = 0; k < i; k++) y += frames[k].height + FRAME_GAP;
  return y;
}
