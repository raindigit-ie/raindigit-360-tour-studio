#!/usr/bin/env python3
"""Benchmark lightweight OpenCV super-resolution models for X4 panoramas."""

from __future__ import annotations

import json
import math
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "qa" / "ai-enhance-lab"
OUT = LAB / "lightweight-sr-output"
REPORT = LAB / "lightweight-sr-report"
MODEL_DIR = LAB / "tools" / "opencv-sr-models"

SAMPLES = [
    {
        "id": "kitchen-table-floor",
        "source": ROOT / "originals" / "Camera01" / "IMG_20260801_132729_00_002.jpg",
        "box": (4300, 2250, 1024, 768),
    },
    {
        "id": "kitchen-window-cabinets",
        "source": ROOT / "originals" / "Camera01" / "IMG_20260801_132729_00_002.jpg",
        "box": (7050, 2150, 1024, 768),
    },
    {
        "id": "hall-stairs-wood",
        "source": ROOT / "originals" / "Camera01" / "IMG_20260801_132848_00_003.jpg",
        "box": (5200, 1650, 1024, 768),
    },
    {
        "id": "living-room-sofa-textiles",
        "source": ROOT / "originals" / "Camera01" / "IMG_20260801_132924_00_004.jpg",
        "box": (5900, 2050, 1024, 768),
    },
]

MODELS = [
    {"label": "fsrcnn-x2", "method": "fsrcnn", "scale": 2, "path": MODEL_DIR / "FSRCNN_x2.pb", "clean": True},
    {"label": "espcn-x2", "method": "espcn", "scale": 2, "path": MODEL_DIR / "ESPCN_x2.pb", "clean": True},
    {"label": "lapsrn-x2", "method": "lapsrn", "scale": 2, "path": MODEL_DIR / "LapSRN_x2.pb", "clean": True},
    # EDSR is included as a quality control candidate, but bounded tightly:
    # it is not lightweight enough to run clean roundtrips over many crops.
    {"label": "edsr-x2", "method": "edsr", "scale": 2, "path": MODEL_DIR / "EDSR_x2.pb", "clean": False, "maxSamples": 1},
]


def ensure_dirs() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    REPORT.mkdir(parents=True, exist_ok=True)


def save_jpeg(image: Image.Image, path: Path, quality: int = 92) -> None:
    image.save(path, "JPEG", quality=quality, subsampling="4:2:0", optimize=True, progressive=True)


def image_array(image: Image.Image) -> np.ndarray:
    return np.asarray(ImageOps.exif_transpose(image).convert("RGB"), dtype=np.float32)


def to_luma(array: np.ndarray) -> np.ndarray:
    return array[..., 0] * 0.2126 + array[..., 1] * 0.7152 + array[..., 2] * 0.0722


def edge_energy(array: np.ndarray) -> float:
    gray = to_luma(array)
    gx = np.diff(gray, axis=1)
    gy = np.diff(gray, axis=0)
    return float((np.mean(np.abs(gx)) + np.mean(np.abs(gy))) / 2.0)


def laplacian_variance(array: np.ndarray) -> float:
    gray = to_luma(array).astype(np.float32)
    return float(cv2.Laplacian(gray, cv2.CV_32F).var())


def metrics(reference: Image.Image, candidate: Image.Image) -> dict[str, float]:
    ref = image_array(reference)
    cand_image = candidate.resize(reference.size, Image.Resampling.LANCZOS)
    cand = image_array(cand_image)
    diff = cand - ref
    mae = float(np.mean(np.abs(diff)))
    rmse = float(math.sqrt(np.mean(diff * diff)))
    psnr = 99.0 if rmse == 0 else float(20.0 * math.log10(255.0 / rmse))
    ref_edge = edge_energy(ref)
    cand_edge = edge_energy(cand)
    return {
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "psnr": round(psnr, 4),
        "edgeEnergy": round(cand_edge, 4),
        "edgeEnergyVsReferencePct": round((cand_edge / ref_edge - 1.0) * 100.0, 4),
        "laplacianVariance": round(laplacian_variance(cand), 4),
        "changedPixelsOver12Pct": round(float(np.mean(np.max(np.abs(diff), axis=2) > 12.0) * 100.0), 4),
        "p95MaxChannelDelta": round(float(np.percentile(np.max(np.abs(diff), axis=2), 95)), 4),
    }


