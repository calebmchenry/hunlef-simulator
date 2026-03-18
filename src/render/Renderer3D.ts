/**
 * Three.js 3D renderer for the Corrupted Hunlef simulator.
 * Replaces the 2D Canvas Renderer while maintaining the same draw() interface.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinnedObject } from 'three/addons/utils/SkeletonUtils.js';
import type { GameSimulation } from '../engine/GameSimulation.ts';
import type { Projectile } from '../entities/Projectile.ts';
import type { AttackStyle, Position, WeaponType } from '../entities/types.ts';
import { loadModelFromJSON } from './ModelLoader.ts';
import type { OSRSModelJSON } from './ModelLoader.ts';
import { CameraController } from './CameraController.ts';
import { AnimationController } from './AnimationController.ts';
import { PlayerAnimationController } from './PlayerAnimationController.ts';
import { OVERHEAD_ICONS } from './assets.ts';

// Import model JSON data (fallback if GLTF fails to load)
import bossModelData from '../../docs/assets/models/model_38595.json';

const GRID_SIZE = 12;
const TILE_SIZE_PX = 48; // projectile coordinates are still in pixel space

// 3D world: 1 unit = 1 tile. Arena is 12x12, centered at origin.
const HALF_GRID = GRID_SIZE / 2; // 6

// Boss model scaling: OSRS model spans ~675 units in X, boss occupies 5 tiles (= 5 units in 3D).
const BOSS_MODEL_SCALE = 5 / 675;
const PLAYER_MODEL_SCALE = 1 / 200;
const TORNADO_MODEL_SCALE = 1 / 674; // tornado model is 674 OSRS units wide, target ~1 tile
const BOSS_MODEL_YAW_OFFSET = 0; // atan2(dx,dz) already faces +Z toward player
const PLAYER_MODEL_YAW_OFFSET = 0; // same correction for player model
const PLAYER_OVERHEAD_Y = 1.1;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Convert tile coordinate to 3D world position (center of tile) */
function tileToWorld(tileX: number, tileY: number): THREE.Vector3 {
  return new THREE.Vector3(
    tileX - HALF_GRID + 0.5,
    0,
    tileY - HALF_GRID + 0.5,
  );
}

/** Convert tile coordinate to 3D world for a multi-tile entity (center of footprint) */
function entityCenterToWorld(tileX: number, tileY: number, size: number): THREE.Vector3 {
  return new THREE.Vector3(
    tileX - HALF_GRID + size / 2,
    0,
    tileY - HALF_GRID + size / 2,
  );
}

interface PlayerGLTFAsset {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

interface MorphTrackBinding {
  target: string;
  suffix: string;
  morphIndex: number | null;
}

interface MorphRetargetCandidate {
  group: THREE.Group;
  children: THREE.Mesh[];
}

const MORPH_RETARGET_MARKER = '__cgMorphRetargeted';

function parseMorphTrackBinding(trackName: string): MorphTrackBinding | null {
  const indexedMatch = trackName.match(/^(.+)(\.morphTargetInfluences\[(\d+)\])$/);
  if (indexedMatch) {
    return {
      target: indexedMatch[1],
      suffix: indexedMatch[2],
      morphIndex: Number(indexedMatch[3]),
    };
  }

  const fullMatch = trackName.match(/^(.+)(\.morphTargetInfluences)$/);
  if (fullMatch) {
    return {
      target: fullMatch[1],
      suffix: fullMatch[2],
      morphIndex: null,
    };
  }

  return null;
}

function reserveUniqueName(existingNames: Set<string>, base: string): string {
  if (!existingNames.has(base)) {
    existingNames.add(base);
    return base;
  }

  let suffix = 1;
  let candidate = `${base}_${suffix}`;
  while (existingNames.has(candidate)) {
    suffix++;
    candidate = `${base}_${suffix}`;
  }
  existingNames.add(candidate);
  return candidate;
}

function collectMorphRetargetCandidates(root: THREE.Object3D): MorphRetargetCandidate[] {
  const existingNames = new Set<string>();
  root.traverse((object) => {
    if (object.name) {
      existingNames.add(object.name);
    }
  });

  const candidates: MorphRetargetCandidate[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Group)) return;

    const morphChildren = object.children.filter((child): child is THREE.Mesh => {
      const mesh = child as THREE.Mesh;
      return mesh.isMesh === true && Array.isArray(mesh.morphTargetInfluences);
    });
    if (morphChildren.length === 0) return;

    for (let i = 0; i < morphChildren.length; i++) {
      const child = morphChildren[i];
      if (!child.name) {
        child.name = reserveUniqueName(existingNames, `Mesh_${i}`);
      }
    }

    candidates.push({ group: object, children: morphChildren });
  });

  return candidates;
}

