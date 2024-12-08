import { Suspense, type Component } from 'solid-js';
import { A, useLocation } from '@solidjs/router';

const App: Component = (props: { children: Element }) => {
  const location = useLocation();

  return (
    <div class='content'>
      <nav class="bg-slate-800 rounded-lg">
        <ul class="flex items-center">
          <li class="py-2 px-4">
            <A href="/" class="no-underline hover:underline">
              Zones
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
