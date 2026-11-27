import * as THREE from 'three';

function makeCanvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return [c, c.getContext('2d')];
}

function finalizeTexture(canvas, repeatX = 1, repeatY = 1, srgb = true) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createAssetTextures() {
  return {
    concrete: makeConcreteTexture(),
    steel: makeSteelTexture(),
    crate: makeCrateTexture(),
    neonGrid: makeNeonGridTexture(),
    rink: makeRinkTexture(),
    oceanBump: makeOceanBumpTexture(),
  };
}

function makeConcreteTexture() {
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = '#242b36';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4200; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const v = 26 + Math.floor(Math.random() * 26);
    ctx.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 254, 254);
  return finalizeTexture(c, 6, 4, true);
}

function makeSteelTexture() {
  const [c, ctx] = makeCanvas(256);
  const grad = ctx.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, '#475569');
  grad.addColorStop(0.5, '#64748b');
  grad.addColorStop(1, '#334155');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let y = 0; y < 256; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  // Rivets
  ctx.fillStyle = 'rgba(15,23,42,0.55)';
  for (const x of [16, 240]) {
    for (const y of [16, 128, 240]) {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return finalizeTexture(c, 1, 1, true);
}

function makeCrateTexture() {
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = '#7c4f2b';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#5c381c';
  for (let y = 16; y < 256; y += 32) {
    ctx.fillRect(0, y, 256, 4);
  }
  ctx.strokeStyle = '#9a683a';
  ctx.lineWidth = 18;
  ctx.strokeRect(9, 9, 238, 238);
  ctx.beginPath();
  ctx.moveTo(16, 16);
  ctx.lineTo(240, 240);
  ctx.moveTo(240, 16);
  ctx.lineTo(16, 240);
  ctx.stroke();
  return finalizeTexture(c, 1, 1, true);
}

function makeNeonGridTexture() {
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = '#060c18';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.16)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 256, 256);
  return finalizeTexture(c, 18, 12, true);
}

function makeRinkTexture() {
  const [c, ctx] = makeCanvas(512);
  ctx.fillStyle = '#dbeafe';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle air-table micro-holes
  ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
  for (let x = 16; x < 512; x += 24) {
    for (let y = 16; y < 512; y += 24) {
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Center line & circle
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, 256);
  ctx.lineTo(512, 256);
  ctx.stroke();

  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(256, 256, 72, 0, Math.PI * 2);
  ctx.stroke();
  return finalizeTexture(c, 1, 1, true);
}

function makeOceanBumpTexture() {
  const [c, ctx] = makeCanvas(256);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 10 + Math.random() * 26;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(220,220,220,0.32)');
    g.addColorStop(1, 'rgba(128,128,128,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return finalizeTexture(c, 4, 4, false);
}
