import { Select, createOptions } from "@thisbeyond/solid-select";
import "@thisbeyond/solid-select/style.css";

interface LookupInputProps {
  optionMap: any;
  nameKey?: string;
  onChange?: (value: any) => any;
  autofocus?: boolean,
}

interface Option {
    id: string,
    name: string,
    data: any,
}

export default function LookupInput(props: LookupInputProps) {
  const options: Option[] = Object.keys(props.optionMap).map((key) => ({
    id: key,
    name: props.nameKey
      ? props.optionMap[key][props.nameKey]
      : props.optionMap[key],
    data: props.optionMap[key],
  }));
  options.sort((a,b) => a.name.replace("_", "").localeCompare(b.name.replace("_", "")))

  const select = createOptions(options, {
    key: "name",
  });

  return (
    <Select
      class="solid-select-xi m-2"
      {...select}
      autofocus={props.autofocus ?? false}
      onChange={props.onChange}
    ></Select>
  );
}
