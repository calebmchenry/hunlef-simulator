/**
 * OSRS-style camera controller.
 * Orbits around a follow target on the Y axis.
 * Arrow keys rotate, scroll wheel zooms.
 * Fixed pitch at ~55 degrees.
 */
import * as THREE from 'three';

const PITCH = 55 * (Math.PI / 180); // ~55 degrees from horizontal
const ROTATE_SPEED = 2.0; // radians per second
const ZOOM_SPEED = 0.8;
const MIN_DISTANCE = 4;
const MAX_DISTANCE = 30;
const DEFAULT_DISTANCE = 18;
const TARGET_LERP_ALPHA = 0.1;

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3(0, 0, 0);
  private desiredTarget = new THREE.Vector3(0, 0, 0);
  private yaw = 0; // rotation around Y axis
  private distance = DEFAULT_DISTANCE;

  // Key state
  private keysDown = new Set<string>();

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundWheel: (e: WheelEvent) => void;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;

    this.boundKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        this.keysDown.add(e.key);
      }
    };
    this.boundKeyUp = (e: KeyboardEvent) => {
      this.keysDown.delete(e.key);
    };
    this.boundWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.distance += e.deltaY > 0 ? ZOOM_SPEED : -ZOOM_SPEED;
      this.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, this.distance));
    };

    domElement.addEventListener('wheel', this.boundWheel, { passive: false });
    document.addEventListener('keydown', this.boundKeyDown);
    document.addEventListener('keyup', this.boundKeyUp);

    this.updateCameraPosition();
  }

  /** Set the center point the camera orbits around */
  setTarget(x: number, y: number, z: number): void {
    this.desiredTarget.set(x, y, z);
  }

  /** Instantly move the camera focus to the given point (no lerp). */
  snapTarget(x: number, y: number, z: number): void {
    this.target.set(x, y, z);
    this.desiredTarget.set(x, y, z);
    this.updateCameraPosition();
  }

  /** Call each frame with delta time in seconds */
  update(dt: number): void {
    if (this.keysDown.has('ArrowLeft')) {
      this.yaw -= ROTATE_SPEED * dt;
    }
    if (this.keysDown.has('ArrowRight')) {
      this.yaw += ROTATE_SPEED * dt;
    }
    this.target.lerp(this.desiredTarget, TARGET_LERP_ALPHA);
    this.updateCameraPosition();
  }

  private updateCameraPosition(): void {
    // Spherical coordinates: fixed pitch, variable yaw and distance
    const x = this.target.x + this.distance * Math.cos(PITCH) * Math.sin(this.yaw);
    const y = this.target.y + this.distance * Math.sin(PITCH);
    const z = this.target.z + this.distance * Math.cos(PITCH) * Math.cos(this.yaw);

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  destroy(): void {
    document.removeEventListener('keydown', this.boundKeyDown);
    document.removeEventListener('keyup', this.boundKeyUp);
  }
}
