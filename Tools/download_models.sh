#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${SCRIPT_DIR}/../Assets/ProjectionFX/Models"

mkdir -p "${TARGET_DIR}"

BASE_HAND="https://huggingface.co/unity/inference-engine-blaze-hand/resolve/main/models"
BASE_POSE="https://huggingface.co/unity/inference-engine-blaze-pose/resolve/main/models"

download_if_missing() {
    local url="$1"
    local filename="$2"
    local dest="${TARGET_DIR}/${filename}"

    if [ -f "${dest}" ] && [ -s "${dest}" ]; then
        echo "[SKIP] ${filename} already exists ($(stat -c%s "${dest}" 2>/dev/null || stat -f%z "${dest}") bytes)."
    else
        echo "[DOWNLOADING] ${filename}..."
        curl -fSL -o "${dest}" "${url}"
        echo "[DONE] ${filename} saved."
    fi
}

download_if_missing "${BASE_HAND}/hand_detector.onnx" "hand_detector.onnx"
download_if_missing "${BASE_HAND}/hand_landmarks_detector.onnx" "hand_landmarks_detector.onnx"
download_if_missing "${BASE_POSE}/pose_detection.onnx" "pose_detection.onnx"
download_if_missing "${BASE_POSE}/pose_landmarks_detector_full.onnx" "pose_landmarks_detector_full.onnx"

echo ""
echo "All MediaPipe ONNX models are ready in ${TARGET_DIR}."
ls -lh "${TARGET_DIR}"/*.onnx
