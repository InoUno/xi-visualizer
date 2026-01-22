import { createEffect, createSignal, For, Match, Switch, batch, startTransition } from "solid-js";

import { createDropzone } from "@soorria/solid-dropzone";
import { createStore } from "solid-js/store";
import ZoneModel, { ZoneData } from "../components/zone_model";
import zones, { ZoneInfo } from "../data/zones";
import { PacketParser } from "../parse_packets";
import { ByZone } from "../types";
import { decompress, fetchProgress } from "../util";

interface PacketPageProps {
}

export default function PacketPage({ }: PacketPageProps) {
  const [getParsedPackets, setParsedPackets] = createSignal<PacketParser | undefined>(undefined);
  const [getZoneModels, setZoneModels] = createSignal<ByZone<ZoneData> | undefined>(undefined);
  const [getStatus, setStatus] = createSignal<string | undefined>();

  const [getZoneIds, setZoneIds] = createSignal<number[]>([]);
  const [zoneProgress, setZoneProgress] = createStore<ByZone<string>>({});

  function reset() {
    batch(() => {
      setZoneModels(undefined);
      setParsedPackets(undefined);
      setStatus(undefined);
      setZoneIds([]);
      setZoneProgress({});
    })
  }

  async function parseFile(file: File) {
    setStatus("Loading and parsing packets");
    const stream = file.stream();
    const reader = stream.getReader();

    const parser = new PacketParser();
    let totalSize = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          parser.parsePackets();
          break;
        }

        totalSize += value.length;
        parser.parsePackets(value);
      }

      setParsedPackets(parser);
    } catch (error) {
      setStatus("Error reading stream: " + error);
    } finally {
      reader.releaseLock();
    }
  }

  const onDrop = (acceptedFiles: File[]) => {
    reset();
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

      const zone = zones[zoneIdNum];

      const filename = zone.name.replaceAll(" - ", "-")
        .replaceAll(" ", "_")
        .replaceAll("'", "")
        .replaceAll("(", "")
        .replaceAll(")", "")
        .replaceAll("#", "");

      promises.push(
        new Promise(async resolve => {
          console.time(`load-mesh-${zoneId}`);

          const url = `${import.meta.env.BASE_URL}/ximeshes/${filename}.ximesh`;
          const compressed = await fetchProgress(url, (progress: number) => {
            if (progress === undefined) {
              setZoneProgress(zoneIdNum, undefined);
            } else {
              setZoneProgress(zoneIdNum, `${(progress * 100).toFixed(0).padStart(3, " ")}% - Downloading ximesh for ${zones[zoneId].name}`);
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
    setStatus("Setting up rendering");

    // Wait for the above status to render, before setting the zone models which starts the rendering.
    // requestAnimationFrame is pre-paint, so need two of them in a row
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setZoneModels(zoneModels);
      })
    })
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
          <button onClick={_ => reset()}>Clear packets</button>
          <ZoneModel
            sourceKey="packet"
            defaultSettings={{
              showAreaManager: true,
              showInfoBox: false,
            }}
            entityUpdates={getParsedPackets().zoneEntityUpdates}
            clientUpdates={getParsedPackets().clientUpdates}
            zoneData={getZoneModels()}>
          </ZoneModel>
        </Match>
        <Match when={getStatus() && !getZoneModels()}>
          <div>{getStatus()}</div>
          <pre>
            {getZoneIds().map(zoneId => {
              const progress = zoneProgress[zoneId];
              if (progress) {
                return <div>{progress}</div>
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
