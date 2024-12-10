import { A } from "@solidjs/router";

export default function HomePage() {
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
    </section>
  );
}
