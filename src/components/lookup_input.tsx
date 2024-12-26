import { createOptions, Select } from "@thisbeyond/solid-select";
import "@thisbeyond/solid-select/style.css";
import { createMemo } from "solid-js";

interface LookupInputProps<T, K extends string | number> {
  options: T[] | Record<K, T>;
  nameFn?: (value: T, idx?: K) => string;
  onChange?: ((value: Option<T>) => any) | ((value: Option<T>[]) => any);
  autofocus?: boolean;
  multiple?: boolean;
  initialId?: string;
  placeholder?: string;
  skipNameSort?: boolean;
}

interface Option<T> {
  id: string;
  name: string;
  data: T;
}

export default function LookupInput<T, K extends string | number>(props: LookupInputProps<T, K>) {
  const options: () => Option<T>[] = createMemo(() => {
    let options = Object.keys(props.options).map(idx => ({
      id: idx,
      name: props.nameFn
        ? props.nameFn(props.options[idx], idx as any)
        : "" + idx,
      data: props.options[idx],
    }));
    if (!props.skipNameSort) {
      options.sort((a, b) => a.name.replace("_", "").localeCompare(b.name.replace("_", "")));
    }
    return options;
  });

  const select = createOptions(options(), {
    key: "name",
  });

  const initialValue = () => {
    for (const option of options()) {
      if (option.id == props.initialId) {
        return option;
      }
    }
  };

  return (
    <Select
      class="solid-select-xi"
      {...select}
      autofocus={props.autofocus ?? false}
      onChange={props.onChange}
      multiple={props.multiple ?? false}
      placeholder={props.placeholder}
      initialValue={initialValue()}
    >
    </Select>
  );
}
