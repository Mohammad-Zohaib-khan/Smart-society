/**
 * CloudShader — a moving, volumetric cloud sky rendered with WebGL.
 *
 * The brief references a supplied, Aceternity-inspired CloudShader whose source was not included
 * (only the demo that uses it). This is an original implementation with the same prop API
 * (`speed`, `count`, `cloudColor`, `skyTopColor`, `skyBottomColor`, `className`, optional children)
 * and the same usage: `<CloudShader className="absolute inset-0" />` as a hero background.
 *
 * How it looks real: the fragment shader ray-marches a slab of 3D fractal noise seen from the
 * ground, so clouds recede in perspective toward a hazy horizon. Each sample is lit by testing
 * density toward the sun, giving bright crowns, grey undersides and silver edges. Wind moves the
 * noise field continuously, so the clouds drift and slowly change shape.
 *
 * Performance: the scene is rendered at reduced resolution (clouds are soft, so upscaling is
 * invisible) and the resolution adapts to the measured frame time. Animation pauses when the hero
 * is off-screen or the tab is hidden. Reduced motion: the drift slows to a quarter of its speed
 * instead of stopping. If WebGL is unavailable, or the shader fails, a CSS sky of the same colours
 * is shown. The canvas never receives pointer events.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CloudShaderProps {
  /** Wind speed multiplier (1 = default, 0 = still). */
  speed?: number;
  /** Cloud cover from 1 (a few clouds) to 4 (mostly overcast). */
  count?: number;
  /** Colour of sunlit cloud tops. */
  cloudColor?: string;
  /** Sky colour overhead. */
  skyTopColor?: string;
  /** Sky colour at the horizon. */
  skyBottomColor?: string;
  className?: string;
  children?: ReactNode;
}

const VERT = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform float uCover;
uniform vec3 uCloud;
uniform vec3 uTop;
uniform vec3 uHorizon;

// Sun high and slightly behind-right: lights the cloud crowns without a glare spot behind text.
const vec3 SUN = normalize(vec3(0.55, 0.9, 0.35));
const float BASE = 10.0;   // cloud layer bottom (world units above the eye)
const float TOP = 22.0;    // cloud layer top

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float f = 0.5 * noise(p); p = p * 2.02 + vec3(0.13, 0.37, 0.71);
  f += 0.25 * noise(p); p = p * 2.03 + vec3(0.41, 0.19, 0.53);
  f += 0.125 * noise(p); p = p * 2.01 + vec3(0.29, 0.61, 0.17);
  f += 0.0625 * noise(p); p = p * 2.02;
  f += 0.03125 * noise(p);
  return f / 0.96875;
}

// Cloud density at a world position: noise carried by the wind, shaped into a layer with flat-ish
// bases and rounded tops.
float density(vec3 p) {
  vec3 wind = vec3(uTime * 1.6, 0.0, uTime * 0.7);
  vec3 q = (p + wind) * vec3(0.085, 0.14, 0.085);
  // A slow secondary flow makes shapes billow and change, not just slide.
  q += 0.35 * vec3(noise(q * 0.6 + uTime * 0.02), 0.0, noise(q * 0.6 - uTime * 0.02));
  float h = (p.y - BASE) / (TOP - BASE);
  float shape = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.45, h);
  float d = fbm(q) - (1.0 - uCover);
  return clamp(d * 4.2 * shape, 0.0, 1.0);
}

