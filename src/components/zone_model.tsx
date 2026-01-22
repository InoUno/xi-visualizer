import "./zone_model.css";


// @ts-ignore
import Stats from "three/addons/libs/stats.module.js";
import * as THREE from "three";

import { IoHelpCircle, IoSettings } from "solid-icons/io";
import { batch, createEffect, createMemo, createSignal, For, mapArray, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { createMutable, createStore, produce, SetStoreFunction, unwrap } from "solid-js/store";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { MapControls } from "three/examples/jsm/Addons.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { addMapControls, adjustCameraAspect, fitCameraToContents } from "../graphics/camera";
import { setupBaseScene } from "../graphics/scene";
import { cleanupNode, ROT_TO_RADIANS, roundDecimals } from "../graphics/util";
import { EntityUpdate, EntityUpdateKind, Position, PositionUpdate, ZoneEntityUpdates, type EntityUpdates } from "../parse_packets";
import { ByZone } from "../types";
import { binarySearchLower, deepMerge } from "../util";
import AreaMenu, { Area, deriveAreaYs as deriveAreaYRange, Point } from "./area_menu";
import LookupInput from "./lookup_input";
import RangeInput from "./range_input";
import Table from "./table";
import { ColorKind, colorMesh, createZoneMesh, getHitData, getMapId, markLineCollisions, prepareMeshData, RayHit } from "../graphics/ximesh";
import { ZoneInfoBox, TargetInfo } from "./zone_info_box";
import { ZoneRayTestingBox } from "./zone_ray_testing_box";
import PathNodes from "./path_nodes";
import SelectionBox, { type SelectionBoxResult } from "./selection_box";
import { parsePath, PathPartKind, type PathPart } from "../parse_path";
import EntityPaths, { type EntityPathMap } from "./entity_paths";


// Add the extension functions
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

interface ZoneDataProps {
  zoneData: ByZone<ZoneData>;
  sourceKey?: string,
  defaultSettings?: ZoneModelSettingsDefault;
  entityUpdates?: ZoneEntityUpdates;
  clientUpdates?: PositionUpdate[];
}

interface ZoneModelSettings {
  showInfoBox: boolean,
  showNodeManager: boolean,
  showAreaManager: boolean,
  showRayTesting: boolean,
  colorKind: ColorKind,
}

interface EntityUpdatesSettings {
  show: {
    discrete: boolean,
    animated: boolean,
    lastOnly: boolean,
    rendered: boolean,
    widescan: boolean,
    paths: boolean,
    pathKinds: EntityPathKindsSettings
  }
}

export interface EntityPathKindsSettings {
  start: boolean,
  preturn: boolean,
  turn: boolean,
  end: boolean,
  interrupt: boolean,
  lines: boolean,
}

type ZoneModelSettingsDefault = Partial<ZoneModelSettings>;

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
  name: string;
  updateCount: number;
  levels: string;
}

interface NormalizedEntityUpdates {
  entityRows: EntityRow[];
  maxUpdatesKey: string;
  firstTime: number;
  lastTime: number;
}

const enum MenuPopup {
  None = 0,
  Settings = 1,
  Help = 2,
}

