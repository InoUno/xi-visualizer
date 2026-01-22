import * as THREE from "three"
import { createEffect, onCleanup, type Setter } from "solid-js"

import { ROT_TO_RADIANS } from "../graphics/util"
import { InstancedMesh2, type InstancedEntity } from "@three.ez/instanced-mesh"
import { DynamicLineSegments } from "../graphics/dynamic_line_segments"
import type { EntityUpdatesByEntity, Position } from "../parse_packets"
import { parsePath, PathPartKind, type PathPart } from "../parse_path"
import type { EntitiesSettings, EntityPathKindsSettings } from "./zone_model"
import { binarySearchLower } from "../util"

export interface EntityPaths {
  scene: THREE.Scene,
  adjustedEntityUpdates: EntityUpdatesByEntity,
  getEntityPaths: () => EntityPathMap
  setEntityPaths: Setter<EntityPathMap>,
  pathKinds: EntityPathKindsSettings,
  entitySettings: EntitiesSettings,
  renderer: THREE.WebGLRenderer,
  startTime: number,
  endTime: number,
}

export type EntityPathMap = {
  [entityKey: string]: EntityPathMeshes
}

export interface EntityPathMeshes {
  lines: DynamicLineSegments,
  pointMesh: InstancedMesh2,
  showLines?: boolean
  showPoints?: boolean,
}

const enum PointKind {
  Start,
  PreTurn,
  Turn,
  End,
  Interrupted,
}

function fromPathPartKind(k: PathPartKind): PointKind {
  switch (k) {
    case PathPartKind.Start: return PointKind.Start
    case PathPartKind.NewDirection: return PointKind.Turn
    case PathPartKind.End: return PointKind.End
    case PathPartKind.Interrupted: return PointKind.Interrupted
  }
}

interface PathPointInfo {
  pos: Position,
  kind: PointKind,
  color: THREE.Color,
  time: number,
}

