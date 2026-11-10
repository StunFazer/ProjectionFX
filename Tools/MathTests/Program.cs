using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using ProjectionFX.Math;

static class Program
{
    static int s_Failures;

    static void Check(bool ok, string name, string detail = "")
    {
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {name} {detail}");
        if (!ok) s_Failures++;
    }

    static int Main(string[] args)
    {
        TestHomography();
        TestCalibrationExact();
        TestCalibrationNoisy();
        TestCalibrationMirrored();
        TestCoplanarRejected();
        TestAnchors(args.Length > 0 ? args[0] : null);
        TestOneEuro();
        Console.WriteLine(s_Failures == 0 ? "\nALL TESTS PASSED" : $"\n{s_Failures} TEST(S) FAILED");
        return s_Failures == 0 ? 0 : 1;
    }

    static void TestHomography()
    {
        var truth = Homography2D.FromMatrix(new double[,] { { 1.2, 0.1, 30 }, { -0.05, 0.9, 12 }, { 0.0004, -0.0002, 1 } });
        var rnd = new Random(1);
        foreach (int n in new[] { 4, 12 })
        {
            var src = new List<(double, double)>();
            var dst = new List<(double, double)>();
            for (int i = 0; i < n; i++)
            {
                double x = rnd.NextDouble() * 1280, y = rnd.NextDouble() * 720;
                src.Add((x, y));
                dst.Add(truth.Apply(x, y));
            }
            var h = Homography2D.Compute(src, dst);
            double err = 0;
            for (int i = 0; i < 50; i++)
            {
                double x = rnd.NextDouble() * 1280, y = rnd.NextDouble() * 720;
                var a = h.Apply(x, y); var b = truth.Apply(x, y);
                err = Math.Max(err, Math.Abs(a.x - b.x) + Math.Abs(a.y - b.y));
            }
            Check(err < 1e-6, $"Homography recover n={n}", $"maxErr={err:E2}");
        }
        var inv = truth.Inverse();
        var p = truth.Apply(100, 200); var q = inv.Apply(p.x, p.y);
        Check(Math.Abs(q.x - 100) + Math.Abs(q.y - 200) < 1e-9, "Homography inverse round trip");
    }

    // Build a "ground truth" projector the way Unity would place a camera.
    static CameraModel TruthProjector()
    {
        var m = new CameraModel { Width = 1920, Height = 1080, Fx = 1650, Fy = 1650, Cx = 960, Cy = 1080 * 0.85, Skew = 0 };
        double[] C = { 0.3, 1.6, -2.5 };
        double[] target = { 0, 0.4, 0.2 };
        double[] f = Normalize(Sub(target, C));
        double[] upHint = { 0, 1, 0 };
        double[] right = Normalize(Cross(upHint, f));   // Unity: right = Cross(up, forward)
        double[] up = Cross(f, right);
        // OpenCV rows: right, -up, forward
        m.R = new[] { right[0], right[1], right[2], -up[0], -up[1], -up[2], f[0], f[1], f[2] };
        m.T = new[]
        {
            -(m.R[0] * C[0] + m.R[1] * C[1] + m.R[2] * C[2]),
            -(m.R[3] * C[0] + m.R[4] * C[1] + m.R[5] * C[2]),
            -(m.R[6] * C[0] + m.R[7] * C[1] + m.R[8] * C[2]),
        };
        return m;
    }

    static (List<(double, double, double)>, List<(double, double)>) Correspondences(CameraModel truth, int n, double noisePx, int seed)
    {
        var rnd = new Random(seed);
        var w = new List<(double, double, double)>();
        var p = new List<(double, double)>();
        for (int i = 0; i < n; i++)
        {
            double x = -0.5 + rnd.NextDouble(), y = rnd.NextDouble() * 0.8, z = -0.3 + rnd.NextDouble() * 0.6;
            var (u, v, _) = truth.Project(x, y, z);
            w.Add((x, y, z));
            p.Add((u + Gauss(rnd) * noisePx, v + Gauss(rnd) * noisePx));
        }
        return (w, p);
    }

