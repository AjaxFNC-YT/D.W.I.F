const REFERENCE_SIZE = 512;
const AUTO_TOP_STRIP_BASE = 17;
const AUTO_RADIUS_BASE = 36;
const AUTO_TOP_STRIP_EXPONENT =
  Math.log(54 / 17) / Math.log(Math.sqrt(1844 * 853) / REFERENCE_SIZE);
const AUTO_RADIUS_EXPONENT =
  Math.log(172 / 36) / Math.log(Math.sqrt(1844 * 853) / REFERENCE_SIZE);

const minimizeBtn = document.querySelector("#minimizeBtn");
const maximizeBtn = document.querySelector("#maximizeBtn");
const closeBtn = document.querySelector("#closeBtn");
const titlebarStatus = document.querySelector("#titlebarStatus");

const inputPath = document.querySelector("#inputPath");
const outputName = document.querySelector("#outputName");
const topStrip = document.querySelector("#topStrip");
const radius = document.querySelector("#radius");
const browseButton = document.querySelector("#browseButton");
const processButton = document.querySelector("#processButton");
const downloadButton = document.querySelector("#downloadButton");
const status = document.querySelector("#status");
const previewEmpty = document.querySelector("#previewEmpty");
const previewLoading = document.querySelector("#previewLoading");
const previewLoadingText = document.querySelector("#previewLoadingText");
const progressWrap = document.querySelector("#progressWrap");
const progressBar = document.querySelector("#progressBar");
const progressLabel = document.querySelector("#progressLabel");
const previewImage = document.querySelector("#previewImage");
const previewMeta = document.querySelector("#previewMeta");
const localFileInput = document.querySelector("#localFileInput");

let lastResult = null;
let previewBaseMeta = "";
let unlistenProgress = null;
let lastProgressCurrent = 0;
let lastProgressPercent = 0;
let lastProgressStage = "";
let selectedBrowserFile = null;
let selectedBrowserUrl = "";
let browserOutputUrl = "";
let runtime = null;

function clearObjectUrl(url) {
  if (url) {
    URL.revokeObjectURL(url);
  }
}

function setTitlebarButtonsEnabled(enabled) {
  for (const button of [minimizeBtn, maximizeBtn, closeBtn]) {
    button.disabled = !enabled;
    button.hidden = !enabled;
  }
}

async function createRuntime() {
  try {
    const [{ invoke }, { listen }, dialogApi, windowApi] = await Promise.all([
      import("./tauri/core.js"),
      import("./tauri/event.js"),
      import("./tauri/dialog.js"),
      import("./tauri/window.js")
    ]);

    if (!window.__TAURI_INTERNALS__?.invoke) {
      throw new Error("Tauri internals unavailable.");
    }

    document.body.dataset.runtime = "tauri";
    return {
      kind: "tauri",
      invoke,
      listen,
      open: dialogApi.open,
      save: dialogApi.save,
      getCurrentWindow: windowApi.getCurrentWindow
    };
  } catch {
    document.body.dataset.runtime = "browser";
    return {
      kind: "browser"
    };
  }
}

function updateTitlebarStatus() {
  if (status.textContent.trim()) {
    titlebarStatus.textContent = status.textContent.trim();
    return;
  }

  if (inputPath.value.trim()) {
    titlebarStatus.textContent = outputName.value.trim()
      ? `Loaded ${outputName.value.trim()}`
      : "Image selected.";
    return;
  }

  titlebarStatus.textContent =
    runtime?.kind === "browser"
      ? "Browser mode. Static images only."
      : "Waiting for an image.";
}

function setStatus(message, tone = "neutral") {
  status.textContent = message;
  status.dataset.tone = tone;
  updateTitlebarStatus();
}

function setTitlebarMessage(message) {
  status.textContent = "";
  status.dataset.tone = "neutral";
  titlebarStatus.textContent = message;
}

function setPreviewLoading(loading, message = "Loading preview...") {
  previewLoading.hidden = !loading;
  previewLoadingText.textContent = loading ? message : "";
}

function setProgressState(visible, percent = 0, label = "") {
  const clampedPercent = Math.max(0, Math.min(100, percent));
  progressWrap.hidden = !visible;
  progressBar.style.width = `${clampedPercent}%`;
  progressLabel.textContent = label || `${clampedPercent}%`;
}

function setPreviewMeta(message = "") {
  previewMeta.textContent = message;
}

