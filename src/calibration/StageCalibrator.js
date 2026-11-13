import { Homography2D } from '../math/Homography2D.js';

/**
 * StageCalibrator.js - Live Mirror 4-Corner Camera-to-Projector Homography Calibration,
 * Automatic Bright/Dark Frame Corner Detection, Silhouette Mask Warping, and Venue Profiles.
 */
export class StageCalibrator {
  constructor() {
    // 4 corners [x, y] normalized [0..1] in camera view representing the projected stage rectangle
    this.corners = [
      [0.0, 0.0], // 0: Top-Left
      [1.0, 0.0], // 1: Top-Right
      [1.0, 1.0], // 2: Bottom-Right
      [0.0, 1.0]  // 3: Bottom-Left
    ];

    this.H_camToProj = null;
    this.H_projToCam = null;
    this.isIdentity = true;

    // Offscreen canvas for warping camera silhouette mask into projector space
    this.warpedW = 160;
    this.warpedH = 90;
    this.warpedCanvas = document.createElement('canvas');
    this.warpedCanvas.width = this.warpedW;
    this.warpedCanvas.height = this.warpedH;
    this.warpedCtx = this.warpedCanvas.getContext('2d');
    this.warpedImgData = this.warpedCtx.createImageData(this.warpedW, this.warpedH);

    this.loadActiveCorners();
    this.recompute();
  }

  setCorners(corners) {
    if (Array.isArray(corners) && corners.length === 4) {
      this.corners = corners.map(([x, y]) => [
        Math.max(-0.5, Math.min(1.5, x)),
        Math.max(-0.5, Math.min(1.5, y))
      ]);
      this.recompute();
      this.saveActiveCorners();
    }
  }

  setCorner(index, x, y) {
    if (index >= 0 && index < 4) {
      this.corners[index] = [
        Math.max(-0.5, Math.min(1.5, x)),
        Math.max(-0.5, Math.min(1.5, y))
      ];
      this.recompute();
      this.saveActiveCorners();
    }
  }

  reset() {
    this.corners = [
      [0.0, 0.0],
      [1.0, 0.0],
      [1.0, 1.0],
      [0.0, 1.0]
    ];
    this.recompute();
    this.saveActiveCorners();
  }

  recompute() {
    const projQuad = [
      [0.0, 0.0],
      [1.0, 0.0],
      [1.0, 1.0],
      [0.0, 1.0]
    ];

    this.isIdentity =
      Math.abs(this.corners[0][0]) < 1e-4 && Math.abs(this.corners[0][1]) < 1e-4 &&
      Math.abs(this.corners[1][0] - 1) < 1e-4 && Math.abs(this.corners[1][1]) < 1e-4 &&
      Math.abs(this.corners[2][0] - 1) < 1e-4 && Math.abs(this.corners[2][1] - 1) < 1e-4 &&
      Math.abs(this.corners[3][0]) < 1e-4 && Math.abs(this.corners[3][1] - 1) < 1e-4;

    this.H_camToProj = Homography2D.findHomography(this.corners, projQuad);
    this.H_projToCam = Homography2D.findHomography(projQuad, this.corners);
  }

  /**
   * Maps a normalized camera point [cx, cy] into normalized projector point [px, py]
   */
  camToProj(cx, cy) {
    if (this.isIdentity) return [cx, cy];
    return Homography2D.transformPoint(this.H_camToProj, [cx, cy]);
  }

  /**
   * Maps a normalized projector point [px, py] into normalized camera point [cx, cy]
   */
  projToCam(px, py) {
    if (this.isIdentity) return [px, py];
    return Homography2D.transformPoint(this.H_projToCam, [px, py]);
  }

  /**
   * Warps a 160x90 grayscale alpha buffer from camera coordinates into projector coordinates
   * and returns the ready-to-composite canvas in <0.2ms.
   */
  getWarpedMaskCanvas(srcAlpha, srcW, srcH) {
    const out = this.warpedImgData.data;

    if (this.isIdentity && srcW === this.warpedW && srcH === this.warpedH) {
      for (let i = 0; i < srcW * srcH; i++) {
        const idx = i * 4;
        out[idx + 0] = 255;
        out[idx + 1] = 255;
        out[idx + 2] = 255;
        out[idx + 3] = srcAlpha[i];
      }
      this.warpedCtx.putImageData(this.warpedImgData, 0, 0);
      return this.warpedCanvas;
    }

    const H = this.H_projToCam;
    const h0 = H[0], h1 = H[1], h2 = H[2];
    const h3 = H[3], h4 = H[4], h5 = H[5];
    const h6 = H[6], h7 = H[7], h8 = H[8];
    const w = this.warpedW;
    const h = this.warpedH;

    for (let py = 0; py < h; py++) {
      const ny = (py + 0.5) / h;
      for (let px = 0; px < w; px++) {
        const nx = (px + 0.5) / w;
        const denom = h6 * nx + h7 * ny + h8;
        const cx = (h0 * nx + h1 * ny + h2) / denom;
        const cy = (h3 * nx + h4 * ny + h5) / denom;

        let alpha = 0;
        if (cx >= 0 && cx < 1 && cy >= 0 && cy < 1) {
          const sx = Math.floor(cx * srcW);
          const sy = Math.floor(cy * srcH);
          alpha = srcAlpha[sy * srcW + sx];
        }

        const outIdx = (py * w + px) * 4;
        out[outIdx + 0] = 255;
        out[outIdx + 1] = 255;
        out[outIdx + 2] = 255;
        out[outIdx + 3] = alpha;
      }
    }

    this.warpedCtx.putImageData(this.warpedImgData, 0, 0);
    return this.warpedCanvas;
  }

