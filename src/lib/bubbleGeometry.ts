/**
 * bubbleGeometry.ts – Pure geometric helpers for comic speech bubbles.
 *
 * No DOM, no Konva, no Svelte — safe to import anywhere including tests.
 */

/** Padding (canvas px) between text and the bubble background edge. */
export const BUBBLE_PAD = 3;
/** Corner radius (canvas px) of the white bubble background rect. */
export const BUBBLE_RADIUS = 5;
/** Radius (canvas px) of the draggable tail-tip handle circle. */
export const TAIL_HANDLE_R = 3;
/**
 * How far (canvas px) the tip can lead the base along the chosen edge before
 * the base starts sliding. Gives the tail an angled appearance.
 */
export const TAIL_LEAD = 6;

export type BubbleSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * Project the tip onto the bubble rect's nearest edge and return that edge
 * (side) plus the base midpoint in bubble-local coords. Returns null when
 * the tip is inside the rect — in that case no tail should be drawn.
 */
export function naturalBase(
  w: number, h: number, r: number, tx: number, ty: number,
): { side: BubbleSide; bx: number; by: number } | null {
  const insideRect = tx >= 0 && tx <= w && ty >= 0 && ty <= h;
  if (insideRect) return null;
  const cx = w / 2, cy = h / 2;
  const dx = tx - cx, dy = ty - cy;
  const baseW = Math.max(3, Math.min(Math.min(w, h) / 2, 5));
  const horiz = Math.abs(dx) * h > Math.abs(dy) * w;
  const side: BubbleSide = horiz
    ? (dx > 0 ? 'right' : 'left')
    : (dy > 0 ? 'bottom' : 'top');
  if (side === 'top' || side === 'bottom') {
    const m = Math.max(r + baseW / 2, Math.min(w - r - baseW / 2, tx));
    return { side, bx: m, by: side === 'top' ? 0 : h };
  } else {
    const m = Math.max(r + baseW / 2, Math.min(h - r - baseW / 2, ty));
    return { side, bx: side === 'left' ? 0 : w, by: m };
  }
}

/**
 * Determine which edge a persisted base point lies on. Tolerant of small
 * float drift after rounding.
 */
export function sideOfBase(w: number, h: number, bx: number, by: number): BubbleSide {
  const eps = 0.5;
  if (Math.abs(by) <= eps) return 'top';
  if (Math.abs(by - h) <= eps) return 'bottom';
  if (Math.abs(bx) <= eps) return 'left';
  if (Math.abs(bx - w) <= eps) return 'right';
  // Fall back to closest edge (handles rects that shrank after a font-size change).
  const dTop = by, dBot = h - by, dLeft = bx, dRight = w - bx;
  const m = Math.min(dTop, dBot, dLeft, dRight);
  if (m === dTop) return 'top';
  if (m === dBot) return 'bottom';
  if (m === dLeft) return 'left';
  return 'right';
}

/** Snap a base point onto its edge and clamp it between the corner arcs. */
export function clampBase(
  w: number, h: number, r: number,
  side: BubbleSide, bx: number, by: number,
): { side: BubbleSide; bx: number; by: number } {
  const baseW = Math.max(3, Math.min(Math.min(w, h) / 2, 5));
  if (side === 'top' || side === 'bottom') {
    const m = Math.max(r + baseW / 2, Math.min(w - r - baseW / 2, bx));
    return { side, bx: m, by: side === 'top' ? 0 : h };
  }
  const m = Math.max(r + baseW / 2, Math.min(h - r - baseW / 2, by));
  return { side, bx: side === 'left' ? 0 : w, by: m };
}

/**
 * Slide `base` to follow `tip` with TAIL_LEAD hysteresis: while the tip
 * is on the same side as the base, the base only moves once the tip has led
 * it by more than TAIL_LEAD. Crossing to a new side snaps the base.
 *
 * Mutates and returns the (possibly new) base object.
 */
