import { LinAlg } from './LinAlg.js';

/**
 * Homography2D.js - 2D Planar projective transform (8-DOF) for 4-corner keystone pinning.
 * Warps quad source coordinates (e.g. [0,0], [1,0], [1,1], [0,1]) to destination projector corner pins.
 */
export class Homography2D {
  /**
   * Find 3x3 homography H such that dst ~ H * src
   * @param {Array<[number, number]>} srcPts 4 source points [x, y]
   * @param {Array<[number, number]>} dstPts 4 destination points [u, v]
   * @returns {Float64Array} 3x3 row-major homography matrix
   */
  static findHomography(srcPts, dstPts) {
    if (srcPts.length !== 4 || dstPts.length !== 4) {
      throw new Error('4 source and 4 destination points required');
    }

    // A is 8x9
    const A = new Float64Array(8 * 9);
    for (let i = 0; i < 4; i++) {
      const x = srcPts[i][0];
      const y = srcPts[i][1];
      const u = dstPts[i][0];
      const v = dstPts[i][1];

      const r1 = (2 * i) * 9;
      const r2 = (2 * i + 1) * 9;

      // [-x, -y, -1, 0, 0, 0, u*x, u*y, u]
      A[r1 + 0] = -x;   A[r1 + 1] = -y;   A[r1 + 2] = -1;
      A[r1 + 3] = 0;    A[r1 + 4] = 0;    A[r1 + 5] = 0;
      A[r1 + 6] = u*x;  A[r1 + 7] = u*y;  A[r1 + 8] = u;

      // [0, 0, 0, -x, -y, -1, v*x, v*y, v]
      A[r2 + 0] = 0;    A[r2 + 1] = 0;    A[r2 + 2] = 0;
      A[r2 + 3] = -x;   A[r2 + 4] = -y;   A[r2 + 5] = -1;
      A[r2 + 6] = v*x;  A[r2 + 7] = v*y;  A[r2 + 8] = v;
    }

    const h = LinAlg.solveNullSpace(A, 8, 9);
    const H = new Float64Array(9);
    for (let i = 0; i < 9; i++) H[i] = h[i];

    // Normalize so H[8] == 1
    if (Math.abs(H[8]) > 1e-15) {
      const scale = 1.0 / H[8];
      for (let i = 0; i < 9; i++) H[i] *= scale;
    }
    return H;
  }

  /**
   * Apply 3x3 homography H to 2D point [x, y]
   * @param {Float64Array} H 3x3 matrix
   * @param {[number, number]} pt [x, y]
   * @returns {[number, number]} [u, v]
   */
  static transformPoint(H, pt) {
    const x = pt[0], y = pt[1];
    const u = H[0]*x + H[1]*y + H[2];
    const v = H[3]*x + H[4]*y + H[5];
    const w = H[6]*x + H[7]*y + H[8];
    return [u / w, v / w];
  }
}
