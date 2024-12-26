import { createEffect, createMemo, createSignal, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";

import { createDropzone } from "@soorria/solid-dropzone";
import LookupInput from "../components/lookup_input";
import PathVisuals from "../components/path_visuals";
import { EntityUpdate, EntityUpdateKind, PacketParser, Position, PositionUpdate } from "../parse_packets";
import { parsePath } from "../parse_path";

interface PathPageProps {
}

interface EntityInfo {
  entityId: number;
  entityKey: string;
  name: string;
  posCount: number;
  updates: EntityUpdate[];
}

export default function PacketPage({}: PathPageProps) {
  const [getStatus, setStatus] = createSignal<string | undefined>();
  const [getParsedPackets, setParsedPackets] = createSignal<PacketParser | undefined>(undefined);

  const [getSelectedEntity, setSelectedEntity] = createSignal<EntityInfo | undefined>();

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

  createEffect(on(getParsedPackets, () => {
    setSelectedEntity(undefined);
  }));

  const entities = createMemo(() => {
    if (getParsedPackets() === undefined) {
      return [];
    }
    setStatus(undefined);

    let entities: EntityInfo[] = [];
    for (const zoneId in getParsedPackets().zoneEntityUpdates) {
      const zoneUpdates = getParsedPackets().zoneEntityUpdates[zoneId];
      for (const entityKey in zoneUpdates) {
        const updates = zoneUpdates[entityKey];

        const entityId = parseInt(entityKey.split("-")[1]);

        let posCount = 0;
        let name = "";
        for (const update of updates) {
          if (name.length == 0 && "name" in update && update.name?.length > 0) {
            name = update.name;
          }
          if (update.kind == EntityUpdateKind.Position) {
            posCount++;
          }
        }

        entities.push({
          entityId,
          entityKey,
          name,
          posCount,
          updates,
        });
      }
    }

    entities.sort((a, b) => b.posCount - a.posCount);
    return entities;
  });

  const path = createMemo(() => {
    const selected = getSelectedEntity();
    if (!selected) {
      return;
    }

    return parsePath(selected.updates);
  });

  return (
    <section class="px-8 py-4">
      <h1 class="text-2xl font-bold">Path analyzer</h1>

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
        <Match when={getParsedPackets() !== undefined}>
          <button onClick={_ => setParsedPackets(undefined)}>Clear packets</button>
          <LookupInput
            options={entities()}
            nameFn={v => `${v.entityId} ${v.name} [${v.posCount}]`}
            autofocus
            skipNameSort={true}
            onChange={value => {
              setSelectedEntity(value.data);
            }}
            initialId="0"
          >
          </LookupInput>
          <Show when={path() !== undefined}>
            <PathVisuals path={path()}></PathVisuals>
          </Show>
        </Match>
        <Match when={getStatus()}>
          <div>{getStatus()}</div>
        </Match>
      </Switch>
    </section>
  );
}
