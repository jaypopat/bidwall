"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** True once the element has scrolled into view (or always, with `repeat`). */
export function useInView<T extends Element>(
  options: { threshold?: number; rootMargin?: string; repeat?: boolean } = {}
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  const { threshold = 0.25, rootMargin = "0px", repeat = false } = options;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (!repeat) observer.disconnect();
        } else if (repeat) setInView(false);
      },
      { threshold, rootMargin }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold, rootMargin, repeat]);
  return [ref, inView];
}

/** Fades and lifts its children in when scrolled into view. */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "p" | "h2" | "li" | "section";
}) {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.15 });
  return (
    <Tag
      ref={ref as never}
      className={`reveal ${inView ? "is-in" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

/** Counts from `from` to `to` once visible; formats with `format`. */
export function CountUp({
  to,
  from = 0,
  duration = 1400,
  start = true,
  format = (value) => Math.round(value).toLocaleString("en-US"),
}: {
  to: number;
  from?: number;
  duration?: number;
  start?: boolean;
  format?: (value: number) => string;
}) {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView<HTMLSpanElement>({ threshold: 0.4 });
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (!inView || !start) return;
    if (reduced) {
      const frame = requestAnimationFrame(() => setValue(to));
      return () => cancelAnimationFrame(frame);
    }
    let frame = 0;
    const began = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      setValue(from + (to - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, start, reduced, to, from, duration]);
  return <span ref={ref}>{format(value)}</span>;
}
