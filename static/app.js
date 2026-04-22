const stage = document.getElementById("viewerStage");
const video = document.getElementById("cameraFeed");
const uploadPreview = document.getElementById("uploadPreview");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const emptyState = document.getElementById("emptyState");
const stageBadge = document.getElementById("stageBadge");
const objectList = document.getElementById("objectList");
const summaryText = document.getElementById("summaryText");
const modeValue = document.getElementById("modeValue");
const countValue = document.getElementById("countValue");
const speedValue = document.getElementById("speedValue");
const modelValue = document.getElementById("modelValue");
const startCameraBtn = document.getElementById("startCameraBtn");
const flipCameraBtn = document.getElementById("flipCameraBtn");
const scanBtn = document.getElementById("scanBtn");
const liveBtn = document.getElementById("liveBtn");
const imageInput = document.getElementById("imageInput");

const EMOJI_BY_LABEL = {
    "ceiling fan": "🪭",
    person: "🧍",
    bicycle: "🚲",
    car: "🚗",
    motorcycle: "🏍️",
    airplane: "✈️",
    bus: "🚌",
    train: "🚆",
    truck: "🚚",
    boat: "🚤",
    bird: "🐦",
    cat: "🐱",
    dog: "🐶",
    horse: "🐴",
    sheep: "🐑",
    cow: "🐮",
    elephant: "🐘",
    bear: "🐻",
    zebra: "🦓",
    giraffe: "🦒",
    backpack: "🎒",
    umbrella: "☂️",
    handbag: "👜",
    tie: "👔",
    suitcase: "🧳",
    frisbee: "🥏",
    skis: "🎿",
    snowboard: "🏂",
    "sports ball": "⚽",
    kite: "🪁",
    skateboard: "🛹",
    surfboard: "🏄",
    bottle: "🍾",
    cup: "☕",
    fork: "🍴",
    knife: "🔪",
    spoon: "🥄",
    bowl: "🥣",
    banana: "🍌",
    apple: "🍎",
    sandwich: "🥪",
    orange: "🍊",
    broccoli: "🥦",
    carrot: "🥕",
    pizza: "🍕",
    donut: "🍩",
    cake: "🍰",
    chair: "🪑",
    couch: "🛋️",
    "potted plant": "🪴",
    bed: "🛏️",
    toilet: "🚽",
    tv: "📺",
    laptop: "💻",
    mouse: "🖱️",
    remote: "🎮",
    keyboard: "⌨️",
    "cell phone": "📱",
    microwave: "🍽️",
    oven: "♨️",
    toaster: "🍞",
    sink: "🚰",
    refrigerator: "🧊",
    book: "📚",
    clock: "🕒",
    vase: "🏺",
    scissors: "✂️",
    "teddy bear": "🧸",
    toothbrush: "🪥"
};

const CAMERA_WIDTH = 480;
const CAMERA_HEIGHT = 360;
const LIVE_DETECTION_INTERVAL_MS = 90;
const SCORE_THRESHOLD = 0.4;
const MAX_BOXES = 8;
const LIVE_MAX_DIMENSION = 320;
const UPLOAD_MAX_DIMENSION = 960;

let detector = null;
let detectorPromise = null;
let stream = null;
let liveDetectionEnabled = false;
let currentPayload = null;
let currentUploadUrl = null;
let activeSourceType = "empty";
let lastUploadFile = null;
let currentFacingMode = "environment";
let detectionInFlight = false;
let liveAnimationFrame = null;
let lastLiveDetectionAt = 0;
const detectionCanvas = document.createElement("canvas");
const detectionCtx = detectionCanvas.getContext("2d", {
    alpha: false,
    desynchronized: true
});

function setStatus(text) {
    stageBadge.textContent = text;
}

function setMode(mode) {
    modeValue.textContent = mode;
}

function setButtonsBusy(isBusy) {
    startCameraBtn.disabled = isBusy;
    flipCameraBtn.disabled = isBusy;
    scanBtn.disabled = isBusy;
}

function getLabelEmoji(label) {
    return EMOJI_BY_LABEL[label] || "📦";
}

function getSourceDimensions(sourceElement) {
    if (sourceElement === video) {
        return {
            width: video.videoWidth,
            height: video.videoHeight
        };
    }

    return {
        width: sourceElement.naturalWidth,
        height: sourceElement.naturalHeight
    };
}

function resizeCanvas() {
    overlay.width = stage.clientWidth;
    overlay.height = stage.clientHeight;
    drawDetections(currentPayload);
}

function showSource(type) {
    activeSourceType = type;
    video.style.display = type === "camera" ? "block" : "none";
    uploadPreview.style.display = type === "upload" ? "block" : "none";
    emptyState.style.display = type === "empty" ? "flex" : "none";
    currentPayload = null;
    drawDetections(null);
    renderObjectList(null);
}

