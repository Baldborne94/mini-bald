const MAX_EDGE = 2000;
const QUALITY = 0.88;

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      // Bakes the EXIF rotation in, so the server never has to guess.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Phone cameras produce 8–12 MB files; we downscale to a 2000px long edge (~400–700 KB JPEG)
 * before uploading. A photo picked from the gallery keeps its original date for the timeline.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; takenAt?: string }> {
  const age = Date.now() - file.lastModified;
  const takenAt = age > 60_000 ? new Date(file.lastModified).toISOString() : undefined;

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decode(file);
  } catch {
    return { blob: file, takenAt }; // let the server decide whether it can read it
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ('close' in source) source.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  return { blob: blob ?? file, takenAt };
}
