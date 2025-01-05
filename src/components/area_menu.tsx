import { IoCheckmarkDoneSharp, IoChevronDown, IoChevronUp, IoCopy, IoExitOutline, IoEye, IoEyeOff, IoLocate, IoTrash } from "solid-icons/io";
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce, SetStoreFunction } from "solid-js/store";

export interface AreaMenuProps {
  showDetails: boolean;
  setShowDetails: (show: boolean) => any;
  areas: Area[];
  setAreas: SetStoreFunction<Area[]>;
  selectedAreaIdx: number | undefined;
  setSelectedAreaIdx: (newIdx: number | undefined) => any;
  selectedSubPolygonIdx: number | undefined;
  setSelectedSubPolygonIdx: (newIdx: number | undefined) => any;
  selectedVertexIdx: number | undefined;
  setSelectedVertexIdx: (newIdx: number | undefined) => any;
}

export interface Point {
  x: number;
  z: number;
}

export interface Area {
  y: number;
  polygon: Point[];
  holes?: Point[][];
  hidden?: boolean;
  description?: string;
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

  const setAreaDescription = (description: string) => {

  };

  const setActivePoints = (...args: any[]) => {
    const setPoints = ps.selectedSubPolygonIdx === undefined
      ? ps.setAreas.bind(null, ps.selectedAreaIdx, "polygon")
      : ps.setAreas.bind(null, ps.selectedAreaIdx, "holes", ps.selectedSubPolygonIdx);

    return setPoints(...args);
  };

  const setCoordName = (coordName: keyof Point, index: number, element: Element) => {
    const newNum = parseInt(element.textContent);
    if (isNaN(newNum)) {
      element.textContent = ps.areas[ps.selectedAreaIdx].polygon[index][coordName] + "";
      return;
    }
    setActivePoints(index, coordName, newNum);
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
    ps.setSelectedAreaIdx(ps.areas.length - 1);
  };

  const addNewHole = () => {
    if (ps.selectedVertexIdx !== undefined) {
      ps.setSelectedVertexIdx(undefined);
    }

    if (ps.areas[ps.selectedAreaIdx].holes == undefined) {
      // First hole
      ps.setAreas(
        ps.selectedAreaIdx,
        "holes",
        [[]],
      );
      ps.setSelectedSubPolygonIdx(0);
    } else {
      // Additional hole
      ps.setAreas(
        ps.selectedAreaIdx,
        "holes",
        ps.areas[ps.selectedAreaIdx].holes.length,
        [],
      );
      ps.setSelectedSubPolygonIdx(ps.areas[ps.selectedAreaIdx].holes.length - 1);
    }
  };

  const addNewVertex = () => {
    const isSubPolygon = ps.selectedSubPolygonIdx !== undefined;
    const points = isSubPolygon ? ps.areas[ps.selectedAreaIdx].holes[ps.selectedSubPolygonIdx] : ps.areas[ps.selectedAreaIdx].polygon;

    const vertexToCopy = ps.selectedVertexIdx !== undefined ? points[ps.selectedVertexIdx] : points[points.length - 1];
    const newVertex = { x: vertexToCopy?.x || 0, z: vertexToCopy?.z || 0 };

    if (ps.selectedVertexIdx !== undefined) {
      // Insert after selected
      setActivePoints(produce<Point[]>(vertices => {
        vertices.splice(ps.selectedVertexIdx + 1, 0, newVertex);
        return vertices;
      }));
      ps.setSelectedVertexIdx(ps.selectedVertexIdx + 1);
    } else {
      // Insert at the end
      setActivePoints(points.length, newVertex);
      ps.setSelectedVertexIdx(points.length - 1);
    }
  };

