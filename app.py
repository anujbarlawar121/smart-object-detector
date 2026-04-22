import base64
import os
import threading
import time
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, jsonify, render_template, request
from ultralytics import YOLO

BASE_DIR = Path(__file__).resolve().parent
MAX_UPLOAD_SIZE = 10 * 1024 * 1024
LIVE_DEFAULT_CONFIDENCE = 0.25
UPLOAD_DEFAULT_CONFIDENCE = 0.22
LIVE_IMAGE_SIZE = 640
UPLOAD_IMAGE_SIZE = 960

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_SIZE

inference_lock = threading.Lock()
frame_state_lock = threading.Lock()

previous_live_gray_frame = None
clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))

EMOJI_BY_LABEL = {
    "ceiling fan": "🪭",
    "person": "🧍",
    "bicycle": "🚲",
    "car": "🚗",
    "motorcycle": "🏍️",
    "airplane": "✈️",
    "bus": "🚌",
    "train": "🚆",
    "truck": "🚚",
    "boat": "🚤",
    "traffic light": "🚦",
    "stop sign": "🛑",
    "bench": "🪑",
    "bird": "🐦",
    "cat": "🐱",
    "dog": "🐶",
    "horse": "🐴",
    "cow": "🐮",
    "elephant": "🐘",
    "bear": "🐻",
    "zebra": "🦓",
    "giraffe": "🦒",
    "backpack": "🎒",
    "umbrella": "☂️",
    "handbag": "👜",
    "tie": "👔",
    "suitcase": "🧳",
    "frisbee": "🥏",
    "skis": "🎿",
    "snowboard": "🏂",
    "sports ball": "⚽",
    "kite": "🪁",
    "baseball bat": "🏏",
    "baseball glove": "🥎",
    "skateboard": "🛹",
    "surfboard": "🏄",
    "tennis racket": "🎾",
    "bottle": "🍾",
    "wine glass": "🍷",
    "cup": "☕",
    "fork": "🍴",
    "knife": "🔪",
    "spoon": "🥄",
    "bowl": "🥣",
    "banana": "🍌",
    "apple": "🍎",
    "sandwich": "🥪",
    "orange": "🍊",
    "broccoli": "🥦",
    "carrot": "🥕",
    "pizza": "🍕",
    "donut": "🍩",
    "cake": "🍰",
    "chair": "🪑",
    "couch": "🛋️",
    "potted plant": "🪴",
    "bed": "🛏️",
    "dining table": "🪵",
    "toilet": "🚽",
    "tv": "📺",
    "laptop": "💻",
    "mouse": "🖱️",
    "remote": "🎮",
    "keyboard": "⌨️",
    "cell phone": "📱",
    "microwave": "🍽️",
    "oven": "♨️",
    "toaster": "🍞",
    "sink": "🚰",
    "refrigerator": "🧊",
    "book": "📚",
    "clock": "🕒",
    "vase": "🏺",
    "scissors": "✂️",
    "teddy bear": "🧸",
    "hair drier": "💨",
    "toothbrush": "🪥",
}

FAN_SOURCE_LABELS = {"boat", "sports ball", "bird", "person", "fire hydrant"}
BOTTLE_SOURCE_LABELS = {"fire hydrant", "vase", "cup", "wine glass"}
LOW_PRIORITY_LABELS = {
    "boat",
    "fire hydrant",
    "bird",
    "sports ball",
    "airplane",
    "train",
    "bus",
    "truck",
}


def choose_model_name():
    preferred = os.getenv("YOLO_MODEL")
    candidates = []
    if preferred:
        candidates.append(preferred)
    candidates.extend(["yolov8m.pt", "yolov8l.pt", "yolov8n.pt"])

    for candidate in candidates:
        if not candidate:
            continue

        model_path = BASE_DIR / candidate
        if model_path.exists():
            return str(model_path)

        if candidate.startswith("yolov8"):
            return candidate

    return "yolov8n.pt"


MODEL_NAME = choose_model_name()
model = YOLO(MODEL_NAME)
model.fuse()


def get_label_emoji(label):
    return EMOJI_BY_LABEL.get(label, "📦")


