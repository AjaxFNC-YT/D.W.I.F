# D.W.I.F.

<p align="center">
  Discord Widget Image Fixer.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-18%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node 18+">
  <img src="https://img.shields.io/badge/tauri-v2-24c8db?style=flat-square" alt="Tauri v2">
  <img src="https://img.shields.io/badge/output-PNG%20%7C%20WEBP%20%7C%20GIF-8A2BE2?style=flat-square" alt="PNG, WEBP, and GIF output">
  <img src="https://img.shields.io/badge/auto%20sizing-enabled-4C9A2A?style=flat-square" alt="Auto sizing enabled">
</p>

<p align="center">
  Small image fixer for adding a transparent top strip and rounded top-right corner to Discord widget images, with both a CLI and a Tauri desktop UI.
</p>

<p align="center">
  <img src="./assets/before-after.webp" alt="Before and after preview of D.W.I.F. fixing a Discord widget image">
</p>

## Install

CLI requirements:

- Node.js 18+

Desktop UI requirements:

- Node.js 18+
- Rust toolchain
- Visual Studio Build Tools with Desktop development with C++ on Windows

Install dependencies:

```bash
npm install
```

## Desktop UI

Launch the desktop app:

```bash
npm run tauri:dev
```

The desktop UI includes:

- file picker for PNG, JPG, WEBP, and GIF files
- live preview area
- loading spinner and animated processing progress bar
- fast animated processing enabled by default
- top strip and radius controls
- generate action
- custom title bar with working window controls
- resizable desktop window
- download button to save a copy anywhere you want

Notes:

- large GIF and animated WEBP files can take a while to process
- animated previews may be limited depending on the file and platform
- animated processing now reports frame-by-frame progress in the UI
- the desktop app now uses the faster animated export path by default
- generated files are still written to the local `output/` folder first

Build a desktop bundle:

```bash
npm run tauri:build
```

## CLI Use

Quick start:

```bash
node index.mjs input.png
```

That keeps the original image size, auto-calculates the strip and radius, and writes the fixed output into `output/`.

If you run it without paths:

```bash
node index.mjs
```

it will prompt for the input image and output file name.

## Paths

- relative inputs default to `input/`
- relative paths outside `input/` also work if the file exists locally
- absolute input paths also work
- outputs always go to `output/`

Examples:

```bash
node index.mjs input.png
node index.mjs input\input.png
node index.mjs animation.webp fixed.webp
node index.mjs animation.gif fixed.gif
node index.mjs C:\full\path\image.png output.png
```

## Manual Options

```bash
node index.mjs <input-image> [output-name] [top-strip] [radius]
```

Examples:

```bash
node index.mjs input.png output.png 17 36
node index.mjs animation.webp fixed.webp
node index.mjs animation.gif fixed.gif
```

You can also override only one value and leave the other on auto:

```bash
node index.mjs input.png output.png 17
```

Help:

```bash
node index.mjs --help
```

## Notes

- Output format follows the output file extension: `.png`, `.webp`, or `.gif`.
- Transparent WEBP files are supported.
- Animated WEBP and GIF files keep their animation frames.
- Animated output currently supports `.webp` and `.gif`.
- Faster animated export settings are enabled by default. GIF output still has harder edges than WEBP because GIF transparency is only 1-bit.
- The original image size is preserved.
- Auto sizing is calibrated from:
  - `512x512` -> `17 / 36`
  - `1844x853` -> `54 / 172`
- You may see a warning when the source image is not `512x512`, since that is the original widget reference size.
