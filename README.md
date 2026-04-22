# Neural Vision Studio

Neural Vision Studio is a Flask app that serves a browser-based object detector.

## Features

- Fast live detection in the browser with `coco-ssd`
- Camera mode with front/back camera flip for phones
- Image upload detection for still images
- Bounding boxes, labels, confidence, and emoji overlays
- Lightweight Render deployment with no server-side YOLO model loading

## Local Run

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5000`

## Render Deploy

This repo includes a Blueprint file for Render.

1. Push the project to GitHub.
2. Open Render and create a new Blueprint service.
3. Select this repository.
4. Render will use `render.yaml` automatically.

The live object detection now runs inside the browser, which makes it much faster and avoids server-side inference delays.
