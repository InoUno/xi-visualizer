import { createSignal, Show } from "solid-js";
import zones from "../data/zones.json";
import LookupInput from "../components/lookup_input";
import ZoneComponent, { Zone } from "../components/zone";

export default function ZonesPage() {
  const [getZone, setZone] = createSignal<Zone>(undefined);

  return (
    <section class="p-8">
      <h1 class="text-2xl font-bold">Zones</h1>
      <LookupInput
        optionMap={zones}
        nameKey="name"
        autofocus
        onChange={(value) => {
          setZone(value.data)
        }}
      ></LookupInput>

      <Show when={getZone()}>
        <ZoneComponent zone={getZone()}></ZoneComponent>
      </Show>
    </section>
  );
}
