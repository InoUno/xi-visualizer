const PACKET_START = /^\[/;
const PACKET_KIND = /(Incoming|Outgoing) packet\s(0x[\dA-F]+)/;

const PACKET_TIMESTAMP = /^\[([^\]]+)\]/;

export interface Position {
  x: number;
  y: number;
  z: number;
  rotation?: number;
}

interface BaseEntityUpdate {
  kind: EntityUpdateKind;
  time: number;
}

export const enum EntityUpdateKind {
  Position,
  Widescan,
  OutOfRange,
  Despawn,
}

export interface PositionUpdate extends BaseEntityUpdate {
  kind: EntityUpdateKind.Position | EntityUpdateKind.Widescan;
  pos: Position;
  name?: string;
}

export interface OutOfRangeUpdate extends BaseEntityUpdate {
  kind: EntityUpdateKind.OutOfRange;
}

export interface DespawnUpdate extends BaseEntityUpdate {
  kind: EntityUpdateKind.Despawn;
}

export type EntityUpdate = PositionUpdate | OutOfRangeUpdate | DespawnUpdate;

type EntityUpdates = {
  [entityKey: string]: EntityUpdate[];
};

export type ZoneEntityUpdates = {
  [zoneId: number]: EntityUpdates;
};

const enc = new TextDecoder("utf-8");

export class PacketParser {
  private lines: string[];

  public zoneEntityUpdates: ZoneEntityUpdates;
  public clientUpdates: PositionUpdate[];

  private lastClientPosition: Position;
  private currentShownEntities: { [entityKey: string]: { time: number; pos: Position; }; };
  private currentZoneId: number = 0;

  constructor(content: string) {
    console.time("line-splitting");
    this.lines = content.split("\n");
    console.timeEnd("line-splitting");
  }

  public parsePackets() {
    console.time("parse-packets");
    this.zoneEntityUpdates = {};
    this.clientUpdates = [];
    this.currentShownEntities = {};
    let packetCount = 0;

    for (let i = 0; i < this.lines.length; i++) {
      if (PACKET_START.test(this.lines[i])) {
        let start = i;
        i++;
        while (i < this.lines.length && !PACKET_START.test(this.lines[i])) {
          i++;
        }
        this.parsePacket(this.lines.slice(start, i));
        packetCount++;
        i--;
      }
    }
    console.timeEnd("parse-packets");
  }

  private parsePacket(lines: string[]) {
    const kind = PACKET_KIND.exec(lines[0]);

    switch (kind[1]) {
      case "Incoming": {
        switch (kind[2]) {
          case "0x00E": {
            this.parseEntityUpdate(lines);
            break;
          }
          case "0x0F4": {
            this.parseEntityWidescan(lines);
            break;
          }
        }
        break;
      }
      case "Outgoing": {
        switch (kind[2]) {
          case "0x015": {
            this.parseClientUpdate(lines);
            break;
          }
        }
        break;
      }
      default:
        console.error("Unknown packet direction: " + kind[1]);
        break;
    }
  }

  private parseEntityUpdate(lines: string[]) {
    const entityId = this.extractU32(lines, 0x04);
    const zoneId = (entityId >> 12) & 0x01FF;
    if (zoneId == 0) {
      // Don't show entities with the unknown zone ID
      return;
    }
    this.currentZoneId = zoneId;

    const entityIndex = this.extractU16(lines, 0x08);
    const entityKey = `0x${entityIndex.toString(16).toUpperCase().padStart(3, "0")}-${entityId}`;

    const timestamp = this.parseTimestamp(lines[0]);

    let entityUpdates = this.zoneEntityUpdates[zoneId] = this.zoneEntityUpdates[zoneId] || {};
    let list = entityUpdates[entityKey] = entityUpdates[entityKey] || [];

    const updateMask = this.extractByte(lines, 0x0A);
    if ((updateMask & 0x20) > 0) {
      // Despawn packet
      delete this.currentShownEntities[entityKey];
      const update = {
        kind: EntityUpdateKind.Despawn as EntityUpdateKind.Despawn,
        time: timestamp,
      };
      list.push(update);
      return;
    }

    const hasPosition = (updateMask & 0x01) > 0;
    if (!hasPosition) {
      // Skip packets without positions, but update latest timestamp if present
      if (this.currentShownEntities[entityKey]) {
        this.currentShownEntities[entityKey].time = timestamp;
      }
      return;
    }

    const name = (updateMask & 0x08) > 0 ? this.extractString(lines, 0x34) : undefined;

    const pos = this.extractPosition(lines, 0x0C);
    pos.rotation = this.extractByte(lines, 0x0B);

    const update = {
      kind: EntityUpdateKind.Position as EntityUpdateKind.Position,
      time: timestamp,
      pos,
      name,
    };
    list.push(update);

    if (this.isOutOfRangeFromClient(pos)) {
      list.push({
        kind: EntityUpdateKind.OutOfRange,
        time: timestamp,
      });
      delete this.currentShownEntities[entityKey];
    } else {
      this.currentShownEntities[entityKey] = {
        time: update.time,
        pos,
      };
    }
  }

