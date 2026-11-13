/**
 * StageProjectionEngine.js - Real-Time Interactive Stage Projection Synthesizer
 * Renders Laser Skeletons, Elastic Silk Light Ribbons, Geometric Cyber Webbing,
 * Ethereal Aura Halos, Velocity Burst Particles, and Motion Echo Duets mapped directly
 * onto a live performer via Camera-to-Projector Homography & Silhouette Masking.
 */

export const SCENE_PRESETS = [
  { id: 'laser-skeleton', key: '1', name: 'Cyber Laser Skeleton', desc: '33-point neon bone vectors, contour outline & joint reticles' },
  { id: 'silk-ribbons',   key: '2', name: 'Silk Light Ribbons',   desc: 'Continuous elastic light-painting ribbons trailing limbs' },
  { id: 'cyber-webbing',  key: '3', name: 'Geometric Cyber Webbing', desc: 'Dynamic faceted triangulation & reactive proximity chords' },
  { id: 'aura-halo',      key: '4', name: 'Ethereal Aura Halo',   desc: 'Breathing silhouette contour halo & drifting aura particles' },
  { id: 'supernova',      key: '5', name: 'Cosmic Supernova',     desc: 'Full spectacle: skeleton, webbing, ribbons & velocity bursts' },
  { id: 'motion-echo',    key: '6', name: 'Motion Echo Duet',     desc: 'Time-offset holographic ghost dancers trailing movement' }
];

export const COLOR_THEMES = {
  'laser-cyan': {
    name: 'Laser White & Cyan',
    primary: '#00f0ff',
    secondary: '#3b82f6',
    accent: '#a5f3fc',
    core: '#ffffff',
    rgbPrimary: [0, 240, 255],
    rgbSecondary: [59, 130, 246]
  },
  'neon-cyberpunk': {
    name: 'Neon Cyberpunk',
    primary: '#ff2a85',
    secondary: '#9d4edd',
    accent: '#00f5d4',
    core: '#ffe6f3',
    rgbPrimary: [255, 42, 133],
    rgbSecondary: [157, 78, 221]
  },
  'ethereal-spirit': {
    name: 'Ethereal Spirit',
    primary: '#10b981',
    secondary: '#06b6d4',
    accent: '#a7f3d0',
    core: '#ecfdf5',
    rgbPrimary: [16, 185, 129],
    rgbSecondary: [6, 182, 212]
  },
  'golden-fire': {
    name: 'Golden Fire',
    primary: '#f59e0b',
    secondary: '#ef4444',
    accent: '#fde047',
    core: '#fffbeb',
    rgbPrimary: [245, 158, 11],
    rgbSecondary: [239, 68, 68]
  }
};

// Standard MediaPipe Pose skeletal bone pairs
const POSE_BONES = [
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left Arm
  [11, 13], [13, 15], [15, 19], [15, 17],
  // Right Arm
  [12, 14], [14, 16], [16, 20], [16, 18],
  // Left Leg
  [23, 25], [25, 27], [27, 29], [27, 31],
  // Right Leg
  [24, 26], [26, 28], [28, 30], [28, 32]
];

// Anatomical facet triangles for Geometric Cyber Webbing
const CYBER_TRIANGLES = [
  [0, 11, 12],       // Neck / Upper Chest
  [11, 12, 23],      // Upper Torso L
  [12, 24, 23],      // Lower Torso R
  [11, 13, 23],      // Left Rib Wing
  [12, 14, 24],      // Right Rib Wing
  [13, 15, 11],      // Left Arm Triangle
  [14, 16, 12],      // Right Arm Triangle
  [23, 25, 24],      // Left Pelvis Wing
  [24, 26, 23],      // Right Pelvis Wing
  [15, 23, 25],      // Left Hand-Leg Kinetic Span
  [16, 24, 26]       // Right Hand-Leg Kinetic Span
];

const RIBBON_ANCHOR_INDICES = [15, 16, 13, 14, 27, 28, 0];

