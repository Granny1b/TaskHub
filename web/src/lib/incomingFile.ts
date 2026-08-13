/**
 * Make a file the browser handed us fit to upload.
 *
 * Files chosen from a picker are well behaved: a real name, a real MIME type.
 * Files that arrive from a *camera* are not. Depending on the phone, the camera
 * app and the browser, the same photograph can arrive as `image.jpg` with
 * `image/jpeg`, as `IMG_20260813_124400.jpg`, as a bare `1000012345` with no
 * extension, or with an empty type.
 *
 * Every one of those is a failure further down:
 *
 *  - **No extension** — the allowlist checks the extension, so the upload is
 *    rejected before it starts, with a message about a file type the user never
 *    chose.
 *  - **Empty MIME type** — the SAS is *signed* with the declared content type
 *    and Azure compares it against the `Content-Type` on the PUT. An empty one
 *    is not sent verbatim by every browser, so the signature stops matching and
 *    the upload fails with a 403 that reads like a permissions bug.
 *
 * So the file is normalised once, at the entrance, and everything downstream
 * sees something consistent.
 */

/** Magic bytes, which are the only trustworthy answer when the type is empty. */
const SIGNATURES: readonly { type: string; extension: string; match: readonly number[] }[] = [
  { type: 'image/jpeg', extension: 'jpg', match: [0xff, 0xd8, 0xff] },
  { type: 'image/png', extension: 'png', match: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'image/gif', extension: 'gif', match: [0x47, 0x49, 0x46, 0x38] },
];

const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/** Identify a file from its first bytes. Returns null for anything unknown. */
export function identifyFromBytes(head: Uint8Array): { type: string; extension: string } | null {
  for (const signature of SIGNATURES) {
    if (signature.match.every((byte, index) => head[index] === byte)) {
      return { type: signature.type, extension: signature.extension };
    }
  }

  // WebP and HEIC both use a container whose tag sits at offset 8.
  const tag = String.fromCharCode(...Array.from(head.slice(8, 12)));
  if (tag === 'WEBP') return { type: 'image/webp', extension: 'webp' };
  if (['heic', 'heix', 'hevc', 'mif1', 'heim'].includes(tag)) {
    return { type: 'image/heic', extension: 'heic' };
  }

  return null;
}

export function extensionOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === fileName.length - 1) return '';
  return fileName.slice(lastDot + 1).toLowerCase();
}

/**
 * Decide the name and type a file should be uploaded under.
 *
 * Pure, so the rules can be tested without a browser. `stamp` names a photo
 * that arrived without a usable name of its own — distinguishable rather than
 * three files all called `image.jpg`.
 */
export function resolveNameAndType(
  input: {
    fileName: string;
    contentType: string;
    sniffed: { type: string; extension: string } | null;
  },
  stamp: string,
): { fileName: string; contentType: string } {
  const declared = input.contentType.trim().toLowerCase();
  const fromName = extensionOf(input.fileName);

  // Order of trust: what the bytes say, then what the browser declared, then
  // the extension. The bytes cannot be wrong; the other two regularly are.
  const type =
    input.sniffed?.type ??
    (declared.length > 0 && declared !== 'application/octet-stream' ? declared : '') ??
    '';

  const resolvedType =
    type.length > 0
      ? type
      : (Object.entries(EXTENSION_BY_TYPE).find(([, ext]) => ext === fromName)?.[0] ?? '');

  const extension =
    input.sniffed?.extension ??
    EXTENSION_BY_TYPE[resolvedType] ??
    (fromName.length > 0 ? fromName : '');

  // A name with the right extension already needs nothing done to it.
  const base = input.fileName.trim();
  if (
    base.length > 0 &&
    fromName.length > 0 &&
    (extension.length === 0 || fromName === extension)
  ) {
    return {
      fileName: base,
      contentType: resolvedType.length > 0 ? resolvedType : input.contentType,
    };
  }

  const withoutExtension = base.length > 0 ? base.replace(/\.[^.]*$/, '') : `foto-${stamp}`;
  const safeBase = withoutExtension.length > 0 ? withoutExtension : `foto-${stamp}`;

  return {
    fileName: extension.length > 0 ? `${safeBase}.${extension}` : safeBase,
    contentType: resolvedType.length > 0 ? resolvedType : input.contentType,
  };
}

/**
 * Normalise a file before anything else touches it.
 *
 * Reads only the first bytes — enough to identify the format, and nothing like
 * the cost of decoding it.
 */
export async function normaliseIncomingFile(file: File, now: Date = new Date()): Promise<File> {
  let sniffed: { type: string; extension: string } | null = null;
  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    sniffed = identifyFromBytes(head);
  } catch {
    // A file we cannot even read the head of will fail later with a better
    // message than anything that could be invented here.
  }

  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const resolved = resolveNameAndType(
    { fileName: file.name, contentType: file.type, sniffed },
    stamp,
  );

  if (resolved.fileName === file.name && resolved.contentType === file.type) return file;

  return new File([file], resolved.fileName, {
    type: resolved.contentType,
    lastModified: file.lastModified,
  });
}