def enhance_for_detection(frame, mode):
    if mode == "live":
        brightness = float(frame.mean())

        if brightness < 85:
            return cv2.convertScaleAbs(frame, alpha=1.16, beta=12)
        if brightness < 115:
            return cv2.convertScaleAbs(frame, alpha=1.08, beta=8)

        return frame

    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    l_channel = clahe.apply(l_channel)
    enhanced = cv2.merge((l_channel, a_channel, b_channel))
    enhanced = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)
    enhanced = cv2.convertScaleAbs(enhanced, alpha=1.10, beta=8)
    blurred = cv2.GaussianBlur(enhanced, (0, 0), 1.2)
    return cv2.addWeighted(enhanced, 1.18, blurred, -0.18, 0)


def get_motion_score(frame_delta, left, top, right, bottom, frame_width, frame_height):
    if frame_delta is None:
        return 0.0

    box_width = right - left
    box_height = bottom - top
    pad = int(max(box_width, box_height) * 1.4)

    x1 = max(0, left - pad)
    y1 = max(0, top - pad)
    x2 = min(frame_width, right + pad)
    y2 = min(frame_height, bottom + pad)

    roi = frame_delta[y1:y2, x1:x2]
    if roi.size == 0:
        return 0.0

    return float((roi > 22).mean())


def relabel_detection(label, conf, left, top, right, bottom, frame_width, frame_height, motion_score):
    box_width = right - left
    box_height = bottom - top
    if box_width <= 0 or box_height <= 0:
        return None

    area_ratio = (box_width * box_height) / float(frame_width * frame_height)
    aspect_ratio = box_height / float(max(box_width, 1))
    center_x = (left + right) / 2.0
    center_y = (top + bottom) / 2.0
    center_offset_x = abs(center_x - (frame_width / 2.0)) / frame_width

    if (
        label in BOTTLE_SOURCE_LABELS
        and aspect_ratio > 1.45
        and area_ratio < 0.18
        and center_y > frame_height * 0.40
    ):
        return "bottle"

    if (
        label in FAN_SOURCE_LABELS
        and center_y < frame_height * 0.58
        and center_offset_x < 0.28
        and 0.60 <= aspect_ratio <= 1.85
        and area_ratio < 0.16
        and (motion_score > 0.10 or label in {"boat", "sports ball"} or conf < 0.72)
    ):
        return "ceiling fan"

    minimum_confidence = 0.35
    if label in LOW_PRIORITY_LABELS:
        minimum_confidence = 0.58

    if conf < minimum_confidence:
        return None

    return label


def compute_iou(first, second):
    inter_left = max(first["x1"], second["x1"])
    inter_top = max(first["y1"], second["y1"])
    inter_right = min(first["x2"], second["x2"])
    inter_bottom = min(first["y2"], second["y2"])

    inter_width = max(0, inter_right - inter_left)
    inter_height = max(0, inter_bottom - inter_top)
    inter_area = inter_width * inter_height

    first_area = max(1, (first["x2"] - first["x1"]) * (first["y2"] - first["y1"]))
    second_area = max(1, (second["x2"] - second["x1"]) * (second["y2"] - second["y1"]))
    union_area = first_area + second_area - inter_area

    return inter_area / union_area if union_area > 0 else 0.0


def deduplicate_detections(detections, frame_width, frame_height):
    kept = []
    frame_diagonal = max(1.0, float(np.hypot(frame_width, frame_height)))

    for detection in sorted(detections, key=lambda item: item["confidence"], reverse=True):
        same_object = False
        center_x = (detection["x1"] + detection["x2"]) / 2.0
        center_y = (detection["y1"] + detection["y2"]) / 2.0

        for existing in kept:
            existing_center_x = (existing["x1"] + existing["x2"]) / 2.0
            existing_center_y = (existing["y1"] + existing["y2"]) / 2.0
            center_distance = np.hypot(center_x - existing_center_x, center_y - existing_center_y) / frame_diagonal

            if detection["label"] == existing["label"] and (
                compute_iou(detection, existing) > 0.35 or center_distance < 0.08
            ):
                same_object = True
                break

        if not same_object:
            kept.append(detection)

    return kept


