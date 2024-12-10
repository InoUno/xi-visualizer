import { createSignal, Show } from "solid-js";
import LookupInput from "../components/lookup_input";
import ZoneComponent from "../components/zone";
import zones, { ZoneInfo } from "../data/zones";

export default function ZonesPage() {
  const [getZone, setZone] = createSignal<ZoneInfo>(undefined);

  return (
    <section class="p-8">
      <h1 class="text-2xl font-bold">Zones</h1>
      <LookupInput
        options={zones}
        nameFn={v => v.name}
        autofocus
        onChange={value => {
          setZone(value.data);
        }}
      >
      </LookupInput>

      <Show when={getZone()}>
        <ZoneComponent zone={getZone()}></ZoneComponent>
      </Show>
    </section>
  );
}
