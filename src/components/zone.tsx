import { createEffect, createResource, createSignal, Match, onMount, Show, Switch } from "solid-js";
import { ZoneInfo } from "../data/zones";
import { decompress, fetchProgress } from "../util";
import ZoneModel from "./zone_model";

export interface ZoneProps {
  zone: ZoneInfo;
}

export default function ZoneComponent(props: ZoneProps) {
  const [getLoadingMessage, setLoadingMessage] = createSignal<string | undefined>();

  const [model] = createResource(() => props.zone.id, async zoneId => {
    console.time("load-mesh");
    const url = `${import.meta.env.BASE_URL}/zone_meshes/${zoneId}.ximesh`;
    const compressed = await fetchProgress(url, (progress: number) => {
      if (progress === undefined) {
        setLoadingMessage(undefined);
      } else {
        setLoadingMessage(`Downloading mesh ${(progress * 100).toFixed(0)}%`);
      }
    });
    console.timeEnd("load-mesh");

    console.time("decompress-mesh");
    setLoadingMessage(`Decompressing mesh`);
    const bytes = await decompress(compressed);
    setLoadingMessage(undefined);
    console.timeEnd("decompress-mesh");

    return bytes;
  });

  return (
    <section class="p-2">
      <h1 class="text-2xl font-bold">{props.zone.name} ({props.zone.id})</h1>
      <Switch>
        <Match when={model.loading}>
          Loading... {getLoadingMessage()}
        </Match>
        <Match when={model.error}>
          Failed to load zone model: {model.error}
        </Match>
        <Match when={!model.loading && !model.error}>
          <ZoneModel
            zoneData={{
              [props.zone.id]: {
                id: props.zone.id,
                name: props.zone.name,
                mesh: model(),
              },
            }}
          >
          </ZoneModel>
        </Match>
      </Switch>
    </section>
  );
}
