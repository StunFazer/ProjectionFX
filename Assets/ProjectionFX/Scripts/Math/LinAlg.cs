// Pure C# linear algebra helpers (no UnityEngine dependency so they can be unit tested with plain .NET).
using System;

namespace ProjectionFX.Math
{
    public static class LinAlg
    {
        public static double[,] Identity(int n)
        {
            var m = new double[n, n];
            for (int i = 0; i < n; i++) m[i, i] = 1;
            return m;
        }

        public static double[,] Mul(double[,] a, double[,] b)
        {
            int n = a.GetLength(0), k = a.GetLength(1), m = b.GetLength(1);
            if (b.GetLength(0) != k) throw new ArgumentException("Matrix size mismatch");
            var r = new double[n, m];
            for (int i = 0; i < n; i++)
                for (int j = 0; j < m; j++)
                {
                    double s = 0;
                    for (int x = 0; x < k; x++) s += a[i, x] * b[x, j];
                    r[i, j] = s;
                }
            return r;
        }

        /// <summary>Returns AᵀA for a (rows x cols) matrix.</summary>
        public static double[,] AtA(double[,] a)
        {
            int rows = a.GetLength(0), cols = a.GetLength(1);
            var r = new double[cols, cols];
            for (int i = 0; i < cols; i++)
                for (int j = i; j < cols; j++)
                {
                    double s = 0;
                    for (int x = 0; x < rows; x++) s += a[x, i] * a[x, j];
                    r[i, j] = s;
                    r[j, i] = s;
                }
            return r;
        }

        /// <summary>Cyclic Jacobi eigen decomposition of a symmetric matrix. Eigenvectors are columns.</summary>
        public static void JacobiEigen(double[,] symmetric, out double[] values, out double[,] vectors, int maxSweeps = 100)
        {
            int n = symmetric.GetLength(0);
            var m = (double[,])symmetric.Clone();
            var v = Identity(n);

            double norm = 0;
            for (int i = 0; i < n; i++)
                for (int j = 0; j < n; j++) norm += m[i, j] * m[i, j];
            double eps = 1e-30 * System.Math.Max(norm, 1e-300);

            for (int sweep = 0; sweep < maxSweeps; sweep++)
            {
                double off = 0;
                for (int p = 0; p < n; p++)
                    for (int q = p + 1; q < n; q++) off += m[p, q] * m[p, q];
                if (off <= eps) break;

                for (int p = 0; p < n; p++)
                    for (int q = p + 1; q < n; q++)
                    {
                        double apq = m[p, q];
                        if (System.Math.Abs(apq) < 1e-300) continue;
                        double theta = (m[q, q] - m[p, p]) / (2 * apq);
                        double t = theta == 0 ? 1.0 : System.Math.Sign(theta) / (System.Math.Abs(theta) + System.Math.Sqrt(theta * theta + 1));
                        double c = 1 / System.Math.Sqrt(t * t + 1), s = t * c;

                        for (int k = 0; k < n; k++)
                        {
                            double mkp = m[k, p], mkq = m[k, q];
                            m[k, p] = c * mkp - s * mkq;
                            m[k, q] = s * mkp + c * mkq;
                        }
                        for (int k = 0; k < n; k++)
                        {
                            double mpk = m[p, k], mqk = m[q, k];
                            m[p, k] = c * mpk - s * mqk;
                            m[q, k] = s * mpk + c * mqk;
                        }
                        for (int k = 0; k < n; k++)
                        {
                            double vkp = v[k, p], vkq = v[k, q];
                            v[k, p] = c * vkp - s * vkq;
                            v[k, q] = s * vkp + c * vkq;
                        }
                    }
            }

            values = new double[n];
            for (int i = 0; i < n; i++) values[i] = m[i, i];
            vectors = v;
        }

