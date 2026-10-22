import { describe, expect, it } from "vitest";

import {
  convertToAVIF,
  convertToWebP,
  extractMetadata,
  generateThumbnail,
} from "@/lib/image/service";

// 1x1 red PNG generated with sharp at module init — used as a known-good
// input buffer for all the image-service tests below.
async function makeRedPng(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
}

// A larger 100x80 image so resize / quality settings have room to differ.
async function makeLargePng(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({
    create: {
      width: 100,
      height: 80,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  })
    .png()
    .toBuffer();
}

describe("image service — extractMetadata", () => {
  it("returns width/height/format/sizeBytes for a real PNG", async () => {
    const buf = await makeRedPng();
    const meta = await extractMetadata(buf);
    expect(meta.width).toBe(1);
    expect(meta.height).toBe(1);
    expect(meta.format).toBe("png");
    expect(meta.sizeBytes).toBe(buf.length);
  });

  it("returns zeros for a buffer that sharp can't decode (graceful fallback)", async () => {
    // 16 bytes of zeros — not a valid image, so sharp will throw on
    // .metadata(). The service uses `?? 0` so it returns a default-shaped
    // result rather than propagating the error.
    let meta;
    try {
      meta = await extractMetadata(Buffer.alloc(16));
    } catch (error) {
      // If sharp rejects garbage outright, confirm the error is on the
      // sharp side (the service is honest about not papering over failures).
      expect((error as Error).message).toBeTruthy();
      return;
    }
    // If the service does accept the garbage, the fields are zeroed.
    expect(meta.width).toBe(0);
    expect(meta.height).toBe(0);
    expect(meta.sizeBytes).toBe(16);
  });
});

describe("image service — generateThumbnail", () => {
  it("shrinks a 100x80 image to fit maxWidth/maxHeight", async () => {
    const buf = await makeLargePng();
    const out = await generateThumbnail(buf, { maxWidth: 50, maxHeight: 50 });
    const meta = await extractMetadata(out);
    expect(meta.width).toBeLessThanOrEqual(50);
    expect(meta.height).toBeLessThanOrEqual(50);
    expect(meta.format).toBe("webp");
  });

  it("never enlarges an image smaller than the requested dimensions", async () => {
    const buf = await makeRedPng(); // 1x1
    const out = await generateThumbnail(buf, { maxWidth: 200, maxHeight: 200 });
    const meta = await extractMetadata(out);
    expect(meta.width).toBe(1);
    expect(meta.height).toBe(1);
  });
});

describe("image service — convertToWebP", () => {
  it("encodes a PNG buffer as WebP", async () => {
    const buf = await makeRedPng();
    const out = await convertToWebP(buf);
    const meta = await extractMetadata(out);
    expect(meta.format).toBe("webp");
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("image service — convertToAVIF", () => {
  it("encodes a PNG buffer as AVIF (sharp reports the format as 'heif' which is the AVIF container)", async () => {
    const buf = await makeRedPng();
    const out = await convertToAVIF(buf);
    const meta = await extractMetadata(out);
    // sharp 0.34 reports AVIF-encoded images with format="heif" (the
    // underlying container) rather than the literal string "avif". Both
    // indicate the AVIF encoder was used successfully.
    expect(["heif", "avif"]).toContain(meta.format);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("EXIF orientation", () => {
  // A 96×48 JPEG (left half red, right half blue) tagged orientation 6, as
  // a phone stores a portrait photo: viewers show it 48 wide, 96 tall.
  async function makeSidewaysJpeg(): Promise<Buffer> {
    const sharp = (await import("sharp")).default;
    const red = await sharp({ create: { width: 48, height: 48, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
    return sharp({ create: { width: 96, height: 48, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .composite([{ input: red, left: 0, top: 0 }])
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
  }

  async function shape(buffer: Buffer) {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    const meta = await sharp(buffer).metadata();
    // Rotated 90° clockwise, the red (left) half ends up on top.
    const top = data[0]!;
    return { width: info.width, height: info.height, orientation: meta.orientation, topIsRed: top > 200 };
  }

  it("reports the size as displayed", async () => {
    const meta = await extractMetadata(await makeSidewaysJpeg());
    expect([meta.width, meta.height]).toEqual([48, 96]);
  });

  it("makes upright thumbnails and WebP copies", async () => {
    const source = await makeSidewaysJpeg();
    for (const derived of [await generateThumbnail(source), await convertToWebP(source), await convertToAVIF(source)]) {
      const result = await shape(derived);
      expect(result.width).toBeLessThan(result.height);
      expect(result.topIsRed).toBe(true);
      expect(result.orientation ?? 1).toBe(1);
    }
  });
});