  const moveVertex = (index: number, moveDown: boolean) => {
    const isSubPolygon = ps.selectedSubPolygonIdx !== undefined;
    const vertexCount = isSubPolygon ? ps.areas[ps.selectedAreaIdx].holes[ps.selectedSubPolygonIdx].length : ps.areas[ps.selectedAreaIdx].polygon.length;

    const swapIdx = moveDown ? index + 1 : index - 1;
    if (swapIdx < 0 || swapIdx >= vertexCount) {
      return;
    }

    if (ps.selectedVertexIdx == index) {
      ps.setSelectedVertexIdx(swapIdx);
    }

    setActivePoints(produce(vertices => {
      if (!vertices[swapIdx]) {
        return vertices;
      }
      [vertices[index], vertices[swapIdx]] = [vertices[swapIdx], vertices[index]];
      return vertices;
    }));
  };

  const deleteVertex = (index: number) => {
    const isSubPolygon = ps.selectedSubPolygonIdx !== undefined;
    const currentPointCount = isSubPolygon
      ? ps.areas[ps.selectedAreaIdx].holes[ps.selectedSubPolygonIdx].length
      : ps.areas[ps.selectedAreaIdx].polygon.length;

    if (ps.selectedVertexIdx == index && index == currentPointCount - 1) {
      ps.setSelectedVertexIdx(undefined);
    }

    setActivePoints(vertices => vertices.filter((_, idx) => idx !== index));
  };

  // Clear selected vertex and hole on area change
  createEffect(on(() => ps.selectedAreaIdx, () => {
    ps.setSelectedVertexIdx(undefined);
    ps.setSelectedSubPolygonIdx(undefined);
  }));

  // Clear selected vertex on sub polygon change
  createEffect(on(() => ps.selectedSubPolygonIdx, () => {
    ps.setSelectedVertexIdx(undefined);
  }));

  const deleteArea = (index: number) => {
    if (ps.selectedAreaIdx == index) {
      ps.setSelectedAreaIdx(undefined);
    } else if (ps.selectedAreaIdx > index) {
      ps.setSelectedAreaIdx(ps.selectedAreaIdx - 1);
    }
    ps.setAreas(areas => areas.filter((_, idx) => idx !== index));
  };

  const deleteHole = (index: number) => {
    if (ps.selectedSubPolygonIdx == index) {
      ps.setSelectedSubPolygonIdx(undefined);
    } else if (ps.selectedSubPolygonIdx > index) {
      ps.setSelectedSubPolygonIdx(ps.selectedSubPolygonIdx - 1);
    }
    ps.setAreas(ps.selectedAreaIdx, "holes", holes => holes.filter((_, idx) => idx !== index));
  };

