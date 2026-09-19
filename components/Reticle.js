"use client";
import { useEffect, useRef } from "react";

// A spring-driven scope ring that trails the real cursor. The native cursor stays visible.
export default function Reticle() {
  const ringRef = useRef(null);
  const dotRef = useRef(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ring = ringRef.current, dot = dotRef.current;
    let tx = -200, ty = -200, x = -200, y = -200, vx = 0, vy = 0;
    let s = 1, vs = 0, ts = 1, rot = 0, raf = 0, shown = false;

    const hotSel = "a, button, input, textarea, summary, label, [role='button'], [role='radio'], [data-hot]";
    const onMove = (e) => {
      tx = e.clientX; ty = e.clientY;
      dot.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      if (!shown) { shown = true; x = tx; y = ty; ring.classList.add("is-on"); dot.classList.add("is-on"); }
      const el = e.target instanceof Element ? e.target : null;
      const drag = el && el.closest("[data-drag]");
      const hot = el && el.closest(hotSel);
      ts = drag ? 1.5 : hot ? 1.9 : 1;
      ring.classList.toggle("is-hot", !!hot || !!drag);
    };
    const onDown = () => { ts *= 0.7; ring.classList.add("is-down"); };
    const onUp = () => { ts = ring.classList.contains("is-hot") ? 1.9 : 1; ring.classList.remove("is-down"); };
    const onLeave = () => { shown = false; ring.classList.remove("is-on"); dot.classList.remove("is-on"); };

    const loop = () => {
      vx = (vx + (tx - x) * 0.13) * 0.72; vy = (vy + (ty - y) * 0.13) * 0.72;
      x += vx; y += vy;
      vs = (vs + (ts - s) * 0.2) * 0.7; s += vs;
      rot += Math.hypot(vx, vy) * 0.6 + 0.25;
      ring.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`;
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <>
      <div ref={ringRef} className="gs-reticle" aria-hidden="true">
        <svg viewBox="-24 -24 48 48" width="48" height="48">
          <circle r="15" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M0-24v9M0 15v9M-24 0h9M15 0h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <div ref={dotRef} className="gs-reticle-dot" aria-hidden="true" />
    </>
  );
}
