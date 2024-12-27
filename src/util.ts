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

export async function fetchProgress(url: string, setProgress: (progress: number) => any): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const contentLength = response.headers.get("content-length");
  if (!contentLength) {
    throw new Error("Unknown file size");
  }

  const total = parseInt(contentLength, 10);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  setProgress(0);
  while (true) {
    const stream = await reader.read();
    if (stream.done) {
      break;
    }
    bytesRead += stream.value.length;

    chunks.push(stream.value);
    setProgress(bytesRead / total);
  }

  const blob = new Blob(chunks);
  setProgress(undefined);
  return await blob.arrayBuffer();
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
