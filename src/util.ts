export async function compress(inString) {
  const compressedStream = new Response(inString).body!.pipeThrough(
    new CompressionStream("deflate"),
  );
  return await new Response(compressedStream).arrayBuffer();
}

export async function decompress(bytes) {
  const decompressedStream = new Response(bytes).body!.pipeThrough(
    new DecompressionStream("deflate"),
  );
  return await new Response(decompressedStream).arrayBuffer();
}

export function binarySearchLower<T, U>(arr: T[], value: U, valueExtract: (t: T) => U) {
  let lo = 0;
  let hi = arr.length - 1;
  let mid = 0;
  let extracted;
  while (lo <= hi) {
    mid = Math.floor((hi - lo) / 2) + lo;
    extracted = valueExtract(arr[mid]);
    if (extracted < value) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return lo;
}
