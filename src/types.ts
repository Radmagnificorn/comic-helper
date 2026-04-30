export type AssetType = 'character' | 'background';

export interface AssetImage {
  id: string;
  name: string;
  blob: Blob;
}

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  images: AssetImage[];
  /**
   * One-off asset created via the canvas quick-add. Always lives in the
   * project's private asset list. When the layer that uses it is removed,
   * the asset (and its images) is deleted from the project too.
   */
  ephemeral?: boolean;
}

/** A character placed on a frame */
export interface FrameLayer {
  id: string;
  assetId: string;
  imageId: string;
  /** Position in canvas pixels */
  x: number;
  y: number;
  /** Horizontally mirror the image */
  flippedX?: boolean;
}

/** A rectangular region in canvas pixels (relative to the frame's top-left) */
export interface MaskRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The background image assigned to a frame.
 * The image is rendered at native resolution, positioned at (offsetX, offsetY)
 * relative to the frame's top-left, and clipped to the mask region.
 */
export interface FrameBackground {
  assetId: string;
  imageId: string;
  /** Pan offset in canvas pixels — shifts the image within the mask. */
  offsetX: number;
  offsetY: number;
  /**
   * Mask region of the frame that this background fills.
   * The image is clipped to this rect.
   * If null, the mask covers the entire frame.
   */
  mask: MaskRect | null;
}

/** A comic-style speech bubble: text on a white rounded rect. */
export interface SpeechBubble {
  id: string;
  /** Text content (newlines allowed) */
  text: string;
  /** Top-left position of the white background rect, in canvas pixels */
  x: number;
  y: number;
  /** Font size in canvas pixels */
  fontSize: number;
  /** Tail tip position in canvas pixels (frame-relative). The tail base is
   * inferred from the bubble edge nearest the tip. */
  tailX: number;
  tailY: number;
  /**
   * Tail base midpoint in canvas pixels (frame-relative). Lies on one of the
   * bubble's edges. Persisted so that the base can lag the tip while dragging,
   * allowing the tail to be angled. If omitted, callers should fall back to
   * the natural projection of the tip onto the closest edge.
   */
  tailBaseX?: number;
  tailBaseY?: number;
}

export interface Frame {
  id: string;
  label: string;
  /** Canvas width in pixels (low-res) — inherited from project */
  width: number;
  /** Frame height in pixels (low-res) — each frame can differ */
  height: number;
  /** Solid fill shown behind background image */
  bgColor: string;
  /** Optional background image + crop */
  background: FrameBackground | null;
  /** Character layers */
  layers: FrameLayer[];
  /** Speech bubbles, rendered on top of layers */
  bubbles?: SpeechBubble[];
}

export interface Project {
  id: string;
  name: string;
  /** Low-res canvas width shared by all frames */
  canvasWidth: number;
  /** Default background color for new frames */
  bgColor: string;
  frameIds: string[];
  /** Project-private asset ids (deleted when the project is deleted) */
  assetIds: string[];
  /** Shared asset libraries attached to this project. The library and its
   * assets are NOT owned by the project — detaching or deleting the project
   * leaves the library intact for other projects to use. */
  libraryIds?: string[];
  createdAt: number;
  updatedAt: number;
}

/** A named, top-level group of assets that can be attached to multiple projects. */
export interface AssetLibrary {
  id: string;
  name: string;
  assetIds: string[];
  createdAt: number;
  updatedAt: number;
}
