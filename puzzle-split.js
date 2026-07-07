/** Split a single mesh into spatial puzzle pieces (triangle clustering). */

const MAX_TRIANGLES = 300_000;

/**
 * @param {'easy'|'normal'|'hard'} difficulty
 */
export function pickSplitCount(difficulty) {
  if (difficulty === 'easy') return 4;
  if (difficulty === 'hard') return 12;
  return 6;
}

function getTriangleCount(geometry) {
  const pos = geometry?.attributes?.position;
  if (!pos) return 0;
  if (geometry.index) return Math.floor(geometry.index.count / 3);
  return Math.floor(pos.count / 3);
}

function readTriangleIndices(geometry, triIndex) {
  if (geometry.index) {
    const base = triIndex * 3;
    return [
      geometry.index.getX(base),
      geometry.index.getX(base + 1),
      geometry.index.getX(base + 2),
    ];
  }
  const base = triIndex * 3;
  return [base, base + 1, base + 2];
}

function pushVertex(out, attr, idx) {
  out.push(attr.getX(idx), attr.getY(idx), attr.getZ(idx));
}

/**
 * @param {import('three').Vector3[]} points
 * @param {number} k
 * @param {number} iterations
 */
function kMeansAssign(points, k, iterations = 12) {
  const n = points.length;
  if (n === 0) return [];

  const centroids = [];
  const used = new Set();
  while (centroids.length < k && used.size < n) {
    const idx = Math.floor(Math.random() * n);
    if (used.has(idx)) continue;
    used.add(idx);
    centroids.push(points[idx].clone());
  }
  while (centroids.length < k) {
    centroids.push(points[Math.floor(Math.random() * n)].clone());
  }

  const assignments = new Uint16Array(n);

  for (let iter = 0; iter < iterations; iter++) {
    const sums = Array.from({ length: k }, () => ({ count: 0, x: 0, y: 0, z: 0 }));

    for (let i = 0; i < n; i++) {
      const p = points[i];
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = p.distanceToSquared(centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      assignments[i] = best;
      sums[best].count++;
      sums[best].x += p.x;
      sums[best].y += p.y;
      sums[best].z += p.z;
    }

    for (let c = 0; c < k; c++) {
      if (sums[c].count === 0) continue;
      centroids[c].set(
        sums[c].x / sums[c].count,
        sums[c].y / sums[c].count,
        sums[c].z / sums[c].count,
      );
    }
  }

  return assignments;
}

function rebalanceEmptyClusters(assignments, k) {
  const counts = new Array(k).fill(0);
  for (let i = 0; i < assignments.length; i++) counts[assignments[i]]++;

  let donor = 0;
  for (let c = 1; c < k; c++) {
    if (counts[c] > counts[donor]) donor = c;
  }

  for (let c = 0; c < k; c++) {
    if (counts[c] > 0) continue;
    for (let i = 0; i < assignments.length; i++) {
      if (assignments[i] === donor) {
        assignments[i] = c;
        counts[c]++;
        counts[donor]--;
        break;
      }
    }
  }
}

/**
 * @param {typeof import('three')} THREE
 * @param {import('three').Mesh} mesh
 * @param {number} partCount
 * @param {(key: string, params?: object) => string} label
 */
export function splitMeshForPuzzle(THREE, mesh, partCount, label) {
  if (!mesh?.isMesh || !mesh.geometry) return { parts: [], triangleCount: 0 };

  const geometry = mesh.geometry;
  const triCount = getTriangleCount(geometry);
  if (triCount < 2) return { parts: [], triangleCount: triCount };

  const effectiveParts = Math.max(2, Math.min(partCount, Math.min(triCount, 24)));
  const posAttr = geometry.attributes.position;
  const normAttr = geometry.attributes.normal;
  const colorAttr = geometry.attributes.color;
  const step = triCount > MAX_TRIANGLES ? Math.ceil(triCount / MAX_TRIANGLES) : 1;

  const centroids = [];
  const sampledTriIndices = [];
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();

  for (let t = 0; t < triCount; t += step) {
    const [i0, i1, i2] = readTriangleIndices(geometry, t);
    vA.fromBufferAttribute(posAttr, i0);
    vB.fromBufferAttribute(posAttr, i1);
    vC.fromBufferAttribute(posAttr, i2);
    centroids.push(new THREE.Vector3().add(vA).add(vB).add(vC).multiplyScalar(1 / 3));
    sampledTriIndices.push(t);
  }

  let assignments = kMeansAssign(centroids, effectiveParts);
  rebalanceEmptyClusters(assignments, effectiveParts);

  const fullAssignments = new Uint16Array(triCount);
  if (step === 1) {
    fullAssignments.set(assignments);
  } else {
    for (let s = 0; s < sampledTriIndices.length; s++) {
      fullAssignments[sampledTriIndices[s]] = assignments[s];
    }
    for (let t = 0; t < triCount; t++) {
      if (t % step === 0) continue;
      const nearestSample = Math.min(sampledTriIndices.length - 1, Math.floor(t / step));
      fullAssignments[t] = assignments[nearestSample];
    }
  }

  const buckets = Array.from({ length: effectiveParts }, () => ({
    pos: [],
    norm: normAttr ? [] : null,
    col: colorAttr ? [] : null,
  }));

  for (let t = 0; t < triCount; t++) {
    const cluster = fullAssignments[t];
    const bucket = buckets[cluster];
    const [i0, i1, i2] = readTriangleIndices(geometry, t);
    for (const idx of [i0, i1, i2]) {
      pushVertex(bucket.pos, posAttr, idx);
      if (normAttr) pushVertex(bucket.norm, normAttr, idx);
      if (colorAttr) pushVertex(bucket.col, colorAttr, idx);
    }
  }

  const parts = [];
  let partIdx = 0;
  for (let c = 0; c < effectiveParts; c++) {
    const bucket = buckets[c];
    if (bucket.pos.length < 9) continue;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bucket.pos, 3));
    if (bucket.norm) {
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.norm, 3));
    } else {
      geo.computeVertexNormals();
    }
    if (bucket.col) {
      geo.setAttribute('color', new THREE.Float32BufferAttribute(bucket.col, 3));
    }

    const partMesh = new THREE.Mesh(geo, mesh.material);
    partMesh.matrix.copy(mesh.matrix);
    partMesh.matrix.decompose(partMesh.position, partMesh.quaternion, partMesh.scale);
    partMesh.castShadow = mesh.castShadow;
    partMesh.receiveShadow = mesh.receiveShadow;
    partMesh.userData.partName = label('puzzleSplitPart', { n: partIdx + 1 });
    partMesh.userData.puzzleSplitPart = true;
    parts.push(partMesh);
    partIdx++;
  }

  return { parts, triangleCount: triCount };
}

