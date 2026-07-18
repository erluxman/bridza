// lib/layout.js — pure node-arrangement functions for the stage node-canvas
// (both the task Canvas view and the planner). Given a node COUNT and a mode,
// each returns grid coordinates {col,row} → pixel {x,y} via the given cell size.
// No DOM, no React — just geometry, so it's trivially testable and reused.
//
// Modes:
//   linear  — one straight row, left → right (the default flow reading order)
//   snake   — wraps into rows, alternating direction (boustrophedon) so long
//             flows stay compact without a huge horizontal scroll
//   grid    — wraps into rows, every row left → right
//   tree    — a top-down binary-ish tree by index (levels of 2^depth)
//   radial  — evenly spaced around a circle
export const LAYOUTS = [
  { id: "linear", label: "Linear", hint: "one straight row" },
  { id: "snake",  label: "Snake",  hint: "wraps, alternating direction" },
  { id: "grid",   label: "Grid",   hint: "wraps into a grid" },
  { id: "tree",   label: "Tree",   hint: "top-down levels" },
  { id: "radial", label: "Radial", hint: "around a circle" },
];

const defaultCols = (n) => Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n))));

// Return an array of {col,row} cells for n nodes in the given mode.
function cells(n, mode, cols) {
  const out = [];
  if (mode === "linear") {
    for (let i = 0; i < n; i++) out.push({ col: i, row: 0 });
    return out;
  }
  if (mode === "grid" || mode === "snake") {
    const c = cols || defaultCols(n);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / c);
      const inRow = i % c;
      const col = (mode === "snake" && row % 2 === 1) ? (c - 1 - inRow) : inRow;
      out.push({ col, row });
    }
    return out;
  }
  if (mode === "tree") {
    // level = floor(log2(i+1)); nodes per level = 2^level, centred on a wide grid
    const span = Math.pow(2, Math.max(0, Math.ceil(Math.log2(n + 1)) - 1));
    const width = Math.max(1, span) * 2; // grid columns to centre within
    for (let i = 0; i < n; i++) {
      const level = Math.floor(Math.log2(i + 1));
      const first = Math.pow(2, level) - 1;
      const idxInLevel = i - first;
      const countInLevel = Math.pow(2, level);
      const step = width / countInLevel;
      const col = step * (idxInLevel + 0.5);
      out.push({ col, row: level });
    }
    return out;
  }
  // radial — handled directly in positions (needs angles, not a cell grid)
  for (let i = 0; i < n; i++) out.push({ col: i, row: 0 });
  return out;
}

// Positions in pixels. cell = {w,h} spacing between node centres; pad = margin.
// Returns { nodes:[{x,y}], width, height } — width/height size the canvas.
export function layoutNodes(n, mode = "linear", opts = {}) {
  const cell = opts.cell || { w: 210, h: 150 };
  const pad = opts.pad != null ? opts.pad : 40;
  const nodeW = opts.nodeW || 170, nodeH = opts.nodeH || 92;

  if (n <= 0) return { nodes: [], width: pad * 2, height: pad * 2 };

  if (mode === "radial") {
    const radius = opts.radius || Math.max(cell.w, cell.h) * (n <= 3 ? 0.9 : n / 4);
    const cx = pad + radius + nodeW / 2, cy = pad + radius + nodeH / 2;
    const nodes = [];
    for (let i = 0; i < n; i++) {
      // start at the top (−90°) and go clockwise so order reads naturally
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      nodes.push({ x: Math.round(cx + radius * Math.cos(a) - nodeW / 2), y: Math.round(cy + radius * Math.sin(a) - nodeH / 2) });
    }
    const size = pad * 2 + radius * 2 + Math.max(nodeW, nodeH);
    return { nodes, width: Math.round(size), height: Math.round(size) };
  }

  const cs = cells(n, mode, opts.cols);
  const maxCol = Math.max(...cs.map((c) => c.col));
  const maxRow = Math.max(...cs.map((c) => c.row));
  const nodes = cs.map((c) => ({ x: Math.round(pad + c.col * cell.w), y: Math.round(pad + c.row * cell.h) }));
  return {
    nodes,
    width: Math.round(pad * 2 + maxCol * cell.w + nodeW),
    height: Math.round(pad * 2 + maxRow * cell.h + nodeH),
  };
}
