"use strict";

// Imports manually selected artwork independently per kind.
// The existing API artwork pipeline is intentionally untouched.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { fileURLToPath } = require("node:url");
const { nativeImage } = require("electron");
const { ASSETS_DIR } = require("./app-settings");
const { slugifyName } = require("./assets");

const KINDS = Object.freeze(["poster", "background", "logo", "icon"]);
const SUPPORTED = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif",
  ".tif", ".tiff", ".svg", ".ico", ".bmp", ".heic", ".heif",
]);
const MAX_SOURCE_BYTES = 75 * 1024 * 1024;
const MAX_PIXELS = 100_000_000;
const MAX_WIDTH = { poster: 1600, background: 3840, logo: 2400, icon: 512 };

function toLocalResource(filePath) {
  return `local-resource:///${filePath.replace(/\\/g, "/")}`;
}

function cleanSource(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Image path is required");
  }
  const raw = input.trim();
  const filePath = raw.startsWith("file://") ? fileURLToPath(raw) : raw;
  if (!path.isAbsolute(filePath)) {
    throw new Error("Image source must be an absolute local file path");
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED.has(ext)) {
    throw new Error(`Unsupported image extension: ${ext || "(none)"}`);
  }
  return { filePath, ext };
}

async function convertSource(filePath, ext, kind) {
  if (ext === ".ico") {
    if (process.platform !== "win32") {
      throw new Error("ICO import requires Windows; convert the ICO to PNG first");
    }
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) throw new Error("ICO is empty or invalid");
    const png = image.resize({ width: Math.min(MAX_WIDTH[kind], 512) }).toPNG();
    if (!png.length) throw new Error("Could not decode ICO");
    return { contents: png, extension: ".png" };
  }

  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    throw new Error("Artwork conversion requires sharp. Run: npm install sharp");
  }

  const input = sharp(filePath, {
    limitInputPixels: MAX_PIXELS,
    failOn: "error",
    density: 150,
    page: 0,
    pages: 1,
  });
  const info = await input.metadata();
  if (!info.width || !info.height || info.width * info.height > MAX_PIXELS) {
    throw new Error("Invalid or oversized image dimensions");
  }

  // Use WebP for photographic art, PNG for transparent logos and icons.
  const photographic = kind === "poster" || kind === "background";
  let pipeline = sharp(filePath, {
    limitInputPixels: MAX_PIXELS,
    failOn: "error",
    density: 150,
    page: 0,
    pages: 1,
  }).rotate().resize({
    width: MAX_WIDTH[kind],
    withoutEnlargement: true,
  });
  pipeline = photographic
    ? pipeline.webp({ quality: 90, effort: 4 })
    : pipeline.png({ compressionLevel: 8 });
  const contents = await pipeline.toBuffer();
  if (!contents.length) throw new Error("Image conversion produced no data");
  return { contents, extension: photographic ? ".webp" : ".png" };
}

async function importManualArtworkSet(gameName, selections = {}) {
  if (typeof gameName !== "string" || !gameName.trim()) {
    throw new Error("A valid game name is required");
  }
  const dir = path.join(ASSETS_DIR, slugifyName(gameName), "manual");
  const assets = {};
  const createdFiles = [];
  let stagingFile = null;
  try {
    for (const kind of KINDS) {
      if (!selections[kind]) continue;
      const { filePath, ext } = cleanSource(selections[kind]);
      const st = await fs.promises.stat(filePath);
      if (!st.isFile() || st.size === 0 || st.size > MAX_SOURCE_BYTES) {
        throw new Error(`Invalid or too-large ${kind} image`);
      }
      const { contents, extension } = await convertSource(filePath, ext, kind);
      await fs.promises.mkdir(dir, { recursive: true });
      const finalPath = path.join(dir, `${kind}-${randomUUID()}${extension}`);
      stagingFile = `${finalPath}.part`;
      await fs.promises.writeFile(stagingFile, contents, { flag: "wx" });
      await fs.promises.rename(stagingFile, finalPath);
      stagingFile = null;
      createdFiles.push(finalPath);
      assets[kind] = toLocalResource(finalPath);
      console.log(`[ManualArtwork] ${kind} imported → ${path.basename(finalPath)}`);
    }
    return { assets, createdFiles };
  } catch (err) {
    if (stagingFile) await fs.promises.rm(stagingFile, { force: true }).catch(() => {});
    await Promise.all(createdFiles.map(file => fs.promises.rm(file, { force: true }).catch(() => {})));
    throw err;
  }
}

async function discardImportedArtwork(paths) {
  await Promise.all((paths || []).map(file => fs.promises.rm(file, { force: true }).catch(() => {})));
}

module.exports = { KINDS, importManualArtworkSet, discardImportedArtwork };
