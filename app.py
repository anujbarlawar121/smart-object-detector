import os

from flask import Flask, jsonify, render_template

app = Flask(__name__)

DETECTOR_NAME = os.getenv("DETECTOR_NAME", "coco-ssd (browser)")


@app.route("/")
def index():
    return render_template("index.html", model_name=DETECTOR_NAME)


@app.route("/health")
def health():
    return jsonify({"ok": True, "model_name": DETECTOR_NAME})


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, threaded=True)