function retargetMorphAnimations(root: THREE.Object3D, clips: THREE.AnimationClip[]): void {
  if (clips.length === 0) {
    console.log('[Renderer3D] retargetMorphAnimations: no animation clips to retarget');
    return;
  }

  const candidates = collectMorphRetargetCandidates(root);
  if (candidates.length === 0) {
    console.log('[Renderer3D] retargetMorphAnimations: no multi-primitive morph target groups found');
    return;
  }

  const candidateLookup = new Map<string, MorphRetargetCandidate>();
  const childTargetKeys = new Set<string>();
  const candidateSummary = candidates.map((candidate) => {
    const groupLabel = candidate.group.name || candidate.group.uuid;
    const childSummary = candidate.children.map((child) => {
      const childLabel = child.name || child.uuid;
      const morphCount = child.morphTargetInfluences?.length ?? 0;
      childTargetKeys.add(childLabel);
      childTargetKeys.add(child.uuid);
      return `${childLabel}(${morphCount})`;
    });

    if (candidate.group.name) {
      candidateLookup.set(candidate.group.name, candidate);
    }
    candidateLookup.set(candidate.group.uuid, candidate);

    return `${groupLabel} -> [${childSummary.join(', ')}]`;
  });

  console.log(`[Renderer3D] retargetMorphAnimations: found ${candidates.length} candidate group(s)`);
  for (const summary of candidateSummary) {
    console.log(`[Renderer3D] retargetMorphAnimations: candidate ${summary}`);
  }

  for (const clip of clips) {
    const clipUserData = clip.userData as Record<string, unknown>;
    if (clipUserData[MORPH_RETARGET_MARKER] === true) {
      console.log(`[Renderer3D] retargetMorphAnimations: clip "${clip.name}" already retargeted`);
      continue;
    }

    const hasMorphTracks = clip.tracks.some((track) => parseMorphTrackBinding(track.name) !== null);
    if (!hasMorphTracks) continue;

    const hasGroupTargets = clip.tracks.some((track) => {
      const binding = parseMorphTrackBinding(track.name);
      return binding !== null && candidateLookup.has(binding.target);
    });

    const hasChildTargets = clip.tracks.some((track) => {
      const binding = parseMorphTrackBinding(track.name);
      return binding !== null && childTargetKeys.has(binding.target);
    });

    if (!hasGroupTargets && hasChildTargets) {
      clipUserData[MORPH_RETARGET_MARKER] = true;
      console.log(`[Renderer3D] retargetMorphAnimations: clip "${clip.name}" already targets child meshes`);
      continue;
    }

    if (!hasGroupTargets) {
      console.log(`[Renderer3D] retargetMorphAnimations: clip "${clip.name}" has no group-targeted morph tracks`);
      continue;
    }

    const nextTracks: THREE.KeyframeTrack[] = [];
    let retargetedTracks = 0;
    let generatedTracks = 0;

    for (const track of clip.tracks) {
      const binding = parseMorphTrackBinding(track.name);
      if (!binding) {
        nextTracks.push(track);
        continue;
      }

      const candidate = candidateLookup.get(binding.target);
      if (!candidate) {
        nextTracks.push(track);
        continue;
      }

      const requiredMorphCount = binding.morphIndex !== null
        ? binding.morphIndex + 1
        : track.getValueSize();
      let generatedForTrack = 0;

      for (const child of candidate.children) {
        const childMorphCount = child.morphTargetInfluences?.length ?? 0;
        const childLabel = child.name || child.uuid;

        if (childMorphCount < requiredMorphCount) {
          console.warn(
            `[Renderer3D] retargetMorphAnimations: skipping child "${childLabel}" ` +
            `for track "${track.name}" (needs ${requiredMorphCount} morph targets, has ${childMorphCount})`,
          );
          continue;
        }

        const clonedTrack = track.clone();
        clonedTrack.name = `${child.name}${binding.suffix}`;
        nextTracks.push(clonedTrack);
        generatedForTrack++;
        generatedTracks++;
      }

      if (generatedForTrack > 0) {
        retargetedTracks++;
      } else {
        // If no valid child could accept the track, keep the original to avoid dropping data.
        nextTracks.push(track);
      }
    }

    if (retargetedTracks > 0) {
      clip.tracks = nextTracks;
      clip.resetDuration();
      clipUserData[MORPH_RETARGET_MARKER] = true;
    }

    console.log(
      `[Renderer3D] retargetMorphAnimations: clip "${clip.name}" retargeted ${retargetedTracks} ` +
      `track(s), generated ${generatedTracks} child track(s)`,
    );
  }
}

export class Renderer3D {
  private webglRenderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private cameraController: CameraController;
  private raycaster = new THREE.Raycaster();
  private raycastMouse = new THREE.Vector2();
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private raycastHit = new THREE.Vector3();

  // Boss model (either GLTF or JSON fallback)
  private bossGroup: THREE.Group;
  private bossStyleIndicator: THREE.Mesh;
  private animController: AnimationController | null = null;

  // Player model (GLTF assembly or fallback box)
  private playerGroup: THREE.Group;
  private playerFallbackMesh: THREE.Mesh;
  private playerAnimController: PlayerAnimationController | null = null;
  private playerBodyVariants: Map<WeaponType, PlayerGLTFAsset> = new Map();
  private playerWeaponModels: Map<WeaponType, THREE.Object3D> = new Map();
  private playerHelmModel: THREE.Object3D | null = null;
  private playerLegsModel: THREE.Object3D | null = null;
  private currentPlayerWeapon: WeaponType | null = null;
  private playerAssetsLoaded: boolean = false;
  private playerAssetsFailed: boolean = false;
  private playerModelDirty: boolean = true;
  private targetTileIndicator: THREE.Mesh;
  private playerTrueTile: THREE.Group;
  private bossTrueTile: THREE.Group;
  private tornadoTrueTilePool: THREE.Group[] = [];
  private activeTornadoTrueTiles: THREE.Group[] = [];

  // Overhead sprites
  private playerOverheadSprite: THREE.Sprite;
  private bossOverheadSprite: THREE.Sprite;
  private overheadTextures: Map<string, THREE.Texture> = new Map();

  // Projectile meshes (pool)
  private projectileMeshes: Map<Projectile, THREE.Mesh> = new Map();

  // Hit splat sprites
  private hitSplatSprites: Map<object, THREE.Sprite> = new Map();

