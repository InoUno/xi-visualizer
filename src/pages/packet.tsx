import { createEffect, createSignal, For, Match, Switch } from "solid-js";

import { createDropzone } from "@soorria/solid-dropzone";
import { createStore } from "solid-js/store";
import ZoneModel, { ZoneData } from "../components/zone_model";
import zones, { ZoneInfo } from "../data/zones";
import { PacketParser } from "../parse_packets";
import { ByZone } from "../types";
import { decompress, fetchProgress } from "../util";

interface PacketPageProps {
}

export default function PacketPage({}: PacketPageProps) {
  const [getParsedPackets, setParsedPackets] = createSignal<PacketParser | undefined>(undefined);
  const [getZoneModels, setZoneModels] = createSignal<ByZone<ZoneData> | undefined>(undefined);
  const [getStatus, setStatus] = createSignal<string | undefined>();

  const [getZoneIds, setZoneIds] = createSignal<number[]>([]);
  const [zoneProgress, setZoneProgress] = createStore<ByZone<string>>({});

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
    setZoneIds(Object.keys(parsedPackets.zoneEntityUpdates).map(x => parseInt(x)));

    let promises = [];
    let zoneModels: ByZone<ZoneData> = {};

    for (const zoneId in parsedPackets.zoneEntityUpdates) {
      const zoneIdNum = parseInt(zoneId);

      promises.push(
        new Promise(async resolve => {
          console.time(`load-mesh-${zoneId}`);

          const url = `${import.meta.env.BASE_URL}/zone_meshes/${zoneId}.ximesh`;
          const compressed = await fetchProgress(url, (progress: number) => {
            if (progress === undefined) {
              setZoneProgress(zoneIdNum, undefined);
            } else {
              setZoneProgress(zoneIdNum, `${(progress * 100).toFixed(0).padStart(3, " ")}% - Downloading mesh for ${zones[zoneId].name}`);
            }
          });

          setZoneProgress(zoneIdNum, `Decompressing ${zones[zoneId].name}`);
          const bytes = await decompress(compressed);
          zoneModels[zoneId] = {
            id: zoneIdNum,
            name: zones[zoneId].name,
            mesh: bytes,
          };
          setZoneProgress(zoneIdNum, undefined);

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
          <pre>
            {getZoneIds().map(zoneId => {
                const progress = zoneProgress[zoneId];
                if (progress) {
                  return <span>{progress}</span>
                } else {
                  return <></>;
                }
            })}
          </pre>
        </Match>
      </Switch>
    </section>
  );
}
