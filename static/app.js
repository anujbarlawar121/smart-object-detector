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
const scanBtn = document.getElementById("scanBtn");
const liveBtn = document.getElementById("liveBtn");
const imageInput = document.getElementById("imageInput");
const confidenceSlider = document.getElementById("confidenceSlider");
const confidenceValue = document.getElementById("confidenceValue");

const captureCanvas = document.createElement("canvas");
const captureContext = captureCanvas.getContext("2d");

let stream = null;
let liveDetectionEnabled = false;
let liveLoopPromise = null;
let currentMode = "idle";
let currentPayload = null;
let currentUploadUrl = null;
let activeSourceType = "empty";
let lastUploadFile = null;

function setStatus(text) {
    stageBadge.textContent = text;
}

function setMode(mode) {
    currentMode = mode;
    modeValue.textContent = mode;
}

function updateConfidenceLabel() {
    confidenceValue.textContent = `${confidenceSlider.value}%`;
}

function resizeCanvas() {
    overlay.width = stage.clientWidth;
    overlay.height = stage.clientHeight;
    drawDetections(currentPayload);
}

function getConfidenceValue() {
    return Number(confidenceSlider.value) / 100;
}

function showSource(type) {
    activeSourceType = type;
    video.style.display = type === "camera" ? "block" : "none";
    uploadPreview.style.display = type === "upload" ? "block" : "none";
    emptyState.style.display = type === "empty" ? "flex" : "none";
    currentPayload = null;
    drawDetections(currentPayload);
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

    const media = getActiveMediaElement();
    if (!media) {
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
        ctx.shadowBlur = 18;
        ctx.strokeRect(left, top, width, height);

        ctx.shadowBlur = 0;
        drawLabel(left, top, color, item.emoji, item.label, item.confidence);
    });
}

function renderObjectList(payload) {
    if (!payload || !payload.items || payload.items.length === 0) {
        objectList.innerHTML = '<p class="placeholder-text">No confident detections yet. Try brighter light, a closer angle, or a slightly lower confidence setting.</p>';
        summaryText.textContent = "No objects found";
        countValue.textContent = "0";
        speedValue.textContent = payload ? `${payload.processing_ms} ms` : "0 ms";
        modelValue.textContent = window.APP_CONFIG.modelName;
        return;
    }

    summaryText.textContent = `${payload.object_count} object${payload.object_count === 1 ? "" : "s"} detected`;
    countValue.textContent = String(payload.object_count);
    speedValue.textContent = `${payload.processing_ms} ms`;
    modelValue.textContent = payload.model_name;

    objectList.innerHTML = payload.items.map((item) => {
        const note = item.source_label !== item.label
            ? `Smart relabel from ${item.source_label}`
            : "Direct model label";

        return `
            <article class="object-item">
                <div class="object-main">
                    <strong>${item.emoji} ${item.label}</strong>
                    <small>${note}</small>
                </div>
                <span class="object-confidence">${Math.round(item.confidence * 100)}%</span>
            </article>
        `;
    }).join("");
}

function updateUiFromPayload(payload) {
    currentPayload = payload;
    setMode(payload.mode === "live" ? "Browser Camera" : "Uploaded Image");
    setStatus(`Detected ${payload.object_count} object${payload.object_count === 1 ? "" : "s"} in ${payload.processing_ms} ms`);
    renderObjectList(payload);
    drawDetections(payload);
}

async function startCamera() {
    if (stream) {
        showSource("camera");
        setStatus("Camera ready");
        setMode("Browser Camera");
        return;
    }

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });

        video.srcObject = stream;
        await video.play();
        showSource("camera");
        setStatus("Camera connected");
        setMode("Browser Camera");
    } catch (error) {
        setStatus("Camera permission denied or unavailable");
        console.error(error);
    }
}

function captureFrameDataUrl() {
    const width = video.videoWidth;
    const height = video.videoHeight;

    captureCanvas.width = width;
    captureCanvas.height = height;
    captureContext.drawImage(video, 0, 0, width, height);
    return captureCanvas.toDataURL("image/jpeg", 0.85);
}

async function detectCurrentCameraFrame() {
    if (!stream || video.videoWidth === 0 || video.videoHeight === 0) {
        await startCamera();
        if (!stream) {
            return;
        }
    }

    setStatus("Analyzing current frame...");

    const response = await fetch("/detect-frame", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            image: captureFrameDataUrl(),
            confidence: getConfidenceValue()
        })
    });

    const payload = await response.json();
    if (!payload.ok) {
        throw new Error(payload.error || "Camera detection failed.");
    }

    updateUiFromPayload(payload);
}

async function handleUpload(file) {
    if (!file) {
        return;
    }

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

    const formData = new FormData();
    formData.append("image", file);
    formData.append("confidence", String(getConfidenceValue()));

    const response = await fetch("/detect-upload", {
        method: "POST",
        body: formData
    });

    const payload = await response.json();
    if (!payload.ok) {
        throw new Error(payload.error || "Upload detection failed.");
    }

    updateUiFromPayload(payload);
}

function setLiveUiState() {
    liveBtn.classList.toggle("live-on", liveDetectionEnabled);
    liveBtn.textContent = liveDetectionEnabled ? "Live Detection On" : "Live Detection Off";
}

async function startLiveLoop() {
    if (liveLoopPromise) {
        return liveLoopPromise;
    }

    liveLoopPromise = (async () => {
        while (liveDetectionEnabled) {
            try {
                await detectCurrentCameraFrame();
            } catch (error) {
                setStatus(error.message);
                console.error(error);
                liveDetectionEnabled = false;
            }

            setLiveUiState();

            if (liveDetectionEnabled) {
                await new Promise((resolve) => setTimeout(resolve, 900));
            }
        }

        liveLoopPromise = null;
    })();

    return liveLoopPromise;
}

startCameraBtn.addEventListener("click", async () => {
    await startCamera();
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
        setStatus(error.message);
        console.error(error);
    }
});

liveBtn.addEventListener("click", async () => {
    if (!liveDetectionEnabled) {
        await startCamera();
    }

    liveDetectionEnabled = !liveDetectionEnabled;
    setLiveUiState();

    if (liveDetectionEnabled) {
        setStatus("Live detection started");
        await startLiveLoop();
    } else {
        setStatus("Live detection paused");
    }
});

imageInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;

    try {
        liveDetectionEnabled = false;
        setLiveUiState();
        await handleUpload(file);
    } catch (error) {
        setStatus(error.message);
        console.error(error);
    } finally {
        imageInput.value = "";
    }
});

confidenceSlider.addEventListener("input", updateConfidenceLabel);
window.addEventListener("resize", resizeCanvas);
video.addEventListener("loadedmetadata", resizeCanvas);
uploadPreview.addEventListener("load", resizeCanvas);

updateConfidenceLabel();
resizeCanvas();
showSource("empty");
renderObjectList(null);
setLiveUiState();
