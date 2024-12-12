import { createEffect, createMemo, createSignal, mergeProps } from "solid-js";
import "./range_input.css";

interface RangeInputProps {
  min: number;
  max: number;
  lower?: number;
  upper?: number;
  step?: number;
  minDiff?: number;
  onChange?: (lower: number, upper: number) => any;
  onChangeLower?: (lower: number) => any;
  onChangeUpper?: (upper: number) => any;
  inputKind?: "number" | "timestamp";
  disabled?: boolean;
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
  const diff = () => props.max - props.min;

  const ps = mergeProps({
    step: defaultStep(),
    minDiff: defaultStep(),
    lower: Math.round(props.min + diff() / 100 * 25),
    upper: Math.round(props.min + diff() / 100 * 75),
    onChange: () => {},
    onChangeLower: () => {},
    onChangeUpper: () => {},
  }, props);

  const [getStartDrag, setStartDrag] = createSignal<DragStartInfo | undefined>(undefined);

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
    return `${clamp((ps.lower - ps.min) / diff() * 100, 0, 100)}%`;
  });
  const rightPct = createMemo(() => {
    return `${clamp((ps.max - ps.upper) / diff() * 100, 0, 100)}%`;
  });

  // Using references to elements to force gap between lower and upper
  let lowerInput: HTMLInputElement, upperInput: HTMLInputElement;

  // Ensure the new lower is within the allowed range
  const updateLower = (newLower: number, doRound: boolean = false) => {
    if (newLower > ps.upper - ps.minDiff) {
      newLower = ps.upper - ps.minDiff;
    } else if (newLower <= ps.min) {
      newLower = ps.min;
      doRound = false;
    }
    newLower = doRound ? valueTransforms().numRounding(newLower) : newLower;
    lowerInput.value = newLower as any;
    ps.onChangeLower(newLower);
    ps.onChange(newLower, ps.upper);
  };

  // Ensure the new upper is within the allowed range
  const updateUpper = (newUpper: number, doRound: boolean = false) => {
    if (newUpper < ps.lower + ps.minDiff) {
      newUpper = ps.lower + ps.minDiff;
    } else if (newUpper >= ps.max) {
      newUpper = ps.max;
      doRound = false;
    }
    newUpper = doRound ? valueTransforms().numRounding(newUpper) : newUpper;
    upperInput.value = newUpper as any;
    ps.onChangeUpper(newUpper);
    ps.onChange(ps.lower, newUpper);
  };

  let invisibleElement; // Used to hide drag ghost image
  const onDragStart = (e: DragEventInit) => {
    e.dataTransfer.setDragImage(invisibleElement, 0, 0); // Hide drag ghost image
    setStartDrag({
      x: e.clientX,
      startMin: ps.lower,
      startMax: ps.upper,
    });
  };

  const onDrag = (e: DragEvent) => {
    if (e.clientX == 0) {
      // Drag ends with a 0 event for some reason, so ignoring 0s.
      return;
    }

    const dragInfo = getStartDrag();
    const movedDist = e.clientX - dragInfo.x;
    const barLength = lowerInput.getBoundingClientRect().width;
    const valuePerPixel = diff() / barLength;
    const valueChange = valueTransforms().numRounding(movedDist * valuePerPixel);
    if (valueChange > 0) {
      updateUpper(dragInfo.startMax + valueChange);
      updateLower(dragInfo.startMin + valueChange);
    } else {
      updateLower(dragInfo.startMin + valueChange);
      updateUpper(dragInfo.startMax + valueChange);
    }
  };

  return (
    <div class="range-input flex flex-row">
      <input
        type={inputType()}
        step={1}
        min={valueTransforms().fromNum(ps.min)}
        max={valueTransforms().fromNum(ps.max)}
        value={valueTransforms().fromNum(ps.lower)}
        onChange={e => updateLower(valueTransforms().toNum(e.target.value))}
        disabled={ps.disabled}
      />

      <div class="slider flex-grow m-auto mr-2">
        {
          // Used to hide drag ghost image of the bar
          <div ref={invisibleElement} class="hidden"></div>
        }
        <div
          class="range-span"
          classList={{ "cursor-move": !ps.disabled, "disabled": ps.disabled }}
          style={{ left: leftPct(), right: rightPct() }}
          draggable={!ps.disabled}
          onDragStart={onDragStart}
          onDrag={onDrag}
        >
        </div>

        <input
          type="range"
          ref={lowerInput}
          min={ps.min}
          max={ps.max}
          step={ps.step}
          value={ps.lower}
          onInput={e => {
            updateLower(parseInt(e.target.value), true);
          }}
          disabled={ps.disabled}
        />
        <input
          type="range"
          ref={upperInput}
          min={ps.min}
          max={ps.max}
          step={ps.step}
          value={ps.upper}
          onInput={e => {
            updateUpper(parseInt(e.target.value), true);
          }}
          disabled={ps.disabled}
        />
      </div>

      <input
        type={inputType()}
        step={1}
        min={valueTransforms().fromNum(ps.min)}
        max={valueTransforms().fromNum(ps.max)}
        value={valueTransforms().fromNum(ps.upper)}
        onChange={e => updateUpper(valueTransforms().toNum(e.target.value))}
        disabled={ps.disabled}
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
