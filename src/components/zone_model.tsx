import CameraControls from "camera-controls";
import { createEffect, createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { createStore } from "solid-js/store";
import * as THREE from "three";
import Stats from "three/addons/libs/stats.module.js";
import { FlyControls, MapControls } from "three/examples/jsm/Addons.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { addCustomCameraControls, addMapControls, fitCameraToContents } from "../graphics/camera";
import { setupBaseScene } from "../graphics/scene";
import { cleanupNode } from "../graphics/util";
import { EntityUpdate, EntityUpdateKind, ZoneEntityUpdates } from "../parse_packets";
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
interface ParsedEntityUpdates {
  entityRows: EntityRow[];
  minTime: number;
  maxTime: number;
}

export default function ZoneModel(props: ZoneDataProps) {
  const zoneIds = Object.keys(props.zoneData);
  const startingZoneId = zoneIds[0] != "0" ? parseInt(zoneIds[0]) : (parseInt(zoneIds[1]) || 0);
  const [getSelectedZone, setSelectedZone] = createSignal<number>(startingZoneId);

  const [entitySettings, setEntitySettings] = createStore<EntitiesSettings>();
  const [zoneMeshes, setZoneMeshes] = createStore<ByZone<THREE.Mesh>>();

  const parsedEntityUpdates = createMemo(() => {
    if (!props.entityUpdates) {
      return undefined;
    }

    let result: {
      [zoneId: number]: ParsedEntityUpdates;
    } = {};

    Object.keys(props.entityUpdates).forEach(zoneId => {
      let minTime = Number.MAX_SAFE_INTEGER;
      let maxTime = Number.MIN_SAFE_INTEGER;

      let rows = Object.keys(props.entityUpdates[zoneId]).map(
        entityKey => {
          const updates: EntityUpdate[] = props.entityUpdates[zoneId][entityKey];
          const updateCount = updates.length;

          minTime = Math.min(minTime, updates[0].time);
          maxTime = Math.max(maxTime, updates[updates.length - 1].time);

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
        minTime,
        maxTime,
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
        // Mesh already setup
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

  // Setup meshes for entities
  let currentZoneEntities: ByZone<{ [entityKey: string]: THREE.InstancedMesh; }> = {};
  const mobColor = new THREE.Color(0xFF0000);
  const widescanColor = new THREE.Color(0xE000DC);
  const geo = new THREE.CapsuleGeometry();
  const mat = new THREE.MeshToonMaterial();
  createEffect(() => {
    cleanUpEntities();

    for (const zoneId in props.entityUpdates) {
      const entities = (currentZoneEntities[zoneId] = currentZoneEntities[zoneId] || {});

      for (const entityKey in props.entityUpdates[zoneId]) {
        const updates = props.entityUpdates[zoneId][entityKey];
        const mesh = new THREE.InstancedMesh(geo, mat, updates.length);

        scene.add(mesh);
        entities[entityKey] = mesh;
      }
    }
  });

  // Show entities at different points in time
  const onTimeRangeChange = (minTime: number, maxTime: number) => {
    if (!props.entityUpdates) {
      return;
    }

    const zoneId = getSelectedZone();
    const entities = currentZoneEntities[zoneId];
    let obj = new THREE.Object3D();
    for (const entityKey in props.entityUpdates[zoneId]) {
      if (entitySettings[entityKey]?.hidden) {
        continue;
      }

      const mesh = entities[entityKey];
      const updates = props.entityUpdates[zoneId][entityKey];

      // Skip until first visible update
      let idx = 0;
      while (idx < updates.length && updates[idx].time < minTime) {
        idx++;
      }

      let showCount = 0;
      // Add until last visible update
      while (idx < updates.length && updates[idx].time <= maxTime) {
        const update = updates[idx];
        if (update.kind !== EntityUpdateKind.Position && update.kind !== EntityUpdateKind.Widescan) {
          // Only add positional updates
          continue;
        }

        obj.position.set(update.pos.x, update.pos.y * -1 + 1, update.pos.z);
        obj.updateMatrix();
        mesh.setMatrixAt(showCount, obj.matrix);
        if (update.kind == EntityUpdateKind.Position) {
          mesh.setColorAt(idx, mobColor);
        } else {
          mesh.setColorAt(idx, widescanColor);
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
  };

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

  createEffect(() => {
    for (const entityKey in entitySettings) {
      const entityId = parseInt(entityKey.split("-")[1]);
      const zoneId = (entityId >> 12) & 0x01ff;
      currentZoneEntities[zoneId][entityKey].visible = !entitySettings[entityKey].hidden;
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

  const renderer = new THREE.WebGLRenderer();
  // renderer.setPixelRatio(window.devicePixelRatio);
  renderer.domElement.className = "w-full h-full";
  renderer.setAnimationLoop(animate);

  onMount(() => {
    controls = addMapControls(camera, renderer.domElement);
  });

  onCleanup(() => {
    cleanupNode(scene);
    cleanUpZones(true);
    cleanUpEntities(true);
    if (controls) {
      controls.dispose();
    }
    scene.clear();
    renderer.forceContextLoss();
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
    for (const zoneId in currentZoneEntities) {
      for (const entityKey in currentZoneEntities[zoneId]) {
        const mesh = currentZoneEntities[zoneId][entityKey];
        scene.remove(mesh);
        cleanupNode(mesh);
      }
    }
  }

  const clock = new THREE.Clock();
  const stats = new Stats();
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2(1, 1);
  function animate() {
    stats.update();

    const delta = clock.getDelta();
    controls?.update(delta);
    // flyControls?.update(delta);

    if (resizeRendererToDisplaySize()) {
      const canvas = renderer.domElement;
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
    }

    raycaster.setFromCamera(mouse, camera);

    renderer.clear();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  function resizeRendererToDisplaySize() {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
      labelRenderer.setSize(width, height);
      labelRenderer.domElement.style.top = `calc(${renderer.domElement.offsetTop}px - 1.5rem)`;
      stats.dom.style.top = `calc(${renderer.domElement.offsetTop}px)`;
      stats.dom.style.left = `calc(${renderer.domElement.offsetLeft}px)`;
    }
    return needResize;
  }

  renderer.domElement.addEventListener("mousemove", event => {
    const canvas = renderer.domElement;
    mouse.x = (2 * event.offsetX) / canvas.offsetWidth - 1;
    mouse.y = (-2 * event.offsetY) / canvas.offsetHeight + 1;
  });

  const currentEntityUpdates = createMemo(() => {
    const key = getSelectedZone();
    if (key !== undefined && parsedEntityUpdates()) {
      return parsedEntityUpdates()[key];
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
      {renderer.domElement}
      {labelRenderer.domElement}
      {stats.dom}
      <Show when={props.entityUpdates}>
        <Show
          fallback={zoneSelector}
          when={getSelectedZone() in parsedEntityUpdates()}
        >
          <RangeInput
            min={currentEntityUpdates().minTime}
            max={currentEntityUpdates().maxTime}
            inputKind="timestamp"
            onChange={onTimeRangeChange}
          >
          </RangeInput>

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
                    onChange={e => {
                      setEntitySettings(v.entityKey, {
                        hidden: e.target.checked,
                      });
                    }}
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
