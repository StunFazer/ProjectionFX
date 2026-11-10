using System;
using UnityEngine;
using ProjectionFX.Math;
using ProjectionFX.Calibration;

namespace ProjectionFX.Display
{
    [ExecuteAlways]
    public class CornerPinWarpPass : MonoBehaviour
    {
        public Material WarpMaterial;
        public CalibrationWizard Wizard;

        // 4 Corners in normalized screen space:
        // Index 0: Top-Left (0, 1)
        // Index 1: Top-Right (1, 1)
        // Index 2: Bottom-Right (1, 0)
        // Index 3: Bottom-Left (0, 0)
        public Vector2[] Corners = new Vector2[4]
        {
            new Vector2(0, 1),
            new Vector2(1, 1),
            new Vector2(1, 0),
            new Vector2(0, 0)
        };

        static readonly (double x, double y)[] UnitSquare = new (double, double)[4]
        {
            (0, 1), (1, 1), (1, 0), (0, 0)
        };

        void Start()
        {
            if (Wizard == null) Wizard = CalibrationWizard.Instance;
            if (Wizard != null && Wizard.ActiveData != null && Wizard.ActiveData.KeystoneCorners.Length == 4)
            {
                Corners = Wizard.ActiveData.KeystoneCorners;
            }
        }

        void Update()
        {
            UpdateWarpMatrix();
        }

        public void UpdateWarpMatrix()
        {
            if (WarpMaterial == null) return;

            var warpedPts = new (double, double)[4];
            for (int i = 0; i < 4; i++)
                warpedPts[i] = (Corners[i].x, Corners[i].y);

            // Compute forward homography: UnitSquare -> WarpedCorners
            var forwardH = Homography2D.Compute(UnitSquare, warpedPts);

            // Invert to get: WarpedScreen -> SourceUV
            var invH = forwardH.Inverse();

            // Row-major 3x3 to Matrix4x4 for Unity shader
            double[] h = invH.H;
            Matrix4x4 mat = new Matrix4x4(
                new Vector4((float)h[0], (float)h[3], (float)h[6], 0),
                new Vector4((float)h[1], (float)h[4], (float)h[7], 0),
                new Vector4((float)h[2], (float)h[5], (float)h[8], 0),
                Vector4.zero
            );

            WarpMaterial.SetMatrix("_InvHomography", mat);
            WarpMaterial.SetColor("_BorderColor", Color.black);
        }

        public void SetCorner(int index, Vector2 uv)
        {
            if (index >= 0 && index < 4)
            {
                Corners[index] = uv;
                if (Wizard != null)
                {
                    Wizard.ActiveData.KeystoneCorners[index] = uv;
                }
                UpdateWarpMatrix();
            }
        }

        public void ResetCorners()
        {
            Corners[0] = new Vector2(0, 1);
            Corners[1] = new Vector2(1, 1);
            Corners[2] = new Vector2(1, 0);
            Corners[3] = new Vector2(0, 0);
            UpdateWarpMatrix();
        }
    }
}