def read_image_bytes(image_bytes):
    np_buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    frame = cv2.imdecode(np_buffer, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Unable to decode the provided image.")
    return frame


def decode_data_url(image_data_url):
    if not image_data_url or "," not in image_data_url:
        raise ValueError("Invalid camera frame payload.")

    _, encoded = image_data_url.split(",", 1)
    image_bytes = base64.b64decode(encoded)
    return read_image_bytes(image_bytes)


def get_requested_confidence(raw_value, mode):
    default_value = LIVE_DEFAULT_CONFIDENCE if mode == "live" else UPLOAD_DEFAULT_CONFIDENCE

    if raw_value in (None, ""):
        return default_value

    try:
        return min(max(float(raw_value), 0.15), 0.85)
    except (TypeError, ValueError):
        return default_value


def detect_objects(frame, threshold, mode):
    global previous_live_gray_frame

    started_at = time.perf_counter()
    frame_height, frame_width = frame.shape[:2]
    detection_frame = enhance_for_detection(frame, mode)
    gray = cv2.cvtColor(detection_frame, cv2.COLOR_BGR2GRAY)

    with frame_state_lock:
        frame_delta = None

        if mode == "live":
            if previous_live_gray_frame is not None and previous_live_gray_frame.shape == gray.shape:
                frame_delta = cv2.absdiff(gray, previous_live_gray_frame)

            previous_live_gray_frame = gray
        else:
            # Uploaded images should not reuse motion state from earlier live-camera frames.
            previous_live_gray_frame = None

    confidence = get_requested_confidence(threshold, mode)
    image_size = LIVE_IMAGE_SIZE if mode == "live" else UPLOAD_IMAGE_SIZE

    with inference_lock:
        results = model(
            detection_frame,
            conf=confidence,
            iou=0.6,
            imgsz=image_size,
            verbose=False,
        )[0]

    detections = []

    for box in results.boxes:
        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
        conf = float(box.conf[0])
        cls = int(box.cls[0])
        source_label = model.names[cls]

        left = max(0, int(round(x1)))
        top = max(0, int(round(y1)))
        right = min(frame_width, int(round(x2)))
        bottom = min(frame_height, int(round(y2)))

        if right <= left or bottom <= top:
            continue

        motion_score = get_motion_score(
            frame_delta,
            left,
            top,
            right,
            bottom,
            frame_width,
            frame_height,
        )
        label = relabel_detection(
            source_label,
            conf,
            left,
            top,
            right,
            bottom,
            frame_width,
            frame_height,
            motion_score,
        )

        if label is None:
            continue

        detections.append(
            {
                "label": label,
                "emoji": get_label_emoji(label),
                "confidence": round(conf, 3),
                "source_label": source_label,
                "x1": left,
                "y1": top,
                "x2": right,
                "y2": bottom,
            }
        )

    detections = deduplicate_detections(detections, frame_width, frame_height)
    detections.sort(key=lambda item: item["confidence"], reverse=True)

    counts = {}
    for item in detections:
        counts[item["label"]] = counts.get(item["label"], 0) + 1

    return {
        "ok": True,
        "frame_width": frame_width,
        "frame_height": frame_height,
        "items": detections,
        "counts": counts,
        "object_count": len(detections),
        "model_name": Path(MODEL_NAME).name,
        "processing_ms": round((time.perf_counter() - started_at) * 1000, 1),
        "mode": mode,
    }


@app.route("/")
def index():
    return render_template("index.html", model_name=Path(MODEL_NAME).name)


@app.route("/health")
def health():
    return jsonify({"ok": True, "model_name": Path(MODEL_NAME).name})


@app.errorhandler(413)
def file_too_large(_error):
    return jsonify({"ok": False, "error": "Image is too large. Please use a file under 10 MB."}), 413


@app.route("/detect-frame", methods=["POST"])
def detect_frame():
    uploaded_file = request.files.get("image")

    try:
        if uploaded_file is not None and uploaded_file.filename:
            frame = read_image_bytes(uploaded_file.read())
            threshold = request.form.get("confidence")
        else:
            payload = request.get_json(silent=True) or {}
            frame = decode_data_url(payload.get("image"))
            threshold = payload.get("confidence")
    except (ValueError, TypeError, base64.binascii.Error) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    try:
        return jsonify(detect_objects(frame, threshold, "live"))
    except Exception as exc:  # pragma: no cover
        return jsonify({"ok": False, "error": f"Detection failed: {exc}"}), 500


@app.route("/detect-upload", methods=["POST"])
def detect_upload():
    uploaded_file = request.files.get("image")
    threshold = request.form.get("confidence")

    if uploaded_file is None or not uploaded_file.filename:
        return jsonify({"ok": False, "error": "Please choose an image file."}), 400

    try:
        frame = read_image_bytes(uploaded_file.read())
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    try:
        return jsonify(detect_objects(frame, threshold, "upload"))
    except Exception as exc:  # pragma: no cover
        return jsonify({"ok": False, "error": f"Detection failed: {exc}"}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, threaded=True)
