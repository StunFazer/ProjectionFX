import { Homography2D } from '../math/Homography2D.js';

/**
 * KeystoneWarp.js - 4-Corner Projector Keystone Pinning.
 * Corrects geometric projector keystoning and non-perpendicular throws using 2D planar homography.
 */
export class KeystoneWarp {
  constructor(width = 1920, height = 1080) {
    this.width = width;
    this.height = height;

    // Default 4 corners [x, y]
    this.corners = [
      [0, 0],              // 0: Top-Left
      [width, 0],          // 1: Top-Right
      [width, height],     // 2: Bottom-Right
      [0, height]          // 3: Bottom-Left
    ];

    this.homography = null;
    this.loadFromStorage();
    this.recompute();
  }

  setCorner(index, x, y) {
    if (index >= 0 && index < 4) {
      this.corners[index] = [x, y];
      this.recompute();
      this.saveToStorage();
    }
  }

  reset() {
    this.corners = [
      [0, 0],
      [this.width, 0],
      [this.width, this.height],
      [0, this.height]
    ];
    this.recompute();
    this.saveToStorage();
  }

  recompute() {
    const src = [
      [0, 0],
      [this.width, 0],
      [this.width, this.height],
      [0, this.height]
    ];
    this.homography = Homography2D.findHomography(src, this.corners);
  }

  /**
   * Convert 3x3 homography H to CSS 4x4 matrix3d string for zero-cost hardware GPU quad warping.
   */
  getCssMatrix3D() {
    if (!this.homography) this.recompute();
    const H = this.homography;
    // CSS matrix3d(a1, b1, 0, d1,  a2, b2, 0, d2,  0, 0, 1, 0,  a3, b3, 0, d3)
    return `matrix3d(
      ${H[0]}, ${H[3]}, 0, ${H[6]},
      ${H[1]}, ${H[4]}, 0, ${H[7]},
      0, 0, 1, 0,
      ${H[2]}, ${H[5]}, 0, ${H[8]}
    )`;
  }

  saveToStorage() {
    try {
      localStorage.setItem('projectionfx_keystone', JSON.stringify(this.corners));
    } catch (e) {
      // ignore
    }
  }

  loadFromStorage() {
    try {
      const saved = localStorage.getItem('projectionfx_keystone');
      if (saved) {
        const data = JSON.parse(saved);
        if (Array.isArray(data) && data.length === 4) {
          this.corners = data;
        }
      }
    } catch (e) {
      // ignore
    }
  }
}
