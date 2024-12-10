import { createEffect, createMemo, createSignal, mergeProps } from "solid-js";
import "./range_input.css";

interface RangeInputProps {
  min: number;
  max: number;
  startMinPct?: number;
  startMaxPct?: number;
  step?: number;
  minDiff?: number;
  onChange?: (min: number, max: number) => any;
  inputKind?: "number" | "timestamp";
}

interface DragStartInfo {
  x: number;
  startMin: number;
  startMax: number;
}

export default function RangeInput(props: RangeInputProps) {
  // Default minimum step/diff of 1000ms = 1s,
  // else just 1 step size.
  const defaultStep = () => props.inputKind == "timestamp" ? 1000 : 1;
  const ps = mergeProps({
    step: defaultStep(),
    minDiff: defaultStep(),
  }, props);

  const diff = () => ps.max - ps.min;
  const [getCurrentMin, setCurrentMin] = createSignal<number>();
  const [getCurrentMax, setCurrentMax] = createSignal<number>();
  const [getStartDrag, setStartDrag] = createSignal<DragStartInfo | undefined>(undefined);

  createEffect(() => {
    setCurrentMin(ps.startMinPct ? (diff() * ps.startMinPct) / 100 + ps.min : ps.min);
  });
  createEffect(() => {
    setCurrentMax(ps.startMaxPct ? (diff() * ps.startMaxPct) / 100 + ps.min : ps.max);
  });

  createEffect(() => {
    if (ps.onChange) {
      ps.onChange(getCurrentMin(), getCurrentMax());
    }
  });

  // Setup handling of different kinds of inputs (number/time/datetime)
  let inputType = createMemo(() => {
    let type_: string = ps.inputKind;
    if (ps.inputKind == "timestamp") {
      // Determine if datetime is needed or just time.
      if (getDateFromTimestamp(ps.min) != getDateFromTimestamp(ps.max)) {
        // If min and max are different dates, use datetime.
        type_ = "datetime-local";
      } else {
        // Else just use time
        type_ = "time";
      }
    }
    return type_;
  });

  let valueTransforms = createMemo(() => {
    let transforms = {
      fromNum: x => x,
      toNum: x => x,
      numRounding: x => x,
    };
    if (ps.inputKind == "timestamp") {
      // Determine if datetime is needed or just time.
      if (getDateFromTimestamp(ps.min) != getDateFromTimestamp(ps.max)) {
        // If min and max are different dates, use datetime.
        transforms.fromNum = toDateTimeString;
        transforms.toNum = fromDateTimeString;
      } else {
        // Else just use time
        const dateStart = new Date(ps.min);
        transforms.fromNum = toTimeString;
        transforms.toNum = getFromTimeStringFn(dateStart);
      }
      transforms.numRounding = num => roundN(num, ps.step);
    }
    return transforms;
  });

  // Calculate derived percentages of how much space the bar takes up.
  const leftPct = createMemo(() => {
    return `${clamp((getCurrentMin() - ps.min) / diff() * 100, 0, 100)}%`;
  });
  const rightPct = createMemo(() => {
    return `${clamp((ps.max - getCurrentMax()) / diff() * 100, 0, 100)}%`;
  });

  // Using references to elements to force gap between min and max
  let minInput: HTMLInputElement, maxInput: HTMLInputElement;

  // Ensure the new maximum is within the allowed range
  const updateMax = (newMax: number, doRound: boolean = false) => {
    if (newMax < getCurrentMin() + ps.minDiff) {
      newMax = getCurrentMin() + ps.minDiff;
    } else if (newMax >= ps.max) {
      newMax = ps.max;
      doRound = false;
    }
    newMax = doRound ? valueTransforms().numRounding(newMax) : newMax;
    setCurrentMax(newMax);
    maxInput.value = newMax as any;
  };

  // Ensure the new minimum is within the allowed range
  const updateMin = (newMin: number, doRound: boolean = false) => {
    if (newMin > getCurrentMax() - ps.minDiff) {
      newMin = getCurrentMax() - ps.minDiff;
    } else if (newMin <= ps.min) {
      newMin = ps.min;
      doRound = false;
    }
    newMin = doRound ? valueTransforms().numRounding(newMin) : newMin;
    setCurrentMin(newMin);
    minInput.value = newMin as any;
  };

  let invisibleElement; // Used to hide drag ghost image
  const onDragStart = (e: DragEventInit) => {
    e.dataTransfer.setDragImage(invisibleElement, 0, 0); // Hide drag ghost image
    setStartDrag({
      x: e.clientX,
      startMin: getCurrentMin(),
      startMax: getCurrentMax(),
    });
  };

  const onDrag = (e: DragEvent) => {
    if (e.clientX == 0) {
      // Drag ends with a 0 event for some reason, so ignoring 0s.
      return;
    }

    const dragInfo = getStartDrag();
    const movedDist = e.clientX - dragInfo.x;
    const barLength = minInput.getBoundingClientRect().width;
    const valuePerPixel = diff() / barLength;
    const valueChange = valueTransforms().numRounding(movedDist * valuePerPixel);
    if (valueChange > 0) {
      updateMax(dragInfo.startMax + valueChange);
      updateMin(dragInfo.startMin + valueChange);
    } else {
      updateMin(dragInfo.startMin + valueChange);
      updateMax(dragInfo.startMax + valueChange);
    }
  };

  return (
    <div class="range-input flex flex-row">
      <input
        type={inputType()}
        step={1}
        min={valueTransforms().fromNum(ps.min)}
        max={valueTransforms().fromNum(ps.max)}
        value={valueTransforms().fromNum(getCurrentMin())}
        onChange={e => updateMin(valueTransforms().toNum(e.target.value))}
      />

      <div class="slider flex-grow m-auto mr-2">
        {
          // Used to hide drag ghost image
          <div ref={invisibleElement} class="hidden"></div>
        }
        <div
          class="range-span cursor-move"
          style={{ left: leftPct(), right: rightPct() }}
          draggable={true}
          onDragStart={onDragStart}
          onDrag={onDrag}
        >
        </div>

        <input
          type="range"
          ref={minInput}
          min={ps.min}
          max={ps.max}
          step={ps.step}
          value={getCurrentMin()}
          onInput={e => {
            updateMin(parseInt(e.target.value), true);
          }}
        />
        <input
          type="range"
          ref={maxInput}
          min={ps.min}
          max={ps.max}
          step={ps.step}
          value={getCurrentMax()}
          onInput={e => {
            updateMax(parseInt(e.target.value), true);
          }}
        />
      </div>

      <input
        type={inputType()}
        step={1}
        min={valueTransforms().fromNum(ps.min)}
        max={valueTransforms().fromNum(ps.max)}
        value={valueTransforms().fromNum(getCurrentMax())}
        onChange={e => updateMax(valueTransforms().toNum(e.target.value))}
      />
    </div>
  );
}

