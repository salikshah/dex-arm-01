// One whole-field, 16:9 board. Adapted conceptually from the user's Big Ben
// contour raster / occupancy index: project actual triangles, preserve holes,
// dilate for clearance, and reject occupied cells. No per-assembly shelves.
import * as THREE from 'three';

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function random(seed) {
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
}

// Conservative triangle-strip raster. Every cell touched by a projected
// triangle is reserved, including narrow edges; actual through-holes stay open.
function silhouette(rec, step) {
  const w = Math.ceil(rec._flatSize.x / step) + 5;
  const h = Math.ceil(rec._flatSize.y / step) + 5;
  const grid = new Uint8Array(w * h);
  const attr = rec.mesh.geometry.attributes.position;
  const ix = rec.mesh.geometry.index;
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const count = ix ? ix.count : attr.count;
  const sx = rec._flatSize.x / (2 * step) + 2, sy = rec._flatSize.y / (2 * step) + 2;
  for (let n = 0; n < count; n += 3) {
    for (let k = 0; k < 3; k++) {
      v[k].fromBufferAttribute(attr, ix ? ix.getX(n + k) : n + k).multiply(rec.entry.scale).applyQuaternion(rec._flatQuat);
      v[k].x = v[k].x / step + sx; v[k].y = v[k].y / step + sy;
    }
    const lo = Math.max(0, Math.floor(Math.min(...v.map(p => p.y))));
    const hi = Math.min(h - 1, Math.floor(Math.max(...v.map(p => p.y))));
    for (let y = lo; y <= hi; y++) {
      let minX = Infinity, maxX = -Infinity;
      const take = x => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); };
      for (let k = 0; k < 3; k++) {
        const a = v[k], b = v[(k + 1) % 3];
        if (a.y >= y && a.y <= y + 1) take(a.x);
        for (const yy of [y, y + 1]) {
          if (Math.abs(b.y - a.y) < 1e-10) continue;
          const t = (yy - a.y) / (b.y - a.y);
          if (t >= 0 && t <= 1) take(a.x + t * (b.x - a.x));
        }
      }
      if (!Number.isFinite(minX)) continue;
      const left = Math.max(0, Math.floor(minX) - 1), right = Math.min(w - 1, Math.floor(maxX) + 1);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) grid.fill(1, yy * w + left, yy * w + right + 1);
    }
  }
  const spans = [];
  let area = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (grid[y * w + x]) {
      const start = x;
      while (x + 1 < w && grid[y * w + x + 1]) x++;
      spans.push(y, start, x + 1); area += x - start + 1;
    }
  }
  return { rec, w, h, sx, sy, spans, area, seed: hash(rec.id + '/' + rec.name) };
}

export function packContourBoard(parts) {
  const started = performance.now();
  const columns = 1152, rows = 648; // exact 16:9, isotropic cells
  const area = parts.reduce((sum, r) => sum + r._flatSize.x * r._flatSize.y, 0);
  const maxW = Math.max(...parts.map(r => r._flatSize.x));
  const maxH = Math.max(...parts.map(r => r._flatSize.y));
  let width = Math.max(Math.sqrt(area * 16 / 9 * 1.12), maxW * 1.1, maxH * 16 / 9 * 1.1);
  for (let attempt = 0; attempt < 24; attempt++, width *= 1.055) {
    const step = width / columns;
    const masks = parts.map(r => silhouette(r, step));
    masks.sort((a, b) => b.area - a.area || a.seed - b.seed);
    const occupied = new Uint16Array(columns * rows); // spatial hash: y * columns + x
    let failures = 0, occupiedCount = 0, trials = 0;
    const placements = [];
    for (const mask of masks) {
      const rng = random(mask.seed || 1), maxX = columns - mask.w, maxY = rows - mask.h;
      let px = -1, py = -1;
      const free = (x, y) => {
        trials++;
        const spans = mask.spans;
        for (let i = 0; i < spans.length; i += 3) {
          const row = (y + spans[i]) * columns + x;
          for (let j = spans[i + 1]; j < spans[i + 2]; j++) if (occupied[row + j]) return false;
        }
        return true;
      };
      // Hash-distributed candidates mix every assembly across the entire board.
      for (let trial = 0; trial < 1800; trial++) {
        const x = Math.floor(rng() * (maxX + 1)), y = Math.floor(rng() * (maxY + 1));
        if (free(x, y)) { px = x; py = y; break; }
      }
      if (px < 0) { failures++; break; }
      for (let i = 0; i < mask.spans.length; i += 3) {
        const row = (py + mask.spans[i]) * columns + px;
        occupied.fill(placements.length + 1, row + mask.spans[i + 1], row + mask.spans[i + 2]);
      }
      occupiedCount += mask.area;
      placements.push({ mask, x: px, y: py });
    }
    if (failures) continue;
    // Independent replay audit: detect even one occupied contour cell collision.
    const audit = new Uint8Array(occupied.length);
    let overlaps = 0;
    for (const { mask, x, y } of placements) {
      for (let i = 0; i < mask.spans.length; i += 3) {
        const row = (y + mask.spans[i]) * columns + x;
        for (let j = mask.spans[i + 1]; j < mask.spans[i + 2]; j++) {
          if (audit[row + j]) overlaps++;
          audit[row + j] = 1;
        }
      }
      mask.rec._flatLocal = new THREE.Vector2((x + mask.sx) * step, (y + mask.sy) * step);
    }
    return {
      width, height: rows * step, gap: step * 2, aspect: 16 / 9,
      method: 'global-triangle-contour-spatial-hash', packedParts: placements.length,
      contourOverlapCount: overlaps, occupancy: occupiedCount / occupied.length,
      attempts: attempt + 1, trials, grid: [columns, rows], milliseconds: performance.now() - started,
    };
  }
  throw new Error('Contour board could not place every part');
}