function getActiveMediaElement() {
    if (activeSourceType === "camera" && video.videoWidth > 0 && video.videoHeight > 0) {
        return {
            width: video.videoWidth,
            height: video.videoHeight
        };
    }

    if (activeSourceType === "upload" && uploadPreview.naturalWidth > 0 && uploadPreview.naturalHeight > 0) {
        return {
            width: uploadPreview.naturalWidth,
            height: uploadPreview.naturalHeight
        };
    }

    return null;
}

function getContainTransform(sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const renderedWidth = sourceWidth * scale;
    const renderedHeight = sourceHeight * scale;

    return {
        scale,
        offsetX: (targetWidth - renderedWidth) / 2,
        offsetY: (targetHeight - renderedHeight) / 2
    };
}

function getColorFromLabel(label) {
    let hash = 0;

    for (const char of label) {
        hash = ((hash << 5) - hash) + char.charCodeAt(0);
        hash |= 0;
    }

    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 90% 63%)`;
}

function roundedRect(x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);

    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.lineTo(x + width - safeRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    ctx.lineTo(x + width, y + height - safeRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    ctx.lineTo(x + safeRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    ctx.lineTo(x, y + safeRadius);
    ctx.quadraticCurveTo(x, y, x + safeRadius, y);
    ctx.closePath();
}

function drawLabel(left, top, color, emoji, label, confidence) {
    const text = `${emoji} ${label} ${Math.round(confidence * 100)}%`;
    const paddingX = 12;
    const height = 34;

    ctx.font = '600 18px "Space Grotesk", "Segoe UI Emoji", sans-serif';
    const width = Math.ceil(ctx.measureText(text).width) + (paddingX * 2);
    const x = Math.min(Math.max(8, left), overlay.width - width - 8);
    const y = Math.max(12, top - height - 8);

    ctx.fillStyle = "rgba(4, 16, 24, 0.88)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    roundedRect(x, y, width, height, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f5fbff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + paddingX, y + (height / 2));
}

function drawDetections(payload) {
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (!payload || !payload.frame_width || !payload.frame_height) {
        return;
    }

    const transform = getContainTransform(
        payload.frame_width,
        payload.frame_height,
        overlay.width,
        overlay.height
    );

    payload.items.forEach((item) => {
        const left = (item.x1 * transform.scale) + transform.offsetX;
        const top = (item.y1 * transform.scale) + transform.offsetY;
        const right = (item.x2 * transform.scale) + transform.offsetX;
        const bottom = (item.y2 * transform.scale) + transform.offsetY;
        const width = right - left;
        const height = bottom - top;
        const color = getColorFromLabel(item.label);

        if (width <= 0 || height <= 0) {
            return;
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.strokeRect(left, top, width, height);

        ctx.shadowBlur = 0;
        drawLabel(left, top, color, item.emoji, item.label, item.confidence);
    });
}

function renderObjectList(payload) {
    if (!payload || !payload.items || payload.items.length === 0) {
        objectList.innerHTML = '<p class="placeholder-text">No object found yet. Try bringing the object closer, using better light, or switching to the back camera.</p>';
        summaryText.textContent = "No objects found";
        countValue.textContent = "0";
        speedValue.textContent = payload ? `${payload.processing_ms} ms` : "0 ms";
        modelValue.textContent = window.APP_CONFIG.modelName;
        return;
    }

    summaryText.textContent = `${payload.object_count} object${payload.object_count === 1 ? "" : "s"} detected`;
    countValue.textContent = String(payload.object_count);
    speedValue.textContent = `${payload.processing_ms} ms`;
    modelValue.textContent = window.APP_CONFIG.modelName;

    objectList.innerHTML = payload.items.map((item) => `
        <article class="object-item">
            <div class="object-main">
                <strong>${item.emoji} ${item.label}</strong>
                <small>${item.description}</small>
            </div>
            <span class="object-confidence">${Math.round(item.confidence * 100)}%</span>
        </article>
    `).join("");
}

function updateUiFromPayload(payload) {
    currentPayload = payload;
    setMode(payload.mode === "live" ? "Browser Camera" : "Uploaded Image");
    setStatus(`Detected ${payload.object_count} object${payload.object_count === 1 ? "" : "s"} in ${payload.processing_ms} ms`);
    renderObjectList(payload);
    drawDetections(payload);
}

async function ensureDetector() {
    if (detector) {
        return detector;
    }

    if (!detectorPromise) {
        detectorPromise = (async () => {
            setButtonsBusy(true);
            setStatus("Loading browser detector...");

            try {
                await tf.ready();

                try {
                    await tf.setBackend("webgl");
                    await tf.ready();
                } catch (_error) {
                    await tf.setBackend("cpu");
                    await tf.ready();
                }

                detector = await cocoSsd.load({
                    base: "lite_mobilenet_v2"
                });

                modelValue.textContent = window.APP_CONFIG.modelName;
                setStatus("Detector ready");
                return detector;
            } finally {
                setButtonsBusy(false);
            }
        })();
    }

    return detectorPromise;
}

function stopCameraStream() {
    if (!stream) {
        return;
    }

    stream.getTracks().forEach((track) => track.stop());
    stream = null;
}

async function requestCameraStream() {
    const constraintSets = [
        {
            video: {
                facingMode: { exact: currentFacingMode },
                width: { ideal: CAMERA_WIDTH },
                height: { ideal: CAMERA_HEIGHT },
                frameRate: { ideal: 24, max: 24 }
            },
            audio: false
        },
        {
            video: {
                facingMode: currentFacingMode,
                width: { ideal: CAMERA_WIDTH },
                height: { ideal: CAMERA_HEIGHT },
                frameRate: { ideal: 24, max: 24 }
            },
            audio: false
        },
        {
            video: {
                width: { ideal: CAMERA_WIDTH },
                height: { ideal: CAMERA_HEIGHT },
                frameRate: { ideal: 24, max: 24 }
            },
            audio: false
        }
    ];

    let lastError = null;

    for (const constraints of constraintSets) {
        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError;
}

async function startCamera(forceRestart = false) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus("Camera is not supported in this browser");
        return false;
    }

    await ensureDetector();

    if (stream && !forceRestart) {
        showSource("camera");
        setStatus("Camera ready");
        setMode("Browser Camera");
        return true;
    }

    stopCameraStream();
    liveDetectionEnabled = false;
    setLiveUiState();

    try {
        stream = await requestCameraStream();
        video.srcObject = stream;
        await video.play();
        showSource("camera");
        setStatus(currentFacingMode === "user" ? "Front camera connected" : "Back camera connected");
        setMode("Browser Camera");
        return true;
    } catch (error) {
        setStatus("Camera permission denied or unavailable");
        console.error(error);
        return false;
    }
}

function normalizePrediction(prediction, frameWidth, frameHeight) {
    const [x, y, width, height] = prediction.bbox;
    let label = prediction.class;

    const centerX = x + (width / 2);
    const centerY = y + (height / 2);
    const centerOffsetX = Math.abs(centerX - (frameWidth / 2)) / frameWidth;

    if (
        ["sports ball", "frisbee", "clock"].includes(label)
        && centerY < frameHeight * 0.35
        && centerOffsetX < 0.28
        && width < frameWidth * 0.25
        && height < frameHeight * 0.25
    ) {
        label = "ceiling fan";
    }

    if (
        ["cup", "vase", "wine glass"].includes(label)
        && height > width * 1.35
        && centerY > frameHeight * 0.45
    ) {
        label = "bottle";
    }

    return {
        label,
        emoji: getLabelEmoji(label),
        confidence: prediction.score,
        description: label === prediction.class
            ? "Detected directly in the browser"
            : `Smart relabel from ${prediction.class}`,
        x1: Math.max(0, Math.round(x)),
        y1: Math.max(0, Math.round(y)),
        x2: Math.min(frameWidth, Math.round(x + width)),
        y2: Math.min(frameHeight, Math.round(y + height))
    };
}

function prepareDetectionSource(sourceElement, maxDimension) {
    const { width: sourceWidth, height: sourceHeight } = getSourceDimensions(sourceElement);

    if (!sourceWidth || !sourceHeight) {
        return null;
    }

    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    if (detectionCanvas.width !== targetWidth || detectionCanvas.height !== targetHeight) {
        detectionCanvas.width = targetWidth;
        detectionCanvas.height = targetHeight;
    }

    detectionCtx.imageSmoothingEnabled = true;
    detectionCtx.clearRect(0, 0, targetWidth, targetHeight);
    detectionCtx.drawImage(sourceElement, 0, 0, targetWidth, targetHeight);

    return {
        canvas: detectionCanvas,
        sourceWidth,
        sourceHeight,
        scaleX: sourceWidth / targetWidth,
        scaleY: sourceHeight / targetHeight
    };
}

async function runDetection(sourceElement, mode) {
    if (detectionInFlight) {
        return null;
    }

    const preparedSource = prepareDetectionSource(
        sourceElement,
        mode === "live" ? LIVE_MAX_DIMENSION : UPLOAD_MAX_DIMENSION
    );

    if (!preparedSource) {
        return null;
    }

    detectionInFlight = true;
    const startedAt = performance.now();

    try {
        const activeDetector = await ensureDetector();
        const predictions = await activeDetector.detect(
            preparedSource.canvas,
            MAX_BOXES,
            SCORE_THRESHOLD
        );
        const items = predictions
            .map((prediction) => {
                const [x, y, width, height] = prediction.bbox;

                return normalizePrediction(
                    {
                        ...prediction,
                        bbox: [
                            x * preparedSource.scaleX,
                            y * preparedSource.scaleY,
                            width * preparedSource.scaleX,
                            height * preparedSource.scaleY
                        ]
                    },
                    preparedSource.sourceWidth,
                    preparedSource.sourceHeight
                );
            })
            .filter((item) => item.x2 > item.x1 && item.y2 > item.y1);

        return {
            ok: true,
            frame_width: preparedSource.sourceWidth,
            frame_height: preparedSource.sourceHeight,
            items,
            object_count: items.length,
            processing_ms: Math.round(performance.now() - startedAt),
            mode
        };
    } finally {
        detectionInFlight = false;
    }
}

async function detectCurrentCameraFrame() {
    if (!stream || video.videoWidth === 0 || video.videoHeight === 0) {
        const started = await startCamera();
        if (!started) {
            return;
        }
    }

    const payload = await runDetection(video, "live");
    if (payload) {
        updateUiFromPayload(payload);
    }
}

async function handleUpload(file) {
    if (!file) {
        return;
    }

    await ensureDetector();
    lastUploadFile = file;

    if (currentUploadUrl) {
        URL.revokeObjectURL(currentUploadUrl);
    }

    currentUploadUrl = URL.createObjectURL(file);
    uploadPreview.src = currentUploadUrl;

    await new Promise((resolve) => {
        uploadPreview.onload = resolve;
    });

    showSource("upload");
    setMode("Uploaded Image");
    setStatus("Analyzing uploaded image...");

    const payload = await runDetection(uploadPreview, "upload");
    if (payload) {
        updateUiFromPayload(payload);
    }
}

function setLiveUiState() {
    liveBtn.classList.toggle("live-on", liveDetectionEnabled);
    liveBtn.textContent = liveDetectionEnabled ? "Live Detection On" : "Live Detection Off";
}

function stopLiveLoop() {
    if (liveAnimationFrame) {
        cancelAnimationFrame(liveAnimationFrame);
        liveAnimationFrame = null;
    }
}

function liveLoop() {
    if (!liveDetectionEnabled) {
        stopLiveLoop();
        return;
    }

    const now = performance.now();

    if (!detectionInFlight && now - lastLiveDetectionAt >= LIVE_DETECTION_INTERVAL_MS) {
        lastLiveDetectionAt = now;
        detectCurrentCameraFrame().catch((error) => {
            setStatus(error.message || "Detection failed");
            console.error(error);
            liveDetectionEnabled = false;
            setLiveUiState();
        });
    }

    liveAnimationFrame = requestAnimationFrame(liveLoop);
}

function startLiveLoop() {
    stopLiveLoop();
    lastLiveDetectionAt = 0;
    liveAnimationFrame = requestAnimationFrame(liveLoop);
}

startCameraBtn.addEventListener("click", async () => {
    await startCamera();
});

flipCameraBtn.addEventListener("click", async () => {
    const wasLive = liveDetectionEnabled;

    currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
    const started = await startCamera(true);

    if (started && wasLive) {
        liveDetectionEnabled = true;
        setLiveUiState();
        setStatus("Live detection resumed after camera flip");
        startLiveLoop();
    }
});

scanBtn.addEventListener("click", async () => {
    try {
        if (activeSourceType === "upload" && lastUploadFile) {
            await handleUpload(lastUploadFile);
            return;
        }

        if (activeSourceType === "upload") {
            imageInput.click();
            return;
        }

        await detectCurrentCameraFrame();
    } catch (error) {
        setStatus(error.message || "Detection failed");
        console.error(error);
    }
});

liveBtn.addEventListener("click", async () => {
    if (!liveDetectionEnabled) {
        const started = await startCamera();
        if (!started) {
            return;
        }
    }

    liveDetectionEnabled = !liveDetectionEnabled;
    setLiveUiState();

    if (liveDetectionEnabled) {
        setStatus("Live detection started");
        startLiveLoop();
    } else {
        setStatus("Live detection paused");
        stopLiveLoop();
    }
});

imageInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;

    try {
        liveDetectionEnabled = false;
        setLiveUiState();
        stopLiveLoop();
        await handleUpload(file);
    } catch (error) {
        setStatus(error.message || "Upload detection failed");
        console.error(error);
    } finally {
        imageInput.value = "";
    }
});

window.addEventListener("resize", resizeCanvas);
video.addEventListener("loadedmetadata", resizeCanvas);
uploadPreview.addEventListener("load", resizeCanvas);

resizeCanvas();
showSource("empty");
renderObjectList(null);
setLiveUiState();
