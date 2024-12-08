import { createEffect, createResource, createSignal, Match, onMount, Show, Switch } from 'solid-js';
import ZoneModel from './zone_model';

async function compress(inString) { 
  const compressedStream = new Response(inString)
    .body.pipeThrough(new CompressionStream('deflate'));
  return await new Response(compressedStream).arrayBuffer(); 
}

async function decompress(bytes) {
  const decompressedStream = new Response(bytes)
    .body.pipeThrough(new DecompressionStream('deflate'));
  return await new Response(decompressedStream).arrayBuffer();
}

export interface ZoneProps {
  zone: Zone,
}

export interface Zone {
  id: number;
  name: string;
}

export default function ZoneComponent(props: ZoneProps) {
  const [model] = createResource(() => props.zone.id, async (zoneId) => {
    console.time("load-mesh");
    const url = `${import.meta.env.BASE_URL}zone_meshes/${zoneId}.ximesh`
    const response = await fetch(url);
    const compressed = await response.arrayBuffer();
    const bytes = await decompress(compressed);
    console.timeEnd("load-mesh");
    return bytes;
  }, {
    initialValue: undefined
  });

  console.log("here")

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
        <ZoneModel buffer={model()}></ZoneModel>
        </Match>
      </Switch>
    </section>
  );
}
