// Liquid glass čočka pro plovoucí ovládání (Chromium umí SVG filtr v backdrop-filter).
// Pro každý tvar (šířka × výška × zaoblení) spočítáme displacement mapu:
//  - u okraje sklo silně ohýbá obraz dovnitř (jako hrana čočky),
//  - uprostřed obraz lehce zvětšuje,
//  - každý barevný kanál se láme trochu jinak → duhový lem na hraně.
// Safari/iOS backdrop-filter s url() neumí, tam zůstává matné sklo z CSS.

const NS = "http://www.w3.org/2000/svg";
const supported = !!navigator.userAgentData?.brands?.some((b) => /Chromium/i.test(b.brand))
  && !matchMedia("(prefers-reduced-transparency: reduce)").matches;

let defs = null;
const filters = new Map(); // klíč tvaru -> id filtru
const observed = new WeakSet();

function sdfRoundRect(x, y, hw, hh, r) {
  const qx = Math.abs(x) - (hw - r), qy = Math.abs(y) - (hh - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Displacement mapa jako PNG (R = posun x, G = posun y, 128 = bez posunu). */
function displacementMap(w, h, r, bezel, edgePx, magnify) {
  const cw = Math.ceil(w), ch = Math.ceil(h);
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(cw, ch);
  const hw = w / 2, hh = h / 2;
  const maxPx = edgePx + magnify * Math.max(hw, hh);
  for (let py = 0; py < ch; py++) {
    for (let px = 0; px < cw; px++) {
      const x = px + 0.5 - hw, y = py + 0.5 - hh;
      const d = -sdfRoundRect(x, y, hw, hh, r); // vzdálenost od okraje dovnitř
      let dx = 0, dy = 0;
      if (d > 0) {
        // normála okraje z gradientu SDF
        const gx = sdfRoundRect(x + 0.5, y, hw, hh, r) - sdfRoundRect(x - 0.5, y, hw, hh, r);
        const gy = sdfRoundRect(x, y + 0.5, hw, hh, r) - sdfRoundRect(x, y - 0.5, hw, hh, r);
        const gl = Math.hypot(gx, gy) || 1;
        const t = Math.max(0, 1 - d / bezel);
        const k = edgePx * t * t * (3 - 2 * t); // hladký, nejsilnější u hrany
        // posun vzorku dovnitř = obraz na hraně se "nasaje" do skla
        dx = -(gx / gl) * k - x * magnify;
        dy = -(gy / gl) * k - y * magnify;
      }
      const i = (py * cw + px) * 4;
      img.data[i] = 128 + Math.max(-127, Math.min(127, (dx / maxPx) * 127));
      img.data[i + 1] = 128 + Math.max(-127, Math.min(127, (dy / maxPx) * 127));
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: c.toDataURL(), scale: maxPx * 2 };
}

function el(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function filterFor(w, h, r, pressed) {
  const strength = pressed ? 1.45 : 1;
  const key = `${Math.round(w)}x${Math.round(h)}r${Math.round(r)}${pressed ? "p" : ""}`;
  if (filters.has(key)) return filters.get(key);
  // Okraj čočky ~ třetina výšky, posun max ~10 px: čiré sklo, ohyb hlavně u hrany.
  const bezel = Math.min(Math.min(w, h) * 0.34, 18);
  const edgePx = Math.min(h * 0.2, 10) * strength;
  const magnify = 0.025 * strength;
  const { url, scale } = displacementMap(w, h, r, bezel, edgePx, magnify);
  const id = `lens-${key}`;
  const f = el("filter", { id, x: "0", y: "0", width: w, height: h, filterUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" });
  f.append(el("feImage", { href: url, x: 0, y: 0, width: w, height: h, result: "map", preserveAspectRatio: "none" }));
  // Rozklad barev: červená se láme nejvíc, modrá nejméně.
  const channels = [["r", 1, "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"], ["g", 0.96, "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"], ["b", 0.92, "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"]];
  for (const [name, mul, matrix] of channels) {
    f.append(el("feDisplacementMap", { in: "SourceGraphic", in2: "map", scale: (scale * mul).toFixed(1), xChannelSelector: "R", yChannelSelector: "G", result: `d${name}` }));
    f.append(el("feColorMatrix", { in: `d${name}`, type: "matrix", values: matrix, result: `c${name}` }));
  }
  f.append(el("feBlend", { in: "cr", in2: "cg", mode: "screen", result: "rg" }));
  f.append(el("feBlend", { in: "rg", in2: "cb", mode: "screen" }));
  defs.append(f);
  filters.set(key, id);
  return id;
}

function apply(node) {
  const rect = node.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return;
  const r = Math.min(parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0, rect.height / 2, rect.width / 2);
  const pressed = node.classList.contains("pressed");
  const id = filterFor(rect.width, rect.height, r, pressed);
  node.style.backdropFilter = `url(#${id}) saturate(1.6) brightness(1.06)`;
}

const resize = new ResizeObserver((entries) => entries.forEach((e) => apply(e.target)));

function watch(node) {
  if (observed.has(node)) return apply(node);
  observed.add(node);
  resize.observe(node);
  node.addEventListener("pointerdown", () => { node.classList.add("pressed"); apply(node); });
  const release = () => { if (node.classList.contains("pressed")) { node.classList.remove("pressed"); apply(node); } };
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => node.addEventListener(ev, release));
  apply(node);
}

export function initGlass() {
  if (!supported) return;
  document.documentElement.classList.add("lens-on");
  const svg = el("svg", { width: 0, height: 0, "aria-hidden": "true", style: "position:absolute" });
  defs = el("defs", {});
  svg.append(defs);
  document.body.prepend(svg);
  const scan = (root) => {
    if (root.nodeType !== 1) return;
    if (root.matches(".lens")) watch(root);
    root.querySelectorAll?.(".lens").forEach(watch);
  };
  scan(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes" && m.target.matches?.(".lens")) watch(m.target);
      m.addedNodes.forEach(scan);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
}
