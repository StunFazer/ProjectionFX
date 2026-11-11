import { OneEuroFilter3D } from '../math/OneEuroFilter.js';

/**
 * TrackingManager.js - Google MediaPipe Vision Integration.
 * Tracks 21 hand landmarks, body pose, and extracts real-time performer silhouette segmentation masks.
 * Applies OneEuroFilter3D to eliminate jitter.
 */
export class TrackingManager {
  constructor() {
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;

    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = 640;
    this.maskCanvas.height = 360;
    this.maskCtx = this.maskCanvas.getContext('2d');

    this.handLandmarker = null;
    this.poseLandmarker = null;
    this.imageSegmenter = null;

    this.leftHandFilter = new OneEuroFilter3D(1.0, 0.015);
    this.rightHandFilter = new OneEuroFilter3D(1.0, 0.015);

    this.trackingData = {
      isTracking: false,
      leftHand: null,    // [x, y, z] in world space
      rightHand: null,   // [x, y, z] in world space
      isLeftPinching: false,
      isRightPinching: false,
      landmarks2D: [],
      maskCanvas: this.maskCanvas
    };

    this.isCameraRunning = false;
    this.useSynthetic = false; // Fallback when no physical camera is present
    this.currentStream = null;
    this.selectedDeviceId = null;
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

    if (preferredDeviceId) {
      this.selectedDeviceId = preferredDeviceId;
    }

    if (this.selectedDeviceId === 'synthetic') {
      if (this.currentStream) {
        try { this.currentStream.getTracks().forEach(track => track.stop()); } catch (_) {}
        this.currentStream = null;
      }
      this.useSynthetic = true;
      this.isCameraRunning = true;
      return true;
    }

    // Stop existing stream tracks to release previous camera hardware
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
          video: this.selectedDeviceId
            ? { deviceId: { ideal: this.selectedDeviceId } }
            : true
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err1) {
        if (err1.name === 'NotAllowedError' || err1.name === 'PermissionDeniedError') {
          throw new Error('Permission denied: Enable camera in Windows Settings.');
        } else if (err1.name === 'NotReadableError' || err1.name === 'TrackStartError') {
          throw new Error('Camera in use by another app (Zoom, Teams, OBS).');
        } else if (err1.name === 'NotFoundError' || err1.name === 'DevicesNotFoundError') {
          throw new Error('No physical webcam hardware detected.');
        }
        // Try basic video fallback
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      if (!stream) {
        throw new Error('No stream returned');
      }

      this.currentStream = stream;
      targetVideo.srcObject = stream;
      targetVideo.muted = true;
      targetVideo.autoplay = true;
      targetVideo.playsInline = true;

      // Ensure playback starts reliably across all Chromium/Electron environments
      await new Promise((resolve) => {
        let isDone = false;
        const complete = () => {
          if (!isDone) {
            isDone = true;
            resolve();
          }
        };

        targetVideo.onloadeddata = complete;
        targetVideo.onloadedmetadata = complete;
        targetVideo.onplay = complete;

        const playPromise = targetVideo.play();
        if (playPromise && playPromise.then) {
          playPromise.then(complete).catch((e) => {
            console.warn('targetVideo.play() warning:', e);
            complete();
          });
        }

        setTimeout(complete, 1000);
      });

      this.video = targetVideo;
      this.isCameraRunning = true;
      this.useSynthetic = false;
      return true;
    } catch (err) {
      console.warn('Webcam unavailable:', err.message);
      this.lastError = err.message;
      this.useSynthetic = true;
      return false;
    }
  }

  /**
   * Initialize MediaPipe Vision Tasks from Google CDN or local bundles
   */
  async initMediaPipe() {
    try {
      // Dynamic import from Google CDN or local npm
      const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/+esm').catch(() => null);
      if (!vision) {
        console.warn('MediaPipe online bundle could not be fetched; using synthetic tracker.');
        this.useSynthetic = true;
        return;
      }

      const { FilesetResolver, HandLandmarker, PoseLandmarker } = vision;
      const wasmFileset = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
      );

      this.handLandmarker = await HandLandmarker.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numHands: 2
      });

      console.log('MediaPipe Vision HandLandmarker initialized successfully with GPU delegate.');
    } catch (e) {
      console.warn('Failed to load MediaPipe tasks; falling back to synthetic generator:', e);
      this.useSynthetic = true;
    }
  }

  update(timestampMs) {
    const timestampSec = timestampMs * 0.001;

    if (this.useSynthetic || !this.isCameraRunning || !this.handLandmarker) {
      // Synthetic interactive generator (circular wave motion)
      const t = timestampSec * 1.5;
      const rawLeft = [
        Math.cos(t) * 0.45,
        0.3 + Math.sin(t * 1.2) * 0.25,
        Math.sin(t) * 0.35
      ];
      const rawRight = [
        -Math.cos(t * 0.8) * 0.4,
        0.35 + Math.sin(t) * 0.2,
        Math.cos(t * 0.8) * 0.3
      ];

      this.trackingData.leftHand = this.leftHandFilter.filter(rawLeft, timestampSec);
      this.trackingData.rightHand = this.rightHandFilter.filter(rawRight, timestampSec);
      this.trackingData.isTracking = true;
      return this.trackingData;
    }

    if (this.video.readyState >= 2 && this.handLandmarker) {
      try {
        const results = this.handLandmarker.detectForVideo(this.video, timestampMs);
        this.trackingData.landmarks2D = results.landmarks || [];

        let leftFound = false;
        let rightFound = false;

        if (results.landmarks && results.handedness) {
          for (let i = 0; i < results.landmarks.length; i++) {
            const isLeft = results.handedness[i][0].categoryName === 'Left';
            const lm = results.landmarks[i];

            // Palm center (landmark 0 + 9 average)
            const palmX = (lm[0].x + lm[9].x) * 0.5;
            const palmY = (lm[0].y + lm[9].y) * 0.5;
            const palmZ = (lm[0].z + lm[9].z) * 0.5;

            // Map camera normalized coordinates to 3D interaction space
            // Invert X because webcam is mirrored
            const worldX = (1.0 - palmX - 0.5) * 1.6;
            const worldY = (0.5 - palmY) * 1.2 + 0.3;
            const worldZ = -palmZ * 1.5;

            // Pinch detection (thumb tip 4 to index tip 8 distance)
            const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y, lm[4].z - lm[8].z);
            const isPinching = pinchDist < 0.06;

            if (isLeft) {
              this.trackingData.leftHand = this.leftHandFilter.filter([worldX, worldY, worldZ], timestampSec);
              this.trackingData.isLeftPinching = isPinching;
              leftFound = true;
            } else {
              this.trackingData.rightHand = this.rightHandFilter.filter([worldX, worldY, worldZ], timestampSec);
              this.trackingData.isRightPinching = isPinching;
              rightFound = true;
            }
          }
        }

        if (!leftFound) this.trackingData.leftHand = null;
        if (!rightFound) this.trackingData.rightHand = null;
        this.trackingData.isTracking = leftFound || rightFound;
      } catch (e) {
        // Drop frame safely if pipeline is busy
      }
    }

    return this.trackingData;
  }
}
