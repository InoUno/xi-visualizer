import type { RouteDefinition } from "@solidjs/router";
import { lazy } from "solid-js";

import HomePage from "./pages/home";
import PacketPage from "./pages/packet";
import ZonesPage from "./pages/zones";

export const routes: RouteDefinition[] = [
  {
    path: "/",
    component: HomePage,
  },
  {
    path: "/packet",
    component: PacketPage,
  },
  {
    path: "/zone",
    component: ZonesPage,
  },
  {
    path: "**",
    component: lazy(() => import("./errors/404")),
  },
];
