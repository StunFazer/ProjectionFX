/**
 * OneEuroFilter.js - Adaptive low-pass filter for noisy landmark tracking.
 * Provides high precision at low speeds (anti-jitter) and minimal lag at high speeds.
 */
class LowPassFilter {
  constructor(alpha, initVal = 0) {
    this.alpha = alpha;
    this.s = initVal;
    this.hasInit = false;
  }

  filter(val, alpha) {
    if (!this.hasInit) {
      this.s = val;
      this.hasInit = true;
      return val;
    }
    this.s = alpha * val + (1.0 - alpha) * this.s;
    return this.s;
  }
}

export class OneEuroFilter {
  /**
   * @param {number} minCutoff Minimum cutoff frequency (Hz). Lower = smoother at rest. Default 1.0.
   * @param {number} beta Speed coefficient. Higher = less lag during rapid movement. Default 0.007.
   * @param {number} dCutoff Cutoff frequency for derivative. Default 1.0.
   */
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPassFilter(this.alpha(minCutoff, 1.0 / 60));
    this.dxFilter = new LowPassFilter(this.alpha(dCutoff, 1.0 / 60));
    this.lastTime = -1;
  }

  alpha(cutoff, dt) {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(val, timestampSec) {
    if (this.lastTime < 0) {
      this.lastTime = timestampSec;
      return this.xFilter.filter(val, 1.0);
    }

    const dt = Math.max(1e-4, timestampSec - this.lastTime);
    this.lastTime = timestampSec;

    // Estimate derivative
    const prevX = this.xFilter.s;
    const dx = (val - prevX) / dt;
    const edx = this.dxFilter.filter(dx, this.alpha(this.dCutoff, dt));

    // Dynamic cutoff
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filter(val, this.alpha(cutoff, dt));
  }
}

export class OneEuroFilter3D {
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.x = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.y = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.z = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  filter(pt, timestampSec) {
    return [
      this.x.filter(pt[0], timestampSec),
      this.y.filter(pt[1], timestampSec),
      this.z.filter(pt[2], timestampSec)
    ];
  }
}
