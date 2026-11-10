# ProjectionFX: Interactive Real-Time Projection Mapping System

An all-in-one interactive projection mapping application built for **Unity (URP)** combining:
- **3D Gaussian Splatting (3DGS)** rendering via Aras-P's compute-based pipeline.
- **MediaPipe tracking & segmentation** running 100% natively on GPU compute with **Unity Sentis / Inference Engine**.
- **Model Reference 3D effects** (contour alignment lasers, surface collider physics, touchless volumetric dispersal, and dynamic body skeleton).
- **Embedded Semi-Automated 3D Calibration Wizard** (solving camera/projector intrinsics and extrinsics via Normalized DLT / PnP, eliminating TouchDesigner or external dependencies).
- **Native Dual-Display Architecture** (Display 1: Operator console and live video HUD; Display 2: Clean borderless projection with 4-corner keystone warping).

---

## Architecture & Data Flow

```
[1080p60 RGB Webcam]
         |
         v
[Sentis Inference Engine (GPU)]
  ├── BlazePalm & HandLandmarker (21 3D joints, pinch detection)
  └── BlazePose & SelfieSegmentation (33 skeleton joints + silhouette alpha mask)
         |
         v
[SplatDeformCompute.compute]
  ├── Hand proximity push & curl turbulence
  ├── Volumetric dissolve & elastic recovery
  └── Reference model surface collision
         |
         v
[GaussianSplatRenderer (Aras-P)]
         |
         v
[CornerPinWarp (4-Corner Keystone)] ──> [Display 2: Projector Output]
                                         [Display 1: Operator Console]
```

---

## Directory Structure

```
ProjectionFX/
├── Assets/
│   └── ProjectionFX/
│       ├── Models/                   # Pretrained MediaPipe ONNX models
│       │   ├── hand_detector.onnx
│       │   ├── hand_landmarks_detector.onnx
│       │   ├── pose_detection.onnx
│       │   └── pose_landmarks_detector_full.onnx
│       ├── Resources/
│       │   └── ComputeShaders/
│       │       ├── ImageTransform.compute        # Real-time affine sampling & sRGB conversion
│       │       └── SegmentationMaskBlit.compute  # Sigmoid + smoothstep alpha mask generator
│       ├── Scripts/
│       │   ├── Math/                 # Pure C# linear algebra & calibration algorithms
│       │   │   ├── LinAlg.cs              # Jacobi eigen, null-space solver, RQ decomposition
│       │   │   ├── Homography2D.cs        # 2D projective transformation solver
│       │   │   ├── ProjectorCalibration.cs# PnP solver -> K[R|t] -> Unity camera matrix
│       │   │   ├── BlazeAnchors.cs        # Procedural SSD anchor generator (2016 / 2254)
│       │   │   └── OneEuroFilter.cs       # Low-latency jitter smoothing filter bank
│       │   ├── Tracking/             # Vision & inference runtime
│       │   │   ├── TrackingData.cs        # Joints, hands, and ITrackingSource interface
│       │   │   ├── BlazeUtils.cs          # FunctionalGraph ArgMax filtering
│       │   │   ├── SentisHandTracker.cs   # Hand tracking & pinch detection
│       │   │   ├── SentisPoseTracker.cs   # Pose skeleton & body segmentation mask
│       │   │   └── TrackingManager.cs     # Webcam capture & coordinator
│       │   ├── Splats/               # 3D Gaussian Splat dynamic interaction
│       │   │   └── GaussianSplatDeformer.cs # Hand-driven dispersion & dissolve bridge
│       │   ├── Calibration/          # Embedded calibration wizard
│       │   │   ├── CalibrationData.cs     # JSON-serializable calibration profile
│       │   │   └── CalibrationWizard.cs   # 6-point 3D alignment & PnP execution
│       │   ├── Display/              # Display routing & keystone warp
│       │   │   ├── DualDisplayManager.cs  # Secondary monitor / projector activator
│       │   │   └── CornerPinWarpPass.cs   # 4-corner keystone pinning
│       │   ├── Effects/              # 3D Reference Model & Performer VFX
│       │   │   ├── ReferenceModelAlignment.cs # Alignment laser contours & surface physics
│       │   │   └── DynamicPerformerRig.cs    # 33-joint skeleton & performer light mask
│       │   └── UI/
│       │       └── OperatorConsoleUI.cs   # IMGUI Operator control console for Display 1
│       └── Shaders/
│           ├── SplatDeformCompute.compute # GPU curl turbulence & volumetric dissolve
│           ├── CornerPinWarp.shader       # Post-process keystone homography warp
│           ├── ContourAlignment.shader    # Laser-edge alignment shader for physical 3D mesh
│           └── PerformerLightMask.shader  # Zero-bleed silhouette stencil shader
├── Packages/
│   └── manifest.json                 # URP, Sentis, GaussianSplatting, Mathematics, Burst
└── Tools/
    ├── download_models.sh            # Script to refresh ONNX models from HuggingFace
    └── MathTests/                    # Standalone .NET test suite verifying all calibration math
```

