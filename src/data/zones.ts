import zonesRaw from "./zones.json";

export interface ZoneInfo {
  id: number;
  name: string;
}

const zoneLookup: { [zoneId: number]: ZoneInfo; } = {};

for (const zone of zonesRaw) {
  zoneLookup[zone.id] = {
    id: zone.id,
    name: zone.name,
  };
}

export default zoneLookup;
