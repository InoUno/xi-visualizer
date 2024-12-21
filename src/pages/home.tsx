import { A } from "@solidjs/router";
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import AreaMenu, { Area } from "../components/area_menu";

export default function HomePage() {
  const [getCurrentArea, setCurrentArea] = createSignal<number | undefined>(0);
  const [areas, setAreas] = createStore<Area[]>([{
    y: -10,
    polygon: [],
  }]);

  return (
    <section class="p-8">
      <h1 class="text-2xl font-bold">Home</h1>

      <div class="content">
        <ul>
          <li>
            <A href="/packet">Packet visualizer</A>
          </li>
          <li>
            <A href="/zone">Zone viewer</A>
          </li>
        </ul>
      </div>
      <div
        style={{ height: "300px", width: "800px", position: "relative", border: "1px solid red" }}
        onClick={e => {
          if (e.shiftKey) {
            const area = areas[getCurrentArea()];
            setAreas(getCurrentArea(), "polygon", area.polygon.length, { x: e.clientX, z: e.clientY });
          }
        }}
      >
        <AreaMenu areas={areas} setAreas={setAreas} currentAreaIdx={getCurrentArea()} setCurrentArea={setCurrentArea}>
        </AreaMenu>
      </div>
    </section>
  );
}
