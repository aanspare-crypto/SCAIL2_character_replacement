'use strict';
// Merges many small meshes into a few draw calls.

const MeshUtil = (() => {
  if (typeof THREE === 'undefined') return null;
  const U = {};
  const vcMats = {};
  function vcMaterial(kind) {
    if (!vcMats[kind]) {
      vcMats[kind] = kind === 'phong'
        ? new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: new THREE.Color(0x333333) })
        : new THREE.MeshLambertMaterial({ vertexColors: true });
    }
    return vcMats[kind];
  }
  const tmpM = new THREE.Matrix4(), inv = new THREE.Matrix4();

  // Merge mesh descendants of `group` (only direct children unless deep) into one mesh per material.
  // bakeColor: untextured materials are folded into shared vertex-coloured materials.
  U.merge = (group, { deep = false, bakeColor = false } = {}) => {
    group.updateMatrixWorld(true);
    inv.copy(group.matrixWorld).invert();
    const buckets = new Map();
    const victims = [];
    const visit = (o) => {
      for (const c of o.children) {
        if (c.userData.noMerge) continue;
        if (c.isMesh) victims.push(c);
        else if (deep && c.children.length) visit(c);
      }
    };
    visit(group);
    let castShadow = false;
    for (const m of victims) {
      if (m.material.transparent || m.material.map && !m.material.map.image) continue;
      tmpM.multiplyMatrices(inv, m.matrixWorld);
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(tmpM);
      let mat = m.material, color = null;
      if (bakeColor && !mat.map && !mat.vertexColors) {
        color = mat.color;
        mat = vcMaterial(mat.isMeshPhongMaterial ? 'phong' : 'lambert');
      }
      let b = buckets.get(mat);
      if (!b) { b = { pos: [], nor: [], uv: [], col: [], hasCol: !!color || mat.vertexColors }; buckets.set(mat, b); }
      const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, CO = g.attributes.color;
      for (let i = 0; i < P.count; i++) {
        b.pos.push(P.getX(i), P.getY(i), P.getZ(i));
        if (N) b.nor.push(N.getX(i), N.getY(i), N.getZ(i)); else b.nor.push(0, 1, 0);
        if (UV) b.uv.push(UV.getX(i), UV.getY(i)); else b.uv.push(0, 0);
        if (color) b.col.push(color.r, color.g, color.b);
        else if (CO) b.col.push(CO.getX(i), CO.getY(i), CO.getZ(i));
        else b.col.push(1, 1, 1);
      }
      g.dispose();
      castShadow = castShadow || m.castShadow;
      m.parent.remove(m);
    }
    for (const [mat, b] of buckets) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      if (b.hasCol) g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.computeBoundingSphere();
      const me = new THREE.Mesh(g, mat);
      me.castShadow = castShadow;
      group.add(me);
    }
    return group;
  };
  return U;
})();