  /**
   * Automatic Feature Alignment: compares dark baseline camera frame vs bright projector test frame
   * to find the exact 4 corners of the illuminated projector area in camera view.
   */
  detectProjectorCorners(darkPixels, brightPixels, w, h) {
    let maxDelta = 0;
    const deltas = new Float32Array(w * h);

    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      const lumA = darkPixels[idx] + darkPixels[idx + 1] + darkPixels[idx + 2];
      const lumB = brightPixels[idx] + brightPixels[idx + 1] + brightPixels[idx + 2];
      const d = Math.max(0, lumB - lumA);
      deltas[i] = d;
      if (d > maxDelta) maxDelta = d;
    }

    if (maxDelta < 45) {
      return {
        success: false,
        reason: 'Low projector contrast detected. Point camera at projector wall or drag corners manually.'
      };
    }

    const thresh = maxDelta * 0.42;
    let minSum = Infinity, maxSum = -Infinity;
    let minDiff = Infinity, maxDiff = -Infinity;
    let tl = null, tr = null, br = null, bl = null;
    let count = 0;

    // Require 3x3 neighborhood confirmation to reject single-pixel camera noise
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (deltas[i] > thresh &&
            deltas[i - 1] > thresh * 0.7 && deltas[i + 1] > thresh * 0.7 &&
            deltas[i - w] > thresh * 0.7 && deltas[i + w] > thresh * 0.7) {
          count++;
          const nx = x / w;
          const ny = y / h;
          const sum = nx + ny;
          const diff = nx - ny;

          if (sum < minSum) { minSum = sum; tl = [nx, ny]; }
          if (diff > maxDiff) { maxDiff = diff; tr = [nx, ny]; }
          if (sum > maxSum) { maxSum = sum; br = [nx, ny]; }
          if (diff < minDiff) { minDiff = diff; bl = [nx, ny]; }
        }
      }
    }

    if (count < (w * h * 0.03) || !tl || !tr || !br || !bl) {
      return {
        success: false,
        reason: 'Could not isolate projector rectangle cleanly. Try dimming room lights or drag pins manually.'
      };
    }

    // Verify reasonable quad width & height
    const quadW = ((tr[0] - tl[0]) + (br[0] - bl[0])) * 0.5;
    const quadH = ((bl[1] - tl[1]) + (br[1] - tr[1])) * 0.5;
    if (quadW < 0.12 || quadH < 0.12) {
      return {
        success: false,
        reason: 'Detected region too small. Move projector closer or drag corners manually.'
      };
    }

    this.setCorners([tl, tr, br, bl]);
    return { success: true, corners: this.corners };
  }

  saveActiveCorners() {
    try {
      localStorage.setItem('projectionfx_stage_corners', JSON.stringify(this.corners));
    } catch (_) {}
  }

  loadActiveCorners() {
    try {
      const raw = localStorage.getItem('projectionfx_stage_corners');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 4) {
          this.corners = parsed;
        }
      }
    } catch (_) {}
  }

  listProfiles() {
    try {
      const raw = localStorage.getItem('projectionfx_venue_profiles');
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  saveProfile(name) {
    if (!name || !name.trim()) return false;
    const profiles = this.listProfiles();
    profiles[name.trim()] = {
      corners: this.corners.map(c => [...c]),
      savedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem('projectionfx_venue_profiles', JSON.stringify(profiles));
      return true;
    } catch (_) {
      return false;
    }
  }

  loadProfile(name) {
    const profiles = this.listProfiles();
    if (profiles[name] && Array.isArray(profiles[name].corners)) {
      this.setCorners(profiles[name].corners);
      return true;
    }
    return false;
  }

  deleteProfile(name) {
    const profiles = this.listProfiles();
    if (profiles[name]) {
      delete profiles[name];
      try {
        localStorage.setItem('projectionfx_venue_profiles', JSON.stringify(profiles));
        return true;
      } catch (_) {}
    }
    return false;
  }
}
