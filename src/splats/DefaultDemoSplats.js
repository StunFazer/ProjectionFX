/**
 * DefaultDemoSplats.js - Generates procedural 3D Gaussian Splat clouds.
 * Allows instant testing of 3DGS physics, tracking, and projection mapping presets.
 */
export class DefaultDemoSplats {
  /**
   * Generates a 3D dual-torus / sculpture point cloud with color gradients and Gaussian scales.
   */
  static generateSculpture(count = 60000) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count * 3);
    const rotations = new Float32Array(count * 4);
    const opacities = new Float32Array(count);

    const R = 0.6;
    const r = 0.25;

    for (let i = 0; i < count; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * Math.PI * 2;
      const branch = Math.random() > 0.5 ? 1 : -1;

      const x = (R + r * Math.cos(v)) * Math.cos(u);
      const y = (R + r * Math.cos(v)) * Math.sin(u) * branch;
      const z = r * Math.sin(v) + (Math.sin(u * 2) * 0.15);

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y + 0.3;
      positions[i * 3 + 2] = z;

      const hue = (u / (Math.PI * 2) + v / (Math.PI * 4)) % 1.0;
      const rgb = DefaultDemoSplats.hsvToRgb(hue, 0.85, 0.95);
      colors[i * 3 + 0] = rgb[0];
      colors[i * 3 + 1] = rgb[1];
      colors[i * 3 + 2] = rgb[2];

      const baseScale = 0.012 + Math.random() * 0.008;
      scales[i * 3 + 0] = baseScale * 1.5;
      scales[i * 3 + 1] = baseScale * 0.8;
      scales[i * 3 + 2] = baseScale * 0.5;

      rotations[i * 4 + 3] = 1.0;
      opacities[i] = 0.75 + Math.random() * 0.25;
    }

    return { positions, colors, scales, rotations, opacities, count };
  }

  /**
   * Generates a dynamic 3D humanoid performer avatar with glowing aura.
   */
  static generatePerformer(count = 60000) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count * 3);
    const rotations = new Float32Array(count * 4);
    const opacities = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      let x = 0, y = 0, z = 0;
      const r = Math.random();

      if (r < 0.15) {
        // Head sphere
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const rad = 0.12 * Math.cbrt(Math.random());
        x = rad * Math.sin(phi) * Math.cos(theta);
        y = 0.85 + rad * Math.cos(phi);
        z = rad * Math.sin(phi) * Math.sin(theta);
      } else if (r < 0.50) {
        // Torso cylinder / oval
        const h = Math.random() * 0.45;
        const rad = (0.16 - h * 0.08) * Math.sqrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        x = rad * Math.cos(theta) * 1.3;
        y = 0.35 + h;
        z = rad * Math.sin(theta) * 0.8;
      } else if (r < 0.75) {
        // Arms
        const side = Math.random() > 0.5 ? 1 : -1;
        const prog = Math.random();
        const rad = 0.05 * Math.sqrt(Math.random());
        const angle = Math.random() * Math.PI * 2;
        x = side * (0.22 + prog * 0.32) + rad * Math.cos(angle);
        y = 0.72 - prog * 0.35 + rad * Math.sin(angle);
        z = prog * 0.15 + (Math.random() - 0.5) * 0.05;
      } else {
        // Legs & energetic aura halo
        const side = Math.random() > 0.5 ? 1 : -1;
        const prog = Math.random();
        const rad = 0.06 * Math.sqrt(Math.random());
        const angle = Math.random() * Math.PI * 2;
        x = side * (0.10 + prog * 0.08) + rad * Math.cos(angle);
        y = 0.35 - prog * 0.55 + rad * Math.sin(angle);
        z = (Math.random() - 0.5) * 0.08;
      }

      // Add soft energetic particle jitter
      x += (Math.random() - 0.5) * 0.03;
      y += (Math.random() - 0.5) * 0.03;
      z += (Math.random() - 0.5) * 0.03;

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Electric cyan / neon magenta performer palette
      const t = (y + 0.2) / 1.1;
      colors[i * 3 + 0] = 0.1 + 0.8 * (1.0 - t); // R
      colors[i * 3 + 1] = 0.8 * Math.sin(t * Math.PI); // G
      colors[i * 3 + 2] = 0.95; // B

      const baseScale = 0.010 + Math.random() * 0.008;
      scales[i * 3 + 0] = baseScale;
      scales[i * 3 + 1] = baseScale;
      scales[i * 3 + 2] = baseScale;

      rotations[i * 4 + 3] = 1.0;
      opacities[i] = 0.7 + Math.random() * 0.3;
    }

    return { positions, colors, scales, rotations, opacities, count };
  }

  /**
   * Generates a celestial cosmic galaxy spiral with dense glowing core.
   */
  static generateGalaxy(count = 60000) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count * 3);
    const rotations = new Float32Array(count * 4);
    const opacities = new Float32Array(count);

    const numArms = 3;
    const armSeparation = (Math.PI * 2) / numArms;

    for (let i = 0; i < count; i++) {
      const dist = Math.pow(Math.random(), 2.0) * 0.85;
      const angle = (i % numArms) * armSeparation + dist * 5.0;

      const spreadX = (Math.random() - 0.5) * (0.04 + dist * 0.12);
      const spreadY = (Math.random() - 0.5) * (0.02 + dist * 0.05);
      const spreadZ = (Math.random() - 0.5) * (0.04 + dist * 0.12);

      positions[i * 3 + 0] = Math.cos(angle) * dist + spreadX;
      positions[i * 3 + 1] = 0.3 + spreadY;
      positions[i * 3 + 2] = Math.sin(angle) * dist + spreadZ;

      // Violet / gold stellar gradient
      const coreFactor = Math.max(0, 1.0 - dist * 1.5);
      colors[i * 3 + 0] = 0.4 + coreFactor * 0.6;
      colors[i * 3 + 1] = 0.2 + coreFactor * 0.6;
      colors[i * 3 + 2] = 0.95;

      const baseScale = 0.008 + (1.0 - dist) * 0.01;
      scales[i * 3 + 0] = baseScale;
      scales[i * 3 + 1] = baseScale;
      scales[i * 3 + 2] = baseScale;

      rotations[i * 4 + 3] = 1.0;
      opacities[i] = 0.6 + Math.random() * 0.4;
    }

    return { positions, colors, scales, rotations, opacities, count };
  }

  /**
   * Generates a hydrodynamic fluid vortex with swirling filaments.
   */
  static generateVortex(count = 60000) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count * 3);
    const rotations = new Float32Array(count * 4);
    const opacities = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const t = Math.random();
      const z = (t - 0.5) * 0.8;
      const radius = 0.08 + Math.pow(Math.abs(z), 0.7) * 0.55;
      const angle = t * Math.PI * 14.0 + (Math.random() - 0.5) * 0.4;

      positions[i * 3 + 0] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.3 + z;
      positions[i * 3 + 2] = Math.sin(angle) * radius;

      // Emerald to teal aqua fluid colors
      const hue = 0.38 + t * 0.2;
      const rgb = DefaultDemoSplats.hsvToRgb(hue, 0.9, 0.95);
      colors[i * 3 + 0] = rgb[0];
      colors[i * 3 + 1] = rgb[1];
      colors[i * 3 + 2] = rgb[2];

      const baseScale = 0.010 + Math.random() * 0.008;
      scales[i * 3 + 0] = baseScale * 1.8;
      scales[i * 3 + 1] = baseScale * 0.6;
      scales[i * 3 + 2] = baseScale * 0.6;

      rotations[i * 4 + 3] = 1.0;
      opacities[i] = 0.8;
    }

    return { positions, colors, scales, rotations, opacities, count };
  }

  /**
   * Generates an octahedral geometric crystal lattice.
   */
  static generateCrystal(count = 60000) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count * 3);
    const rotations = new Float32Array(count * 4);
    const opacities = new Float32Array(count);

    const size = 0.45;

    for (let i = 0; i < count; i++) {
      // Pick random point on 8 triangular faces of an octahedron
      const sx = Math.random() > 0.5 ? 1 : -1;
      const sy = Math.random() > 0.5 ? 1 : -1;
      const sz = Math.random() > 0.5 ? 1 : -1;

      let r1 = Math.random();
      let r2 = Math.random();
      if (r1 + r2 > 1.0) {
        r1 = 1.0 - r1;
        r2 = 1.0 - r2;
      }
      const r3 = 1.0 - r1 - r2;

      // Jitter inside the facet
      const thickness = 0.92 + Math.random() * 0.12;
      const x = sx * r1 * size * thickness;
      const y = sy * r2 * size * thickness + 0.35;
      const z = sz * r3 * size * thickness;

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Topaz and golden amber refraction colors
      const facetHue = (sx * 0.05 + sy * 0.08 + sz * 0.03 + 0.12 + 1.0) % 1.0;
      const rgb = DefaultDemoSplats.hsvToRgb(facetHue, 0.85, 0.98);
      colors[i * 3 + 0] = rgb[0];
      colors[i * 3 + 1] = rgb[1];
      colors[i * 3 + 2] = rgb[2];

      const baseScale = 0.009 + Math.random() * 0.006;
      scales[i * 3 + 0] = baseScale;
      scales[i * 3 + 1] = baseScale;
      scales[i * 3 + 2] = baseScale;

      rotations[i * 4 + 3] = 1.0;
      opacities[i] = 0.85;
    }

    return { positions, colors, scales, rotations, opacities, count };
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