export default function EntityPaths(ps: EntityPaths) {
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xCC0000,
    linewidth: 1,
    depthTest: true,
  })
  const pointMat = new THREE.MeshBasicMaterial()
  const pointSize = 2

  const pathStartColor = new THREE.Color(0x55AA55)
  const pathDirectionColor = new THREE.Color(0xAAAA00)
  const pathEndColor = new THREE.Color(0x5555AA)
  const pathInterruptColor = new THREE.Color(0xFF5555)

  createEffect(() => {
    const paths: EntityPathMap = {}

    const copyAdjustedPos = (p: Position): Position => {
      return {
        x: p.x,
        y: p.y - 0.5,
        z: p.z,
        rotation: p.rotation
      }
    }

    const updates = ps.adjustedEntityUpdates

    for (const entityKey in updates) {
      const lines = new DynamicLineSegments(lineMat)
      lines.userData = {
        times: [],
        indices: [],
      }

      const points: PathPointInfo[] = []

      const entityUpdates = updates[entityKey].updates
      const parts = parsePath(entityUpdates)

      let currentParts: PathPart[] = []

      const endPath = () => {
        if (currentParts.length <= 1) {
          currentParts = []
          return
        }

        const indices = lines.addLineSegments(currentParts.map(p => copyAdjustedPos(p.pos)))
        // Note the time and id correlation, so the line draw range can be easily sliced based on time later
        currentParts.slice(1).forEach((p, i) => {
          const idx = indices[i]
          lines.userData.times.push(p.time)
          lines.userData.indices.push(idx)
        })

        let lastRot = 0
        let pointColor: THREE.Color | undefined = undefined

        for (const part of currentParts) {
          pointColor = undefined

          let rot = "rot" in part ? part.rot : lastRot

          if (part.kind == PathPartKind.Start) {
            pointColor = pathStartColor
          } else if (part.kind == PathPartKind.NewDirection) {
            pointColor = pathDirectionColor
          } else if (part.kind == PathPartKind.End) {
            pointColor = pathEndColor
          } else if (part.kind == PathPartKind.Interrupted) {
            pointColor = pathInterruptColor
          }

          if (pointColor) {
            const pos = copyAdjustedPos(part.pos)

            // Draw regular points
            pos.rotation = rot
            points.push({
              pos,
              kind: fromPathPartKind(part.kind),
              color: pointColor,
              time: part.time,
            })

            // Draw an extra point for pre-turn points
            if (part.kind == PathPartKind.NewDirection) {
              const posCopy = { ...pos }
              posCopy.rotation = lastRot
              points.push({
                pos: posCopy,
                kind: PointKind.PreTurn,
                color: pointColor,
                time: part.time,
              })
            }
          }

          lastRot = rot
        }

        currentParts = []
      }

      for (const part of parts) {
        if (part.kind == PathPartKind.Start) {
          endPath()
          currentParts = [part]
        } else if (part.kind == PathPartKind.NewDirection) {
          currentParts.push(part)
        } else if (part.kind == PathPartKind.End || part.kind == PathPartKind.Interrupted) {
          currentParts.push(part)
          endPath()
        }
      }

      const pointGeo = new THREE.ConeGeometry(pointSize / 4, pointSize)
      pointGeo.rotateZ(-Math.PI / 2)
      pointGeo.translate(pointSize / 2, 0, 0)

      const pointMesh = new InstancedMesh2(pointGeo, pointMat, { renderer: ps.renderer })
      pointMesh.userData = {
        times: {},
        kinds: {
          [PointKind.Start]: [],
          [PointKind.PreTurn]: [],
          [PointKind.Turn]: [],
          [PointKind.End]: [],
          [PointKind.Interrupted]: [],
        }
      }

      let i = 0
      pointMesh.addInstances(points.length, (obj: InstancedEntity, instanceId) => {
        const point = points[i++]
        pointMesh.userData.kinds[point.kind].push(instanceId)
        pointMesh.userData.times[instanceId] = point.time;
        obj.position.set(point.pos.x, point.pos.y, point.pos.z)
        obj.rotateY(ROT_TO_RADIANS * point.pos.rotation)
        obj.color = point.color
      })

      pointMesh.layers.enableAll()
      pointMesh.computeBVH()
      pointMesh.computeBoundingSphere()

      paths[entityKey] = {
        lines,
        pointMesh,
      }
    }

    onCleanup(() => {
      for (const entityKey in paths) {
        const meshes = paths[entityKey]
        if (meshes.showLines) {
          ps.scene.remove(meshes.lines)
        }
        if (meshes.showPoints) {
          ps.scene.remove(meshes.pointMesh)
        }
      }
    })

    ps.setEntityPaths(paths)
  })

  // Show/hide
  createEffect(() => {
    const allPaths = ps.getEntityPaths()

    for (const entityKey in allPaths) {
      const entityPaths = allPaths[entityKey]
      if (!entityPaths) {
        continue
      }

      const settings = ps.entitySettings[entityKey]

      // Lines
      if (!ps.pathKinds.lines || settings?.hidden) {
        if (entityPaths.showLines) {
          delete entityPaths.showLines
          ps.scene.remove(entityPaths.lines)
        }
      } else {
        const lines = entityPaths.lines
        if (!entityPaths.showLines) {
          entityPaths.showLines = true
          ps.scene.add(lines)
        }

        // Determine which slice of lines to show depending on the start and end times
        const times: number[] = lines.userData.times
        const indices: number[] = lines.userData.indices

        const startIdx = indices[binarySearchLower(times, ps.startTime, x => x)]
        const endIdx = indices[binarySearchLower(times, ps.endTime, x => x)]

        lines.setDrawRange(startIdx, endIdx)
      }

      // Point mesh and hidden entity in general
      if (settings?.hidden) {
        if (entityPaths.showLines) {
          delete entityPaths.showLines
          ps.scene.remove(entityPaths.lines)
        }
        if (entityPaths.showPoints) {
          delete entityPaths.showPoints
          ps.scene.remove(entityPaths.pointMesh)
        }

      } else {
        // Handling points in point mesh

        const mesh = entityPaths.pointMesh
        // Ensure the mesh is added to the scene
        if (!entityPaths.showPoints) {
          entityPaths.showPoints = true
          ps.scene.add(mesh)
        }

        // Handle each point kind
        const handleKind = (showKind: boolean, instanceIds: number[]) => {
          for (const instanceId of instanceIds) {
            const time = mesh.userData.times[instanceId]
            const showTime = time >= ps.startTime && time <= ps.endTime
            mesh.setVisibilityAt(instanceId, showKind && showTime)
          }
        }

        handleKind(ps.pathKinds.start, mesh.userData.kinds[PointKind.Start])
        handleKind(ps.pathKinds.preturn, mesh.userData.kinds[PointKind.PreTurn])
        handleKind(ps.pathKinds.turn, mesh.userData.kinds[PointKind.Turn])
        handleKind(ps.pathKinds.end, mesh.userData.kinds[PointKind.End])
        handleKind(ps.pathKinds.interrupt, mesh.userData.kinds[PointKind.Interrupted])
      }
    }
  })

  return <></>
}
