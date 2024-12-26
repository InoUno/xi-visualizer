import { A, useLocation } from "@solidjs/router";
import { type Component, Suspense } from "solid-js";

const App: Component = (props: { children: Element; }) => {
  const location = useLocation();

  return (
    <div class="content">
      <nav class="bg-slate-800 rounded-lg">
        <ul class="flex space-x-4 font-bold items-center">
          <li class="py-2 px-4">
            <A href="/" class="no-underline hover:underline">
              Home
            </A>
          </li>
          <li class="py-2 px-4">
            <A href="/packet" class="no-underline hover:underline">
              Packet
            </A>
          </li>
          <li class="py-2 px-4">
            <A href="/path" class="no-underline hover:underline">
              Path
            </A>
          </li>
          <li class="py-2 px-4">
            <A href="/zone" class="no-underline hover:underline">
              Zone
            </A>
          </li>
        </ul>
      </nav>

      <main>
        <Suspense>{props.children}</Suspense>
      </main>
    </div>
  );
};

export default App;
