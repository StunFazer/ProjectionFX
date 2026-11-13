import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { OneEuroFilter3D } from '../math/OneEuroFilter.js';

/**
 * TrackingManager.js - Real-Time AI Stage Performer Tracker
 * Uses locally bundled MediaPipe PoseLandmarker (33-point full body skeleton + real-time silhouette segmentation mask)
 * with adaptive OneEuroFilter smoothing, velocity estimation, and articulated synthetic dancer fallback.
 */
export class TrackingManager {
  constructor() {
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;

    // Offscreen mask canvas for Body-Locked Stencil & Contour Halo (160x90 for blazing 60fps sync + warp)
    this.maskWidth = 160;
    this.maskHeight = 90;
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = this.maskWidth;
    this.maskCanvas.height = this.maskHeight;
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    this.maskImageData = this.maskCtx.createImageData(this.maskWidth, this.maskHeight);
    this.maskAlphaBuffer = new Uint8Array(this.maskWidth * this.maskHeight);

    this.poseLandmarker = null;
    this.isModelLoading = false;
    this.isModelReady = false;
    this.lastError = null;
    this.delegateUsed = 'None';

    // 33 OneEuroFilters for rock-steady jitter-free skeleton lines
    this.minCutoff = 1.6;
    this.beta = 0.05;
    this.poseFilters = Array.from({ length: 33 }, () => new OneEuroFilter3D(this.minCutoff, this.beta));
    this.prevLandmarks = null;
    this.prevTimestampSec = null;

    this.mirrorX = true; // Default true for laptop rehearsal; toggle off when camera sits beside projector
    this.isCameraRunning = false;
    this.useSynthetic = true; // Start in Synthetic Dancer mode until live camera is activated
    this.currentStream = null;
    this.selectedDeviceId = null;
    this.lastVideoTime = -1;

    this.trackingData = {
      isTracking: false,
      source: 'synthetic', // 'webcam' | 'synthetic'
      landmarks: [],       // 33 smoothed [x, y, z, visibility] normalized 0..1
      velocities: [],      // 33 [vx, vy, speed] normalized/sec
      leftHand: null,      // [x, y] normalized
      rightHand: null,     // [x, y] normalized
      detectedJointsCount: 0,
      hasMask: false,
      maskWidth: this.maskWidth,
      maskHeight: this.maskHeight,
      maskAlpha: this.maskAlphaBuffer
    };
  }

  setMirror(mirror) {
    this.mirrorX = !!mirror;
    this.resetFilters();
  }

  setSmoothing(responsiveness) {
    // responsiveness 0 (super smooth) .. 1 (ultra responsive)
    this.minCutoff = 0.6 + responsiveness * 2.5;
    this.beta = 0.005 + responsiveness * 0.12;
    this.poseFilters = Array.from({ length: 33 }, () => new OneEuroFilter3D(this.minCutoff, this.beta));
  }

  resetFilters() {
    this.poseFilters = Array.from({ length: 33 }, () => new OneEuroFilter3D(this.minCutoff, this.beta));
    this.prevLandmarks = null;
  }

