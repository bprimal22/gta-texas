'use client';

import { useEffect, useRef, useState } from 'react';
import Link from '@/web/link';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PERSONAL_CHARACTER_URL } from '../../lib/campus/character-asset';

export default function CharacterPage() {
  const host = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<{
    pose: (name: string) => void;
    view: (angle: string) => void;
  } | null>(null);
  const [status, setStatus] = useState('Loading your character…');
  useEffect(() => {
    if (!host.current) return;
    const element = host.current,
      scene = new THREE.Scene();
    scene.background = new THREE.Color('#d0d3d6');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    element.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.02, 100);
    camera.position.set(2.8, 1.25, 3.4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.95, 0);
    controls.enableDamping = true;
    controls.minDistance = 0.38;
    controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI * 0.88;
    scene.add(new THREE.HemisphereLight(0xf6f4f1, 0x6c777f, 2.0));
    const key = new THREE.DirectionalLight(0xfff5e8, 3.0);
    key.position.set(-3, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -2;
    key.shadow.camera.right = 2;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -1;
    key.shadow.normalBias = 0.005;
    key.shadow.bias = -0.0001;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xe8efff, 2);
    fill.position.set(3, 3, -4);
    scene.add(fill);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0xb4bac0, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.position.y = 0;
    scene.add(floor);
    let disposed = false,
      frame = 0,
      mixer: THREE.AnimationMixer | undefined;
    const owned = new Set<THREE.Object3D>();
    owned.add(floor);
    const resize = () => {
      const w = element.clientWidth,
        h = element.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    void new GLTFLoader()
      .loadAsync(PERSONAL_CHARACTER_URL)
      .then((gltf) => {
        if (disposed) {
          release(gltf.scene);
          return;
        }
        owned.add(gltf.scene);
        gltf.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        scene.add(gltf.scene);
        renderer.domElement.dataset.characterAsset = PERSONAL_CHARACTER_URL;
        mixer = new THREE.AnimationMixer(gltf.scene);
        const actions = Object.fromEntries(
          gltf.animations.map((c) => [c.name, mixer!.clipAction(c)]),
        );
        actions.Idle.play();
        controlsRef.current = {
          pose(name) {
            for (const action of Object.values(actions)) action.stop();
            actions[name]?.reset().play();
          },
          view(angle) {
            const close = angle === 'Face' || angle === 'Hair';
            controls.target.set(0, close ? 1.63 : 0.95, 0);
            if (angle === 'Hair') camera.position.set(0.7, 1.68, -0.8);
            else if (close) camera.position.set(0.18, 1.69, 1.0);
            else if (angle === 'Side') camera.position.set(4.1, 1.15, 0);
            else if (angle === 'Back') camera.position.set(0, 1.15, -4.1);
            else camera.position.set(0, 1.15, 4.1);
            controls.update();
          },
        };
        setStatus('Inspired by your reference');
      })
      .catch(() =>
        setStatus('The character could not load. Reload to try again.'),
      );
    function release(object: THREE.Object3D) {
      const materials = new Set<THREE.Material>(),
        textures = new Set<THREE.Texture>();
      object.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            materials.add(m);
        }
      });
      for (const m of materials) {
        for (const value of Object.values(m))
          if (value instanceof THREE.Texture) textures.add(value);
        m.dispose();
      }
      for (const t of textures) t.dispose();
    }
    let lastFrame = performance.now();
    const animate = () => {
      if (disposed) return;
      const now = performance.now();
      mixer?.update(Math.min((now - lastFrame) / 1000, 0.05));
      lastFrame = now;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controlsRef.current = null;
      mixer?.stopAllAction();
      controls.dispose();
      for (const o of owned) release(o);
      key.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  const buttonStyle = {
    padding: '10px 16px',
    border: '1px solid #b9bdc1',
    borderRadius: 8,
    background: '#ffffffdd',
    color: '#17202a',
    cursor: 'pointer',
  };
  return (
    <main
      style={{
        height: '100dvh',
        position: 'relative',
        color: '#17202a',
        fontFamily: 'system-ui',
      }}
    >
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div
        style={{
          position: 'absolute',
          top: 24,
          left: 24,
          right: 24,
          pointerEvents: 'none',
        }}
      >
        <Link href="/" style={{ pointerEvents: 'auto', color: '#17202a' }}>
          ← Explore UT Austin
        </Link>
        <h1 style={{ fontSize: 24, margin: '16px 0 6px' }}>Your character</h1>
        <p style={{ margin: 0 }}>{status}</p>
        <p style={{ maxWidth: 480, fontSize: 13, lineHeight: 1.5 }}>
          White Longhorn cap, dark hair, black jacket and backpack. Rotate the
          character to inspect it from every angle.
        </p>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: 24,
          right: 24,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {['Front', 'Side', 'Back', 'Face', 'Hair'].map((angle) => (
          <button
            key={angle}
            style={buttonStyle}
            onClick={() => controlsRef.current?.view(angle)}
          >
            {angle}
          </button>
        ))}
        {['Idle', 'Walk', 'Run'].map((name) => (
          <button
            key={name}
            style={buttonStyle}
            onClick={() => controlsRef.current?.pose(name)}
          >
            {name}
          </button>
        ))}
        <p style={{ width: '100%', fontSize: 13, margin: '4px 0 0' }}>
          Drag to rotate · Scroll to zoom · Right-drag to pan
        </p>
      </div>
    </main>
  );
}
