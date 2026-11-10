using System;
using System.IO;
using System.Collections.Generic;
using UnityEngine;
using ProjectionFX.Math;

namespace ProjectionFX.Calibration
{
    public enum WizardStep
    {
        Idle,
        Select3DPoints,
        AlignProjectorCrosshairs,
        AlignCameraToProjector,
        KeystoneCornerPin
    }

    public class CalibrationWizard : MonoBehaviour
    {
        public static CalibrationWizard Instance { get; private set; }

        [Header("Target & Projector")]
        public Camera ProjectorCamera;
        public GameObject ReferenceModel;
        public int ProjectorWidth = 1920;
        public int ProjectorHeight = 1080;

        [Header("Active State")]
        public WizardStep CurrentStep = WizardStep.Idle;
        public CalibrationData ActiveData = new CalibrationData();

        [Header("Crosshair Visuals")]
        public Texture2D CrosshairTexture;
        public Color CrosshairColor = Color.cyan;
        public int SelectedPointIndex = 0;

        public event Action<WizardStep> OnStepChanged;
        public event Action<double> OnCalibrationCompleted; // passes RMS error in px

        const string ProfileFileName = "calibration_profile.json";

        void Awake()
        {
            if (Instance == null) Instance = this;
            else { Destroy(gameObject); return; }

            ActiveData.ProjectorWidth = ProjectorWidth;
            ActiveData.ProjectorHeight = ProjectorHeight;
        }

        void Start()
        {
            LoadProfile();
        }

        public void SetStep(WizardStep step)
        {
            CurrentStep = step;
            OnStepChanged?.Invoke(step);
            Debug.Log($"[CalibrationWizard] Step changed to: {step}");
        }

        public void AddPointCorrespondence(Vector3 worldPoint, Vector2 screenPixel)
        {
            ActiveData.WorldPoints.Add(worldPoint);
            ActiveData.ProjectorPixelPoints.Add(screenPixel);
            SelectedPointIndex = ActiveData.WorldPoints.Count - 1;
            Debug.Log($"[CalibrationWizard] Added point pair #{SelectedPointIndex + 1}: World={worldPoint}, Pixel={screenPixel}");
        }

        public void UpdateProjectorPixel(int index, Vector2 pixel)
        {
            if (index >= 0 && index < ActiveData.ProjectorPixelPoints.Count)
            {
                ActiveData.ProjectorPixelPoints[index] = pixel;
            }
        }

        public bool SolveProjectorPose()
        {
            if (ActiveData.WorldPoints.Count < ProjectorCalibration.MinPoints)
            {
                Debug.LogWarning($"[CalibrationWizard] Need at least {ProjectorCalibration.MinPoints} points, have {ActiveData.WorldPoints.Count}");
                return false;
            }

            try
            {
                var worldList = new List<(double, double, double)>();
                var pixelList = new List<(double, double)>();

                for (int i = 0; i < ActiveData.WorldPoints.Count; i++)
                {
                    var w = ActiveData.WorldPoints[i];
                    var p = ActiveData.ProjectorPixelPoints[i];
                    worldList.Add((w.x, w.y, w.z));
                    pixelList.Add((p.x, p.y));
                }

                var model = ProjectorCalibration.Calibrate(worldList, pixelList, ActiveData.ProjectorWidth, ActiveData.ProjectorHeight);

                ActiveData.Fx = model.Fx;
                ActiveData.Fy = model.Fy;
                ActiveData.Cx = model.Cx;
                ActiveData.Cy = model.Cy;
                ActiveData.Skew = model.Skew;
                ActiveData.RmsErrorPixels = model.RmsError;

                var pos = model.Position;
                ActiveData.ProjectorPosition = new Vector3((float)pos.x, (float)pos.y, (float)pos.z);

                var fwd = model.Forward;
                var up = model.Up;
                ActiveData.ProjectorRotation = Quaternion.LookRotation(
                    new Vector3((float)fwd.x, (float)fwd.y, (float)fwd.z),
                    new Vector3((float)up.x, (float)up.y, (float)up.z)
                );

                ApplyCalibrationToCamera(model);

                Debug.Log($"[CalibrationWizard] Calibration SUCCESS! RMS Error: {model.RmsError:F3}px (Max: {model.MaxError:F3}px). Position: {ActiveData.ProjectorPosition}");
                OnCalibrationCompleted?.Invoke(model.RmsError);
                SaveProfile();
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[CalibrationWizard] Calibration failed: {ex.Message}");
                return false;
            }
        }

        public void ApplyCalibrationToCamera(CameraModel model = null)
        {
            if (ProjectorCamera == null) return;

            ProjectorCamera.transform.position = ActiveData.ProjectorPosition;
            ProjectorCamera.transform.rotation = ActiveData.ProjectorRotation;

            if (model != null)
            {
                double[] p = model.UnityProjectionMatrix(ProjectorCamera.nearClipPlane, ProjectorCamera.farClipPlane);
                Matrix4x4 mat = new Matrix4x4();
                for (int r = 0; r < 4; r++)
                    for (int c = 0; c < 4; c++)
                        mat[r, c] = (float)p[r * 4 + c];

                ProjectorCamera.projectionMatrix = mat;
            }
        }

        public void SolveCameraToProjectorHomography(IList<(double x, double y)> cameraNorm, IList<(double x, double y)> projNorm)
        {
            var h = Homography2D.Compute(cameraNorm, projNorm);
            ActiveData.CameraToProjectorHomography = h.H;
            SaveProfile();
            Debug.Log("[CalibrationWizard] Camera to Projector Homography solved.");
        }

        public void SaveProfile()
        {
            string dir = Application.streamingAssetsPath;
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, ProfileFileName);
            File.WriteAllText(path, ActiveData.ToJson());
            Debug.Log($"[CalibrationWizard] Saved profile to: {path}");
        }

        public bool LoadProfile()
        {
            string path = Path.Combine(Application.streamingAssetsPath, ProfileFileName);
            if (File.Exists(path))
            {
                try
                {
                    string json = File.ReadAllText(path);
                    ActiveData = CalibrationData.FromJson(json);
                    ApplyCalibrationToCamera();
                    Debug.Log($"[CalibrationWizard] Loaded profile from: {path} (RMS: {ActiveData.RmsErrorPixels:F2}px)");
                    return true;
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[CalibrationWizard] Failed to parse profile: {ex.Message}");
                }
            }
            return false;
        }

        void OnGUI()
        {
            // Only render crosshairs when adjusting on screen
            if (CurrentStep != WizardStep.AlignProjectorCrosshairs && CurrentStep != WizardStep.AlignCameraToProjector)
                return;

            for (int i = 0; i < ActiveData.ProjectorPixelPoints.Count; i++)
            {
                var pt = ActiveData.ProjectorPixelPoints[i];
                bool isSelected = (i == SelectedPointIndex);

                Color col = isSelected ? Color.yellow : CrosshairColor;
                GUI.color = col;

                float size = isSelected ? 36f : 24f;
                Rect rect = new Rect(pt.x - size * 0.5f, pt.y - size * 0.5f, size, size);

                if (CrosshairTexture != null)
                {
                    GUI.DrawTexture(rect, CrosshairTexture);
                }
                else
                {
                    GUI.Box(rect, $"#{i + 1}");
                }
            }
        }
    }
}
