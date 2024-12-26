import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";

import { Chart, ChartData, ChartOptions, Colors, Legend, Title, Tooltip } from "chart.js";
import { Bar } from "solid-chartjs";
import { Position } from "../parse_packets";
import { PathPart, PathPartKind } from "../parse_path";

export interface PathVisualsProps {
  path: PathPart[];
}

export default function PathVisualsComponent(ps: PathVisualsProps) {
  const [getShowRaw, setShowRaw] = createSignal<boolean>(false);

  onMount(() => {
    Chart.register(Title, Tooltip, Legend, Colors);
    Chart.defaults.color = "#FFFFFF";
  });

  onCleanup(() => {
    Chart.unregister(Title, Tooltip, Legend, Colors);
  });

  // Construct Bar chart for pause times
  const pauseTimeBars = createMemo(() => {
    const pathData = ps.path;
    if (!pathData) {
      return;
    }

    const waitTimes: number[] = [];
    let minTime = Number.MAX_SAFE_INTEGER;
    let maxTime = Number.MIN_SAFE_INTEGER;

    for (const part of pathData) {
      if (part.kind == PathPartKind.Start) {
        const seconds = part.pauseTime / 1000;
        waitTimes.push(seconds);
        minTime = Math.min(minTime, seconds);
        maxTime = Math.max(maxTime, seconds);
      }
    }

    const timeDiff = maxTime - minTime;
    const barCount = timeDiff + 1;
    const bucketSize = 1;

    let bars: number[] = new Array(barCount).fill(0);
    for (const waitTime of waitTimes) {
      const barIdx = Math.floor((waitTime - minTime) / bucketSize);
      bars[barIdx]++;
    }

    const labels = new Array(barCount).fill("").map((_, idx) => `${(minTime + idx * bucketSize)}`);

    const chartData: ChartData = {
      labels,
      datasets: [
        {
          label: "Pause times (seconds)",
          data: bars,
        },
      ],
    };

    const options: ChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
    };

    return (
      <Bar
        data={chartData}
        options={options}
      >
      </Bar>
    );
  });

  // Construct Bar chart for amount of turns per movement
  const turnBars = createMemo(() => {
    const pathData = ps.path;
    if (!pathData) {
      return;
    }

    const turnCounts: number[] = [];
    let minTurns = Number.MAX_SAFE_INTEGER;
    let maxTurns = Number.MIN_SAFE_INTEGER;

    let turnCount = 0;
    for (const part of pathData) {
      if (part.kind == PathPartKind.Start) {
        turnCount = 0;
      } else if (part.kind == PathPartKind.End) {
        turnCounts.push(turnCount);
        minTurns = Math.min(minTurns, turnCount);
        maxTurns = Math.max(maxTurns, turnCount);
        turnCount = 0;
      } else if (part.kind == PathPartKind.NewDirection) {
        turnCount++;
      }
    }

    const diff = maxTurns - minTurns;
    const barCount = diff + 1;
    const bucketSize = 1;

    let bars: number[] = new Array(barCount).fill(0);
    for (const turnCount of turnCounts) {
      const barIdx = Math.floor((turnCount - minTurns) / bucketSize);
      bars[barIdx]++;
    }

    const labels = new Array(barCount).fill("").map((_, idx) => `${(minTurns + idx * bucketSize)}`);

    const chartData: ChartData = {
      labels,
      datasets: [
        {
          label: "Turns per movement",
          data: bars,
        },
      ],
    };

    const options: ChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
    };

    return (
      <Bar
        data={chartData}
        options={options}
      >
      </Bar>
    );
  });

  // Construct Bar chart for distance travelled per turn
  const distBars = createMemo(() => {
    const pathData = ps.path;
    if (!pathData) {
      return;
    }

    const distances: number[] = [];
    let minDist = Number.MAX_SAFE_INTEGER;
    let maxDist = Number.MIN_SAFE_INTEGER;

    for (const part of pathData) {
      if (part.kind == PathPartKind.End) {
        minDist = Math.min(minDist, part.legDist);
        maxDist = Math.max(maxDist, part.legDist);
        distances.push(part.legDist);
      } else if (part.kind == PathPartKind.NewDirection) {
        minDist = Math.min(minDist, part.walkDist);
        maxDist = Math.max(maxDist, part.walkDist);
        distances.push(part.walkDist);
      }
    }

    const diff = maxDist - minDist;
    const barCount = 20;
    const bucketSize = diff / barCount;

    let bars: number[] = new Array(barCount).fill(0);
    for (const dist of distances) {
      const barIdx = Math.floor((dist - minDist) / bucketSize);
      bars[barIdx]++;
    }

    const labels = new Array(barCount).fill("").map((_, idx) => `${(minDist + (idx + 0.5) * bucketSize).toFixed(1)}`);

    const chartData: ChartData = {
      labels,
      datasets: [
        {
          label: "Distance per turn",
          data: bars,
        },
      ],
    };

    const options: ChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
    };

    return (
      <Bar
        data={chartData}
        options={options}
      >
      </Bar>
    );
  });

  // Construct Bar chart for rotation change per turn
  const rotDiffBars = createMemo(() => {
    const pathData = ps.path;
    if (!pathData) {
      return;
    }

    const rotDiffs: number[] = [];

    for (const part of pathData) {
      if (part.kind == PathPartKind.Start) {
        rotDiffs.push(part.rotDiff);
      } else if (part.kind == PathPartKind.NewDirection) {
        rotDiffs.push(part.rotDiff);
      }
    }

    const bucketSize = 8;
    const barCount = 256 / bucketSize;
    const minRotDiff = -128;

    let bars: number[] = new Array(barCount).fill(0);
    for (const rotDiff of rotDiffs) {
      const barIdx = Math.floor((rotDiff - minRotDiff) / bucketSize);
      bars[barIdx]++;
    }

    const labels = new Array(barCount).fill("").map((_, idx) => `${(minRotDiff + idx * bucketSize)}-${(minRotDiff + (idx + 1) * bucketSize)}`);

    const chartData: ChartData = {
      labels,
      datasets: [
        {
          label: "Rotation diff per turn",
          data: bars,
        },
      ],
    };

    const options: ChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
    };

    return (
      <Bar
        data={chartData}
        options={options}
      >
      </Bar>
    );
  });

  function formatPos(pos: Position): string {
    return `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`;
  }

  function formatTime(time: number): string {
    return new Date(time).toLocaleTimeString();
  }

  function formatRawPathPart(part: PathPart) {
    switch (part.kind) {
      case PathPartKind.Start:
        return `${formatTime(part.time)} - Waited ${part.pauseTime / 1000}s and now moving towards ${part.rot} (diff: ${part.rotDiff})`;
      case PathPartKind.End:
        return `${formatTime(part.time)} - Moved for ${part.moveTime / 1000}s before stopping. Travelled ${part.legDist.toFixed(1)} yalms since last. [${
          formatPos(part.startPos)
        } -> ${formatPos(part.endPos)}]`;
      case PathPartKind.NewDirection:
        return `${formatTime(part.time)} - Changed direction after ${part.walkTime / 1000}s and ${
          part.walkDist.toFixed(1)
        } yalms towards ${part.rot} (diff: ${part.rotDiff})`;
    }

    return "**unhandled**";
  }

  function formatRawPath(): string {
    let lines = [];
    for (const part of ps.path) {
      lines.push(formatRawPathPart(part));
    }
    return lines.join("\n");
  }

  return (
    <div class="mt-5 mb-2 p-3 bg-slate-800 rounded">
      <div class="p-5 border border-black" style={{ "max-height": "35vh" }}>
        {turnBars()}
      </div>
      <div class="p-5 mb-2 border border-black" style={{ "max-height": "35vh" }}>
        {pauseTimeBars()}
      </div>
      <div class="p-5 mb-2 border border-black" style={{ "max-height": "35vh" }}>
        {distBars()}
      </div>
      <div class="p-5 mb-2 border border-black" style={{ "max-height": "35vh" }}>
        {rotDiffBars()}
      </div>
      <div>
        <button
          onClick={() => setShowRaw(!getShowRaw())}
        >
          {getShowRaw() ? "Hide raw parse" : "Show raw parse"}
        </button>
        <Show when={getShowRaw()}>
          <textarea class="font-mono block w-full h-60">
            {formatRawPath()}
          </textarea>
        </Show>
      </div>
    </div>
  );
}
