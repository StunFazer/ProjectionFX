import { LinAlg } from './LinAlg.js';

/**
 * ProjectorCalibration.js - Direct Linear Transform (DLT) 6-point PnP solver.
 * Maps 3D world coordinates (X, Y, Z) to 2D projector screen pixels (u, v).
 * Decomposes P = K * [R | t] via RQ decomposition to synthesize an off-axis Three.js perspective camera.
 */
export class ProjectorCalibration {
  /**
   * Calibrate projector from N >= 6 3D-2D correspondence pairs.
   * @param {Array<{world: [number, number, number], screen: [number, number]}>} correspondences
   * @param {number} screenWidth
   * @param {number} screenHeight
   * @returns {{ P: Float64Array, K: Float64Array, R: Float64Array, t: Float64Array, rmsError: number, cameraPosition: [number, number, number] }}
   */
  static solve(correspondences, screenWidth, screenHeight) {
    const N = correspondences.length;
    if (N < 6) {
      throw new Error(`At least 6 correspondences required (got ${N})`);
    }

    // 1. Data Normalization (Hartley's isotropic scaling)
    // 3D centroid and average distance sqrt(3)
    let meanX = 0, meanY = 0, meanZ = 0;
    let meanU = 0, meanV = 0;
    for (const c of correspondences) {
      meanX += c.world[0]; meanY += c.world[1]; meanZ += c.world[2];
      meanU += c.screen[0]; meanV += c.screen[1];
    }
    meanX /= N; meanY /= N; meanZ /= N;
    meanU /= N; meanV /= N;

    let dist3D = 0;
    let dist2D = 0;
    for (const c of correspondences) {
      const dx = c.world[0] - meanX;
      const dy = c.world[1] - meanY;
      const dz = c.world[2] - meanZ;
      dist3D += Math.hypot(dx, dy, dz);

      const du = c.screen[0] - meanU;
      const dv = c.screen[1] - meanV;
      dist2D += Math.hypot(du, dv);
    }
    const scale3D = (Math.sqrt(3.0) * N) / (dist3D || 1.0);
    const scale2D = (Math.sqrt(2.0) * N) / (dist2D || 1.0);

    // 2. Build 2N x 12 linear system A * p = 0
    const A = new Float64Array(2 * N * 12);
    for (let i = 0; i < N; i++) {
      const X = (correspondences[i].world[0] - meanX) * scale3D;
      const Y = (correspondences[i].world[1] - meanY) * scale3D;
      const Z = (correspondences[i].world[2] - meanZ) * scale3D;
      const W = 1.0;

      const u = (correspondences[i].screen[0] - meanU) * scale2D;
      const v = (correspondences[i].screen[1] - meanV) * scale2D;

      const row1 = (2 * i) * 12;
      const row2 = (2 * i + 1) * 12;

      // Row 1: [0, 0, 0, 0, -X, -Y, -Z, -W, v*X, v*Y, v*Z, v*W]
      A[row1 + 4] = -X; A[row1 + 5] = -Y; A[row1 + 6] = -Z; A[row1 + 7] = -W;
      A[row1 + 8] = v * X; A[row1 + 9] = v * Y; A[row1 + 10] = v * Z; A[row1 + 11] = v * W;

      // Row 2: [X, Y, Z, W, 0, 0, 0, 0, -u*X, -u*Y, -u*Z, -u*W]
      A[row2 + 0] = X; A[row2 + 1] = Y; A[row2 + 2] = Z; A[row2 + 3] = W;
      A[row2 + 8] = -u * X; A[row2 + 9] = -u * Y; A[row2 + 10] = -u * Z; A[row2 + 11] = -u * W;
    }

    // 3. SVD Null space of A -> normalized P_norm
    const pNorm = LinAlg.solveNullSpace(A, 2 * N, 12);
    const P_norm = new Float64Array(12);
    for (let i = 0; i < 12; i++) P_norm[i] = pNorm[i];

    // 4. Denormalize: P = T2^-1 * P_norm * T3
    // T2 = [scale2D, 0, -scale2D*meanU; 0, scale2D, -scale2D*meanV; 0, 0, 1]
    // T2^-1 = [1/scale2D, 0, meanU; 0, 1/scale2D, meanV; 0, 0, 1]
    const invScale2D = 1.0 / scale2D;
    const invScale3D = 1.0 / scale3D;

    // Denormalized P (3x4)
    const P = new Float64Array(12);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        // Col 0..2
        P[r * 4 + c] = P_norm[r * 4 + c] * scale3D;
      }
      // Col 3
      P[r * 4 + 3] = P_norm[r * 4 + 3] -
        (P_norm[r * 4 + 0] * meanX + P_norm[r * 4 + 1] * meanY + P_norm[r * 4 + 2] * meanZ) * scale3D;
    }

    // Multiply by T2^-1 on the left
    const P_final = new Float64Array(12);
    for (let c = 0; c < 4; c++) {
      P_final[0 * 4 + c] = invScale2D * P[0 * 4 + c] + meanU * P[2 * 4 + c];
      P_final[1 * 4 + c] = invScale2D * P[1 * 4 + c] + meanV * P[2 * 4 + c];
      P_final[2 * 4 + c] = P[2 * 4 + c];
    }

    // Ensure points lie in front of the camera (depth > 0)
    let depthSum = 0;
    for (const c of correspondences) {
      depthSum += P_final[8] * c.world[0] + P_final[9] * c.world[1] + P_final[10] * c.world[2] + P_final[11];
    }
    if (depthSum < 0) {
      for (let i = 0; i < 12; i++) P_final[i] = -P_final[i];
    }

    // 5. RQ Decomposition to extract K and R: P[0..2, 0..2] = M = K * R
    const M = new Float64Array([
      P_final[0], P_final[1], P_final[2],
      P_final[4], P_final[5], P_final[6],
      P_final[8], P_final[9], P_final[10]
    ]);
    const { K, R } = LinAlg.rqDecomp3x3(M);

    // Translation: t = K^-1 * P[:, 3]
    const invK = LinAlg.invert3x3(K);
    const p3 = new Float64Array([P_final[3], P_final[7], P_final[11]]);
    const t = new Float64Array(3);
    for (let i = 0; i < 3; i++) {
      t[i] = invK[i * 3 + 0] * p3[0] + invK[i * 3 + 1] * p3[1] + invK[i * 3 + 2] * p3[2];
    }

    // Projector camera center in world coordinates: C = -R^T * t
    const Rt = LinAlg.transpose(R, 3, 3);
    const cameraPosition = [
      -(Rt[0] * t[0] + Rt[1] * t[1] + Rt[2] * t[2]),
      -(Rt[3] * t[0] + Rt[4] * t[1] + Rt[5] * t[2]),
      -(Rt[6] * t[0] + Rt[7] * t[1] + Rt[8] * t[2])
    ];

    // 6. Compute Reprojection RMS Error
    let sumSqErr = 0;
    for (const c of correspondences) {
      const X = c.world[0], Y = c.world[1], Z = c.world[2];
      const u_proj_h = P_final[0] * X + P_final[1] * Y + P_final[2] * Z + P_final[3];
      const v_proj_h = P_final[4] * X + P_final[5] * Y + P_final[6] * Z + P_final[7];
      const w_proj_h = P_final[8] * X + P_final[9] * Y + P_final[10] * Z + P_final[11];

      const u_est = u_proj_h / w_proj_h;
      const v_est = v_proj_h / w_proj_h;

      const du = u_est - c.screen[0];
      const dv = v_est - c.screen[1];
      sumSqErr += du * du + dv * dv;
    }
    const rmsError = Math.sqrt(sumSqErr / N);

    return {
      P: P_final,
      K,
      R,
      t,
      rmsError,
      cameraPosition,
      fx: K[0],
      fy: K[4],
      cx: K[2],
      cy: K[5]
    };
  }

  /**
   * Synthesize an off-axis Three.js projection matrix from calibrated K.
   * Projectors are almost always mounted off-axis (e.g. 100% offset vertically).
   * @param {number} fx
   * @param {number} fy
   * @param {number} cx
   * @param {number} cy
   * @param {number} width
   * @param {number} height
   * @param {number} near
   * @param {number} far
   * @returns {Float32Array} 4x4 column-major matrix matching Three.js Matrix4.elements
   */
  static createOffAxisThreeMatrix(fx, fy, cx, cy, width, height, near = 0.1, far = 100.0) {
    const left = -(cx) * near / fx;
    const right = (width - cx) * near / fx;
    const bottom = -(height - cy) * near / fy;
    const top = (cy) * near / fy;

    const x = (2 * near) / (right - left);
    const y = (2 * near) / (top - bottom);
    const a = (right + left) / (right - left);
    const b = (top + bottom) / (top - bottom);
    const c = -(far + near) / (far - near);
    const d = -(2 * far * near) / (far - near);

    // Three.js uses Column-Major format:
    // [ x,  0,  a,  0 ]
    // [ 0,  y,  b,  0 ]
    // [ 0,  0,  c,  d ]
    // [ 0,  0, -1,  0 ]
    const te = new Float32Array(16);
    te[0] = x;  te[4] = 0;  te[8] = a;   te[12] = 0;
    te[1] = 0;  te[5] = y;  te[9] = b;   te[13] = 0;
    te[2] = 0;  te[6] = 0;  te[10] = c;  te[14] = d;
    te[3] = 0;  te[7] = 0;  te[11] = -1; te[15] = 0;

    return te;
  }
}
