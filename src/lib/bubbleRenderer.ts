/**
 * bubbleRenderer.ts – Offscreen Canvas 2D rasterization of speech bubbles
 * and PixelMplus10 font management.
 *
 * Keeps all "draw to an HTMLCanvasElement" logic out of CanvasComposer so
 * the Svelte component only deals with Konva node creation.
 */
import type { SpeechBubble } from '../types';
import { BUBBLE_PAD, BUBBLE_RADIUS, TAIL_HANDLE_R, drawBubblePath, naturalBase, clampBase, sideOfBase, updateBaseForTip, TAIL_LEAD } from './bubbleGeometry';
import type { BubbleSide } from './bubbleGeometry';

export { BUBBLE_PAD, BUBBLE_RADIUS, TAIL_HANDLE_R, TAIL_LEAD, updateBaseForTip };
export type { BubbleSide };
export { naturalBase, clampBase, sideOfBase };

/** CSS font-family name registered via FontFace at startup. */
export const BUBBLE_FONT = 'PixelMplus10';

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const s = hex.trim().replace(/^#/, '');
  if (s.length === 3) {
    return {
      r: parseInt(s[0] + s[0], 16),
      g: parseInt(s[1] + s[1], 16),
      b: parseInt(s[2] + s[2], 16),
    };
  }
  if (s.length === 6) {
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
    };
  }
  return { r: 0, g: 0, b: 0 };
}

// Singleton promise so we only load the font once per page lifetime.
let fontPromise: Promise<void> | null = null;

/**
 * Load the PixelMplus10 font from the given URL and register it with the
 * document. Subsequent calls return the same promise.
 */
export function loadBubbleFont(fontUrl: string): Promise<void> {
  if (fontPromise) return fontPromise;
  fontPromise = (async () => {
    try {
      const face = new FontFace(BUBBLE_FONT, `url(${fontUrl})`);
      await face.load();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (document as any).fonts.add(face);
    } catch (e) {
      console.warn('Failed to load bubble font', e);
    }
  })();
  return fontPromise;
}

export interface BubbleRenderParams {
  bubble: SpeechBubble;
  bgW: number;
  bgH: number;
  lines: string[];
  /** Tail tip in bubble-local coords (relative to bubble.x / bubble.y). */
  tip: { x: number; y: number };
  /** Current tail base (may be null if tip is inside the rect). */
  base: { side: BubbleSide; bx: number; by: number } | null;
  /** Render the tail as a flat-ended parallelogram instead of a point. */
  flatTip?: boolean;
  /** Color for the bubble text. Defaults to '#000000'. */
  fontColor?: string;
}

/**
 * Measure a bubble's text and return the background rect dimensions.
 * Call this once when first creating a bubble so `buildBubbleCanvas` has
 * consistent bgW/bgH.
 */
export function measureBubble(
  text: string,
  fontSize: number,
): { bgW: number; bgH: number; lines: string[] } {
  const lines = text.split('\n');
  const lineHeight = fontSize; // matches Konva.Text lineHeight 1.0
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `${fontSize}px "${BUBBLE_FONT}"`;
  const tw = Math.ceil(Math.max(1, ...lines.map(l => ctx.measureText(l).width)));
  const th = Math.ceil(lines.length * lineHeight);
  return {
    bgW: tw + BUBBLE_PAD * 2,
    bgH: th + BUBBLE_PAD * 2,
    lines,
  };
}

/**
 * Rasterize a speech bubble (background rect + tail + text) onto an offscreen
 * HTMLCanvasElement at native (1x) resolution. Returns the canvas plus the
 * offset from bubble.x/y to the canvas top-left (needed because the tail tip
 * may extend outside the rect).
 *
 * The shape's alpha channel is thresholded to {0, 255} after filling so that
 * nearest-neighbor upscaling during export doesn't produce fuzzy edges.
 * Text is drawn after the threshold so it retains its normal anti-aliasing
 * against the white background.
 */
export function buildBubbleCanvas(params: BubbleRenderParams): {
  canvas: HTMLCanvasElement;
  offX: number;
  offY: number;
} {
  const { bubble, bgW, bgH, lines, tip, base, flatTip, fontColor } = params;
  const textColor = fontColor ?? '#000000';

  // Size the offscreen canvas to contain both the rect and the tail tip.
  const minX = Math.floor(Math.min(0, tip.x));
  const minY = Math.floor(Math.min(0, tip.y));
  const maxX = Math.ceil(Math.max(bgW, tip.x + 1));
  const maxY = Math.ceil(Math.max(bgH, tip.y + 1));
  const cw = Math.max(1, maxX - minX);
  const ch = Math.max(1, maxY - minY);

  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(-minX, -minY);

  // Draw the bubble shape.
  // Translate by (0.5, 0.5) so the 1px stroke lands on whole pixel rows
  // instead of straddling two rows at ~50% coverage each. Without this,
  // the alpha-128 threshold below produces visibly asymmetric top vs bottom
  // corners (one side keeps the half-coverage pixel, the other drops it).
  ctx.save();
  ctx.translate(0.5, 0.5);
  drawBubblePath(ctx, bgW - 1, bgH - 1, BUBBLE_RADIUS, tip.x - 0.5, tip.y - 0.5, base, !!flatTip);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Threshold the alpha channel to {0, 255} so rounded corners and diagonal
  // tail edges stay crisp when upscaled with nearest-neighbor.
  const shapeImg = ctx.getImageData(0, 0, c.width, c.height);
  const sd = shapeImg.data;
  for (let i = 0; i < sd.length; i += 4) {
    if (sd[i + 3] >= 128) {
      sd[i] = 255; sd[i + 1] = 255; sd[i + 2] = 255; sd[i + 3] = 255;
    } else {
      sd[i + 3] = 0;
    }
  }
  ctx.putImageData(shapeImg, 0, 0);

  // Draw text on top (after threshold so it keeps normal anti-aliasing).
  const lineHeight = bubble.fontSize;
  ctx.fillStyle = textColor;
  ctx.font = `${bubble.fontSize}px "${BUBBLE_FONT}"`;
  ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], BUBBLE_PAD, BUBBLE_PAD + i * lineHeight);
  }

  // Threshold the text pixels too so sub-pixel anti-aliasing (which shows
  // up as a faint halo / ghosting around glyphs) is collapsed away.
  // We're conservative here: only pixels that are clearly part of a glyph
  // (significantly different from the white bubble background) become solid
  // textColor; mid-tone AA pixels are pushed to pure white so they vanish
  // into the bubble background. This avoids fattening the glyphs.
  const tc = parseHexColor(textColor);
  const textImg = ctx.getImageData(0, 0, c.width, c.height);
  const td = textImg.data;
  for (let i = 0; i < td.length; i += 4) {
    if (td[i + 3] === 0) continue;
    const r = td[i], g = td[i + 1], b = td[i + 2];
    // Distance from pure white. Glyph centers are close to textColor so
    // their channels are far from 255; AA halo pixels are close to 255.
    const dist = (255 - r) + (255 - g) + (255 - b);
    if (dist > 360) {
      td[i] = tc.r; td[i + 1] = tc.g; td[i + 2] = tc.b; td[i + 3] = 255;
    } else {
      td[i] = 255; td[i + 1] = 255; td[i + 2] = 255; td[i + 3] = 255;
    }
  }
  ctx.putImageData(textImg, 0, 0);

  return { canvas: c, offX: minX, offY: minY };
}
