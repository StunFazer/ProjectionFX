import { TrackingManager } from './tracking/TrackingManager.js';
import { StageCalibrator } from './calibration/StageCalibrator.js';
import {
  StageProjectionEngine,
  SCENE_PRESETS,
  COLOR_THEMES
} from './stage/StageProjectionEngine.js';
import { ChannelSync } from './sync/ChannelSync.js';

// Detect Console vs Projector Display 2 Window
const urlParams = new URLSearchParams(window.location.search);
const isProjectorMode = urlParams.get('mode') === 'projector';

if (isProjectorMode) {
  document.body.classList.add('projector-mode');
  document.title = 'ProjectionFX - Stage Projector Output';
}

// Core DOM elements
const container = document.getElementById('viewport-container');
const canvas = document.getElementById('stage-canvas');
const videoEl = document.getElementById('webcam-feed');

// Core Engine & Calibration instances
const engine = new StageProjectionEngine(canvas);
const calibrator = new StageCalibrator();
const tracker = isProjectorMode ? null : new TrackingManager();

// Electron IPC helper (gracefully falls back in standard browser)
function getIpcRenderer() {
  try {
    if (window.require) {
      const electron = window.require('electron');
      return electron?.ipcRenderer || null;
    }
  } catch (_) {}
  return null;
}

const ipc = getIpcRenderer();

// State shared between Console & Projector
let underlayOpacity = 0.35;
let isRehearsalMode = false;
let projectorConnected = false;
let externalProjectorWin = null;

// Latest synced pose frame used when running in Projector Display mode
const remotePoseData = {
  isTracking: false,
  source: 'synthetic',
  landmarks: [],
  velocities: [],
  hasMask: false,
  maskWidth: 160,
  maskHeight: 90,
  maskAlpha: null
};

// Cross-window BroadcastChannel synchronization
const sync = new ChannelSync(isProjectorMode, (msg) => {
  if (!msg || !msg.type) return;

  if (isProjectorMode) {
    if (msg.type === 'FULL_STATE' || msg.type === 'STATE_UPDATE') {
      const p = msg.payload || {};
      if (p.activePreset !== undefined) engine.setPreset(p.activePreset);
      if (p.themeId !== undefined) engine.setTheme(p.themeId);
      if (p.bodyLockedMask !== undefined) engine.bodyLockedMask = !!p.bodyLockedMask;
      if (p.blackout !== undefined) engine.blackout = !!p.blackout;
      if (p.calibGridActive !== undefined) engine.calibGridActive = !!p.calibGridActive;
      if (p.calibFlashWhite !== undefined) engine.calibFlashWhite = !!p.calibFlashWhite;
      if (p.params) Object.assign(engine.params, p.params);
      if (p.corners) calibrator.setCorners(p.corners);
    } else if (msg.type === 'CALIBRATION') {
      if (Array.isArray(msg.payload)) {
        calibrator.setCorners(msg.payload);
      }
    } else if (msg.type === 'FRAME_POSE') {
      const d = msg.payload;
      if (d) {
        remotePoseData.isTracking = !!d.isTracking;
        remotePoseData.source = d.source || 'synthetic';
        remotePoseData.landmarks = d.landmarks || [];
        remotePoseData.velocities = d.velocities || [];
        remotePoseData.hasMask = !!d.hasMask;
        remotePoseData.maskWidth = d.maskWidth || 160;
        remotePoseData.maskHeight = d.maskHeight || 90;
        if (d.maskAlpha) {
          remotePoseData.maskAlpha = d.maskAlpha;
        }
      }
    }
  } else {
    // Console Window incoming messages from Projector Display
    if (msg.type === 'PROJECTOR_HELLO') {
      projectorConnected = true;
      updateSyncStatusUI();
      sendFullState();
    } else if (msg.type === 'PROJECTOR_BYE') {
      projectorConnected = false;
      updateSyncStatusUI();
    }
  }
});

function sendFullState() {
  sync.send('FULL_STATE', {
    activePreset: engine.activePreset,
    themeId: engine.themeId,
    bodyLockedMask: engine.bodyLockedMask,
    blackout: engine.blackout,
    calibGridActive: engine.calibGridActive,
    calibFlashWhite: engine.calibFlashWhite,
    params: { ...engine.params },
    corners: calibrator.corners
  });
}

function updateSyncStatusUI() {
  const el = document.getElementById('stat-sync');
  if (!el) return;
  if (projectorConnected) {
    el.textContent = 'Display 2 Connected';
    el.style.color = 'var(--accent-cyan)';
  } else {
    el.textContent = 'Broadcast Ready';
    el.style.color = 'var(--accent-emerald)';
  }
}

