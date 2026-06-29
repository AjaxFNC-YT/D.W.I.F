import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const REFERENCE_SIZE = 512;
const AUTO_TOP_STRIP_BASE = 17;
const AUTO_RADIUS_BASE = 36;
const AUTO_TOP_STRIP_EXPONENT =
  Math.log(54 / 17) / Math.log(Math.sqrt(1844 * 853) / REFERENCE_SIZE);
const AUTO_RADIUS_EXPONENT =
  Math.log(172 / 36) / Math.log(Math.sqrt(1844 * 853) / REFERENCE_SIZE);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = path.join(SCRIPT_DIR, "input");
const OUTPUT_DIR = path.join(SCRIPT_DIR, "output");

function printUsage() {
  console.log(`Usage:
  node index.mjs <input-image> [output-name] [top-strip] [radius]

Examples:
  node index.mjs input.png
  node index.mjs input.png output.png
  node index.mjs C:\\full\\path\\image.png output.png 17 36
  node index.mjs

Notes:
  - Skip top-strip and radius to auto-calculate them from image size.
  - Relative input names are loaded from the local input folder.
  - Full absolute input paths are also supported.
  - Output always goes into the local output folder.
  - The auto sizing is calibrated from 512x512 -> 17/36 and 1844x853 -> 54/172.
`);
}

async function collectPaths(cliInputPath, cliOutputPath) {
  if (cliInputPath && cliOutputPath) {
    return {
      inputPath: resolveInputPath(cliInputPath),
      outputPath: resolveOutputPath(cliInputPath, cliOutputPath)
    };
  }

  if (!input.isTTY) {
    const stdinText = await new Promise((resolve, reject) => {
      let data = "";
      input.setEncoding("utf8");
      input.on("data", (chunk) => {
        data += chunk;
      });
      input.on("end", () => resolve(data));
      input.on("error", reject);
    });

    const lines = stdinText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const inputPath = cliInputPath?.trim() || lines[0] || "";

    if (!inputPath) {
      throw new Error("Input image path is required.");
    }

    return {
      inputPath: resolveInputPath(inputPath),
      outputPath: resolveOutputPath(inputPath, cliOutputPath?.trim() || lines[1] || "")
    };
  }

  const rl = readline.createInterface({ input, output });

  try {
    const inputPath =
      cliInputPath?.trim() || (await rl.question("Input image path: ")).trim();

    if (!inputPath) {
      throw new Error("Input image path is required.");
    }

    const defaultOutputName = getDefaultOutputName(inputPath);
    const outputName =
      cliOutputPath?.trim() ||
      (await rl.question(`Output file name [${defaultOutputName}]: `)).trim() ||
      defaultOutputName;

    return {
      inputPath: resolveInputPath(inputPath),
      outputPath: resolveOutputPath(inputPath, outputName)
    };
  } finally {
    rl.close();
  }
}

function getDefaultOutputName(inputPath) {
  const parsed = path.parse(inputPath);
  return `${parsed.name}-resized.png`;
}

function resolveInputPath(inputPath) {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  const normalizedInputPath = inputPath.replace(/^[.][\\/]/, "");
  const localScriptPath = path.join(SCRIPT_DIR, normalizedInputPath);

  if (normalizedInputPath.startsWith(`input${path.sep}`) || normalizedInputPath === "input") {
    return localScriptPath;
  }

  return path.join(INPUT_DIR, normalizedInputPath);
}

function resolveOutputPath(inputPath, outputName) {
  const finalName = outputName ? path.basename(outputName) : getDefaultOutputName(inputPath);
  return path.join(OUTPUT_DIR, finalName);
}

function parseOptionalNumber(value, label) {
  if (value == null) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }

  return parsed;
}

function getAutoValue(baseValue, exponent, width, height) {
  const sizeFactor = Math.sqrt(width * height) / REFERENCE_SIZE;
  return Math.max(0, Math.round(baseValue * Math.pow(sizeFactor, exponent)));
}

function buildCornerCutout(radius) {
  return sharp({
    create: {
      width: radius,
      height: radius,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${radius}" height="${radius}" viewBox="0 0 ${radius} ${radius}" xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="0" width="${radius}" height="${radius}" fill="white"/>
          </svg>`
        )
      },
      {
        input: Buffer.from(
          `<svg width="${radius}" height="${radius}" viewBox="0 0 ${radius} ${radius}" xmlns="http://www.w3.org/2000/svg">
            <circle cx="0" cy="${radius}" r="${radius}" fill="black"/>
          </svg>`
        ),
        blend: "dest-out"
      }
    ])
    .png()
    .toBuffer();
}

async function main() {
  const [, , rawInputPath, rawOutputPath, rawTopStrip, rawRadius] = process.argv;

  if (rawInputPath === "--help" || rawInputPath === "-h") {
    printUsage();
    return;
  }

  const { inputPath, outputPath } = await collectPaths(rawInputPath, rawOutputPath);

  await fs.mkdir(INPUT_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const metadata = await sharp(inputPath).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("Could not read image dimensions.");
  }

  const manualTopStrip = parseOptionalNumber(rawTopStrip, "top-strip");
  const manualRadius = parseOptionalNumber(rawRadius, "radius");
  const topStrip =
    manualTopStrip ??
    getAutoValue(AUTO_TOP_STRIP_BASE, AUTO_TOP_STRIP_EXPONENT, metadata.width, metadata.height);
  const radius =
    manualRadius ??
    getAutoValue(AUTO_RADIUS_BASE, AUTO_RADIUS_EXPONENT, metadata.width, metadata.height);

  if (metadata.width !== REFERENCE_SIZE || metadata.height !== REFERENCE_SIZE) {
    console.warn(
      `Warning: widget may look odd if the original image size is not ${REFERENCE_SIZE}x${REFERENCE_SIZE}. ` +
        `Detected ${metadata.width}x${metadata.height}.`
    );
  }

  const imageHeight = Math.max(metadata.height - topStrip, 0);
  const clampedRadius = Math.min(radius, metadata.width, imageHeight);

  const composites = [
    {
      input: await sharp(inputPath).ensureAlpha().png().toBuffer(),
      top: topStrip,
      left: 0
    }
  ];

  if (clampedRadius > 0) {
    composites.push({
      input: await buildCornerCutout(clampedRadius),
      top: topStrip,
      left: metadata.width - clampedRadius,
      blend: "dest-out"
    });
  }

  await sharp({
    create: {
      width: metadata.width,
      height: metadata.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(composites)
    .png()
    .toFile(outputPath);

  console.log(`Created: ${outputPath}`);
  console.log(
    `Used output size ${metadata.width}x${metadata.height}, top strip ${topStrip}px, corner radius ${clampedRadius}px.`
  );
  console.log(
    manualTopStrip == null && manualRadius == null
      ? "Values were auto-calculated from the image size."
      : "Manual values were used for any numbers you passed in."
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
