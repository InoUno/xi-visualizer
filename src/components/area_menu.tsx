import { IoCheckmarkDoneSharp, IoChevronDown, IoChevronUp, IoCopy, IoExitOutline, IoLocate, IoTrash } from "solid-icons/io";
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce, SetStoreFunction } from "solid-js/store";

export interface AreaMenuProps {
  showDetails: boolean;
  setShowDetails: (show: boolean) => any;
  areas: Area[];
  setAreas: SetStoreFunction<Area[]>;
  selectedAreaIdx: number | undefined;
  setSelectedArea: (newIdx: number) => any;
  selectedVertexIdx: number | undefined;
  setSelectedVertex: (newIdx: number) => any;
}

export interface Point {
  x: number;
  z: number;
}

export interface Area {
  y: number;
  polygon: Point[];
}

export default function AreaMenu(ps: AreaMenuProps) {
  const selectedArea = () => ps.selectedAreaIdx !== undefined ? ps.areas[ps.selectedAreaIdx] : undefined;

  const setY = (element: Element) => {
    const newNum = parseInt(element.textContent);
    if (isNaN(newNum)) {
      element.textContent = ps.areas[ps.selectedAreaIdx].y + "";
      return;
    }
    ps.setAreas(ps.selectedAreaIdx, "y", newNum);
    element.textContent = ps.areas[ps.selectedAreaIdx].y + "";
  };

  const setCoordName = (coordName: keyof Point, index: number, element: Element) => {
    const newNum = parseInt(element.textContent);
    if (isNaN(newNum)) {
      element.textContent = ps.areas[ps.selectedAreaIdx].polygon[index][coordName] + "";
      return;
    }
    ps.setAreas(ps.selectedAreaIdx, "polygon", index, coordName, newNum);
    element.textContent = ps.areas[ps.selectedAreaIdx].polygon[index][coordName] + "";
  };

  const setCoordX = (index: number, element: Element) => {
    setCoordName("x", index, element);
  };
  const setCoordZ = (index: number, element: Element) => {
    setCoordName("z", index, element);
  };

  const addNewArea = () => {
    ps.setAreas(ps.areas.length, { y: 0, polygon: [] });
    ps.setSelectedArea(ps.areas.length - 1);
  };

  const addNewVertex = () => {
    const polygon = ps.areas[ps.selectedAreaIdx].polygon;
    const lastVertex = polygon[polygon.length - 1];
    const newVertex = { x: lastVertex?.x || 0, z: lastVertex?.z || 0 };
    ps.setAreas(
      ps.selectedAreaIdx,
      "polygon",
      polygon.length,
      newVertex,
    );
  };

  const moveVertex = (index: number, moveDown: boolean) => {
    let swapIdx = moveDown ? index + 1 : index - 1;

    const vertexCount = ps.areas[ps.selectedAreaIdx].polygon.length;
    if (swapIdx < 0 || swapIdx >= vertexCount) {
      return;
    }

    if (ps.selectedVertexIdx == index) {
      ps.setSelectedVertex(swapIdx);
    }

    ps.setAreas(
      ps.selectedAreaIdx,
      "polygon",
      produce(vertices => {
        if (!vertices[swapIdx]) {
          return vertices;
        }
        [vertices[index], vertices[swapIdx]] = [vertices[swapIdx], vertices[index]];
        return vertices;
      }),
    );
  };

  const deleteVertex = (index: number) => {
    if (ps.selectedVertexIdx == index) {
      ps.setSelectedVertex(undefined);
    }
    ps.setAreas(
      ps.selectedAreaIdx,
      "polygon",
      vertices => vertices.filter((_, idx) => idx !== index),
    );
  };

  // Clear selected vertex on area change
  createEffect(on(() => ps.selectedAreaIdx, () => {
    ps.setSelectedVertex(undefined);
  }));

  const deleteArea = (index: number) => {
    if (ps.selectedAreaIdx == index) {
      ps.setSelectedArea(undefined);
    } else if (ps.selectedAreaIdx > index) {
      ps.setSelectedArea(ps.selectedAreaIdx - 1);
    }
    ps.setAreas(
      areas => areas.filter((_, idx) => idx !== index),
    );
  };

  const [copyTimers, setCopyTimers] = createStore<{ [idx: number]: number; }>({});
  const areaToClipboard = (index?: number) => {
    const idxToUse = index ?? ps.selectedAreaIdx;
    const area = ps.areas[idxToUse];

    let lines = [];

    lines.push(`y = ${area.y},`);
    lines.push(`polygon = {`);
    for (const point of area.polygon) {
      lines.push(`    { x = ${point.x}, z = ${point.z} },`);
    }
    lines.push(`},`);

    navigator.clipboard.writeText(lines.join("\n"));

    if (copyTimers[idxToUse] !== undefined) {
      clearTimeout(copyTimers[idxToUse]);
    }
    setCopyTimers(
      idxToUse,
      setTimeout(() => {
        setCopyTimers(idxToUse, undefined);
      }, 1000),
    );
  };

  const importAreas = (str: string) => {
    const newAreas = parseAreasDef(str);
    if (newAreas) {
      ps.setAreas(newAreas);
      ps.setSelectedVertex(undefined);
      ps.setSelectedArea(undefined);
    }
  };

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key == "Escape") {
      if (ps.selectedVertexIdx !== undefined) {
        ps.setSelectedVertex(undefined);
      } else if (ps.selectedAreaIdx !== undefined) {
        ps.setSelectedArea(undefined);
      }
      return;
    }
    if (!e.shiftKey || ps.selectedVertexIdx === undefined) {
      return;
    }

    const el = e.target as any;
    if (el.contentEditable == "true" || el.tagName == "input") {
      return;
    }

    switch (e.key) {
      case "ArrowLeft":
        ps.setAreas(ps.selectedAreaIdx, "polygon", ps.selectedVertexIdx, "x", x => x - 1);
        break;
      case "ArrowRight":
        ps.setAreas(ps.selectedAreaIdx, "polygon", ps.selectedVertexIdx, "x", x => x + 1);
        break;
      case "ArrowUp":
        ps.setAreas(ps.selectedAreaIdx, "polygon", ps.selectedVertexIdx, "z", z => z + 1);
        break;
      case "ArrowDown":
        ps.setAreas(ps.selectedAreaIdx, "polygon", ps.selectedVertexIdx, "z", z => z - 1);
        break;
      case "Escape":
      default:
        return;
    }

    e.preventDefault();
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div class="h-full absolute right-0 top-0 overflow-y-auto m-0 p-0 pointer-events-none noselect z-50" style={{ "width": "20%", "min-width": "12rem" }}>
      <div class="w-full bg-black bg-opacity-90 m-0 rounded-sm  pointer-events-auto">
        {/* Details expand */}
        <div onClick={() => ps.setShowDetails(!ps.showDetails)} class="cursor-pointer px-2 py-1 font-bold">
          <span class="font-mono">{ps.showDetails ? "—" : "▼"}</span> Area Manager
        </div>

        <Show when={ps.showDetails}>
          {/* Current area editing */}
          <Show when={ps.selectedAreaIdx != undefined}>
            <div style={{ height: "50%" }} class="border-t border-t-white p-2">
              <div class="flex flex-row font-semibold">
                <span class="flex-grow">
                  Editing: <span class="text-yellow-300">Area {ps.selectedAreaIdx + 1}</span>
                  <Show
                    when={copyTimers[ps.selectedAreaIdx] === undefined}
                    fallback={<IoCheckmarkDoneSharp size={18} class="font-bold inline-block ml-2 text-green-300"></IoCheckmarkDoneSharp>}
                  >
                    <IoCopy
                      class="inline-block ml-2 text-blue-300 cursor-pointer"
                      onClick={() => areaToClipboard()}
                      title="Copy area to clipboard"
                    >
                    </IoCopy>
                  </Show>
                </span>
                <span class="cursor-pointer" onClick={() => ps.setSelectedArea(undefined)}>
                  <IoExitOutline class="inline-block" title="Deselect current area"></IoExitOutline>
                </span>
              </div>
              <div class="py-2">
                <span class="font-semibold">Y:</span>{" "}
                <span
                  contentEditable={true}
                  class="p-1 font-mono text-lime-300"
                  onFocusOut={e => setY(e.target)}
                >
                  {selectedArea()?.y}
                </span>
              </div>
              <div>
                <div class="flex flex-row">
                  <span class="font-semibold flex-grow">Vertices (x, z)</span>
                  <Show when={ps.selectedVertexIdx !== undefined}>
                    <span class="font-mono">
                      <span class="cursor-pointer mr-1 text-red-300" onClick={() => deleteVertex(ps.selectedVertexIdx)}>
                        <IoTrash class="inline-block" title="Delete selected vertex"></IoTrash>
                      </span>
                      <span class="cursor-pointer text-lime-300" onClick={() => moveVertex(ps.selectedVertexIdx, false)}>
                        <IoChevronUp class="inline-block" title="Move selected vertex up"></IoChevronUp>
                      </span>
                      <span class="cursor-pointer text-lime-300" onClick={() => moveVertex(ps.selectedVertexIdx, true)}>
                        <IoChevronDown class="inline-block" title="Move selected vertex down"></IoChevronDown>
                      </span>
                      <span class="cursor-pointer ml-1" onClick={() => ps.setSelectedVertex(undefined)}>
                        <IoExitOutline class="inline-block" title="Deselect current vertex"></IoExitOutline>
                      </span>
                    </span>
                  </Show>
                </div>
                <ul class="font-mono">
                  <For each={selectedArea()?.polygon}>
                    {(item, index) => (
                      <li
                        class="cursor-pointer"
                        classList={{ "text-yellow-300": ps.selectedVertexIdx == index() }}
                        onClick={() => ps.setSelectedVertex(index())}
                      >
                        <span>
                          <span
                            classList={{ underline: ps.selectedVertexIdx == index() }}
                          >
                            {String.fromCharCode("A".charCodeAt(0) + index())}
                          </span>
                          : (<span
                            contentEditable={true}
                            class="p-1 text-lime-300 cursor-text"
                            onFocusOut={e => setCoordX(index(), e.target)}
                          >
                            {item.x.toFixed(0)}
                          </span>,
                          <span
                            contentEditable={true}
                            class="p-1 text-lime-300 cursor-text"
                            onFocusOut={e => setCoordZ(index(), e.target)}
                          >
                            {item.z.toFixed(0)}
                          </span>)
                        </span>
                        <Show when={ps.selectedVertexIdx == index()}>
                          <span class="ml-1">
                            <IoLocate
                              class="inline-block"
                              title="Hold shift and use arrow keys to move the point"
                            >
                            </IoLocate>
                          </span>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
                <div
                  class="cursor-pointer hover:underline font-bold border rounded-sm px-2 my-1 text-blue-300"
                  onClick={() => addNewVertex()}
                >
                  Add vertex
                </div>
              </div>
            </div>
          </Show>

          {/* Area list */}
          <div class="border-t border-t-white p-1">
            <span class="font-semibold">Areas</span>
            <ul>
              <For each={ps.areas}>
                {(item, index) => (
                  <li class="flex flex-row">
                    <span class="px-1 align-bottom">
                      <Show
                        when={copyTimers[index()] === undefined}
                        fallback={<IoCheckmarkDoneSharp class="font-bold inline-block text-green-300"></IoCheckmarkDoneSharp>}
                      >
                        <IoCopy
                          class="inline-block text-blue-300 cursor-pointer"
                          onClick={() => areaToClipboard(index())}
                          title="Copy area to clipboard"
                        >
                        </IoCopy>
                      </Show>
                    </span>
                    <span
                      class="text-blue-300 cursor-pointer hover:underline font-mono flex-grow"
                      onClick={() => ps.setSelectedArea(index())}
                    >
                      Area {index() + 1}
                    </span>
                    <span class="cursor-pointer px-1 align-bottom text-red-300 font-mono" onClick={() => deleteArea(index())}>
                      <IoTrash class="inline-block"></IoTrash>
                    </span>
                  </li>
                )}
              </For>
            </ul>
            <div
              class="cursor-pointer hover:underline font-bold border px-2 my-1 rounded-sm text-blue-300"
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
