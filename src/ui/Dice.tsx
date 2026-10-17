import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TUMBLE, type Roll } from './playback';

/** How long the result stays on the table after landing. */
const LINGER = 1.6;

const FACE_COLOR = '#7a1d22';
const NUMBER_COLOR = '#f3d58a';

/** A 5 × 4 sheet with one triangle per face, each carrying its number, so the die can wear it. */
function numberSheet(): THREE.CanvasTexture {
  const size = 1024;
  const cell = size / 5;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = FACE_COLOR;
  g.fillRect(0, 0, size, size);
  for (let k = 0; k < 20; k++) {
    const [x, y] = [(k % 5) * cell, Math.floor(k / 5) * cell];
    const [a, b, c] = TRIANGLE.map(([u, v]) => [x + u * cell, y + v * cell] as const);
    g.beginPath();
    g.moveTo(...a!);
    g.lineTo(...b!);
    g.lineTo(...c!);
    g.closePath();
    g.fillStyle = FACE_COLOR;
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#b8863b';
    g.stroke();
    const n = String(k + 1);
    g.fillStyle = NUMBER_COLOR;
    g.font = `bold ${cell * 0.3}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const cx = x + cell * 0.5;
    const cy = y + cell * 0.6;
    g.fillText(n, cx, cy);
    // 6 and 9 look alike upside down, so real dice mark them.
    if (n === '6' || n === '9') g.fillRect(cx - cell * 0.07, cy + cell * 0.13, cell * 0.14, cell * 0.025);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Where each face's triangle sits in its cell: the top corner first, so the number stands upright toward it. */
const TRIANGLE: [number, number][] = [
  [0.5, 0.08],
  [0.06, 0.86],
  [0.94, 0.86],
];

interface D20 {
  geometry: THREE.BufferGeometry;
  /** For each face value (index 0 is face 1), the turn that shows it to the camera. */
  showing: THREE.Quaternion[];
}

function buildD20(): D20 {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const pos = geometry.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const showing: THREE.Quaternion[] = [];
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.3);
  for (let k = 0; k < 20; k++) {
    const [cx, cy] = [(k % 5) / 5, Math.floor(k / 5) / 5];
    const verts = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(pos, k * 3 + j));
    for (let j = 0; j < 3; j++) {
      const [u, v] = TRIANGLE[j]!;
      uv[(k * 3 + j) * 2] = cx + u / 5;
      uv[(k * 3 + j) * 2 + 1] = 1 - (cy + v / 5);
    }
    // The turn that brings this face to the front with its top corner up.
    const centre = verts[0]!.clone().add(verts[1]!).add(verts[2]!).divideScalar(3);
    const out = centre.clone().normalize();
    const up = verts[0]!.clone().sub(centre).normalize();
    const side = up.clone().cross(out);
    const basis = new THREE.Matrix4().makeBasis(side, up, out).transpose();
    showing.push(new THREE.Quaternion().setFromRotationMatrix(basis).premultiply(tilt));
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return { geometry, showing };
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** A drop with two small bounces. */
function bounce(t: number): number {
  if (t < 0.6) return 1 - (t / 0.6) ** 2;
  if (t < 0.85) return 0.18 * Math.sin(((t - 0.6) / 0.25) * Math.PI);
  return 0.05 * Math.sin(((t - 0.85) / 0.15) * Math.PI);
}

interface Table {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  d20: D20;
  material: THREE.MeshStandardMaterial;
  faded: THREE.MeshStandardMaterial;
  dice: THREE.Mesh[];
}

function setUpTable(canvas: HTMLCanvasElement): Table {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, canvas.clientWidth / canvas.clientHeight, 0.1, 50);
  camera.position.set(0, 0, 6.5);
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const key = new THREE.DirectionalLight(0xfff1d6, 2.2);
  key.position.set(-3, 4, 6);
  scene.add(key);
  const rim = new THREE.PointLight(0xffb347, 30, 20);
  rim.position.set(3, -2, 4);
  scene.add(rim);
  const map = numberSheet();
  const material = new THREE.MeshStandardMaterial({ map, flatShading: true, roughness: 0.35, metalness: 0.15 });
  const faded = material.clone();
  faded.transparent = true;
  faded.opacity = 0.35;
  return { renderer, scene, camera, d20: buildD20(), material, faded, dice: [] };
}

/**
 * The dice tray: whenever a d20 is rolled in the story, a die tumbles onto the table at the foot of
 * the story, where its line is about to appear, and lands on the engine's result. The rules engine has already rolled it; this only shows the roll.
 */
export default function DiceTray({ roll }: { roll: (Roll & { id: number }) | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const table = useRef<Table | null>(null);
  const [phase, setPhase] = useState<'hidden' | 'rolling' | 'landed'>('hidden');
  const [noWebGl, setNoWebGl] = useState(false);

  useEffect(() => {
    if (!canvas.current) return;
    try {
      table.current = setUpTable(canvas.current);
    } catch {
      setNoWebGl(true); // the result still shows, just without a 3D die
    }
    return () => {
      const t = table.current;
      if (!t) return;
      t.d20.geometry.dispose();
      t.material.map?.dispose();
      t.material.dispose();
      t.faded.dispose();
      t.renderer.dispose();
      table.current = null;
    };
  }, []);

  useEffect(() => {
    if (!roll) return;
    setPhase('rolling');
    tray.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const t = table.current;
    let frame = 0;
    const timers = [setTimeout(() => setPhase('landed'), TUMBLE * 1000), setTimeout(() => setPhase('hidden'), (TUMBLE + LINGER) * 1000)];
    if (t) {
      for (const d of t.dice) t.scene.remove(d);
      const n = roll.dice.length;
      t.dice = roll.dice.map((value, i) => {
        const mesh = new THREE.Mesh(t.d20.geometry, roll.kept !== undefined && n > 1 && value !== roll.kept ? t.faded : t.material);
        mesh.userData = {
          value,
          x: n === 1 ? 0 : (i - (n - 1) / 2) * 2.4,
          from: (Math.random() - 0.5) * 3,
          axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() * 0.4).normalize(),
          spin: Math.PI * (4 + Math.random() * 2),
        };
        t.scene.add(mesh);
        return mesh;
      });
      const start = performance.now();
      const turn = new THREE.Quaternion();
      const draw = (now: number) => {
        const p = Math.min(1, (now - start) / (TUMBLE * 1000));
        for (const d of t.dice) {
          const { value, x, from, axis, spin } = d.userData as { value: number; x: number; from: number; axis: THREE.Vector3; spin: number };
          turn.setFromAxisAngle(axis, spin * (1 - easeOut(p)));
          d.quaternion.copy(t.d20.showing[Math.min(20, Math.max(1, value)) - 1]!).premultiply(turn);
          d.position.set(from + (x - from) * easeOut(p), bounce(p) * 3, 0);
        }
        t.renderer.render(t.scene, t.camera);
        if (p < 1) frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
    }
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
    };
  }, [roll]);

  const kept = roll?.kept ?? roll?.dice[0];
  const natural = kept === 20 ? 'nat20' : kept === 1 ? 'nat1' : '';
  return (
    <div ref={tray} className={`dice-tray ${phase} ${roll?.outcome ?? ''} ${natural}`} aria-live="polite">
      <canvas ref={canvas} className={noWebGl ? 'gone' : undefined} />
      {noWebGl && phase !== 'hidden' && <div className="flat-die">{phase === 'landed' ? kept : '…'}</div>}
      {phase === 'landed' && roll && <div className="dice-caption">{roll.caption}</div>}
    </div>
  );
}
