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
}

/** A character placed on a frame */
export interface FrameLayer {
  id: string;
  assetId: string;
  imageId: string;
  /** Position in canvas pixels */
  x: number;
  y: number;
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
 * The image is rendered at native resolution, anchored to the frame's top-left,
 * and clipped to the mask region.
 */
export interface FrameBackground {
  assetId: string;
  imageId: string;
  /**
   * Mask region of the frame that this background fills.
   * The image is clipped to this rect.
   * If null, the mask covers the entire frame.
   */
  mask: MaskRect | null;
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
}

export interface Project {
  id: string;
  name: string;
  /** Low-res canvas width shared by all frames */
  canvasWidth: number;
  /** Default background color for new frames */
  bgColor: string;
  frameIds: string[];
  assetIds: string[];
  createdAt: number;
  updatedAt: number;
}
