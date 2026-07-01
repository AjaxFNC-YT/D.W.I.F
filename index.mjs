import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  getDefaultOutputName,
  parseOptionalNumber,
  processImage,
  resolveInputPath,
  resolveOutputPath
} from "./lib/dwif.mjs";

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
  - Output format follows the output file extension: .png, .webp, or .gif.
  - Animated output is supported for .webp and .gif.
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

async function main() {
  const [, , rawInputPath, rawOutputPath, rawTopStrip, rawRadius] = process.argv;

  if (rawInputPath === "--help" || rawInputPath === "-h") {
    printUsage();
    return;
  }

  const { inputPath, outputPath } = await collectPaths(rawInputPath, rawOutputPath);
  const result = await processImage({
    inputPath,
    outputPath,
    manualTopStrip: parseOptionalNumber(rawTopStrip, "top-strip"),
    manualRadius: parseOptionalNumber(rawRadius, "radius")
  });

  if (result.warning) {
    console.warn(`Warning: ${result.warning}`);
  }

  console.log(`Created: ${result.outputPath}`);
  console.log(
    `Used output size ${result.width}x${result.height}, top strip ${result.topStrip}px, corner radius ${result.radius}px.`
  );
  console.log(
    result.autoCalculated
      ? "Values were auto-calculated from the image size."
      : "Manual values were used for any numbers you passed in."
  );
  if (result.animated) {
    console.log(`Processed ${result.frameCount} animation frames.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
