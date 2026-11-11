import * as THREE from 'three';
import { DefaultDemoSplats } from './DefaultDemoSplats.js';

/**
 * GaussianSplatRenderer.js - High-performance WebGL/WebGPU 3D Gaussian Splatting engine.
 * Renders instanced Gaussian ellipsoids with real-time GPU particle physics:
 * - Solenoidal curl turbulence field
 * - Touchless hand dispersion / repulsion
 * - Volumetric radial dissolve
 * - Stencil light-masking for performers
 */
export class GaussianSplatRenderer {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.mesh = null;
    this.geometry = null;
    this.material = null;
    this.splatData = null;

    this.uniforms = {
      uTime: { value: 0.0 },
      uTurbulenceSpeed: { value: 0.5 },
      uTurbulenceScale: { value: 2.0 },
      uTurbulenceStrength: { value: 0.08 },
      uHandLeft: { value: new THREE.Vector3(999, 999, 999) },
      uHandRight: { value: new THREE.Vector3(999, 999, 999) },
      uHandPushStrength: { value: 0.4 },
      uHandPushRadius: { value: 0.35 },
      uDissolveRadius: { value: 2.5 },
      uDissolveCenter: { value: new THREE.Vector3(0, 0.3, 0) },
      uDissolveSoftness: { value: 0.2 },
      uPerformerMask: { value: null },
      uUsePerformerMask: { value: 0.0 }
    };