function clamp(num: number, min: number, max: number) {
  return Math.min(Math.max(num, min), max);
}

function roundN(num: number, n: number) {
  return Math.round(num / n) * n;
}

function toDateTimeString(timestamp: number) {
  const d = new Date(timestamp);
  return d.getFullYear()
    + "-"
    + d.getMonth().toString().padStart(2, "0")
    + "-"
    + d.getDate().toString().padStart(2, "0")
    + "T"
    + d.getHours().toString().padStart(2, "0")
    + ":"
    + d.getMinutes().toString().padStart(2, "0")
    + ":"
    + d.getSeconds().toString().padStart(2, "0")
    + "."
    + d.getMilliseconds().toString().padStart(3, "0");
}

function fromDateTimeString(dateString: string) {
  const splitT = dateString.split("T");
  const dateNums = splitT[0].split("-").map(x => parseInt(x));
  const msSplit = splitT[1].split(".");
  const timeNums = msSplit[0].split(":").map(x => parseInt(x));
  return new Date(
    dateNums[0] || new Date().getFullYear(),
    dateNums[1] || new Date().getMonth(),
    dateNums[2] || new Date().getDate(),
    timeNums[0] || 0,
    timeNums[1] || 0,
    timeNums[2] || 0,
    parseInt(msSplit[1]) || 0,
  ).getTime();
}

function toTimeString(timestamp: number) {
  const d = new Date(timestamp);
  return d.getHours().toString().padStart(2, "0")
    + ":"
    + d.getMinutes().toString().padStart(2, "0")
    + ":"
    + d.getSeconds().toString().padStart(2, "0")
    + "."
    + d.getMilliseconds().toString().padStart(3, "0");
}

function getFromTimeStringFn(dateStart: Date) {
  return function fromTimeString(timeString: string) {
    const msSplit = timeString.split(".");
    const timeNums = msSplit[0].split(":").map(x => parseInt(x));
    return new Date(
      dateStart.getFullYear(),
      dateStart.getMonth(),
      dateStart.getDate(),
      timeNums[0] || 0,
      timeNums[1] || 0,
      timeNums[2] || 0,
      parseInt(msSplit[1]) || 0,
    ).getTime();
  };
}

function getDateFromTimestamp(timestampMs: number) {
  return new Date(timestampMs).toDateString();
}