// Viewport resizing (handles Console sidebar, Rehearsal fullscreen, and Projector Display)
function handleResize() {
  const w = (isProjectorMode || isRehearsalMode) ? window.innerWidth : (container?.clientWidth || window.innerWidth);
  const h = (isProjectorMode || isRehearsalMode) ? window.innerHeight : (container?.clientHeight || window.innerHeight);
  engine.resize(w, h);
}

window.addEventListener('resize', handleResize);
if (typeof ResizeObserver !== 'undefined' && container) {
  new ResizeObserver(() => handleResize()).observe(container);
}
handleResize();

/* =========================================================
   PROJECTOR MODE INITIALIZATION
   ========================================================= */
if (isProjectorMode) {
  sync.send('PROJECTOR_HELLO', {});
  window.addEventListener('beforeunload', () => {
    try { sync.send('PROJECTOR_BYE', {}); } catch (_) {}
  });
} else {
  setupConsoleUI();
}

/* =========================================================
   OPERATOR CONSOLE UI & WORKFLOWS
   ========================================================= */
function setupConsoleUI() {
  // 1. Sidebar Tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  function switchTab(tabId) {
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    tabPanes.forEach(p => p.classList.toggle('active', p.id === tabId));
  }
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 2. Populate Scene Preset Cards in Sidebar
  const sceneCardsList = document.getElementById('scene-cards-list');
  if (sceneCardsList) {
    sceneCardsList.innerHTML = '';
    for (const preset of SCENE_PRESETS) {
      const btn = document.createElement('button');
      btn.className = `scene-card-btn${preset.id === engine.activePreset ? ' active' : ''}`;
      btn.dataset.scene = preset.id;
      btn.innerHTML = `
        <span class="scene-card-key">${preset.key}</span>
        <span class="scene-card-info">
          <span class="scene-card-name">${preset.name}</span>
          <span class="scene-card-desc">${preset.desc}</span>
        </span>
      `;
      btn.addEventListener('click', () => selectScene(preset.id));
      sceneCardsList.appendChild(btn);
    }
  }

  // Wire Header Scene Strip Pills
  document.querySelectorAll('.scene-pill').forEach(pill => {
    pill.addEventListener('click', () => selectScene(pill.dataset.scene));
  });

  function selectScene(presetId) {
    const preset = SCENE_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    engine.setPreset(presetId);

    document.querySelectorAll('.scene-pill').forEach(el => {
      el.classList.toggle('active', el.dataset.scene === presetId);
    });
    document.querySelectorAll('.scene-card-btn').forEach(el => {
      el.classList.toggle('active', el.dataset.scene === presetId);
    });

    const statScene = document.getElementById('stat-scene');
    if (statScene) statScene.textContent = `Scene: ${preset.name}`;

    sync.send('STATE_UPDATE', { activePreset: presetId });
  }

  // 3. Color Themes
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => selectTheme(btn.dataset.theme));
  });

  function selectTheme(themeId) {
    const theme = COLOR_THEMES[themeId];
    if (!theme) return;
    engine.setTheme(themeId);

    document.querySelectorAll('.theme-btn').forEach(el => {
      el.classList.toggle('active', el.dataset.theme === themeId);
    });

    const statTheme = document.getElementById('stat-theme');
    if (statTheme) statTheme.textContent = `Theme: ${theme.name}`;

    sync.send('STATE_UPDATE', { themeId });
  }

  function cycleTheme() {
    const nextId = engine.cycleTheme();
    selectTheme(nextId);
  }

  // 4. Projection Boundary Mode (Stage Immersion vs Body-Locked Mask)
  const btnModeImmersion = document.getElementById('btn-mode-immersion');
  const btnModeBodyLocked = document.getElementById('btn-mode-bodylocked');
  const btnHdrMask = document.getElementById('btn-hdr-mask');
  const hudBoundary = document.getElementById('hud-boundary');

  function setBodyLockedMask(enabled) {
    engine.bodyLockedMask = !!enabled;
    btnModeImmersion?.classList.toggle('active', !engine.bodyLockedMask);
    btnModeBodyLocked?.classList.toggle('active', engine.bodyLockedMask);

    if (btnHdrMask) {
      btnHdrMask.textContent = engine.bodyLockedMask ? 'Mask: Body-Locked' : 'Mask: Immersion';
      btnHdrMask.classList.toggle('btn-active-cyan', engine.bodyLockedMask);
    }
    if (hudBoundary) {
      hudBoundary.textContent = engine.bodyLockedMask ? 'Body-Locked Mask' : 'Stage Immersion';
      hudBoundary.style.color = engine.bodyLockedMask ? 'var(--accent-cyan)' : 'var(--accent-emerald)';
    }

    sync.send('STATE_UPDATE', { bodyLockedMask: engine.bodyLockedMask });
  }

  btnModeImmersion?.addEventListener('click', () => setBodyLockedMask(false));
  btnModeBodyLocked?.addEventListener('click', () => setBodyLockedMask(true));
  btnHdrMask?.addEventListener('click', () => setBodyLockedMask(!engine.bodyLockedMask));

  // 5. Instant Stage Blackout
  const btnHdrBlackout = document.getElementById('btn-hdr-blackout');
  const btnOutBlackout = document.getElementById('btn-out-blackout');
  const blackoutBanner = document.getElementById('blackout-banner');

  function setBlackout(enabled) {
    engine.blackout = !!enabled;
    if (blackoutBanner) {
      blackoutBanner.style.display = engine.blackout ? 'block' : 'none';
    }
    if (btnHdrBlackout) {
      btnHdrBlackout.classList.toggle('btn-danger-active', engine.blackout);
      btnHdrBlackout.textContent = engine.blackout ? 'BLACKOUT ON' : 'Blackout';
    }
    if (btnOutBlackout) {
      btnOutBlackout.classList.toggle('btn-danger-active', engine.blackout);
      btnOutBlackout.textContent = engine.blackout
        ? '⬛ Restore Stage Light [Space]'
        : '⬛ Instant Stage Blackout [Space]';
    }
    sync.send('STATE_UPDATE', { blackout: engine.blackout });
  }

  btnHdrBlackout?.addEventListener('click', () => setBlackout(!engine.blackout));
  btnOutBlackout?.addEventListener('click', () => setBlackout(!engine.blackout));

  // 6. Single-Screen Rehearsal Fullscreen Mode
  const btnHdrRehearsal = document.getElementById('btn-hdr-rehearsal');
  const btnOutRehearsal = document.getElementById('btn-out-rehearsal');
  const rehearsalHint = document.getElementById('rehearsal-hint');

  function setRehearsalMode(enabled) {
    isRehearsalMode = !!enabled;
    document.body.classList.toggle('rehearsal-mode', isRehearsalMode);
    if (rehearsalHint) {
      rehearsalHint.style.display = isRehearsalMode ? 'block' : 'none';
    }
    btnHdrRehearsal?.classList.toggle('btn-active-cyan', isRehearsalMode);

    if (ipc) {
      ipc.send('set-fullscreen-console', isRehearsalMode);
    } else if (isRehearsalMode && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else if (!isRehearsalMode && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }

    handleResize();
    requestAnimationFrame(() => handleResize());
  }

  btnHdrRehearsal?.addEventListener('click', () => setRehearsalMode(!isRehearsalMode));
  btnOutRehearsal?.addEventListener('click', () => setRehearsalMode(!isRehearsalMode));

  // 7. Projector Output Display Launcher
  const btnOpenProjector = document.getElementById('btn-open-projector');
  const btnOutProjector = document.getElementById('btn-out-projector');

  function launchProjector() {
    if (ipc) {
      ipc.send('open-projector');
    } else {
      const baseUrl = window.location.href.split('?')[0];
      if (externalProjectorWin && !externalProjectorWin.closed) {
        externalProjectorWin.focus();
      } else {
        externalProjectorWin = window.open(
          `${baseUrl}?mode=projector`,
          'ProjectionFXProjector',
          'width=1280,height=720'
        );
      }
    }
  }

  btnOpenProjector?.addEventListener('click', launchProjector);
  btnOutProjector?.addEventListener('click', launchProjector);

  if (ipc) {
    ipc.on('projector-window-state', (_, isOpen) => {
      projectorConnected = !!isOpen;
      updateSyncStatusUI();
    });
  }

  // 8. Effect Parameter Sliders
  function bindSlider(sliderId, valId, paramKey, formatter = (v) => v.toFixed(2)) {
    const slider = document.getElementById(sliderId);
    const valEl = document.getElementById(valId);
    if (!slider) return;
    const apply = () => {
      const v = parseFloat(slider.value);
      engine.params[paramKey] = v;
      if (valEl) valEl.textContent = formatter(v);
      sync.send('STATE_UPDATE', { params: { [paramKey]: v } });
    };
    slider.addEventListener('input', apply);
  }

  bindSlider('slider-glow', 'val-glow', 'glowIntensity');
  bindSlider('slider-weight', 'val-weight', 'lineWeight');
  bindSlider('slider-ribbon', 'val-ribbon', 'ribbonPersistence');
  bindSlider('slider-burst', 'val-burst', 'burstSensitivity');

  // 9. Camera Hardware Input & MediaPipe Vision Initialization
  const cameraSelect = document.getElementById('camera-select');
  const btnToggleCamera = document.getElementById('btn-toggle-camera');
  const btnUseSynthetic = document.getElementById('btn-use-synthetic');
  const chkMirrorCam = document.getElementById('chk-mirror-cam');
  const valCameraStatus = document.getElementById('val-camera-status');
  const hudVision = document.getElementById('hud-vision');
  const hudDot = document.getElementById('hud-dot');
  const valMpStatus = document.getElementById('val-mp-status');
  const sliderUnderlay = document.getElementById('slider-underlay-opacity');
  const valUnderlay = document.getElementById('val-underlay-opacity');
  const sliderSmoothing = document.getElementById('slider-smoothing');
  const valSmoothing = document.getElementById('val-smoothing');

  function updateCameraStatusUI(errorMsg = null) {
    if (tracker.isCameraRunning && !tracker.useSynthetic) {
      if (valCameraStatus) {
        valCameraStatus.textContent = 'Live Webcam';
        valCameraStatus.style.color = 'var(--accent-emerald)';
      }
      if (hudVision) {
        hudVision.textContent = 'Live Camera + AI';
        hudVision.style.color = 'var(--accent-emerald)';
      }
      if (hudDot) hudDot.style.background = 'var(--accent-emerald)';
      if (btnToggleCamera) {
        btnToggleCamera.textContent = 'Disconnect Camera';
        btnToggleCamera.classList.remove('btn-primary');
        btnToggleCamera.classList.add('btn-success');
      }
    } else if (errorMsg) {
      if (valCameraStatus) {
        valCameraStatus.textContent = errorMsg;
        valCameraStatus.style.color = 'var(--accent-rose)';
      }
      if (hudVision) {
        hudVision.textContent = 'Synthetic (Fallback)';
        hudVision.style.color = 'var(--accent-amber)';
      }
      if (btnToggleCamera) {
        btnToggleCamera.textContent = 'Retry Webcam';
        btnToggleCamera.classList.add('btn-primary');
        btnToggleCamera.classList.remove('btn-success');
      }
    } else {
      if (valCameraStatus) {
        valCameraStatus.textContent = 'Synthetic Mode';
        valCameraStatus.style.color = 'var(--accent-cyan)';
      }
      if (hudVision) {
        hudVision.textContent = 'Synthetic Dancer';
        hudVision.style.color = 'var(--accent-cyan)';
      }
      if (btnToggleCamera) {
        btnToggleCamera.textContent = 'Connect Webcam';
        btnToggleCamera.classList.add('btn-primary');
        btnToggleCamera.classList.remove('btn-success');
      }
    }
  }

  async function refreshCameraList() {
    if (!cameraSelect) return;
    const prevVal = cameraSelect.value;
    const cams = await tracker.getAvailableCameras();

    cameraSelect.innerHTML = '';
    const synOpt = document.createElement('option');
    synOpt.value = 'synthetic';
    synOpt.textContent = 'Synthetic Dancer (Rehearsal)';
    cameraSelect.appendChild(synOpt);

    cams.forEach((cam) => {
      const opt = document.createElement('option');
      opt.value = cam.deviceId;
      opt.textContent = cam.label;
      cameraSelect.appendChild(opt);
    });

    if (tracker.isCameraRunning && tracker.selectedDeviceId && tracker.selectedDeviceId !== 'synthetic') {
      cameraSelect.value = tracker.selectedDeviceId;
    } else if (cams.some(c => c.deviceId === prevVal)) {
      cameraSelect.value = prevVal;
    } else if (!tracker.isCameraRunning && cams.length > 0 && prevVal === 'synthetic') {
      cameraSelect.value = 'synthetic';
    }
  }

  async function activateWebcam(preferredId = null) {
    if (valCameraStatus) {
      valCameraStatus.textContent = 'Connecting...';
      valCameraStatus.style.color = 'var(--accent-amber)';
    }
    const ok = await tracker.startCamera(videoEl, preferredId);
    if (ok) {
      await refreshCameraList();
      // Select active stream device in dropdown if known
      const track = tracker.currentStream?.getVideoTracks()?.[0];
      const activeId = track?.getSettings?.()?.deviceId;
      if (activeId && cameraSelect) {
        tracker.selectedDeviceId = activeId;
        cameraSelect.value = activeId;
      }
      updateCameraStatusUI();
      // Ensure MediaPipe PoseLandmarker finishes loading if still initializing
      if (!tracker.isModelReady && !tracker.isModelLoading) {
        initVisionEngine();
      }
    } else {
      updateCameraStatusUI(tracker.lastError || 'No webcam found');
    }
  }

  function switchToSynthetic() {
    tracker.stopCamera();
    tracker.useSynthetic = true;
    tracker.selectedDeviceId = 'synthetic';
    if (cameraSelect) cameraSelect.value = 'synthetic';
    updateCameraStatusUI();
  }

  cameraSelect?.addEventListener('change', async () => {
    const val = cameraSelect.value;
    if (val === 'synthetic') {
      switchToSynthetic();
    } else {
      await activateWebcam(val);
    }
  });

  btnToggleCamera?.addEventListener('click', async () => {
    if (tracker.isCameraRunning && !tracker.useSynthetic) {
      switchToSynthetic();
    } else {
      const sel = cameraSelect?.value;
      const preferred = (sel && sel !== 'synthetic') ? sel : null;
      await activateWebcam(preferred);
    }
  });

  btnUseSynthetic?.addEventListener('click', switchToSynthetic);

  chkMirrorCam?.addEventListener('change', () => {
    tracker.setMirror(chkMirrorCam.checked);
  });

  sliderUnderlay?.addEventListener('input', () => {
    underlayOpacity = parseFloat(sliderUnderlay.value);
    if (valUnderlay) valUnderlay.textContent = `${Math.round(underlayOpacity * 100)}%`;
  });

  sliderSmoothing?.addEventListener('input', () => {
    const v = parseFloat(sliderSmoothing.value);
    tracker.setSmoothing(v);
    if (valSmoothing) {
      valSmoothing.textContent = v < 0.3 ? 'Smooth' : (v > 0.7 ? 'Snappy' : 'Balanced');
    }
  });

  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', refreshCameraList);
  }
  refreshCameraList();

  // Initialize local offline MediaPipe PoseLandmarker non-blocking
  async function initVisionEngine() {
    if (valMpStatus) {
      valMpStatus.textContent = 'Loading local AI...';
      valMpStatus.style.color = 'var(--accent-amber)';
    }
    const ok = await tracker.initMediaPipe();
    if (valMpStatus) {
      if (ok) {
        valMpStatus.textContent = `Ready (${tracker.delegateUsed})`;
        valMpStatus.style.color = 'var(--accent-emerald)';
      } else {
        valMpStatus.textContent = 'Unavailable';
        valMpStatus.style.color = 'var(--accent-rose)';
      }
    }
  }
  initVisionEngine();

  // 10. Live Mirror 4-Corner Calibration Overlay, Auto-Align & Venue Profiles
  const calibOverlay = document.getElementById('calib-overlay');
  const calibHandlesLayer = document.getElementById('calib-handles-layer');
  const calibQuadPoly = document.getElementById('calib-quad-poly');
  const calibDiag1 = document.getElementById('calib-diag-1');
  const calibDiag2 = document.getElementById('calib-diag-2');
  const calibHandles = Array.from(document.querySelectorAll('.calib-handle'));
  const btnHdrCalib = document.getElementById('btn-hdr-calib');
  const btnToggleCalibGrid = document.getElementById('btn-toggle-calib-grid');
  const btnAutoAlign = document.getElementById('btn-auto-align');
  const autoAlignStatus = document.getElementById('auto-align-status');
  const btnResetCalib = document.getElementById('btn-reset-calib');

  const coordEls = [
    document.getElementById('coord-tl'),
    document.getElementById('coord-tr'),
    document.getElementById('coord-br'),
    document.getElementById('coord-bl')
  ];

  function updateCalibrationOverlay() {
    const c = calibrator.corners;
    const ptsStr = c.map(([x, y]) => `${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`).join(' ');
    if (calibQuadPoly) calibQuadPoly.setAttribute('points', ptsStr);

    if (calibDiag1) {
      calibDiag1.setAttribute('x1', (c[0][0] * 100).toFixed(2));
      calibDiag1.setAttribute('y1', (c[0][1] * 100).toFixed(2));
      calibDiag1.setAttribute('x2', (c[2][0] * 100).toFixed(2));
      calibDiag1.setAttribute('y2', (c[2][1] * 100).toFixed(2));
    }
    if (calibDiag2) {
      calibDiag2.setAttribute('x1', (c[1][0] * 100).toFixed(2));
      calibDiag2.setAttribute('y1', (c[1][1] * 100).toFixed(2));
      calibDiag2.setAttribute('x2', (c[3][0] * 100).toFixed(2));
      calibDiag2.setAttribute('y2', (c[3][1] * 100).toFixed(2));
    }

    calibHandles.forEach((handle) => {
      const idx = parseInt(handle.dataset.corner, 10);
      if (!isNaN(idx) && c[idx]) {
        const xPct = `${(c[idx][0] * 100).toFixed(2)}%`;
        const yPct = `${(c[idx][1] * 100).toFixed(2)}%`;
        handle.style.left = `clamp(16px, ${xPct}, calc(100% - 16px))`;
        handle.style.top = `clamp(16px, ${yPct}, calc(100% - 16px))`;
      }
    });

    coordEls.forEach((el, idx) => {
      if (el && c[idx]) {
        el.textContent = `[${(c[idx][0] * 100).toFixed(1)}%, ${(c[idx][1] * 100).toFixed(1)}%]`;
      }
    });
  }
  updateCalibrationOverlay();

  function setCalibrationActive(active) {
    engine.calibGridActive = !!active;
    if (calibOverlay) calibOverlay.style.display = engine.calibGridActive ? 'block' : 'none';
    if (calibHandlesLayer) calibHandlesLayer.style.display = engine.calibGridActive ? 'block' : 'none';

    btnHdrCalib?.classList.toggle('btn-active-cyan', engine.calibGridActive);
    if (btnToggleCalibGrid) {
      btnToggleCalibGrid.textContent = engine.calibGridActive
        ? 'Hide Calibration Grid & Pins [C]'
        : 'Show Calibration Grid & Pins [C]';
      btnToggleCalibGrid.classList.toggle('btn-active-cyan', engine.calibGridActive);
    }
    if (engine.calibGridActive) updateCalibrationOverlay();
    sync.send('STATE_UPDATE', { calibGridActive: engine.calibGridActive });
  }

  btnHdrCalib?.addEventListener('click', () => setCalibrationActive(!engine.calibGridActive));
  btnToggleCalibGrid?.addEventListener('click', () => setCalibrationActive(!engine.calibGridActive));

  // Dragging 4 calibration corner pins
  let draggingCornerIdx = -1;
  calibHandles.forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      draggingCornerIdx = parseInt(handle.dataset.corner, 10);
      handle.classList.add('dragging');
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    });

    handle.addEventListener('pointermove', (e) => {
      if (draggingCornerIdx !== parseInt(handle.dataset.corner, 10)) return;
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nx = Math.max(0.0, Math.min(1.0, (e.clientX - rect.left) / rect.width));
      const ny = Math.max(0.0, Math.min(1.0, (e.clientY - rect.top) / rect.height));
      calibrator.setCorner(draggingCornerIdx, nx, ny);
      updateCalibrationOverlay();
      sync.send('CALIBRATION', calibrator.corners);
    });

    const endDrag = (e) => {
      if (draggingCornerIdx === parseInt(handle.dataset.corner, 10)) {
        draggingCornerIdx = -1;
        handle.classList.remove('dragging');
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  });

  btnResetCalib?.addEventListener('click', () => {
    calibrator.reset();
    updateCalibrationOverlay();
    sync.send('CALIBRATION', calibrator.corners);
    if (autoAlignStatus) {
      autoAlignStatus.textContent = 'Corners reset to full 100% camera frame.';
      autoAlignStatus.style.color = 'var(--text-secondary)';
    }
  });

  // Differential Bright/Dark Auto-Align Camera-to-Projector Workflow
  const snapCanvas = document.createElement('canvas');
  snapCanvas.width = 320;
  snapCanvas.height = 180;
  const snapCtx = snapCanvas.getContext('2d', { willReadFrequently: true });

  function captureVideoFramePixels() {
    const w = snapCanvas.width;
    const h = snapCanvas.height;
    snapCtx.save();
    snapCtx.clearRect(0, 0, w, h);
    if (tracker.mirrorX) {
      snapCtx.translate(w, 0);
      snapCtx.scale(-1, 1);
    }
    snapCtx.drawImage(videoEl, 0, 0, w, h);
    snapCtx.restore();
    return snapCtx.getImageData(0, 0, w, h).data;
  }

  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  btnAutoAlign?.addEventListener('click', async () => {
    if (!tracker.isCameraRunning || tracker.useSynthetic || !videoEl || videoEl.readyState < 2) {
      if (autoAlignStatus) {
        autoAlignStatus.textContent = 'Connect a live webcam facing the projector stage first.';
        autoAlignStatus.style.color = 'var(--accent-amber)';
      }
      return;
    }

    btnAutoAlign.disabled = true;
    const prevBlackout = engine.blackout;
    const prevGrid = engine.calibGridActive;

    try {
      if (autoAlignStatus) {
        autoAlignStatus.textContent = '1/3 Capturing dark stage baseline...';
        autoAlignStatus.style.color = 'var(--accent-cyan)';
      }
      engine.calibGridActive = false;
      engine.blackout = true;
      sync.send('STATE_UPDATE', { blackout: true, calibGridActive: false, calibFlashWhite: false });
      await sleep(240);
      const darkPixels = new Uint8ClampedArray(captureVideoFramePixels());

      if (autoAlignStatus) {
        autoAlignStatus.textContent = '2/3 Flashing projector calibration pattern...';
      }
      engine.blackout = false;
      engine.calibFlashWhite = true;
      sync.send('STATE_UPDATE', { blackout: false, calibFlashWhite: true });
      await sleep(280);
      const brightPixels = new Uint8ClampedArray(captureVideoFramePixels());

      engine.calibFlashWhite = false;
      engine.blackout = prevBlackout;
      sync.send('STATE_UPDATE', { calibFlashWhite: false, blackout: prevBlackout });

      const result = calibrator.detectProjectorCorners(
        darkPixels,
        brightPixels,
        snapCanvas.width,
        snapCanvas.height
      );

      if (result.success) {
        setCalibrationActive(true);
        updateCalibrationOverlay();
        sync.send('CALIBRATION', calibrator.corners);
        if (autoAlignStatus) {
          autoAlignStatus.textContent = 'Auto-Aligned! 4 projector corners locked.';
          autoAlignStatus.style.color = 'var(--accent-emerald)';
        }
      } else {
        setCalibrationActive(prevGrid);
        if (autoAlignStatus) {
          autoAlignStatus.textContent = result.reason;
          autoAlignStatus.style.color = 'var(--accent-amber)';
        }
      }
    } catch (err) {
      engine.calibFlashWhite = false;
      engine.blackout = prevBlackout;
      sync.send('STATE_UPDATE', { calibFlashWhite: false, blackout: prevBlackout });
      if (autoAlignStatus) {
        autoAlignStatus.textContent = `Auto-Align failed: ${err.message}`;
        autoAlignStatus.style.color = 'var(--accent-rose)';
      }
    } finally {
      btnAutoAlign.disabled = false;
    }
  });

  // Venue Calibration Profiles
  const inputVenueName = document.getElementById('input-venue-name');
  const btnSaveVenue = document.getElementById('btn-save-venue');
  const selectVenueProfile = document.getElementById('select-venue-profile');
  const btnLoadVenue = document.getElementById('btn-load-venue');
  const btnDelVenue = document.getElementById('btn-del-venue');

  function refreshVenueProfiles(selectName = '') {
    if (!selectVenueProfile) return;
    const profiles = calibrator.listProfiles();
    selectVenueProfile.innerHTML = '<option value="">-- Saved Venues --</option>';
    for (const name of Object.keys(profiles).sort()) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      selectVenueProfile.appendChild(opt);
    }
    if (selectName && profiles[selectName]) {
      selectVenueProfile.value = selectName;
    }
  }
  refreshVenueProfiles();

  btnSaveVenue?.addEventListener('click', () => {
    const name = inputVenueName?.value?.trim();
    if (!name) return;
    if (calibrator.saveProfile(name)) {
      refreshVenueProfiles(name);
      if (inputVenueName) inputVenueName.value = '';
      if (autoAlignStatus) {
        autoAlignStatus.textContent = `Saved venue profile "${name}".`;
        autoAlignStatus.style.color = 'var(--accent-emerald)';
      }
    }
  });

  btnLoadVenue?.addEventListener('click', () => {
    const name = selectVenueProfile?.value;
    if (!name) return;
    if (calibrator.loadProfile(name)) {
      updateCalibrationOverlay();
      sync.send('CALIBRATION', calibrator.corners);
      if (autoAlignStatus) {
        autoAlignStatus.textContent = `Loaded venue profile "${name}".`;
        autoAlignStatus.style.color = 'var(--accent-cyan)';
      }
    }
  });

  btnDelVenue?.addEventListener('click', () => {
    const name = selectVenueProfile?.value;
    if (!name) return;
    if (calibrator.deleteProfile(name)) {
      refreshVenueProfiles();
      if (autoAlignStatus) {
        autoAlignStatus.textContent = `Deleted venue profile "${name}".`;
        autoAlignStatus.style.color = 'var(--text-muted)';
      }
    }
  });

  // 11. Global Performance Hotkeys
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key >= '1' && e.key <= '6') {
      const idx = parseInt(e.key, 10) - 1;
      if (SCENE_PRESETS[idx]) {
        selectScene(SCENE_PRESETS[idx].id);
      }
    } else if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      setBlackout(!engine.blackout);
    } else if (e.key === 'm' || e.key === 'M') {
      setBodyLockedMask(!engine.bodyLockedMask);
    } else if (e.key === 't' || e.key === 'T') {
      cycleTheme();
    } else if (e.key === 'c' || e.key === 'C') {
      setCalibrationActive(!engine.calibGridActive);
    } else if (e.key === 'p' || e.key === 'P') {
      setRehearsalMode(!isRehearsalMode);
    } else if (e.key === 'Escape' && isRehearsalMode) {
      setRehearsalMode(false);
    }
  });

  // Expose live state debug hook for inspection & verification
  window.__projectionFX = {
    engine,
    calibrator,
    tracker,
    selectScene,
    selectTheme,
    setBodyLockedMask,
    setBlackout,
    setCalibrationActive,
    setRehearsalMode
  };
}

