/**
 * DefaultDemoSplats.js - Generates procedural 3D Gaussian Splat clouds.
 * Allows the application to be tested immediately without requiring external multi-hundred-megabyte PLY files.
 */
export class DefaultDemoSplats {
  /**
   * Generates a 3D dual-torus / sculpture point cloud with color gradients and Gaussian scales.
   * @param {number} count Number of splats (default 60,000)
   * @returns {{ positions: Float32Array, colors: Float32Array, scales: Float32Array, rotations: Float32Array, opacities: Float32Array, count: number }}
   */
  static generateSculpture(count = 60000) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count * 3);
    const rotations = new Float32Array(count * 4); // quaternions [x, y, z, w]
    const opacities = new Float32Array(count);

    const R = 0.6; // Major radius
    const r = 0.25; // Minor radius

    for (let i = 0; i < count; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * Math.PI * 2;
      const branch = Math.random() > 0.5 ? 1 : -1;

      // Twisted Klein / Moebius torus
      const x = (R + r * Math.cos(v)) * Math.cos(u);
      const y = (R + r * Math.cos(v)) * Math.sin(u) * branch;
      const z = r * Math.sin(v) + (Math.sin(u * 2) * 0.15);

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y + 0.3; // Center elevation
      positions[i * 3 + 2] = z;

      // Radiant iridescent color palette
      const hue = (u / (Math.PI * 2) + v / (Math.PI * 4)) % 1.0;
      const rgb = this.hsvToRgb(hue, 0.85, 0.95);
      colors[i * 3 + 0] = rgb[0];
      colors[i * 3 + 1] = rgb[1];
      colors[i * 3 + 2] = rgb[2];

      // Splat scale (anisotropic discs)
      const baseScale = 0.012 + Math.random() * 0.008;
      scales[i * 3 + 0] = baseScale * 1.5;
      scales[i * 3 + 1] = baseScale * 0.8;
      scales[i * 3 + 2] = baseScale * 0.5;

      // Identity / random rotation
      rotations[i * 4 + 0] = 0.0;
      rotations[i * 4 + 1] = 0.0;
      rotations[i * 4 + 2] = 0.0;
      rotations[i * 4 + 3] = 1.0;

      opacities[i] = 0.75 + Math.random() * 0.25;
    }

    return {
      positions,
      colors,
      scales,
      rotations,
      opacities,
      count
    };
  }

  static hsvToRgb(h, s, v) {
    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return [r, g, b];
  }
}
