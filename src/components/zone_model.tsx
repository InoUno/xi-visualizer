import CameraControls from "camera-controls";
import { createEffect, createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { createStore } from "solid-js/store";
import * as THREE from "three";
import Stats from "three/addons/libs/stats.module.js";
import { FlyControls, MapControls } from "three/examples/jsm/Addons.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { addCustomCameraControls, addMapControls, adjustCameraAspect, fitCameraToContents } from "../graphics/camera";
import { setupBaseScene } from "../graphics/scene";
import { cleanupNode } from "../graphics/util";
import { EntityUpdate, EntityUpdateKind, Position, PositionUpdate, ZoneEntityUpdates } from "../parse_packets";
import { ByZone } from "../types";
import LookupInput from "./lookup_input";
import RangeInput from "./range_input";
import Table from "./table";

interface ZoneDataProps {
  zoneData: ByZone<ZoneData>;
  entityUpdates?: ZoneEntityUpdates;
}

export interface ZoneData {
  id: number;
  name: string;
  mesh: ArrayBuffer;
}

export interface EntitySettings {
  hidden?: boolean;
  color?: number;
}

export interface EntitiesSettings {
  [entityKey: string]: EntitySettings;
}

export interface EntitiesMeshes {
  [entityKey: string]: THREE.InstancedMesh;
}

interface EntityRow {
  id: string;
  index: string;
  entityKey: string;
  updateCount: number;
}

interface NormalizedEntityUpdates {
  entityRows: EntityRow[];
  firstTime: number;
  lastTime: number;
}

export default function ZoneModel(props: ZoneDataProps) {
  const zoneIds = Object.keys(props.zoneData);
  const startingZoneId = zoneIds[0] != "0" ? parseInt(zoneIds[0]) : (parseInt(zoneIds[1]) || 0);
  const [getSelectedZone, setSelectedZone] = createSignal<number>(startingZoneId);

  const [entitySettings, setEntitySettings] = createStore<EntitiesSettings>();
  const [zoneMeshes, setZoneMeshes] = createStore<ByZone<THREE.Mesh>>();

  const [getShowDiscrete, setShowDiscrete] = createSignal<boolean>(false);
  const [getDiscreteLowerTime, setDiscreteLowerTime] = createSignal<number>(0);
  const [getDiscreteUpperTime, setDiscreteUpperTime] = createSignal<number>(1);

  const parsedEntityUpdates = createMemo(() => {
    if (!props.entityUpdates) {
      return undefined;
    }

    let result: {
      [zoneId: number]: NormalizedEntityUpdates;
    } = {};

    Object.keys(props.entityUpdates).forEach(zoneId => {
      let firstTime = Number.MAX_SAFE_INTEGER;
      let lastTime = Number.MIN_SAFE_INTEGER;

      let rows = Object.keys(props.entityUpdates[zoneId]).map(
        entityKey => {
          const updates: EntityUpdate[] = props.entityUpdates[zoneId][entityKey];
          const updateCount = updates.length;

          firstTime = Math.min(firstTime, updates[0].time);
          lastTime = Math.max(lastTime, updates[updates.length - 1].time);

          setEntitySettings(entityKey, { hidden: true });
          const split = entityKey.split("-");
          return {
            id: split[1],
            index: split[0],
            entityKey,
            updateCount,
          };
        },
      );

      result[zoneId] = {
        entityRows: rows,
        firstTime,
        lastTime,
      };
    });

    return result;
  });

  const [scene, camera] = setupBaseScene();

  // Create zones
  createEffect(() => {
    cleanUpZones();

    for (const zoneId in props.zoneData) {
      if (zoneMeshes[zoneId]) {
        // Mesh is already set up
        continue;
      }

      console.time("setup-mesh-" + zoneId);
      const buffer = props.zoneData[zoneId].mesh;

      const color = new THREE.Color();
      color.setRGB(0.2, 0.2, 0.2);

      let triangleCount = new Uint32Array(buffer, 0, 1)[0];
      const normalsSize = triangleCount * 3;
      const positionsSize = triangleCount * 3 * 3;
      const positions = new Float32Array(buffer, 4, positionsSize);
      const normalsDedupe = new Float32Array(
        buffer,
        4 + positionsSize * 4,
        normalsSize,
      );

      const colors = new Uint8Array(positionsSize);
      for (let i = 0; i < positionsSize; i += 3) {
        colors.set([color.r * 255, color.g * 255, color.b * 255], i);
      }
      const normals = new Float32Array(positionsSize);
      for (let i = 0; i < normalsSize; i += 3) {
        normals.set(
          [normalsDedupe[i], normalsDedupe[i + 1], normalsDedupe[i + 2]],
          i * 3,
        );
        normals.set(
          [normalsDedupe[i], normalsDedupe[i + 1], normalsDedupe[i + 2]],
          (i + 1) * 3,
        );
        normals.set(
          [normalsDedupe[i], normalsDedupe[i + 1], normalsDedupe[i + 2]],
          (i + 2) * 3,
        );
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.computeBoundingBox();

      const material = new THREE.MeshLambertMaterial({
        color: 0x333333,
        vertexColors: true,
        polygonOffset: true,
        polygonOffsetFactor: 1, // positive value pushes polygon further away
        polygonOffsetUnits: 1,
      });

      const mesh = new THREE.Mesh(geometry, material);
      setZoneMeshes(parseInt(zoneId), mesh);

      // Add wireframe
      var geo = new THREE.WireframeGeometry(mesh.geometry); // EdgesGeometry or WireframeGeometry
      var mat = new THREE.LineBasicMaterial({
        color: 0x333333,
        transparent: true,
        opacity: 0.2,
        depthTest: true,
      });
      var wireframe = new THREE.LineSegments(geo, mat);
      mesh.add(wireframe);
      mesh.visible = false;

      scene.add(mesh);
      console.timeEnd("setup-mesh-" + zoneId);
    }
  });

  const [isPlaying, setIsPlaying] = createSignal<boolean>(false);
  const [isSeeking, setIsSeeking] = createSignal<boolean>(false);
  const [getPlayTime, setPlayTime] = createSignal<number>(0);
  const [getTimeScale, setTimeScale] = createSignal<number>(10);

  const getPlayTimeMax = () => {
    return (currentEntityUpdates().lastTime - currentEntityUpdates().firstTime) / 1000;
  };

  // Common entity setup
  const mobColor = new THREE.Color(0xFF0000);
  const widescanColor = new THREE.Color(0xE000DC);
  const geo = new THREE.CapsuleGeometry();

  // Setup animations for entities
  const mixers = createMemo(() => {
    let parsedUpdates = parsedEntityUpdates();
    let mixers: THREE.AnimationMixer[] = [];

    for (const zoneId in props.entityUpdates) {
      const startTime = parsedUpdates[zoneId].firstTime;
      const length = parsedUpdates[zoneId].lastTime - startTime;

      for (const entityKey in props.entityUpdates[zoneId]) {
        const updates = props.entityUpdates[zoneId][entityKey];

        // Count how long the arrays needs to be.
        let count = 0;
        let prevPosUpdate: PositionUpdate | undefined = undefined;
        for (const update of updates) {
          if (update.kind == EntityUpdateKind.Position) {
            if (!prevPosUpdate) {
              // No previous position, so add a hidden frame just before this one.
              count++;
            } else if (prevPosUpdate && update.time > (prevPosUpdate.time + 20000)) {
              // Long time since last position, so add hide+show frames
              count += 2;
            }
            prevPosUpdate = update;
            count++;
          }
        }

        if (count == 0) {
          continue;
        }
        count++; // Last hiding frame

        const times = new Float32Array(count);
        const opacity = new Float32Array(count);
        const positions = new Float32Array(count * 3);
        const scale = new Float32Array(count * 3);

        let i = 0;
        const addFrame = (pos: Position, time: number, show: boolean = true) => {
          times[i] = (time - startTime) / 1000;
          const showNum = show ? 1 : 0;
          opacity[i] = showNum;
          scale.set([showNum, showNum, showNum], i * 3);
          positions.set([pos.x, pos.y * -1 + 1, pos.z], i * 3);
          i++;
        };

        prevPosUpdate = undefined;
        for (const update of updates) {
          if (update.kind == EntityUpdateKind.Position) {
            if (!prevPosUpdate) {
              // No previous position, so add a hidden frame just before this one.
              addFrame(update.pos, update.time - 1000, false);
            } else if (prevPosUpdate && update.time > (prevPosUpdate.time + 20000)) {
              // Long time since last position, so add hide+show frames
              addFrame(prevPosUpdate.pos, prevPosUpdate.time + 1000, false);
              addFrame(update.pos, update.time - 1000, false);
            }
            // Add current position frame
            addFrame(update.pos, update.time, true);
            prevPosUpdate = update;
          } else if (update.kind == EntityUpdateKind.Spawn) {
            // TODO
          } else if (update.kind == EntityUpdateKind.Despawn) {
            // TODO
          }
        }

        // Add final hide frame
        addFrame(prevPosUpdate.pos, prevPosUpdate.time + 1000, false);

        const positionKF = new THREE.VectorKeyframeTrack(".position", times, positions);
        const scaleKF = new THREE.VectorKeyframeTrack(".scale", times, scale);
        const opacityKF = new THREE.NumberKeyframeTrack(".material.opacity", times, opacity);
        const clip = new THREE.AnimationClip(entityKey, length / 1000, [positionKF, scaleKF, opacityKF]);

        const mat = new THREE.MeshToonMaterial({
          color: mobColor,
          opacity: 1,
          transparent: true,
        });
        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);

        const mixer = new THREE.AnimationMixer(mesh);
        mixer.timeScale = 1;
        mixers.push(mixer);

        const clipAction = mixer.clipAction(clip);
        clipAction.play();
      }
    }

    onCleanup(() => {
      for (const mixer of mixers) {
        const mesh = mixer.getRoot() as THREE.Mesh;
        cleanupNode(mesh);
        scene.remove(mesh);
      }
    });
    return mixers;
  });

  // Setup meshes for entities
  let discreteEntityMeshes: ByZone<{ [entityKey: string]: THREE.InstancedMesh; }> = {};
  const mat = new THREE.MeshToonMaterial();
  createEffect(() => {
    cleanUpEntities();

    for (const zoneId in props.entityUpdates) {
      const entities = (discreteEntityMeshes[zoneId] = discreteEntityMeshes[zoneId] || {});

      for (const entityKey in props.entityUpdates[zoneId]) {
        const updates = props.entityUpdates[zoneId][entityKey];
        const mesh = new THREE.InstancedMesh(geo, mat, updates.length);

        scene.add(mesh);
        entities[entityKey] = mesh;
      }
    }
  });

  // Show entities at different points in time
  createEffect(() => {
    if (!props.entityUpdates || !getShowDiscrete()) {
      return;
    }

    const zoneId = getSelectedZone();
    const entities = discreteEntityMeshes[zoneId];
    let obj = new THREE.Object3D();
    for (const entityKey in props.entityUpdates[zoneId]) {
      if (entitySettings[entityKey]?.hidden) {
        continue;
      }

      const mesh = entities[entityKey];
      const updates = props.entityUpdates[zoneId][entityKey];

      // Skip until first visible update
      let idx = 0;
      while (idx < updates.length && updates[idx].time < getDiscreteLowerTime()) {
        idx++;
      }

      let showCount = 0;
      // Add until last visible update
      while (idx < updates.length && updates[idx].time <= getDiscreteUpperTime()) {
        const update = updates[idx];
        if (update.kind !== EntityUpdateKind.Position && update.kind !== EntityUpdateKind.Widescan) {
          // Only add positional updates
          continue;
        }

        obj.position.set(update.pos.x, update.pos.y * -1, update.pos.z);
        obj.updateMatrix();
        mesh.setMatrixAt(showCount, obj.matrix);
        if (update.kind == EntityUpdateKind.Position) {
          mesh.setColorAt(showCount, mobColor);
        } else {
          mesh.setColorAt(showCount, widescanColor);
        }
        idx++;
        showCount++;
      }
      mesh.count = showCount;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
  });

  // Show/hide zone meshes and associated entities
  createEffect(() => {
    for (const zoneId in zoneMeshes) {
      const zoneIsVisible = parseInt(zoneId) == getSelectedZone();
      zoneMeshes[zoneId].visible = zoneIsVisible;
      if (!props.entityUpdates) {
        continue;
      }

      // Show/hide entities from other zones
      for (const entityKey in props.entityUpdates[zoneId]) {
        setEntitySettings(entityKey, { hidden: !zoneIsVisible });
      }
      // if (zoneIsVisible) {
      //   fitCameraToContents(camera, fn => {
      //     Object.keys(currentZoneEntities[zoneId]).forEach(entityKey => fn(currentZoneEntities[zoneId][entityKey]));
      //   });
      // }
    }
  });

  // Show/hide discrete entity meshes
  createEffect(() => {
    for (const entityKey in entitySettings) {
      const entityId = parseInt(entityKey.split("-")[1]);
      const zoneId = (entityId >> 12) & 0x01ff;
      discreteEntityMeshes[zoneId][entityKey].visible = getShowDiscrete() && !entitySettings[entityKey].hidden;
    }
  });

  // Setup labels
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(innerWidth, innerHeight);
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.top = "0px";
  labelRenderer.domElement.style.pointerEvents = "none";

  const labelDiv = document.createElement("div");
  labelDiv.style.padding = "0.1rem 0.4rem";
  labelDiv.style.background = "rgba(0,0,0,0.7)";
  labelDiv.style.color = "0xFFFFFF";
  const label = new CSS2DObject(labelDiv);
  label.visible = false;
  scene.add(label);

  let controls: CameraControls | FlyControls | MapControls = undefined!;
  let canvasElement: HTMLCanvasElement;

  onMount(() => {
    const parentRect = canvasElement.parentElement?.getBoundingClientRect();
    canvasElement.width = parentRect.width;
    canvasElement.height = parentRect.height;
    adjustCameraAspect(camera, canvasElement);

    const renderer = new THREE.WebGLRenderer({ canvas: canvasElement, antialias: true, alpha: true });
    renderer.setAnimationLoop(() => animate(renderer));

    canvasElement.addEventListener("mousemove", event => {
      const canvas = canvasElement;
      mouse.x = (2 * event.offsetX) / canvas.offsetWidth - 1;
      mouse.y = (-2 * event.offsetY) / canvas.offsetHeight + 1;
    });

    controls = addMapControls(camera, canvasElement);
  });

  onCleanup(() => {
    cleanupNode(scene);
    cleanUpZones(true);
    cleanUpEntities(true);
    if (controls) {
      controls.dispose();
    }
    scene.clear();
  });

  function cleanUpZones(forced = false) {
    // Remove old zones that aren't needed anymore
    for (const zoneId in zoneMeshes) {
      if (!forced && props.zoneData[zoneId]) {
        // This zone ID is still needed
        continue;
      }

      console.log("Disposing zone " + zoneId);
      const mesh = zoneMeshes[zoneId];
      setZoneMeshes(parseInt(zoneId), null);
      scene.remove(mesh);
      cleanupNode(mesh);
    }
  }

  function cleanUpEntities(forced = false) {
    // Remove old entities
    for (const zoneId in discreteEntityMeshes) {
      for (const entityKey in discreteEntityMeshes[zoneId]) {
        const mesh = discreteEntityMeshes[zoneId][entityKey];
        scene.remove(mesh);
        cleanupNode(mesh);
      }
    }
  }

  const clock = new THREE.Clock();
  const stats = new Stats();
  stats.dom.style.position = "absolute";

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2(1, 1);
  function animate(renderer: THREE.WebGLRenderer) {
    stats.update();

    const delta = clock.getDelta();
    controls?.update(delta);

    if (resizeRendererToDisplaySize(renderer)) {
      adjustCameraAspect(camera, canvasElement);
    }

    if (isPlaying()) {
      if (!isSeeking()) {
        const playTime = getPlayTime();
        setPlayTime((playTime + delta * getTimeScale()) % getPlayTimeMax());
      }
      for (const mixer of mixers()) {
        mixer.setTime(getPlayTime());
      }
    }

    raycaster.setFromCamera(mouse, camera);

    renderer.clear();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  function resizeRendererToDisplaySize(renderer: THREE.WebGLRenderer) {
    const canvas = canvasElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
      labelRenderer.setSize(width, height);
      labelRenderer.domElement.style.top = `calc(${canvas.offsetTop}px - 1.5rem)`;
    }
    return needResize;
  }

  const currentEntityUpdates = createMemo(() => {
    const key = getSelectedZone();
    if (key !== undefined && parsedEntityUpdates()) {
      const updates = parsedEntityUpdates()[key];
      if (updates) {
        setDiscreteLowerTime(updates.firstTime);
        setDiscreteUpperTime(updates.lastTime);
        setPlayTime(0);
        return updates;
      }
    }
  });

  const zoneSelector = (
    <Show when={Object.keys(props.zoneData).length > 1}>
      <div class="flex-grow m-1">
        <LookupInput
          options={props.zoneData}
          nameFn={v => v.name}
          onChange={v => setSelectedZone(parseInt(v.id) || undefined)}
          placeholder="Select zone"
          initialId={getSelectedZone() + ""}
        >
        </LookupInput>
      </div>
    </Show>
  );

  return (
    <div class="w-full h-full">
      <div class="m-auto relative" style={{ "max-height": "60vh" }}>
        <canvas class="block w-full" ref={canvasElement}></canvas>
        {labelRenderer.domElement}
        {import.meta.env.DEV ? stats.dom : undefined}
      </div>
      <Show when={props.entityUpdates}>
        <Show
          fallback={zoneSelector}
          when={getSelectedZone() in parsedEntityUpdates()}
        >
          <div class="flex flex-row my-2">
            <div class="m-auto h-full px-1">
              <button style={{ "min-width": "100px" }} onClick={() => setIsPlaying(!isPlaying())}>
                {isPlaying() ? "Pause" : "Play"}
              </button>
            </div>
            <div class="m-auto">
              <input
                type="number"
                class="text-center"
                min={1}
                max={1000}
                style={{ width: "70px" }}
                value={getTimeScale()}
                onInput={e => setTimeScale(parseInt(e.target.value) || 1)}
              >
              </input>
            </div>
            <div class="m-auto flex-grow">
              <input
                type="range"
                class="w-full"
                min={currentEntityUpdates().firstTime}
                max={currentEntityUpdates().lastTime}
                value={getPlayTime() * 1000 + currentEntityUpdates().firstTime}
                onMouseDown={() => setIsSeeking(true)}
                onMouseUp={() => setIsSeeking(false)}
                onInput={e => setPlayTime((parseInt(e.target.value) - currentEntityUpdates().firstTime) / 1000)}
              >
              </input>
            </div>
          </div>
          <div class="flex flex-row my-2">
            <div class="px-1 m-auto h-full">
              <button style={{ "min-width": "200px" }} onClick={() => setShowDiscrete(!getShowDiscrete())}>
                {getShowDiscrete() ? "Hide discrete points" : "Show discrete points"}
              </button>
            </div>
            <div class="flex-grow">
              <RangeInput
                min={currentEntityUpdates().firstTime}
                max={currentEntityUpdates().lastTime}
                lower={getDiscreteLowerTime()}
                upper={getDiscreteUpperTime()}
                inputKind="timestamp"
                onChangeLower={setDiscreteLowerTime}
                onChangeUpper={setDiscreteUpperTime}
                disabled={!getShowDiscrete()}
              >
              </RangeInput>
            </div>
          </div>

          <Table
            inputRows={currentEntityUpdates().entityRows}
            columns={[
              { name: "ID", key: "id" },
              { name: "Index", key: "index" },
              { name: "Count", key: "updateCount" },
            ]}
            defaultSortColumn="updateCount"
            defaultSortAsc={false}
            additionalColumns={[
              {
                name: "Visible",
                content: v => (
                  <input
                    type="checkbox"
                    checked={!entitySettings[v.entityKey]?.hidden}
                  />
                ),
              },
            ]}
            onRowClick={v => {
              setEntitySettings(v.entityKey, {
                hidden: !entitySettings[v.entityKey]?.hidden,
              });
            }}
            headerElements={[
              rows => (
                <button
                  onClick={() => rows.forEach(v => setEntitySettings(v.entityKey, { hidden: false }))}
                >
                  Show filtered
                </button>
              ),
              rows => (
                <button
                  onClick={() => rows.forEach(v => setEntitySettings(v.entityKey, { hidden: true }))}
                >
                  Hide filtered
                </button>
              ),
              zoneSelector,
            ]}
          >
          </Table>
        </Show>
      </Show>
    </div>
  );
}