export default function ZoneModel(props: ZoneDataProps) {
  const [getMenuPopup, setMenuPopup] = createSignal<MenuPopup>(MenuPopup.None);

  const [getSelectionBox, setSelectionBox] = createSignal<SelectionBoxResult | undefined>();

  // General zone model settings
  const generalSettingsKey = props.sourceKey ? `xi-visualizer.settings.${props.sourceKey}` : "xi-visualizer.settings._any";
  const localStorageGeneralSettings: ZoneModelSettings = JSON.parse(localStorage.getItem(generalSettingsKey), (k, v) => {
    if (k == "colorKind") {
      return parseInt(v);
    } else {
      return v;
    }
  }) || {};

  const defaultGeneralSettings: ZoneModelSettings = {
    showInfoBox: false,
    showNodeManager: false,
    showAreaManager: false,
    showRayTesting: false,
    colorKind: ColorKind.Materials,
    ...props.defaultSettings,
  }

  // Update local storage on change
  const generalSettings = createMutable<ZoneModelSettings>({
    ...defaultGeneralSettings,
    ...localStorageGeneralSettings,
  });

  createEffect(() => {
    localStorage.setItem(generalSettingsKey, JSON.stringify(generalSettings));
  });

  // Entity updates settings
  const updatesSettingsKey = "xi-visualizer.settings.packet.entity-updates";
  const localStorageUpdatesSettings: EntityUpdatesSettings = JSON.parse(localStorage.getItem(updatesSettingsKey)) || {};

  const defaultUpdatesSettings: EntityUpdatesSettings = {
    show: {
      discrete: true,
      animated: false,
      lastOnly: false,
      rendered: true,
      widescan: true,
      paths: false,
      pathKinds: {
        start: true,
        preturn: false,
        turn: true,
        end: true,
        interrupt: true,
        lines: true,
      }
    }
  }

  const updatesSettings = createMutable<EntityUpdatesSettings>(deepMerge(defaultUpdatesSettings, localStorageUpdatesSettings));

  // Update local storage on change
  createEffect(() => {
    localStorage.setItem(updatesSettingsKey, JSON.stringify(updatesSettings));
  });

  // Zone and entity signals and stores
  const zoneIds = Object.keys(props.zoneData);
  const startingZoneId = zoneIds[0] != "0" ? parseInt(zoneIds[0]) : (parseInt(zoneIds[1]) || 0);
  const [getSelectedZone, setSelectedZone] = createSignal<number>(startingZoneId);

  const [entitySettings, setEntitySettings] = createStore<EntitiesSettings>({});

  const [getNewDiscrete, setNewDiscrete] = createSignal<[number, number] | undefined>();
  const [getDiscreteLowerTime, setDiscreteLowerTime] = createSignal<number>(0);
  const [getDiscreteUpperTime, setDiscreteUpperTime] = createSignal<number>(1);

  const summarizedEntityUpdates = createMemo(() => {
    if (!props.entityUpdates) {
      return {};
    }

    let result: {
      [zoneId: number]: NormalizedEntityUpdates;
    } = {};

    Object.keys(props.entityUpdates).forEach(zoneId => {
      let firstTime = Number.MAX_SAFE_INTEGER;
      let lastTime = Number.MIN_SAFE_INTEGER;

      let maxUpdatesKey;
      let maxUpdates = Number.MIN_SAFE_INTEGER;

      let rows = Object.keys(props.entityUpdates[zoneId]).map(
        entityKey => {
          const entity: EntityUpdates = props.entityUpdates[zoneId][entityKey];
          const updates: EntityUpdate[] = entity.updates;
          const updateCount = updates.length;
          if (updateCount == 0) {
            return undefined;
          }

          firstTime = Math.min(firstTime, updates[0].time);
          lastTime = Math.max(lastTime, updates[updates.length - 1].time);

          if (updates.length > maxUpdates) {
            maxUpdates = updates.length;
            if (maxUpdatesKey) {
              setEntitySettings(maxUpdatesKey, { hidden: true });
            }
            maxUpdatesKey = entityKey;
          } else {
            setEntitySettings(entityKey, { hidden: true });
          }


          const split = entityKey.split("-");
          return {
            id: entity.id.toString(),
            index: split[0],
            entityKey,
            name: entity.firstName,
            levels: entity.levels.toSorted().join(","),
            updateCount,
          } as EntityRow;
        },
      ).filter(x => x !== undefined);

      result[zoneId] = {
        entityRows: rows,
        firstTime,
        lastTime,
        maxUpdatesKey,
      };
    });

    return result;
  });

  const scene = createMemo(() => {
    return setupBaseScene();
  })

  const camera = createMemo(() => {
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 5000);
    camera.position.set(0, 1000, 0);
    camera.lookAt(0, 0, 0);
    return camera;
  })

  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;

  // Prepare mesh data
  const prepMeshData = createMemo(() => {
    const preparedMeshesData = {};
    for (const zoneId in props.zoneData) {
      const zoneData = props.zoneData[zoneId];
      const preparedMeshData = prepareMeshData(zoneData.mesh);

      preparedMeshesData[zoneData.id] = preparedMeshData;
    }

    return preparedMeshesData;
  }, {});

  // Create zones
  const zoneMeshes = createMemo(() => {
    const zoneMeshes: { [zoneid: number]: THREE.Mesh } = {};
    for (const zoneId in props.zoneData) {
      const zoneData = props.zoneData[zoneId];
      const prep = prepMeshData()[zoneId];
      const mesh = createZoneMesh(zoneData.id, zoneData.mesh, prep, unwrap(generalSettings).colorKind);
      mesh.visible = false;

      zoneMeshes[zoneData.id] = mesh;
      console.log("Adding zone", zoneId)
      scene().add(mesh);
    }

    onCleanup(() => {
      setEntitySettings({});
      for (const zoneId in zoneMeshes) {
        console.log("Disposing zone", zoneId);
        const mesh = zoneMeshes[zoneId];
        scene().remove(mesh);
        cleanupNode(mesh);
      }
    });

    return zoneMeshes;
  }, {});

  // Adjust widescan updates to nearest ground point on the zone mesh in the Y-axis
  const adjustedEntityUpdates = createMemo(() => {
    const scanPoint = new THREE.Vector3();
    const rayStartPoint = new THREE.Vector3();
    const down = new THREE.Vector3(0, 1, 0);
    const rayResults: THREE.Intersection<THREE.Object3D<THREE.Object3DEventMap>>[] = [];
    let bestResult: THREE.Intersection<THREE.Object3D<THREE.Object3DEventMap>> | undefined = undefined;
    let bestDistance = Number.MAX_SAFE_INTEGER;

    // Enable multi hit for this purpose
    raycaster.firstHitOnly = false;

    const adjusted: ZoneEntityUpdates = {};
    for (const zoneId in props.entityUpdates) {
      const zoneMesh = zoneMeshes()[zoneId];
      if (!zoneMesh) {
        continue;
      }

      adjusted[zoneId] = {};

      for (const entityKey in props.entityUpdates[zoneId]) {
        const entity = props.entityUpdates[zoneId][entityKey];
        const adjustedEntity = adjusted[zoneId][entityKey] = {
          id: entity.id,
          firstName: entity.firstName,
          updates: new Array(entity.updates.length),
          levels: entity.levels,
        };
        const adjustedUpdates = adjustedEntity.updates;

        for (let i = 0; i < entity.updates.length; i++) {
          const update = entity.updates[i];
          if (update.kind !== EntityUpdateKind.Widescan) {
            adjustedUpdates[i] = update;
            continue;
          }

          scanPoint.set(update.pos.x, update.pos.y, update.pos.z);
          rayStartPoint.set(update.pos.x, update.pos.y - 100, update.pos.z);

          raycaster.set(rayStartPoint, down);
          raycaster.intersectObject(zoneMesh, false, rayResults);

          bestResult = undefined;
          bestDistance = Number.MAX_SAFE_INTEGER;
          for (const result of rayResults) {
            const dist = result.point.distanceTo(scanPoint);
            if (!bestResult || dist < bestDistance) {
              bestResult = result;
              bestDistance = dist;
            }
          }

          if (bestResult) {
            adjustedUpdates[i] = {
              ...update,
              pos: {
                ...update.pos,
                y: bestResult.point.y - 1,
              },
            };
          } else {
            // Did not find a new Y value for the update, so keep whatever it had originally
            adjustedUpdates[i] = update;
          }

          // Clear the result array again
          rayResults.length = 0;
        }
      }
    }

    raycaster.firstHitOnly = true;
    return adjusted;
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
  const despawnColor = new THREE.Color(0x55AA55);
  const outOfRangeColor = new THREE.Color(0xAAAA00);
  const clientColor = new THREE.Color(0x0000FF);
  const npcColor = new THREE.Color(0x00FF00);
  const widescanColor = new THREE.Color(0xE000DC);
  const geo = new THREE.CapsuleGeometry();

  // Setup animations for entities
  const mixers = createMemo(() => {
    if (!updatesSettings.show.animated) {
      return [];
    }

    const zoneId = getSelectedZone();
    let parsedUpdates = summarizedEntityUpdates();
    if (!parsedUpdates[zoneId]) {
      return [];
    }

    let mixers: THREE.AnimationMixer[] = [];

    const startTime = parsedUpdates[zoneId].firstTime;
    const endTime = parsedUpdates[zoneId].lastTime;
    const length = endTime - startTime;

    for (const entityKey in props.entityUpdates[zoneId]) {
      if (entitySettings[entityKey]?.hidden) {
        continue;
      }

      const updates = props.entityUpdates[zoneId][entityKey].updates;

      // Count how long the arrays needs to be.
      let count = 0;
      let prevPosUpdate: PositionUpdate | undefined = undefined;
      for (const update of updates) {
        if (update.kind == EntityUpdateKind.Position) {
          if (!prevPosUpdate) {
            // No previous position, so add a hidden frame just before this one.
            count++;
          }
          prevPosUpdate = update;
          count++;
        } else if (prevPosUpdate && (update.kind == EntityUpdateKind.OutOfRange || update.kind == EntityUpdateKind.Despawn)) {
          // Out of range
          prevPosUpdate = undefined;
          count++;
        }
      }

      if (count == 0) {
        continue;
      }
      if (prevPosUpdate) {
        count++; // Last hiding frame
      }

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
        positions.set([pos.x, pos.y - 1, pos.z], i * 3);
        i++;
      };

      prevPosUpdate = undefined;
      for (const update of updates) {
        if (update.kind == EntityUpdateKind.Position) {
          if (!prevPosUpdate) {
            // No previous position, so add a hidden frame just before this one.
            addFrame(update.pos, update.time - 1000, false);
          }
          // Add current position frame
          addFrame(update.pos, update.time, true);
          prevPosUpdate = update;
        } else if (prevPosUpdate && (update.kind == EntityUpdateKind.OutOfRange || update.kind == EntityUpdateKind.Despawn)) {
          addFrame(prevPosUpdate.pos, prevPosUpdate.time + 1000, false);
          prevPosUpdate = undefined;
        }
      }

      // Add final hide frame
      if (prevPosUpdate) {
        addFrame(prevPosUpdate.pos, prevPosUpdate.time + 1000, false);
      }

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
      scene().add(mesh);

      const mixer = new THREE.AnimationMixer(mesh);
      mixer.timeScale = 1;
      mixers.push(mixer);

      const clipAction = mixer.clipAction(clip);
      clipAction.play();
      mixer.update(0);
    }

    // Client mesh
    if (props.clientUpdates) {
      const updates = props.clientUpdates;

      // Count how long the arrays needs to be.
      let startIdx = binarySearchLower(updates, startTime, x => x.time);
      let endIdx = binarySearchLower(updates, endTime + 1, x => x.time);

      const count = endIdx - startIdx;

      const times = new Float32Array(count);
      const positions = new Float32Array(count * 3);

      for (let i = startIdx, j = 0; i < endIdx; i++, j++) {
        times[j] = (updates[i].time - startTime) / 1000;
        const pos = updates[i].pos;
        positions.set([pos.x, pos.y - 1, pos.z], j * 3);
      }

      const positionKF = new THREE.VectorKeyframeTrack(".position", times, positions);
      const clip = new THREE.AnimationClip("client", length / 1000, [positionKF]);

      const mat = new THREE.MeshToonMaterial({
        color: clientColor,
      });
      const mesh = new THREE.Mesh(geo, mat);
      scene().add(mesh);

      const mixer = new THREE.AnimationMixer(mesh);
      mixer.timeScale = 1;
      mixers.push(mixer);

      const clipAction = mixer.clipAction(clip);
      clipAction.play();
      mixer.update(0);
    }

    onCleanup(() => {
      for (const mixer of mixers) {
        const mesh = mixer.getRoot() as THREE.Mesh;
        cleanupNode(mesh);
        scene().remove(mesh);
      }
    });
    return mixers;
  });

  // Setup meshes for entities
  const mat = new THREE.MeshToonMaterial();
  const discreteEntityMeshes = createMemo(() => {
    let discreteEntityMeshes: ByZone<{ [entityKey: string]: THREE.InstancedMesh; }> = {};

    for (const zoneId in adjustedEntityUpdates()) {
      const entities = (discreteEntityMeshes[zoneId] = discreteEntityMeshes[zoneId] || {});

      for (const entityKey in adjustedEntityUpdates()[zoneId]) {
        const updates = adjustedEntityUpdates()[zoneId][entityKey].updates;
        const mesh = new THREE.InstancedMesh(geo, mat, updates.length);

        scene().add(mesh);
        entities[entityKey] = mesh;
      }
    }

    onCleanup(() => {
      for (const zoneId in discreteEntityMeshes) {
        for (const entityKey in discreteEntityMeshes[zoneId]) {
          const mesh = discreteEntityMeshes[zoneId][entityKey];
          scene().remove(mesh);
          cleanupNode(mesh);
        }
      }
    });

    return discreteEntityMeshes;
  });

  // Show entities at different points in time
  createEffect(() => {
    if (!props.entityUpdates || !updatesSettings.show.discrete) {
      return;
    }

    const zoneId = getSelectedZone();
    const meshes = discreteEntityMeshes()[zoneId];
    let obj = new THREE.Object3D();
    const hideWidescan = !updatesSettings.show.widescan;
    const hideRendered = !updatesSettings.show.rendered;
    const onlyLatest = updatesSettings.show.lastOnly;
    for (const entityKey in adjustedEntityUpdates()[zoneId]) {
      if (entitySettings[entityKey]?.hidden) {
        continue;
      }

      const updates = adjustedEntityUpdates()[zoneId][entityKey].updates;
      const mesh = meshes[entityKey];
      let showCount = 0;

      if (onlyLatest) {
        // Only show latest position

        const summarized = summarizedEntityUpdates()[zoneId];
        const firstZoneTime = summarized.firstTime;

        // Skip until last visible update
        const endTime = isPlaying() ? firstZoneTime + getPlayTime() * 1000 : getDiscreteUpperTime();

        let idx = binarySearchLower(updates, endTime, x => x.time);

        const endTimeCutoff = endTime - 90000;
        const cutoffTime = endTimeCutoff > getDiscreteLowerTime() ? endTimeCutoff : getDiscreteLowerTime();

        while (idx >= 0 && updates[idx].time >= cutoffTime) {
          const update = updates[idx];
          if (update.kind !== EntityUpdateKind.Position && update.kind !== EntityUpdateKind.Widescan) {
            // Only add positional updates
            idx--;
            continue;
          }

          if (hideWidescan && update.kind == EntityUpdateKind.Widescan) {
            // Widescan is hidden
            idx--;
            continue;
          }

          if (hideRendered && update.kind == EntityUpdateKind.Position) {
            // Entity updates is hidden
            idx--;
            continue;
          }

          obj.position.set(update.pos.x, update.pos.y, update.pos.z);
          obj.updateMatrix();
          mesh.setMatrixAt(showCount, obj.matrix);
          if (update.kind == EntityUpdateKind.Position) {
            mesh.setColorAt(showCount, mobColor);
          } else {
            mesh.setColorAt(showCount, widescanColor);
          }
          showCount = 1;
          break;
        }

      } else {
        // Show all positions

        // Add from first visible update until last visible update
        for (
          let idx = binarySearchLower(updates, getDiscreteLowerTime(), x => x.time);
          idx < updates.length && updates[idx].time <= getDiscreteUpperTime();
          idx++
        ) {
          const update = updates[idx];
          if (hideWidescan && update.kind == EntityUpdateKind.Widescan) {
            // Widescan is hidden
            continue;
          }

          if (hideRendered && (update.kind == EntityUpdateKind.Position || update.kind == EntityUpdateKind.OutOfRange || update.kind == EntityUpdateKind.Despawn)) {
            // Entity updates is hidden
            continue;
          }

          let pos = "pos" in update ? update.pos : undefined;
          if (!pos) {
            if (!hideRendered) {
              continue;
            }

            const prevUpdate = updates[idx - 1];
            pos = "pos" in prevUpdate ? prevUpdate.pos : undefined;
            if (!pos) {
              continue;
            }
          }

          obj.position.set(pos.x, pos.y, pos.z);
          obj.updateMatrix();
          mesh.setMatrixAt(showCount, obj.matrix);
          if (update.kind == EntityUpdateKind.Position) {
            mesh.setColorAt(showCount, mobColor);
          } else if (update.kind == EntityUpdateKind.Widescan) {
            mesh.setColorAt(showCount, widescanColor);
          } else if (update.kind == EntityUpdateKind.OutOfRange) {
            mesh.setColorAt(showCount, outOfRangeColor);
          } else if (update.kind == EntityUpdateKind.Despawn) {
            mesh.setColorAt(showCount, despawnColor);
          }
          showCount++;
        }
      }

      mesh.count = showCount;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    }
  });

  // Show/hide zone meshes and associated entities
  createEffect(() => {
    const parsedUpdates = summarizedEntityUpdates();
    for (const zoneId in zoneMeshes()) {
      const zoneIsVisible = parseInt(zoneId) == getSelectedZone();
      zoneMeshes()[zoneId].visible = zoneIsVisible;
      if (!props.entityUpdates) {
        continue;
      }

      // Show/hide entities from other zones
      for (const entityKey in props.entityUpdates[zoneId]) {
        setEntitySettings(entityKey, { hidden: !zoneIsVisible || (entityKey != parsedUpdates[zoneId].maxUpdatesKey) });
      }
    }
  });

  // Show/hide discrete entity meshes
  createEffect(() => {
    for (const entityKey in entitySettings) {
      const entityId = parseInt(entityKey.split("-")[1]);
      const zoneId = (entityId >> 12) & 0x01ff;
      const mesh = discreteEntityMeshes()?.[zoneId]?.[entityKey];
      if (mesh) {
        mesh.visible = updatesSettings.show.discrete && !entitySettings[entityKey]?.hidden;
      }
    }
  });

  let canvasElement: HTMLCanvasElement;
  let labelRendererElement: HTMLDivElement;
  let coordLabelRef: HTMLDivElement;

  let hasMouseMovedSinceLast = false;

  const [getNeedsResize, setNeedsResize] = createSignal<boolean>(true);
  function resizeCanvas() {
    const parentRect = canvasElement.parentElement!.getBoundingClientRect();
    canvasElement.width = parentRect.width;
    canvasElement.height = parentRect.height;
    setNeedsResize(true);
  }

  const [controls, setControls] = createSignal<MapControls>();
  const [renderer, setRenderer] = createSignal<THREE.WebGLRenderer>()

  onMount(() => {
    window.addEventListener("resize", resizeCanvas);

    canvasElement.addEventListener("mousemove", event => {
      const canvas = canvasElement;
      cameraMouse.x = (2 * event.offsetX) / canvas.offsetWidth - 1;
      cameraMouse.y = (-2 * event.offsetY) / canvas.offsetHeight + 1;
      screenMouse.x = event.offsetX;
      screenMouse.y = event.offsetY;
      hasMouseMovedSinceLast = true;
    });

    canvasElement.addEventListener("mouseout", event => {
      coordLabelRef.style.display = "none";
    });

    // Area details clicking
    canvasElement.addEventListener("click", event => {
      if (!generalSettings.showAreaManager || !getShowAreaDetails() || !event.ctrlKey) {
        return;
      }

      const hits = castRayOntoMesh();
      if (!hits) {
        return;
      }
      const hit = hits[0];

      setShowAreaDetails(true);

      // Add a new polygon if none is selected
      if (getSelectedAreaIdx() == undefined) {
        setAreas(areas.length, { polygon: [] });
        setSelectedAreaIdx(areas.length - 1);
      }

      const area = areas[getSelectedAreaIdx()];
      const polygon = area.polygon;

      const newVertex = { x: Math.round(hit.x), z: Math.round(-hit.z) };

      let setPoints: SetStoreFunction<Point[]>;
      let points: Point[];
      if (getSelectedSubPolygonIdx() !== undefined) {
        setPoints = setAreas.bind(null, getSelectedAreaIdx(), "holes", getSelectedSubPolygonIdx());
        points = area.holes?.[getSelectedSubPolygonIdx()];
      } else {
        setPoints = setAreas.bind(null, getSelectedAreaIdx(), "polygon");
        points = polygon;
      }

      if (getSelectedVertexIdx() !== undefined) {
        // If there's a selected vertex, add the new vertex right after it
        setPoints(produce<Point[]>(vertices => {
          vertices.splice(getSelectedVertexIdx() + 1, 0, newVertex);
          return vertices;
        }));
        setSelectedVertexIdx(getSelectedVertexIdx() + 1);
      } else {
        // Else just add the new vertex at the end
        setPoints(points.length, newVertex);
        setSelectedVertexIdx(points.length - 1);
      }
    });

    // Ray clicking
    canvasElement.addEventListener("click", event => {
      if (!generalSettings.showRayTesting || getShowAreaDetails() || !event.ctrlKey && !event.shiftKey) {
        return;
      }

      raycaster.firstHitOnly = false;
      const hits = castRayOntoMesh();
      raycaster.firstHitOnly = true;

      if (!hits || hits.length == 0) {
        return;
      }

      const hitsData = getHitData(zoneMeshes()[getSelectedZone()], props.zoneData[getSelectedZone()].mesh, prepMeshData()[getSelectedZone()], hits);

      for (let i = 0; i < hitsData.length; i++) {
        const hitData = hitsData[i];
        // console.log(`======================= Hit ${i} ======================= `)
        // console.log("Hit", hitData.hit);
        // console.log("Block", hitData.block);
        // console.log("Placement", hitData.placement);
        // console.log("Material", hitData.material);
      }

      const firstHit = hits[0];
      const markerPos = new THREE.Vector3(roundDecimals(firstHit.x, 3), roundDecimals(-firstHit.y - 2.25, 3), roundDecimals(-firstHit.z, 3));

      if (event.ctrlKey) {
        setStartPos(markerPos);
      } else if (event.shiftKey) {
        setEndPos(markerPos);
      }
    });

    setControls(addMapControls(camera(), canvasElement));

    const renderer = new THREE.WebGLRenderer({ canvas: canvasElement, antialias: true, alpha: true });
    setRenderer(renderer)
    const labelRenderer = new CSS2DRenderer({ element: labelRendererElement });

    renderer.setAnimationLoop(() => animate(renderer, labelRenderer));
  });

  onCleanup(() => {
    window.removeEventListener("resize", resizeCanvas);
    cleanupNode(scene());
    if (controls()) {
      controls().dispose();
      setControls(undefined);
    }
    scene().clear();
    camera().clear();
  });

  const clock = new THREE.Clock();
  const stats = new Stats();
  stats.dom.style.position = "absolute";

  const cameraMouse = new THREE.Vector2(1, 1);
  const screenMouse = new THREE.Vector2(1, 1);

  function updatePosLabel() {
    const hits = castRayOntoMesh();
    if (hits) {
      const hitsData = getHitData(zoneMeshes()[getSelectedZone()], props.zoneData[getSelectedZone()].mesh, prepMeshData()[getSelectedZone()], hits);
      const hitData = hitsData[0];
      setTargetInfo({
        x: hitData.hit.x,
        y: hitData.hit.y * -1,
        z: hitData.hit.z * -1,
        mapId: getMapId(hitData.placement),
        material: hitData.material,
        cellIdx: hitData.cellIdx,
        cellEntryIdx: hitData.entryIdx,
        block: hitData.block,
        placement: hitData.placement,
      });

      coordLabelRef.textContent = `${hitData.hit.x.toFixed(1)}, ${(hitData.hit.y * -1).toFixed(1)}, ${(hitData.hit.z * -1).toFixed(1)} `;
      coordLabelRef.style.left = `${screenMouse.x + 20}px`;
      coordLabelRef.style.top = `${screenMouse.y - 20}px`;
      coordLabelRef.style.display = "block";
    } else {
      coordLabelRef.style.display = "none";
      setTargetInfo(undefined);
    }
  }

  function castRayOntoMesh(): RayHit[] | undefined {
    raycaster.setFromCamera(cameraMouse, camera());
    const intersections = raycaster.intersectObjects([zoneMeshes()[getSelectedZone()]], false);
    if (intersections.length == 0) {
      return;
    }

    let result: RayHit[] = [];
    for (const int of intersections) {
      const p = int.point;
      const face = int.face ? { a: int.face.a, b: int.face.b, c: int.face.c } : undefined;
      result.push({
        x: p.x,
        y: p.y,
        z: p.z,
        object: int.object,
        index: int.index!,
        faceIndex: int.faceIndex!,
        face,
      });
    }
    return result;
  }

  function getFirstYForPoint(
    point: Point,
    zoneMesh: THREE.Mesh,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
  ): number | undefined {
    origin.x = point.x;
    origin.z = -point.z;
    raycaster.set(origin, direction)
    const intersections = raycaster.intersectObject(zoneMesh, false);
    if (intersections.length == 0) {
      return undefined;
    }
    return intersections[0].point.y;
  }

  function updateYRangeForPoint(
    range: { yMin: number, yMax: number },
    point: Point,
    zoneMesh: THREE.Mesh,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
  ) {
    origin.x = point.x;
    origin.z = -point.z;
    raycaster.set(origin, direction)
    const intersections = raycaster.intersectObject(zoneMesh, false);
    for (const intersection of intersections) {
      const y = intersection.point.y;
      if (y < range.yMin) {
        range.yMin = y;
      }
      if (y > range.yMax) {
        range.yMax = y;
      }
    }
  }

  function animate(renderer: THREE.WebGLRenderer, labelRenderer: CSS2DRenderer) {
    stats.update();

    const delta = clock.getDelta();
    controls()?.update(delta);

    if (getNeedsResize()) {
      const canvas = canvasElement;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      renderer.setSize(width, height, false);
      labelRenderer.setSize(width, height);
      adjustCameraAspect(camera(), canvasElement);
      setNeedsResize(false);
    }

    const newDiscrete = getNewDiscrete();
    if (newDiscrete) {
      setDiscreteLowerTime(newDiscrete[0]);
      setDiscreteUpperTime(newDiscrete[1])
      setNewDiscrete(undefined);
    }

    if (hasMouseMovedSinceLast) {
      hasMouseMovedSinceLast = false;
      updatePosLabel();
    }

    if (isPlaying()) {
      if (!isSeeking()) {
        const playTime = getPlayTime();
        setPlayTime((playTime + delta * getTimeScale()) % getPlayTimeMax());
      }
    }

    renderer.render(scene(), camera());
    labelRenderer.render(scene(), camera());
  }

  createEffect(() => {
    for (const mixer of mixers()) {
      mixer.setTime(getPlayTime());
    }
  });

  const currentEntityUpdates = createMemo(() => {
    const key = getSelectedZone();
    if (key !== undefined && summarizedEntityUpdates()) {
      const updates = summarizedEntityUpdates()[key];
      if (updates) {
        setDiscreteLowerTime(updates.firstTime);
        setDiscreteUpperTime(updates.lastTime);
        setPlayTime(0);
        return updates;
      }
    }

    return {} as NormalizedEntityUpdates;
  });

  const [areas, setAreas] = createStore<Area[]>([]);
  const [getSelectedAreaIdx, setSelectedAreaIdx] = createSignal<number | undefined>();
  const [getSelectedSubPolygonIdx, setSelectedSubPolygonIdx] = createSignal<number | undefined>();
  const [getSelectedVertexIdx, setSelectedVertexIdx] = createSignal<number | undefined>();
  const [getShowAreaDetails, setShowAreaDetails] = createSignal<boolean>(false);

  const areaMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.5,
    color: 0xFCAA58,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const selectedAreaMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.6,
    color: 0xFCF63C,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Draw areas
  createEffect(() => {
    const zoneMesh = zoneMeshes()[getSelectedZone()];
    if (!zoneMesh) {
      return;
    }

    let meshes: THREE.Mesh[] = [];
    let elements: Element[] = [];
    let labels: CSS2DObject[] = [];

    let origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, -1, 0);

    for (let i = 0; i < areas.length; i++) {
      const area = areas[i];
      if (area.hidden || area.polygon.length < 3) {
        continue;
      }

      // Create the polygon shape
      const shape = new THREE.Shape(area.polygon.map(p => new THREE.Vector2(p.x, p.z)));
      if (area.holes?.length > 0) {
        for (const hole of area.holes) {
          if (hole.length < 3) {
            continue;
          }
          shape.holes.push(new THREE.Shape(hole.map(p => new THREE.Vector2(p.x, p.z))));
        }
      }


      // Determine where the area should be displayed on the Y-axis
      const areaYRange = deriveAreaYRange(area);

      let visualYRange = { yMax: -areaYRange.yMin, yMin: -areaYRange.yMax };
      if (areaYRange.unlimited) {
        visualYRange.yMin = 1000;
        visualYRange.yMax = -1000;
        origin.y = -areaYRange.yMin;

        for (const p of area.polygon) {
          updateYRangeForPoint(visualYRange, p, zoneMesh, origin, direction);
        }
        if (area.holes) {
          for (const hole of area.holes) {
            for (const p of hole) {
              updateYRangeForPoint(visualYRange, p, zoneMesh, origin, direction);
            }
          }
        }

        if (visualYRange.yMin == 1000) {
          // No intersections, so lower it to some default min max
          visualYRange.yMin = -100;
          visualYRange.yMax = 100;
        } else {
          visualYRange.yMin -= 10;
          visualYRange.yMax += 10;
        }
      }

      const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.abs(visualYRange.yMax - visualYRange.yMin), bevelEnabled: false });
      geo.rotateX(Math.PI / 2);
      geo.translate(0, -visualYRange.yMin, 0);
      geo.computeBoundingBox();

      const mat = getSelectedAreaIdx() == i ? selectedAreaMat : areaMat;
      const areaMesh = new THREE.Mesh(geo, mat);

      areaMesh.layers.enableAll();

      if (getSelectedAreaIdx() !== i) {
        // Add area labels for non-selected areas
        const div = document.createElement("div");
        div.textContent = `Area ${i + 1} `;
        div.className = "vertex-label noselect pointer-events-auto cursor-pointer text-sm font-mono";
        div.onclick = () => {
          setSelectedAreaIdx(i);
        };
        elements.push(div);

        const label = new CSS2DObject(div);
        const box = geo.boundingBox;

        label.position.set(
          box.min.x + (box.max.x - box.min.x) / 2,
          box.min.y + (box.max.y - box.min.y) / 2 - 10,
          box.min.z + (box.max.z - box.min.z) / 2,
        );

        // If possible, place the area label according to the y position of the underlying mesh
        origin.y = -areaYRange.yMin;
        const y = getFirstYForPoint({ x: label.position.x, z: label.position.z }, zoneMesh, origin, direction);
        if (y !== undefined) {
          label.position.y = -y - 10;
        }

        areaMesh.add(label);
        label.layers.set(0);
        labels.push(label);
      }

      meshes.push(areaMesh);
      scene().add(areaMesh);
    }

    onCleanup(() => {
      for (const label of labels) {
        cleanupNode(label);
      }
      for (const el of elements) {
        el.remove();
      }
      for (const mesh of meshes) {
        cleanupNode(mesh);
        scene().remove(mesh);
      }
    });
  });

  // Draw current area handles
  createEffect(() => {
    if (getSelectedAreaIdx() === undefined) {
      return;
    }

    let meshes: THREE.Mesh[] = [];
    let elements: Element[] = [];
    let labels: CSS2DObject[] = [];

    const area = areas[getSelectedAreaIdx()];
    if (area.hidden) {
      return;
    }

    const zoneMesh = zoneMeshes()[getSelectedZone()];
    if (!zoneMesh) {
      return;
    }

    const areaYRange = deriveAreaYRange(area);
    let origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, -1, 0);
    origin.y = -areaYRange.yMin;

    // Default Y to place the handles at, if they do not intersect the zone mesh
    let defaultY = 0;
    if (!areaYRange.unlimited) {
      if (areaYRange.yMax > 1000) {
        defaultY = areaYRange.yMin;
      } else if (areaYRange.yMin < -1000) {
        defaultY = areaYRange.yMax;
      } else {
        defaultY = (areaYRange.yMax - areaYRange.yMin) / 2 + areaYRange.yMin;
      }
    }

    const points = getSelectedSubPolygonIdx() !== undefined ? area.holes[getSelectedSubPolygonIdx()] : area.polygon;

    // Handles
    for (let i = 0; i < points.length; i++) {
      const pos = points[i];
      const geo = new THREE.SphereGeometry(1);
      const mat = new THREE.MeshBasicMaterial({ color: 0xFF7F00 });
      const mesh = new THREE.Mesh(geo, mat);

      const y = getFirstYForPoint({ x: pos.x, z: pos.z }, zoneMesh, origin, direction) ?? -defaultY;
      mesh.position.set(pos.x, -y, pos.z);

      mesh.layers.enableAll();

      const div = document.createElement("div");
      div.textContent = String.fromCharCode("A".charCodeAt(0) + i);
      div.className = "vertex-label noselect pointer-events-auto cursor-pointer text-sm font-mono";
      if (getSelectedVertexIdx() == i) {
        div.className += " font-bold bg-blue-800 underline";
      } else {
        div.onclick = () => {
          setSelectedVertexIdx(i);
        };
      }
      elements.push(div);

      const label = new CSS2DObject(div);
      label.position.set(0, -5, 0);
      mesh.add(label);
      label.layers.set(0);
      labels.push(label);

      meshes.push(mesh);
      scene().add(mesh);
    }

    onCleanup(() => {
      for (const label of labels) {
        cleanupNode(label);
      }
      for (const el of elements) {
        el.remove();
      }
      for (const mesh of meshes) {
        cleanupNode(mesh);
        scene().remove(mesh);
      }
    });
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

  const [getStartPos, setStartPos] = createSignal<THREE.Vector3 | undefined>();
  const [getEndPos, setEndPos] = createSignal<THREE.Vector3 | undefined>();

  const [getTargetInfo, setTargetInfo] = createSignal<TargetInfo | undefined>();

  // Start marker mesh
  createEffect(on(getStartPos, (pos?: THREE.Vector3, _prevPos?: THREE.Vector3, prevMesh?: THREE.Mesh) => {
    if (!pos) {
      if (prevMesh) {
        onCleanup(() => {
          scene().remove(prevMesh);
          cleanupNode(prevMesh);
        });
      }
      return;
    }

    let mesh = prevMesh;
    if (!mesh) {
      const geo = new THREE.SphereGeometry(0.5);
      const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(0, 1, 0),
      });
      mesh = new THREE.Mesh(geo, mat);
      mesh.visible = true;
      scene().add(mesh);
    }

    mesh.position.copy(pos);

    return mesh;
  }));

  // End marker mesh
  createEffect(on(getEndPos, (pos?: THREE.Vector3, _prevPos?: THREE.Vector3, prevMesh?: THREE.Mesh) => {
    if (!pos) {
      if (prevMesh) {
        onCleanup(() => {
          scene().remove(prevMesh);
          cleanupNode(prevMesh);
        });
      }
      return;
    }

    let mesh = prevMesh;
    if (!mesh) {
      const geo = new THREE.SphereGeometry(0.5);
      const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(0, 0, 1),
      });
      mesh = new THREE.Mesh(geo, mat);
      scene().add(mesh);
    }

    mesh.position.copy(pos);

    return mesh;
  }));

  // Line between markers
  createEffect(on([getStartPos, getEndPos], (
    value: [THREE.Vector3 | undefined, THREE.Vector3 | undefined],
    _prevValue?: [THREE.Vector3 | undefined, THREE.Vector3 | undefined],
    prevLine?: THREE.Line) => {
    if (!value[0] || !value[1]) {
      if (prevLine) {
        onCleanup(() => {
          scene().remove(prevLine);
          cleanupNode(prevLine);
        });
      }
      return;
    }

    const mesh = zoneMeshes()[getSelectedZone()];
    if (!mesh) {
      return;
    }

    let line = prevLine;
    if (!line) {
      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array(2 * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const mat = new THREE.LineBasicMaterial({
        color: new THREE.Color(1, 0, 0),
        linewidth: 1,
        depthTest: true,
      });
      line = new THREE.Line(geo, mat);
      scene().add(line);
    }

    const positions = line.geometry.attributes.position;
    positions.array.set(value[0].toArray(), 0);
    positions.array.set(value[1].toArray(), 3);
    positions.needsUpdate = true;

    // Recompute box and sphere to ensure the new position doesn't get culled from the camera
    line.geometry.computeBoundingBox();
    line.geometry.computeBoundingSphere();

    markLineCollisions(mesh, props.zoneData[getSelectedZone()].mesh, prepMeshData()![getSelectedZone()], value[0], value[1]);

    return line;
  }));

  const [getEntityPaths, setEntityPaths] = createSignal<EntityPathMap>()

  const focusVisible = () => {
    const zoneId = getSelectedZone();
    const meshes = discreteEntityMeshes()[zoneId];
    const entityPaths = getEntityPaths() ?? {};

    fitCameraToContents(camera(), controls(), fn => {
      if (updatesSettings.show.discrete) {
        for (const entityKey in meshes) {
          if (!entitySettings[entityKey]?.hidden) {
            fn(meshes[entityKey])
          }
        }
      }

      if (updatesSettings.show.paths) {
        for (const entityKey in entityPaths) {
          if (!entitySettings[entityKey]?.hidden) {
            const paths = entityPaths[entityKey]
            if (paths.showLines) {
              fn(paths.lines)
            }
            if (paths.showPoints) {
              fn(paths.pointMesh)
            }
          }
        }
      }
    });
  };

  createEffect(on(() => generalSettings.colorKind, (colorKind) => {
    const meshes = zoneMeshes();
    const prep = prepMeshData();
    for (const zoneId of Object.keys(meshes)) {
      const mesh = meshes[zoneId];
      colorMesh(mesh, prep[zoneId]!, colorKind);
    }
  }));

  const toggleButton = (text: string, setter: (b: boolean) => any, getter: () => boolean) => {
    return <label class="inline-flex items-center cursor-pointer select-none"
      onClick={(e) => {
        setter(!getter())
        e.preventDefault();
      }}>
      <input type="checkbox" class="sr-only peer" checked={getter()} />
      <div class="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600 dark:peer-checked:bg-blue-600"></div>
      <span class="ms-1 text-sm font-medium">{text}</span>
    </label>
  }

  const settingsMenu =
    <div class="pointer-events-auto cursor-pointer bg-black bg-opacity-80 p-2 rounded-tr text-sm flex flex-col gap-2">
      <div class="flex flex-row items-baseline">
        <label for="color-select">Coloring:</label>
        <select
          id="color-select"
          value={generalSettings.colorKind}
          onChange={(ev) => {
            generalSettings.colorKind = parseInt(ev.target.value);
          }}
        >
          <option value={ColorKind.None}>None</option>
          <option value={ColorKind.Barriers}>Barriers</option>
          <option value={ColorKind.Materials}>Materials</option>
          <option value={ColorKind.Maps}>Map</option>
          <option value={ColorKind.IsRoofed}>Roofed</option>
        </select>
      </div>

      {toggleButton("Node Manager", (v) => {
        generalSettings.showNodeManager = v;
      }, () => generalSettings.showNodeManager)}

      {toggleButton("Area Manager", (v) => {
        generalSettings.showAreaManager = v;
      }, () => generalSettings.showAreaManager)}

      {toggleButton("Info Box", (v) => {
        generalSettings.showInfoBox = v;
      }, () => generalSettings.showInfoBox)}

      {toggleButton("Ray Testing", (v) => {
        generalSettings.showRayTesting = v;
      }, () => generalSettings.showRayTesting)}

      <button onClick={() => {
        for (const key in defaultGeneralSettings) {
          generalSettings[key] = defaultGeneralSettings[key];
        }
        localStorage.removeItem(generalSettingsKey);
      }}>Reset settings</button>

      <button onClick={() => setMenuPopup(MenuPopup.None)}>Close settings</button>
    </div>;

  const helpMenu =
    <div class="pointer-events-auto cursor-pointer bg-black bg-opacity-80 p-2 rounded-tr text-sm" onClick={() => setMenuPopup(MenuPopup.None)}>
      Click this to hide it again.
      <ul class="list-disc list-inside">
        <li>
          <b>Move/rotate camera:</b> Left/right-click and drag
        </li>
        <li>
          <b>Area editing:</b> Most of the contents of the Area Manager can be clicked/edited.
        </li>
        <li>
          <b>Add a new area node:</b>{" "}
          With the Area Manager expanded: CTRL + left-click. If an existing node is selected, the new one will be inserted after it. While having a node selected, you can also press
          SHIFT + N to create a copy.
        </li>
        <li>
          <b>Select a node:</b> Select a node by either clicking it in the world, or on it in the Area Manager.
        </li>
        <li>
          <b>Move a node:</b>{" "}
          Select the node, then hold SHIFT + arrow keys to move it along the X- and/or Z-axis. Hold CTRL to move it faster. The coordinates can also be
          edited directly in the Area Manager.
        </li>
        <li>
          <b>Area to Lua:</b> Click the copy button next to an area in the Area Manager to get Lua code defining it into your clipboard.
        </li>
        <li>
          <b>Lua to areas:</b> Paste text containing Lua code that defines the areas (i.e. a zone Setup.lua file)
        </li>
      </ul>
    </div>;

  return (
    <div classList={{ "zone_model_layout": !!props.entityUpdates }}>

      <div class="relative" style={{ height: "70vh" }}>
        <canvas tabIndex={0} class="block w-full h-full outline-none" ref={canvasElement}>
        </canvas>

        <div
          class="absolute hidden p-1 text-white bg-black pointer-events-none rounded font-mono opacity-70 text-sm noselect"
          ref={coordLabelRef}
        >
        </div>
        <div
          class="absolute top-0 pointer-events-none"
          ref={labelRendererElement}
        >
        </div>

        <SelectionBox
          controls={controls()}
          canvasElement={canvasElement}
          outputSelectionRect={res => {
            setSelectionBox(res);
          }}
        >
        </SelectionBox>

        <Show when={updatesSettings.show.paths}>
          <EntityPaths
            scene={scene()}
            renderer={renderer()}
            adjustedEntityUpdates={adjustedEntityUpdates()[getSelectedZone()]}
            pathKinds={updatesSettings.show.pathKinds}
            entitySettings={entitySettings}
            startTime={getDiscreteLowerTime()}
            endTime={getDiscreteUpperTime()}
            getEntityPaths={getEntityPaths}
            setEntityPaths={setEntityPaths}
          >
          </EntityPaths>
        </Show>

        {/* Node Manager */}
        <Show when={generalSettings.showNodeManager}>
          <PathNodes
            scene={scene()}
            camera={camera()}
            canvasElement={canvasElement}
            selectionBox={getSelectionBox()}
            zoneMesh={zoneMeshes()[getSelectedZone()]}
            zoneId={getSelectedZone()}
          >
          </PathNodes>
        </Show>

        {/* Area Manager */}
        <Show when={generalSettings.showAreaManager}>
          <AreaMenu
            showDetails={getShowAreaDetails()}
            setShowDetails={setShowAreaDetails}
            areas={areas}
            setAreas={setAreas}
            selectedAreaIdx={getSelectedAreaIdx()}
            setSelectedAreaIdx={setSelectedAreaIdx}
            selectedSubPolygonIdx={getSelectedSubPolygonIdx()}
            setSelectedSubPolygonIdx={setSelectedSubPolygonIdx}
            selectedVertexIdx={getSelectedVertexIdx()}
            setSelectedVertexIdx={setSelectedVertexIdx}
          >
          </AreaMenu>
        </Show>

        {/* Info box */}
        <Show when={generalSettings.showInfoBox}>
          <ZoneInfoBox targetInfo={getTargetInfo()}></ZoneInfoBox>
        </Show>

        {/* Ray testing */}
        <Show when={generalSettings.showRayTesting}>
          <ZoneRayTestingBox
            getStartPos={getStartPos}
            setStartPos={setStartPos}
            getEndPos={getEndPos}
            setEndPos={setEndPos}
          ></ZoneRayTestingBox>
        </Show>

        {/* Performance stats */}
        <Show when={getMenuPopup() == MenuPopup.Settings}>
          <div class="absolute top-0 left-0 flex flex-row w-full">
            {import.meta.env.DEV ? stats.dom : undefined}
          </div>
        </Show>

        {/* Settings and help menu */}
        <div class="absolute bottom-0 left-0 pointer-events-none flex flex-row" style={{ width: "40%" }}>
          <Switch>
            <Match when={getMenuPopup() == MenuPopup.None}>
              <div class="pointer-events-auto cursor-pointer p-1" onClick={() => setMenuPopup(MenuPopup.Settings)}>
                <IoSettings size={20} title="Settings"></IoSettings>
              </div>
              <div class="pointer-events-auto cursor-pointer p-1" onClick={() => setMenuPopup(MenuPopup.Help)}>
                <IoHelpCircle size={20} title="Mouse and keyboard help"></IoHelpCircle>
              </div>
            </Match>
            <Match when={getMenuPopup() == MenuPopup.Settings}>{settingsMenu}</Match>
            <Match when={getMenuPopup() == MenuPopup.Help}>{helpMenu}</Match>
          </Switch>
        </div>
      </div>

      <Show when={props.entityUpdates}>
        {/* Table of entities in packets */}
        <div style={{ "max-height": "70vh", "min-width": "70ch" }}>
          <Table
            inputRows={currentEntityUpdates().entityRows ?? []}
            columns={[
              { name: "Name", key: "name" },
              { name: "ID", key: "id" },
              { name: "Index", key: "index" },
              { name: "Levels", key: "levels" },
              { name: "Count", key: "updateCount", defaultSortAsc: false },
            ]}
            defaultSortColumn="index"
            defaultSortAsc={true}
            additionalColumns={[
              {
                name: "Visible",
                content: v => (
                  <input
                    type="checkbox"
                    checked={!entitySettings[v.entityKey]?.hidden}
                  />
                ),
                onClick: (filteredRows) => {
                  const anyChecked = filteredRows.find(r => !entitySettings[r.entityKey]?.hidden);
                  const newValue = !!anyChecked;
                  batch(() => filteredRows.forEach(v => setEntitySettings(v.entityKey, { hidden: newValue })))
                }
              },
            ]}
            onRowClick={v => {
              setEntitySettings(v.entityKey, {
                hidden: !entitySettings[v.entityKey]?.hidden,
              });
            }}
            headerElements={[
              [
                zoneSelector,
                (_rows, filterFns, setFilterFns) => {
                  const isEnabled = "static" in filterFns
                  return <div class="flex m-auto gap-1 cursor-pointer">
                    <label for="static-filter">Static only</label>
                    <input
                      id="static-filter"
                      type="checkbox"
                      checked={isEnabled}
                      onInput={() => {
                        if (isEnabled) {
                          // Remove filter
                          setFilterFns(produce(fs => {
                            delete fs["static"];
                          }));
                        } else {
                          // Add filter
                          setFilterFns(produce(fs => {
                            fs["static"] = (r: EntityRow): boolean => {
                              const index = parseInt(r.index);
                              return index < 0x400;
                            };
                          }));
                        }
                      }} />
                  </div>
                },
              ],
              [
                <button onClick={focusVisible}>Focus visible</button>,
                rows => (
                  <button onClick={() => {
                    batch(() => rows.forEach(v => setEntitySettings(v.entityKey, { hidden: false })))
                  }}>Show filtered</button>
                ),
                rows => (
                  <button onClick={() => {
                    batch(() => rows.forEach(v => setEntitySettings(v.entityKey, { hidden: true })))
                  }}>Hide filtered</button>
                ),
              ]
            ]}
          >
          </Table>
        </div>

        {/* Entity controls below the viewing area */}
        <Show
          fallback={zoneSelector}
          when={getSelectedZone() in summarizedEntityUpdates()}
        >
          <div class="flex flex-col gap-3 my-2 col-span-2">
            <div class="flex flex-row">
              <div class="m-auto h-full px-1 font-bold" style={{ "min-width": "6rem" }}>
                Discrete:
              </div>
              <div class="px-1 m-auto h-full">
                <button style={{ "min-width": "5rem" }} onClick={() => updatesSettings.show.discrete = !updatesSettings.show.discrete}>
                  {updatesSettings.show.discrete ? "Hide" : "Show"}
                </button>
              </div>
              <div class="flex-grow">
                <RangeInput
                  min={currentEntityUpdates().firstTime}
                  max={currentEntityUpdates().lastTime}
                  lower={getNewDiscrete()?.[0] ?? getDiscreteLowerTime()}
                  upper={getNewDiscrete()?.[1] ?? getDiscreteUpperTime()}
                  inputKind="timestamp"
                  onChange={(lower, upper) => {
                    setNewDiscrete([lower, upper]);
                  }}
                  disabled={!updatesSettings.show.discrete}
                >
                </RangeInput>
              </div>
            </div>

            <div class="flex flex-row">
              <div class="m-auto h-full px-1 font-bold" style={{ "min-width": "6rem" }}>
                Animated:
              </div>
              <div class="m-auto h-full px-1">
                <button style={{ "min-width": "5rem" }} onClick={() => updatesSettings.show.animated = !updatesSettings.show.animated}>
                  {updatesSettings.show.animated ? "Hide" : "Show"}
                </button>
              </div>
              <div class="m-auto h-full px-1">
                <button style={{ "min-width": "5rem" }} onClick={() => setIsPlaying(!isPlaying())}>
                  {isPlaying() ? "Pause" : "Play"}
                </button>
              </div>
              <div class="m-auto relative">
                <input
                  type="number"
                  class="text-right pr-3"
                  min={1}
                  max={1000}
                  style={{ width: "4.5rem" }}
                  value={getTimeScale()}
                  onInput={e => setTimeScale(parseInt(e.target.value) || 1)}
                >
                </input>
                <span style={{ position: "absolute", right: "0.8rem", top: "0.5rem", margin: "auto" }}>
                  ×
                </span>
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

            <div class="flex gap-5">
              {toggleButton("Widescan", (v) => { updatesSettings.show.widescan = v; }, () => updatesSettings.show.widescan)}
              {toggleButton("Rendered", (v) => { updatesSettings.show.rendered = v; }, () => updatesSettings.show.rendered)}
              {toggleButton("Rendered paths", (v) => { updatesSettings.show.paths = v; }, () => updatesSettings.show.paths)}
              {toggleButton("Only latest", (v) => { updatesSettings.show.lastOnly = v; }, () => updatesSettings.show.lastOnly)}
            </div>

            <Show when={updatesSettings.show.paths}>
              <div class="flex gap-5">
                <div>Path parts:</div>
                {toggleButton("Start", (v) => { updatesSettings.show.pathKinds.start = v; }, () => updatesSettings.show.pathKinds.start)}
                {toggleButton("Pre-turn", (v) => { updatesSettings.show.pathKinds.preturn = v; }, () => updatesSettings.show.pathKinds.preturn)}
                {toggleButton("Turn", (v) => { updatesSettings.show.pathKinds.turn = v; }, () => updatesSettings.show.pathKinds.turn)}
                {toggleButton("End", (v) => { updatesSettings.show.pathKinds.end = v; }, () => updatesSettings.show.pathKinds.end)}
                {toggleButton("Interrupt", (v) => { updatesSettings.show.pathKinds.interrupt = v; }, () => updatesSettings.show.pathKinds.interrupt)}
                {toggleButton("Lines", (v) => { updatesSettings.show.pathKinds.lines = v; }, () => updatesSettings.show.pathKinds.lines)}
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </div >
  );
}
