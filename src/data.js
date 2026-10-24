// Loads the compiled assembly + wire data and exposes typed accessors.
export async function loadData(onProgress) {
  const [asm, wir] = await Promise.all([
    fetch('./data/assembly.json').then(r => r.json()),
    fetch('./data/wires.json').then(r => r.json()),
  ]);
  onProgress?.(0.15, 'Assembly data');

  const strings = asm.strings;
  const S = i => (i < 0 ? null : strings[i]);

  const nodes = asm.nodes.map(r => ({
    id: r[0], parent: r[1] < 0 ? null : r[1], name: S(r[2]), mesh: r[3] === 1,
    p: r.slice(4, 7), q: r.slice(7, 11), s: r.slice(11, 14),
    geo: r[14], bmin: r.slice(15, 18), bmax: r.slice(18, 21),
    role: S(r[21]), owner: S(r[22]), layer: S(r[23]),
    children: [],
  }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const byName = new Map();
  for (const n of nodes) {
    byName.set(n.name, n);
    if (n.parent !== null) byId.get(n.parent).children.push(n);
  }

  const wires = wir.wires.map(r => ({
    id: S(r[0]), from: S(r[1]), to: S(r[2]), coordNode: r[3],
    dynamic: r[4] === 1, role: S(r[5]), radius: r[6], ribbon: r[7] === 1,
    points: r[8], // flat xyz in coordinateNode local space
  }));

  return { nodes, byId, byName, wires, pose: asm.meta.pose, root: byId.get(0) };
}