vec3 skyColor(vec3 rd) {
  float up = clamp(rd.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(up, 0.55));
  float sun = clamp(dot(rd, SUN), 0.0, 1.0);
  col += vec3(1.0, 0.86, 0.66) * (0.18 * pow(sun, 6.0) + 0.35 * pow(sun, 64.0));
  return col;
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;
  // Camera on the ground, tilted up so the cloud layer fills the frame above a hazy horizon.
  vec3 ro = vec3(0.0, 0.0, 0.0);
  vec3 rd = normalize(vec3(uv.x, uv.y * 0.9 + 0.74, 1.35));
  vec3 bg = skyColor(rd);
  if (rd.y < 0.02) { gl_FragColor = vec4(bg, 1.0); return; }

  float t0 = (BASE - ro.y) / rd.y;
  float t1 = min((TOP - ro.y) / rd.y, 260.0);
  float dt = max((t1 - t0) / 56.0, 0.25);
  // Dither the start to hide banding from the fixed step count.
  float t = t0 + dt * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);

  vec4 sum = vec4(0.0);
  vec3 shadowCol = mix(uCloud, uTop, 0.45) * 0.8;
  for (int i = 0; i < 56; i++) {
    if (t > t1 || sum.a > 0.98) break;
    vec3 pos = ro + t * rd;
    float den = density(pos);
    if (den > 0.01) {
      // Light: how much denser the cloud is toward the sun.
      float dif = clamp((den - density(pos + 1.6 * SUN)) / 0.55, 0.0, 1.0);
      float height = clamp((pos.y - BASE) / (TOP - BASE), 0.0, 1.0);
      vec3 lit = mix(shadowCol, uCloud, 0.45 + 0.55 * dif);
      lit = mix(lit, uCloud * 1.04, height * 0.35);            // brighter crowns
      lit += vec3(1.0, 0.9, 0.75) * 0.12 * dif;                 // warm sunlit edges
      // Aerial perspective: distant clouds fade into the horizon haze.
      float fog = 1.0 - exp(-0.0065 * t);
      lit = mix(lit, bg, fog);
      float a = den * 0.6;
      sum.rgb += lit * a * (1.0 - sum.a);
      sum.a += a * (1.0 - sum.a);
    }
    t += dt;
  }
  vec3 col = bg * (1.0 - sum.a) + sum.rgb;
  // Gentle vignette toward the horizon so the hero melts into the page below.
  col = mix(col, uHorizon, smoothstep(0.2, 0.02, rd.y) * 0.6);
  gl_FragColor = vec4(col, 1.0);
}`;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('CloudShader: shader compile failed, using static fallback.', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Pixels rendered per CSS pixel; clouds are soft, so a fraction of full resolution is plenty. */
const MAX_SCALE = 0.55;
const MIN_SCALE = 0.3;
const MAX_PIXELS = 600_000;

export function CloudShader({
  speed = 1,
  count = 3,
  cloudColor = '#ffffff',
  skyTopColor = '#3d7cc0',
  skyBottomColor = '#cfe0f0',
  className,
  children,
}: CloudShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) {
      setFallback(true);
      return;
    }
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      setFallback(true);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('CloudShader: program link failed, using static fallback.');
      setFallback(true);
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uRes = u('uRes');
    const uTime = u('uTime');
    const cover = 0.32 + 0.05 * Math.min(4, Math.max(1, Math.round(count)));
    gl.uniform1f(u('uCover'), cover);
    gl.uniform3fv(u('uCloud'), hexToRgb(cloudColor));
    gl.uniform3fv(u('uTop'), hexToRgb(skyTopColor));
    gl.uniform3fv(u('uHorizon'), hexToRgb(skyBottomColor));

    // Reduced motion: keep the sky alive but slow it right down.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rate = speed * (reduced ? 0.25 : 1);
    let scale = MAX_SCALE;
    let frame = 0;
    let visible = true;
    let elapsed = 40; // start mid-drift so the first frame already has formed clouds
    let last = performance.now();
    // Rolling frame-time average drives the resolution so weak GPUs settle within a second.
    let avg = 16;
    let framesSinceChange = 0;
    let skip = false;

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const cssPixels = Math.max(1, width * height);
      const s = Math.min(scale, Math.sqrt(MAX_PIXELS / cssPixels));
      const w = Math.max(1, Math.round(width * s));
      const h = Math.max(1, Math.round(height * s));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(uRes, w, h);
      }
    };
    const draw = () => {
      gl.uniform1f(uTime, elapsed);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      elapsed += Math.min(delta, 100) / 1000 * rate;
      // Adapt resolution to the device: drop it quickly when frames are slow, raise it slowly.
      avg = avg * 0.8 + Math.min(delta, 500) * 0.2;
      framesSinceChange++;
      if (framesSinceChange > 6 && avg > 30 && scale > MIN_SCALE) {
        scale = Math.max(MIN_SCALE, scale * (avg > 80 ? 0.5 : 0.75));
        framesSinceChange = 0;
        resize();
      } else if (framesSinceChange > 180 && avg < 14 && scale < MAX_SCALE) {
        scale = Math.min(MAX_SCALE, scale * 1.1);
        framesSinceChange = 0;
        resize();
      }
      // Weak GPUs at the lowest resolution: draw every other frame rather than blur further.
      skip = scale <= MIN_SCALE && avg > 30 ? !skip : false;
      if (!skip) draw();
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (frame || !visible || document.hidden || rate === 0) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    resize();
    // Calibrate once: time a full frame and pick a resolution this GPU can draw in ~10 ms.
    const t0 = performance.now();
    draw();
    gl.finish();
    const cost = performance.now() - t0;
    if (cost > 10) {
      scale = Math.max(MIN_SCALE, scale * Math.sqrt(10 / cost));
      resize();
      draw();
    }

    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) start();
      else stop();
    });
    io.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    const onLost = (e: Event) => {
      e.preventDefault();
      stop();
      setFallback(true);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [speed, count, cloudColor, skyTopColor, skyBottomColor]);

  return (
    // Used either as a wrapper around hero content, or on its own as a background layer
    // (`<CloudShader className="absolute inset-0" />`), in which case it is purely decorative.
    <div className={cn('relative isolate overflow-hidden', className)} aria-hidden={children ? undefined : true}>
      {fallback ? (
        <div
          data-testid="cloud-fallback"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: `radial-gradient(40% 22% at 22% 30%, ${cloudColor}d9, transparent 70%), radial-gradient(34% 18% at 70% 22%, ${cloudColor}c0, transparent 70%), radial-gradient(50% 20% at 55% 58%, ${cloudColor}99, transparent 72%), linear-gradient(to bottom, ${skyTopColor}, ${skyBottomColor})`,
          }}
        />
      ) : (
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 -z-10 size-full" />
      )}
      {children}
    </div>
  );
}
