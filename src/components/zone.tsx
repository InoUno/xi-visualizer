import { createEffect, createResource, createSignal, Match, onMount, Show, Switch } from "solid-js";
import { ZoneInfo } from "../data/zones";
import { decompress } from "../util";
import ZoneModel from "./zone_model";

export interface ZoneProps {
  zone: ZoneInfo;
}

export default function ZoneComponent(props: ZoneProps) {
  const [model] = createResource(() => props.zone.id, async zoneId => {
    console.time("load-mesh");
    const url = `${import.meta.env.BASE_URL}/zone_meshes/${zoneId}.ximesh`;
    const response = await fetch(url);
    const compressed = await response.arrayBuffer();
    const bytes = await decompress(compressed);
    console.timeEnd("load-mesh");
    return bytes;
  });

  return (
    <section class="p-2">
      <h1 class="text-2xl font-bold">{props.zone.name} ({props.zone.id})</h1>
      <Switch>
        <Match when={model.loading}>
          Loading...
        </Match>
        <Match when={model.error}>
          Failed to load zone model.
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
