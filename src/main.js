import * as THREE from 'three';
import { GaussianSplatRenderer } from './splats/GaussianSplatRenderer.js';
import { TrackingManager } from './tracking/TrackingManager.js';
import { CalibrationWizard } from './calibration/CalibrationWizard.js';
import { KeystoneWarp } from './calibration/KeystoneWarp.js';
import { ChannelSync } from './sync/ChannelSync.js';

// Determine if this instance is running as the Projector Output Window
const urlParams = new URLSearchParams(window.location.search);
const isProjectorMode = urlParams.get('mode') === 'projector';

if (isProjectorMode) {
  document.body.classList.add('projector-mode');
}

// 1. Initialize Three.js Scene, Camera, and Renderer
const container = document.getElementById('viewport-container');
const canvas = document.getElementById('viewport-canvas');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100);
camera.position.set(0, 0.6, 2.2);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// 2. Gaussian Splat Renderer
const splatRenderer = new GaussianSplatRenderer(scene, camera);

// Hand Visualizer Spheres
const handGeo = new THREE.SphereGeometry(0.04, 16, 16);
const handMatLeft = new THREE.MeshBasicMaterial({ color: 0x06b6d4, wireframe: true });
const handMatRight = new THREE.MeshBasicMaterial({ color: 0xf43f5e, wireframe: true });
const leftHandMesh = new THREE.Mesh(handGeo, handMatLeft);
const rightHandMesh = new THREE.Mesh(handGeo, handMatRight);
scene.add(leftHandMesh);
scene.add(rightHandMesh);

// Reference 3D Sculpture Box Wireframe
const boxGeo = new THREE.BoxGeometry(0.6, 0.6, 0.4);
const boxEdges = new THREE.EdgesGeometry(boxGeo);
const boxWire = new THREE.LineSegments(boxEdges, new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.35 }));
boxWire.position.set(0, 0.3, 0.2);
scene.add(boxWire);

// 3. Vision & Calibration Managers
const tracker = new TrackingManager();
const keystone = new KeystoneWarp(window.innerWidth, window.innerHeight);
const sync = new ChannelSync(isProjectorMode, (msg) => {
  if (msg.type === 'EFFECT_PARAMS') {
    splatRenderer.setTurbulence(msg.payload.turbStrength, msg.payload.turbSpeed);
    splatRenderer.setDissolve(msg.payload.dissolve);
  } else if (msg.type === 'CALIBRATION') {
    applyCalibratedCamera(msg.payload);
  } else if (msg.type === 'KEYSTONE') {
    keystone.corners = msg.payload;
    canvas.style.transform = keystone.getCssMatrix3D();
  } else if (msg.type === 'PRESET') {
    splatRenderer.loadPreset(msg.payload.preset, 60000);
  }
});

const calibWizard = new CalibrationWizard((calib) => {
  applyCalibratedCamera(calib);
  sync.send('CALIBRATION', calib);
});