    static void TestCalibrationExact()
    {
        var truth = TruthProjector();
        var (w, p) = Correspondences(truth, 8, 0, 3);
        var m = ProjectorCalibration.Calibrate(w, p, truth.Width, truth.Height);
        var cTrue = truth.Position; var c = m.Position;
        double posErr = Math.Sqrt(Sq(c.x - cTrue.x) + Sq(c.y - cTrue.y) + Sq(c.z - cTrue.z));
        Check(m.RmsError < 1e-6, "Calibration exact: reprojection", $"rms={m.RmsError:E2}px");
        Check(Math.Abs(m.Fx - truth.Fx) < 1e-4 && Math.Abs(m.Fy - truth.Fy) < 1e-4, "Calibration exact: focal", $"fx={m.Fx:F3} fy={m.Fy:F3}");
        Check(Math.Abs(m.Cx - truth.Cx) < 1e-4 && Math.Abs(m.Cy - truth.Cy) < 1e-4, "Calibration exact: principal point (lens shift)", $"cx={m.Cx:F3} cy={m.Cy:F3}");
        Check(posErr < 1e-6, "Calibration exact: position", $"err={posErr:E2}m");
        Check(!m.IsMirrored, "Calibration exact: not mirrored");
        CheckUnityPipeline(m, w, p, "exact");
    }

    static void TestCalibrationNoisy()
    {
        var truth = TruthProjector();
        var (w, p) = Correspondences(truth, 12, 0.5, 7);
        var m = ProjectorCalibration.Calibrate(w, p, truth.Width, truth.Height);
        var cTrue = truth.Position; var c = m.Position;
        double posErr = Math.Sqrt(Sq(c.x - cTrue.x) + Sq(c.y - cTrue.y) + Sq(c.z - cTrue.z));
        Check(m.RmsError < 1.0, "Calibration noisy(0.5px, 12pts): reprojection", $"rms={m.RmsError:F3}px max={m.MaxError:F3}px");
        Check(posErr < 0.05, "Calibration noisy: position within 5cm", $"err={posErr * 100:F2}cm fov={m.VerticalFovDegrees:F2}deg");
    }

    static void TestCalibrationMirrored()
    {
        var truth = TruthProjector();
        var (w, p) = Correspondences(truth, 8, 0, 11);
        for (int i = 0; i < p.Count; i++) p[i] = (truth.Width - p[i].Item1, p[i].Item2); // rear-projection flip
        var m = ProjectorCalibration.Calibrate(w, p, truth.Width, truth.Height);
        Check(m.IsMirrored, "Calibration detects mirrored (rear projection) setup");
    }

    static void TestCoplanarRejected()
    {
        var truth = TruthProjector();
        var w = new List<(double, double, double)>();
        var p = new List<(double, double)>();
        var rnd = new Random(5);
        for (int i = 0; i < 8; i++)
        {
            double x = rnd.NextDouble(), y = rnd.NextDouble();
            w.Add((x, y, 0.1));
            var (u, v, _) = truth.Project(x, y, 0.1);
            p.Add((u, v));
        }
        bool threw = false;
        try { ProjectorCalibration.Calibrate(w, p, 1920, 1080); } catch (InvalidOperationException) { threw = true; }
        Check(threw, "Calibration rejects coplanar points");
    }