  async getAvailableCameras() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return [];
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(d => d.kind === 'videoinput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${index + 1}`
        }));
    } catch (e) {
      console.warn('Failed to enumerate cameras:', e);
      return [];
    }
  }

  async startCamera(videoElement = null, preferredDeviceId = null) {
    const targetVideo = videoElement || this.video;
    this.lastError = null;

    if (preferredDeviceId !== null && preferredDeviceId !== undefined) {
      this.selectedDeviceId = preferredDeviceId;
    }

    if (this.selectedDeviceId === 'synthetic') {
      this.stopCamera();
      this.useSynthetic = true;
      return true;
    }

    // Release previous hardware stream before opening new camera
    if (this.currentStream) {
      try {
        this.currentStream.getTracks().forEach(track => track.stop());
      } catch (_) {}
      this.currentStream = null;
    }

    try {
      let stream = null;
      try {
        const constraints = {
          video: (this.selectedDeviceId && this.selectedDeviceId !== '')
            ? {
                deviceId: { ideal: this.selectedDeviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 60 }
              }
            : {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 60 }
              }
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err1) {
        if (err1.name === 'NotAllowedError' || err1.name === 'PermissionDeniedError') {
          throw new Error('Permission denied: Allow camera in Windows Privacy Settings.');
        } else if (err1.name === 'NotReadableError' || err1.name === 'TrackStartError') {
          throw new Error('Camera busy (close Zoom, OBS, or Camera app).');
        } else if (err1.name === 'NotFoundError' || err1.name === 'DevicesNotFoundError') {
          throw new Error('No physical webcam detected.');
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      if (!stream) throw new Error('Empty media stream');

      this.currentStream = stream;
      targetVideo.srcObject = stream;
      targetVideo.muted = true;
      targetVideo.autoplay = true;
      targetVideo.playsInline = true;

      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        targetVideo.onloadeddata = finish;
        targetVideo.onloadedmetadata = finish;
        const p = targetVideo.play();
        if (p && p.then) p.then(finish).catch(finish);
        setTimeout(finish, 1200);
      });

      this.video = targetVideo;
      this.isCameraRunning = true;
      this.useSynthetic = false;
      this.lastVideoTime = -1;
      this.resetFilters();
      return true;
    } catch (err) {
      console.warn('Webcam unavailable:', err.message);
      this.lastError = err.message;
      this.isCameraRunning = false;
      this.useSynthetic = true;
      return false;
    }
  }

  stopCamera() {
    if (this.currentStream) {
      try {
        this.currentStream.getTracks().forEach(t => t.stop());
      } catch (_) {}
      this.currentStream = null;
    }
    this.isCameraRunning = false;
  }

  /**
   * Initialize MediaPipe PoseLandmarker from local ./wasm and ./models bundles.
   * Works 100% offline inside Electron standalone executable.
   */
  async initMediaPipe() {
    if (this.isModelReady || this.isModelLoading) return this.isModelReady;
    this.isModelLoading = true;

    try {
      const wasmFileset = await FilesetResolver.forVisionTasks('./wasm');

      try {
        this.poseLandmarker = await PoseLandmarker.createFromOptions(wasmFileset, {
          baseOptions: {
            modelAssetPath: './models/pose_landmarker_lite.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.45,
          minPosePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
          outputSegmentationMasks: true
        });
        this.delegateUsed = 'GPU';
      } catch (gpuErr) {
        console.warn('MediaPipe GPU delegate unavailable, falling back to CPU delegate:', gpuErr);
        this.poseLandmarker = await PoseLandmarker.createFromOptions(wasmFileset, {
          baseOptions: {
            modelAssetPath: './models/pose_landmarker_lite.task',
            delegate: 'CPU'
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.45,
          minPosePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
          outputSegmentationMasks: true
        });
        this.delegateUsed = 'CPU';
      }

      this.isModelReady = true;
      this.isModelLoading = false;
      console.log(`MediaPipe PoseLandmarker ready (${this.delegateUsed} delegate).`);
      return true;
    } catch (err) {
      console.error('Failed to initialize local MediaPipe PoseLandmarker:', err);
      this.lastError = `AI Vision load failed: ${err.message}`;
      this.isModelLoading = false;
      this.isModelReady = false;
      return false;
    }
  }

  update(timestampMs) {
    const timestampSec = timestampMs * 0.001;
    const dt = this.prevTimestampSec !== null ? Math.max(0.004, Math.min(0.1, timestampSec - this.prevTimestampSec)) : 0.016;
    this.prevTimestampSec = timestampSec;

    if (this.useSynthetic || !this.isCameraRunning || !this.poseLandmarker) {
      return this.generateSyntheticDancer(timestampSec, dt);
    }

    if (this.video && this.video.readyState >= 2) {
      const videoTime = this.video.currentTime;
      if (videoTime !== this.lastVideoTime) {
        this.lastVideoTime = videoTime;
        try {
          const result = this.poseLandmarker.detectForVideo(this.video, performance.now());

          if (result.landmarks && result.landmarks.length > 0) {
            const rawPose = result.landmarks[0];
            const smoothed = new Array(33);
            const velocities = new Array(33);
            let visibleCount = 0;

            for (let i = 0; i < 33; i++) {
              const pt = rawPose[i];
              const nx = this.mirrorX ? (1.0 - pt.x) : pt.x;
              const ny = pt.y;
              const nz = pt.z;
              const vis = pt.visibility !== undefined ? pt.visibility : 1.0;
              if (vis > 0.35) visibleCount++;

              const f = this.poseFilters[i].filter([nx, ny, nz], timestampSec);
              smoothed[i] = [f[0], f[1], f[2], vis];

              if (this.prevLandmarks && this.prevLandmarks[i]) {
                const vx = (f[0] - this.prevLandmarks[i][0]) / dt;
                const vy = (f[1] - this.prevLandmarks[i][1]) / dt;
                velocities[i] = [vx, vy, Math.hypot(vx, vy)];
              } else {
                velocities[i] = [0, 0, 0];
              }
            }

            this.prevLandmarks = smoothed;
            this.trackingData.landmarks = smoothed;
            this.trackingData.velocities = velocities;
            this.trackingData.leftHand = smoothed[19] ? [smoothed[19][0], smoothed[19][1]] : [smoothed[15][0], smoothed[15][1]];
            this.trackingData.rightHand = smoothed[20] ? [smoothed[20][0], smoothed[20][1]] : [smoothed[16][0], smoothed[16][1]];
            this.trackingData.detectedJointsCount = visibleCount;
            this.trackingData.isTracking = true;
            this.trackingData.source = 'webcam';

            if (result.segmentationMasks && result.segmentationMasks.length > 0) {
              this.extractSegmentationMask(result.segmentationMasks[0]);
            }
          } else {
            this.trackingData.isTracking = false;
            this.trackingData.detectedJointsCount = 0;
            this.trackingData.hasMask = false;
            this.trackingData.source = 'webcam';
          }
        } catch (err) {
          console.warn('Pose detection frame error:', err);
        }
      }
    }

    return this.trackingData;
  }

  extractSegmentationMask(segMask) {
    try {
      const mW = segMask.width;
      const mH = segMask.height;
      const conf = segMask.getAsFloat32Array();

      const dW = this.maskWidth;
      const dH = this.maskHeight;
      const imgData = this.maskImageData.data;

      for (let dy = 0; dy < dH; dy++) {
        const sy = Math.min(mH - 1, Math.floor((dy / dH) * mH));
        for (let dx = 0; dx < dW; dx++) {
          const sxNorm = this.mirrorX ? (1.0 - (dx + 0.5) / dW) : ((dx + 0.5) / dW);
          const sx = Math.min(mW - 1, Math.max(0, Math.floor(sxNorm * mW)));
          const c = conf[sy * mW + sx];
          // Soft-feather edge around 0.45 confidence
          const alpha = Math.max(0, Math.min(255, Math.round(((c - 0.35) / 0.3) * 255)));

          const outIdx = dy * dW + dx;
          this.maskAlphaBuffer[outIdx] = alpha;
          const px = outIdx * 4;
          imgData[px + 0] = 255;
          imgData[px + 1] = 255;
          imgData[px + 2] = 255;
          imgData[px + 3] = alpha;
        }
      }

      this.maskCtx.putImageData(this.maskImageData, 0, 0);
      this.trackingData.hasMask = true;
    } catch (e) {
      this.trackingData.hasMask = false;
    } finally {
      try {
        if (typeof segMask.close === 'function') segMask.close();
      } catch (_) {}
    }
  }

  /**
   * Realistic 33-point contemporary dancer choreography + synthetic silhouette mask
   * for single-screen rehearsal and camera-free previewing.
   */
  generateSyntheticDancer(t, dt) {
    const swayX = Math.sin(t * 0.85) * 0.07;
    const bounceY = Math.abs(Math.sin(t * 1.7)) * 0.035;
    const cx = 0.5 + swayX;
    const hipY = 0.55 - bounceY;
    const shoulderY = 0.34 - bounceY;
    const headY = 0.21 - bounceY;

    const shoulderTilt = Math.sin(t * 1.1) * 0.02;
    const lShoulder = [cx - 0.085, shoulderY - shoulderTilt, 0, 1];
    const rShoulder = [cx + 0.085, shoulderY + shoulderTilt, 0, 1];

    // Expressive contemporary dance arm arcs
    const lArmAngle = Math.sin(t * 1.9) * 1.2 - 0.3;
    const lForeAngle = lArmAngle + Math.sin(t * 2.7) * 0.85;
    const lElbow = [
      lShoulder[0] - Math.cos(lArmAngle) * 0.11,
      lShoulder[1] + Math.sin(lArmAngle) * 0.11,
      -0.05, 1
    ];
    const lWrist = [
      lElbow[0] - Math.cos(lForeAngle) * 0.11,
      lElbow[1] + Math.sin(lForeAngle) * 0.11,
      -0.1, 1
    ];

    const rArmAngle = Math.cos(t * 1.6) * 1.15 - 0.2;
    const rForeAngle = rArmAngle + Math.cos(t * 2.3) * 0.9;
    const rElbow = [
      rShoulder[0] + Math.cos(rArmAngle) * 0.11,
      rShoulder[1] + Math.sin(rArmAngle) * 0.11,
      -0.05, 1
    ];
    const rWrist = [
      rElbow[0] + Math.cos(rForeAngle) * 0.11,
      rElbow[1] + Math.sin(rForeAngle) * 0.11,
      -0.1, 1
    ];

    const lHip = [cx - 0.06, hipY, 0, 1];
    const rHip = [cx + 0.06, hipY, 0, 1];

    const stride = Math.sin(t * 1.7) * 0.04;
    const lKnee = [cx - 0.075 - stride * 0.5, 0.72 - bounceY * 0.5, -0.02, 1];
    const rKnee = [cx + 0.075 + stride * 0.5, 0.72 - bounceY * 0.5, -0.02, 1];
    const lAnkle = [cx - 0.08 - stride, 0.89, 0, 1];
    const rAnkle = [cx + 0.08 + stride, 0.89, 0, 1];

    const landmarks = Array.from({ length: 33 }, () => [cx, shoulderY, 0, 0.9]);
    // Face & head (0..10)
    landmarks[0] = [cx + swayX * 0.2, headY, -0.05, 1];
    landmarks[2] = [cx - 0.015, headY - 0.01, -0.06, 1];
    landmarks[5] = [cx + 0.015, headY - 0.01, -0.06, 1];
    landmarks[7] = [cx - 0.032, headY, -0.03, 1];
    landmarks[8] = [cx + 0.032, headY, -0.03, 1];
    landmarks[9] = [cx - 0.01, headY + 0.015, -0.05, 1];
    landmarks[10] = [cx + 0.01, headY + 0.015, -0.05, 1];

    // Upper body
    landmarks[11] = lShoulder;
    landmarks[12] = rShoulder;
    landmarks[13] = lElbow;
    landmarks[14] = rElbow;
    landmarks[15] = lWrist;
    landmarks[16] = rWrist;
    // Fingers
    landmarks[17] = [lWrist[0] - 0.015, lWrist[1] + 0.015, -0.1, 1];
    landmarks[19] = [lWrist[0] - 0.02, lWrist[1] - 0.01, -0.1, 1];
    landmarks[21] = [lWrist[0] - 0.005, lWrist[1] - 0.02, -0.1, 1];
    landmarks[18] = [rWrist[0] + 0.015, rWrist[1] + 0.015, -0.1, 1];
    landmarks[20] = [rWrist[0] + 0.02, rWrist[1] - 0.01, -0.1, 1];
    landmarks[22] = [rWrist[0] + 0.005, rWrist[1] - 0.02, -0.1, 1];

    // Lower body
    landmarks[23] = lHip;
    landmarks[24] = rHip;
    landmarks[25] = lKnee;
    landmarks[26] = rKnee;
    landmarks[27] = lAnkle;
    landmarks[28] = rAnkle;
    landmarks[29] = [lAnkle[0], lAnkle[1] + 0.02, 0.02, 1];
    landmarks[30] = [rAnkle[0], rAnkle[1] + 0.02, 0.02, 1];
    landmarks[31] = [lAnkle[0] - 0.02, lAnkle[1] + 0.03, -0.04, 1];
    landmarks[32] = [rAnkle[0] + 0.02, rAnkle[1] + 0.03, -0.04, 1];

    const velocities = new Array(33);
    for (let i = 0; i < 33; i++) {
      if (this.prevLandmarks && this.prevLandmarks[i]) {
        const vx = (landmarks[i][0] - this.prevLandmarks[i][0]) / dt;
        const vy = (landmarks[i][1] - this.prevLandmarks[i][1]) / dt;
        velocities[i] = [vx, vy, Math.hypot(vx, vy)];
      } else {
        velocities[i] = [0, 0, 0];
      }
    }
    this.prevLandmarks = landmarks;

    // Draw articulated synthetic dancer silhouette onto maskCanvas so Body-Locked Mask works in rehearsal!
    const ctx = this.maskCtx;
    const w = this.maskWidth;
    const h = this.maskHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Head
    ctx.beginPath();
    ctx.arc(landmarks[0][0] * w, landmarks[0][1] * h, w * 0.036, 0, Math.PI * 2);
    ctx.fill();

    // Torso quad
    ctx.beginPath();
    ctx.moveTo(lShoulder[0] * w, lShoulder[1] * h);
    ctx.lineTo(rShoulder[0] * w, rShoulder[1] * h);
    ctx.lineTo(rHip[0] * w, rHip[1] * h);
    ctx.lineTo(lHip[0] * w, lHip[1] * h);
    ctx.closePath();
    ctx.fill();

    // Limbs
    const limbPairs = [
      [11, 13, 0.026], [13, 15, 0.022],
      [12, 14, 0.026], [14, 16, 0.022],
      [23, 25, 0.034], [25, 27, 0.026],
      [24, 26, 0.034], [26, 28, 0.026]
    ];
    for (const [a, b, r] of limbPairs) {
      ctx.lineWidth = w * r;
      ctx.beginPath();
      ctx.moveTo(landmarks[a][0] * w, landmarks[a][1] * h);
      ctx.lineTo(landmarks[b][0] * w, landmarks[b][1] * h);
      ctx.stroke();
    }

    const rawBytes = ctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < w * h; i++) {
      this.maskAlphaBuffer[i] = rawBytes[i * 4 + 3];
    }

    this.trackingData.landmarks = landmarks;
    this.trackingData.velocities = velocities;
    this.trackingData.leftHand = [lWrist[0], lWrist[1]];
    this.trackingData.rightHand = [rWrist[0], rWrist[1]];
    this.trackingData.detectedJointsCount = 33;
    this.trackingData.isTracking = true;
    this.trackingData.hasMask = true;
    this.trackingData.source = 'synthetic';

    return this.trackingData;
  }
}
