const PACKET_START = /^\[/;
const PACKET_KIND = /(Incoming|Outgoing) packet\s(0x[\dA-F]+)/;

const PACKET_TIMESTAMP = /^\[([^\]]+)\]/;

interface Position {
  x: number;
  y: number;
  z: number;
}

interface BaseEntityUpdate {
  kind: EntityUpdateKind;
  time: number;
}

export const enum EntityUpdateKind {
  Position,
  Widescan,
  Spawn,
  Despawn,
}

interface PositionUpdate extends BaseEntityUpdate {
  kind: EntityUpdateKind.Position | EntityUpdateKind.Widescan;
  pos: Position;
}

interface SpawnUpdate extends BaseEntityUpdate {
  kind: EntityUpdateKind.Spawn;
}

interface DespawnUpdate extends BaseEntityUpdate {
  kind: EntityUpdateKind.Despawn;
}

export type EntityUpdate = PositionUpdate | SpawnUpdate | DespawnUpdate;

type EntityUpdates = {
  [entityKey: string]: EntityUpdate[];
};

export type ZoneEntityUpdates = {
  [zoneId: number]: EntityUpdates;
};

export class PacketParser {
  private lines: string[];

  public zoneEntityUpdates: ZoneEntityUpdates;
  public clientUpdates: PositionUpdate[];

  private lastClientPosition: Position;
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
    const hasPosition = (this.extractByte(lines, 0x0A) & 1) == 1;
    if (!hasPosition) {
      // Skip packets without positions
      return;
    }

    const entityId = this.extractU32(lines, 0x04);
    const zoneId = (entityId >> 12) & 0x01FF;
    this.currentZoneId = zoneId;

    const entityIndex = this.extractU16(lines, 0x08);
    const entityKey = `0x${entityIndex.toString(16).toUpperCase().padStart(3, "0")}-${entityId}`;

    const timestamp = this.parseTimestamp(lines[0]);
    const pos = this.extractPosition(lines, 0x0C);

    let entityPositions = this.zoneEntityUpdates[zoneId] = this.zoneEntityUpdates[zoneId] || {};
    let list = entityPositions[entityKey] = entityPositions[entityKey] || [];
    list.push({
      kind: EntityUpdateKind.Position,
      time: timestamp,
      pos,
    });
  }

  private parseEntityWidescan(lines: string[]) {
    if (!this.lastClientPosition) {
      console.log("Got a widescan result before client position was known.");
      return;
    }

    const entityIndex = this.extractU16(lines, 0x04);
    const entityId = ((0x1000 + this.currentZoneId) << 12) + entityIndex;
    const entityKey = `0x${entityIndex.toString(16).toUpperCase().padStart(3, "0")}-${entityId}`;

    const timestamp = this.parseTimestamp(lines[0]);
    const xOffset = this.extractI16(lines, 0x08);
    const zOffset = this.extractI16(lines, 0x0A);

    const pos: Position = {
      x: this.lastClientPosition.x + xOffset,
      y: this.lastClientPosition.y - 10,
      z: this.lastClientPosition.z + zOffset,
    };

    let entityPositions = this.zoneEntityUpdates[this.currentZoneId] = this.zoneEntityUpdates[this.currentZoneId] || {};
    let list = entityPositions[entityKey] = entityPositions[entityKey] || [];
    list.push({
      kind: EntityUpdateKind.Widescan,
      time: timestamp,
      pos,
    });
  }

  private parseClientUpdate(lines: string[]) {
    const targetIndex = this.extractU16(lines, 0x16);

    const timestamp = this.parseTimestamp(lines[0]);
    const pos = this.extractPosition(lines, 0x04);

    this.lastClientPosition = pos;
    this.clientUpdates.push({
      kind: EntityUpdateKind.Position,
      time: timestamp,
      pos,
    });
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
