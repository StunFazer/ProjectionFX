# ProjectionFX 📽️✨

**Interactive Real-Time 3D Projection Mapping Application** powered by WebGPU / Three.js 3D Gaussian Splatting (3DGS), Google MediaPipe Computer Vision, and Dual-Display Calibration.

Compiles directly into a standalone, portable Windows executable (`ProjectionFX.exe`) with **zero proprietary engine licenses or subscription keys required**.

---

## 🌟 Key Architecture & Capabilities

1. **3D Gaussian Splatting (3DGS) Engine**
   - High-throughput GPU rasterizer with real-time physics deformation.
   - **Solenoidal Curl Turbulence Field**: Fluid particle swirls across the 3D splat cloud.
   - **Touchless Hand Dispersion**: Real-time repulsion/attraction fields reacting to tracked hand landmarks.
   - **Volumetric Reveal / Dissolve**: Interactive radial and depth-based visibility slicing.
   - Built-in **Procedural Demo Sculpture** (60,000 splats) ready to run out of the box + drag-and-drop `.ply` / `.splat` loader.

2. **Computer Vision & Tracking (Google MediaPipe)**
   - 21 3D hand landmarks per hand (pinch detection, palm vector, fingertip position).
   - Real-time performer body silhouette segmentation stencil for dynamic performers.
   - Adaptive **$1€$ (OneEuro) low-latency jitter filter bank** for smooth tracking without lag.

3. **Spatial Projector Calibration & Alignment**
   - **6-Point Direct Linear Transform (DLT) PnP Solver**: Normalized isotropic scaling and RQ decomposition to extract the exact physical projector pose $(X, Y, Z, \text{yaw}, \text{pitch}, \text{roll})$ and off-axis non-symmetric frustum matrix.
   - **4-Corner Keystone Warper**: Planar projective 2D homography matrix ($8\text{-DOF}$) applied at zero GPU overhead for non-perpendicular throws.

4. **Dual-Display Architecture**
   - **Display 1 (Operator Console)**: Live camera feed with tracked skeleton overlay, 3D interactive viewport, effect knobs, calibration table, and keystone pins.
   - **Display 2 (Projector Window)**: Borderless fullscreen projection output with live synchronization over `BroadcastChannel`.

---

## 🚀 Quick Start (Local Run)

```bash
# 1. Install dependencies
npm install

# 2. Run mathematical solver tests
npm test

# 3. Start development server
npm run dev
# Opens at http://localhost:3000

# 4. Or launch as desktop Electron app
npm run electron:dev
```

---

## 📦 Building the Standalone Windows `.exe`

### Automated Cloud Build (Recommended - Zero Setup)
1. Go to your GitHub repository: **Actions → Build Standalone Windows (.exe)**.
2. Click **Run workflow** → select branch `main` → click **Run workflow**.
3. In under 2 minutes, the workflow compiles the standalone executable and creates **`ProjectionFX-Windows-x64.zip`** in the run's **Artifacts** and **Releases** tab.
4. Download, unzip, and double-click `ProjectionFX.exe` to run on any Windows PC. No installation or setup required.

### Local Windows Build
```bash
npm run build:win
```
The output executable will be placed in `dist-electron/ProjectionFX.exe`.
