// Projector (or camera) calibration from 3D<->2D point correspondences.
// Normalised DLT -> P (3x4) -> K[R|t] decomposition, plus conversion to a Unity camera pose + projection matrix.
//
// Conventions
//   World points: Unity world coordinates (left-handed, Y up).
//   Pixels:       origin top-left, +u right, +v down, continuous range [0,W]x[0,H].
//   Camera frame: OpenCV style  c = R*X + t,  u = (fx*cx_ + s*cy_)/cz + cx,  v = fy*cy_/cz + cy,  cz > 0 in front.
//   Because Unity's world is left-handed, R normally has det(R) = -1. That is expected.
using System;
using System.Collections.Generic;

namespace ProjectionFX.Math
{
    [Serializable]
    public sealed class CameraModel
    {
        public int Width, Height;
        public double Fx, Fy, Cx, Cy, Skew;
        public double[] R = new double[9]; // row-major
        public double[] T = new double[3];
        public double RmsError;            // reprojection error in pixels
        public double MaxError;

        public (double u, double v, double depth) Project(double x, double y, double z)
        {
            double cx = R[0] * x + R[1] * y + R[2] * z + T[0];
            double cy = R[3] * x + R[4] * y + R[5] * z + T[1];
            double cz = R[6] * x + R[7] * y + R[8] * z + T[2];
            double u = (Fx * cx + Skew * cy) / cz + Cx;
            double v = Fy * cy / cz + Cy;
            return (u, v, cz);
        }

        /// <summary>Camera centre in world space: C = -Rᵀ t.</summary>
        public (double x, double y, double z) Position => (
            -(R[0] * T[0] + R[3] * T[1] + R[6] * T[2]),
            -(R[1] * T[0] + R[4] * T[1] + R[7] * T[2]),
            -(R[2] * T[0] + R[5] * T[1] + R[8] * T[2]));

        /// <summary>Unity camera basis in world space (right, up, forward).</summary>
        public (double x, double y, double z) Right => (R[0], R[1], R[2]);
        public (double x, double y, double z) Up => (-R[3], -R[4], -R[5]);
        public (double x, double y, double z) Forward => (R[6], R[7], R[8]);

        /// <summary>
        /// True when the solved frame is mirrored relative to a Unity camera (e.g. rear projection / projector flip mode).
        /// Fix by enabling "Flip X" on the output compositor and recalibrating.
        /// </summary>
        public bool IsMirrored
        {
            get
            {
                var r = Right; var u = Up; var f = Forward;
                // Unity: right == Cross(up, forward)
                double cx = u.y * f.z - u.z * f.y, cy = u.z * f.x - u.x * f.z, cz = u.x * f.y - u.y * f.x;
                return cx * r.x + cy * r.y + cz * r.z < 0;
            }
        }

        /// <summary>
        /// OpenGL-style projection matrix (row-major, 16 values) as expected by Camera.projectionMatrix,
        /// reproducing the pinhole intrinsics including off-centre principal point and skew.
        /// </summary>
        public double[] UnityProjectionMatrix(double near, double far)
        {
            double w = Width, h = Height;
            return new[]
            {
                2 * Fx / w, -2 * Skew / w, 1 - 2 * Cx / w, 0,
                0, 2 * Fy / h, 2 * Cy / h - 1, 0,
                0, 0, -(far + near) / (far - near), -2 * far * near / (far - near),
                0, 0, -1, 0,
            };
        }

        public double VerticalFovDegrees => 2 * System.Math.Atan(Height / (2 * Fy)) * 180 / System.Math.PI;
    }

    public static class ProjectorCalibration
    {
        public const int MinPoints = 6;