---

## Verification & Math Tests

The entire mathematical foundation (Homography, PnP camera calibration, RQ decomposition, MediaPipe anchors, and One Euro filtering) is verified with a standalone .NET 8 test harness:

```bash
cd /home/antigravity/ProjectionFX
~/.dotnet/dotnet run --project Tools/MathTests
```

**Output**:
```
PASS  Homography recover n=4 maxErr=2.09E-011
PASS  Homography recover n=12 maxErr=7.96E-013
PASS  Homography inverse round trip 
PASS  Calibration exact: reprojection rms=7.93E-013px
PASS  Calibration exact: focal fx=1650.000 fy=1650.000
PASS  Calibration exact: principal point (lens shift) cx=960.000 cy=918.000
PASS  Calibration exact: position err=4.57E-013m
PASS  Calibration exact: not mirrored 
PASS  Unity camera pose + projection matrix reproduces pixels (exact) maxErr=2.05E-012px
PASS  Unity basis is LookRotation compatible 
PASS  Calibration noisy(0.5px, 12pts): reprojection rms=0.524px max=0.956px
PASS  Calibration noisy: position within 5cm err=0.79cm fov=36.32deg
PASS  Calibration detects mirrored (rear projection) setup 
PASS  Calibration rejects coplanar points 
PASS  Hand anchors count 2016
PASS  Pose anchors count 2254
PASS  OneEuro reduces jitter ratio=0.088

ALL TESTS PASSED
```

---

## Step-by-Step Calibration & Workflow Guide

### 1. Static 3D Object Calibration (Sculptures / Products)
1. Place your physical reference object in the projection beam.
2. Open the scene in Unity and hit **Play**.
3. On **Display 1 (Operator Console)**, toggle **"Show Alignment Contours (Laser)"**.
4. In the **3D Calibration Wizard**:
   - Pick at least 6 identifiable vertices on your 3D reference model.
   - On Display 2 (Projector screen), drag the corresponding crosshairs until each laser crosshair aligns exactly with the physical vertex on your object.
   - Click **SOLVE POSE**. The system solves `ProjectorCalibration.Calibrate()` using Normalized DLT + RQ decomposition, aligning the virtual projector camera's FOV, position, and lens shift to the physical projector.
   - Click **Save Profile**. This writes `Assets/StreamingAssets/calibration_profile.json`.

### 2. Gaussian Splat Interactive Dissolve
1. Drag your `.ply` or `.spz` splat capture into `StreamingAssets/` and assign it to the `GaussianSplatRenderer` component.
2. Add the `GaussianSplatDeformer` component.
3. Bring your hand into the webcam view:
   - Moving your hand near the physical object applies curl turbulence and pushes the splats away in real-time.
   - Pinching (detected by MediaPipe) intensifies the displacement.
   - Moving inside the **Dissolve Radius** peels away the volumetric splats to reveal the underlying physical contours.
   - Withdrawing your hand allows the splats to elastically spring back to their base positions.

### 3. Dynamic Mode (Moving Performer / Dancer)
1. On the Operator Console, switch mode to **"Dynamic Performer"**.
2. MediaPipe BlazePose locks onto the performer:
   - 33 3D skeleton keypoints drive visual energy streams and particles adhering to limbs.
   - The real-time GPU segmentation mask cuts the projector light outside the performer's body, preventing background spill onto walls or floors.

---

## Hotkeys

| Hotkey | Action |
| :--- | :--- |
| **F1** | Toggle Operator Console HUD |
| **Tab** | Switch between Operator View and Projector View (in single-monitor development) |
| **F11** | Toggle Fullscreen mode |
