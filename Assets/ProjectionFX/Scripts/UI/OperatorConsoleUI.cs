using System;
using UnityEngine;
using ProjectionFX.Tracking;
using ProjectionFX.Calibration;
using ProjectionFX.Splats;
using ProjectionFX.Effects;

namespace ProjectionFX.UI
{
    public class OperatorConsoleUI : MonoBehaviour
    {
        [Header("System References")]
        public TrackingManager Tracking;
        public CalibrationWizard Calibration;
        public GaussianSplatDeformer SplatDeformer;
        public ReferenceModelAlignment ModelAlignment;

        [Header("UI Appearance")]
        public bool ShowConsole = true;
        public KeyCode ToggleKey = KeyCode.F1;

        float m_Fps;
        float m_FpsTimer;
        int m_FrameCount;

        Vector2 m_ScrollPos;
        bool m_ShowCalibrationTab = true;
        bool m_ShowSplatTab = true;

        void Start()
        {
            if (Tracking == null) Tracking = TrackingManager.Instance;
            if (Calibration == null) Calibration = CalibrationWizard.Instance;
            if (SplatDeformer == null) SplatDeformer = FindAnyObjectByType<GaussianSplatDeformer>();
            if (ModelAlignment == null) ModelAlignment = FindAnyObjectByType<ReferenceModelAlignment>();
        }

        void Update()
        {
            if (Input.GetKeyDown(ToggleKey))
            {
                ShowConsole = !ShowConsole;
            }

            m_FrameCount++;
            m_FpsTimer += Time.unscaledDeltaTime;
            if (m_FpsTimer >= 0.5f)
            {
                m_Fps = m_FrameCount / m_FpsTimer;
                m_FrameCount = 0;
                m_FpsTimer = 0;
            }
        }