/**
 * @param {{
 *   THREE: typeof import('three'),
 *   root: import('three').Object3D,
 *   meshes: import('three').Mesh[],
 *   partCount: number,
 *   label: Function,
 * }} opts
 */
export function createSplitSession({ THREE, root, meshes, partCount, label }) {
  const sessions = [];

  for (const mesh of meshes) {
    const { parts, triangleCount } = splitMeshForPuzzle(THREE, mesh, partCount, label);
    if (parts.length < 2) continue;

    mesh.visible = false;
    mesh.userData.puzzleSplitHidden = true;

    for (const part of parts) {
      root.add(part);
    }

    sessions.push({ original: mesh, parts });
  }

  return sessions.length ? { sessions, partCount } : null;
}

/**
 * @param {Array<{ original: import('three').Mesh, parts: import('three').Mesh[] }>} sessions
 */
export function restoreSplitSession(sessions) {
  if (!sessions?.length) return;

  for (const { original, parts } of sessions) {
    original.visible = true;
    delete original.userData.puzzleSplitHidden;

    for (const part of parts) {
      part.parent?.remove(part);
      part.geometry?.dispose?.();
    }
  }
}

/**
 * Pick meshes to auto-split when the model has too few puzzle parts.
 * @param {import('three').Object3D} root
 */
export function findSplittableMeshes(root) {
  const meshes = [];
  root?.traverse((child) => {
    if (!child.isMesh || child.userData?.puzzleSplitPart || child.userData?.puzzleSplitHidden) return;
    if (child.userData?.nonSelectable || child.userData?.multiModelEntry) return;
    const tris = getTriangleCount(child.geometry);
    if (tris >= 2) meshes.push({ mesh: child, tris });
  });
  meshes.sort((a, b) => b.tris - a.tris);
  return meshes.map((m) => m.mesh);
}