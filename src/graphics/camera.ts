import CameraControls from "camera-controls";
import * as holdEvent from "hold-event";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls";

export function fitCameraToContents(camera: THREE.PerspectiveCamera, objectIter: (fn: (obj: THREE.Object3D) => any) => any) {
  const box = new THREE.Box3();
  let matrix = new THREE.Matrix4();
  let vec = new THREE.Vector3();

  // Loop through all children in the scene
  objectIter(object => {
    if (object) {
      if (object instanceof THREE.InstancedMesh) {
        // Compute mesh bounding box
        for (let i = 0; i < object.count; i++) {
          matrix.fromArray(object.instanceMatrix.array, i * 16);
          // console.log("Matrix", matrix);
          vec.setFromMatrixPosition(matrix);
          // console.log("Vec", vec);
          box.expandByPoint(vec);
        }
      } else {
        box.expandByObject(object);
      }
    }
  });

  console.log("Final", box);

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Set camera position to center of bounding box
  camera.position.copy(center);

  // Adjust distance based on size and desired field of view (FOV)
  const distance = size.length() / (2 * Math.tan((Math.PI * camera.fov) / 360));
  camera.position.y = distance;

  // Update camera lookAt target (optional)
  camera.lookAt(center);
}

export function addMapControls(camera: THREE.Camera, element?: HTMLElement) {
  return new MapControls(camera, element);
}

export function addCustomCameraControls(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, element?: HTMLElement) {
  CameraControls.install({ THREE: THREE });
  const controls = new CameraControls(camera, element);
  // Flips left and right mouse buttons
  controls.draggingSmoothTime = 0;
  controls.mouseButtons = {
    left: CameraControls.ACTION.TRUCK,
    right: CameraControls.ACTION.ROTATE,
    middle: CameraControls.ACTION.DOLLY,
    wheel: CameraControls.ACTION.DOLLY,
  };

  const baseSpeed = 0.05;
  const shiftSpeed = baseSpeed * 3;
  let currentSpeed = baseSpeed;

  window.addEventListener("keydown", ev => {
    if (ev.code == "ShiftLeft" || ev.code == "ShiftRight") {
      currentSpeed = shiftSpeed;
    }
  });
  window.addEventListener("keyup", ev => {
    if (ev.code == "ShiftLeft" || ev.code == "ShiftRight") {
      currentSpeed = baseSpeed;
    }
  });

  const wKey = new holdEvent.KeyboardKeyHold("KeyW", 16.666);
  const aKey = new holdEvent.KeyboardKeyHold("KeyA", 16.666);
  const sKey = new holdEvent.KeyboardKeyHold("KeyS", 16.666);
  const dKey = new holdEvent.KeyboardKeyHold("KeyD", 16.666);
  aKey.addEventListener("holding", function (event) {
    controls.truck(-1 * currentSpeed * event!.deltaTime, 0, false);
  });
  dKey.addEventListener("holding", function (event) {
    controls.truck(currentSpeed * event!.deltaTime, 0, false);
  });
  wKey.addEventListener("holding", function (event) {
    controls.forward(currentSpeed * event!.deltaTime, false);
  });
  sKey.addEventListener("holding", function (event) {
    controls.forward(-1 * currentSpeed * event!.deltaTime, false);
  });

  const leftKey = new holdEvent.KeyboardKeyHold("ArrowLeft", 100);
  const rightKey = new holdEvent.KeyboardKeyHold("ArrowRight", 100);
  const upKey = new holdEvent.KeyboardKeyHold("ArrowUp", 100);
  const downKey = new holdEvent.KeyboardKeyHold("ArrowDown", 100);
  leftKey.addEventListener("holding", function (event) {
    controls.rotate(
      -0.1 * THREE.MathUtils.DEG2RAD * event!.deltaTime,
      0,
      true,
    );
  });
  rightKey.addEventListener("holding", function (event) {
    controls.rotate(
      0.1 * THREE.MathUtils.DEG2RAD * event!.deltaTime,
      0,
      true,
    );
  });
  upKey.addEventListener("holding", function (event) {
    controls.rotate(
      0,
      -0.05 * THREE.MathUtils.DEG2RAD * event!.deltaTime,
      true,
    );
  });
  downKey.addEventListener("holding", function (event) {
    controls.rotate(
      0,
      0.05 * THREE.MathUtils.DEG2RAD * event!.deltaTime,
      true,
    );
  });

  return controls;
}
