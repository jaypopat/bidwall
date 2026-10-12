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
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time * 0.05;

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
  float ink = step(bayer8(gl_FragCoord.xy / cell), smoothstep(0.28, 0.92, density));

  float glow = cliff * (1.0 - smoothstep(0.82, 1.05, edge)) * u_fracture;
  vec3 color = mix(u_ink, u_accent, clamp(glow * 1.6, 0.0, 1.0));
  float reach = mix(u_floor, 1.0, smoothstep(0.34, 0.78, uv.x));
  gl_FragColor = vec4(mix(u_paper, color, ink * reach * 0.82), 1.0);
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
  const reduced = useReducedMotion();
  useEffect(() => {
    target.current = fracture;
  }, [fracture]);

  useEffect(() => {
    const element = canvas.current;
    const gl = element?.getContext("webgl", {
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!element || !gl) return;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    const position = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    gl.uniform3fv(uniform("u_paper"), hex(paper));
    gl.uniform3fv(uniform("u_ink"), hex(ink));
    gl.uniform3fv(uniform("u_accent"), hex(accent));
    gl.uniform1f(uniform("u_floor"), floor);

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      element.width = Math.round(element.clientWidth * dpr);
      element.height = Math.round(element.clientHeight * dpr);
      gl.viewport(0, 0, element.width, element.height);
      gl.uniform2f(uniform("u_res"), element.width, element.height);
      gl.uniform1f(uniform("u_dpr"), dpr);
    };
    resize();
    const sizer = new ResizeObserver(resize);
    sizer.observe(element);

    const mouse = { x: 0.8, y: 0.5, tx: 0.8, ty: 0.5 };
    const onMove = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      mouse.tx = (event.clientX - box.left) / box.width;
      mouse.ty = 1 - (event.clientY - box.top) / box.height;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let frame = 0;
    let visible = true;
    const watcher = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !reduced) frame = requestAnimationFrame(draw);
    });
    watcher.observe(element);

    let current = target.current;
    const began = performance.now();
    const draw = (now: number) => {
      current += (target.current - current) * 0.035;
      mouse.x += (mouse.tx - mouse.x) * 0.06;
      mouse.y += (mouse.ty - mouse.y) * 0.06;
      gl.uniform1f(uniform("u_time"), reduced ? 12 : (now - began) / 1000);
      gl.uniform1f(uniform("u_fracture"), reduced ? target.current : current);
      gl.uniform2f(uniform("u_mouse"), mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (visible && !reduced) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      sizer.disconnect();
      watcher.disconnect();
      window.removeEventListener("pointermove", onMove);
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
