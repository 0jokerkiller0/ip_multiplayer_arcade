/**
 * Shared math and collision helpers for authoritative game simulations.
 */

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function distSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Resolves overlap between a circle (cx, cz, r) and an axis-aligned box
 * defined by { x, z, w, h } (center x/z, full width w, full height/depth h).
 * Returns { hit, nx, nz, x, z } with pushed-out coordinates.
 */
export function resolveCircleAABB(cx, cz, r, box) {
  const halfW = box.w * 0.5;
  const halfH = box.h * 0.5;
  const minX = box.x - halfW;
  const maxX = box.x + halfW;
  const minZ = box.z - halfH;
  const maxZ = box.z + halfH;

  const closestX = clamp(cx, minX, maxX);
  const closestZ = clamp(cz, minZ, maxZ);

  const dx = cx - closestX;
  const dz = cz - closestZ;
  const d2 = dx * dx + dz * dz;

  if (d2 >= r * r) {
    return { hit: false, nx: 0, nz: 0, x: cx, z: cz };
  }

  // Circle center is inside the box: push out along shallowest axis
  if (d2 === 0) {
    const leftPen = cx - minX;
    const rightPen = maxX - cx;
    const topPen = cz - minZ;
    const bottomPen = maxZ - cz;
    const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);
    if (minPen === leftPen) return { hit: true, nx: -1, nz: 0, x: minX - r, z: cz };
    if (minPen === rightPen) return { hit: true, nx: 1, nz: 0, x: maxX + r, z: cz };
    if (minPen === topPen) return { hit: true, nx: 0, nz: -1, x: cx, z: minZ - r };
    return { hit: true, nx: 0, nz: 1, x: cx, z: maxZ + r };
  }

  const d = Math.sqrt(d2);
  const nx = dx / d;
  const nz = dz / d;
  return {
    hit: true,
    nx,
    nz,
    x: closestX + nx * r,
    z: closestZ + nz * r,
  };
}

/**
 * Reflects a 2D velocity vector (vx, vz) across a unit normal (nx, nz).
 */
export function reflectVelocity(vx, vz, nx, nz) {
  const dot = vx * nx + vz * nz;
  if (dot >= 0) return { vx, vz };
  return {
    vx: vx - 2 * dot * nx,
    vz: vz - 2 * dot * nz,
  };
}

/**
 * Checks if 2D line segment AB intersects segment CD.
 * Uses orientation & bounding-box overlap checks.
 */
export function segmentsIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const minABx = Math.min(ax, bx);
  const maxABx = Math.max(ax, bx);
  const minCDx = Math.min(cx, dx);
  const maxCDx = Math.max(cx, dx);
  if (maxABx < minCDx - 1e-6 || maxCDx < minABx - 1e-6) return false;

  const minABz = Math.min(az, bz);
  const maxABz = Math.max(az, bz);
  const minCDz = Math.min(cz, dz);
  const maxCDz = Math.max(cz, dz);
  if (maxABz < minCDz - 1e-6 || maxCDz < minABz - 1e-6) return false;

  const cross = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = cross(cx, cz, dx, dz, ax, az);
  const d2 = cross(cx, cz, dx, dz, bx, bz);
  const d3 = cross(ax, az, bx, bz, cx, cz);
  const d4 = cross(ax, az, bx, bz, dx, dz);

  if (((d1 > 1e-7 && d2 < -1e-7) || (d1 < -1e-7 && d2 > 1e-7)) &&
      ((d3 > 1e-7 && d4 < -1e-7) || (d3 < -1e-7 && d4 > 1e-7))) {
    return true;
  }

  const onSeg = (px, pz, qx, qz, rx, rz) =>
    Math.abs(cross(px, pz, qx, qz, rx, rz)) <= 1e-6 &&
    rx >= Math.min(px, qx) - 1e-6 &&
    rx <= Math.max(px, qx) + 1e-6 &&
    rz >= Math.min(pz, qz) - 1e-6 &&
    rz <= Math.max(pz, qz) + 1e-6;

  return (
    onSeg(cx, cz, dx, dz, ax, az) ||
    onSeg(cx, cz, dx, dz, bx, bz) ||
    onSeg(ax, az, bx, bz, cx, cz) ||
    onSeg(ax, az, bx, bz, dx, dz)
  );
}

/**
 * Minimum distance from point P to segment AB.
 */
export function pointToSegmentDistSq(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const lenSq = vx * vx + vz * vz;
  if (lenSq <= 1e-9) return wx * wx + wz * wz;
  const t = clamp((wx * vx + wz * vz) / lenSq, 0, 1);
  const projX = ax + t * vx;
  const projZ = az + t * vz;
  return distSq(px, pz, projX, projZ);
}