        /// <summary>
        /// Calibrates a pinhole projector/camera from at least 6 non-coplanar correspondences.
        /// 8-12 well spread points (covering depth) give noticeably better results.
        /// </summary>
        public static CameraModel Calibrate(IList<(double x, double y, double z)> world, IList<(double u, double v)> pixels, int width, int height)
        {
            if (world.Count != pixels.Count) throw new ArgumentException("world/pixel count mismatch");
            int n = world.Count;
            if (n < MinPoints) throw new ArgumentException($"Need at least {MinPoints} points, got {n}");
            if (IsNearlyCoplanar(world)) throw new InvalidOperationException("Calibration points are (nearly) coplanar. Pick points at different depths.");

            var t2 = Homography2D.Normalization(pixels);
            var t3 = Normalization3(world);

            var a = new double[2 * n, 12];
            for (int i = 0; i < n; i++)
            {
                var p = world[i];
                double X = t3[0, 0] * p.x + t3[0, 3], Y = t3[1, 1] * p.y + t3[1, 3], Z = t3[2, 2] * p.z + t3[2, 3];
                double u = t2[0, 0] * pixels[i].u + t2[0, 2], v = t2[1, 1] * pixels[i].v + t2[1, 2];
                int r = 2 * i;
                a[r, 0] = X; a[r, 1] = Y; a[r, 2] = Z; a[r, 3] = 1;
                a[r, 8] = -u * X; a[r, 9] = -u * Y; a[r, 10] = -u * Z; a[r, 11] = -u;
                a[r + 1, 4] = X; a[r + 1, 5] = Y; a[r + 1, 6] = Z; a[r + 1, 7] = 1;
                a[r + 1, 8] = -v * X; a[r + 1, 9] = -v * Y; a[r + 1, 10] = -v * Z; a[r + 1, 11] = -v;
            }

            var pv = LinAlg.NullVector(a);
            var pn = new double[3, 4];
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 4; j++) pn[i, j] = pv[i * 4 + j];

            // Denormalise: P = T2^-1 * Pn * T3
            var P = LinAlg.Mul(LinAlg.Mul(LinAlg.Inverse3(t2), pn), t3);

            // Make points lie in front of the camera.
            double depthSum = 0;
            foreach (var p in world) depthSum += P[2, 0] * p.x + P[2, 1] * p.y + P[2, 2] * p.z + P[2, 3];
            if (depthSum < 0)
                for (int i = 0; i < 3; i++)
                    for (int j = 0; j < 4; j++) P[i, j] = -P[i, j];

            var M = new double[3, 3];
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++) M[i, j] = P[i, j];

            LinAlg.RQ3(M, out var K, out var R);
            var kInv = LinAlg.Inverse3(K);
            var t = new double[3];
            for (int i = 0; i < 3; i++) t[i] = kInv[i, 0] * P[0, 3] + kInv[i, 1] * P[1, 3] + kInv[i, 2] * P[2, 3];

            double k33 = K[2, 2];
            var model = new CameraModel
            {
                Width = width,
                Height = height,
                Fx = K[0, 0] / k33,
                Fy = K[1, 1] / k33,
                Cx = K[0, 2] / k33,
                Cy = K[1, 2] / k33,
                Skew = K[0, 1] / k33,
            };
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++) model.R[i * 3 + j] = R[i, j];
            model.T = t;

            double sq = 0, max = 0;
            for (int i = 0; i < n; i++)
            {
                var (u, v, _) = model.Project(world[i].x, world[i].y, world[i].z);
                double e2 = (u - pixels[i].u) * (u - pixels[i].u) + (v - pixels[i].v) * (v - pixels[i].v);
                sq += e2;
                max = System.Math.Max(max, System.Math.Sqrt(e2));
            }
            model.RmsError = System.Math.Sqrt(sq / n);
            model.MaxError = max;
            return model;
        }

        static double[,] Normalization3(IList<(double x, double y, double z)> pts)
        {
            double cx = 0, cy = 0, cz = 0;
            foreach (var p in pts) { cx += p.x; cy += p.y; cz += p.z; }
            cx /= pts.Count; cy /= pts.Count; cz /= pts.Count;
            double d = 0;
            foreach (var p in pts) d += System.Math.Sqrt((p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy) + (p.z - cz) * (p.z - cz));
            d /= pts.Count;
            double s = d > 1e-12 ? System.Math.Sqrt(3) / d : 1;
            return new double[,] { { s, 0, 0, -s * cx }, { 0, s, 0, -s * cy }, { 0, 0, s, -s * cz }, { 0, 0, 0, 1 } };
        }

        public static bool IsNearlyCoplanar(IList<(double x, double y, double z)> pts, double ratio = 1e-4)
        {
            double cx = 0, cy = 0, cz = 0;
            foreach (var p in pts) { cx += p.x; cy += p.y; cz += p.z; }
            cx /= pts.Count; cy /= pts.Count; cz /= pts.Count;
            var cov = new double[3, 3];
            foreach (var p in pts)
            {
                double[] d = { p.x - cx, p.y - cy, p.z - cz };
                for (int i = 0; i < 3; i++)
                    for (int j = 0; j < 3; j++) cov[i, j] += d[i] * d[j];
            }
            LinAlg.JacobiEigen(cov, out var ev, out _);
            Array.Sort(ev);
            return ev[2] <= 0 || ev[0] / ev[2] < ratio;
        }
    }
}