        /// <summary>Unit vector x minimising |A x| (least-squares null space), via eigen decomposition of AᵀA.</summary>
        public static double[] NullVector(double[,] a)
        {
            JacobiEigen(AtA(a), out var values, out var vectors);
            int best = 0;
            for (int i = 1; i < values.Length; i++)
                if (values[i] < values[best]) best = i;
            var x = new double[values.Length];
            for (int i = 0; i < x.Length; i++) x[i] = vectors[i, best];
            return x;
        }

        public static double Det3(double[,] m) =>
            m[0, 0] * (m[1, 1] * m[2, 2] - m[1, 2] * m[2, 1]) -
            m[0, 1] * (m[1, 0] * m[2, 2] - m[1, 2] * m[2, 0]) +
            m[0, 2] * (m[1, 0] * m[2, 1] - m[1, 1] * m[2, 0]);

        public static double[,] Inverse3(double[,] m)
        {
            double det = Det3(m);
            if (System.Math.Abs(det) < 1e-300) throw new InvalidOperationException("Singular 3x3 matrix");
            double id = 1.0 / det;
            return new double[,]
            {
                { (m[1, 1] * m[2, 2] - m[1, 2] * m[2, 1]) * id, (m[0, 2] * m[2, 1] - m[0, 1] * m[2, 2]) * id, (m[0, 1] * m[1, 2] - m[0, 2] * m[1, 1]) * id },
                { (m[1, 2] * m[2, 0] - m[1, 0] * m[2, 2]) * id, (m[0, 0] * m[2, 2] - m[0, 2] * m[2, 0]) * id, (m[0, 2] * m[1, 0] - m[0, 0] * m[1, 2]) * id },
                { (m[1, 0] * m[2, 1] - m[1, 1] * m[2, 0]) * id, (m[0, 1] * m[2, 0] - m[0, 0] * m[2, 1]) * id, (m[0, 0] * m[1, 1] - m[0, 1] * m[1, 0]) * id },
            };
        }

        /// <summary>
        /// RQ decomposition M = K * R of a 3x3 matrix with K upper-triangular (positive diagonal) and R orthonormal.
        /// Implemented as Gram-Schmidt on rows starting from the bottom row.
        /// Note: R may have det = -1 (e.g. Unity's left-handed world vs a right-handed camera frame); that is intentional.
        /// </summary>
        public static void RQ3(double[,] m, out double[,] k, out double[,] r)
        {
            k = new double[3, 3];
            r = new double[3, 3];
            double[] Row(int i) => new[] { m[i, 0], m[i, 1], m[i, 2] };
            double Dot(double[] a, double[] b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
            double Len(double[] a) => System.Math.Sqrt(Dot(a, a));

            var m3 = Row(2);
            double k33 = Len(m3);
            var r3 = new[] { m3[0] / k33, m3[1] / k33, m3[2] / k33 };

            var m2 = Row(1);
            double k23 = Dot(m2, r3);
            var u2 = new[] { m2[0] - k23 * r3[0], m2[1] - k23 * r3[1], m2[2] - k23 * r3[2] };
            double k22 = Len(u2);
            var r2 = new[] { u2[0] / k22, u2[1] / k22, u2[2] / k22 };

            var m1 = Row(0);
            double k13 = Dot(m1, r3), k12 = Dot(m1, r2);
            var u1 = new[] { m1[0] - k12 * r2[0] - k13 * r3[0], m1[1] - k12 * r2[1] - k13 * r3[1], m1[2] - k12 * r2[2] - k13 * r3[2] };
            double k11 = Len(u1);
            var r1 = new[] { u1[0] / k11, u1[1] / k11, u1[2] / k11 };

            k[0, 0] = k11; k[0, 1] = k12; k[0, 2] = k13;
            k[1, 1] = k22; k[1, 2] = k23;
            k[2, 2] = k33;
            for (int j = 0; j < 3; j++) { r[0, j] = r1[j]; r[1, j] = r2[j]; r[2, j] = r3[j]; }
        }
    }
}
