/**
 * LinAlg.js - Robust numerical linear algebra primitives for projection mapping.
 * Implements SVD-equivalent least-squares null space (via Jacobi eigen-decomposition of A^T A),
 * 3x3 matrix inversion, and RQ decomposition.
 */

export class LinAlg {
  /** Multiply matrix A (m x k) and B (k x n) */
  static matMul(A, B, m, k, n) {
    const C = new Float64Array(m * n);
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0.0;
        for (let p = 0; p < k; p++) {
          sum += A[i * k + p] * B[p * n + j];
        }
        C[i * n + j] = sum;
      }
    }
    return C;
  }

  /** Transpose matrix A (m x n) to A^T (n x m) */
  static transpose(A, m, n) {
    const At = new Float64Array(n * m);
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        At[j * m + i] = A[i * n + j];
      }
    }
    return At;
  }

  /** Invert a 3x3 matrix in row-major layout */
  static invert3x3(M) {
    const m00 = M[0], m01 = M[1], m02 = M[2];
    const m10 = M[3], m11 = M[4], m12 = M[5];
    const m20 = M[6], m21 = M[7], m22 = M[8];

    const det = m00 * (m11 * m22 - m12 * m21) -
                m01 * (m10 * m22 - m12 * m20) +
                m02 * (m10 * m21 - m11 * m20);

    if (Math.abs(det) < 1e-15) {
      throw new Error(`Singular 3x3 matrix (det=${det})`);
    }

    const invDet = 1.0 / det;
    const inv = new Float64Array(9);
    inv[0] =  (m11 * m22 - m12 * m21) * invDet;
    inv[1] = -(m01 * m22 - m02 * m21) * invDet;
    inv[2] =  (m01 * m12 - m02 * m11) * invDet;
    inv[3] = -(m10 * m22 - m12 * m20) * invDet;
    inv[4] =  (m00 * m22 - m02 * m20) * invDet;
    inv[5] = -(m00 * m12 - m02 * m10) * invDet;
    inv[6] =  (m10 * m21 - m11 * m20) * invDet;
    inv[7] = -(m00 * m21 - m01 * m20) * invDet;
    inv[8] =  (m00 * m11 - m01 * m10) * invDet;
    return inv;
  }

  /**
   * Jacobi eigenvalue decomposition for a symmetric n x n matrix M.
   * Solves M * V = V * diag(W).
   * Used to find the SVD right singular vectors: null-space of A is the eigenvector of A^T A with smallest eigenvalue.
   */
  static jacobiSymmetric(M_in, n, maxIters = 100, eps = 1e-14) {
    const A = new Float64Array(M_in);
    const V = new Float64Array(n * n);
    for (let i = 0; i < n; i++) V[i * n + i] = 1.0;

    for (let iter = 0; iter < maxIters; iter++) {
      let maxOffDiag = 0.0;
      let p = 0, q = 1;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const val = Math.abs(A[i * n + j]);
          if (val > maxOffDiag) {
            maxOffDiag = val;
            p = i;
            q = j;
          }
        }
      }

      if (maxOffDiag < eps) break;

      const app = A[p * n + p];
      const aqq = A[q * n + q];
      const apq = A[p * n + q];

      const theta = 0.5 * (aqq - app) / apq;
      const t = Math.sign(theta) === 0 ? 1.0 / (Math.abs(theta) + Math.sqrt(theta * theta + 1.0))
        : (theta > 0 ? 1.0 / (theta + Math.sqrt(theta * theta + 1.0)) : -1.0 / (-theta + Math.sqrt(theta * theta + 1.0)));
      const c = 1.0 / Math.sqrt(t * t + 1.0);
      const s = t * c;

      // Update A
      A[p * n + p] = app - t * apq;
      A[q * n + q] = aqq + t * apq;
      A[p * n + q] = 0.0;
      A[q * n + p] = 0.0;

      for (let i = 0; i < n; i++) {
        if (i !== p && i !== q) {
          const aip = A[i * n + p];
          const aiq = A[i * n + q];
          A[i * n + p] = c * aip - s * aiq;
          A[p * n + i] = A[i * n + p];
          A[i * n + q] = s * aip + c * aiq;
          A[q * n + i] = A[i * n + q];
        }
      }

      // Update eigenvectors V
      for (let i = 0; i < n; i++) {
        const vip = V[i * n + p];
        const viq = V[i * n + q];
        V[i * n + p] = c * vip - s * viq;
        V[i * n + q] = s * vip + c * viq;
      }
    }

    const W = new Float64Array(n);
    for (let i = 0; i < n; i++) W[i] = A[i * n + i];
    return { W, V };
  }

  /**
   * Solves A * x = 0 (min ||Ax|| subject to ||x|| = 1) using Jacobi SVD on A^T * A.
   * A has m rows, n columns.
   * Returns x (vector of length n).
   */
  static solveNullSpace(A, m, n) {
    const At = this.transpose(A, m, n);
    const AtA = this.matMul(At, A, n, m, n);
    const { W, V } = this.jacobiSymmetric(AtA, n);

    let minIndex = 0;
    let minVal = W[0];
    for (let i = 1; i < n; i++) {
      if (W[i] < minVal) {
        minVal = W[i];
        minIndex = i;
      }
    }

    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = V[i * n + minIndex];
    }
    return x;
  }

  /**
   * RQ decomposition of 3x3 matrix M = K * R via Gram-Schmidt from bottom row.
   * K is upper-triangular (positive diagonal) and R is orthonormal.
   */
  static rqDecomp3x3(M) {
    const row = (i) => [M[i * 3 + 0], M[i * 3 + 1], M[i * 3 + 2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const len = (a) => Math.hypot(a[0], a[1], a[2]);

    const m3 = row(2);
    const k33 = len(m3);
    const r3 = [m3[0] / k33, m3[1] / k33, m3[2] / k33];

    const m2 = row(1);
    const k23 = dot(m2, r3);
    const u2 = [m2[0] - k23 * r3[0], m2[1] - k23 * r3[1], m2[2] - k23 * r3[2]];
    const k22 = len(u2);
    const r2 = [u2[0] / k22, u2[1] / k22, u2[2] / k22];

    const m1 = row(0);
    const k13 = dot(m1, r3);
    const k12 = dot(m1, r2);
    const u1 = [
      m1[0] - k12 * r2[0] - k13 * r3[0],
      m1[1] - k12 * r2[1] - k13 * r3[1],
      m1[2] - k12 * r2[2] - k13 * r3[2]
    ];
    const k11 = len(u1);
    const r1 = [u1[0] / k11, u1[1] / k11, u1[2] / k11];

    const K = new Float64Array([
      k11, k12, k13,
      0,   k22, k23,
      0,   0,   k33
    ]);

    const R = new Float64Array([
      r1[0], r1[1], r1[2],
      r2[0], r2[1], r2[2],
      r3[0], r3[1], r3[2]
    ]);

    return { K, R };
  }
}