    // Reproduce exactly what Unity does: worldToCamera = diag(1,1,-1) * inverse(TRS(pos, rot)), clip = P * V * X.
    static void CheckUnityPipeline(CameraModel m, List<(double, double, double)> w, List<(double, double)> p, string label)
    {
        var pos = m.Position; var r = m.Right; var u = m.Up; var f = m.Forward;
        // inverse(TRS) rows = right, up, forward ; translation = -dot(axis, pos)
        double[,] V =
        {
            { r.x, r.y, r.z, -(r.x * pos.x + r.y * pos.y + r.z * pos.z) },
            { u.x, u.y, u.z, -(u.x * pos.x + u.y * pos.y + u.z * pos.z) },
            { -f.x, -f.y, -f.z, (f.x * pos.x + f.y * pos.y + f.z * pos.z) },
            { 0, 0, 0, 1 },
        };
        var P = m.UnityProjectionMatrix(0.05, 50);
        double maxErr = 0;
        for (int i = 0; i < w.Count; i++)
        {
            double[] X = { w[i].Item1, w[i].Item2, w[i].Item3, 1 };
            var view = new double[4];
            for (int a = 0; a < 4; a++) for (int b = 0; b < 4; b++) view[a] += V[a, b] * X[b];
            var clip = new double[4];
            for (int a = 0; a < 4; a++) for (int b = 0; b < 4; b++) clip[a] += P[a * 4 + b] * view[b];
            double nx = clip[0] / clip[3], ny = clip[1] / clip[3], nz = clip[2] / clip[3];
            double px = (nx + 1) * 0.5 * m.Width, py = (1 - ny) * 0.5 * m.Height;
            maxErr = Math.Max(maxErr, Math.Abs(px - p[i].Item1) + Math.Abs(py - p[i].Item2));
            if (nz < -1 || nz > 1) maxErr = double.PositiveInfinity;
        }
        Check(maxErr < 1e-4, $"Unity camera pose + projection matrix reproduces pixels ({label})", $"maxErr={maxErr:E2}px");
        // The rotation built from (right, up, forward) must be a proper rotation for Unity's Quaternion.LookRotation
        double[] cr = Cross(new[] { u.x, u.y, u.z }, new[] { f.x, f.y, f.z });
        Check(Math.Abs(cr[0] - r.x) + Math.Abs(cr[1] - r.y) + Math.Abs(cr[2] - r.z) < 1e-6, "Unity basis is LookRotation compatible");
    }

    static void TestAnchors(string sampleRoot)
    {
        var hand = BlazeAnchors.Generate(192, BlazeAnchors.HandStrides);
        var pose = BlazeAnchors.Generate(224, BlazeAnchors.PoseStrides);
        Check(hand.Length / 2 == 2016, "Hand anchors count", $"{hand.Length / 2}");
        Check(pose.Length / 2 == 2254, "Pose anchors count", $"{pose.Length / 2}");
        if (sampleRoot == null) { Console.WriteLine("SKIP  anchor CSV comparison (pass path to inference-engine-samples/BlazeDetectionSample)"); return; }
        CompareCsv(Path.Combine(sampleRoot, "Hand/Assets/Data/anchors.csv"), hand, "Hand anchors match MediaPipe CSV");
        CompareCsv(Path.Combine(sampleRoot, "Pose/Assets/Data/anchors.csv"), pose, "Pose anchors match MediaPipe CSV");
    }

    static void CompareCsv(string path, float[] anchors, string name)
    {
        var lines = File.ReadAllLines(path);
        double maxErr = 0; int count = 0;
        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var v = line.Split(',');
            double x = double.Parse(v[0], CultureInfo.InvariantCulture), y = double.Parse(v[1], CultureInfo.InvariantCulture);
            maxErr = Math.Max(maxErr, Math.Abs(x - anchors[2 * count]) + Math.Abs(y - anchors[2 * count + 1]));
            count++;
        }
        Check(count == anchors.Length / 2 && maxErr < 1e-5, name, $"rows={count} maxErr={maxErr:E2}");
    }

    static void TestOneEuro()
    {
        var f = new OneEuroFilter();
        var p = OneEuroParams.Default;
        var rnd = new Random(2);
        double rawVar = 0, filtVar = 0;
        for (int i = 0; i < 600; i++)
        {
            float noise = (float)(Gauss(rnd) * 0.01);
            float y = f.Filter(0.5f + noise, 1f / 60f, p);
            if (i > 60) { rawVar += noise * noise; filtVar += (y - 0.5) * (y - 0.5); }
        }
        Check(filtVar < rawVar * 0.5, "OneEuro reduces jitter", $"ratio={filtVar / rawVar:F3}");
    }

    static double Sq(double x) => x * x;
    static double Gauss(Random r) => Math.Sqrt(-2 * Math.Log(1 - r.NextDouble())) * Math.Cos(2 * Math.PI * r.NextDouble());
    static double[] Sub(double[] a, double[] b) => new[] { a[0] - b[0], a[1] - b[1], a[2] - b[2] };
    static double[] Cross(double[] a, double[] b) => new[] { a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] };
    static double[] Normalize(double[] a) { double l = Math.Sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); return new[] { a[0] / l, a[1] / l, a[2] / l }; }
}
