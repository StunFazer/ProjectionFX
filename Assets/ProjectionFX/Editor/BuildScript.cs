using System;
using System.IO;
using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.Rendering.Universal;
using ProjectionFX.Tracking;
using ProjectionFX.Calibration;
using ProjectionFX.Display;
using ProjectionFX.Splats;
using ProjectionFX.Effects;
using ProjectionFX.UI;

namespace ProjectionFX.Editor
{
    public static class BuildScript
    {
        const string ScenePath = "Assets/ProjectionFX/Scenes/Main.unity";
        const string BuildOutputDir = "build/Windows";
        const string ExeName = "ProjectionFX.exe";

        [MenuItem("ProjectionFX/Create Main Scene")]
        public static void CreateOrUpdateMainScene()
        {
            string dir = Path.GetDirectoryName(ScenePath);
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            // 1. Setup Operator Camera (Display 1)
            var opCamGO = new GameObject("OperatorCamera");
            var opCam = opCamGO.AddComponent<Camera>();
            opCam.clearFlags = CameraClearFlags.SolidColor;
            opCam.backgroundColor = new Color(0.08f, 0.08f, 0.1f, 1f);
            opCam.targetDisplay = 0;
            opCamGO.AddComponent<UniversalAdditionalCameraData>();

            // 2. Setup Projector Camera (Display 2)
            var projCamGO = new GameObject("ProjectorCamera");
            var projCam = projCamGO.AddComponent<Camera>();
            projCam.clearFlags = CameraClearFlags.SolidColor;
            projCam.backgroundColor = Color.black;
            projCam.targetDisplay = 1;
            projCamGO.AddComponent<UniversalAdditionalCameraData>();

            // 3. Setup Core Managers
            var coreGO = new GameObject("--- PROJECTION_CORE ---");

            var tracking = coreGO.AddComponent<TrackingManager>();
            // Link pre-trained ONNX models from Models folder if found
            tracking.HandDetectorModel = AssetDatabase.LoadAssetAtPath<Unity.InferenceEngine.ModelAsset>("Assets/ProjectionFX/Models/hand_detector.onnx");
            tracking.HandLandmarkerModel = AssetDatabase.LoadAssetAtPath<Unity.InferenceEngine.ModelAsset>("Assets/ProjectionFX/Models/hand_landmarks_detector.onnx");
            tracking.PoseDetectorModel = AssetDatabase.LoadAssetAtPath<Unity.InferenceEngine.ModelAsset>("Assets/ProjectionFX/Models/pose_detection.onnx");
            tracking.PoseLandmarkerModel = AssetDatabase.LoadAssetAtPath<Unity.InferenceEngine.ModelAsset>("Assets/ProjectionFX/Models/pose_landmarks_detector_full.onnx");

            var calib = coreGO.AddComponent<CalibrationWizard>();
            calib.ProjectorCamera = projCam;

            var dualDisplay = coreGO.AddComponent<DualDisplayManager>();
            dualDisplay.OperatorCamera = opCam;
            dualDisplay.ProjectorCamera = projCam;

            var consoleUI = coreGO.AddComponent<OperatorConsoleUI>();
            consoleUI.Tracking = tracking;
            consoleUI.Calibration = calib;

            // 4. Setup Dynamic Rig & Reference Visuals
            var rigGO = new GameObject("DynamicPerformerRig");
            var rig = rigGO.AddComponent<DynamicPerformerRig>();
            rig.Tracking = tracking;

            // 5. Setup Splat Renderer placeholder
            var splatGO = new GameObject("GaussianSplatTarget");
            var deformer = splatGO.AddComponent<GaussianSplatDeformer>();
            deformer.Tracking = tracking;
            consoleUI.SplatDeformer = deformer;

            EditorSceneManager.SaveScene(scene, ScenePath);
            Debug.Log($"[BuildScript] Created and saved main projection scene to: {ScenePath}");
        }

        public static void BuildWindows()
        {
            Debug.Log("[BuildScript] Starting Windows Standalone build for ProjectionFX...");

            if (!File.Exists(ScenePath))
            {
                CreateOrUpdateMainScene();
            }

            var scenes = new EditorBuildSettingsScene[]
            {
                new EditorBuildSettingsScene(ScenePath, true)
            };
            EditorBuildSettings.scenes = scenes;

            string outputPath = Path.Combine(BuildOutputDir, ExeName);
            string fullDir = Path.GetFullPath(BuildOutputDir);
            if (!Directory.Exists(fullDir)) Directory.CreateDirectory(fullDir);

            var options = new BuildPlayerOptions
            {
                scenes = new string[] { ScenePath },
                locationPathName = outputPath,
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.None
            };

            var report = BuildPipeline.BuildPlayer(options);
            var summary = report.summary;

            if (summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded)
            {
                Debug.Log($"[BuildScript] Build SUCCESSFUL: {summary.totalSize / 1024 / 1024} MB at {outputPath}");
            }
            else
            {
                Debug.LogError($"[BuildScript] Build FAILED with {summary.totalErrors} errors!");
                throw new Exception($"Unity build failed with status: {summary.result}");
            }
        }
    }
}