def crop_sample(sample: dict[str, object]) -> Image.Image:
    source = ImageOps.exif_transpose(Image.open(sample["source"])).convert("RGB")
    x, y, w, h = sample["box"]
    return source.crop((x, y, x + w, y + h))


def pil_to_bgr(image: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)


def bgr_to_pil(image: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))


def placeholder(size: tuple[int, int], text: str) -> Image.Image:
    image = Image.new("RGB", size, "#24211b")
    draw = ImageDraw.Draw(image)
    draw.text((24, 24), text, fill="#f4d17a")
    return image


def load_sr_model(model: dict[str, object]) -> cv2.dnn_superres.DnnSuperResImpl:
    sr = cv2.dnn_superres.DnnSuperResImpl_create()
    sr.readModel(str(model["path"]))
    sr.setModel(str(model["method"]), int(model["scale"]))
    return sr


def upscale(sr: cv2.dnn_superres.DnnSuperResImpl, image: Image.Image) -> Image.Image:
    return bgr_to_pil(sr.upsample(pil_to_bgr(image)))


def make_contact_sheet(rows: list[dict[str, object]], output: Path, labels: list[str]) -> None:
    thumb_w, thumb_h = 300, 225
    header_h = 32
    label_h = 26
    sheet = Image.new("RGB", (thumb_w * len(labels), (thumb_h + header_h + label_h) * len(rows)), "#15120d")
    draw = ImageDraw.Draw(sheet)
    for row_index, row in enumerate(rows):
        y0 = row_index * (thumb_h + header_h + label_h)
        draw.text((8, y0 + 7), str(row["id"]), fill="#f4d17a")
        for col_index, label in enumerate(labels):
            x0 = col_index * thumb_w
            img = Image.open(row[label]).convert("RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            sheet.paste(img, (x0, y0 + header_h))
            draw.text((x0 + 8, y0 + header_h + thumb_h + 5), label, fill="#fff9ec")
    save_jpeg(sheet, output, 90)


def main() -> None:
    ensure_dirs()
    missing = [str(model["path"]) for model in MODELS if not Path(model["path"]).exists()]
    if missing:
        raise SystemExit("Missing OpenCV SR model(s): " + ", ".join(missing))

    sr_models = []
    for model in MODELS:
        started = time.time()
        sr_models.append((model, load_sr_model(model), round(time.time() - started, 3)))

    rows = []
    clean_rows = []
    sample_results = []
    for sample in SAMPLES:
        sample_id = str(sample["id"])
        sample_dir = OUT / sample_id
        sample_dir.mkdir(parents=True, exist_ok=True)
        reference = crop_sample(sample)
        low = reference.resize((reference.width // 2, reference.height // 2), Image.Resampling.LANCZOS)
        ref_path = sample_dir / "reference.jpg"
        low_path = sample_dir / "low-input-q70.jpg"
        save_jpeg(reference, ref_path, 96)
        save_jpeg(low, low_path, 70)

        lanczos = low.resize(reference.size, Image.Resampling.LANCZOS)
        bicubic = low.resize(reference.size, Image.Resampling.BICUBIC)
        lanczos_path = sample_dir / "baseline-lanczos.jpg"
        bicubic_path = sample_dir / "baseline-bicubic.jpg"
        save_jpeg(lanczos, lanczos_path, 92)
        save_jpeg(bicubic, bicubic_path, 92)

        variants: dict[str, dict[str, object]] = {
            "baseline-lanczos": {
                "path": str(lanczos_path),
                "bytes": lanczos_path.stat().st_size,
                "metricsVsReference": metrics(reference, lanczos),
            },
            "baseline-bicubic": {
                "path": str(bicubic_path),
                "bytes": bicubic_path.stat().st_size,
                "metricsVsReference": metrics(reference, bicubic),
            },
        }
        row = {"id": sample_id, "reference": ref_path, "low": low_path, "lanczos": lanczos_path}
        clean_row = {"id": sample_id, "reference": ref_path}

        for model, sr, load_seconds in sr_models:
            label = str(model["label"])
            started = time.time()
            ok = True
            error = None
            max_samples = int(model.get("maxSamples", len(SAMPLES)))
            if len(sample_results) >= max_samples:
                restored = placeholder(reference.size, f"{label}\nskipped after {max_samples} sample")
                ok = False
                error = f"skipped after {max_samples} sample(s) to keep benchmark bounded"
            else:
                try:
                    restored = upscale(sr, low).resize(reference.size, Image.Resampling.LANCZOS)
                except Exception as exc:
                    restored = lanczos
                    ok = False
                    error = str(exc)
            elapsed = round(time.time() - started, 3)
            out_path = sample_dir / f"restored-{label}.jpg"
            save_jpeg(restored, out_path, 92)

            clean_started = time.time()
            clean_ok = True
            clean_error = None
            if not bool(model.get("clean", True)):
                clean_roundtrip = placeholder(reference.size, f"{label}\nclean skipped")
                clean_ok = False
                clean_error = "clean roundtrip skipped because this model is too slow/heavy for the lightweight path"
            elif len(sample_results) >= max_samples:
                clean_roundtrip = placeholder(reference.size, f"{label}\nclean skipped")
                clean_ok = False
                clean_error = f"skipped after {max_samples} sample(s) to keep benchmark bounded"
            else:
                try:
                    clean_roundtrip = upscale(sr, reference).resize(reference.size, Image.Resampling.LANCZOS)
                except Exception as exc:
                    clean_roundtrip = reference
                    clean_ok = False
                    clean_error = str(exc)
            clean_elapsed = round(time.time() - clean_started, 3)
            clean_path = sample_dir / f"clean-roundtrip-{label}.jpg"
            save_jpeg(clean_roundtrip, clean_path, 92)

            model_size = Path(model["path"]).stat().st_size
            variants[label] = {
                "path": str(out_path),
                "bytes": out_path.stat().st_size,
                "modelBytes": model_size,
                "loadSeconds": load_seconds,
                "inferenceSeconds": elapsed,
                "ok": ok,
                "error": error,
                "metricsVsReference": metrics(reference, restored),
                "cleanRoundtrip": {
                    "path": str(clean_path),
                    "bytes": clean_path.stat().st_size,
                    "inferenceSeconds": clean_elapsed,
                    "ok": clean_ok,
                    "error": clean_error,
                    "metricsVsReference": metrics(reference, clean_roundtrip),
                },
            }
            row[label] = out_path
            clean_row[label] = clean_path

        sample_results.append({
            "id": sample_id,
            "source": str(sample["source"]),
            "box": sample["box"],
            "referenceBytes": ref_path.stat().st_size,
            "lowInputBytes": low_path.stat().st_size,
            "variants": variants,
        })
        rows.append(row)
        clean_rows.append(clean_row)

    restore_labels = ["reference", "low", "lanczos", "fsrcnn-x2", "espcn-x2", "lapsrn-x2", "edsr-x2"]
    clean_labels = ["reference", "fsrcnn-x2", "espcn-x2", "lapsrn-x2", "edsr-x2"]
    restore_sheet = REPORT / "lightweight-sr-restoration-contact-sheet.jpg"
    clean_sheet = REPORT / "lightweight-sr-clean-roundtrip-contact-sheet.jpg"
    make_contact_sheet(rows, restore_sheet, restore_labels)
    make_contact_sheet(clean_rows, clean_sheet, clean_labels)

    report = {
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "method": "OpenCV dnn_superres x2 models on real X4 crops: degraded-input restoration plus clean-source upscale/downsample roundtrip.",
        "models": [
            {
                "label": str(model["label"]),
                "method": str(model["method"]),
                "scale": int(model["scale"]),
                "path": str(model["path"]),
                "bytes": Path(model["path"]).stat().st_size,
            }
            for model in MODELS
        ],
        "restorationContactSheet": str(restore_sheet),
        "cleanRoundtripContactSheet": str(clean_sheet),
        "samples": sample_results,
    }
    report_path = REPORT / "lightweight-sr-benchmark-report.json"
    report_path.write_text(json.dumps(report, indent=2), "utf-8")
    print(json.dumps({"report": str(report_path), "restorationContactSheet": str(restore_sheet), "cleanRoundtripContactSheet": str(clean_sheet)}, indent=2))


if __name__ == "__main__":
    main()