export class StageProjectionEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });

    // Offscreen compositor canvas for clean Body-Locked Stencil masking
    this.fxCanvas = document.createElement('canvas');
    this.fxCtx = this.fxCanvas.getContext('2d');

    this.width = 1920;
    this.height = 1080;
    this.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720);

    // Performance state
    this.activePreset = 'laser-skeleton';
    this.themeId = 'laser-cyan';
    this.bodyLockedMask = false; // false = Stage Immersion, true = Body-Locked Stencil
    this.blackout = false;
    this.calibGridActive = false;
    this.calibFlashWhite = false;

    // Effect parameters (customizable via Operator sliders)
    this.params = {
      glowIntensity: 1.0,    // 0.2 .. 2.0
      lineWeight: 1.0,       // 0.4 .. 2.5
      ribbonPersistence: 0.7,// 0.1 .. 1.0
      burstSensitivity: 1.0  // 0.0 .. 2.5
    };

    // Elastic Light Ribbons state: map of jointIndex -> array of trail nodes
    this.ribbons = new Map();
    for (const idx of RIBBON_ANCHOR_INDICES) {
      this.ribbons.set(idx, []);
    }

    // Burst / Aura particles pool
    this.particles = [];
    this.maxParticles = 600;

    // Motion Echo ring buffer
    this.echoHistory = [];
    this.maxEchoFrames = 48;
  }

  resize(width, height) {
    const w = Math.max(320, Math.floor(width));
    const h = Math.max(240, Math.floor(height));
    if (this.width === w && this.height === h) return;

    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.fxCanvas.width = w;
    this.fxCanvas.height = h;
  }

  setPreset(presetId) {
    if (SCENE_PRESETS.some(p => p.id === presetId)) {
      this.activePreset = presetId;
    }
  }

  setTheme(themeId) {
    if (COLOR_THEMES[themeId]) {
      this.themeId = themeId;
    }
  }

  cycleTheme() {
    const keys = Object.keys(COLOR_THEMES);
    const idx = keys.indexOf(this.themeId);
    this.themeId = keys[(idx + 1) % keys.length];
    return this.themeId;
  }

  /**
   * Main 60fps render entry point.
   * @param {Object} poseData - { landmarks, velocities, hasMask, maskAlpha, maskWidth, maskHeight }
   * @param {StageCalibrator} calibrator
   * @param {Object|null} underlay - { video, mirrorX, opacity } for Operator Console Monitor ONLY
   * @param {number} dt - delta time seconds
   * @param {number} timeSec - elapsed time seconds
   */
  render(poseData, calibrator, underlay = null, dt = 0.016, timeSec = 0) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // 1. Background (Pitch-black on stage projector; optional faint camera monitor on console)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    if (underlay && underlay.video && underlay.video.readyState >= 2 && underlay.opacity > 0.01) {
      ctx.save();
      ctx.globalAlpha = underlay.opacity;
      if (underlay.mirrorX) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(underlay.video, 0, 0, w, h);
      ctx.restore();
    }

    // 2. Auto-Align White Flash Frame
    if (this.calibFlashWhite) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      return;
    }

    // 3. Instant Stage Blackout
    if (this.blackout) {
      if (this.calibGridActive) this.drawCalibrationGrid(ctx, w, h);
      return;
    }

    // 4. Transform landmarks from camera normalized coords -> projector pixel coords
    const landmarks = poseData && poseData.landmarks && poseData.landmarks.length === 33
      ? poseData.landmarks
      : null;

    let projPts = null;
    if (landmarks && poseData.isTracking) {
      projPts = new Array(33);
      for (let i = 0; i < 33; i++) {
        const lm = landmarks[i];
        const [px, py] = calibrator.camToProj(lm[0], lm[1]);
        const vel = poseData.velocities && poseData.velocities[i] ? poseData.velocities[i] : [0, 0, 0];
        projPts[i] = {
          x: px * w,
          y: py * h,
          nx: px,
          ny: py,
          vis: lm[3] !== undefined ? lm[3] : 1.0,
          vx: vel[0] * w,
          vy: vel[1] * h,
          speed: vel[2]
        };
      }
    }

    // Prepare warped silhouette mask canvas if needed by Body-Locked Mask OR Aura/Contour presets
    let warpedMaskCanvas = null;
    const needsMask = poseData && poseData.hasMask && (
      this.bodyLockedMask ||
      this.activePreset === 'laser-skeleton' ||
      this.activePreset === 'aura-halo' ||
      this.activePreset === 'supernova'
    );
    if (needsMask) {
      warpedMaskCanvas = calibrator.getWarpedMaskCanvas(
        poseData.maskAlpha,
        poseData.maskWidth,
        poseData.maskHeight
      );
    }

    // 5. Render effects onto clean offscreen fxCanvas
    const fx = this.fxCtx;
    fx.clearRect(0, 0, w, h);
    fx.save();

    const theme = COLOR_THEMES[this.themeId] || COLOR_THEMES['laser-cyan'];

    // Update persistent simulation systems (ribbons, particles, echoes)
    this.updateRibbons(projPts, dt, timeSec);
    this.updateParticles(projPts, warpedMaskCanvas, poseData, calibrator, dt, timeSec, theme);
    this.updateEchoHistory(projPts);

    if (projPts) {
      switch (this.activePreset) {
        case 'laser-skeleton':
          if (warpedMaskCanvas) this.drawSilhouetteContour(fx, warpedMaskCanvas, theme, 0.55);
          this.drawCyberSkeleton(fx, projPts, theme, timeSec, 1.0);
          break;

        case 'silk-ribbons':
          this.drawRibbons(fx, theme, 1.25);
          this.drawMinimalJointAnchors(fx, projPts, theme, timeSec);
          break;

        case 'cyber-webbing':
          this.drawCyberWebbing(fx, projPts, theme, timeSec);
          this.drawCyberSkeleton(fx, projPts, theme, timeSec, 0.75);
          break;

        case 'aura-halo':
          if (warpedMaskCanvas) {
            this.drawBreathingAuraHalo(fx, warpedMaskCanvas, theme, timeSec);
          }
          this.drawParticles(fx, theme);
          this.drawMinimalJointAnchors(fx, projPts, theme, timeSec);
          break;

        case 'supernova':
          if (warpedMaskCanvas) this.drawSilhouetteContour(fx, warpedMaskCanvas, theme, 0.45);
          this.drawCyberWebbing(fx, projPts, theme, timeSec, 0.6);
          this.drawRibbons(fx, theme, 1.0);
          this.drawParticles(fx, theme);
          this.drawCyberSkeleton(fx, projPts, theme, timeSec, 1.0);
          break;

        case 'motion-echo':
          this.drawMotionEchoes(fx, theme);
          this.drawRibbons(fx, theme, 0.65);
          this.drawCyberSkeleton(fx, projPts, theme, timeSec, 1.0);
          break;
      }
    }

    // 6. Apply Body-Locked Silhouette Stencil Mask if toggled ON (M key)
    if (this.bodyLockedMask && warpedMaskCanvas) {
      fx.globalCompositeOperation = 'destination-in';
      fx.drawImage(warpedMaskCanvas, 0, 0, w, h);
      fx.globalCompositeOperation = 'source-over';
    }

    fx.restore();

    // Composite fxCanvas onto main projector / monitor canvas
    ctx.drawImage(this.fxCanvas, 0, 0);

    // 7. Calibration Alignment Grid Overlay (C key)
    if (this.calibGridActive) {
      this.drawCalibrationGrid(ctx, w, h);
    }
  }

  /* =========================================================
     EFFECT RENDERERS
     ========================================================= */

  drawCyberSkeleton(ctx, pts, theme, timeSec, alphaScale = 1.0) {
    const glow = 14 * this.params.glowIntensity;
    const lw = 2.6 * this.params.lineWeight;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Spine central laser axis (nose -> mid-shoulder -> mid-hip)
    const midShoulder = {
      x: (pts[11].x + pts[12].x) * 0.5,
      y: (pts[11].y + pts[12].y) * 0.5
    };
    const midHip = {
      x: (pts[23].x + pts[24].x) * 0.5,
      y: (pts[23].y + pts[24].y) * 0.5
    };

    // Pass 1: Outer colored neon glow
    ctx.shadowColor = theme.primary;
    ctx.shadowBlur = glow;
    ctx.strokeStyle = theme.primary;
    ctx.globalAlpha = 0.85 * alphaScale;
    ctx.lineWidth = lw * 2.1;

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(midShoulder.x, midShoulder.y);
    ctx.lineTo(midHip.x, midHip.y);
    for (const [a, b] of POSE_BONES) {
      if (pts[a].vis > 0.25 && pts[b].vis > 0.25) {
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
      }
    }
    ctx.stroke();

    // Pass 2: White-hot crisp inner laser filament
    ctx.shadowBlur = 0;
    ctx.strokeStyle = theme.core;
    ctx.globalAlpha = 0.95 * alphaScale;
    ctx.lineWidth = lw * 0.85;
    ctx.stroke();

    // Pass 3: Joint Reticles & Velocity Rings
    const majorJoints = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
    for (const idx of majorJoints) {
      const p = pts[idx];
      if (p.vis < 0.25) continue;

      const isHandOrFoot = idx === 15 || idx === 16 || idx === 27 || idx === 28 || idx === 0;
      const velBoost = Math.min(14, p.speed * 10 * this.params.burstSensitivity);
      const baseR = (isHandOrFoot ? 10 : 6) * this.params.lineWeight + velBoost * 0.4;

      // Outer pulse ring
      ctx.strokeStyle = isHandOrFoot ? theme.accent : theme.secondary;
      ctx.lineWidth = 1.6 * this.params.lineWeight;
      ctx.globalAlpha = 0.85 * alphaScale;
      ctx.beginPath();
      ctx.arc(p.x, p.y, baseR, 0, Math.PI * 2);
      ctx.stroke();

      if (isHandOrFoot) {
        // Rotating cyber reticle ticks
        const rot = timeSec * 2.2 + idx;
        ctx.beginPath();
        ctx.arc(p.x, p.y, baseR * 1.65, rot, rot + Math.PI * 0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, baseR * 1.65, rot + Math.PI, rot + Math.PI * 1.7);
        ctx.stroke();
      }

      // Bright core dot
      ctx.fillStyle = theme.core;
      ctx.globalAlpha = 0.95 * alphaScale;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2.5, baseR * 0.35), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawMinimalJointAnchors(ctx, pts, theme, timeSec) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = theme.primary;
    ctx.shadowBlur = 12 * this.params.glowIntensity;

    const anchors = [0, 15, 16, 27, 28];
    for (const idx of anchors) {
      const p = pts[idx];
      if (!p || p.vis < 0.25) continue;
      const r = (7 + Math.sin(timeSec * 4 + idx) * 2) * this.params.lineWeight;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2 * this.params.lineWeight;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = theme.core;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawCyberWebbing(ctx, pts, theme, timeSec, opacityScale = 1.0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 1. Draw translucent glowing polygon facets across body triangles
    for (let tIdx = 0; tIdx < CYBER_TRIANGLES.length; tIdx++) {
      const [i0, i1, i2] = CYBER_TRIANGLES[tIdx];
      const p0 = pts[i0], p1 = pts[i1], p2 = pts[i2];
      if (!p0 || !p1 || !p2 || p0.vis < 0.2 || p1.vis < 0.2 || p2.vis < 0.2) continue;

      const pulse = 0.5 + 0.5 * Math.sin(timeSec * 2.5 + tIdx * 0.7);
      const [r, g, b] = tIdx % 2 === 0 ? theme.rgbPrimary : theme.rgbSecondary;

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(0.08 + pulse * 0.08) * opacityScale})`;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = tIdx % 2 === 0 ? theme.primary : theme.secondary;
      ctx.globalAlpha = (0.45 + pulse * 0.3) * opacityScale;
      ctx.lineWidth = 1.4 * this.params.lineWeight;
      ctx.stroke();
    }

    // 2. Dynamic Proximity Resonance Chords between key joints
    const webNodes = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
    const maxDist = Math.min(this.width, this.height) * 0.36;

    ctx.shadowColor = theme.accent;
    ctx.shadowBlur = 10 * this.params.glowIntensity;
    for (let a = 0; a < webNodes.length; a++) {
      for (let b = a + 1; b < webNodes.length; b++) {
        const pa = pts[webNodes[a]];
        const pb = pts[webNodes[b]];
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        if (d < maxDist && d > 8) {
          const strength = 1.0 - d / maxDist;
          ctx.strokeStyle = strength > 0.65 ? theme.core : theme.accent;
          ctx.globalAlpha = strength * 0.65 * opacityScale;
          ctx.lineWidth = (0.8 + strength * 2.2) * this.params.lineWeight;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  /* =========================================================
     SILK LIGHT RIBBONS
     ========================================================= */

  updateRibbons(pts, dt, timeSec) {
    const maxNodes = Math.max(8, Math.floor(10 + this.params.ribbonPersistence * 38));
    const maxAge = 0.3 + this.params.ribbonPersistence * 1.1;

    for (const idx of RIBBON_ANCHOR_INDICES) {
      const trail = this.ribbons.get(idx);
      // Age and curl-drift existing nodes
      for (let i = trail.length - 1; i >= 0; i--) {
        const node = trail[i];
        node.age += dt;
        // Organic silk drift
        const curlAngle = Math.sin(node.x * 0.008 + timeSec * 2.0) * 1.5;
        node.x += (node.vx * 0.14 + Math.cos(curlAngle) * 12) * dt;
        node.y += (node.vy * 0.14 + Math.sin(curlAngle) * 12 - 14) * dt;
        node.vx *= 0.94;
        node.vy *= 0.94;
        if (node.age > maxAge) {
          trail.splice(i, 1);
        }
      }

      if (pts && pts[idx] && pts[idx].vis > 0.25) {
        const p = pts[idx];
        const prev = trail[0];
        if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 2.5) {
          trail.unshift({
            x: p.x,
            y: p.y,
            vx: p.vx,
            vy: p.vy,
            age: 0,
            maxAge
          });
          if (trail.length > maxNodes) {
            trail.length = maxNodes;
          }
        }
      }
    }
  }

  drawRibbons(ctx, theme, intensity = 1.0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const glow = 16 * this.params.glowIntensity;
    let ribbonCounter = 0;

    for (const [, trail] of this.ribbons.entries()) {
      if (trail.length < 3) continue;
      ribbonCounter++;
      const color = ribbonCounter % 2 === 0 ? theme.secondary : theme.primary;

      // Draw multi-segment tapered ribbon using smooth midpoints
      for (let i = 0; i < trail.length - 2; i++) {
        const p0 = trail[i];
        const p1 = trail[i + 1];
        const p2 = trail[i + 2];
        const life = Math.max(0, 1.0 - i / trail.length);

        const midX1 = (p0.x + p1.x) * 0.5;
        const midY1 = (p0.y + p1.y) * 0.5;
        const midX2 = (p1.x + p2.x) * 0.5;
        const midY2 = (p1.y + p2.y) * 0.5;

        const wOuter = (2.0 + life * 13.0) * this.params.lineWeight * intensity;

        ctx.shadowColor = color;
        ctx.shadowBlur = glow * life;
        ctx.strokeStyle = color;
        ctx.globalAlpha = life * 0.65;
        ctx.lineWidth = wOuter;

        ctx.beginPath();
        ctx.moveTo(midX1, midY1);
        ctx.quadraticCurveTo(p1.x, p1.y, midX2, midY2);
        ctx.stroke();

        // Crisp bright inner silk core
        ctx.shadowBlur = 0;
        ctx.strokeStyle = theme.core;
        ctx.globalAlpha = life * 0.9;
        ctx.lineWidth = Math.max(1.0, wOuter * 0.25);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /* =========================================================
     SILHOUETTE CONTOUR & BREATHING AURA PARTICLES
     ========================================================= */

  drawSilhouetteContour(ctx, maskCanvas, theme, alpha = 0.7) {
    if (!this.contourCanvas) {
      this.contourCanvas = document.createElement('canvas');
      this.contourCanvas.width = 480;
      this.contourCanvas.height = 270;
      this.contourCtx = this.contourCanvas.getContext('2d');
    }

    const cw = this.contourCanvas.width;
    const ch = this.contourCanvas.height;
    const cCtx = this.contourCtx;

    cCtx.save();
    cCtx.clearRect(0, 0, cw, ch);
    cCtx.imageSmoothingEnabled = true;
    cCtx.imageSmoothingQuality = 'high';

    // 1. Softly dilated smooth silhouette base
    cCtx.filter = 'blur(2.5px)';
    const offsets = [[-2, 0], [2, 0], [0, -2], [0, 2], [-1.5, -1.5], [1.5, 1.5], [-1.5, 1.5], [1.5, -1.5]];
    for (const [ox, oy] of offsets) {
      cCtx.drawImage(maskCanvas, ox, oy, cw, ch);
    }

    // 2. Subtract inner body core to leave a smooth glowing contour rim
    cCtx.globalCompositeOperation = 'destination-out';
    cCtx.filter = 'blur(1px)';
    cCtx.drawImage(maskCanvas, 0, 0, cw, ch);

    // 3. Tint the extracted contour with the active Neon Theme color
    cCtx.globalCompositeOperation = 'source-in';
    cCtx.filter = 'none';
    cCtx.fillStyle = theme.primary;
    cCtx.fillRect(0, 0, cw, ch);
    cCtx.restore();

    // 4. Additive neon composite onto stage canvas
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, alpha * (0.75 + 0.25 * this.params.glowIntensity));
    ctx.shadowColor = theme.primary;
    ctx.shadowBlur = 12 * this.params.glowIntensity;
    ctx.drawImage(this.contourCanvas, 0, 0, this.width, this.height);
    ctx.restore();
  }

  drawBreathingAuraHalo(ctx, maskCanvas, theme, timeSec) {
    ctx.save();
    const w = this.width;
    const h = this.height;
    const pulse = 1.0 + Math.sin(timeSec * 2.2) * 0.025;

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25 * this.params.glowIntensity;
    ctx.filter = `blur(${Math.round(14 * this.params.glowIntensity)}px)`;

    // Draw scaled breathing mask glow
    ctx.translate(w * 0.5, h * 0.5);
    ctx.scale(pulse, pulse);
    ctx.translate(-w * 0.5, -h * 0.5);
    ctx.drawImage(maskCanvas, 0, 0, w, h);
    ctx.filter = 'none';
    ctx.restore();

    // Crisp illuminated edge contour
    this.drawSilhouetteContour(ctx, maskCanvas, theme, 0.9);
  }

  updateParticles(pts, maskCanvas, poseData, calibrator, dt, timeSec, theme) {
    // Emit velocity burst sparks from fast moving hands/feet/head
    if (pts && (this.activePreset === 'aura-halo' || this.activePreset === 'supernova')) {
      const burstJoints = [15, 16, 27, 28, 0];
      for (const idx of burstJoints) {
        const p = pts[idx];
        if (!p || p.vis < 0.25) continue;

        const spawnRate = this.activePreset === 'supernova'
          ? Math.min(8, Math.floor(p.speed * 14 * this.params.burstSensitivity))
          : Math.max(1, Math.floor(p.speed * 6 * this.params.burstSensitivity));

        for (let k = 0; k < spawnRate && this.particles.length < this.maxParticles; k++) {
          const angle = Math.random() * Math.PI * 2;
          const spd = 40 + Math.random() * 140 + p.speed * 180;
          this.particles.push({
            x: p.x + (Math.random() - 0.5) * 14,
            y: p.y + (Math.random() - 0.5) * 14,
            vx: p.vx * 0.25 + Math.cos(angle) * spd,
            vy: p.vy * 0.25 + Math.sin(angle) * spd - 20,
            size: 1.5 + Math.random() * 3.5,
            age: 0,
            maxAge: 0.45 + Math.random() * 0.85,
            isAccent: Math.random() > 0.55
          });
        }
      }
    }

    // Update particle physics
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.age += dt;
      if (pt.age >= pt.maxAge) {
        this.particles.splice(i, 1);
        continue;
      }
      const curl = Math.sin(pt.x * 0.01 + pt.y * 0.01 + timeSec * 3.0);
      pt.vx += Math.cos(curl * Math.PI) * 90 * dt;
      pt.vy += (Math.sin(curl * Math.PI) * 90 - 45) * dt;
      pt.vx *= 0.96;
      pt.vy *= 0.96;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
    }
  }

  drawParticles(ctx, theme) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const pt of this.particles) {
      const life = 1.0 - pt.age / pt.maxAge;
      ctx.fillStyle = pt.isAccent ? theme.accent : theme.primary;
      ctx.globalAlpha = life * 0.9;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * life * this.params.lineWeight, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* =========================================================
     MOTION ECHO DUET
     ========================================================= */

  updateEchoHistory(pts) {
    if (!pts) return;
    // Clone minimal pose positions
    const snap = pts.map(p => ({ x: p.x, y: p.y, vis: p.vis }));
    this.echoHistory.unshift(snap);
    if (this.echoHistory.length > this.maxEchoFrames) {
      this.echoHistory.length = this.maxEchoFrames;
    }
  }

  drawMotionEchoes(ctx, theme) {
    const offsets = [
      { idx: 38, color: theme.secondary, alpha: 0.24 },
      { idx: 26, color: theme.accent,    alpha: 0.38 },
      { idx: 14, color: theme.primary,   alpha: 0.56 }
    ];

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (const echo of offsets) {
      const ghost = this.echoHistory[echo.idx];
      if (!ghost) continue;

      ctx.strokeStyle = echo.color;
      ctx.globalAlpha = echo.alpha;
      ctx.lineWidth = 2.2 * this.params.lineWeight;
      ctx.shadowColor = echo.color;
      ctx.shadowBlur = 10 * this.params.glowIntensity;

      ctx.beginPath();
      for (const [a, b] of POSE_BONES) {
        if (ghost[a].vis > 0.25 && ghost[b].vis > 0.25) {
          ctx.moveTo(ghost[a].x, ghost[a].y);
          ctx.lineTo(ghost[b].x, ghost[b].y);
        }
      }
      ctx.stroke();

      // Ghost head halo
      ctx.beginPath();
      ctx.arc(ghost[0].x, ghost[0].y, 12 * this.params.lineWeight, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Echo bridge filaments connecting current hands to earliest echo hands
    const current = this.echoHistory[0];
    const earliest = this.echoHistory[Math.min(28, this.echoHistory.length - 1)];
    if (current && earliest) {
      ctx.strokeStyle = theme.accent;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1.4 * this.params.lineWeight;
      ctx.beginPath();
      for (const j of [0, 15, 16, 27, 28]) {
        ctx.moveTo(current[j].x, current[j].y);
        ctx.lineTo(earliest[j].x, earliest[j].y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  /* =========================================================
     CALIBRATION TEST PATTERN GRID
     ========================================================= */

  drawCalibrationGrid(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;

    // Outer Stage Boundary Frame
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // 8x6 Calibration Grid
    const cols = 8;
    const rows = 6;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
    ctx.beginPath();
    for (let c = 1; c < cols; c++) {
      const x = (c / cols) * w;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let r = 1; r < rows; r++) {
      const y = (r / rows) * h;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    // Diagonals
    ctx.moveTo(0, 0); ctx.lineTo(w, h);
    ctx.moveTo(w, 0); ctx.lineTo(0, h);
    ctx.stroke();

    // Center Stage Bullseye
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.5, 48, 0, Math.PI * 2);
    ctx.moveTo(w * 0.5 - 70, h * 0.5); ctx.lineTo(w * 0.5 + 70, h * 0.5);
    ctx.moveTo(w * 0.5, h * 0.5 - 70); ctx.lineTo(w * 0.5, h * 0.5 + 70);
    ctx.stroke();

    // High-Contrast Corner Fiducials
    const labels = [
      ['TL', 28, 36],
      ['TR', w - 58, 36],
      ['BR', w - 58, h - 24],
      ['BL', 28, h - 24]
    ];
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#00f0ff';
    for (const [txt, lx, ly] of labels) {
      ctx.fillText(txt, lx, ly);
    }
    ctx.restore();
  }
}
