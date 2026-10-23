/**
 * 🌸 3D Botanical Oriental Lily — Ultra-Photorealistic Physical WebGL Engine
 * Features:
 *  - Procedural PBR Textures (Rich Crimson-Magenta Stargazer Heart, 3D Raised Papillae Glands, Micro-Venation)
 *  - Physically-Based Subsurface Scattering (SSS) & Translucent Back-Scattering
 *  - Dual-Lobe Specular Highlights (Waxy Cuticle Sheen + Micro-Velvet Grazing Fuzz)
 *  - Throat Cavity Ambient Occlusion & ACES Filmic Tone Mapping
 *  - Living Breeze Dynamic Sway & Delicate Petal Edge Fluttering
 *  - Glistening Morning Dewdrops with Water Refraction & Specular Glints
 *  - Auto-Adaptive Mobile Camera Framing (Fits 100% of the bouquet on any phone screen without cropping)
 *  - 3 Atmospheric Lighting Presets: Studio Specimen &bull; Golden Hour &bull; Midnight
 *  - Instant Initial Full Bloom on Load + Interactive Replay & Scrubbing (0s to 13s)
 */

(function () {
  'use strict';

  const DURATION = 13.0;
  let currentTime = 6.0; // Start in full, gorgeous bloom so the flower is immediately visible!
  let isPlaying = true;
  let isAutoCamera = true;
  let showWireframe = true;
  let showFrameGuide = false;
  let playbackSpeed = 1.0;
  let enableLivingWind = true;
  let enableDewdrops = true;
  let lightingPresetIndex = 1; // Default to Golden Hour!

  const LIGHT_PRESETS = [
    {
      name: "Studio Specimen",
      icon: "🌸",
      keyPos: [-2.5, 4.5, 3.2],
      keyCol: [1.15, 1.10, 1.05],
      fillPos: [3.2, -1.0, 2.5],
      fillCol: [0.65, 0.75, 0.95],
      rimPos: [0.2, 3.5, -4.5],
      rimCol: [1.10, 0.75, 0.85],
      ambientCol: [0.22, 0.18, 0.20],
      bgGrad: "radial-gradient(ellipse 70% 65% at 50% 45%, #2a1c22 0%, #171116 55%, #090708 100%)"
    },
    {
      name: "Golden Hour",
      icon: "🌅",
      keyPos: [-3.2, 3.8, 3.5],
      keyCol: [1.35, 1.05, 0.75],
      fillPos: [3.0, -1.2, 2.2],
      fillCol: [0.85, 0.50, 0.65],
      rimPos: [0.2, 3.5, -4.5],
      rimCol: [1.45, 0.65, 0.75],
      ambientCol: [0.26, 0.14, 0.18],
      bgGrad: "radial-gradient(ellipse 75% 70% at 48% 42%, #381a24 0%, #201018 55%, #0d060a 100%)"
    },
    {
      name: "Midnight Enchanted",
      icon: "🌙",
      keyPos: [2.8, 4.8, 3.0],
      keyCol: [0.95, 1.05, 1.35],
      fillPos: [-3.0, -1.0, 2.0],
      fillCol: [0.90, 0.35, 0.80],
      rimPos: [0.0, 3.5, -4.5],
      rimCol: [1.35, 0.40, 0.95],
      ambientCol: [0.12, 0.08, 0.18],
      bgGrad: "radial-gradient(ellipse 70% 65% at 50% 45%, #181228 0%, #0e0918 55%, #050308 100%)"
    }
  ];

  // ---------------------------------------------------------------------------
  // MATHEMATICAL & EASING UTILITIES
  // ---------------------------------------------------------------------------
  function clamp(x, lo = 0.0, hi = 1.0) {
    return Math.max(lo, Math.min(hi, x));
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / Math.max(1e-8, edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }

  function smootherstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / Math.max(1e-8, edge1 - edge0), 0.0, 1.0);
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  }

  function norm3(v) {
    return Math.hypot(v[0], v[1], v[2]);
  }

  function normalize3(v) {
    const d = norm3(v) || 1e-8;
    return [v[0] / d, v[1] / d, v[2] / d];
  }

  function dot3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function cross3(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  function rotX(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [
      [1, 0, 0],
      [0, c, -s],
      [0, s, c]
    ];
  }

  function rotY(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [
      [c, 0, s],
      [0, 1, 0],
      [-s, 0, c]
    ];
  }

  function matMulVec(m, v) {
    return [
      m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
      m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
      m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
    ];
  }

  function buildBasisFromDir(direction, upHint = [0.0, 1.0, 0.0]) {
    const yAxis = normalize3(direction);
    if (Math.abs(dot3(yAxis, upHint)) > 0.95) {
      upHint = [0.0, 0.0, 1.0];
    }
    let xAxis = cross3(upHint, yAxis);
    xAxis = normalize3(xAxis);
    let zAxis = cross3(xAxis, yAxis);
    zAxis = normalize3(zAxis);
    return [
      [xAxis[0], yAxis[0], zAxis[0]],
      [xAxis[1], yAxis[1], zAxis[1]],
      [xAxis[2], yAxis[2], zAxis[2]]
    ];
  }

  function evalCubicBezier(p0, p1, p2, p3, u) {
    const om = 1.0 - u;
    const om2 = om * om;
    const om3 = om2 * om;
    const u2 = u * u;
    const u3 = u2 * u;

    const pos = [
      om3 * p0[0] + 3 * om2 * u * p1[0] + 3 * om * u2 * p2[0] + u3 * p3[0],
      om3 * p0[1] + 3 * om2 * u * p1[1] + 3 * om * u2 * p2[1] + u3 * p3[1],
      om3 * p0[2] + 3 * om2 * u * p1[2] + 3 * om * u2 * p2[2] + u3 * p3[2]
    ];

    const tan = [
      3 * om2 * (p1[0] - p0[0]) + 6 * om * u * (p2[0] - p1[0]) + 3 * u2 * (p3[0] - p2[0]),
      3 * om2 * (p1[1] - p0[1]) + 6 * om * u * (p2[1] - p1[1]) + 3 * u2 * (p3[1] - p2[1]),
      3 * om2 * (p1[2] - p0[2]) + 6 * om * u * (p2[2] - p1[2]) + 3 * u2 * (p3[2] - p2[2])
    ];

    return { pos, tan };
  }

  function computeBishopFrame(tangents) {
    const Nu = tangents.length;
    const N1 = new Array(Nu);
    const N2 = new Array(Nu);

    const t0 = tangents[0];
    let ref = [0.0, 0.0, 1.0];
    if (Math.abs(dot3(t0, ref)) > 0.9) {
      ref = [1.0, 0.0, 0.0];
    }
    let n1 = normalize3(cross3(t0, ref));
    let n2 = cross3(t0, n1);
    N1[0] = n1;
    N2[0] = n2;

    for (let i = 1; i < Nu; i++) {
      const ti = tangents[i];
      const d = dot3(n1, ti);
      let n1_proj = [n1[0] - d * ti[0], n1[1] - d * ti[1], n1[2] - d * ti[2]];
      let norm = norm3(n1_proj);
      if (norm < 1e-6) {
        n1_proj = cross3(ti, n2);
        norm = norm3(n1_proj);
      }
      n1 = normalize3(n1_proj);
      n2 = cross3(ti, n1);
      N1[i] = n1;
      N2[i] = n2;
    }
    return { N1, N2 };
  }

  // ---------------------------------------------------------------------------
  // PROCEDURAL HIGH-RESOLUTION PBR TEXTURES
  // ---------------------------------------------------------------------------
  const textureCache = {};

  function generatePetalTexture(variant) {
    if (textureCache[variant]) return textureCache[variant];

    const W = 1024, H = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Base pure snow-white velvety ivory
    ctx.fillStyle = '#fefdfb';
    ctx.fillRect(0, 0, W, H);

    let cDeepR = 195, cDeepG = 16, cDeepB = 72;
    let cBlushR = 242, cBlushG = 95, cBlushB = 145;
    if (variant === 'soft_rose') {
      cDeepR = 212; cDeepG = 42; cDeepB = 102;
      cBlushR = 246; cBlushG = 135; cBlushB = 175;
    } else if (variant === 'blush_ivory') {
      cDeepR = 222; cDeepG = 70; cDeepB = 120;
      cBlushR = 248; cBlushG = 168; cBlushB = 198;
    }

    // Radial Crimson Heart
    const heartGrad = ctx.createRadialGradient(W * 0.28, H * 0.5, W * 0.04, W * 0.38, H * 0.5, W * 0.52);
    heartGrad.addColorStop(0, `rgba(${cDeepR}, ${cDeepG}, ${cDeepB}, 0.95)`);
    heartGrad.addColorStop(0.35, `rgba(${cDeepR}, ${cDeepG}, ${cDeepB}, 0.85)`);
    heartGrad.addColorStop(0.65, `rgba(${cBlushR}, ${cBlushG}, ${cBlushB}, 0.55)`);
    heartGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = heartGrad;
    ctx.fillRect(0, 0, W, H);

    // Lime Nectar Star at Throat
    const nectarGrad = ctx.createRadialGradient(0, H * 0.5, 0, W * 0.20, H * 0.5, W * 0.26);
    nectarGrad.addColorStop(0, '#529e24');
    nectarGrad.addColorStop(0.55, '#74be32');
    nectarGrad.addColorStop(0.85, 'rgba(116, 190, 50, 0.4)');
    nectarGrad.addColorStop(1, 'rgba(116, 190, 50, 0)');
    ctx.fillStyle = nectarGrad;
    ctx.fillRect(0, 0, W * 0.35, H);

    // Central Midrib Vein
    const midribGrad = ctx.createLinearGradient(0, 0, W, 0);
    midribGrad.addColorStop(0, 'rgba(80, 150, 35, 0.8)');
    midribGrad.addColorStop(0.2, `rgba(${cDeepR}, ${cDeepG}, ${cDeepB}, 0.85)`);
    midribGrad.addColorStop(0.8, 'rgba(250, 240, 245, 0.5)');
    midribGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = midribGrad;
    ctx.fillRect(0, H * 0.492, W, H * 0.016);

    // Fine Longitudinal Micro-Venation
    ctx.lineWidth = 1.2;
    for (let v = 0.08; v <= 0.92; v += 0.038) {
      if (Math.abs(v - 0.5) < 0.03) continue;
      ctx.strokeStyle = `rgba(${cDeepR}, ${cDeepG}, ${cDeepB}, 0.09)`;
      ctx.beginPath();
      const y0 = H * v;
      ctx.moveTo(0, y0);
      ctx.bezierCurveTo(W * 0.4, y0 + (v - 0.5) * 18, W * 0.7, y0 + (v - 0.5) * 32, W, H * 0.5 + (v - 0.5) * H * 0.4);
      ctx.stroke();
    }

    // 75+ Discrete Raised Botanical Papillae Glands
    let seed = 101;
    function prng() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280.0;
    }

    for (let s = 0; s < 75; s++) {
      const px = (0.16 + 0.48 * prng()) * W;
      const pySide = prng() < 0.5 ? -1 : 1;
      const py = (0.5 + pySide * (0.06 + 0.38 * prng())) * H;
      const rad = 3.5 + 4.5 * prng();

      // Soft crimson halo
      ctx.fillStyle = 'rgba(160, 25, 75, 0.45)';
      ctx.beginPath();
      ctx.arc(px, py, rad * 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Deep dark burgundy core
      ctx.fillStyle = '#3a081a';
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();

      // Specular gland glint dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px - rad * 0.35, py - rad * 0.35, rad * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    textureCache[variant] = tex;
    return tex;
  }

  function generateLeafTexture() {
    if (textureCache['leaf']) return textureCache['leaf'];

    const W = 512, H = 512;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1c421f';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#4da23e';
    ctx.fillRect(0, H * 0.48, W, H * 0.04);

    ctx.strokeStyle = 'rgba(77, 162, 62, 0.22)';
    ctx.lineWidth = 1.5;
    for (let y = 30; y < H; y += 36) {
      if (Math.abs(y - H * 0.5) < 20) continue;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    textureCache['leaf'] = tex;
    return tex;
  }

  function generateAntherTexture() {
    if (textureCache['anther']) return textureCache['anther'];

    const W = 256, H = 256;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#bf4e08';
    ctx.fillRect(0, 0, W, H);

    let seed = 77;
    function prng() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280.0;
    }
    for (let i = 0; i < 1800; i++) {
      const x = prng() * W;
      const y = prng() * H;
      const r = 0.8 + 1.6 * prng();
      ctx.fillStyle = prng() < 0.5 ? '#f49416' : '#943204';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    textureCache['anther'] = tex;
    return tex;
  }

  let dummy1x1Tex = null;
  function getDummyTexture() {
    if (!dummy1x1Tex) {
      dummy1x1Tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
      dummy1x1Tex.needsUpdate = true;
    }
    return dummy1x1Tex;
  }

  // ---------------------------------------------------------------------------
  // PHOTOREALISTIC BOTANICAL SHADERS
  // ---------------------------------------------------------------------------
  const botanicalVertexShader = `
    attribute vec3 aPosClosed;
    attribute float aEffU;
    attribute float aIsPetal;
    attribute vec2 aUv;

    uniform float u_time;
    uniform float u_surfT0;
    uniform float u_surfT1;
    uniform float u_bloomEnd;
    uniform float u_windStrength;

    varying vec3 vNormal;
    varying vec3 vColor;
    varying vec3 vViewPos;
    varying vec3 vWorldPos;
    varying float vEffU;
    varying vec2 vUv;
    varying float vIsPetal;

    float smootherstep(float edge0, float edge1, float x) {
      float t = clamp((x - edge0) / max(1e-8, edge1 - edge0), 0.0, 1.0);
      return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    }

    void main() {
      vColor = color;
      vEffU = aEffU;
      vUv = aUv;
      vIsPetal = aIsPetal;

      vec3 finalPos = position;
      if (aIsPetal > 0.5) {
        float bloom_t = smootherstep(u_surfT0, u_bloomEnd, u_time);
        bloom_t = 0.28 + 0.72 * bloom_t;
        finalPos = mix(aPosClosed, position, bloom_t);
      }

      // Living Botanical Breeze Sway & Petal Tip Flutter
      if (u_windStrength > 0.01) {
        float swayFactor = clamp((u_time - 0.5) / 2.0, 0.0, 1.0) * u_windStrength;
        float heightFactor = pow(clamp((position.y + 2.55) / 4.2, 0.0, 1.0), 1.6);
        float w1 = sin(u_time * 1.35 + position.y * 0.8 + position.x * 0.4) * 0.026;
        float w2 = cos(u_time * 0.95 + position.y * 0.6 + position.z * 0.5) * 0.018;
        finalPos.x += w1 * heightFactor * swayFactor;
        finalPos.z += w2 * heightFactor * swayFactor;
        if (aIsPetal > 0.5) {
          float flutter = sin(u_time * 3.4 + position.x * 6.0 + position.z * 6.0) * 0.007 * aEffU * swayFactor;
          finalPos += normal * flutter;
        }
      }

      vec4 worldPos = modelMatrix * vec4(finalPos, 1.0);
      vWorldPos = worldPos.xyz;
      vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      vec4 mvPosition = viewMatrix * worldPos;
      vViewPos = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const botanicalFragmentShader = `
    uniform float u_time;
    uniform float u_surfT0;
    uniform float u_surfT1;
    uniform float u_sssStrength;
    uniform float u_specStrength;
    uniform float u_shininess;

    uniform vec3 u_keyPos;
    uniform vec3 u_keyCol;
    uniform vec3 u_fillPos;
    uniform vec3 u_fillCol;
    uniform vec3 u_rimPos;
    uniform vec3 u_rimCol;
    uniform vec3 u_ambientCol;

    uniform sampler2D u_diffuseMap;
    uniform int u_useTexture;

    varying vec3 vNormal;
    varying vec3 vColor;
    varying vec3 vViewPos;
    varying vec3 vWorldPos;
    varying float vEffU;
    varying vec2 vUv;
    varying float vIsPetal;

    float smootherstep(float edge0, float edge1, float x) {
      float t = clamp((x - edge0) / max(1e-8, edge1 - edge0), 0.0, 1.0);
      return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    }

    void main() {
      if (u_time < u_surfT0) discard;

      float s_prog = smootherstep(u_surfT0, u_surfT1, u_time);
      if (vEffU > (s_prog * 1.03)) discard;

      vec3 N = normalize(vNormal);
      if (!gl_FrontFacing) N = -N;
      vec3 V = normalize(cameraPosition - vWorldPos);

      // Albedo Color
      vec3 albedo;
      if (u_useTexture == 1) {
        albedo = texture2D(u_diffuseMap, vUv).rgb;
      } else {
        albedo = vColor;
      }

      // Micro-texture venation
      float microVein = pow(0.5 + 0.5 * cos((vUv.y - 0.5) * 52.0 * 3.14159), 6.0) * 0.035;
      albedo = clamp(albedo - vec3(microVein), 0.0, 1.0);

      // 1. Key Light
      vec3 L_key = normalize(u_keyPos - vWorldPos);
      float wrap_key = clamp((dot(N, L_key) + 0.35) / 1.35, 0.0, 1.0);

      // 2. Fill Light
      vec3 L_fill = normalize(u_fillPos - vWorldPos);
      float wrap_fill = clamp((dot(N, L_fill) + 0.45) / 1.45, 0.0, 1.0);

      // 3. Rim / Backlight for Subsurface Scattering (SSS)
      vec3 L_rim = normalize(u_rimPos - vWorldPos);
      float ndotv = clamp(dot(N, V), 0.0, 1.0);
      float fresnel_rim = pow(1.0 - ndotv, 2.5);

      float back_scatter = clamp(dot(V, -L_key) * 0.6 + 0.4, 0.0, 1.0);
      float thinness = vIsPetal > 0.5 ? (0.65 + 0.35 * smoothstep(0.2, 0.9, vEffU)) : 0.4;
      vec3 sss_glow = albedo * u_sssStrength * thinness * (0.55 * fresnel_rim + 0.45 * back_scatter) * vec3(1.15, 0.55, 0.65);

      // 4. Dual-Lobe Specular Highlights:
      // Lobe A: Waxy Cuticle Glint
      vec3 H_key = normalize(L_key + V);
      float ndoth = clamp(dot(N, H_key), 0.0, 1.0);
      float spec_cuticle = u_specStrength * pow(ndoth, u_shininess) * (0.25 + 0.75 * fresnel_rim);

      // Lobe B: Micro-Velvet Sheen at Grazing Angles
      float velvet_sheen = (vIsPetal > 0.5 ? 0.35 : 0.12) * pow(1.0 - ndotv, 4.0);

      // Throat Cavity Ambient Occlusion
      float throatAO = vIsPetal > 0.5 ? (0.55 + 0.45 * smoothstep(0.05, 0.35, vEffU)) : 1.0;

      // Composite Photorealistic Lighting
      vec3 directLight = albedo * (wrap_key * u_keyCol + wrap_fill * u_fillCol * 0.6);
      vec3 ambientLight = albedo * u_ambientCol * throatAO;
      vec3 specularTotal = (spec_cuticle + velvet_sheen) * vec3(1.0, 0.98, 0.95);

      vec3 lit_rgb = (directLight + ambientLight) * throatAO + sss_glow + specularTotal;

      // Progressive Golden Wavefront Edge Glow during construction
      if (s_prog < 0.995) {
        float dist_edge = (s_prog * 1.03) - vEffU;
        if (dist_edge >= 0.0 && dist_edge < 0.055) {
          float rim_glow = exp(-pow(dist_edge / 0.055, 2.0));
          lit_rgb += 0.65 * rim_glow * vec3(1.0, 0.88, 0.55);
        }
      }

      // ACES Filmic Curve for vibrant organic colors without saturation clipping
      lit_rgb = clamp(lit_rgb, 0.0, 1.6);
      lit_rgb = (lit_rgb * (2.51 * lit_rgb + 0.03)) / (lit_rgb * (2.43 * lit_rgb + 0.59) + 0.14);

      gl_FragColor = vec4(clamp(lit_rgb, 0.0, 1.0), 1.0);
    }
  `;

  // Wireframe line shader
  const wireVertexShader = `
    attribute float aEffU;
    uniform float u_time;
    uniform float u_wireT0;
    uniform float u_wireT1;

    varying float vEffU;
    varying vec3 vColor;

    void main() {
      vColor = color;
      vEffU = aEffU;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const wireFragmentShader = `
    uniform float u_time;
    uniform float u_wireT0;
    uniform float u_wireT1;
    uniform float u_surfT0;
    uniform float u_surfT1;

    varying float vEffU;
    varying vec3 vColor;

    float smootherstep(float edge0, float edge1, float x) {
      float t = clamp((x - edge0) / max(1e-8, edge1 - edge0), 0.0, 1.0);
      return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    }

    void main() {
      if (u_time < u_wireT0) discard;

      float w_prog = smootherstep(u_wireT0, u_wireT1, u_time);
      if (vEffU > w_prog) discard;

      float global_wire_alpha = 1.0 - smootherstep(9.6, 11.4, u_time);
      float s_prog = smootherstep(u_surfT0, u_surfT1, u_time);
      float wire_vis = global_wire_alpha * (1.0 - 0.82 * smootherstep(0.60, 1.0, s_prog));

      if (wire_vis <= 0.03) discard;

      gl_FragColor = vec4(vColor, wire_vis * 0.72);
    }
  `;

  // ---------------------------------------------------------------------------
  // MESH CREATION & MATERIAL FACTORY
  // ---------------------------------------------------------------------------
  const animatedMaterials = [];
  const animatedWireMaterials = [];

  function createMeshFromGrid(Nu, Nv, P, C, effU, P_closed, kind, sss, spec, shine, wireColor, wireT0, wireT1, surfT0, surfT1, bloomEnd = 13.0, variant = 'stargazer') {
    const numVerts = Nu * Nv;
    const positions = new Float32Array(numVerts * 3);
    const posClosed = new Float32Array(numVerts * 3);
    const colors = new Float32Array(numVerts * 3);
    const effUAttr = new Float32Array(numVerts);
    const isPetalAttr = new Float32Array(numVerts);
    const uvsAttr = new Float32Array(numVerts * 2);

    const isPetal = kind === 'petal';

    for (let i = 0; i < Nu; i++) {
      const u = i / (Nu - 1);
      for (let j = 0; j < Nv; j++) {
        const v = j / (Nv - 1);
        const idx = i * Nv + j;
        const p = P[i][j];
        positions[idx * 3] = p[0];
        positions[idx * 3 + 1] = p[1];
        positions[idx * 3 + 2] = p[2];

        if (P_closed) {
          const pc = P_closed[i][j];
          posClosed[idx * 3] = pc[0];
          posClosed[idx * 3 + 1] = pc[1];
          posClosed[idx * 3 + 2] = pc[2];
        } else {
          posClosed[idx * 3] = p[0];
          posClosed[idx * 3 + 1] = p[1];
          posClosed[idx * 3 + 2] = p[2];
        }

        const c = C[i][j];
        colors[idx * 3] = c[0];
        colors[idx * 3 + 1] = c[1];
        colors[idx * 3 + 2] = c[2];

        effUAttr[idx] = effU[i][j];
        isPetalAttr[idx] = isPetal ? 1.0 : 0.0;

        uvsAttr[idx * 2] = u;
        uvsAttr[idx * 2 + 1] = v;
      }
    }

    const indices = [];
    for (let i = 0; i < Nu - 1; i++) {
      for (let j = 0; j < Nv - 1; j++) {
        const i00 = i * Nv + j;
        const i10 = (i + 1) * Nv + j;
        const i11 = (i + 1) * Nv + (j + 1);
        const i01 = i * Nv + (j + 1);

        indices.push(i00, i10, i11);
        indices.push(i00, i11, i01);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aPosClosed', new THREE.BufferAttribute(posClosed, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aEffU', new THREE.BufferAttribute(effUAttr, 1));
    geometry.setAttribute('aIsPetal', new THREE.BufferAttribute(isPetalAttr, 1));
    geometry.setAttribute('aUv', new THREE.BufferAttribute(uvsAttr, 2));
    geometry.computeVertexNormals();

    // Select PBR Texture
    let diffTex = null;
    let useTexture = 0;
    if (isPetal) {
      diffTex = generatePetalTexture(variant);
      useTexture = 1;
    } else if (kind === 'leaf') {
      diffTex = generateLeafTexture();
      useTexture = 1;
    } else if (kind === 'anther') {
      diffTex = generateAntherTexture();
      useTexture = 1;
    } else {
      diffTex = getDummyTexture();
      useTexture = 0;
    }

    const currLight = LIGHT_PRESETS[lightingPresetIndex];

    const material = new THREE.ShaderMaterial({
      vertexShader: botanicalVertexShader,
      fragmentShader: botanicalFragmentShader,
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      uniforms: {
        u_time: { value: currentTime },
        u_surfT0: { value: surfT0 },
        u_surfT1: { value: surfT1 },
        u_bloomEnd: { value: bloomEnd },
        u_sssStrength: { value: sss },
        u_specStrength: { value: spec },
        u_shininess: { value: shine },
        u_windStrength: { value: 1.0 },
        u_keyPos: { value: new THREE.Vector3(...currLight.keyPos) },
        u_keyCol: { value: new THREE.Vector3(...currLight.keyCol) },
        u_fillPos: { value: new THREE.Vector3(...currLight.fillPos) },
        u_fillCol: { value: new THREE.Vector3(...currLight.fillCol) },
        u_rimPos: { value: new THREE.Vector3(...currLight.rimPos) },
        u_rimCol: { value: new THREE.Vector3(...currLight.rimCol) },
        u_ambientCol: { value: new THREE.Vector3(...currLight.ambientCol) },
        u_diffuseMap: { value: diffTex },
        u_useTexture: { value: useTexture }
      }
    });

    animatedMaterials.push(material);

    const mesh = new THREE.Mesh(geometry, material);

    // Wireframe curve lines
    const wireIndices = [];
    const wireColors = new Float32Array(numVerts * 3);
    for (let k = 0; k < numVerts; k++) {
      wireColors[k * 3] = wireColor[0];
      wireColors[k * 3 + 1] = wireColor[1];
      wireColors[k * 3 + 2] = wireColor[2];
    }

    const strideV = isPetal ? 4 : (kind === 'stem' ? 4 : 3);
    const strideU = isPetal ? 8 : (kind === 'stem' ? 6 : 5);

    for (let j = 0; j < Nv; j += strideV) {
      for (let i = 0; i < Nu - 1; i++) {
        wireIndices.push(i * Nv + j, (i + 1) * Nv + j);
      }
    }
    for (let i = 0; i < Nu; i += strideU) {
      for (let j = 0; j < Nv - 1; j++) {
        wireIndices.push(i * Nv + j, i * Nv + (j + 1));
      }
    }

    const wireGeom = new THREE.BufferGeometry();
    wireGeom.setIndex(wireIndices);
    wireGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    wireGeom.setAttribute('color', new THREE.BufferAttribute(wireColors, 3));
    wireGeom.setAttribute('aEffU', new THREE.BufferAttribute(effUAttr, 1));

    const wireMat = new THREE.ShaderMaterial({
      vertexShader: wireVertexShader,
      fragmentShader: wireFragmentShader,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      uniforms: {
        u_time: { value: currentTime },
        u_wireT0: { value: wireT0 },
        u_wireT1: { value: wireT1 },
        u_surfT0: { value: surfT0 },
        u_surfT1: { value: surfT1 }
      }
    });
    animatedWireMaterials.push(wireMat);

    const wireLines = new THREE.LineSegments(wireGeom, wireMat);

    const group = new THREE.Group();
    group.add(mesh);
    group.add(wireLines);
    group.wireObject = wireLines;
    return group;
  }

  // 1. Stem / Pedicel Generator
  function generateStemTube(p0, p1, p2, p3, r_base, r_tip, Nu, Nv, col_base, col_tip, wireT0, wireT1, surfT0, surfT1) {
    const P = [], C = [], effU = [];
    const tangents = [], centers = [];

    for (let i = 0; i < Nu; i++) {
      const u = i / (Nu - 1);
      const { pos, tan } = evalCubicBezier(p0, p1, p2, p3, u);
      centers.push(pos);
      tangents.push(normalize3(tan));
    }
    const { N1, N2 } = computeBishopFrame(tangents);

    for (let i = 0; i < Nu; i++) {
      const u = i / (Nu - 1);
      const rowP = [], rowC = [], rowEff = [];
      let r = r_base * (1.0 - u) + r_tip * u;
      if (u > 0.90) {
        r *= 1.0 + 0.25 * smoothstep(0.90, 1.0, u);
      }
      const n1 = N1[i], n2 = N2[i], cPos = centers[i];

      for (let j = 0; j < Nv; j++) {
        const v = -1.0 + (2.0 * j) / (Nv - 1);
        const theta = (v + 1.0) * Math.PI;
        const ridge = 1.0 + 0.025 * Math.cos(6.0 * theta);
        const rad = r * ridge;

        const cosTh = Math.cos(theta), sinTh = Math.sin(theta);
        const px = cPos[0] + rad * (cosTh * n1[0] + sinTh * n2[0]);
        const py = cPos[1] + rad * (cosTh * n1[1] + sinTh * n2[1]);
        const pz = cPos[2] + rad * (cosTh * n1[2] + sinTh * n2[2]);
        rowP.push([px, py, pz]);

        const striation = 0.95 + 0.05 * Math.cos(6.0 * theta);
        const cr = ((1.0 - u) * col_base[0] + u * col_tip[0]) * striation;
        const cg = ((1.0 - u) * col_base[1] + u * col_tip[1]) * striation;
        const cb = ((1.0 - u) * col_base[2] + u * col_tip[2]) * striation;
        rowC.push([cr, cg, cb]);

        rowEff.push(0.92 * u + 0.08 * Math.abs(v));
      }
      P.push(rowP);
      C.push(rowC);
      effU.push(rowEff);
    }

    return {
      group: createMeshFromGrid(Nu, Nv, P, C, effU, null, 'stem', 0.22, 0.28, 20.0, [0.38, 0.88, 0.50], wireT0, wireT1, surfT0, surfT1),
      centers,
      tangents
    };
  }

  // 2. Lanceolate Leaf Generator
  function generateLanceolateLeaf(origin, stem_dir, azimuth, length, width, arch_drop, twist, wireT0, wireT1, surfT0, surfT1) {
    const Nu = 36, Nv = 17;
    const P = [], C = [], effU = [];
    const rot = rotY(azimuth);

    const c_dark = [0.08, 0.27, 0.12];
    const c_mid = [0.16, 0.45, 0.19];
    const c_vein = [0.36, 0.65, 0.30];
    const c_tip = [0.24, 0.50, 0.18];

    for (let i = 0; i < Nu; i++) {
      const u = i / (Nu - 1);
      const rowP = [], rowC = [], rowEff = [];

      const w_prof = width * (Math.pow(Math.max(0.0, Math.sin(Math.PI * Math.pow(u, 0.66))), 0.92)) * (1.0 - 0.12 * u)
                   + 0.10 * width * Math.pow(1.0 - u, 3);
      const reach = length * (0.90 * u + 0.10 * Math.sin(0.5 * Math.PI * u));
      const elev = length * (0.46 * u - arch_drop * Math.pow(u, 2.1));
      const tw_ang = twist * Math.pow(u, 1.35);

      for (let j = 0; j < Nv; j++) {
        const v = -1.0 + (2.0 * j) / (Nv - 1);
        const fold = 0.055 * width * Math.pow(Math.abs(v), 1.35) * (1.0 - 0.45 * u) - 0.025 * width * Math.pow(v, 4);

        const x_loc = w_prof * v * Math.cos(tw_ang) - fold * Math.sin(tw_ang);
        const z_loc = elev + w_prof * v * Math.sin(tw_ang) + fold * Math.cos(tw_ang);
        const y_loc = reach;

        const rotated = matMulVec(rot, [x_loc, y_loc, z_loc]);
        rowP.push([
          origin[0] + rotated[0],
          origin[1] + rotated[1],
          origin[2] + rotated[2]
        ]);

        const midrib_mask = Math.exp(-Math.pow(v / 0.10, 2));
        const parallel_veins = Math.pow(0.5 + 0.5 * Math.cos(v * 8.0 * Math.PI), 4);
        const edge_grad = Math.pow(Math.abs(v), 1.4);

        let cr = (1.0 - edge_grad) * c_mid[0] + edge_grad * c_dark[0];
        let cg = (1.0 - edge_grad) * c_mid[1] + edge_grad * c_dark[1];
        let cb = (1.0 - edge_grad) * c_mid[2] + edge_grad * c_dark[2];

        const u2 = u * u;
        cr = cr * (1.0 - 0.32 * u2) + c_tip[0] * (0.32 * u2);
        cg = cg * (1.0 - 0.32 * u2) + c_tip[1] * (0.32 * u2);
        cb = cb * (1.0 - 0.32 * u2) + c_tip[2] * (0.32 * u2);

        cr = cr * (1.0 - 0.48 * midrib_mask) + c_vein[0] * (0.48 * midrib_mask) + 0.06 * parallel_veins * c_vein[0];
        cg = cg * (1.0 - 0.48 * midrib_mask) + c_vein[1] * (0.48 * midrib_mask) + 0.06 * parallel_veins * c_vein[1];
        cb = cb * (1.0 - 0.48 * midrib_mask) + c_vein[2] * (0.48 * midrib_mask) + 0.06 * parallel_veins * c_vein[2];
        rowC.push([cr, cg, cb]);

        rowEff.push(0.85 * u + 0.15 * Math.abs(v));
      }
      P.push(rowP);
      C.push(rowC);
      effU.push(rowEff);
    }

    return createMeshFromGrid(Nu, Nv, P, C, effU, null, 'leaf', 0.30, 0.38, 26.0, [0.45, 0.92, 0.54], wireT0, wireT1, surfT0, surfT1);
  }

  // 3. Oriental Lily Tepal (Petals / Sepals) Generator
  function generateLilyTepal(center, basis, azimuth, is_inner, scale, openness, color_variant, wireT0, wireT1, surfT0, surfT1, rng_seed) {
    const Nu = 84, Nv = 41;
    const w_max = (is_inner ? 0.46 : 0.39) * scale;
    const length = (is_inner ? 1.26 : 1.24) * scale;

    function buildTepalSurface(open_factor) {
      const theta_base = is_inner ? 0.18 : 0.30;
      const theta_flare = (is_inner ? 0.74 : 0.88) * open_factor + 0.14;
      const theta_recurve = (is_inner ? 1.55 : 1.72) * Math.pow(open_factor, 1.18);

      const angles = [];
      for (let i = 0; i < Nu; i++) {
        const u = i / (Nu - 1);
        const ang = theta_base
                  + theta_flare * smoothstep(0.04, 0.58, u)
                  + (theta_recurve - theta_flare) * Math.pow(smoothstep(0.42, 1.0, u), 1.25);
        angles.push(ang);
      }

      const ds = length / (Nu - 1);
      const r_mid = new Float32Array(Nu);
      const y_mid = new Float32Array(Nu);
      r_mid[0] = (is_inner ? 0.036 : 0.078) * scale;
      y_mid[0] = (is_inner ? 0.035 : 0.00) * scale;

      for (let i = 1; i < Nu; i++) {
        const ang = 0.5 * (angles[i - 1] + angles[i]);
        r_mid[i] = r_mid[i - 1] + ds * Math.sin(ang);
        y_mid[i] = y_mid[i - 1] + ds * Math.cos(ang);
      }

      const P_grid = [];
      const ca = Math.cos(azimuth), sa = Math.sin(azimuth);

      for (let i = 0; i < Nu; i++) {
        const u = i / (Nu - 1);
        const envelope = Math.pow(Math.max(0.0, Math.sin(Math.PI * Math.pow(u, 0.58))), 0.72);
        const tip_round = 1.0 - 0.12 * Math.pow(u, 3);
        const w_profile = w_max * envelope * tip_round + 0.055 * scale * Math.pow(1.0 - u, 2.6);

        const out_r = Math.cos(angles[i]);
        const out_y = -Math.sin(angles[i]);
        const wrap_r = r_mid[i] + 0.16 * scale;
        const cyl_blend = 1.0 - 0.55 * smoothstep(0.35, 0.85, u);

        const row = [];
        for (let j = 0; j < Nv; j++) {
          const v = -1.0 + (2.0 * j) / (Nv - 1);

          const furrow = 0.028 * scale * Math.exp(-Math.pow(v / 0.16, 2)) * (1.0 - 0.60 * u);
          const reflex = 0.045 * scale * (v * v) * smoothstep(0.35, 0.90, u);

          const ruffle_amp = (is_inner ? 0.044 : 0.028) * scale * open_factor;
          const ruffle_env = Math.max(0.0, Math.sin(Math.PI * u)) * smoothstep(0.15, 0.88, u) * Math.pow(Math.abs(v), 2.3);
          const phase = is_inner ? 0.85 : -0.75;
          const ruffle = ruffle_amp * ruffle_env * Math.sin(6.0 * Math.PI * u + phase * Math.sign(v || 1.0));
          const disp_out = furrow + reflex + ruffle;

          const phi_local = (w_profile * v) / wrap_r;
          const phi_eff = phi_local * cyl_blend;
          const x_planar = (w_profile * v) * (1.0 - cyl_blend);

          const r_base_surf = wrap_r * Math.cos(phi_eff) - 0.16 * scale + disp_out * out_r;
          const x_base_surf = wrap_r * Math.sin(phi_eff) + x_planar;
          const y_local = y_mid[i] + disp_out * out_y;

          const px = x_base_surf * ca + r_base_surf * sa;
          const pz = -x_base_surf * sa + r_base_surf * ca;
          const py = y_local;

          const pw = matMulVec(basis, [px, py, pz]);
          row.push([
            center[0] + pw[0],
            center[1] + pw[1],
            center[2] + pw[2]
          ]);
        }
        P_grid.push(row);
      }
      return P_grid;
    }

    const P_full = buildTepalSurface(openness);
    const P_semi = buildTepalSurface(Math.max(0.28, openness * 0.45));

    const C = [], effU = [];
    for (let i = 0; i < Nu; i++) {
      const u = i / (Nu - 1);
      const rowC = [], rowEff = [];
      for (let j = 0; j < Nv; j++) {
        const v = -1.0 + (2.0 * j) / (Nv - 1);
        rowC.push([1.0, 1.0, 1.0]);
        rowEff.push(0.85 * u + 0.15 * Math.abs(v));
      }
      C.push(rowC);
      effU.push(rowEff);
    }

    const bloomEnd = Math.min(DURATION, surfT1 + 1.6);
    return createMeshFromGrid(Nu, Nv, P_full, C, effU, P_semi, 'petal', 0.52, 0.42, 28.0, [1.0, 0.72, 0.84], wireT0, wireT1, surfT0, surfT1, bloomEnd, color_variant);
  }

  // 4. Stamens & Pistil Generator
  function generateStamensAndPistil(center, basis, scale, wireT0, wireT1, surfT0, surfT1) {
    const group = new THREE.Group();

    // Central Pistil
    const Nu_s = 28, Nv_s = 13;
    const p0 = [0.0, 0.0, 0.0];
    const p1 = [0.02 * scale, 0.36 * scale, 0.03 * scale];
    const p2 = [0.04 * scale, 0.72 * scale, 0.07 * scale];
    const p3 = [0.02 * scale, 1.02 * scale, 0.14 * scale];

    const tangents = [], centers = [];
    for (let i = 0; i < Nu_s; i++) {
      const u = i / (Nu_s - 1);
      const { pos, tan } = evalCubicBezier(p0, p1, p2, p3, u);
      centers.push(pos);
      tangents.push(normalize3(tan));
    }
    const { N1, N2 } = computeBishopFrame(tangents);

    const P_style = [], C_style = [], effU_style = [];
    const c_green = [0.52, 0.76, 0.30];
    const c_stigma = [0.62, 0.18, 0.35];

    for (let i = 0; i < Nu_s; i++) {
      const u = i / (Nu_s - 1);
      const rowP = [], rowC = [], rowEff = [];
      const tip_close = u > 0.92 ? Math.pow(Math.sin(Math.PI * u), 0.22) : 1.0;
      const base_r = scale * 0.020 * (1.0 - 0.20 * u);
      const n1 = N1[i], n2 = N2[i], cPos = centers[i];

      for (let j = 0; j < Nv_s; j++) {
        const v = -1.0 + (2.0 * j) / (Nv_s - 1);
        const theta = (v + 1.0) * Math.PI;

        let r = base_r;
        if (u > 0.84) {
          const sw = Math.sin(Math.PI * (u - 0.84) / 0.16);
          const lobe = 1.0 + 0.45 * Math.cos(3.0 * theta);
          r = (base_r + scale * 0.022 * sw * lobe) * tip_close;
        }

        const px = cPos[0] + r * (Math.cos(theta) * n1[0] + Math.sin(theta) * n2[0]);
        const py = cPos[1] + r * (Math.cos(theta) * n1[1] + Math.sin(theta) * n2[1]);
        const pz = cPos[2] + r * (Math.cos(theta) * n1[2] + Math.sin(theta) * n2[2]);
        const pw = matMulVec(basis, [px, py, pz]);

        rowP.push([center[0] + pw[0], center[1] + pw[1], center[2] + pw[2]]);

        const stigma_mix = smoothstep(0.82, 0.92, u);
        rowC.push([
          (1.0 - stigma_mix) * c_green[0] + stigma_mix * c_stigma[0],
          (1.0 - stigma_mix) * c_green[1] + stigma_mix * c_stigma[1],
          (1.0 - stigma_mix) * c_green[2] + stigma_mix * c_stigma[2]
        ]);
        rowEff.push(u);
      }
      P_style.push(rowP);
      C_style.push(rowC);
      effU_style.push(rowEff);
    }
    group.add(createMeshFromGrid(Nu_s, Nv_s, P_style, C_style, effU_style, null, 'pistil', 0.30, 0.65, 42.0, [0.75, 0.95, 0.55], wireT0, wireT1, surfT0, surfT1));

    // 6 Curved Filaments + Versatile Anthers
    for (let k = 0; k < 6; k++) {
      const az = k * (Math.PI / 3.0) + 0.26;
      const ca = Math.cos(az), sa = Math.sin(az);
      const flare = (0.27 + 0.03 * (k % 2)) * scale;
      const h_tip = (0.88 + 0.04 * (k % 3)) * scale;

      const fp0 = [0.028 * scale * ca, 0.02 * scale, 0.028 * scale * sa];
      const fp1 = [0.075 * scale * ca, 0.34 * scale, 0.075 * scale * sa];
      const fp2 = [0.195 * scale * ca, 0.68 * scale, 0.195 * scale * sa];
      const fp3 = [flare * ca, h_tip, flare * sa];

      const Nu_f = 22, Nv_f = 8;
      const f_tangents = [], f_centers = [];
      for (let i = 0; i < Nu_f; i++) {
        const u = i / (Nu_f - 1);
        const { pos, tan } = evalCubicBezier(fp0, fp1, fp2, fp3, u);
        f_centers.push(pos);
        f_tangents.push(normalize3(tan));
      }
      const { N1: N1f, N2: N2f } = computeBishopFrame(f_tangents);

      const P_fil = [], C_fil = [], effU_fil = [];
      const c_fil_base = [0.56, 0.80, 0.36];
      const c_fil_tip = [0.98, 0.95, 0.96];

      for (let i = 0; i < Nu_f; i++) {
        const u = i / (Nu_f - 1);
        const rowP = [], rowC = [], rowEff = [];
        const rf = scale * (0.012 * (1.0 - 0.45 * u));

        for (let j = 0; j < Nv_f; j++) {
          const v = -1.0 + (2.0 * j) / (Nv_f - 1);
          const th = (v + 1.0) * Math.PI;

          const px = f_centers[i][0] + rf * (Math.cos(th) * N1f[i][0] + Math.sin(th) * N2f[i][0]);
          const py = f_centers[i][1] + rf * (Math.cos(th) * N1f[i][1] + Math.sin(th) * N2f[i][1]);
          const pz = f_centers[i][2] + rf * (Math.cos(th) * N1f[i][2] + Math.sin(th) * N2f[i][2]);
          const pw = matMulVec(basis, [px, py, pz]);

          rowP.push([center[0] + pw[0], center[1] + pw[1], center[2] + pw[2]]);

          const mix = smoothstep(0.15, 0.75, u);
          rowC.push([
            (1.0 - mix) * c_fil_base[0] + mix * c_fil_tip[0],
            (1.0 - mix) * c_fil_base[1] + mix * c_fil_tip[1],
            (1.0 - mix) * c_fil_base[2] + mix * c_fil_tip[2]
          ]);
          rowEff.push(u);
        }
        P_fil.push(rowP);
        C_fil.push(rowC);
        effU_fil.push(rowEff);
      }

      const st_delay = 0.06 * k;
      group.add(createMeshFromGrid(Nu_f, Nv_f, P_fil, C_fil, effU_fil, null, 'filament', 0.35, 0.28, 22.0, [0.95, 0.90, 0.65], wireT0 + st_delay, wireT1 + st_delay * 0.5, surfT0 + st_delay, surfT1 + st_delay * 0.5));

      // Versatile Anther
      const Nu_a = 14, Nv_a = 10;
      const anther_len = 0.145 * scale;
      const rad_dir = [ca, 0.0, sa];
      const tan_dir = [-sa, 0.0, ca];

      const a_axis_raw = [
        0.75 * tan_dir[0] + 0.25 * rad_dir[0],
        0.35,
        0.75 * tan_dir[2] + 0.25 * rad_dir[2]
      ];
      const a_axis = normalize3(a_axis_raw);
      const a_n1 = normalize3(cross3(a_axis, rad_dir));
      const a_n2 = normalize3(cross3(a_axis, a_n1));

      const P_anth = [], C_anth = [], effU_anth = [];
      const c_pollen_1 = [0.76, 0.30, 0.07];
      const c_pollen_2 = [0.94, 0.58, 0.14];

      for (let i = 0; i < Nu_a; i++) {
        const ua = i / (Nu_a - 1);
        const rowP = [], rowC = [], rowEff = [];
        const s_along = (ua - 0.5) * anther_len;
        const env = Math.pow(Math.max(0.0, Math.sin(Math.PI * ua)), 0.60);

        for (let j = 0; j < Nv_a; j++) {
          const va = -1.0 + (2.0 * j) / (Nv_a - 1);
          const th_a = (va + 1.0) * Math.PI;
          const bilobe = 1.0 + 0.28 * Math.cos(2.0 * th_a);
          const ra = 0.023 * scale * env * bilobe;

          const px = fp3[0] + s_along * a_axis[0] + ra * (Math.cos(th_a) * a_n1[0] + Math.sin(th_a) * a_n2[0]);
          const py = fp3[1] + s_along * a_axis[1] + ra * (Math.cos(th_a) * a_n1[1] + Math.sin(th_a) * a_n2[1]);
          const pz = fp3[2] + s_along * a_axis[2] + ra * (Math.cos(th_a) * a_n1[2] + Math.sin(th_a) * a_n2[2]);
          const pw = matMulVec(basis, [px, py, pz]);

          rowP.push([center[0] + pw[0], center[1] + pw[1], center[2] + pw[2]]);

          const grain = 0.5 + 0.5 * Math.sin(19.0 * ua + 7.0 * th_a);
          rowC.push([
            (1.0 - 0.45 * grain) * c_pollen_1[0] + 0.45 * grain * c_pollen_2[0],
            (1.0 - 0.45 * grain) * c_pollen_1[1] + 0.45 * grain * c_pollen_2[1],
            (1.0 - 0.45 * grain) * c_pollen_1[2] + 0.45 * grain * c_pollen_2[2]
          ]);
          rowEff.push(ua);
        }
        P_anth.push(rowP);
        C_anth.push(rowC);
        effU_anth.push(rowEff);
      }

      group.add(createMeshFromGrid(Nu_a, Nv_a, P_anth, C_anth, effU_anth, null, 'anther', 0.22, 0.16, 12.0, [1.0, 0.75, 0.25], wireT0 + 0.25 + st_delay, wireT1 + 0.20 + st_delay * 0.5, surfT0 + 0.25 + st_delay, surfT1 + st_delay * 0.5));
    }

    return group;
  }

  // 5. Lily Bud Generator
  function generateLilyBud(center, basis, scale, is_cracking, wireT0, wireT1, surfT0, surfT1) {
    const Nu = 34, Nv = 21;
    const P = [], C = [], effU = [];
    const length = 0.90 * scale;

    const c_green = [0.34, 0.62, 0.22];
    const c_rose = [0.86, 0.34, 0.54];
    const c_ivory = [0.96, 0.92, 0.90];

    for (let i = 0; i < Nu; i++) {
      const u = i / (Nu - 1);
      const rowP = [], rowC = [], rowEff = [];
      const r_prof = 0.21 * scale * (Math.pow(Math.max(0.0, Math.sin(Math.PI * Math.pow(u, 0.66))), 1.12)) * (1.0 - 0.12 * u)
                   + 0.028 * scale * Math.pow(1.0 - u, 2);
      const Y = length * u;

      for (let j = 0; j < Nv; j++) {
        const v = -1.0 + (2.0 * j) / (Nv - 1);
        const theta = (v + 1.0) * Math.PI;
        const rib = 1.0 + 0.08 * Math.cos(3.0 * theta) * Math.max(0.0, Math.sin(Math.PI * u));
        const R = r_prof * rib;

        const px = R * Math.cos(theta);
        const pz = R * Math.sin(theta);
        const py = Y;
        const pw = matMulVec(basis, [px, py, pz]);

        rowP.push([center[0] + pw[0], center[1] + pw[1], center[2] + pw[2]]);

        let rose_mix = smoothstep(0.24, 0.68, u) * (1.0 - 0.45 * (0.5 + 0.5 * Math.cos(3.0 * theta)));
        if (!is_cracking) rose_mix *= 0.45;
        const tip_mix = smoothstep(0.78, 0.98, u);

        let cr = (1.0 - rose_mix) * c_green[0] + rose_mix * c_rose[0];
        let cg = (1.0 - rose_mix) * c_green[1] + rose_mix * c_rose[1];
        let cb = (1.0 - rose_mix) * c_green[2] + rose_mix * c_rose[2];

        cr = (1.0 - tip_mix) * cr + tip_mix * c_ivory[0];
        cg = (1.0 - tip_mix) * cg + tip_mix * c_ivory[1];
        cb = (1.0 - tip_mix) * cb + tip_mix * c_ivory[2];
        rowC.push([cr, cg, cb]);

        rowEff.push(u);
      }
      P.push(rowP);
      C.push(rowC);
      effU.push(rowEff);
    }

    return createMeshFromGrid(Nu, Nv, P, C, effU, null, 'bud', 0.34, 0.30, 22.0, [0.68, 0.92, 0.58], wireT0, wireT1, surfT0, surfT1);
  }

  // 6. Glistening Morning Dewdrops
  function createMorningDewdrops(scene) {
    const dewGroup = new THREE.Group();
    const dropletGeom = new THREE.SphereGeometry(1, 14, 10);
    dropletGeom.scale(1.0, 0.65, 1.0);

    const dropletMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.92,
      opacity: 1.0,
      transparent: true,
      roughness: 0.04,
      metalness: 0.0,
      ior: 1.333,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02
    });

    const dropLocations = [
      { pos: [0.38, 0.48, 0.38], scale: 0.016 },
      { pos: [0.18, 0.58, 0.32], scale: 0.020 },
      { pos: [0.42, 0.28, 0.42], scale: 0.014 },
      { pos: [-0.22, 1.02, 0.22], scale: 0.018 },
      { pos: [-0.44, 0.82, 0.28], scale: 0.015 },
      { pos: [-0.30, -0.05, 0.24], scale: 0.017 },
      { pos: [0.12, 0.88, 0.08], scale: 0.022 },
      { pos: [-0.18, 0.42, 0.12], scale: 0.014 },
      { pos: [0.28, -0.62, 0.14], scale: 0.019 },
      { pos: [-0.28, -0.85, -0.02], scale: 0.016 }
    ];

    dropLocations.forEach(d => {
      const mesh = new THREE.Mesh(dropletGeom, dropletMat);
      mesh.position.set(...d.pos);
      mesh.scale.setScalar(d.scale);
      dewGroup.add(mesh);
    });

    scene.add(dewGroup);
    return dewGroup;
  }

  // ---------------------------------------------------------------------------
  // FULL BOUQUET SCENE ASSEMBLY
  // ---------------------------------------------------------------------------
  function buildLilyBouquetScene(scene) {
    const bouquetGroup = new THREE.Group();
    const c_stem_base = [0.13, 0.35, 0.15];
    const c_stem_tip = [0.32, 0.58, 0.24];

    // 1. Main Stems
    const stems_spec = [
      [[0.03, -2.55, 0.02], [0.09, -1.35, 0.06], [0.14, -0.35, 0.04], [0.10, 0.34, 0.10], 0.048, 0.034, 0.0, 1.3, 0.3, 2.0],
      [[-0.06, -2.55, -0.04], [-0.14, -1.25, -0.05], [-0.18, -0.10, -0.02], [-0.14, 0.82, -0.04], 0.046, 0.032, 0.15, 1.5, 0.45, 2.2],
      [[0.00, -2.55, -0.08], [-0.04, -1.40, -0.10], [0.02, -0.20, -0.09], [0.03, 1.28, -0.10], 0.042, 0.027, 0.25, 1.7, 0.6, 2.4]
    ];

    const stem_curves = [];
    for (const [p0, p1, p2, p3, rb, rt, wt0, wt1, st0, st1] of stems_spec) {
      const res = generateStemTube(p0, p1, p2, p3, rb, rt, 38, 13, c_stem_base, c_stem_tip, wt0, wt1, st0, st1);
      bouquetGroup.add(res.group);
      stem_curves.push({ centers: res.centers, tangents: res.tangents });
    }

    // 2. Pedicels
    const pedicels_spec = [
      [[0.12, 0.08, 0.07], [0.19, 0.20, 0.15], [0.24, 0.29, 0.23], [0.27, 0.36, 0.30], 0.030, 0.025, 0.85, 1.9, 1.2, 2.4],
      [[-0.15, 0.52, -0.03], [-0.23, 0.68, 0.04], [-0.29, 0.80, 0.10], [-0.34, 0.90, 0.15], 0.028, 0.024, 1.0, 2.1, 1.35, 2.55],
      [[-0.14, -0.45, -0.04], [-0.25, -0.34, 0.05], [-0.33, -0.25, 0.12], [-0.38, -0.18, 0.18], 0.027, 0.023, 1.1, 2.2, 1.45, 2.65],
      [[0.02, 1.12, -0.09], [0.05, 1.30, -0.06], [0.07, 1.46, -0.04], [0.08, 1.60, -0.02], 0.025, 0.021, 1.25, 2.3, 1.6, 2.75],
      [[0.10, 0.34, 0.10], [0.28, 0.66, 0.02], [0.42, 0.94, -0.04], [0.50, 1.16, -0.08], 0.025, 0.021, 1.3, 2.35, 1.65, 2.8]
    ];
    for (const [p0, p1, p2, p3, rb, rt, wt0, wt1, st0, st1] of pedicels_spec) {
      const res = generateStemTube(p0, p1, p2, p3, rb, rt, 22, 11, c_stem_base, c_stem_tip, wt0, wt1, st0, st1);
      bouquetGroup.add(res.group);
    }

    // 3. Lanceolate Leaves (13 leaves)
    const leaves_spec = [
      [0, 5,  0.45,  0.92, 0.17, 0.35,  0.20, 0.00],
      [0, 9,  2.35,  1.00, 0.18, 0.36, -0.16, 0.12],
      [0, 14, -1.15, 1.04, 0.19, 0.33,  0.22, 0.24],
      [0, 19, 0.85,  0.94, 0.17, 0.30, -0.18, 0.36],
      [0, 24, -0.55, 0.84, 0.16, 0.27,  0.14, 0.48],
      [0, 30, 1.65,  0.74, 0.14, 0.24, -0.14, 0.60],

      [1, 7,  -2.25, 0.94, 0.17, 0.35, -0.20, 0.10],
      [1, 12, 3.05,  1.02, 0.18, 0.34,  0.16, 0.22],
      [1, 17, -1.65, 0.98, 0.18, 0.32, -0.22, 0.34],
      [1, 23, 2.25,  0.88, 0.16, 0.29,  0.18, 0.46],
      [1, 29, -2.55, 0.78, 0.15, 0.25, -0.15, 0.58],

      [2, 10, -0.25, 0.88, 0.16, 0.34,  0.15, 0.20],
      [2, 16, 1.25,  0.92, 0.17, 0.31, -0.18, 0.35],
      [2, 22, -2.85, 0.82, 0.15, 0.28,  0.16, 0.50],
      [2, 28, 0.55,  0.72, 0.13, 0.24, -0.12, 0.65]
    ];
    for (const [s_idx, u_idx, az, l_len, l_wid, arch, tw, dly] of leaves_spec) {
      const stem = stem_curves[s_idx];
      const origin = stem.centers[u_idx];
      const s_dir = stem.tangents[u_idx];
      bouquetGroup.add(generateLanceolateLeaf(
        origin, s_dir, az, l_len, l_wid, arch, tw,
        0.75 + dly, 2.10 + dly, 1.35 + dly, 3.15 + dly
      ));
    }

    // 4. Three Blooming Oriental Lilies (Optimized bloom timeline for instant visibility)
    const flowers_spec = [
      {
        center: [0.27, 0.36, 0.30],
        dir: [0.22, 0.50, 0.84],
        scale: 0.90,
        openness: 1.00,
        variant: 'stargazer',
        rot_offset: 0.22,
        wire_t0: 1.0, wire_t1: 3.5,
        surf_t0: 1.8, surf_t1: 5.2,
        stamen_t0: 3.2, stamen_t1: 5.8,
        seed_base: 100
      },
      {
        center: [-0.34, 0.90, 0.15],
        dir: [-0.24, 0.58, 0.78],
        scale: 0.84,
        openness: 0.95,
        variant: 'soft_rose',
        rot_offset: 0.75,
        wire_t0: 1.2, wire_t1: 3.8,
        surf_t0: 2.0, surf_t1: 5.5,
        stamen_t0: 3.4, stamen_t1: 6.0,
        seed_base: 200
      },
      {
        center: [-0.38, -0.18, 0.18],
        dir: [-0.30, 0.46, 0.83],
        scale: 0.76,
        openness: 0.82,
        variant: 'blush_ivory',
        rot_offset: -0.32,
        wire_t0: 1.4, wire_t1: 4.0,
        surf_t0: 2.2, surf_t1: 5.8,
        stamen_t0: 3.6, stamen_t1: 6.2,
        seed_base: 300
      }
    ];

    for (const f of flowers_spec) {
      const basis = buildBasisFromDir(f.dir);
      // 3 Outer Tepals
      for (let k = 0; k < 3; k++) {
        const az = f.rot_offset + k * (2.0 * Math.PI / 3.0);
        const dly = 0.10 * k;
        bouquetGroup.add(generateLilyTepal(
          f.center, basis, az, false, f.scale, f.openness, f.variant,
          f.wire_t0 + dly, f.wire_t1 + dly, f.surf_t0 + dly, f.surf_t1 + dly,
          f.seed_base + k
        ));
      }
      // 3 Inner Tepals
      for (let k = 0; k < 3; k++) {
        const az = f.rot_offset + (k + 0.5) * (2.0 * Math.PI / 3.0);
        const dly = 0.15 + 0.10 * k;
        bouquetGroup.add(generateLilyTepal(
          f.center, basis, az, true, f.scale, f.openness, f.variant,
          f.wire_t0 + dly, f.wire_t1 + dly, f.surf_t0 + dly, f.surf_t1 + dly,
          f.seed_base + 10 + k
        ));
      }
      // Stamens & Central Pistil
      bouquetGroup.add(generateStamensAndPistil(
        f.center, basis, f.scale,
        f.stamen_t0, f.stamen_t0 + 1.2, f.stamen_t0 + 0.3, f.stamen_t1
      ));
    }

    // 5. Two Lily Buds
    const bud1_basis = buildBasisFromDir([0.06, 0.95, 0.16]);
    bouquetGroup.add(generateLilyBud([0.08, 1.60, -0.02], bud1_basis, 0.80, true, 1.5, 3.8, 2.2, 5.0));

    const bud2_basis = buildBasisFromDir([0.36, 0.90, 0.12]);
    bouquetGroup.add(generateLilyBud([0.50, 1.16, -0.08], bud2_basis, 0.74, false, 1.7, 4.0, 2.4, 5.2));

    scene.add(bouquetGroup);
    return bouquetGroup;
  }

  // ---------------------------------------------------------------------------
  // AMBIENT DRIFTING POLLEN PARTICLES
  // ---------------------------------------------------------------------------
  function createPollenParticles(scene) {
    const count = 90;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const initialPos = [];

    let seed = 42;
    function prng() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280.0;
    }

    for (let i = 0; i < count; i++) {
      const x = -1.2 + 2.4 * prng();
      const y = -1.8 + 3.8 * prng();
      const z = -0.9 + 1.8 * prng();
      initialPos.push([x, y, z]);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      phases[i] = prng() * 2.0 * Math.PI;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255, 245, 210, 1)');
    grad.addColorStop(0.35, 'rgba(255, 200, 130, 0.85)');
    grad.addColorStop(0.75, 'rgba(240, 130, 170, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const pTexture = new THREE.CanvasTexture(canvas);

    const material = new THREE.PointsMaterial({
      size: 0.09,
      map: pTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    return function updateParticles(t) {
      const posAttr = geometry.attributes.position;
      for (let i = 0; i < count; i++) {
        const init = initialPos[i];
        const ph = phases[i];
        let y = init[1] + 0.18 * t + 0.08 * Math.sin(t * 1.5 + ph);
        y = (((y + 1.8) % 3.8) + 3.8) % 3.8 - 1.8;
        const x = init[0] + 0.08 * Math.cos(t * 1.1 + ph);
        const z = init[2] + 0.05 * Math.sin(t * 0.9 + ph);

        posAttr.setXYZ(i, x, y, z);
      }
      posAttr.needsUpdate = true;
    };
  }

  // ---------------------------------------------------------------------------
  // MAIN APPLICATION & RENDER LOOP
  // ---------------------------------------------------------------------------
  function initApp() {
    const container = document.getElementById('canvas-container');
    const canvas = document.getElementById('webgl-canvas');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 100);

    const renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    renderer.setSize(container.clientWidth, container.clientHeight);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 14.0;
    controls.minDistance = 1.2;
    controls.enabled = false;

    // Physical Lighting Rig
    const keyLight = new THREE.DirectionalLight(0xfff6ec, 1.6);
    keyLight.position.set(-2.5, 4.5, 3.2);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xd6e5ff, 0.75);
    fillLight.position.set(3.2, -1.0, 2.5);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffddee, 1.3);
    rimLight.position.set(0.2, 3.5, -4.5);
    scene.add(rimLight);

    const hemiLight = new THREE.HemisphereLight(0xfff0f5, 0x1a1216, 0.75);
    scene.add(hemiLight);

    // Build the bouquet, dewdrops & particles
    buildLilyBouquetScene(scene);
    const dewGroup = createMorningDewdrops(scene);
    const updateParticles = createPollenParticles(scene);

    // Apply lighting preset
    function applyLightingPreset(idx) {
      lightingPresetIndex = (idx + LIGHT_PRESETS.length) % LIGHT_PRESETS.length;
      const p = LIGHT_PRESETS[lightingPresetIndex];

      keyLight.position.set(...p.keyPos);
      fillLight.position.set(...p.fillPos);
      rimLight.position.set(...p.rimPos);

      container.style.background = p.bgGrad;

      for (let i = 0; i < animatedMaterials.length; i++) {
        const u = animatedMaterials[i].uniforms;
        u.u_keyPos.value.set(...p.keyPos);
        u.u_keyCol.value.set(...p.keyCol);
        u.u_fillPos.value.set(...p.fillPos);
        u.u_fillCol.value.set(...p.fillCol);
        u.u_rimPos.value.set(...p.rimPos);
        u.u_rimCol.value.set(...p.rimCol);
        u.u_ambientCol.value.set(...p.ambientCol);
      }

      const iconElem = document.getElementById('lighting-icon');
      const labelElem = document.getElementById('lighting-label');
      if (iconElem) iconElem.textContent = p.icon;
      if (labelElem) labelElem.textContent = p.name;
    }
    applyLightingPreset(lightingPresetIndex);

    // Camera update matching Python script with Mobile Aspect Compensation
    function updateCinematicCamera(t) {
      const p_all = t / DURATION;
      const azimuth = -0.32 + 0.56 * smootherstep(0.0, 0.78, p_all) + 0.22 * Math.sin(
        Math.max(0.0, (p_all - 0.72) / 0.28) * Math.PI
      );
      const elevation = 0.06 + 0.10 * smootherstep(0.10, 0.65, p_all) - 0.03 * smootherstep(0.75, 1.0, p_all);

      const y_target = -0.50 * (1.0 - smootherstep(0.0, 0.32, p_all)) + 0.24 * smootherstep(0.15, 0.55, p_all);

      // Responsive Mobile Framing: scale camera distance so entire bouquet fits with comfortable margin
      const aspect = container.clientWidth / container.clientHeight;
      const aspectFactor = aspect < 0.75 ? Math.max(1.0, 0.66 / Math.max(0.35, aspect)) : 1.0;
      const cam_dist = (5.05 - 0.20 * smootherstep(0.25, 0.85, p_all)) * aspectFactor;

      const y_mobile_offset = aspect < 0.75 ? 0.08 : 0.0;
      const target = new THREE.Vector3(-0.02, y_target + y_mobile_offset, 0.08);

      const cosEl = Math.cos(elevation), sinEl = Math.sin(elevation);
      const sinAz = Math.sin(azimuth), cosAz = Math.cos(azimuth);

      camera.position.set(
        target.x + cam_dist * sinAz * cosEl,
        target.y + cam_dist * sinEl,
        target.z + cam_dist * cosAz * cosEl
      );
      camera.lookAt(target);
      controls.target.copy(target);
    }

    // Set time and update all shader uniforms
    function setTime(t) {
      currentTime = clamp(t, 0.0, DURATION);

      for (let i = 0; i < animatedMaterials.length; i++) {
        animatedMaterials[i].uniforms.u_time.value = currentTime;
      }
      for (let i = 0; i < animatedWireMaterials.length; i++) {
        animatedWireMaterials[i].uniforms.u_time.value = currentTime;
      }

      // Dewdrops materialize when flowers bloom
      if (enableDewdrops) {
        dewGroup.visible = currentTime > 3.5;
        const dewScale = clamp((currentTime - 3.5) / 2.0, 0.0, 1.0);
        dewGroup.scale.setScalar(dewScale);
      } else {
        dewGroup.visible = false;
      }

      updateParticles(currentTime);

      if (isAutoCamera) {
        updateCinematicCamera(currentTime);
      }

      const timePercent = (currentTime / DURATION) * 100;
      const scrubberFill = document.getElementById('scrubber-fill');
      const timeLabel = document.getElementById('current-time-label');
      if (scrubberFill) scrubberFill.style.width = timePercent + '%';
      if (timeLabel) timeLabel.textContent = currentTime.toFixed(1) + 's';
    }

    // Window Resize
    function onWindowResize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (isAutoCamera) {
        updateCinematicCamera(currentTime);
      }
    }
    window.addEventListener('resize', onWindowResize);

    // Animation Loop
    let lastStamp = performance.now();
    function animate(stamp) {
      requestAnimationFrame(animate);

      const delta = (stamp - lastStamp) / 1000.0;
      lastStamp = stamp;

      if (isPlaying) {
        let nextTime = currentTime + delta * playbackSpeed;
        if (nextTime > DURATION) {
          nextTime = 0.0;
        }
        setTime(nextTime);
      }

      if (!isAutoCamera) {
        controls.update();
      }

      renderer.render(scene, camera);
    }

    // Initialize to full bloom (t = 6.0s) so flowers are immediately visible on screen!
    setTime(currentTime);
    requestAnimationFrame(animate);

    // -------------------------------------------------------------------------
    // USER CONTROLS SETUP
    // -------------------------------------------------------------------------
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const scrubberTrack = document.getElementById('scrubber-track');
    const restartBtn = document.getElementById('restart-btn');
    const speedBtn = document.getElementById('speed-btn');
    const speedLabel = document.getElementById('speed-label');
    const lightingBtn = document.getElementById('lighting-mode-btn');
    const windBtn = document.getElementById('wind-toggle-btn');
    const dewBtn = document.getElementById('dew-toggle-btn');
    const cameraToggleBtn = document.getElementById('camera-mode-btn');
    const wireframeToggleBtn = document.getElementById('wireframe-toggle-btn');
    const frameGuideBtn = document.getElementById('frame-guide-btn');
    const frameGuide = document.getElementById('portrait-frame-guide');
    const hint = document.getElementById('interaction-hint');

    function updatePlayPauseUI() {
      if (isPlaying) {
        if (playIcon) playIcon.style.display = 'none';
        if (pauseIcon) pauseIcon.style.display = 'block';
      } else {
        if (playIcon) playIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';
      }
    }

    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', () => {
        isPlaying = !isPlaying;
        updatePlayPauseUI();
      });
    }

    if (restartBtn) {
      restartBtn.addEventListener('click', () => {
        setTime(0.0);
        if (!isPlaying) {
          isPlaying = true;
          updatePlayPauseUI();
        }
      });
    }

    // Speed Cycle
    const speeds = [1.0, 0.5, 0.25, 1.5];
    let speedIdx = 0;
    if (speedBtn) {
      speedBtn.addEventListener('click', () => {
        speedIdx = (speedIdx + 1) % speeds.length;
        playbackSpeed = speeds[speedIdx];
        if (speedLabel) speedLabel.textContent = playbackSpeed.toFixed(speedIdx === 2 ? 2 : 1) + 'x';
      });
    }

    // Lighting Atmosphere Cycle
    if (lightingBtn) {
      lightingBtn.addEventListener('click', () => {
        applyLightingPreset(lightingPresetIndex + 1);
      });
    }

    // Living Wind Toggle
    if (windBtn) {
      windBtn.addEventListener('click', () => {
        enableLivingWind = !enableLivingWind;
        windBtn.classList.toggle('active', enableLivingWind);
        for (let i = 0; i < animatedMaterials.length; i++) {
          animatedMaterials[i].uniforms.u_windStrength.value = enableLivingWind ? 1.0 : 0.0;
        }
      });
    }

    // Dewdrops Toggle
    if (dewBtn) {
      dewBtn.addEventListener('click', () => {
        enableDewdrops = !enableDewdrops;
        dewBtn.classList.toggle('active', enableDewdrops);
        dewGroup.visible = enableDewdrops && currentTime > 3.5;
      });
    }

    // Scrubber drag / click
    let isDragging = false;
    function seekFromEvent(e) {
      const rect = scrubberTrack.getBoundingClientRect();
      const pos = clamp((e.clientX - rect.left) / rect.width, 0.0, 1.0);
      setTime(pos * DURATION);
    }

    if (scrubberTrack) {
      scrubberTrack.addEventListener('mousedown', (e) => {
        isDragging = true;
        seekFromEvent(e);
      });
      window.addEventListener('mousemove', (e) => {
        if (isDragging) seekFromEvent(e);
      });
      window.addEventListener('mouseup', () => {
        isDragging = false;
      });

      scrubberTrack.addEventListener('touchstart', (e) => {
        isDragging = true;
        if (e.touches[0]) seekFromEvent(e.touches[0]);
      });
      window.addEventListener('touchmove', (e) => {
        if (isDragging && e.touches[0]) seekFromEvent(e.touches[0]);
      });
      window.addEventListener('touchend', () => {
        isDragging = false;
      });
    }

    // Camera Mode toggle
    if (cameraToggleBtn) {
      cameraToggleBtn.addEventListener('click', () => {
        isAutoCamera = !isAutoCamera;
        const camLabel = document.getElementById('camera-label');
        if (isAutoCamera) {
          controls.enabled = false;
          cameraToggleBtn.classList.remove('active');
          if (camLabel) camLabel.textContent = 'Cinematic Cam';
          if (hint) hint.textContent = 'Cinematic auto-camera active';
        } else {
          controls.enabled = true;
          cameraToggleBtn.classList.add('active');
          if (camLabel) camLabel.textContent = 'Free 3D Orbit';
          if (hint) hint.textContent = 'Drag to rotate • Pinch to zoom';
        }
        if (hint) {
          setTimeout(() => { hint.style.opacity = '0'; }, 3500);
          hint.style.opacity = '0.9';
        }
      });
    }

    // Wireframe toggle
    if (wireframeToggleBtn) {
      wireframeToggleBtn.addEventListener('click', () => {
        showWireframe = !showWireframe;
        wireframeToggleBtn.classList.toggle('active', showWireframe);
        for (let i = 0; i < animatedWireMaterials.length; i++) {
          animatedWireMaterials[i].visible = showWireframe;
        }
      });
    }

    // Tap Canvas to toggle UI Visibility (Clean Immersive View)
    const uiOverlay = document.getElementById('ui-overlay');
    let touchStartX = 0, touchStartY = 0, touchMoved = false;

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches[0]) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchMoved = false;
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches[0]) {
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;
        if (Math.hypot(dx, dy) > 8) touchMoved = true;
      }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
      if (!touchMoved && uiOverlay) {
        uiOverlay.classList.toggle('hidden');
      }
    });

    canvas.addEventListener('click', () => {
      if (!touchMoved && uiOverlay) {
        uiOverlay.classList.toggle('hidden');
      }
    });

    // Mobile Settings Drawer Handlers
    const drawer = document.getElementById('mobile-drawer');
    const drawerOpenBtn = document.getElementById('drawer-open-btn');
    const drawerCloseBtn = document.getElementById('drawer-close-btn');

    if (drawerOpenBtn && drawerCloseBtn && drawer) {
      drawerOpenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        drawer.classList.add('active');
      });
      drawerCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        drawer.classList.remove('active');
      });
      drawer.addEventListener('click', (e) => {
        if (e.target === drawer) {
          drawer.classList.remove('active');
        }
      });

      const drawerLightingBtn = document.getElementById('drawer-lighting-btn');
      const drawerLightingLabel = document.getElementById('drawer-lighting-label');
      if (drawerLightingBtn) {
        drawerLightingBtn.addEventListener('click', () => {
          if (lightingBtn) lightingBtn.click();
          if (drawerLightingLabel) drawerLightingLabel.textContent = LIGHT_PRESETS[lightingPresetIndex].name;
        });
      }

      const drawerWindBtn = document.getElementById('drawer-wind-btn');
      if (drawerWindBtn) {
        drawerWindBtn.addEventListener('click', () => {
          if (windBtn) windBtn.click();
          drawerWindBtn.classList.toggle('active', enableLivingWind);
          drawerWindBtn.textContent = enableLivingWind ? 'Enabled' : 'Disabled';
        });
      }

      const drawerDewBtn = document.getElementById('drawer-dew-btn');
      if (drawerDewBtn) {
        drawerDewBtn.addEventListener('click', () => {
          if (dewBtn) dewBtn.click();
          drawerDewBtn.classList.toggle('active', enableDewdrops);
          drawerDewBtn.textContent = enableDewdrops ? 'Enabled' : 'Disabled';
        });
      }

      const drawerWireBtn = document.getElementById('drawer-wire-btn');
      if (drawerWireBtn) {
        drawerWireBtn.addEventListener('click', () => {
          if (wireframeToggleBtn) wireframeToggleBtn.click();
          drawerWireBtn.classList.toggle('active', showWireframe);
          drawerWireBtn.textContent = showWireframe ? 'Enabled' : 'Disabled';
        });
      }

      const drawerFrameBtn = document.getElementById('drawer-frame-btn');
      if (drawerFrameBtn && frameGuideBtn) {
        drawerFrameBtn.addEventListener('click', () => {
          showFrameGuide = !showFrameGuide;
          drawerFrameBtn.classList.toggle('active', showFrameGuide);
          drawerFrameBtn.textContent = showFrameGuide ? 'Enabled' : 'Disabled';
          if (frameGuide) frameGuide.style.display = showFrameGuide ? 'block' : 'none';
        });
      }
    }

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        isPlaying = !isPlaying;
        updatePlayPauseUI();
      } else if (e.code === 'KeyR') {
        setTime(0.0);
      } else if (e.code === 'KeyC') {
        if (cameraToggleBtn) cameraToggleBtn.click();
      } else if (e.code === 'KeyL') {
        if (lightingBtn) lightingBtn.click();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
