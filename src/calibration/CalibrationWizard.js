import { ProjectorCalibration } from '../math/ProjectorCalibration.js';

/**
 * CalibrationWizard.js - Interactive 6-point 3D-to-2D Projector Alignment.
 * Allows aligning a physical 3D sculpture or object to the digital projection by matching reference points.
 */
export class CalibrationWizard {
  constructor(onCalibrationApplied) {
    this.onCalibrationApplied = onCalibrationApplied;

    // Default 6 reference points on standard sculpture box [X, Y, Z]
    this.referencePoints3D = [
      [-0.3, 0.0, 0.0],  // 0: Bottom-Left-Front
      [ 0.3, 0.0, 0.0],  // 1: Bottom-Right-Front
      [ 0.3, 0.6, 0.0],  // 2: Top-Right-Front
      [-0.3, 0.6, 0.0],  // 3: Top-Left-Front
      [-0.3, 0.0, 0.4],  // 4: Bottom-Left-Back
      [ 0.3, 0.6, 0.4]   // 5: Top-Right-Back
    ];

    // Screen pixel coordinates [u, v]
    this.screenPoints2D = [
      [ 480, 780 ],
      [ 1440, 780 ],
      [ 1380, 220 ],
      [ 540,  220 ],
      [ 380,  690 ],
      [ 1480, 150 ]
    ];

    this.activePointIndex = 0;
    this.lastResult = null;
    this.loadFromStorage();
  }

  solve(width = 1920, height = 1080) {
    const correspondences = [];
    for (let i = 0; i < this.referencePoints3D.length; i++) {
      correspondences.push({
        world: this.referencePoints3D[i],
        screen: this.screenPoints2D[i]
      });
    }

    try {
      this.lastResult = ProjectorCalibration.solve(correspondences, width, height);
      this.saveToStorage();

      if (this.onCalibrationApplied) {
        this.onCalibrationApplied(this.lastResult);
      }
      return this.lastResult;
    } catch (e) {
      console.error('Calibration solve failed:', e);
      return null;
    }
  }

  setScreenPoint(index, u, v) {
    if (index >= 0 && index < this.screenPoints2D.length) {
      this.screenPoints2D[index] = [u, v];
      this.solve();
    }
  }

  saveToStorage() {
    try {
      const data = {
        referencePoints3D: this.referencePoints3D,
        screenPoints2D: this.screenPoints2D,
        lastResult: this.lastResult
      };
      localStorage.setItem('projectionfx_calibration', JSON.stringify(data));
    } catch (e) {
      // ignore
    }
  }

  loadFromStorage() {
    try {
      const saved = localStorage.getItem('projectionfx_calibration');
      if (saved) {
        const data = JSON.parse(saved);
        if (data.referencePoints3D && data.screenPoints2D) {
          this.referencePoints3D = data.referencePoints3D;
          this.screenPoints2D = data.screenPoints2D;
          this.solve();
        }
      }
    } catch (e) {
      // ignore
    }
  }
}
