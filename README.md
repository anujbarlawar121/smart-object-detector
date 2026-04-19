# Neural Vision Studio

Neural Vision Studio is a Flask-based object detection app built for the browser.

## Features

- Browser camera detection using `getUserMedia`
- Image upload detection for still images
- Bounding boxes, labels, confidence, and emoji overlays
- Smart relabeling for common indoor mistakes like `ceiling fan` and `bottle`
- Render-ready deployment config with `render.yaml`

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

The deployed app uses browser camera access, so it works online without trying to use the server machine's webcam.
