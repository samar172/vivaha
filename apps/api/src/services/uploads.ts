import { v2 as cloudinary } from "cloudinary";
import { createHash } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { env } from "../env";
import { badRequest } from "../utils/httpError";

// Item photographs, stored the way JMS stores product photographs on this same
// box and against the same Cloudinary account: uploaded to Cloudinary when
// CLOUDINARY_URL is configured, and written to local disk when it is not, so a
// developer checkout works with no external credentials at all.
//
// They arrive as a data URL on an ordinary JSON body rather than as multipart.
// The browser already redraws the file through a canvas to bring a phone
// photograph down to a sensible size, so it is holding a base64 string either
// way, and this keeps the API free of a file-upload dependency on a server that
// is deployed by rsync.
//
// The SDK reads CLOUDINARY_URL from the environment by itself; this only asks
// it for https URLs.
if (env.CLOUDINARY_URL) cloudinary.config({ secure: true });

export const UPLOAD_ROOT = path.resolve(env.UPLOAD_DIR);
export const LOCAL_PREFIX = "/api/uploads/";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// 8 MB decoded. The browser downscales before sending, so anything near this
// was never going to be a product photograph.
const MAX_BYTES = 8 * 1024 * 1024;

function decode(dataUrl: string): { buf: Buffer; type: string; ext: string } {
  const m = /^data:([a-z/+.-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) throw badRequest("That does not look like an image file");
  const [, type, b64] = m;
  const ext = EXT[type.toLowerCase()];
  if (!ext) throw badRequest(`${type} is not an image format we store — use JPEG, PNG or WebP`);
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) throw badRequest("The image came through empty");
  if (buf.length > MAX_BYTES) throw badRequest(`That image is ${(buf.length / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_BYTES / 1024 / 1024} MB`);
  return { buf, type, ext };
}

export interface StoredImage { url: string; bytes: number }

// Anything the office uploads: an item photograph, a portal banner. The kind
// is a folder, so the two never collide and Cloudinary stays organised.
export async function storeImage(kind: string, key: string, dataUrl: string): Promise<StoredImage> {
  const { buf, ext } = decode(dataUrl);
  const url = env.CLOUDINARY_URL ? await toCloudinary(kind, key, buf) : await toDisk(kind, key, buf, ext);
  return { url, bytes: buf.length };
}

export const storeItemImage = (itemId: string, dataUrl: string) => storeImage("items", itemId, dataUrl);

function toCloudinary(kind: string, key: string, buf: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = cloudinary.uploader.upload_stream(
      { folder: `vivaha/${kind}/${key}`, resource_type: "image" },
      (err, result) => (err || !result ? reject(err ?? new Error("Cloudinary upload failed")) : resolve(result.secure_url)),
    );
    s.end(buf);
  });
}

async function toDisk(kind: string, key: string, buf: Buffer, ext: string): Promise<string> {
  const dir = path.join(UPLOAD_ROOT, kind);
  await mkdir(dir, { recursive: true });
  // The content hash keeps the name stable for identical bytes and changes it
  // whenever the picture does, so a replaced photograph is never served from a
  // cache under its old name.
  const stamp = createHash("sha1").update(buf).digest("hex").slice(0, 10);
  const file = `${key}-${stamp}.${ext}`;
  await writeFile(path.join(dir, file), buf);
  return `${LOCAL_PREFIX}${kind}/${file}`;
}

export const removeItemImage = removeImage;

// Best effort on both paths: a file that has already gone must never block the
// database update, which is the actual record of what the item looks like.
export async function removeImage(url: string | null | undefined): Promise<void> {
  if (!url) return;

  if (url.startsWith(LOCAL_PREFIX)) {
    const abs = path.resolve(UPLOAD_ROOT, url.slice(LOCAL_PREFIX.length));
    // Never let a stored value walk out of the uploads directory.
    if (abs.startsWith(UPLOAD_ROOT + path.sep)) await unlink(abs).catch(() => {});
    return;
  }

  if (!env.CLOUDINARY_URL || !url.includes("cloudinary.com")) return;
  try {
    // .../upload/v1234567890/folder/name.ext -> folder/name
    const after = url.split("/upload/")[1];
    if (!after) return;
    const withoutVersion = after.replace(/^v\d+\//, "");
    const publicId = withoutVersion.slice(0, withoutVersion.lastIndexOf("."));
    if (publicId) await cloudinary.uploader.destroy(publicId);
  } catch (e) {
    console.error("Cloudinary delete failed", e);
  }
}