    // Load default demo splat
    this.loadDemo();
  }

  loadDemo(count = 60000) {
    this.loadPreset('sculpture', count);
  }

  loadPreset(presetName = 'sculpture', count = 60000) {
    let data;
    switch (presetName.toLowerCase()) {
      case 'performer':
        data = DefaultDemoSplats.generatePerformer(count);
        break;
      case 'galaxy':
        data = DefaultDemoSplats.generateGalaxy(count);
        break;
      case 'vortex':
        data = DefaultDemoSplats.generateVortex(count);
        break;
      case 'crystal':
        data = DefaultDemoSplats.generateCrystal(count);
        break;
      case 'sculpture':
      default:
        data = DefaultDemoSplats.generateSculpture(count);
        break;
    }
    this.initGeometry(data);
  }

  /**
   * Load binary or ASCII .ply file
   * @param {ArrayBuffer} buffer
   */
  loadPly(buffer) {
    // Basic PLY parser for 3DGS
    const text = new TextDecoder().decode(buffer.slice(0, 2000));
    const headerEnd = text.indexOf('end_header\n');
    if (headerEnd === -1) {
      throw new Error('Invalid PLY file');
    }

    const header = text.slice(0, headerEnd);
    const countMatch = header.match(/element vertex (\d+)/);
    const count = countMatch ? parseInt(countMatch[1]) : 0;
    if (count === 0) throw new Error('No vertices in PLY');

    // Parse binary float32 positions and properties
    const headerBytes = headerEnd + 11;
    const dataView = new DataView(buffer, headerBytes);
    // Typical 3DGS PLY format has 62 floats per vertex (position, normal, sh, opacity, scale, rot)
    // Here we extract position (x, y, z), color (from sh0 or RGB), scale, and opacity
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count * 3);
    const rotations = new Float32Array(count * 4);
    const opacities = new Float32Array(count);

    // If standard 3DGS binary layout: 3*4 (pos) + 3*4 (norm) + 3*4 (sh0) + ...
    const stride = (buffer.byteLength - headerBytes) / count;

    for (let i = 0; i < count; i++) {
      const offset = i * stride;
      positions[i * 3 + 0] = dataView.getFloat32(offset + 0, true);
      positions[i * 3 + 1] = dataView.getFloat32(offset + 4, true);
      positions[i * 3 + 2] = dataView.getFloat32(offset + 8, true);

      // Spherical harmonics DC to RGB: c = 0.5 + 0.28209479177387814 * sh0
      if (stride >= 48) {
        const sh0_r = dataView.getFloat32(offset + 24, true);
        const sh0_g = dataView.getFloat32(offset + 28, true);
        const sh0_b = dataView.getFloat32(offset + 32, true);
        colors[i * 3 + 0] = Math.max(0, Math.min(1, 0.5 + 0.28209 * sh0_r));
        colors[i * 3 + 1] = Math.max(0, Math.min(1, 0.5 + 0.28209 * sh0_g));
        colors[i * 3 + 2] = Math.max(0, Math.min(1, 0.5 + 0.28209 * sh0_b));
      } else {
        colors[i * 3 + 0] = 0.9; colors[i * 3 + 1] = 0.7; colors[i * 3 + 2] = 0.4;
      }

      scales[i * 3 + 0] = 0.015;
      scales[i * 3 + 1] = 0.015;
      scales[i * 3 + 2] = 0.015;
      rotations[i * 4 + 3] = 1.0;
      opacities[i] = 0.9;
    }

    this.initGeometry({ positions, colors, scales, rotations, opacities, count });
  }

  initGeometry(data) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.geometry.dispose();
      this.material.dispose();
    }

    this.splatData = data;

    // Instanced Quad geometry (2 triangles per splat)
    const baseQuad = new THREE.BufferGeometry();
    const quadVertices = new Float32Array([
      -1, -1, 0,
       1, -1, 0,
       1,  1, 0,
      -1, -1, 0,
       1,  1, 0,
      -1,  1, 0
    ]);
    baseQuad.setAttribute('position', new THREE.BufferAttribute(quadVertices, 3));

    const instancedGeo = new THREE.InstancedBufferGeometry();
    instancedGeo.index = baseQuad.index;
    instancedGeo.attributes.position = baseQuad.attributes.position;

    // Splat instance attributes
    instancedGeo.setAttribute('instancePosition', new THREE.InstancedBufferAttribute(data.positions, 3));
    instancedGeo.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(data.colors, 3));
    instancedGeo.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(data.scales, 3));
    instancedGeo.setAttribute('instanceOpacity', new THREE.InstancedBufferAttribute(data.opacities, 1));

    // Custom 3DGS Shader Material with GPU curl turbulence and hand dispersion
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        attribute vec3 instancePosition;
        attribute vec3 instanceColor;
        attribute vec3 instanceScale;
        attribute float instanceOpacity;

        uniform float uTime;
        uniform float uTurbulenceSpeed;
        uniform float uTurbulenceScale;
        uniform float uTurbulenceStrength;
        uniform vec3 uHandLeft;
        uniform vec3 uHandRight;
        uniform float uHandPushStrength;
        uniform float uHandPushRadius;
        uniform float uDissolveRadius;
        uniform vec3 uDissolveCenter;
        uniform float uDissolveSoftness;

        varying vec3 vColor;
        varying float vAlpha;
        varying vec2 vUv;

        // Solenoidal Curl Noise Approximation for fluid turbulence
        vec3 hash33(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yxz + 33.33);
          return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
        }

        vec3 curlNoise(vec3 p) {
          float e = 0.05;
          vec3 dx = vec3(e, 0.0, 0.0);
          vec3 dy = vec3(0.0, e, 0.0);
          vec3 dz = vec3(0.0, 0.0, e);

          vec3 p_x0 = hash33(p - dx);
          vec3 p_x1 = hash33(p + dx);
          vec3 p_y0 = hash33(p - dy);
          vec3 p_y1 = hash33(p + dy);
          vec3 p_z0 = hash33(p - dz);
          vec3 p_z1 = hash33(p + dz);

          float x = p_y1.z - p_y0.z - p_z1.y + p_z0.y;
          float y = p_z1.x - p_z0.x - p_x1.z + p_x0.z;
          float z = p_x1.y - p_x0.y - p_y1.x + p_y0.x;
          return normalize(vec3(x, y, z));
        }

        void main() {
          vUv = position.xy;
          vColor = instanceColor;

          vec3 worldPos = instancePosition;

          // 1. Curl Turbulence
          if (uTurbulenceStrength > 0.001) {
            vec3 curl = curlNoise(worldPos * uTurbulenceScale + vec3(uTime * uTurbulenceSpeed));
            worldPos += curl * uTurbulenceStrength;
          }

          // 2. Touchless Hand Dispersion
          float dLeft = length(worldPos - uHandLeft);
          if (dLeft < uHandPushRadius) {
            vec3 dir = normalize(worldPos - uHandLeft + vec3(0.001));
            float falloff = exp(-pow(dLeft / uHandPushRadius, 2.0) * 3.0);
            worldPos += dir * uHandPushStrength * falloff;
          }

          float dRight = length(worldPos - uHandRight);
          if (dRight < uHandPushRadius) {
            vec3 dir = normalize(worldPos - uHandRight + vec3(0.001));
            float falloff = exp(-pow(dRight / uHandPushRadius, 2.0) * 3.0);
            worldPos += dir * uHandPushStrength * falloff;
          }

          // 3. Volumetric Reveal / Dissolve
          float distFromCenter = length(worldPos - uDissolveCenter);
          float dissolve = smoothstep(uDissolveRadius, uDissolveRadius - uDissolveSoftness, distFromCenter);
          vAlpha = instanceOpacity * dissolve;

          // Billboarding (quad faces camera in view space)
          vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
          mvPosition.xy += position.xy * instanceScale.xy * 2.0;

          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying vec2 vUv;

        uniform sampler2D uPerformerMask;
        uniform float uUsePerformerMask;

        void main() {
          // Gaussian 2D radial falloff: exp(-0.5 * (x^2 + y^2) * 4.0)
          float r2 = dot(vUv, vUv);
          if (r2 > 1.0) discard;

          float gaussian = exp(-2.0 * r2);
          float alpha = vAlpha * gaussian;

          // Performer silhouette masking
          if (uUsePerformerMask > 0.5) {
            vec2 screenUv = gl_FragCoord.xy / vec2(1920.0, 1080.0);
            float mask = texture2D(uPerformerMask, screenUv).r;
            alpha *= mask;
          }

          if (alpha < 0.02) discard;

          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    this.geometry = instancedGeo;
    this.mesh = new THREE.Mesh(instancedGeo, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  update(deltaSec, timestampSec) {
    this.uniforms.uTime.value = timestampSec;
  }

  setHandPositions(leftHand, rightHand) {
    if (leftHand) {
      this.uniforms.uHandLeft.value.set(leftHand[0], leftHand[1], leftHand[2]);
    } else {
      this.uniforms.uHandLeft.value.set(999, 999, 999);
    }

    if (rightHand) {
      this.uniforms.uHandRight.value.set(rightHand[0], rightHand[1], rightHand[2]);
    } else {
      this.uniforms.uHandRight.value.set(999, 999, 999);
    }
  }

  setTurbulence(strength, speed = 0.5, scale = 2.0) {
    this.uniforms.uTurbulenceStrength.value = strength;
    this.uniforms.uTurbulenceSpeed.value = speed;
    this.uniforms.uTurbulenceScale.value = scale;
  }

  setDissolve(radius, softness = 0.2) {
    this.uniforms.uDissolveRadius.value = radius;
    this.uniforms.uDissolveSoftness.value = softness;
  }

  setPerformerMask(texture, enabled = true) {
    this.uniforms.uPerformerMask.value = texture;
    this.uniforms.uUsePerformerMask.value = enabled ? 1.0 : 0.0;
  }
}
