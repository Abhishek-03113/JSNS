/**
 * Reads word/document.xml out of a .docx without a zip library: walks the zip's central
 * directory and inflates the one entry with the browser's DecompressionStream.
 */

function findEnd(view: DataView): number {
  // End of central directory record: signature 0x06054b50, within the last 64 KB + 22 bytes.
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error("not a zip");
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZipEntry(buf: ArrayBuffer, name: string): Promise<string | null> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const end = findEnd(view);
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("bad zip directory");
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const entry = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (entry === name) {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = bytes.subarray(start, start + size);
      if (method === 0) return dec.decode(raw);
      if (method === 8) return dec.decode(await inflate(raw));
      throw new Error("unsupported compression");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** The document body as parsed XML, or null when the file isn't a Word document. */
export async function readDocx(file: Blob): Promise<Document | null> {
  const xml = await readZipEntry(await file.arrayBuffer(), "word/document.xml");
  return xml ? new DOMParser().parseFromString(xml, "application/xml") : null;
}
