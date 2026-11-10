using System;
using System.Collections.Generic;
using UnityEngine;
using ProjectionFX.Math;

namespace ProjectionFX.Calibration
{
    [Serializable]
    public class CalibrationData
    {
        public int ProjectorWidth = 1920;
        public int ProjectorHeight = 1080;

        // Solved Camera Model
        public double Fx;
        public double Fy;
        public double Cx;
        public double Cy;
        public double Skew;
        public Vector3 ProjectorPosition;
        public Quaternion ProjectorRotation;
        public double RmsErrorPixels;

        // 3D-to-2D Correspondences
        public List<Vector3> WorldPoints = new List<Vector3>();
        public List<Vector2> ProjectorPixelPoints = new List<Vector2>();

        // Camera to Projector 2D Homography (3x3 array)
        public double[] CameraToProjectorHomography = new double[9] { 1, 0, 0, 0, 1, 0, 0, 0, 1 };

        // 4-Corner Keystone Offsets (Normalized UV space: TopLeft, TopRight, BottomRight, BottomLeft)
        public Vector2[] KeystoneCorners = new Vector2[4]
        {
            new Vector2(0, 1), // Top-Left
            new Vector2(1, 1), // Top-Right
            new Vector2(1, 0), // Bottom-Right
            new Vector2(0, 0)  // Bottom-Left
        };

        public string ToJson()
        {
            return JsonUtility.ToJson(this, true);
        }

        public static CalibrationData FromJson(string json)
        {
            return JsonUtility.FromJson<CalibrationData>(json);
        }
    }
}