        void OnGUI()
        {
            if (!ShowConsole) return;

            // Operator console window on left side of Display 1
            float width = 380;
            float height = Screen.height - 40;
            Rect windowRect = new Rect(20, 20, width, height);

            GUI.backgroundColor = new Color(0.12f, 0.12f, 0.16f, 0.92f);
            GUI.Box(windowRect, GUIContent.none);

            GUILayout.BeginArea(new Rect(30, 30, width - 20, height - 20));
            m_ScrollPos = GUILayout.BeginScrollView(m_ScrollPos);

            // Title & Performance
            GUILayout.Label("<b><size=16>PROJECTION MAPPING CONSOLE</size></b>");
            GUILayout.Label($"<b>FPS:</b> {m_Fps:F1} ({1000f / Mathf.Max(m_Fps, 1f):F1} ms) | <b>Displays:</b> {UnityEngine.Display.displays.Length}");
            GUILayout.Space(10);

            // Mode Selector
            GUILayout.Label("<b>--- OPERATIONAL MODE ---</b>");
            GUILayout.BeginHorizontal();
            if (Tracking != null)
            {
                GUI.color = (Tracking.CurrentMode == TrackingMode.StaticObject) ? Color.cyan : Color.white;
                if (GUILayout.Button("Static 3D Object", GUILayout.Height(32)))
                {
                    Tracking.CurrentMode = TrackingMode.StaticObject;
                }

                GUI.color = (Tracking.CurrentMode == TrackingMode.DynamicPerformer) ? Color.cyan : Color.white;
                if (GUILayout.Button("Dynamic Performer", GUILayout.Height(32)))
                {
                    Tracking.CurrentMode = TrackingMode.DynamicPerformer;
                }
                GUI.color = Color.white;
            }
            GUILayout.EndHorizontal();
            GUILayout.Space(12);

            // Tracking Status & Mini Camera Preview
            GUILayout.Label("<b>--- TRACKING STATUS ---</b>");
            if (Tracking != null)
            {
                var camTex = Tracking.CameraTexture;
                if (camTex != null)
                {
                    float previewWidth = width - 40;
                    float previewHeight = previewWidth * (camTex.height / (float)camTex.width);
                    GUILayout.Label(camTex, GUILayout.Width(previewWidth), GUILayout.Height(previewHeight));
                }

                if (Tracking.CurrentMode == TrackingMode.StaticObject)
                {
                    bool handDetected = Tracking.HandTracker != null && Tracking.HandTracker.HandState.IsDetected;
                    bool isPinching = handDetected && Tracking.HandTracker.HandState.IsPinching;
                    GUILayout.Label($"Hand Tracked: {(handDetected ? "<color=green>YES</color>" : "<color=red>NO</color>")} | Pinch: {(isPinching ? "<color=yellow>PINCHING</color>" : "Open")}");
                }
                else
                {
                    bool poseDetected = Tracking.PoseTracker != null && Tracking.PoseTracker.Joints != null && Tracking.PoseTracker.Joints[0].IsValid;
                    GUILayout.Label($"Performer Skeleton: {(poseDetected ? "<color=green>LOCKED</color>" : "<color=red>SEARCHING</color>")}");
                }
            }
            GUILayout.Space(12);

            // Calibration Wizard Controls
            m_ShowCalibrationTab = GUILayout.Toggle(m_ShowCalibrationTab, "<b>[+] 3D CALIBRATION WIZARD</b>");
            if (m_ShowCalibrationTab && Calibration != null)
            {
                GUILayout.Label($"Current Step: <b>{Calibration.CurrentStep}</b>");
                GUILayout.Label($"Correspondences: {Calibration.ActiveData.WorldPoints.Count} points (min 6)");
                if (Calibration.ActiveData.RmsErrorPixels > 0)
                {
                    GUILayout.Label($"Calibration RMS: <b>{Calibration.ActiveData.RmsErrorPixels:F3} px</b>");
                }

                GUILayout.BeginHorizontal();
                if (GUILayout.Button("Align Crosshairs"))
                {
                    Calibration.SetStep(WizardStep.AlignProjectorCrosshairs);
                }
                if (GUILayout.Button("SOLVE POSE"))
                {
                    Calibration.SolveProjectorPose();
                }
                GUILayout.EndHorizontal();

                if (ModelAlignment != null)
                {
                    bool newContour = GUILayout.Toggle(ModelAlignment.ShowContours, "Show Alignment Contours (Laser)");
                    if (newContour != ModelAlignment.ShowContours)
                    {
                        ModelAlignment.SetContourVisibility(newContour);
                    }
                }

                GUILayout.BeginHorizontal();
                if (GUILayout.Button("Save Profile")) Calibration.SaveProfile();
                if (GUILayout.Button("Reload Profile")) Calibration.LoadProfile();
                GUILayout.EndHorizontal();
            }
            GUILayout.Space(12);

            // Gaussian Splat Dynamics
            m_ShowSplatTab = GUILayout.Toggle(m_ShowSplatTab, "<b>[+] 3D GAUSSIAN SPLAT DYNAMICS</b>");
            if (m_ShowSplatTab && SplatDeformer != null)
            {
                GUILayout.Label($"Displace Radius: {SplatDeformer.DisplaceRadius:F2} m");
                SplatDeformer.DisplaceRadius = GUILayout.HorizontalSlider(SplatDeformer.DisplaceRadius, 0.05f, 1.0f);

                GUILayout.Label($"Displace Force: {SplatDeformer.DisplaceStrength:F1}");
                SplatDeformer.DisplaceStrength = GUILayout.HorizontalSlider(SplatDeformer.DisplaceStrength, 0.0f, 8.0f);

                GUILayout.Label($"Turbulence: {SplatDeformer.TurbulenceStrength:F1}");
                SplatDeformer.TurbulenceStrength = GUILayout.HorizontalSlider(SplatDeformer.TurbulenceStrength, 0.0f, 5.0f);

                GUILayout.Label($"Dissolve Radius: {SplatDeformer.DissolveRadius:F2} m");
                SplatDeformer.DissolveRadius = GUILayout.HorizontalSlider(SplatDeformer.DissolveRadius, 0.0f, 0.6f);

                GUILayout.Label($"Recovery Speed: {SplatDeformer.RecoverySpeed:F1}");
                SplatDeformer.RecoverySpeed = GUILayout.HorizontalSlider(SplatDeformer.RecoverySpeed, 1.0f, 15.0f);

                if (GUILayout.Button("Reset Splats to Origin"))
                {
                    SplatDeformer.ResetToOrigin();
                }
            }
            GUILayout.Space(20);

            GUILayout.Label("<size=10>Press TAB to toggle View | F1 for Console | F11 Fullscreen</size>");

            GUILayout.EndScrollView();
            GUILayout.EndArea();
        }
    }
}