function clearPreview() {
  previewImage.removeAttribute("src");
  previewImage.hidden = true;
  previewEmpty.hidden = false;
  previewBaseMeta = "";
  setPreviewMeta("");
  setPreviewLoading(false);
  setProgressState(false, 0, "");
  updateTitlebarStatus();
}

function updatePreviewMetaWithDimensions() {
  if (previewImage.hidden || !previewImage.naturalWidth || !previewImage.naturalHeight) {
    setPreviewMeta(previewBaseMeta);
    return;
  }

  const dimensions = `${previewImage.naturalWidth}x${previewImage.naturalHeight}`;
  setPreviewMeta(previewBaseMeta ? `${previewBaseMeta} ${dimensions}.` : dimensions);
}

function getSuggestedOutputName(filePath) {
  const fileName = filePath.split(/[/\\]/).pop() ?? "image";
  const extensionMatch = fileName.match(/\.[^.]+$/);
  const extension = extensionMatch?.[0]?.toLowerCase() ?? ".png";
  const stem = fileName.replace(/\.[^.]+$/, "");
  return `${stem}-resized${extension}`;
}

function looksAnimatedInput(filePath) {
  return /\.(gif|webp)$/i.test(filePath);
}

function isGifInput(filePath) {
  return /\.gif$/i.test(filePath);
}

function isWebpInput(filePath) {
  return /\.webp$/i.test(filePath);
}

function getAutoValue(baseValue, exponent, width, height) {
  const sizeFactor = Math.sqrt(width * height) / REFERENCE_SIZE;
  return Math.max(0, Math.round(baseValue * Math.pow(sizeFactor, exponent)));
}

function parseOptionalNumber(value, label) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }

  return parsed;
}

function clampRadius(value, width, height, strip) {
  const imageHeight = Math.max(height - strip, 0);
  return Math.min(value, width, imageHeight);
}

async function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode image."));
    image.src = src;
  });
}

async function setPreview(path, label, loadingMessage = "Loading preview...") {
  if (runtime.kind === "tauri") {
    setPreviewLoading(true, loadingMessage);

    try {
      const preview = await runtime.invoke("read_preview_image", { imagePath: path });
      previewImage.src = preview.dataUrl;
      previewImage.alt = label;
      previewImage.hidden = false;
      previewEmpty.hidden = true;
    } catch (error) {
      clearPreview();
      throw error;
    }

    return;
  }

  setPreviewLoading(true, loadingMessage);
  try {
    previewImage.src = path;
    previewImage.alt = label;
    previewImage.hidden = false;
    previewEmpty.hidden = true;
  } catch (error) {
    clearPreview();
    throw error;
  }
}

async function openFileDialog() {
  if (runtime.kind === "tauri") {
    return runtime.open({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp", "gif"]
        }
      ]
    });
  }

  return new Promise((resolve) => {
    localFileInput.value = "";
    localFileInput.onchange = () => resolve(localFileInput.files?.[0] ?? null);
    localFileInput.click();
  });
}

async function saveFileDialog(defaultPath) {
  if (runtime.kind === "tauri") {
    return runtime.save({
      defaultPath,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp", "gif"]
        }
      ]
    });
  }

  return defaultPath;
}

async function detachProgressListener() {
  if (typeof unlistenProgress === "function") {
    await unlistenProgress();
    unlistenProgress = null;
  }
}

async function attachProgressListener() {
  await detachProgressListener();

  if (runtime.kind !== "tauri") {
    return;
  }

  unlistenProgress = await runtime.listen("process-progress", (event) => {
    const payload = event.payload ?? {};
    const rawStage = payload.stage === "encoding" ? "encoding" : "preparing";
    const rawCurrent = Number(payload.current ?? 0);
    const rawPercent = Number(payload.percent ?? 0);
    const stageChanged = lastProgressStage && lastProgressStage !== rawStage;
    const current = stageChanged ? rawCurrent : Math.max(lastProgressCurrent, rawCurrent);
    const percent = stageChanged ? rawPercent : Math.max(lastProgressPercent, rawPercent);
    const stage = rawStage === "encoding" ? "Encoding frames" : "Preparing frames";
    const label = payload.total
      ? `${stage} ${current}/${payload.total} (${percent}%)`
      : `${stage} ${percent}%`;

    lastProgressStage = rawStage;
    lastProgressCurrent = current;
    lastProgressPercent = percent;
    setProgressState(true, percent, label);
  });
}