  private parseEntityWidescan(lines: string[]) {
    if (this.currentZoneId == 0) {
      // Don't handle when it's the unknown zone ID
      return;
    }
    if (!this.lastClientPosition) {
      // Skip widescan results before the latest client position is known,
      // because widescan results are relative to it.
      return;
    }

    const entityIndex = this.extractU16(lines, 0x04);
    const entityId = ((0x1000 + this.currentZoneId) << 12) + entityIndex;
    const entityKey = `0x${entityIndex.toString(16).toUpperCase().padStart(3, "0")}-${entityId}`;

    const name = this.extractString(lines, 0x0C);

    const timestamp = this.parseTimestamp(lines[0]);
    const xOffset = this.extractI16(lines, 0x08);
    const zOffset = this.extractI16(lines, 0x0A);

    const pos: Position = {
      x: this.lastClientPosition.x + xOffset,
      y: this.lastClientPosition.y,
      z: this.lastClientPosition.z + zOffset,
    };

    let entityPositions = this.zoneEntityUpdates[this.currentZoneId] = this.zoneEntityUpdates[this.currentZoneId] || {};
    let list = entityPositions[entityKey] = entityPositions[entityKey] || [];
    list.push({
      kind: EntityUpdateKind.Widescan,
      time: timestamp,
      pos,
      name,
    });
  }

  private parseClientUpdate(lines: string[]) {
    if (this.currentZoneId == 0) {
      // Don't handle when it's the unknown zone ID
      return;
    }
    const targetIndex = this.extractU16(lines, 0x16);

    const timestamp = this.parseTimestamp(lines[0]);
    const pos = this.extractPosition(lines, 0x04);

    this.lastClientPosition = pos;
    this.clientUpdates.push({
      kind: EntityUpdateKind.Position,
      time: timestamp,
      pos,
    });

    Object.keys(this.currentShownEntities).forEach(entityKey => {
      if (!this.currentShownEntities[entityKey]) {
        return;
      }
      const entityInfo = this.currentShownEntities[entityKey];
      if (
        this.isOutOfRangeFromClient(entityInfo.pos)
      ) {
        let entityPositions = this.zoneEntityUpdates[this.currentZoneId] = this.zoneEntityUpdates[this.currentZoneId] || {};
        let list = entityPositions[entityKey] = entityPositions[entityKey] || [];
        list.push({
          kind: EntityUpdateKind.OutOfRange,
          time: entityInfo.time + 1000,
        });
        delete this.currentShownEntities[entityKey];
      }
    });
  }

  private isOutOfRangeFromClient(pos: Position): boolean {
    if (!this.lastClientPosition) {
      return false;
    }
    return this.calculateDistanceSquared(this.lastClientPosition, pos) > 2500; // Further than 50 yalms
  }

  private isFarFromClient(pos: Position): boolean {
    if (!this.lastClientPosition) {
      return false;
    }
    return this.calculateDistanceSquared(this.lastClientPosition, pos) > 2000; // Further than 45 yalms
  }

  private calculateDistanceSquared(pos1: Position, pos2: Position): number {
    return Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.y - pos2.y, 2) + Math.pow(pos1.z - pos2.z, 2);
  }

  private parseTimestamp(line: string) {
    return Date.parse(PACKET_TIMESTAMP.exec(line)[1]);
  }

  private extractPosition(lines: string[], offset: number): Position {
    const bytes = this.extractBytes(lines, offset, 12);
    const dv = new DataView(bytes);
    return {
      x: dv.getFloat32(0, true),
      y: dv.getFloat32(4, true),
      z: dv.getFloat32(8, true),
    };
  }

  private extractString(lines: string[], offset: number, maxLen: number = 16): string {
    const bytes = this.extractBytes(lines, offset, maxLen);
    const arr = new Uint8Array(bytes);
    let end = 0;
    for (; end < maxLen; end++) {
      if (arr[end] == 0) {
        break;
      }
    }
    return enc.decode(bytes.slice(0, end));
  }

  private extractU32(lines: string[], offset: number): number {
    const bytes = this.extractBytes(lines, offset, 4);
    const dv = new DataView(bytes);
    return dv.getUint32(0, true);
  }

  private extractU16(lines: string[], offset: number): number {
    const bytes = this.extractBytes(lines, offset, 4);
    const dv = new DataView(bytes);
    return dv.getUint16(0, true);
  }

  private extractI16(lines: string[], offset: number): number {
    const bytes = this.extractBytes(lines, offset, 4);
    const dv = new DataView(bytes);
    return dv.getInt16(0, true);
  }

  private extractFloat(lines: string[], offset: number): number {
    const bytes = this.extractBytes(lines, offset, 4);
    const dv = new DataView(bytes);
    return dv.getFloat32(0, true);
  }

  private extractByte(lines: string[], offset: number): number {
    const bytes = this.extractBytes(lines, offset, 4);
    const dv = new DataView(bytes);
    return dv.getUint8(0);
  }

  private extractBytes(lines: string[], offset: number, count: number): ArrayBuffer {
    let line = offset / 16 >> 0;
    let byteIndex = offset % 16;

    let result = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const byteStr = lines[3 + line].substring(10 + byteIndex * 3, 10 + byteIndex * 3 + 2);
      result[i] = parseInt(byteStr, 16);
      byteIndex++;
      if (byteIndex >= 16) {
        byteIndex = 0;
        line++;
      }
    }
    return result.buffer;
  }
}