function applyCalibratedCamera(calib) {
  if (!calib || !calib.K) return;
  // Apply off-axis calibrated projection matrix
  const width = window.innerWidth;
  const height = window.innerHeight;
  const offAxisMat = calib.createOffAxisThreeMatrix
    ? calib.createOffAxisThreeMatrix(calib.fx, calib.fy, calib.cx, calib.cy, width, height)
    : null;

  if (offAxisMat) {
    camera.projectionMatrix.fromArray(offAxisMat);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  if (calib.cameraPosition) {
    camera.position.set(calib.cameraPosition[0], calib.cameraPosition[1], calib.cameraPosition[2]);
  }
}

// 4. UI Wiring (Console Mode)
if (!isProjectorMode) {
  setupUI();
}

function setupUI() {
  // Tabs Navigation
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  function switchTab(tabId) {
    tabBtns.forEach(b => {
      if (b.dataset.tab === tabId) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
    tabPanes.forEach(p => {
      if (p.id === tabId) {
        p.classList.add('active');
      } else {
        p.classList.remove('active');
      }
    });
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Mode Selector (Static 3D Object vs. Dynamic Performer)
  const btnModeObject = document.getElementById('btn-mode-object');
  const btnModePerformer = document.getElementById('btn-mode-performer');
  const statMode = document.getElementById('stat-mode');
  const presetSelect = document.getElementById('preset-select');

  function setMode(mode) {
    if (mode === 'performer') {
      btnModeObject?.classList.remove('active');
      btnModePerformer?.classList.add('active');
      if (statMode) statMode.textContent = 'Mode: Dynamic Performer';
      switchTab('tab-performer');
      if (presetSelect) presetSelect.value = 'performer';
      splatRenderer.loadPreset('performer', 60000);
      document.getElementById('stat-splats').textContent = `Splats: ${splatRenderer.splatData.count.toLocaleString()}`;
      sync.send('PRESET', { preset: 'performer' });
    } else {
      btnModePerformer?.classList.remove('active');
      btnModeObject?.classList.add('active');
      if (statMode) statMode.textContent = 'Mode: Static 3D Object';
      switchTab('tab-effects');
      if (presetSelect) presetSelect.value = 'sculpture';
      splatRenderer.loadPreset('sculpture', 60000);
      document.getElementById('stat-splats').textContent = `Splats: ${splatRenderer.splatData.count.toLocaleString()}`;
      sync.send('PRESET', { preset: 'sculpture' });
    }
  }

  btnModeObject?.addEventListener('click', () => setMode('object'));
  btnModePerformer?.addEventListener('click', () => setMode('performer'));

  // Preset Selector Dropdown
  presetSelect?.addEventListener('change', (e) => {
    const preset = e.target.value;
    splatRenderer.loadPreset(preset, 60000);
    document.getElementById('stat-splats').textContent = `Splats: ${splatRenderer.splatData.count.toLocaleString()}`;
    if (preset === 'performer') {
      btnModeObject?.classList.remove('active');
      btnModePerformer?.classList.add('active');
      if (statMode) statMode.textContent = 'Mode: Dynamic Performer';
    }
    sync.send('PRESET', { preset });
  });

  // Reload Preset / Demo Reset
  document.getElementById('btn-reset-demo')?.addEventListener('click', () => {
    const preset = presetSelect ? presetSelect.value : 'sculpture';
    splatRenderer.loadPreset(preset, 60000);
    document.getElementById('stat-splats').textContent = `Splats: ${splatRenderer.splatData.count.toLocaleString()}`;
  });

  // Dynamic Performer tab controls
  document.getElementById('btn-activate-performer-preset')?.addEventListener('click', () => {
    setMode('performer');
  });

  let maskEnabled = false;
  const btnToggleMask = document.getElementById('btn-toggle-mask');
  const valMaskState = document.getElementById('val-mask-state');
  btnToggleMask?.addEventListener('click', () => {
    maskEnabled = !maskEnabled;
    if (valMaskState) valMaskState.textContent = maskEnabled ? 'Enabled' : 'Off';
    valMaskState.style.color = maskEnabled ? 'var(--accent-emerald)' : 'var(--accent-cyan)';
    splatRenderer.uniforms.uUsePerformerMask.value = maskEnabled ? 1.0 : 0.0;
  });

  const sliderPerformerAura = document.getElementById('slider-performer-aura');
  const valPerformerAura = document.getElementById('val-performer-aura');
  sliderPerformerAura?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (valPerformerAura) valPerformerAura.textContent = `${val.toFixed(2)}m`;
    splatRenderer.setDissolve(val);
  });

  const sliderPerformerBind = document.getElementById('slider-performer-bind');
  const valPerformerBind = document.getElementById('val-performer-bind');
  sliderPerformerBind?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (valPerformerBind) valPerformerBind.textContent = val.toFixed(2);
    splatRenderer.uniforms.uHandPushStrength.value = val * 0.5;
  });

  // Camera Selection & MediaStream
  const cameraSelect = document.getElementById('camera-select');
  const btnCamera = document.getElementById('btn-toggle-camera');
  const videoElem = document.getElementById('webcam-feed');

  async function populateCameraDevices() {
    if (!cameraSelect) return;
    const devices = await tracker.getAvailableCameras();
    cameraSelect.innerHTML = '';

    if (devices.length === 0) {
      const optDefault = document.createElement('option');
      optDefault.value = '';
      optDefault.textContent = 'Default Camera (Auto-Detect)';
      cameraSelect.appendChild(optDefault);
    } else {
      devices.forEach(dev => {
        const opt = document.createElement('option');
        opt.value = dev.deviceId;
        opt.textContent = dev.label || `Camera ${cameraSelect.children.length + 1}`;
        cameraSelect.appendChild(opt);
      });
    }

    const optSynthetic = document.createElement('option');
    optSynthetic.value = 'synthetic';
    optSynthetic.textContent = 'Synthetic Motion Generator (No Hardware)';
    cameraSelect.appendChild(optSynthetic);
  }

  populateCameraDevices();

  cameraSelect?.addEventListener('change', async (e) => {
    const selectedId = e.target.value;
    if (selectedId === 'synthetic') {
      if (tracker.currentStream) {
        tracker.currentStream.getTracks().forEach(t => t.stop());
        tracker.currentStream = null;
      }
      tracker.useSynthetic = true;
      tracker.isCameraRunning = true;
      if (btnCamera) btnCamera.textContent = 'Synthetic Tracking Active';
      return;
    }

    if (btnCamera) btnCamera.textContent = 'Connecting Camera...';
    await tracker.initMediaPipe();
    const ok = await tracker.startCamera(videoElem, selectedId || null);
    if (btnCamera) {
      btnCamera.textContent = ok ? 'Webcam Running (1080p60)' : 'Using Synthetic Tracking';
    }
  });

  btnCamera?.addEventListener('click', async () => {
    btnCamera.textContent = 'Connecting Camera...';
    await tracker.initMediaPipe();
    const selectedId = cameraSelect ? cameraSelect.value : null;
    const ok = await tracker.startCamera(videoElem, selectedId && selectedId !== 'synthetic' ? selectedId : null);
    btnCamera.textContent = ok ? 'Webcam Running (1080p60)' : 'Using Synthetic Tracking';
    await populateCameraDevices();
    if (selectedId && cameraSelect) cameraSelect.value = selectedId;
  });

  // Sliders
  const sliderTurbStrength = document.getElementById('slider-turb-strength');
  const sliderTurbSpeed = document.getElementById('slider-turb-speed');
  const sliderHandPush = document.getElementById('slider-hand-push');
  const sliderHandRadius = document.getElementById('slider-hand-radius');
  const sliderDissolve = document.getElementById('slider-dissolve');

  const valTurbStrength = document.getElementById('val-turb-strength');
  const valTurbSpeed = document.getElementById('val-turb-speed');
  const valHandPush = document.getElementById('val-hand-push');
  const valHandRadius = document.getElementById('val-hand-radius');
  const valDissolve = document.getElementById('val-dissolve');

  const updateSliders = () => {
    const ts = parseFloat(sliderTurbStrength.value);
    const sp = parseFloat(sliderTurbSpeed.value);
    const hp = parseFloat(sliderHandPush.value);
    const hr = parseFloat(sliderHandRadius.value);
    const dis = parseFloat(sliderDissolve.value);

    valTurbStrength.textContent = ts.toFixed(2);
    valTurbSpeed.textContent = sp.toFixed(2);
    valHandPush.textContent = hp.toFixed(2);
    valHandRadius.textContent = hr.toFixed(2) + 'm';
    valDissolve.textContent = dis.toFixed(2) + 'm';

    splatRenderer.setTurbulence(ts, sp);
    splatRenderer.uniforms.uHandPushStrength.value = hp;
    splatRenderer.uniforms.uHandPushRadius.value = hr;
    splatRenderer.setDissolve(dis);

    sync.send('EFFECT_PARAMS', { turbStrength: ts, turbSpeed: sp, dissolve: dis });
  };

  [sliderTurbStrength, sliderTurbSpeed, sliderHandPush, sliderHandRadius, sliderDissolve].forEach(s => {
    s?.addEventListener('input', updateSliders);
  });

  // PLY File Loader
  const fileInput = document.getElementById('ply-file-input');
  document.getElementById('btn-load-ply')?.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      const buffer = await file.arrayBuffer();
      splatRenderer.loadPly(buffer);
      document.getElementById('stat-splats').textContent = `Splats: ${splatRenderer.splatData.count.toLocaleString()}`;
    }
  });

  // Projector Window Launcher
  document.getElementById('btn-open-projector')?.addEventListener('click', () => {
    try {
      if (window.require) {
        const { ipcRenderer } = window.require('electron');
        if (ipcRenderer) {
          ipcRenderer.send('open-projector');
          return;
        }
      }
    } catch (_) {}
    window.open(`${window.location.href.split('?')[0]}?mode=projector`, 'ProjectorOutput', 'width=1920,height=1080');
  });

  // Populate Calibration Table
  const tableBody = document.getElementById('calib-table-body');
  if (tableBody) {
    calibWizard.referencePoints3D.forEach((p3, i) => {
      const p2 = calibWizard.screenPoints2D[i];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>P${i}</strong></td>
        <td>[${p3.join(', ')}]</td>
        <td><input type="text" value="${p2[0]}, ${p2[1]}" style="background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); padding: 2px 4px; width: 100px; border-radius: 3px;" data-idx="${i}"></td>
      `;
      tableBody.appendChild(tr);
    });

    tableBody.addEventListener('change', (e) => {
      if (e.target.tagName === 'INPUT') {
        const idx = parseInt(e.target.dataset.idx);
        const parts = e.target.value.split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          calibWizard.setScreenPoint(idx, parts[0], parts[1]);
          updateCalibDiagnostics();
        }
      }
    });
  }

  function updateCalibDiagnostics() {
    if (calibWizard.lastResult) {
      document.getElementById('val-calib-rms').textContent = `${calibWizard.lastResult.rmsError.toFixed(4)} px`;
      document.getElementById('hud-rms').textContent = `< ${calibWizard.lastResult.rmsError.toFixed(3)} px`;
      const pos = calibWizard.lastResult.cameraPosition.map(v => v.toFixed(2));
      document.getElementById('val-proj-pos').textContent = `[${pos.join(', ')}]`;
    }
  }
  updateCalibDiagnostics();

  document.getElementById('btn-solve-calib')?.addEventListener('click', () => {
    calibWizard.solve();
    updateCalibDiagnostics();
  });

  // Keystone Reset
  document.getElementById('btn-reset-keystone')?.addEventListener('click', () => {
    keystone.reset();
    sync.send('KEYSTONE', keystone.corners);
  });
}

// 5. Render Loop
let lastTime = performance.now();
let frameCount = 0;
let fpsTimer = performance.now();

function animate(now) {
  requestAnimationFrame(animate);

  const delta = (now - lastTime) * 0.001;
  lastTime = now;

  // Update Tracking
  const trackingData = tracker.update(now);

  if (trackingData && trackingData.leftHand) {
    leftHandMesh.position.set(...trackingData.leftHand);
    leftHandMesh.visible = true;
  } else {
    leftHandMesh.visible = false;
  }

  if (trackingData && trackingData.rightHand) {
    rightHandMesh.position.set(...trackingData.rightHand);
    rightHandMesh.visible = true;
  } else {
    rightHandMesh.visible = false;
  }

  splatRenderer.setHandPositions(trackingData.leftHand, trackingData.rightHand);
  splatRenderer.update(delta, now * 0.001);

  // Gentle turntable rotation in console mode
  if (!isProjectorMode) {
    scene.rotation.y = Math.sin(now * 0.0004) * 0.25;
  }

  renderer.render(scene, camera);

  // FPS Counter
  frameCount++;
  if (now - fpsTimer >= 1000) {
    const fps = (frameCount * 1000 / (now - fpsTimer)).toFixed(1);
    const fpsElem = document.getElementById('stat-fps');
    if (fpsElem) fpsElem.textContent = `FPS: ${fps}`;
    const hudStatus = document.getElementById('hud-status');
    if (hudStatus) hudStatus.textContent = `GPU Pipeline Active • ${fps} FPS`;
    frameCount = 0;
    fpsTimer = now;
  }
}

requestAnimationFrame(animate);

// Window resize handling
window.addEventListener('resize', () => {
  const w = isProjectorMode ? window.innerWidth : container.clientWidth;
  const h = isProjectorMode ? window.innerHeight : container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});