async function processInBrowser(file) {
  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageElement(sourceUrl);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const manualTopStrip = parseOptionalNumber(topStrip.value, "top strip");
    const manualRadius = parseOptionalNumber(radius.value, "radius");
    const finalTopStrip =
      manualTopStrip ?? getAutoValue(AUTO_TOP_STRIP_BASE, AUTO_TOP_STRIP_EXPONENT, width, height);
    const autoRadius =
      manualRadius ?? getAutoValue(AUTO_RADIUS_BASE, AUTO_RADIUS_EXPONENT, width, height);
    const finalRadius = clampRadius(autoRadius, width, height, finalTopStrip);

    setProgressState(true, 20, "Preparing image (20%)");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas is not available in this browser.");
    }

    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, finalTopStrip, width, height - finalTopStrip);

    if (finalRadius > 0) {
      context.save();
      context.globalCompositeOperation = "destination-out";
      context.beginPath();
      context.moveTo(width - finalRadius, finalTopStrip);
      context.lineTo(width, finalTopStrip);
      context.lineTo(width, finalTopStrip + finalRadius);
      context.arc(width - finalRadius, finalTopStrip + finalRadius, finalRadius, 0, -Math.PI / 2, true);
      context.closePath();
      context.fill();
      context.restore();
    }

    setProgressState(true, 80, "Encoding image (80%)");

    const desiredName = outputName.value.trim() || getSuggestedOutputName(file.name);
    const extension = (desiredName.match(/\.[^.]+$/)?.[0] ?? ".png").toLowerCase();
    const mimeType =
      extension === ".jpg" || extension === ".jpeg"
        ? "image/jpeg"
        : extension === ".webp"
          ? "image/webp"
          : "image/png";

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error("Could not encode the generated image."));
        }
      }, mimeType, mimeType === "image/jpeg" ? 0.92 : undefined);
    });

    clearObjectUrl(browserOutputUrl);
    browserOutputUrl = URL.createObjectURL(blob);
    setProgressState(true, 100, "Done (100%)");

    return {
      outputPath: desiredName,
      blob,
      previewUrl: browserOutputUrl,
      width,
      height,
      topStrip: finalTopStrip,
      radius: finalRadius,
      autoCalculated: manualTopStrip == null && manualRadius == null,
      frameCount: 1,
      animated: false,
      warning: [
        width !== REFERENCE_SIZE || height !== REFERENCE_SIZE
          ? `Widget may look odd if the original image size is not ${REFERENCE_SIZE}x${REFERENCE_SIZE}. Detected ${width}x${height}.`
          : null,
        isWebpInput(file.name)
          ? "Browser mode exports WEBP as a single still image."
          : null
      ].filter(Boolean).join(" ") || null
    };
  } finally {
    clearObjectUrl(sourceUrl);
  }
}

function initWindowControls() {
  if (runtime.kind !== "tauri") {
    setTitlebarButtonsEnabled(false);
    return;
  }

  setTitlebarButtonsEnabled(true);
  const currentWindow = runtime.getCurrentWindow();

  minimizeBtn.addEventListener("click", async () => {
    try {
      await currentWindow.minimize();
    } catch (error) {
      setStatus(`Could not minimize window: ${String(error)}`, "error");
    }
  });

  maximizeBtn.addEventListener("click", async () => {
    try {
      await currentWindow.toggleMaximize();
    } catch (error) {
      setStatus(`Could not resize window: ${String(error)}`, "error");
    }
  });

  closeBtn.addEventListener("click", async () => {
    try {
      await currentWindow.close();
    } catch (error) {
      setStatus(`Could not close window: ${String(error)}`, "error");
    }
  });
}

function resetResultState() {
  lastResult = null;
  downloadButton.disabled = true;
}

function setSelectedBrowserFile(file) {
  selectedBrowserFile = file;
  clearObjectUrl(selectedBrowserUrl);
  selectedBrowserUrl = file ? URL.createObjectURL(file) : "";
}

previewImage.addEventListener("load", () => {
  setPreviewLoading(false);
  updatePreviewMetaWithDimensions();
});

previewImage.addEventListener("error", () => {
  setPreviewLoading(false);
  setPreviewMeta(previewBaseMeta || "Preview unavailable.");
});

outputName.addEventListener("input", () => {
  updateTitlebarStatus();
});

