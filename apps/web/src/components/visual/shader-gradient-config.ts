/**
 * ShaderGradient settings for the atmospheric water-plane background.
 *
 * SUPPLIED by the brief (source of truth): animate on, shader defaults, type waterPlane,
 * destination onCanvas, colours #ebedff / #f3f2f8 / #dbf8ff, brightness 1.2, uSpeed 0.3,
 * uStrength 3, uFrequency 5.5, reflection 0.1, rotationZ -90.
 *
 * ASSUMED — the brief says "remaining values as supplied in the user's prompt", but those values
 * were not included in the files received. Every value below the marker is a placeholder chosen
 * to keep the plane soft and full-bleed; replace them with the originals when available.
 * ("destination: onCanvas" is a ShaderGradient customiser export setting, not a component prop:
 * rendering inside <ShaderGradientCanvas> is what it means here.)
 */
export const shaderGradientProps = {
  // --- supplied
  animate: 'on',
  shader: 'defaults',
  type: 'waterPlane',
  color1: '#ebedff',
  color2: '#f3f2f8',
  color3: '#dbf8ff',
  brightness: 1.2,
  uSpeed: 0.3,
  uStrength: 3,
  uFrequency: 5.5,
  reflection: 0.1,
  rotationZ: -90,
  // --- ASSUMED (not supplied)
  uDensity: 1.2,
  uAmplitude: 0,
  uTime: 0,
  positionX: 0,
  positionY: 0,
  positionZ: 0,
  rotationX: 0,
  rotationY: 0,
  cAzimuthAngle: 180,
  cPolarAngle: 90,
  cDistance: 3.6,
  cameraZoom: 1,
  lightType: '3d',
  envPreset: 'city',
  grain: 'off', // the site already applies its own paper grain overlay
  range: 'disabled',
  rangeStart: 0,
  rangeEnd: 40,
  wireframe: false,
} as const;

export const shaderCanvasProps = {
  // ASSUMED: pixel density kept low because this is a soft background layer.
  pixelDensity: 1,
  fov: 45,
} as const;
