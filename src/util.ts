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
