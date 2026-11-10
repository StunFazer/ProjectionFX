// Planar homography (camera image <-> projector image, corner pin warp).
using System;
using System.Collections.Generic;

namespace ProjectionFX.Math
{
    [Serializable]
    public sealed class Homography2D
    {
        /// <summary>Row-major 3x3 matrix.</summary>
        public double[] H = { 1, 0, 0, 0, 1, 0, 0, 0, 1 };

        public static Homography2D Identity => new Homography2D();

        public (double x, double y) Apply(double x, double y)
        {
            double w = H[6] * x + H[7] * y + H[8];
            if (System.Math.Abs(w) < 1e-12) w = 1e-12;
            return ((H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w);
        }

        public Homography2D Inverse()
        {
            var inv = LinAlg.Inverse3(ToMatrix());
            return FromMatrix(inv);
        }

        public double[,] ToMatrix() => new double[,] { { H[0], H[1], H[2] }, { H[3], H[4], H[5] }, { H[6], H[7], H[8] } };

        public static Homography2D FromMatrix(double[,] m)
        {
            var h = new Homography2D();
            double s = System.Math.Abs(m[2, 2]) > 1e-12 ? 1.0 / m[2, 2] : 1.0;
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++) h.H[i * 3 + j] = m[i, j] * s;
            return h;
        }

        /// <summary>Normalised DLT from 4+ correspondences src[i] -> dst[i].</summary>
        public static Homography2D Compute(IList<(double x, double y)> src, IList<(double x, double y)> dst)
        {
            if (src.Count != dst.Count || src.Count < 4) throw new ArgumentException("Need at least 4 point pairs");
            int n = src.Count;
            var ts = Normalization(src);
            var td = Normalization(dst);

            var a = new double[2 * n, 9];
            for (int i = 0; i < n; i++)
            {
                var (x, y) = Transform(ts, src[i]);
                var (u, v) = Transform(td, dst[i]);
                int r = 2 * i;
                a[r, 0] = -x; a[r, 1] = -y; a[r, 2] = -1;
                a[r, 6] = u * x; a[r, 7] = u * y; a[r, 8] = u;
                a[r + 1, 3] = -x; a[r + 1, 4] = -y; a[r + 1, 5] = -1;
                a[r + 1, 6] = v * x; a[r + 1, 7] = v * y; a[r + 1, 8] = v;
            }

            var h = LinAlg.NullVector(a);
            var hn = new double[,] { { h[0], h[1], h[2] }, { h[3], h[4], h[5] }, { h[6], h[7], h[8] } };
            var full = LinAlg.Mul(LinAlg.Mul(LinAlg.Inverse3(td), hn), ts);
            return FromMatrix(full);
        }

        internal static double[,] Normalization(IList<(double x, double y)> pts)
        {
            double cx = 0, cy = 0;
            foreach (var p in pts) { cx += p.x; cy += p.y; }
            cx /= pts.Count; cy /= pts.Count;
            double d = 0;
            foreach (var p in pts) d += System.Math.Sqrt((p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy));
            d /= pts.Count;
            double s = d > 1e-12 ? System.Math.Sqrt(2) / d : 1;
            return new double[,] { { s, 0, -s * cx }, { 0, s, -s * cy }, { 0, 0, 1 } };
        }

        static (double, double) Transform(double[,] t, (double x, double y) p) =>
            (t[0, 0] * p.x + t[0, 1] * p.y + t[0, 2], t[1, 0] * p.x + t[1, 1] * p.y + t[1, 2]);
    }
}
