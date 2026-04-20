import os
from typing import Any, Dict

from dotenv import load_dotenv
from flask import Flask, jsonify, make_response, request
import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted


load_dotenv()

API_KEY = os.getenv("MY_SECRET_API_KEY")
if not API_KEY:
    raise RuntimeError("MY_SECRET_API_KEY is missing. Add it to .env")

genai.configure(api_key=API_KEY)
model = genai.GenerativeModel("gemini-2.5-flash")

app = Flask(__name__)


def _is_quota_exhausted(exc: Exception) -> bool:
    if isinstance(exc, ResourceExhausted):
        return True

    message = str(exc).lower()
    return "429" in message or "quota" in message or "resource_exhausted" in message


def _with_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return response


@app.after_request
def add_cors_headers(response):
    return _with_cors(response)


@app.route("/api/health", methods=["GET", "OPTIONS"])
def health():
    if request.method == "OPTIONS":
        return _with_cors(make_response("", 204))

    try:
        # Tiny probe to verify key + model access end-to-end.
        probe = model.generate_content("Reply with exactly: OK")
        ok_text = (probe.text or "").strip() if probe else ""
        return (
            jsonify(
                {"message": f"Backend is healthy. Gemini replied: {ok_text or 'OK'}"}
            ),
            200,
        )
    except Exception as exc:  # noqa: BLE001
        if _is_quota_exhausted(exc):
            return jsonify({"error": "System busy, please wait 30 seconds"}), 429
        return jsonify({"error": f"Gemini health check failed: {exc}"}), 500


@app.route("/api/analyze-report", methods=["POST", "OPTIONS"])
def analyze_report():
    if request.method == "OPTIONS":
        return _with_cors(make_response("", 204))

    try:
        payload: Dict[str, Any] = request.get_json(silent=True) or {}
        player: Dict[str, Any] = payload.get("player") or {}
        summary = payload.get("summary") or ""
        telemetry = player.get("telemetry") or {}

        if not player:
            return jsonify({"error": "Missing player data."}), 400

        prompt = f"""
You are a sports medicine and athlete performance specialist.
Analyze the athlete data and provide actionable recommendations.

Athlete profile:
- Name: {player.get('name', 'Unknown')}
- Jersey: #{player.get('jerseyNumber', 'Unknown')}
- Height: {player.get('heightCm', 'Unknown')} cm
- Weight: {player.get('weightKg', 'Unknown')} kg
- Age: {player.get('age', 'Unknown')}
- Session Duration: {player.get('sessionDurationText', '00:00')}
- Samples Captured: {player.get('samplesCaptured', 0)}

Telemetry snapshot:
- Heart Rate: {telemetry.get('heartRate', 'N/A')} bpm
- SpO2: {telemetry.get('spo2', 'N/A')} %
- Body Temp: {telemetry.get('bodyTemp', 'N/A')} C
- Muscle Fatigue: {telemetry.get('muscleFatigue', 'N/A')} Hz
- Acceleration: {telemetry.get('acceleration', 'N/A')} m/s2
- Speed: {telemetry.get('speed', 'N/A')} m/s
- ECG: {telemetry.get('ecg', 'N/A')} mV

Coach summary (optional):
{summary}

Return concise markdown with these sections:
1. Key observations
2. Health risks to watch
3. Player actions (what the athlete should do)
4. Medical/team actions (what staff should monitor or adjust)
5. Recovery and training plan (next 24-72h)
""".strip()

        try:
            result = model.generate_content(prompt)
        except Exception as exc:  # noqa: BLE001
            if _is_quota_exhausted(exc):
                return jsonify({"error": "System busy, please wait 30 seconds"}), 429
            raise

        suggestions = (result.text or "").strip() if result else ""

        if not suggestions:
            return jsonify({"error": "Model returned no content."}), 502

        return jsonify({"suggestions": suggestions}), 200
    except Exception as exc:  # noqa: BLE001
        if _is_quota_exhausted(exc):
            return jsonify({"error": "System busy, please wait 30 seconds"}), 429
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
