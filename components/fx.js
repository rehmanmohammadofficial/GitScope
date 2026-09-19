"use client";
import { useEffect, useRef } from "react";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const fineHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

// A card that leans toward the cursor on a spring and carries a moving highlight.
export function Tilt({ as: Tag = "div", max = 7, className = "", children, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || !fineHover()) return;
    const s = { rx: 0, ry: 0, vx: 0, vy: 0, trx: 0, try_: 0, raf: 0 };
    const tick = () => {
      s.vx = (s.vx + (s.trx - s.rx) * 0.12) * 0.78; s.vy = (s.vy + (s.try_ - s.ry) * 0.12) * 0.78;
      s.rx += s.vx; s.ry += s.vy;
      el.style.setProperty("--rx", s.rx.toFixed(2) + "deg");
      el.style.setProperty("--ry", s.ry.toFixed(2) + "deg");
      const settled = Math.abs(s.vx) + Math.abs(s.vy) < 0.01 && Math.abs(s.rx - s.trx) + Math.abs(s.ry - s.try_) < 0.02;
      s.raf = settled ? 0 : requestAnimationFrame(tick);
    };
    const wake = () => { if (!s.raf) s.raf = requestAnimationFrame(tick); };
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      s.try_ = (px - 0.5) * 2 * max; s.trx = -(py - 0.5) * 2 * max;
      el.style.setProperty("--gx", (px * 100).toFixed(1) + "%");
      el.style.setProperty("--gy", (py * 100).toFixed(1) + "%");
      el.style.setProperty("--glare", "1");
      wake();
    };
    const leave = () => { s.trx = 0; s.try_ = 0; el.style.setProperty("--glare", "0"); wake(); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => { cancelAnimationFrame(s.raf); el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
  }, [max]);
  return <Tag ref={ref} className={`gs-tilt ${className}`} {...rest}>{children}</Tag>;
}

// Pulls its content toward the cursor when the cursor is near, then springs back.
export function Magnetic({ strength = 0.32, radius = 80, className = "", children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || !fineHover()) return;
    const s = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, raf: 0 };
    const tick = () => {
      s.vx = (s.vx + (s.tx - s.x) * 0.16) * 0.7; s.vy = (s.vy + (s.ty - s.y) * 0.16) * 0.7;
      s.x += s.vx; s.y += s.vy;
      el.style.transform = `translate3d(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px, 0)`;
      const settled = Math.abs(s.vx) + Math.abs(s.vy) < 0.02 && Math.abs(s.x - s.tx) + Math.abs(s.y - s.ty) < 0.05;
      s.raf = settled ? 0 : requestAnimationFrame(tick);
    };
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2 - s.x, cy = r.top + r.height / 2 - s.y;
      const dx = e.clientX - cx, dy = e.clientY - cy;
      const near = Math.abs(dx) < r.width / 2 + radius && Math.abs(dy) < r.height / 2 + radius;
      s.tx = near ? dx * strength : 0; s.ty = near ? dy * strength : 0;
      if (!s.raf) s.raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { cancelAnimationFrame(s.raf); window.removeEventListener("pointermove", onMove); };
  }, [strength, radius]);
  return <span ref={ref} className={`gs-magnetic ${className}`}>{children}</span>;
}

// Headline whose letters get heavier and lift as the cursor passes (variable font weight axis).
export function ReactiveText({ lines, className = "", compact = false }) {
  const wrap = useRef(null);
  const letters = useRef([]);

  // Keep the headline on one line: measure it at 100px, then scale to the space available.
  useEffect(() => {
    const h = wrap.current;
    const fit = () => {
      if (!h || !h.parentElement) return;
      if (window.innerWidth <= 560) { h.style.fontSize = ""; return; }
      const box = h.parentElement, cs = getComputedStyle(box);
      const avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      h.style.fontSize = "100px";
      const natural = (h.firstElementChild || h).getBoundingClientRect().width || 1;
      const cap = compact ? 34 : 60;
      h.style.fontSize = `${Math.max(20, Math.min(cap, (avail / natural) * 100 * 0.96)).toFixed(1)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    document.fonts?.ready.then(fit);
    document.fonts?.addEventListener?.("loadingdone", fit);
    return () => { window.removeEventListener("resize", fit); document.fonts?.removeEventListener?.("loadingdone", fit); };
  }, [compact]);

  useEffect(() => {
    if (reducedMotion() || !fineHover()) return;
    const items = letters.current.filter(Boolean).map((el) => ({ el, w: 600, lift: 0 }));
    let mx = -9999, my = -9999, raf = 0;
    const BASE = 600, PEAK = 800, RAD = 210;
    const tick = () => {
      const reads = items.map((it) => { const r = it.el.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 + it.lift }; });
      let busy = false;
      items.forEach((it, i) => {
        const d = Math.hypot(reads[i].cx - mx, reads[i].cy - my);
        const f = Math.pow(Math.max(0, 1 - d / RAD), 2);
        const tw = BASE + f * (PEAK - BASE), tl = -f * 9;
        it.w += (tw - it.w) * 0.14; it.lift += (tl - it.lift) * 0.14;
        if (Math.abs(tw - it.w) > 1 || Math.abs(tl - it.lift) > 0.1) busy = true;
      });
      items.forEach((it) => {
        it.el.style.fontVariationSettings = `"wght" ${it.w.toFixed(0)}`;
        it.el.style.transform = `translateY(${it.lift.toFixed(2)}px)`;
      });
      raf = busy ? requestAnimationFrame(tick) : 0;
    };
    const onMove = (e) => {
      mx = e.clientX; my = e.clientY;
      const r = wrap.current.getBoundingClientRect();
      if (my > r.top - RAD && my < r.bottom + RAD && !raf) raf = requestAnimationFrame(tick);
    };
    const onLeave = () => { mx = -9999; my = -9999; if (!raf) raf = requestAnimationFrame(tick); };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); document.documentElement.removeEventListener("pointerleave", onLeave); };
  }, []);

  let idx = 0;
  return (
    <h1 ref={wrap} className={className} aria-label={lines.join(" ")}>
      {lines.map((line, li) => (
        <span className="gs-line" key={li} aria-hidden="true">
          {line.split(" ").map((word, wi) => (
            <span className="gs-word" key={wi}>
              {[...word].map((ch) => {
                const i = idx++;
                return <span className="gs-letter" key={i} ref={(el) => (letters.current[i] = el)}>{ch}</span>;
              })}
            </span>
          ))}
        </span>
      ))}
    </h1>
  );
}
