"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "./motion";

/** Liquidity rendered as flowing strands in ordered dither. `fracture` (0–1)
 * thins the strands towards the right edge into an orange cliff: the exit depth
 * running out. At 0 the strands run unbroken: the bid holding the line.
 */
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time;
uniform float u_dpr;
uniform vec2 u_mouse;
uniform float u_fracture;
uniform float u_floor;
uniform vec3 u_paper;
uniform vec3 u_ink;
uniform vec3 u_accent;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v * (8.0 / 7.0);
}
float bayer2(vec2 a) { a = mod(floor(a), 2.0); return mod(2.0 * a.x + 3.0 * a.y, 4.0) / 4.0; }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time * 0.035;

  vec2 warp = vec2(fbm(p * 1.6 + vec2(t, 0.0)), fbm(p * 1.6 + vec2(3.1, t)));
  float strands = fbm(vec2(p.x * 0.9 - t * 3.0, p.y * 11.0 + warp.x * 3.0));
  strands = pow(strands, 1.4) * 1.5;

  float edge = uv.x + (warp.y - 0.5) * 0.35;
  float cliff = smoothstep(0.42, 0.98, edge);
  float depth = 1.0 - cliff * u_fracture;

  vec2 m = (uv - u_mouse) * vec2(aspect, 1.0);
  float ripple = exp(-9.0 * dot(m, m)) * 0.35;

  float density = clamp(strands * depth + ripple, 0.0, 1.0);
  float cell = 2.0 * u_dpr;
  float tone = smoothstep(0.28, 0.92, density);
  float dots = smoothstep(-0.09, 0.09, tone - bayer8(gl_FragCoord.xy / cell));
  float ink = mix(tone * 0.35, dots, 0.8);

  float glow = cliff * (1.0 - smoothstep(0.82, 1.05, edge)) * u_fracture;
  vec3 color = mix(u_ink, u_accent, clamp(glow * 1.6, 0.0, 1.0));
  float reach = mix(u_floor, 1.0, smoothstep(0.34, 0.78, uv.x));
  gl_FragColor = vec4(mix(u_paper, color, ink * reach * 0.68), 1.0);
}
`;

const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const hex = (value: string) =>
  [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);

export function LiquidityField({
  fracture,
  floor = 0.07,
  className = "",
  paper = "#f4f1ea",
  ink = "#16150f",
  accent = "#e5531a",
}: {
  fracture: number;
  /** Ink strength at the left edge, where text usually sits (0–1). */
  floor?: number;
  className?: string;
  paper?: string;
  ink?: string;
  accent?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = useRef(fracture);
  const requestDraw = useRef<(() => void) | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    target.current = fracture;
    requestDraw.current?.();
  }, [fracture]);

  useEffect(() => {
    const element = canvas.current;
    const gl = element?.getContext("webgl", {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    });
    if (!element || !gl) return;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    const release = () => {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
    if (!vertex || !fragment || !program || !buffer) {
      release();
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      release();
      return;
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    const position = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    // Look up locations once, rather than across every animation frame.
    const uniform = Object.fromEntries(
      [
        "res",
        "time",
        "dpr",
        "mouse",
        "fracture",
        "floor",
        "paper",
        "ink",
        "accent",
      ].map((name) => [name, gl.getUniformLocation(program, `u_${name}`)])
    );
    gl.uniform3fv(uniform.paper, hex(paper));
    gl.uniform3fv(uniform.ink, hex(ink));
    gl.uniform3fv(uniform.accent, hex(accent));
    gl.uniform1f(uniform.floor, floor);

    const mouse = { x: 0.8, y: 0.5, tx: 0.8, ty: 0.5 };
    let frame = 0;
    let visible = true;
    let previous = 0;
    let elapsed = 0;
    let current = target.current;
    const schedule = () => {
      if (!frame && visible && !document.hidden) {
        frame = requestAnimationFrame(draw);
      }
    };
    const pause = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
    };
    const draw = (now: number) => {
      frame = 0;
      if (!visible || document.hidden || gl.isContextLost()) return;
      const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 1 / 60;
      previous = now;
      elapsed += delta;
      current += (target.current - current) * (1 - Math.exp(-3 * delta));
      const ease = 1 - Math.exp(-4 * delta);
      mouse.x += (mouse.tx - mouse.x) * ease;
      mouse.y += (mouse.ty - mouse.y) * ease;
      gl.uniform1f(uniform.time, reduced ? 12 : elapsed);
      gl.uniform1f(uniform.fracture, reduced ? target.current : current);
      gl.uniform2f(uniform.mouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!reduced) schedule();
    };
    requestDraw.current = schedule;
    const resize = () => {
      const width = Math.max(1, element.clientWidth);
      const height = Math.max(1, element.clientHeight);
      // Ordered dots need CSS-pixel detail, not a full retina render buffer.
      const scale = Math.min(
        window.devicePixelRatio || 1,
        1,
        Math.sqrt(500_000 / (width * height))
      );
      element.width = Math.max(1, Math.round(width * scale));
      element.height = Math.max(1, Math.round(height * scale));
      gl.viewport(0, 0, element.width, element.height);
      gl.uniform2f(uniform.res, element.width, element.height);
      gl.uniform1f(uniform.dpr, scale);
      schedule();
    };
    resize();
    const sizer = new ResizeObserver(resize);
    sizer.observe(element);

    const surface = element.parentElement;
    const onMove = (event: PointerEvent) => {
      if (reduced || event.pointerType !== "mouse") return;
      const box = element.getBoundingClientRect();
      mouse.tx = Math.max(
        0,
        Math.min(1, (event.clientX - box.left) / box.width)
      );
      mouse.ty = Math.max(
        0,
        Math.min(1, 1 - (event.clientY - box.top) / box.height)
      );
    };
    const onLeave = () => {
      mouse.tx = 0.8;
      mouse.ty = 0.5;
    };
    surface?.addEventListener("pointermove", onMove, { passive: true });
    surface?.addEventListener("pointerleave", onLeave);
    const watcher = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) schedule();
      else pause();
    });
    watcher.observe(element);
    const onVisibility = () => {
      if (document.hidden) pause();
      else schedule();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      requestDraw.current = null;
      pause();
      sizer.disconnect();
      watcher.disconnect();
      surface?.removeEventListener("pointermove", onMove);
      surface?.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [paper, ink, accent, floor, reduced]);

  return (
    <canvas
      ref={canvas}
      className={`liquidity-field ${className}`}
      aria-hidden
    />
  );
}
