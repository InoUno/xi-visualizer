import { IoCheckmarkDoneSharp, IoChevronDown, IoChevronUp, IoCopy } from "solid-icons/io";
import { createSignal, For, Show } from "solid-js";
import { produce, SetStoreFunction } from "solid-js/store";

export interface AreaMenuProps {
  currentAreaIdx: number | undefined;
  setCurrentArea: (newIdx: number) => any;
  areas: Area[];
  setAreas: SetStoreFunction<Area[]>;
}

export interface Point {
  x: number;
  z: number;
}

export interface Area {
  y: number;
  polygon: Point[];
}

const Y_PATTERN = /^y\s*=\s*(\-?\d+)\s*,?/;
const POLYGON_PATTERN = /^polygon\s*=\s*\{/;
const XY_PATTERN = /^\{\s*x\s*=\s*(\-?\d+)\s*,\s*z\s*=\s*(\-?\d+),?\s*\}\s*,?/;

function skipWhitespace(str: string): number {
  let idx = 0;
  while (str[idx] == " " || str[idx] == "\n" || str[idx] == "\r") {
    idx++;
  }
  return idx;
}

/// Returns the number of characters to skip to proceed
function parseAreaDef(str: string, areas: Area[]): number {
  const yMatch = Y_PATTERN.exec(str);
  if (!yMatch) {
    return 1;
  }

  const y = parseFloat(yMatch[1]);
  if (isNaN(y)) {
    return 1;
  }
  let idx = yMatch[0].length;
  idx += skipWhitespace(str.substring(idx));

  const polygonMatch = POLYGON_PATTERN.exec(str.substring(idx));
  if (!polygonMatch) {
    return 1;
  }
  idx += polygonMatch[0].length;
  idx += skipWhitespace(str.substring(idx));

  let area = {
    y,
    polygon: [],
  };

  while (true) {
    const xyMatch = XY_PATTERN.exec(str.substring(idx));
    if (!xyMatch) {
      break;
    }
    idx += xyMatch[0].length;
    idx += skipWhitespace(str.substring(idx));

    const x = parseFloat(xyMatch[1]);
    if (isNaN(x)) {
      continue;
    }
    const z = parseFloat(xyMatch[2]);
    if (isNaN(z)) {
      continue;
    }

    area.polygon.push({ x, z });
  }

  areas.push(area);
  return idx;
}

function parseAreasDef(str: string): Area[] | undefined {
  let areas: Area[] = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] == "y") {
      i += parseAreaDef(str.substring(i), areas);
    } else {
      i++;
    }
  }

  if (areas.length == 0) {
    return undefined;
  }

  return areas;
}

