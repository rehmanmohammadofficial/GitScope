"use client";
import { useEffect, useRef } from "react";

export const KIND_RGB = {
  root: "255,178,64",
  code: "98,200,255",
  tests: "111,227,181",
  docs: "245,143,180",
  examples: "255,211,107",
  tooling: "154,163,217",
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Live force-directed map of the repository. Solid lines = real folder structure,
// dashed lines with moving dots = AI-inferred flow. Drag nodes, hover to nudge them, click to select.
export default function ArchGraph({ repoName, modules, flow, selectedId, onSelect }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const selRef = useRef(selectedId);
  const cbRef = useRef(onSelect);
  const wakeRef = useRef(null);
  useEffect(() => { selRef.current = selectedId; wakeRef.current?.(); }, [selectedId]);
  useEffect(() => { cbRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, running = false, visible = true, t = 0, last = performance.now();
    const pointer = { x: -9999, y: -9999, inside: false };
    let hover = null, drag = null, sleepFrames = 0;

    const root = { id: "__root", label: repoName || "repo", kind: "root", r: 30, x: 0, y: 0, vx: 0, vy: 0 };
    const nodes = [root, ...modules.map((m) => ({
      id: m.id, label: m.name || m.id, kind: KIND_RGB[m.kind] ? m.kind : "tooling", count: m.fileCount || 0,
      r: clamp(17 + Math.sqrt(m.fileCount || 1) * 2.4, 19, 44), x: 0, y: 0, vx: 0, vy: 0,
    }))];
    const find = (key) => {
      const k = String(key || "").toLowerCase();
      return nodes.find((n) => n.id !== "__root" && (String(n.id).toLowerCase() === k || String(n.label).toLowerCase() === k)) ||
        nodes.find((n, i) => i > 0 && String(modules[i - 1].path || "").toLowerCase() === k);
    };
    const edges = modules.map((m, i) => ({ a: root, b: nodes[i + 1], kind: "real" }));
    const seen = new Set();
    for (const f of flow || []) {
      const a = find(f.from), b = find(f.to);
      if (!a || !b || a === b) continue;
      const key = a.id + ">" + b.id;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b, kind: "flow", label: f.label || "", off: Math.random() });
    }

    function layout() {
      root.x = w / 2; root.y = h / 2;
      const R = Math.min(w, h) * 0.34;
      nodes.slice(1).forEach((n, i, arr) => {
        if (n.x || n.y) return;
        const ang = (i / arr.length) * Math.PI * 2 - Math.PI / 2;
        n.x = root.x + Math.cos(ang) * R * 1.5 + (Math.random() - 0.5) * 30;
        n.y = root.y + Math.sin(ang) * R + (Math.random() - 0.5) * 30;
      });
    }

    function resize() {
      const r = wrap.getBoundingClientRect();
      const nw = Math.max(280, r.width), nh = Math.max(260, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const sx = w ? nw / w : 1, sy = h ? nh / h : 1;
      if (w) nodes.forEach((n) => { n.x *= sx; n.y *= sy; });
      w = nw; h = nh;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layout(); wake();
    }

    function step(dt) {
      const f = Math.min(2, dt * 60);
      const S = clamp(Math.min(w, h) / 470, 0.7, 1.35);
      let energy = 0;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy || 1;
          const d = Math.sqrt(d2);
          const min = a.r + b.r + 40;
          let force = (11000 * S * S) / d2;
          if (d < min) force += (min - d) * 0.05;
          dx /= d; dy /= d;
          a.vx -= dx * force * f; a.vy -= dy * force * f;
          b.vx += dx * force * f; b.vy += dy * force * f;
        }
      }
      for (const e of edges) {
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.hypot(dx, dy) || 1;
        const rest = (e.kind === "real" ? 130 + e.b.r + e.a.r : 230) * S;
        const k = e.kind === "real" ? 0.022 : 0.004;
        const pull = (d - rest) * k;
        e.a.vx += (dx / d) * pull * f; e.a.vy += (dy / d) * pull * f;
        e.b.vx -= (dx / d) * pull * f; e.b.vy -= (dy / d) * pull * f;
      }
      for (const n of nodes) {
        const g = n === root ? 0.03 : 0.004;
        n.vx += (w / 2 - n.x) * g * 0.45 * f; n.vy += (h / 2 - n.y) * g * 1.4 * f;
        if (pointer.inside && !reduce && n !== drag) {
          const dx = n.x - pointer.x, dy = n.y - pointer.y, d = Math.hypot(dx, dy) || 1;
          if (d < 150) { const k = (1 - d / 150) * 0.32; n.vx += (dx / d) * k * f; n.vy += (dy / d) * k * f; }
        }
        if (n === drag) {
          n.vx = (pointer.x - n.x) * 0.5; n.vy = (pointer.y - n.y) * 0.5;
        }
        const damp = Math.pow(0.86, f);
        n.vx *= damp; n.vy *= damp;
        n.x += n.vx * f; n.y += n.vy * f;
        n.x = clamp(n.x, n.r + 8, w - n.r - 8); n.y = clamp(n.y, n.r + 22, h - n.r - 22);
        energy += Math.abs(n.vx) + Math.abs(n.vy);
      }
      return energy;
    }

    const rgba = (rgb, a) => `rgba(${rgb},${a})`;
    function arrow(x1, y1, x2, y2, color) {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      ctx.fillStyle = color; ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - 9 * Math.cos(ang - 0.4), y2 - 9 * Math.sin(ang - 0.4));
      ctx.lineTo(x2 - 9 * Math.cos(ang + 0.4), y2 - 9 * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fill();
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      const sel = nodes.find((n) => n.id === selRef.current);
      const focus = hover || sel;
      // real folder edges
      for (const e of edges) {
        if (e.kind !== "real") continue;
        const on = focus && (e.a === focus || e.b === focus);
        ctx.strokeStyle = rgba("98,200,255", on ? 0.85 : 0.35);
        ctx.lineWidth = on ? 2 : 1.4; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
      }
      // AI-inferred flow edges
      for (const e of edges) {
        if (e.kind !== "flow") continue;
        const on = focus && (e.a === focus || e.b === focus);
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        const x1 = e.a.x + ux * (e.a.r + 3), y1 = e.a.y + uy * (e.a.r + 3);
        const x2 = e.b.x - ux * (e.b.r + 5), y2 = e.b.y - uy * (e.b.r + 5);
        const col = rgba("181,140,255", on ? 1 : 0.6);
        ctx.strokeStyle = col; ctx.lineWidth = on ? 2 : 1.4;
        ctx.setLineDash([3, 6]); ctx.lineDashOffset = reduce ? 0 : -t * 14;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.setLineDash([]);
        arrow(x1, y1, x2, y2, col);
        if (!reduce) {
          const p = (t * 0.35 + e.off) % 1;
          ctx.fillStyle = rgba("225,205,255", 0.95);
          ctx.beginPath(); ctx.arc(x1 + (x2 - x1) * p, y1 + (y2 - y1) * p, 2.6, 0, 6.283); ctx.fill();
        }
        if (on && e.label) {
          ctx.font = "500 11px 'JetBrains Mono', ui-monospace, monospace";
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, tw = ctx.measureText(e.label).width;
          ctx.fillStyle = "rgba(12,15,46,.92)"; ctx.fillRect(mx - tw / 2 - 5, my - 10, tw + 10, 18);
          ctx.fillStyle = rgba("225,205,255", 1); ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(e.label.slice(0, 28), mx, my);
        }
      }
      // nodes
      for (const n of nodes) {
        const rgb = KIND_RGB[n.kind];
        const isSel = sel === n, isHot = hover === n || drag === n;
        let lens = 0;
        if (pointer.inside) lens = Math.max(0, 1 - Math.hypot(n.x - pointer.x, n.y - pointer.y) / 160);
        const glow = isHot ? 1 : isSel ? 0.8 : lens * 0.6;
        const g = ctx.createRadialGradient(n.x - n.r * 0.3, n.y - n.r * 0.3, 1, n.x, n.y, n.r);
        g.addColorStop(0, rgba(rgb, 0.42 + glow * 0.3)); g.addColorStop(1, rgba(rgb, 0.1 + glow * 0.12));
        ctx.shadowColor = rgba(rgb, 0.9); ctx.shadowBlur = glow * 24;
        ctx.fillStyle = g; ctx.strokeStyle = rgba(rgb, 0.7 + glow * 0.3); ctx.lineWidth = isSel ? 2.5 : 1.5;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + (isHot ? 2 : 0), 0, 6.283); ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0;
        if (isSel) {
          ctx.strokeStyle = rgba("255,178,64", 0.95); ctx.lineWidth = 1.6;
          ctx.setLineDash([5, 5]); ctx.lineDashOffset = reduce ? 0 : -t * 20;
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 9, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        if (n.kind === "root") {
          ctx.fillStyle = "#FFE7BE"; ctx.font = "700 11px 'Plus Jakarta Sans', system-ui, sans-serif";
          ctx.fillText(String(n.label).slice(0, 9), n.x, n.y);
        } else {
          ctx.fillStyle = "#EAF6FF"; ctx.font = "600 12px 'JetBrains Mono', ui-monospace, monospace";
          ctx.fillText(String(n.count), n.x, n.y);
          ctx.font = `${isHot || isSel ? 700 : 500} 13px 'Plus Jakarta Sans', system-ui, sans-serif`;
          ctx.fillStyle = isHot || isSel ? "#FFFFFF" : "rgba(233,236,255,.86)";
          ctx.fillText(String(n.label).slice(0, 18), n.x, n.y + n.r + 16);
        }
      }
    }

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      const energy = step(dt);
      draw();
      if (reduce) { sleepFrames = energy < 0.05 && !drag ? sleepFrames + 1 : 0; if (sleepFrames > 20) { running = false; return; } }
      raf = visible ? requestAnimationFrame(frame) : 0;
      if (!visible) running = false;
    }
    function wake() {
      sleepFrames = 0;
      if (running || !visible) return;
      running = true; last = performance.now(); raf = requestAnimationFrame(frame);
    }
    wakeRef.current = wake;

    const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const hit = (x, y) => { let best = null, bd = 1e9; for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < n.r + 8 && d < bd) { best = n; bd = d; } } return best; };
    let down = null;
    const onMove = (e) => {
      const p = local(e); pointer.x = p.x; pointer.y = p.y; pointer.inside = true;
      hover = drag || hit(p.x, p.y);
      canvas.style.cursor = drag ? "grabbing" : hover ? "grab" : "default";
      wake();
    };
    const onLeave = () => { pointer.inside = false; if (!drag) hover = null; wake(); };
    const onDown = (e) => {
      const p = local(e); const n = hit(p.x, p.y);
      if (!n) return;
      drag = n; down = { x: p.x, y: p.y, moved: 0, n };
      canvas.setPointerCapture(e.pointerId); pointer.x = p.x; pointer.y = p.y; wake();
    };
    const onUp = (e) => {
      if (down && down.moved < 5 && down.n.id !== "__root") cbRef.current?.(down.n.id);
      drag = null; down = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
      wake();
    };
    const onMoveDrag = (e) => { if (down) { const p = local(e); down.moved = Math.max(down.moved, Math.hypot(p.x - down.x, p.y - down.y)); } };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointermove", onMoveDrag);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    const ro = new ResizeObserver(resize); ro.observe(wrap);
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) wake(); }, { threshold: 0.01 });
    io.observe(wrap);
    resize();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); wakeRef.current = null;
      canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointermove", onMoveDrag);
      canvas.removeEventListener("pointerleave", onLeave); canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules, flow, repoName]);

  return (
    <div ref={wrapRef} className="gs-graph">
      <canvas ref={canvasRef} data-drag="true" role="img" aria-label="Interactive map of the repository's modules. The module list beside it has the same information." />
    </div>
  );
}
