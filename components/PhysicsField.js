"use client";
import { useEffect, useRef } from "react";

// Full-page particle field. Particles drift, link to neighbours, get pushed away by the cursor,
// burst outward on click, orbit the screen centre while GitScope is scanning, and explode
// outward once when results land (burstKey changes).
export default function PhysicsField({ scanning = false, calm = false, burstKey = 0 }) {
  const canvasRef = useRef(null);
  const scanRef = useRef(scanning);
  const calmRef = useRef(calm);
  const burstRef = useRef(null);

  useEffect(() => { scanRef.current = scanning; }, [scanning]);
  useEffect(() => { calmRef.current = calm; }, [calm]);
  useEffect(() => { if (burstKey) burstRef.current?.(); }, [burstKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const COLORS = ["98,200,255", "181,140,255", "255,178,64"];
    const mouse = { x: -9999, y: -9999, active: false, down: false };
    let w = 0, h = 0, dpr = 1, raf = 0, last = performance.now(), t = 0;
    let scanMix = 0, calmMix = 0;
    let parts = [];
    let waves = [];

    const rand = (a, b) => a + Math.random() * (b - a);
    const make = () => {
      const r = Math.random();
      return { x: rand(0, w), y: rand(0, h), vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), r: rand(1, 2.6), c: r < 0.7 ? 0 : r < 0.93 ? 1 : 2, ring: rand(150, 340), phase: rand(0, 6.28) };
    };

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(130, Math.max(45, (w * h) / 15000)));
      while (parts.length < n) parts.push(make());
      parts.length = n;
      if (reduce) draw(0);
    }

    function burst(x = w / 2, y = h / 2, power = 12, radius = 520) {
      waves.push({ x, y, age: 0 });
      for (const p of parts) {
        const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1;
        if (d < radius) { const k = (1 - d / radius) * power; p.vx += (dx / d) * k; p.vy += (dy / d) * k; }
      }
    }
    burstRef.current = () => burst(w / 2, h / 2, 16, 900);

    function step(dt) {
      const f = dt * 60;
      t += dt;
      scanMix += ((scanRef.current ? 1 : 0) - scanMix) * Math.min(1, dt * 2.5);
      calmMix += ((calmRef.current ? 1 : 0) - calmMix) * Math.min(1, dt * 2);
      const cx = w / 2, cy = h / 2, R = 180;
      for (const p of parts) {
        p.vx += (Math.sin(t * 0.4 + p.phase) * 0.012 + rand(-0.01, 0.01)) * f;
        p.vy += (Math.cos(t * 0.35 + p.phase) * 0.012 + rand(-0.01, 0.01)) * f;
        if (mouse.active) {
          const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy) || 1;
          if (d < R) {
            const k = 1 - d / R;
            const force = mouse.down ? -k * 0.9 : k * k * 1.7; // hold the button to pull particles into the lens
            p.vx += (dx / d) * force * f; p.vy += (dy / d) * force * f;
          }
        }
        if (scanMix > 0.01) {
          const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1;
          const radial = (p.ring - d) * 0.0026 * scanMix;
          const tangent = 0.34 * scanMix;
          p.vx += ((dx / d) * radial + (-dy / d) * tangent) * f;
          p.vy += ((dy / d) * radial + (dx / d) * tangent) * f;
        }
        const damp = Math.pow(0.985, f);
        p.vx *= damp; p.vy *= damp;
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 7) { p.vx = (p.vx / sp) * 7; p.vy = (p.vy / sp) * 7; }
        p.x += p.vx * f; p.y += p.vy * f;
        if (p.x < -30) p.x = w + 30; else if (p.x > w + 30) p.x = -30;
        if (p.y < -30) p.y = h + 30; else if (p.y > h + 30) p.y = -30;
      }
      for (const wv of waves) wv.age += dt;
      waves = waves.filter((wv) => wv.age < 1);
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      const A = 1 - 0.5 * calmMix;
      const LINK = 130, LENS = 200;
      ctx.lineWidth = 1;
      for (let i = 0; i < parts.length; i++) {
        const a = parts[i];
        for (let j = i + 1; j < parts.length; j++) {
          const b = parts[j];
          const dx = a.x - b.x; if (dx > LINK || dx < -LINK) continue;
          const dy = a.y - b.y; const d2 = dx * dx + dy * dy;
          if (d2 < LINK * LINK) {
            ctx.strokeStyle = `rgba(120,150,255,${(1 - Math.sqrt(d2) / LINK) * 0.3 * A})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const p of parts) {
        let lit = 0;
        if (mouse.active) {
          const d = Math.hypot(p.x - mouse.x, p.y - mouse.y);
          if (d < LENS) {
            lit = 1 - d / LENS;
            ctx.strokeStyle = `rgba(255,178,64,${lit * 0.55})`;
            ctx.beginPath(); ctx.moveTo(mouse.x, mouse.y); ctx.lineTo(p.x, p.y); ctx.stroke();
          }
        }
        ctx.fillStyle = lit > 0.05 ? `rgba(255,190,90,${0.5 + lit * 0.5})` : `rgba(${COLORS[p.c]},${0.75 * A})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + lit * 1.6, 0, 6.283); ctx.fill();
      }
      for (const wv of waves) {
        ctx.strokeStyle = `rgba(255,178,64,${(1 - wv.age) * 0.5})`;
        ctx.lineWidth = 2 * (1 - wv.age) + 0.5;
        ctx.beginPath(); ctx.arc(wv.x, wv.y, wv.age * 640, 0, 6.283); ctx.stroke();
      }
    }

    function frame(now) {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      step(dt); draw();
      raf = requestAnimationFrame(frame);
    }

    const onMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; };
    const onDown = (e) => { mouse.down = true; mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; burst(e.clientX, e.clientY, 7, 320); };
    const onUp = (e) => { mouse.down = false; if (e.pointerType !== "mouse") mouse.active = false; };
    const onLeave = () => { mouse.active = false; mouse.down = false; };

    resize();
    window.addEventListener("resize", resize);
    if (!reduce) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
      window.addEventListener("pointerup", onUp, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      window.addEventListener("blur", onLeave);
      raf = requestAnimationFrame(frame);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      burstRef.current = null;
    };
  }, []);

  return <canvas ref={canvasRef} className="gs-field" aria-hidden="true" />;
}
