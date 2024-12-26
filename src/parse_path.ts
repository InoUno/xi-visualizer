import { EntityUpdate, EntityUpdateKind, Position, PositionUpdate } from "./parse_packets";

export const enum PathPartKind {
  Start,
  End,
  NewDirection,
}

export interface PathStart {
  kind: PathPartKind.Start;
  time: number;
  pauseTime: number;
  rot: number;
  rotDiff: number;
}

export interface PathEnd {
  kind: PathPartKind.End;
  time: number;
  moveTime: number;
  pathDist: number;
  legDist: number;
  startPos: Position;
  endPos: Position;
}

export interface PathDirection {
  kind: PathPartKind.NewDirection;
  time: number;
  walkTime: number;
  walkDist: number;
  rot: number;
  rotDiff: number;
}

export type PathPart = PathStart | PathEnd | PathDirection;

export function parsePath(updates: EntityUpdate[]): PathPart[] {
  let prevUpdate: PositionUpdate;
  let prevMoveUpdate: PositionUpdate;
  let prevStopUpdate: PositionUpdate;
  let prevRotUpdate: PositionUpdate;

  let distMoved = 0;
  let timeSinceLastMove = 0;
  let moveTime = 0;
  let stopDist = 0;

  let path: PathPart[] = [];
  for (const update of updates) {
    if (update.kind === EntityUpdateKind.OutOfRange || update.kind === EntityUpdateKind.Despawn) {
      prevUpdate = undefined;
      prevMoveUpdate = undefined;
      prevStopUpdate = undefined;
      prevRotUpdate = undefined;
      continue;
    }
    if (update.kind !== EntityUpdateKind.Position) {
      continue;
    }

    if (!prevUpdate) {
      prevUpdate = update;
      prevMoveUpdate = update;
      prevRotUpdate = update;
      continue;
    }

    distMoved = calcDistance(update.pos, prevUpdate.pos);

    if (distMoved > 0.1) {
      timeSinceLastMove = update.time - prevMoveUpdate.time;

      if (timeSinceLastMove > 3000) {
        if (prevStopUpdate) {
          moveTime = prevMoveUpdate.time - prevStopUpdate.time;
          stopDist = calcDistance(prevMoveUpdate.pos, prevStopUpdate.pos);
          path.push({
            kind: PathPartKind.End,
            time: prevMoveUpdate.time,
            moveTime: moveTime,
            pathDist: stopDist,
            legDist: calcDistance(prevRotUpdate.pos, prevMoveUpdate.pos),
            startPos: prevStopUpdate.pos,
            endPos: prevMoveUpdate.pos,
          });

          path.push({
            kind: PathPartKind.Start,
            time: prevMoveUpdate.time,
            pauseTime: timeSinceLastMove,
            rot: update.pos.rotation!,
            rotDiff: calcRotDiff(prevMoveUpdate.pos.rotation!, update.pos.rotation!),
          });
        }

        prevStopUpdate = update;
        prevRotUpdate = update;
      }

      prevMoveUpdate = update;
    }

    if (update.pos.rotation != prevRotUpdate.pos.rotation) {
      path.push({
        kind: PathPartKind.NewDirection,
        time: update.time,
        rot: update.pos.rotation!,
        rotDiff: calcRotDiff(prevRotUpdate.pos.rotation!, update.pos.rotation!),
        walkDist: calcDistance(prevRotUpdate.pos, update.pos),
        walkTime: update.time - prevRotUpdate.time,
      });
      prevRotUpdate = update;
    }

    prevUpdate = update;
  }

  return path;
}

function calcRotDiff(startRot: number, endRot: number): number {
  let diff = endRot - startRot;
  if (diff > 128) {
    return diff - 256;
  }
  if (diff < -128) {
    return diff + 256;
  }
  return diff;
}

function calcDistance(pos1: Position, pos2: Position): number {
  return Math.sqrt(Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.z - pos2.z, 2));
}
