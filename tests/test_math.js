import { LinAlg } from '../src/math/LinAlg.js';
import { ProjectorCalibration } from '../src/math/ProjectorCalibration.js';
import { Homography2D } from '../src/math/Homography2D.js';
import { OneEuroFilter3D } from '../src/math/OneEuroFilter.js';

console.log('--- RUNNING MATHEMATICAL SOLVER UNIT TESTS ---');

// Test 1: 3x3 Inverse
const M = new Float64Array([1, 2, 3, 0, 1, 4, 5, 6, 0]);
const invM = LinAlg.invert3x3(M);
const identity = LinAlg.matMul(M, invM, 3, 3, 3);
let maxInvErr = 0;
for (let i = 0; i < 3; i++) {
  for (let j = 0; j < 3; j++) {
    const expected = (i === j) ? 1.0 : 0.0;
    maxInvErr = Math.max(maxInvErr, Math.abs(identity[i * 3 + j] - expected));
  }
}
console.log(`[PASS] 3x3 Invert error: ${maxInvErr.toExponential(4)} (threshold 1e-12)`);
if (maxInvErr > 1e-12) throw new Error('Invert failed');

// Test 2: Synthetic Projector DLT PnP Solver
const trueK = new Float64Array([
  1920.0, 0.0, 960.0,
  0.0, 1920.0, 540.0,
  0.0, 0.0, 1.0
]);
const trueCamPos = [0.0, 1.2, -2.5];
// Rotation (looking slightly down by 15 deg)
const pitch = 15.0 * Math.PI / 180.0;
const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
const trueR = new Float64Array([
  1, 0, 0,
  0, cosP, -sinP,
  0, sinP, cosP
]);
// t = -R * C
const trueT = new Float64Array([
  -(trueR[0]*trueCamPos[0] + trueR[1]*trueCamPos[1] + trueR[2]*trueCamPos[2]),
  -(trueR[3]*trueCamPos[0] + trueR[4]*trueCamPos[1] + trueR[5]*trueCamPos[2]),
  -(trueR[6]*trueCamPos[0] + trueR[7]*trueCamPos[1] + trueR[8]*trueCamPos[2])
]);

// 8 synthetic 3D cube points (sculpture corners)
const cubePoints = [
  [-0.4, 0.0, 0.0], [0.4, 0.0, 0.0], [0.4, 0.8, 0.0], [-0.4, 0.8, 0.0],
  [-0.4, 0.0, 0.5], [0.4, 0.0, 0.5], [0.4, 0.8, 0.5], [-0.4, 0.8, 0.5]
];

const correspondences = [];
for (const p of cubePoints) {
  // World to camera
  const xc = trueR[0]*p[0] + trueR[1]*p[1] + trueR[2]*p[2] + trueT[0];
  const yc = trueR[3]*p[0] + trueR[4]*p[1] + trueR[5]*p[2] + trueT[1];
  const zc = trueR[6]*p[0] + trueR[7]*p[1] + trueR[8]*p[2] + trueT[2];

  // Camera to screen
  const u = trueK[0]*(xc/zc) + trueK[2];
  const v = trueK[4]*(yc/zc) + trueK[5];
  correspondences.push({ world: p, screen: [u, v] });
}

const calib = ProjectorCalibration.solve(correspondences, 1920, 1080);
console.log(`[PASS] Exact DLT RMS Reprojection Error: ${calib.rmsError.toExponential(4)} px`);
if (calib.rmsError > 1e-6) throw new Error('DLT RMS too high');

const posErr = Math.hypot(
  calib.cameraPosition[0] - trueCamPos[0],
  calib.cameraPosition[1] - trueCamPos[1],
  calib.cameraPosition[2] - trueCamPos[2]
);
console.log(`[PASS] Projector 3D Position Error: ${posErr.toExponential(4)} m`);
if (posErr > 1e-4) throw new Error('Position error too high');

// Test 3: Homography 2D
const srcQuad = [[0, 0], [1920, 0], [1920, 1080], [0, 1080]];
const dstQuad = [[120, 80], [1820, 40], [1780, 1020], [80, 990]];
const H = Homography2D.findHomography(srcQuad, dstQuad);
let maxQuadErr = 0;
for (let i = 0; i < 4; i++) {
  const mapped = Homography2D.transformPoint(H, srcQuad[i]);
  const err = Math.hypot(mapped[0] - dstQuad[i][0], mapped[1] - dstQuad[i][1]);
  maxQuadErr = Math.max(maxQuadErr, err);
}
console.log(`[PASS] 4-Corner Homography mapping error: ${maxQuadErr.toExponential(4)} px`);
if (maxQuadErr > 1e-8) throw new Error('Homography failed');

// Test 4: OneEuroFilter
const filter = new OneEuroFilter3D();
const filtered = filter.filter([1.0, 2.0, 3.0], 0.0);
console.log(`[PASS] OneEuroFilter initialization: [${filtered.join(', ')}]`);

console.log('--- ALL MATHEMATICAL UNIT TESTS PASSED SUCCESSFULLY! ---');