/* =========================================================
   60 FPS STAGE RENDER & SYNC LOOP
   ========================================================= */
let lastTime = performance.now();
let frameCount = 0;
let fpsTimer = performance.now();

const valJointsCount = document.getElementById('val-joints-count');
const valSegStatus = document.getElementById('val-seg-status');
const hudFps = document.getElementById('hud-fps');
const statFps = document.getElementById('stat-fps');

function animate(now) {
  requestAnimationFrame(animate);

  const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) * 0.001));
  lastTime = now;
  const timeSec = now * 0.001;

  if (isProjectorMode) {
    // Projector Display 2: pitch-black #000000 canvas, NO camera underlay
    engine.render(remotePoseData, calibrator, null, dt, timeSec);
  } else {
    const poseData = tracker.update(now);

    const underlay = (tracker.isCameraRunning && !tracker.useSynthetic && !isRehearsalMode)
      ? {
          video: tracker.video,
          mirrorX: tracker.mirrorX,
          opacity: underlayOpacity
        }
      : null;

    engine.render(poseData, calibrator, underlay, dt, timeSec);

    // Stream frame pose & silhouette mask to Display 2 Projector if connected
    if (projectorConnected) {
      const sendMask = poseData.hasMask && (
        engine.bodyLockedMask ||
        engine.activePreset === 'laser-skeleton' ||
        engine.activePreset === 'aura-halo' ||
        engine.activePreset === 'supernova'
      );
      sync.send('FRAME_POSE', {
        isTracking: poseData.isTracking,
        source: poseData.source,
        landmarks: poseData.landmarks,
        velocities: poseData.velocities,
        hasMask: poseData.hasMask,
        maskWidth: poseData.maskWidth,
        maskHeight: poseData.maskHeight,
        maskAlpha: sendMask ? poseData.maskAlpha : null
      });
    }

    // Update Console Diagnostics every ~0.5s
    frameCount++;
    if (now - fpsTimer >= 500) {
      const fps = (frameCount * 1000 / (now - fpsTimer)).toFixed(1);
      if (hudFps) hudFps.textContent = `${fps} FPS`;
      if (statFps) statFps.textContent = `FPS: ${fps}`;
      if (valJointsCount) {
        valJointsCount.textContent = poseData.isTracking
          ? `${poseData.detectedJointsCount} / 33`
          : '0 / 33 (Searching)';
      }
      if (valSegStatus) {
        valSegStatus.textContent = poseData.hasMask
          ? `Active (${poseData.maskWidth}x${poseData.maskHeight})`
          : 'Standby';
      }
      frameCount = 0;
      fpsTimer = now;
    }
  }
}

requestAnimationFrame(animate);