export function updateBaseForTip(
  w: number, h: number, r: number,
  tip: { x: number; y: number },
  base: { side: BubbleSide; bx: number; by: number } | null,
): { side: BubbleSide; bx: number; by: number } | null {
  const natural = naturalBase(w, h, r, tip.x, tip.y);
  if (!natural) return base; // tip inside rect — keep last base
  if (!base || natural.side !== base.side) return natural;
  // Same side: slide by the excess beyond TAIL_LEAD.
  if (natural.side === 'top' || natural.side === 'bottom') {
    const diff = natural.bx - base.bx;
    if (Math.abs(diff) > TAIL_LEAD) {
      const slide = diff - Math.sign(diff) * TAIL_LEAD;
      return clampBase(w, h, r, base.side, base.bx + slide, base.by);
    }
  } else {
    const diff = natural.by - base.by;
    if (Math.abs(diff) > TAIL_LEAD) {
      const slide = diff - Math.sign(diff) * TAIL_LEAD;
      return clampBase(w, h, r, base.side, base.bx, base.by + slide);
    }
  }
  return base;
}

/**
 * Draw a rounded-rect + triangular tail path in `ctx`.
 *
 * All coordinates are in bubble-local space (top-left = 0,0).
 * When `forcedBase` is provided its side+midpoint is used as the tail anchor
 * (allowing an angled tail that lags behind the tip). If the tip is inside
 * the rect, no tail is drawn.
 */
export function drawBubblePath(
  ctx: CanvasRenderingContext2D,
  w: number, h: number, r: number,
  tx: number, ty: number,
  forcedBase?: { side: BubbleSide; bx: number; by: number } | null,
  flatTip: boolean = false,
) {
  const insideRect = tx >= 0 && tx <= w && ty >= 0 && ty <= h;
  const baseW = flatTip ? 3 : Math.max(3, Math.min(Math.min(w, h) / 2, 5));

  let side: BubbleSide | null = null;
  let m = 0;

  if (!insideRect) {
    if (forcedBase) {
      side = forcedBase.side;
      m = (side === 'top' || side === 'bottom') ? forcedBase.bx : forcedBase.by;
      // Re-clamp in case the rect shrank since the base was last persisted.
      if (side === 'top' || side === 'bottom') {
        m = Math.max(r + baseW / 2, Math.min(w - r - baseW / 2, m));
      } else {
        m = Math.max(r + baseW / 2, Math.min(h - r - baseW / 2, m));
      }
    } else {
      const cx = w / 2, cy = h / 2;
      const dx = tx - cx, dy = ty - cy;
      const horiz = Math.abs(dx) * h > Math.abs(dy) * w;
      side = horiz ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
      m = (side === 'top' || side === 'bottom')
        ? Math.max(r + baseW / 2, Math.min(w - r - baseW / 2, tx))
        : Math.max(r + baseW / 2, Math.min(h - r - baseW / 2, ty));
    }
  }

  /**
   * Emit the tail vertices for the current side. With `flatTip`, the tail
   * becomes a parallelogram (constant width strip) instead of converging to
   * a single point — used when the bubble is connected to another bubble.
   */
  const drawTail = (
    blX: number, blY: number, brX: number, brY: number,
    bmX: number, bmY: number,
  ) => {
    ctx.lineTo(blX, blY);
    if (flatTip) {
      const dxL = blX - bmX, dyL = blY - bmY;
      const dxR = brX - bmX, dyR = brY - bmY;
      ctx.lineTo(tx + dxL, ty + dyL);
      ctx.lineTo(tx + dxR, ty + dyR);
    } else {
      ctx.lineTo(tx, ty);
    }
    ctx.lineTo(brX, brY);
  };

  ctx.beginPath();
  ctx.moveTo(r, 0);

  // Top edge
  if (side === 'top') {
    drawTail(m - baseW / 2, 0, m + baseW / 2, 0, m, 0);
  }
  ctx.lineTo(w - r, 0);
  ctx.arcTo(w, 0, w, r, r);

  // Right edge
  if (side === 'right') {
    drawTail(w, m - baseW / 2, w, m + baseW / 2, w, m);
  }
  ctx.lineTo(w, h - r);
  ctx.arcTo(w, h, w - r, h, r);

  // Bottom edge
  if (side === 'bottom') {
    drawTail(m + baseW / 2, h, m - baseW / 2, h, m, h);
  }
  ctx.lineTo(r, h);
  ctx.arcTo(0, h, 0, h - r, r);

  // Left edge
  if (side === 'left') {
    drawTail(0, m + baseW / 2, 0, m - baseW / 2, 0, m);
  }
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);

  ctx.closePath();
}