  // Floor tile overlays (only for non-safe tiles)
  private tileOverlays: Map<string, THREE.Mesh> = new Map();
  private tileOverlayMaterials = {
    warning: new THREE.MeshBasicMaterial({
      color: 0xdc143c, // crimson
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    hazard: new THREE.MeshBasicMaterial({
      color: 0xff4500, // orange-red
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
      // Emissive not available on MeshBasicMaterial; opacity handles visibility
    }),
  };
  private tileOverlayGeometry = new THREE.PlaneGeometry(1, 1);

  // Tornado meshes
  private tornadoTemplate: THREE.Object3D | null = null;
  private tornadoMeshPool: THREE.Object3D[] = [];
  private activeTornadoMeshes: THREE.Object3D[] = [];

  // Countdown / fight overlay (DOM-based)
  private fightTextTick: number = 0;
  private countdownEl: HTMLDivElement;
  private fightEl: HTMLDivElement;

  // Timing
  private lastFrameTime: number = 0;

  // Track boss state for animation triggers
  private lastBossStyle: AttackStyle | null = null;
  private lastBossAttackTick: number = -1;
  private lastPlayerAttackTick: number = -1;
  private lastPlayerEatTick: number = -1;

  // The canvas element (for InputManager compatibility)
  readonly canvas: HTMLCanvasElement;

  constructor(container: HTMLElement) {
    // Set up Three.js renderer
    this.webglRenderer = new THREE.WebGLRenderer({ antialias: true });
    this.webglRenderer.setSize(GRID_SIZE * TILE_SIZE_PX, GRID_SIZE * TILE_SIZE_PX);
    this.webglRenderer.setPixelRatio(window.devicePixelRatio);
    this.webglRenderer.setClearColor(0x0d0507);
    this.canvas = this.webglRenderer.domElement;
    this.canvas.style.border = '2px solid #4a2020';
    this.canvas.style.cursor = 'pointer';
    this.canvas.style.display = 'block';

    // Replace existing canvas in container
    const oldCanvas = container.querySelector('canvas');
    if (oldCanvas) {
      container.replaceChild(this.canvas, oldCanvas);
    } else {
      container.appendChild(this.canvas);
    }

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    const aspect = 1; // square canvas
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    this.cameraController = new CameraController(this.camera, this.canvas);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 5);
    this.scene.add(dirLight);

    // Floor
    this.createFloor();

    // Boss group (will contain either GLTF or JSON mesh)
    this.bossGroup = new THREE.Group();
    this.scene.add(this.bossGroup);

    // Style indicator ring around boss feet
    const ringGeo = new THREE.RingGeometry(1.8, 2.1, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xaa44cc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
    });
    this.bossStyleIndicator = new THREE.Mesh(ringGeo, ringMat);
    this.bossStyleIndicator.rotation.x = -Math.PI / 2;
    this.bossStyleIndicator.position.y = 0.035;
    this.bossStyleIndicator.renderOrder = 4;
    this.scene.add(this.bossStyleIndicator);

    // Load boss model: try GLTF first, fall back to JSON
    this.loadBossGLTF();

    // Load tornado GLTF
    this.loadTornadoGLTF();

    // Player group: start with the old cyan box fallback until GLTFs load.
    this.playerGroup = new THREE.Group();
    this.scene.add(this.playerGroup);

    this.playerFallbackMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 1.2, 0.6),
      new THREE.MeshLambertMaterial({ color: 0x44cccc }),
    );
    this.playerFallbackMesh.position.y = 0.6;
    this.playerGroup.add(this.playerFallbackMesh);

    void this.loadPlayerGLTFs();

    // Target tile indicator (flat ring on ground)
    const targetGeo = new THREE.RingGeometry(0.3, 0.48, 4);
    const targetMat = new THREE.MeshBasicMaterial({
      color: 0x88ffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    this.targetTileIndicator = new THREE.Mesh(targetGeo, targetMat);
    this.targetTileIndicator.rotation.x = -Math.PI / 2;
    this.targetTileIndicator.position.y = 0.025;
    this.targetTileIndicator.renderOrder = 2;
    this.targetTileIndicator.visible = false;
    this.scene.add(this.targetTileIndicator);

    // Player true tile - yellow 1x1 outline
    this.playerTrueTile = this.createTileOutline(1, 1, 0xffff00);
    this.playerTrueTile.visible = false;
    this.scene.add(this.playerTrueTile);

    // Boss true tile - blue 5x5 outline
    this.bossTrueTile = this.createTileOutline(5, 5, 0x4488ff);
    this.bossTrueTile.visible = false;
    this.scene.add(this.bossTrueTile);

    // Overhead sprites
    this.playerOverheadSprite = this.createOverheadSprite();
    this.scene.add(this.playerOverheadSprite);

    this.bossOverheadSprite = this.createOverheadSprite();
    this.scene.add(this.bossOverheadSprite);

    // Preload overhead textures
    const textureLoader = new THREE.TextureLoader();
    for (const [key, url] of Object.entries(OVERHEAD_ICONS)) {
      const tex = textureLoader.load(url);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      this.overheadTextures.set(key, tex);
    }

    // DOM overlays for countdown/fight text
    this.countdownEl = document.createElement('div');
    this.countdownEl.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      display: flex; justify-content: center; align-items: center;
      background: rgba(0,0,0,0.4); pointer-events: none; z-index: 5;
      font: bold 72px monospace; color: #ffcc00;
    `;
    this.countdownEl.style.display = 'none';
    container.appendChild(this.countdownEl);

    this.fightEl = document.createElement('div');
    this.fightEl.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      display: flex; justify-content: center; align-items: center;
      pointer-events: none; z-index: 5;
      font: bold 64px monospace; color: #ff4400;
    `;
    this.fightEl.style.display = 'none';
    container.appendChild(this.fightEl);

    this.lastFrameTime = performance.now();
  }

  private createFloor(): void {
    const floorGeo = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE);
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x2d1216 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    this.scene.add(floor);

    // Grid lines
    const gridMat = new THREE.LineBasicMaterial({ color: 0x5c2a2e });
    const gridPoints: THREE.Vector3[] = [];

    for (let i = 0; i <= GRID_SIZE; i++) {
      const pos = i - HALF_GRID;
      gridPoints.push(new THREE.Vector3(pos, 0, -HALF_GRID));
      gridPoints.push(new THREE.Vector3(pos, 0, HALF_GRID));
      gridPoints.push(new THREE.Vector3(-HALF_GRID, 0, pos));
      gridPoints.push(new THREE.Vector3(HALF_GRID, 0, pos));
    }

    const gridGeo = new THREE.BufferGeometry().setFromPoints(gridPoints);
    const gridLines = new THREE.LineSegments(gridGeo, gridMat);
    gridLines.position.y = 0.01;
    this.scene.add(gridLines);
  }

  private createTileOutline(
    width: number,
    height: number,
    color: number,
    lineWidth: number = 0.06,
  ): THREE.Group {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const group = new THREE.Group();
    group.position.y = 0.03;
    group.renderOrder = 3;

    const horizontalGeo = new THREE.PlaneGeometry(width, lineWidth);
    const verticalGeo = new THREE.PlaneGeometry(lineWidth, height);

    const top = new THREE.Mesh(horizontalGeo, mat);
    top.rotation.x = -Math.PI / 2;
    top.position.set(0, 0, -height / 2 + lineWidth / 2);
    top.renderOrder = 3;
    group.add(top);

    const bottom = new THREE.Mesh(horizontalGeo, mat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(0, 0, height / 2 - lineWidth / 2);
    bottom.renderOrder = 3;
    group.add(bottom);

    const left = new THREE.Mesh(verticalGeo, mat);
    left.rotation.x = -Math.PI / 2;
    left.position.set(-width / 2 + lineWidth / 2, 0, 0);
    left.renderOrder = 3;
    group.add(left);

    const right = new THREE.Mesh(verticalGeo, mat);
    right.rotation.x = -Math.PI / 2;
    right.position.set(width / 2 - lineWidth / 2, 0, 0);
    right.renderOrder = 3;
    group.add(right);

    return group;
  }

  private setTileOutlineOpacity(group: THREE.Group, opacity: number): void {
    group.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = opacity;
    });
  }

  private disposeTileOutline(group: THREE.Group): void {
    const disposedGeometries = new Set<THREE.BufferGeometry>();
    const disposedMaterials = new Set<THREE.Material>();

    group.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;

      const geometry = mesh.geometry as THREE.BufferGeometry;
      if (!disposedGeometries.has(geometry)) {
        geometry.dispose();
        disposedGeometries.add(geometry);
      }

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!disposedMaterials.has(material)) {
          material.dispose();
          disposedMaterials.add(material);
        }
      }
    });
  }

  private applyUnlitMaterials(root: THREE.Object3D, logMorphTargets: boolean = false): void {
    root.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;

      const mesh = child as THREE.Mesh;
      const geom = mesh.geometry as THREE.BufferGeometry;
      const hasColors = !!geom.getAttribute('color');
      const morphCount = geom.morphAttributes.position?.length ?? 0;
      if (logMorphTargets && morphCount > 0) {
        console.log(`[Renderer3D] GLTF morph targets: ${morphCount}`);
      }

      const usesMaterialArray = Array.isArray(mesh.material);
      const oldMaterials = (usesMaterialArray ? mesh.material : [mesh.material]) as THREE.Material[];
      const nextMaterials = oldMaterials.map((material: THREE.Material) => {
        const oldMat = material as THREE.MeshStandardMaterial;
        const hasMap = !!oldMat.map;
        return new THREE.MeshBasicMaterial({
          vertexColors: hasColors,
          map: hasMap ? oldMat.map : null,
          transparent: oldMat.transparent || false,
          opacity: oldMat.opacity ?? 1,
          side: THREE.DoubleSide,
        });
      });

      mesh.material = usesMaterialArray ? nextMaterials : nextMaterials[0];
    });
  }

  /** Try to load the animated GLTF model; fall back to static JSON if it fails */
  private loadBossGLTF(): void {
    const loader = new GLTFLoader();
    loader.load(
      '/models/corrupted_hunlef.gltf',
      (gltf) => {
        // GLTF loaded successfully
        const model = gltf.scene;
        model.scale.set(BOSS_MODEL_SCALE, BOSS_MODEL_SCALE, BOSS_MODEL_SCALE);
        retargetMorphAnimations(model, gltf.animations);
        this.applyUnlitMaterials(gltf.scene, true);

        this.bossGroup.add(model);

        // Set up animations if available
        if (gltf.animations.length > 0) {
          this.animController = new AnimationController(model, gltf.animations);
        }

        console.log(`[Renderer3D] GLTF boss loaded with ${gltf.animations.length} animations`);
      },
      undefined,
      (_error) => {
        // GLTF failed, fall back to static JSON model
        console.warn('[Renderer3D] GLTF load failed, using static JSON model');
        this.loadBossJSON();
      },
    );
  }

  /** Fallback: load boss from JSON model data with vertex colors */
  private loadBossJSON(): void {
    const data = bossModelData as unknown as OSRSModelJSON;
    const { geometry } = loadModelFromJSON(data);

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(BOSS_MODEL_SCALE, BOSS_MODEL_SCALE, BOSS_MODEL_SCALE);
    this.bossGroup.add(mesh);
  }

  /** Load tornado GLTF model */
  private loadTornadoGLTF(): void {
    const loader = new GLTFLoader();
    loader.load(
      '/models/tornado.gltf',
      (gltf) => {
        this.applyUnlitMaterials(gltf.scene);
        // Harden texture filters for the tiny 40x4 tornado texture
        gltf.scene.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) {
            const mat = mesh.material as THREE.MeshBasicMaterial;
            if (mat.map) {
              mat.map.magFilter = THREE.NearestFilter;
              mat.map.minFilter = THREE.NearestFilter;
              mat.map.generateMipmaps = false;
              mat.map.needsUpdate = true;
            }
          }
        });
        this.tornadoTemplate = gltf.scene;
        this.tornadoTemplate.scale.set(TORNADO_MODEL_SCALE, TORNADO_MODEL_SCALE, TORNADO_MODEL_SCALE);
        console.log('[Renderer3D] Tornado GLTF loaded');
      },
      undefined,
      (_error) => {
        // Fallback: use a cone as tornado placeholder
        console.warn('[Renderer3D] Tornado GLTF load failed, using cone placeholder');
        const geo = new THREE.ConeGeometry(0.3, 1.2, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0xccddff });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.scale.set(0.7, 0.7, 0.7);
        const group = new THREE.Group();
        group.add(mesh);
        this.tornadoTemplate = group;
      },
    );
  }

  private async loadPlayerGLTFs(): Promise<void> {
    const loader = new GLTFLoader();

    try {
      const [
        bodyBow,
        bodyStaff,
        bodyHalberd,
        helm,
        legs,
        bow,
        staff,
        halberd,
      ] = await Promise.all([
        loader.loadAsync('/models/player_body_bow.gltf'),
        loader.loadAsync('/models/player_body_staff.gltf'),
        loader.loadAsync('/models/player_body_halberd.gltf'),
        loader.loadAsync('/models/player_helm.gltf'),
        loader.loadAsync('/models/player_legs.gltf'),
        loader.loadAsync('/models/player_bow.gltf'),
        loader.loadAsync('/models/player_staff.gltf'),
        loader.loadAsync('/models/player_halberd.gltf'),
      ]);

      retargetMorphAnimations(bodyBow.scene, bodyBow.animations);
      retargetMorphAnimations(bodyStaff.scene, bodyStaff.animations);
      retargetMorphAnimations(bodyHalberd.scene, bodyHalberd.animations);

      this.applyUnlitMaterials(bodyBow.scene);
      this.applyUnlitMaterials(bodyStaff.scene);
      this.applyUnlitMaterials(bodyHalberd.scene);
      this.applyUnlitMaterials(helm.scene);
      this.applyUnlitMaterials(legs.scene);
      this.applyUnlitMaterials(bow.scene);
      this.applyUnlitMaterials(staff.scene);
      this.applyUnlitMaterials(halberd.scene);

      this.playerBodyVariants.set('bow', { scene: bodyBow.scene, animations: bodyBow.animations });
      this.playerBodyVariants.set('staff', { scene: bodyStaff.scene, animations: bodyStaff.animations });
      this.playerBodyVariants.set('halberd', { scene: bodyHalberd.scene, animations: bodyHalberd.animations });

      this.playerHelmModel = helm.scene;
      this.playerLegsModel = legs.scene;
      this.playerWeaponModels.set('bow', bow.scene);
      this.playerWeaponModels.set('staff', staff.scene);
      this.playerWeaponModels.set('halberd', halberd.scene);

      this.playerAssetsLoaded = true;
      this.playerAssetsFailed = false;
      this.playerModelDirty = true;

      if (this.currentPlayerWeapon) {
        this.setPlayerModel(this.currentPlayerWeapon);
      }

      console.log('[Renderer3D] Player GLTFs loaded');
    } catch (error) {
      this.playerAssetsLoaded = false;
      this.playerAssetsFailed = true;
      this.playerModelDirty = true;
      console.warn('[Renderer3D] Player GLTF load failed, using cyan box fallback', error);

      if (!this.currentPlayerWeapon) {
        this.showPlayerFallback();
      }
    }
  }

  private scalePlayerPart(part: THREE.Object3D): THREE.Object3D {
    part.scale.set(PLAYER_MODEL_SCALE, PLAYER_MODEL_SCALE, PLAYER_MODEL_SCALE);
    return part;
  }

  private clearPlayerGroup(): void {
    this.playerAnimController?.dispose();
    this.playerAnimController = null;
    this.playerGroup.clear();
  }

  private showPlayerFallback(): void {
    this.clearPlayerGroup();
    this.playerGroup.add(this.playerFallbackMesh);
  }

  private setPlayerModel(weaponType: WeaponType): void {
    this.currentPlayerWeapon = weaponType;
    this.playerModelDirty = false;

    if (!this.playerAssetsLoaded || this.playerAssetsFailed) {
      this.showPlayerFallback();
      return;
    }

    const bodyAsset = this.playerBodyVariants.get(weaponType);
    const weaponModel = this.playerWeaponModels.get(weaponType);
    if (!bodyAsset || !weaponModel || !this.playerHelmModel || !this.playerLegsModel) {
      console.warn(`[Renderer3D] Missing player GLTF asset(s) for ${weaponType}, using cyan box fallback`);
      this.showPlayerFallback();
      return;
    }

    const body = this.scalePlayerPart(cloneSkinnedObject(bodyAsset.scene));
    const helm = this.scalePlayerPart(this.playerHelmModel.clone(true));
    const legs = this.scalePlayerPart(this.playerLegsModel.clone(true));
    const weapon = this.scalePlayerPart(weaponModel.clone(true));

    this.clearPlayerGroup();
    this.playerGroup.add(body);
    this.playerGroup.add(helm);
    this.playerGroup.add(legs);
    this.playerGroup.add(weapon);
    this.playerAnimController = new PlayerAnimationController(body, bodyAsset.animations);
  }

  private createOverheadSprite(): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.8, 0.8, 1);
    sprite.visible = false;
    return sprite;
  }

  /**
   * Convert a click position (client coordinates) into arena tile coordinates.
   * Returns null when the click does not intersect the y=0 floor plane
   * or lands outside the 12x12 arena bounds.
   */
  screenToTile(clientX: number, clientY: number): Position | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    this.raycastMouse.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.raycastMouse, this.camera);

    const hit = this.raycaster.ray.intersectPlane(this.floorPlane, this.raycastHit);
    if (!hit) {
      return null;
    }

    const tileX = Math.floor(hit.x + HALF_GRID);
    const tileY = Math.floor(hit.z + HALF_GRID);

    if (tileX < 0 || tileX >= GRID_SIZE || tileY < 0 || tileY >= GRID_SIZE) {
      return null;
    }

    return { x: tileX, y: tileY };
  }

  draw(sim: GameSimulation, tickProgress: number = 0): void {
    const now = performance.now();
    const dt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    // Update animation mixer
    if (this.animController) {
      this.animController.update(dt);
      this.updateBossAnimations(sim);

    }

    // Update entities
    this.updateBoss(sim, tickProgress);
    const playerWorld = this.updatePlayer(sim, tickProgress);
    this.updatePlayerAnimations(sim);
    this.playerAnimController?.update(dt);
    if (sim.state === 'countdown') {
      this.cameraController.snapTarget(0, 0, 0);
    } else {
      this.cameraController.setTarget(playerWorld.x, 0, playerWorld.z);
    }
    this.cameraController.update(dt);
    this.updateTargetTile(sim);
    this.updateOverheads(sim);
    this.updateProjectiles(sim, tickProgress);
    this.updateHitSplats(sim);
    this.updateFloorTiles(sim);
    this.updateTrueTiles(sim);
    this.updateTornadoes(sim, tickProgress, dt);
    this.updateOverlays(sim);

    // Render
    this.webglRenderer.render(this.scene, this.camera);
  }

  private updateBossAnimations(sim: GameSimulation): void {
    if (!this.animController) return;

    // Death
    if (sim.state === 'won') {
      if (this.animController.state !== 'death') {
        this.animController.playDeath();
      }
      return;
    }

    // Attack animation trigger (only on ticks where a boss projectile was fired)
    if (sim.tick !== this.lastBossAttackTick) {
      const attackStyle = this.getBossAttackStyleThisTick(sim);
      if (attackStyle) {
        this.lastBossAttackTick = sim.tick;
        this.animController.playAttack(attackStyle);
      }
    }

    // Style switch detection
    const currentStyle = sim.boss.currentStyle;
    if (this.lastBossStyle !== null && currentStyle !== this.lastBossStyle) {
      if (currentStyle === 'magic' || currentStyle === 'ranged') {
        this.animController.playStyleSwitch(currentStyle);
      }
    }
    this.lastBossStyle = currentStyle;
  }

  private getBossAttackStyleThisTick(sim: GameSimulation): AttackStyle | null {
    for (let i = sim.projectiles.length - 1; i >= 0; i--) {
      const proj = sim.projectiles[i];
      if (proj.source !== 'boss') continue;
      if (proj.fireTick !== sim.tick) continue;
      if (proj.style === 'magic' || proj.style === 'ranged') {
        return proj.style;
      }
    }
    return null;
  }

  private updateBoss(sim: GameSimulation, tickProgress: number = 0): void {
    const boss = sim.boss;
    const worldPos = entityCenterToWorld(boss.pos.x, boss.pos.y, boss.size);

    this.bossGroup.position.set(worldPos.x, 0, worldPos.z);

    // Bug 2 fix: Rotate boss to face the player (Y-axis only)
    const player = sim.player;
    const playerX = lerp(
      tileToWorld(player.prevPos.x, player.prevPos.y).x,
      tileToWorld(player.pos.x, player.pos.y).x,
      tickProgress,
    );
    const playerZ = lerp(
      tileToWorld(player.prevPos.x, player.prevPos.y).z,
      tileToWorld(player.pos.x, player.pos.y).z,
      tickProgress,
    );
    const dx = playerX - this.bossGroup.position.x;
    const dz = playerZ - this.bossGroup.position.z;
    // Only rotate if player is not directly on top of boss (avoid jitter)
    if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) {
      this.bossGroup.rotation.y = Math.atan2(dx, dz) + BOSS_MODEL_YAW_OFFSET;
    }

    this.bossStyleIndicator.position.set(worldPos.x, 0.035, worldPos.z);
    const color = boss.currentStyle === 'ranged' ? 0x44cc44 : 0xaa44cc;
    (this.bossStyleIndicator.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  private updatePlayer(sim: GameSimulation, tickProgress: number): { x: number; z: number } {
    const player = sim.player;
    const weaponType = player.loadout.weapon.type;
    if (weaponType !== this.currentPlayerWeapon || this.playerModelDirty) {
      this.setPlayerModel(weaponType);
    }

    const prevWorld = tileToWorld(player.prevPos.x, player.prevPos.y);
    const currWorld = tileToWorld(player.pos.x, player.pos.y);
    const worldX = lerp(prevWorld.x, currWorld.x, tickProgress);
    const worldZ = lerp(prevWorld.z, currWorld.z, tickProgress);

    this.playerGroup.position.set(worldX, 0, worldZ);

    const dx = this.bossGroup.position.x - worldX;
    const dz = this.bossGroup.position.z - worldZ;
    if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) {
      this.playerGroup.rotation.y = Math.atan2(dx, dz) + PLAYER_MODEL_YAW_OFFSET;
    }

    return { x: worldX, z: worldZ };
  }

  private updatePlayerAnimations(sim: GameSimulation): void {
    if (!this.playerAnimController) return;

    if (sim.playerAteThisTick && sim.tick !== this.lastPlayerEatTick) {
      this.lastPlayerEatTick = sim.tick;
      this.playerAnimController.playEat();
      return;
    }

    if (sim.tick !== this.lastPlayerAttackTick && this.didPlayerAttackThisTick(sim)) {
      this.lastPlayerAttackTick = sim.tick;
      this.playerAnimController.playAttack();
    }
  }

  private didPlayerAttackThisTick(sim: GameSimulation): boolean {
    for (let i = sim.projectiles.length - 1; i >= 0; i--) {
      const proj = sim.projectiles[i];
      if (proj.source !== 'player') continue;
      if (proj.fireTick !== sim.tick) continue;
      return true;
    }
    return false;
  }

  private updateTargetTile(sim: GameSimulation): void {
    const target = sim.player.targetTile;
    if (target) {
      const wp = tileToWorld(target.x, target.y);
      this.targetTileIndicator.position.set(wp.x, 0.025, wp.z);
      this.targetTileIndicator.visible = true;
    } else {
      this.targetTileIndicator.visible = false;
    }
  }

  private updateTrueTiles(sim: GameSimulation): void {
    const isActive = sim.state === 'running' || sim.state === 'won' || sim.state === 'lost';

    if (isActive) {
      const playerWorld = tileToWorld(sim.player.pos.x, sim.player.pos.y);
      this.playerTrueTile.position.set(playerWorld.x, 0.03, playerWorld.z);
      this.playerTrueTile.visible = true;
    } else {
      this.playerTrueTile.visible = false;
    }

    if (isActive && sim.state !== 'won') {
      const bossWorld = entityCenterToWorld(sim.boss.pos.x, sim.boss.pos.y, sim.boss.size);
      this.bossTrueTile.position.set(bossWorld.x, 0.03, bossWorld.z);
      this.bossTrueTile.visible = true;
    } else {
      this.bossTrueTile.visible = false;
    }

    const occupiedTiles = new Map<string, { x: number; y: number; count: number }>();
    if (isActive) {
      for (const tornado of sim.tornadoes) {
        const key = `${tornado.pos.x},${tornado.pos.y}`;
        const existing = occupiedTiles.get(key);
        if (existing) {
          existing.count++;
        } else {
          occupiedTiles.set(key, {
            x: tornado.pos.x,
            y: tornado.pos.y,
            count: 1,
          });
        }
      }
    }

    const uniqueTiles = Array.from(occupiedTiles.values());

    while (this.activeTornadoTrueTiles.length > uniqueTiles.length) {
      const trueTile = this.activeTornadoTrueTiles.pop()!;
      trueTile.visible = false;
      this.scene.remove(trueTile);
      this.tornadoTrueTilePool.push(trueTile);
    }

    for (let i = 0; i < uniqueTiles.length; i++) {
      let trueTile: THREE.Group;
      if (i < this.activeTornadoTrueTiles.length) {
        trueTile = this.activeTornadoTrueTiles[i];
      } else {
        if (this.tornadoTrueTilePool.length > 0) {
          trueTile = this.tornadoTrueTilePool.pop()!;
        } else {
          trueTile = this.createTileOutline(1, 1, 0xffffff);
        }
        this.scene.add(trueTile);
        this.activeTornadoTrueTiles.push(trueTile);
      }

      const tile = uniqueTiles[i];
      const tileWorld = tileToWorld(tile.x, tile.y);
      trueTile.position.set(tileWorld.x, 0.03, tileWorld.z);
      this.setTileOutlineOpacity(trueTile, 0.8 + 0.15 * Math.min(tile.count - 1, 1));
      trueTile.visible = true;
    }
  }

  private updateOverheads(sim: GameSimulation): void {
    // Player overhead
    const activePrayer = sim.prayerManager.activePrayer;
    if (activePrayer) {
      const texKey = activePrayer === 'magic' ? 'magic' : 'missiles';
      const tex = this.overheadTextures.get(texKey);
      if (tex) {
        (this.playerOverheadSprite.material as THREE.SpriteMaterial).map = tex;
        this.playerOverheadSprite.visible = true;
        const pp = this.playerGroup.position;
        this.playerOverheadSprite.position.set(pp.x, pp.y + PLAYER_OVERHEAD_Y, pp.z);
      }
    } else {
      this.playerOverheadSprite.visible = false;
    }

    // Boss overhead
    const bossProtection = sim.boss.protectionStyle;
    if (bossProtection) {
      const texKey = bossProtection === 'ranged' ? 'missiles' : bossProtection;
      const tex = this.overheadTextures.get(texKey);
      if (tex) {
        (this.bossOverheadSprite.material as THREE.SpriteMaterial).map = tex;
        this.bossOverheadSprite.visible = true;
        const bp = this.bossGroup.position;
        // Boss model height: Y range ~0 to ~450 OSRS units * scale = ~3.3 world units
        this.bossOverheadSprite.position.set(bp.x, 3.8, bp.z);
      }
    } else {
      this.bossOverheadSprite.visible = false;
    }
  }

  private updateProjectiles(sim: GameSimulation, tickProgress: number): void {
    const activeProjs = new Set<Projectile>();

    for (const proj of sim.projectiles) {
      activeProjs.add(proj);

      let mesh = this.projectileMeshes.get(proj);
      if (!mesh) {
        mesh = this.createProjectileMesh(proj);
        this.projectileMeshes.set(proj, mesh);
        this.scene.add(mesh);
      }

      const duration = Math.max(1, proj.arrivalTick - proj.fireTick);
      const ticksElapsed = sim.tick - proj.fireTick;
      const progress = Math.min(1, Math.max(0, (ticksElapsed + tickProgress) / duration));

      const startWorld = this.pixelToWorld(proj.startX, proj.startY);
      const endWorld = this.pixelToWorld(proj.endX, proj.endY);

      mesh.position.set(
        lerp(startWorld.x, endWorld.x, progress),
        0.8 + Math.sin(progress * Math.PI) * 1.5,
        lerp(startWorld.z, endWorld.z, progress),
      );
    }

    // Remove meshes for expired projectiles
    for (const [proj, mesh] of this.projectileMeshes) {
      if (!activeProjs.has(proj)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.projectileMeshes.delete(proj);
      }
    }
  }

  private createProjectileMesh(proj: Projectile): THREE.Mesh {
    let geometry: THREE.BufferGeometry;
    const color = new THREE.Color(proj.color);

    switch (proj.shape) {
      case 'orb':
        geometry = new THREE.SphereGeometry(0.25, 8, 8);
        break;
      case 'spike':
        geometry = new THREE.ConeGeometry(0.15, 0.5, 4);
        break;
      case 'arrow':
        geometry = new THREE.ConeGeometry(0.1, 0.6, 4);
        break;
      case 'blast':
        geometry = new THREE.SphereGeometry(0.2, 8, 8);
        break;
      case 'slash':
        geometry = new THREE.TorusGeometry(0.3, 0.05, 4, 8, Math.PI * 0.67);
        break;
      default:
        geometry = new THREE.SphereGeometry(0.2, 6, 6);
    }

    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: proj.shape === 'orb',
      opacity: proj.shape === 'orb' ? 0.8 : 1,
    });

    return new THREE.Mesh(geometry, material);
  }

  private pixelToWorld(px: number, py: number): THREE.Vector3 {
    const tileX = px / TILE_SIZE_PX;
    const tileY = py / TILE_SIZE_PX;
    return new THREE.Vector3(
      tileX - HALF_GRID,
      0,
      tileY - HALF_GRID,
    );
  }

  private updateHitSplats(sim: GameSimulation): void {
    const activeSplats = new Set<object>();

    for (const splat of sim.hitSplats) {
      activeSplats.add(splat);

      let sprite = this.hitSplatSprites.get(splat);
      if (!sprite) {
        sprite = this.createHitSplatSprite(splat.damage);
        this.hitSplatSprites.set(splat, sprite);
        this.scene.add(sprite);
      }

      const age = sim.tick - splat.tickCreated;
      const offsetY = age * 0.3;
      const alpha = Math.max(0.2, 1 - age * 0.3);

      const wp = tileToWorld(splat.x, splat.y);
      sprite.position.set(wp.x, 1.5 + offsetY, wp.z);
      sprite.material.opacity = alpha;
    }

    // Remove expired splats
    for (const [splat, sprite] of this.hitSplatSprites) {
      if (!activeSplats.has(splat)) {
        this.scene.remove(sprite);
        sprite.material.map?.dispose();
        sprite.material.dispose();
        this.hitSplatSprites.delete(splat);
      }
    }
  }

  private createHitSplatSprite(damage: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = damage > 0 ? '#cc2222' : '#4444cc';
    ctx.beginPath();
    ctx.arc(32, 32, 24, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(damage), 32, 34);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.6, 0.6, 1);
    return sprite;
  }

  private updateOverlays(sim: GameSimulation): void {
    if (sim.state === 'countdown') {
      this.countdownEl.style.display = 'flex';
      this.countdownEl.textContent = String(sim.countdownTicks);
    } else {
      this.countdownEl.style.display = 'none';
    }

    if (sim.state === 'running' && this.fightTextTick === 0 && sim.countdownTicks <= 0 && sim.tick <= 12) {
      this.fightTextTick = sim.tick;
    }
    if (this.fightTextTick > 0 && sim.tick - this.fightTextTick < 2) {
      this.fightEl.style.display = 'flex';
      this.fightEl.textContent = 'FIGHT!';
    } else {
      this.fightEl.style.display = 'none';
    }
  }

  private updateFloorTiles(sim: GameSimulation): void {
    const tiles = sim.floorHazardManager.tiles;
    const activeKeys = new Set<string>();

    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        const tile = tiles[x][y];
        if (tile.state === 'safe') continue;

        const key = `${x},${y}`;
        activeKeys.add(key);

        let overlay = this.tileOverlays.get(key);
        if (!overlay) {
          overlay = new THREE.Mesh(
            this.tileOverlayGeometry,
            tile.state === 'warning' ? this.tileOverlayMaterials.warning : this.tileOverlayMaterials.hazard,
          );
          overlay.rotation.x = -Math.PI / 2;
          overlay.position.y = 0.02;
          overlay.renderOrder = 1;
          this.tileOverlays.set(key, overlay);
          this.scene.add(overlay);
        }

        // Update material based on state
        overlay.material = tile.state === 'warning'
          ? this.tileOverlayMaterials.warning
          : this.tileOverlayMaterials.hazard;

        const wp = tileToWorld(x, y);
        overlay.position.set(wp.x, 0.02, wp.z);
      }
    }

    // Remove overlays for tiles that are now safe
    for (const [key, overlay] of this.tileOverlays) {
      if (!activeKeys.has(key)) {
        this.scene.remove(overlay);
        this.tileOverlays.delete(key);
      }
    }
  }

  private updateTornadoes(sim: GameSimulation, tickProgress: number, dt: number): void {
    if (!this.tornadoTemplate) return;

    const tornadoes = sim.tornadoes;

    // Ensure we have enough meshes
    while (this.activeTornadoMeshes.length > tornadoes.length) {
      const mesh = this.activeTornadoMeshes.pop()!;
      this.scene.remove(mesh);
      this.tornadoMeshPool.push(mesh);
    }

    for (let i = 0; i < tornadoes.length; i++) {
      let mesh: THREE.Object3D;
      if (i < this.activeTornadoMeshes.length) {
        mesh = this.activeTornadoMeshes[i];
      } else {
        // Get from pool or clone
        if (this.tornadoMeshPool.length > 0) {
          mesh = this.tornadoMeshPool.pop()!;
        } else {
          mesh = this.tornadoTemplate.clone();
        }
        this.scene.add(mesh);
        this.activeTornadoMeshes.push(mesh);
      }

      const tornado = tornadoes[i];
      const prevWorld = tileToWorld(tornado.prevPos.x, tornado.prevPos.y);
      const currWorld = tileToWorld(tornado.pos.x, tornado.pos.y);

      mesh.position.set(
        lerp(prevWorld.x, currWorld.x, tickProgress),
        0,
        lerp(prevWorld.z, currWorld.z, tickProgress),
      );

      // Spin effect
      mesh.rotation.y += dt * 5;
      mesh.visible = true;
    }
  }

  /** Clean up Three.js resources */
  dispose(): void {
    this.playerAnimController?.dispose();
    this.disposeTileOutline(this.playerTrueTile);
    this.disposeTileOutline(this.bossTrueTile);
    for (const tile of [...this.activeTornadoTrueTiles, ...this.tornadoTrueTilePool]) {
      this.disposeTileOutline(tile);
    }
    this.playerFallbackMesh.geometry.dispose();
    (this.playerFallbackMesh.material as THREE.Material).dispose();
    this.webglRenderer.dispose();
    this.cameraController.destroy();
    this.countdownEl.remove();
    this.fightEl.remove();
  }
}
