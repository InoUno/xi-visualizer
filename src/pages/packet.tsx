import { createEffect, createSignal, Match, Switch } from "solid-js";

import { createDropzone } from "@soorria/solid-dropzone";
import ZoneModel, { ZoneData } from "../components/zone_model";
import zones, { ZoneInfo } from "../data/zones";
import { PacketParser } from "../parse_packets";
import { ByZone } from "../types";
import { decompress } from "../util";

interface PacketPageProps {
}

export default function PacketPage({}: PacketPageProps) {
  const [getParsedPackets, setParsedPackets] = createSignal<PacketParser | undefined>(undefined);
  const [getZoneModels, setZoneModels] = createSignal<ByZone<ZoneData> | undefined>(undefined);
  const [getStatus, setStatus] = createSignal<string | undefined>();

  function parseFile(file: File) {
    setStatus("Parsing packets");
    const reader = new FileReader();
    reader.onload = e => {
      const parser = new PacketParser(e.target.result as string);
      parser.parsePackets();
      setParsedPackets(parser);
    };
    reader.readAsText(file);
  }

  const onDrop = (acceptedFiles: File[]) => {
    setParsedPackets(undefined);
    if (acceptedFiles.length == 0) {
      return;
    }

    parseFile(acceptedFiles[0]);
  };
  const dropzone = createDropzone({ onDrop });

  createEffect(async () => {
    const parsedPackets = getParsedPackets();
    if (!parsedPackets) {
      return;
    }
    setStatus("Loading zones");
    let promises = [];
    let zoneModels: ByZone<ZoneData> = {};
    for (const zoneId in parsedPackets.zoneEntityUpdates) {
      promises.push(
        new Promise(async resolve => {
          console.time(`load-mesh-${zoneId}`);
          const url = `${import.meta.env.BASE_URL}/zone_meshes/${zoneId}.ximesh`;
          const response = await fetch(url);
          const compressed = await response.arrayBuffer();
          const bytes = await decompress(compressed);
          zoneModels[zoneId] = {
            id: parseInt(zoneId),
            name: zones[zoneId].name,
            mesh: bytes,
          };
          console.timeEnd(`load-mesh-${zoneId}`);
          resolve(true);
        }),
      );
    }

    await Promise.allSettled(promises);
    setZoneModels(zoneModels);
  });

  return (
    <section class="px-8 py-4">
      <h1 class="text-2xl font-bold">Packet</h1>

      <Switch
        fallback={
          <div
            class="text-xl rounded-xl p-10 text-center cursor-pointer"
            classList={{
              "bg-slate-700": !dropzone.isDragActive,
              "bg-green-900": dropzone.isDragActive,
            }}
            {...dropzone.getRootProps()}
          >
            <input {...dropzone.getInputProps()} />
            <p>Drop packet files here, or click to open file selection menu.</p>
          </div>
        }
      >
        <Match when={getParsedPackets() !== undefined && getZoneModels() !== undefined}>
          <button onClick={_ => setParsedPackets(undefined)}>Clear packets</button>
          <ZoneModel entityUpdates={getParsedPackets().zoneEntityUpdates} clientUpdates={getParsedPackets().clientUpdates} zoneData={getZoneModels()}>
          </ZoneModel>
        </Match>
        <Match when={getStatus() && !getZoneModels()}>
          <div>{getStatus()}</div>
        </Match>
      </Switch>
    </section>
  );
}