  const [copyTimers, setCopyTimers] = createStore<{ [idx: number]: number; }>({});
  const areaToClipboard = (index?: number) => {
    const idxToUse = index ?? ps.selectedAreaIdx;
    const area = ps.areas[idxToUse];

    let lines = [];

    if (area.description) {
      lines.push(`-- ${area.description.trim()}`);
    }
    lines.push(`y = ${area.y},`);
    lines.push(`polygon = {`);
    for (const point of area.polygon) {
      lines.push(`    { x = ${point.x}, z = ${point.z} },`);
    }
    lines.push(`},`);
    if (area.holes?.length > 0) {
      lines.push(`holes = {`);
      for (const hole of area.holes) {
        lines.push(`    {`);
        for (const point of hole) {
          lines.push(`        { x = ${point.x}, z = ${point.z} },`);
        }
        lines.push(`    },`);
      }
      lines.push(`},`);
    }

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
      ps.setSelectedAreaIdx(undefined);
      ps.setSelectedSubPolygonIdx(undefined);
      ps.setSelectedVertexIdx(undefined);
    }
  };

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key == "Escape") {
      if (ps.selectedVertexIdx !== undefined) {
        ps.setSelectedVertexIdx(undefined);
      } else if (ps.selectedAreaIdx !== undefined) {
        ps.setSelectedAreaIdx(undefined);
      }
      return;
    }

    // Remaining actions require Shift to be held and a selected vertex
    if (!e.shiftKey || ps.selectedVertexIdx === undefined) {
      return;
    }

    const el = e.target as any;
    if (el.contentEditable == "true" || el.tagName == "input") {
      return;
    }

    function changeCoord(coordName: keyof Point, valueChangeFn: (c: number) => number) {
      setActivePoints(ps.selectedVertexIdx, coordName, valueChangeFn);
    }

    const diff = e.ctrlKey ? 5 : 1;
    switch (e.key) {
      case "ArrowLeft":
        changeCoord("x", x => x - diff);
        break;
      case "ArrowRight":
        changeCoord("x", x => x + diff);
        break;
      case "ArrowUp":
        changeCoord("z", z => z + diff);
        break;
      case "ArrowDown":
        changeCoord("z", z => z - diff);
        break;
      case "N":
        addNewVertex();
        break;
      default:
        return;
    }

    e.preventDefault();
  }

  const toggleAllAreasHidden = () => {
    const newHidden = ps.areas.some(area => !area.hidden);
    ps.setAreas({ from: 0, to: ps.areas.length - 1 }, "hidden", newHidden);
  };

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
                <span class="flex-grow text-lg">
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
                  <Show when={ps.selectedSubPolygonIdx !== undefined}>
                    <span class="ml-1">Hole {ps.selectedSubPolygonIdx + 1}</span>
                  </Show>
                </span>
                <span class="cursor-pointer" onClick={() => ps.setSelectedAreaIdx(undefined)}>
                  <IoExitOutline class="inline-block" title="Deselect current area"></IoExitOutline>
                </span>
              </div>

              <Show when={ps.areas[ps.selectedAreaIdx].holes?.length > 0}>
                <div>
                  <ul>
                    <li class="flex flex-row">
                      <span
                        class="text-blue-300 cursor-pointer hover:underline font-mono flex-grow"
                        onClick={() => ps.setSelectedSubPolygonIdx(undefined)}
                      >
                        Outline
                        <Show when={ps.selectedSubPolygonIdx === undefined}>
                          <span class="ml-1">
                            <IoLocate class="inline-block">
                            </IoLocate>
                          </span>
                        </Show>
                      </span>
                    </li>
                    <For each={ps.areas[ps.selectedAreaIdx].holes}>
                      {(item, index) => (
                        <li class="flex flex-row">
                          <span
                            class="text-blue-300 cursor-pointer hover:underline font-mono flex-grow"
                            onClick={() => ps.setSelectedSubPolygonIdx(index())}
                          >
                            Hole {index() + 1}
                            <Show when={ps.selectedSubPolygonIdx == index()}>
                              <span class="ml-1">
                                <IoLocate class="inline-block">
                                </IoLocate>
                              </span>
                            </Show>
                          </span>
                          <span class="cursor-pointer px-1 align-bottom text-red-300 font-mono" onClick={() => deleteHole(index())}>
                            <IoTrash class="inline-block"></IoTrash>
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>
              <div
                class="cursor-pointer hover:underline font-bold border rounded-sm px-2 my-1 text-blue-300"
                onClick={() => addNewHole()}
              >
                Add hole
              </div>

              <input
                class="m-0 mt-2 p-0 px-2 font-mono text-lime-300 bg-transparent rounded-sm w-full"
                placeholder="Area description"
                onInput={e => {
                  ps.setAreas(ps.selectedAreaIdx, "description", e.target.value);
                }}
                onFocusOut={e => {
                  ps.setAreas(ps.selectedAreaIdx, "description", e.target.value?.trim());
                }}
                value={selectedArea()?.description ?? ""}
              >
              </input>

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
                      <span class="cursor-pointer ml-1" onClick={() => ps.setSelectedVertexIdx(undefined)}>
                        <IoExitOutline class="inline-block" title="Deselect current vertex"></IoExitOutline>
                      </span>
                    </span>
                  </Show>
                </div>
                <ul class="font-mono">
                  <For each={ps.selectedSubPolygonIdx !== undefined ? selectedArea()?.holes[ps.selectedSubPolygonIdx] : selectedArea()?.polygon}>
                    {(item, index) => (
                      <li
                        class="cursor-pointer"
                        classList={{ "text-yellow-300": ps.selectedVertexIdx == index() }}
                        onClick={() => ps.setSelectedVertexIdx(index())}
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
            <div>
              <span
                class="px-0.5 mr-1 align-bottom cursor-pointer"
                onClick={toggleAllAreasHidden}
              >
                <Show
                  when={ps.areas.some(area => !area.hidden)}
                  fallback={<IoEyeOff class="inline-block text-gray-500"></IoEyeOff>}
                >
                  <IoEye class="inline-block"></IoEye>
                </Show>
              </span>
              <span class="font-semibold">Areas</span>
            </div>
            <ul>
              <For each={ps.areas}>
                {(item, index) => (
                  <li class="flex flex-row">
                    <span
                      class="px-0.5 align-bottom cursor-pointer"
                      onClick={() => ps.setAreas(index(), "hidden", !item.hidden)}
                    >
                      <Show
                        when={!item.hidden}
                        fallback={<IoEyeOff class="inline-block text-gray-500"></IoEyeOff>}
                      >
                        <IoEye class="inline-block"></IoEye>
                      </Show>
                    </span>
                    <span class="px-1 align-bottom">
                      <Show
                        when={copyTimers[index()] === undefined}
                        fallback={<IoCheckmarkDoneSharp class="font-bold inline-block text-green-300"></IoCheckmarkDoneSharp>}
                      >
                        <IoCopy
                          class="inline-block cursor-pointer"
                          onClick={() => areaToClipboard(index())}
                          title="Copy area to clipboard"
                        >
                        </IoCopy>
                      </Show>
                    </span>
                    <span
                      class="text-blue-300 cursor-pointer hover:underline font-mono whitespace-nowrap"
                      onClick={() => ps.setSelectedAreaIdx(index())}
                    >
                      Area {index() + 1}
                    </span>
                    <Show when={item.description} fallback={<span class="flex-grow"></span>}>
                      <span
                        class="mx-3 text-gray-400 text-xs font-mono inline-block flex-grow whitespace-nowrap overflow-hidden"
                        style={{ "align-content": "center", "text-overflow": "ellipsis" }}
                        title={item.description}
                      >
                        [{item.description}]
                      </span>
                    </Show>
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
const XZ_PATTERN = /^\{\s*x\s*=\s*(\-?\d+)\s*,\s*z\s*=\s*(\-?\d+),?\s*\}\s*,?/;
const HOLES_PATTERN = /^holes\s*=\s*\{/;
const START_BRACKET = /^\{/;
const END_BRACKET = /^\},?/;
const COMMENT_PATTERN = /--([^\r\n]+)\r?\n/;

function skipWhitespaceAndComments(str: string): number {
  let idx = 0;
  while (idx < str.length) {
    switch (str[idx]) {
      case " ":
      case "\n":
      case "\r":
        idx++;
        continue;
      case "-":
        // Skip comment lines
        if (str[idx + 1] == "-") {
          idx += 2;
          while (idx < str.length && str[idx] != "\n") {
            idx++;
          }
          idx++;
          continue;
        }
        break;
      default:
        break;
    }

    break;
  }
  return idx;
}

/// Returns the number of characters to skip to proceed
function parseAreaDef(fullStr: string, startIdx: number, areas: Area[]): number {
  const str = fullStr.substring(startIdx);

  // Parse y
  const yMatch = Y_PATTERN.exec(str);
  if (!yMatch) {
    return 1;
  }

  const y = parseFloat(yMatch[1]);
  if (isNaN(y)) {
    return 1;
  }
  let idx = yMatch[0].length;
  idx += skipWhitespaceAndComments(str.substring(idx));

  // Find polygon key
  const polygonMatch = POLYGON_PATTERN.exec(str.substring(idx));
  if (!polygonMatch) {
    return 1;
  }
  idx += polygonMatch[0].length;
  idx += skipWhitespaceAndComments(str.substring(idx));

  let area: Area = {
    y,
    polygon: [],
  };

  // Parse polygon points
  while (true) {
    const xzMatch = XZ_PATTERN.exec(str.substring(idx));
    if (!xzMatch) {
      break;
    }
    idx += xzMatch[0].length;
    idx += skipWhitespaceAndComments(str.substring(idx));

    const x = parseFloat(xzMatch[1]);
    if (isNaN(x)) {
      continue;
    }
    const z = parseFloat(xzMatch[2]);
    if (isNaN(z)) {
      continue;
    }

    area.polygon.push({ x, z });
  }

  // End polygon table
  const endBracketMatch = END_BRACKET.exec(str.substring(idx));
  if (!endBracketMatch) {
    return 1;
  }
  idx += endBracketMatch[0].length;
  idx += skipWhitespaceAndComments(str.substring(idx));

  // Parse holes, if any
  const holesMatch = HOLES_PATTERN.exec(str.substring(idx));
  if (holesMatch) {
    idx += holesMatch[0].length;
    idx += skipWhitespaceAndComments(str.substring(idx));

    idx += parseHoles(str.substring(idx), area);

    const endBracketMatch = END_BRACKET.exec(str.substring(idx));
    if (!endBracketMatch) {
      return 1;
    }
    idx += endBracketMatch[0].length;
    idx += skipWhitespaceAndComments(str.substring(idx));
  }

  // Find description before startIdx
  // Skip to start of line before startIdx
  let descIdx = startIdx
  while (descIdx >= 0 && fullStr[descIdx] != "\n") {
    descIdx--;
  }
  descIdx--;
  while (descIdx >= 0 && fullStr[descIdx] != "\n") {
    descIdx--;
  }
  if (descIdx < 0) {
    descIdx = 0;
  }
  const commentMatch = COMMENT_PATTERN.exec(fullStr.substring(descIdx, startIdx));
  if (commentMatch) {
    area.description = commentMatch[1].trim();
  }

  areas.push(area);
  return idx;
}

function parseHoles(str: string, area: Area): number {
  let idx = 0;

  area.holes = [];

  while (idx < str.length) {
    const startBracketMatch = START_BRACKET.exec(str.substring(idx));
    if (!startBracketMatch) {
      break;
    }
    idx += startBracketMatch[0].length;
    idx += skipWhitespaceAndComments(str.substring(idx));

    let hole = [];
    // Parse hole points
    while (true) {
      const xzMatch = XZ_PATTERN.exec(str.substring(idx));
      if (!xzMatch) {
        break;
      }
      idx += xzMatch[0].length;
      idx += skipWhitespaceAndComments(str.substring(idx));

      const x = parseFloat(xzMatch[1]);
      if (isNaN(x)) {
        continue;
      }
      const z = parseFloat(xzMatch[2]);
      if (isNaN(z)) {
        continue;
      }

      hole.push({ x, z });
    }

    const endBracketMatch = END_BRACKET.exec(str.substring(idx));
    if (!endBracketMatch) {
      return 0;
    }
    idx += endBracketMatch[0].length;
    idx += skipWhitespaceAndComments(str.substring(idx));

    area.holes.push(hole);
  }

  return idx;
}

function parseAreasDef(str: string): Area[] | undefined {
  let areas: Area[] = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] == "y") {
      i += parseAreaDef(str, i, areas);
    } else {
      i++;
    }
  }

  if (areas.length == 0) {
    return undefined;
  }

  return areas;
}