export default function AreaMenu(ps: AreaMenuProps) {
  const [getShowDetails, setShowDetails] = createSignal<boolean>(false);

  const selectedArea = () => ps.currentAreaIdx !== undefined ? ps.areas[ps.currentAreaIdx] : undefined;

  const setY = (element: Element) => {
    const newNum = parseInt(element.textContent);
    if (isNaN(newNum)) {
      element.textContent = ps.areas[ps.currentAreaIdx].y + "";
      return;
    }
    ps.setAreas(ps.currentAreaIdx, "y", newNum);
    element.textContent = ps.areas[ps.currentAreaIdx].y + "";
  };

  const setCoordName = (coordName: keyof Point, index: number, element: Element) => {
    const newNum = parseInt(element.textContent);
    if (isNaN(newNum)) {
      element.textContent = ps.areas[ps.currentAreaIdx].polygon[index][coordName] + "";
      return;
    }
    ps.setAreas(ps.currentAreaIdx, "polygon", index, coordName, newNum);
    element.textContent = ps.areas[ps.currentAreaIdx].polygon[index][coordName] + "";
  };

  const setCoordX = (index: number, element: Element) => {
    setCoordName("x", index, element);
  };
  const setCoordZ = (index: number, element: Element) => {
    setCoordName("z", index, element);
  };

  const addNewArea = () => {
    ps.setAreas(ps.areas.length, { y: 0, polygon: [] });
    ps.setCurrentArea(ps.areas.length - 1);
  };

  const addNewVertex = () => {
    const polygon = ps.areas[ps.currentAreaIdx].polygon;
    const lastVertex = polygon[polygon.length - 1];
    const newVertex = { x: lastVertex?.x || 0, z: lastVertex?.z || 0 };
    ps.setAreas(
      ps.currentAreaIdx,
      "polygon",
      polygon.length,
      newVertex,
    );
  };

  const moveVertex = (index: number, moveDown: boolean) => {
    ps.setAreas(
      ps.currentAreaIdx,
      "polygon",
      produce(vertices => {
        const swapIdx = moveDown ? index + 1 : index - 1;
        if (!vertices[swapIdx]) {
          return vertices;
        }
        [vertices[index], vertices[swapIdx]] = [vertices[swapIdx], vertices[index]];
        return vertices;
      }),
    );
  };

  const deleteVertex = (index: number) => {
    ps.setAreas(
      ps.currentAreaIdx,
      "polygon",
      vertices => vertices.filter((_, idx) => idx !== index),
    );
  };

  const deleteArea = (index: number) => {
    if (ps.currentAreaIdx == index) {
      ps.setCurrentArea(undefined);
    } else if (ps.currentAreaIdx > index) {
      ps.setCurrentArea(ps.currentAreaIdx - 1);
    }
    ps.setAreas(
      areas => areas.filter((_, idx) => idx !== index),
    );
  };

  const [getCopyCheckTimer, setCopyCheckTimer] = createSignal<number | undefined>(undefined);
  const areaToClipboard = () => {
    const area = ps.areas[ps.currentAreaIdx];

    let lines = [];

    lines.push(`y = ${area.y},`);
    lines.push(`polygon = {`);
    for (const point of area.polygon) {
      lines.push(`    { x = ${point.x}, z = ${point.z} },`);
    }
    lines.push(`},`);

    navigator.clipboard.writeText(lines.join("\n"));

    if (getCopyCheckTimer() !== undefined) {
      clearTimeout(getCopyCheckTimer());
    }
    setCopyCheckTimer(setTimeout(() => {
      setCopyCheckTimer(undefined);
    }, 2000));
  };

  const importAreas = (str: string) => {
    const newAreas = parseAreasDef(str);
    if (newAreas) {
      ps.setAreas(newAreas);
    }
  };

  return (
    <div class="h-full absolute right-0 top-0 overflow-y-auto m-0 p-0" style={{ "width": "20%", "min-width": "12rem" }}>
      <div class="w-full bg-black bg-opacity-90 m-0 rounded-sm">
        {/* Details expand */}
        <div onClick={() => setShowDetails(!getShowDetails())} class="cursor-pointer px-2 py-1 font-bold">
          <span class="font-mono">{getShowDetails() ? "—" : "▼"}</span> Areas
        </div>

        <Show when={getShowDetails()}>
          {/* Current area editing */}
          <Show when={ps.currentAreaIdx != undefined}>
            <div style={{ height: "50%" }} class="border-t border-t-white p-2">
              <span class="font-semibold">
                Editing: <span class="text-yellow-100">Area #{ps.currentAreaIdx + 1}</span>
                <Show
                  when={getCopyCheckTimer() === undefined}
                  fallback={<IoCheckmarkDoneSharp size={18} class="font-bold inline-block ml-2 text-green-300"></IoCheckmarkDoneSharp>}
                >
                  <IoCopy
                    class="inline-block ml-2 text-blue-300 cursor-pointer"
                    size={18}
                    onClick={() => areaToClipboard()}
                  >
                  </IoCopy>
                </Show>
              </span>
              <div class="py-2">
                <span class="font-semibold">Y:</span>{" "}
                <span
                  contentEditable={true}
                  class="p-1 font-mono text-blue-300"
                  onFocusOut={e => setY(e.target)}
                >
                  {selectedArea()?.y}
                </span>
              </div>
              <div>
                <span class="font-semibold">Vertices (x, y):</span>
                <ul class="font-mono">
                  <For each={selectedArea()?.polygon}>
                    {(item, index) => (
                      <li>
                        <span class="cursor-pointer text-lime-300" onClick={() => moveVertex(index(), false)}>
                          <IoChevronUp class="inline-block"></IoChevronUp>
                        </span>
                        <span class="cursor-pointer text-lime-300" onClick={() => moveVertex(index(), true)}>
                          <IoChevronDown class="inline-block"></IoChevronDown>
                        </span>
                        <span class="cursor-pointer px-1 text-red-300" onClick={() => deleteVertex(index())}>
                          —
                        </span>
                        (<span
                          contentEditable={true}
                          class="p-1 text-blue-300"
                          onFocusOut={e => setCoordX(index(), e.target)}
                        >
                          {item.x.toFixed(0)}
                        </span>,
                        <span
                          contentEditable={true}
                          class="p-1 text-blue-300"
                          onFocusOut={e => setCoordZ(index(), e.target)}
                        >
                          {item.z.toFixed(0)}
                        </span>)
                      </li>
                    )}
                  </For>
                </ul>
                <div
                  class="cursor-pointer hover:underline font-bold border rounded-sm px-2 my-1"
                  onClick={() => addNewVertex()}
                >
                  Add vertex
                </div>
              </div>
            </div>
          </Show>

          {/* Area list */}
          <div class="border-t border-t-white p-1">
            <span class="font-semibold">Current areas:</span>
            <ul>
              <For each={ps.areas}>
                {(item, index) => (
                  <li>
                    <span class="cursor-pointer px-1 text-red-300 font-mono" onClick={() => deleteArea(index())}>
                      —
                    </span>
                    <span class="text-yellow-100 cursor-pointer hover:underline" onClick={() => ps.setCurrentArea(index())}>Area #{index() + 1}</span>
                  </li>
                )}
              </For>
            </ul>
            <div
              class="cursor-pointer hover:underline font-bold border px-2 my-1 rounded-sm"
              onClick={() => addNewArea()}
            >
              Add area
            </div>
            <textarea
              class="font-bold border px-2 my-1 rounded-sm w-full h-7 overflow-hidden"
              onInput={e => {
                importAreas(e.target.value);
                e.target.value = "";
              }}
              placeholder="Paste to import"
            >
            </textarea>
          </div>
        </Show>
      </div>
    </div>
  );
}