browseButton.addEventListener("click", async () => {
  try {
    const selected = await openFileDialog();

    if (!selected || Array.isArray(selected)) {
      return;
    }

    if (runtime.kind === "tauri") {
      inputPath.value = selected;
      setSelectedBrowserFile(null);
    } else {
      setSelectedBrowserFile(selected);
      inputPath.value = selected.name;
    }

    outputName.value = getSuggestedOutputName(inputPath.value);
    resetResultState();
    previewBaseMeta =
      runtime.kind === "browser" && isGifInput(inputPath.value)
        ? "Previewing selected image. GIF animation processing is only available in the desktop app."
        : runtime.kind === "browser" && isWebpInput(inputPath.value)
          ? "Previewing selected image. Browser mode exports WEBP as a still image."
          : looksAnimatedInput(inputPath.value)
        ? "Previewing selected image. Animated previews may be limited."
        : "Previewing selected image.";

    updateTitlebarStatus();
    await setPreview(
      runtime.kind === "tauri" ? selected : selectedBrowserUrl,
      "Selected input image",
      ""
    );
    setPreviewMeta(previewBaseMeta);
    setStatus("", "neutral");
  } catch (error) {
    setPreviewLoading(false);
    setStatus(`Could not open file dialog: ${String(error)}`, "error");
  }
});

processButton.addEventListener("click", async () => {
  if (!inputPath.value) {
    setStatus("Choose an input image first.", "error");
    return;
  }

  processButton.disabled = true;
  downloadButton.disabled = true;
  await attachProgressListener();
  lastProgressCurrent = 0;
  lastProgressPercent = 0;
  lastProgressStage = "";
  setProgressState(false, 0, "");
  setStatus("", "neutral");
  setPreviewLoading(true, "");

  try {
    let result;

    if (runtime.kind === "tauri") {
      result = await runtime.invoke("process_image", {
        inputPath: inputPath.value,
        outputName: outputName.value.trim() || null,
        topStrip: topStrip.value === "" ? null : Number.parseInt(topStrip.value, 10),
        radius: radius.value === "" ? null : Number.parseInt(radius.value, 10),
        fastAnimated: true
      });
    } else {
      if (!selectedBrowserFile) {
        throw new Error("Choose an input image first.");
      }

      if (isGifInput(selectedBrowserFile.name)) {
        throw new Error("Animated GIF processing is only available in the desktop app.");
      }

      result = await processInBrowser(selectedBrowserFile);
    }

    lastResult = result;
    downloadButton.disabled = false;

    if (result.animated) {
      setProgressState(true, 100, `Encoding frames ${result.frameCount}/${result.frameCount} (100%)`);
    } else if (runtime.kind === "tauri") {
      setProgressState(false, 0, "");
    }

    previewBaseMeta = result.animated
      ? `Previewing output, ${result.frameCount} frames.`
      : runtime.kind === "browser"
        ? "Previewing generated output from browser mode."
        : "Previewing generated output.";
    await setPreview(
      runtime.kind === "tauri" ? result.outputPath : result.previewUrl,
      "Processed output image",
      ""
    );
    setPreviewMeta(previewBaseMeta);

    if (result.warning) {
      setTitlebarMessage(result.warning);
    } else {
      setStatus("", "success");
    }
  } catch (error) {
    setPreviewLoading(false);
    setProgressState(false, 0, "");
    lastProgressCurrent = 0;
    lastProgressPercent = 0;
    lastProgressStage = "";
    setStatus(String(error), "error");
  } finally {
    await detachProgressListener();
    processButton.disabled = false;
  }
});

downloadButton.addEventListener("click", async () => {
  if (!lastResult) {
    setStatus("Generate an image before downloading it.", "error");
    return;
  }

  try {
    const defaultName = outputName.value.trim() || getSuggestedOutputName(lastResult.outputPath);

    if (runtime.kind === "tauri") {
      const destination = await saveFileDialog(defaultName);

      if (!destination || Array.isArray(destination)) {
        return;
      }

      await runtime.invoke("save_processed_file", {
        sourcePath: lastResult.outputPath,
        targetPath: destination
      });

      setTitlebarMessage(`Saved a copy to ${destination}.`);
      return;
    }

    const link = document.createElement("a");
    link.href = browserOutputUrl;
    link.download = defaultName;
    link.click();
    setTitlebarMessage(`Downloaded ${defaultName}.`);
  } catch (error) {
    setStatus(`Could not save file: ${String(error)}`, "error");
  }
});

window.addEventListener("beforeunload", () => {
  clearObjectUrl(selectedBrowserUrl);
  clearObjectUrl(browserOutputUrl);
});

async function init() {
  runtime = await createRuntime();
  initWindowControls();
  clearPreview();
  setStatus("", "neutral");
}

void init();
