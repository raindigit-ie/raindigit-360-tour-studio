#!/usr/bin/env python3
"""Benchmark local AI restoration and image compression for X4 360 panoramas."""

from __future__ import annotations

import json
import math
import os
import subprocess
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "qa" / "ai-enhance-lab"
OUT = LAB / "output"
REPORT = LAB / "report"
TOOLS = LAB / "tools"
REALESRGAN = TOOLS / "realesrgan-ncnn-vulkan-v0.2.0-macos" / "realesrgan-ncnn-vulkan"
MODEL_DIR = TOOLS / "realesrgan-20220424" / "models"

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
CLEAN_ROUNDTRIP_IDS = {"kitchen-table-floor"}


def ensure_dirs() -> None:
    for path in [OUT, REPORT]:
        path.mkdir(parents=True, exist_ok=True)


def save_jpeg(image: Image.Image, path: Path, quality: int = 92) -> None:
    image.save(path, "JPEG", quality=quality, subsampling="4:2:0", optimize=True, progressive=True)


def save_webp(image: Image.Image, path: Path, quality: int = 82) -> None:
    image.save(path, "WEBP", quality=quality, method=6)


def save_avif(image: Image.Image, path: Path, quality: int = 46) -> None:
    image.save(path, "AVIF", quality=quality, speed=4)


def image_array(path_or_image: Path | Image.Image) -> np.ndarray:
    image = Image.open(path_or_image) if isinstance(path_or_image, Path) else path_or_image
    return np.asarray(ImageOps.exif_transpose(image).convert("RGB"), dtype=np.float32)


def to_luma(array: np.ndarray) -> np.ndarray:
    return array[..., 0] * 0.2126 + array[..., 1] * 0.7152 + array[..., 2] * 0.0722


def edge_energy(array: np.ndarray) -> float:
    gray = to_luma(array)
    gx = np.diff(gray, axis=1)
    gy = np.diff(gray, axis=0)
    return float((np.mean(np.abs(gx)) + np.mean(np.abs(gy))) / 2.0)


def metrics(reference: Image.Image, candidate: Image.Image) -> dict[str, float]:
    ref = image_array(reference)
    cand = image_array(candidate.resize(reference.size, Image.Resampling.LANCZOS))
    diff = cand - ref
    mae = float(np.mean(np.abs(diff)))
    rmse = float(math.sqrt(np.mean(diff * diff)))
    psnr = 99.0 if rmse == 0 else float(20.0 * math.log10(255.0 / rmse))
    ref_edge = edge_energy(ref)
    cand_edge = edge_energy(cand)
    high_delta = np.mean(np.max(np.abs(diff), axis=2) > 12.0) * 100.0
    p95 = float(np.percentile(np.max(np.abs(diff), axis=2), 95))
    return {
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "psnr": round(psnr, 4),
        "edgeEnergy": round(cand_edge, 4),
        "edgeEnergyVsReferencePct": round((cand_edge / ref_edge - 1.0) * 100.0, 4),
        "changedPixelsOver12Pct": round(float(high_delta), 4),
        "p95MaxChannelDelta": round(p95, 4),
    }


def crop_sample(sample: dict[str, object]) -> Image.Image:
    source = ImageOps.exif_transpose(Image.open(sample["source"])).convert("RGB")
    x, y, w, h = sample["box"]
    return source.crop((x, y, x + w, y + h))


def run_realesrgan(input_path: Path, output_path: Path, scale: int = 2) -> tuple[bool, str, float]:
    start = time.time()
    command = [
        str(REALESRGAN),
        "-i",
        str(input_path),
        "-o",
        str(output_path),
        "-n",
        "realesrgan-x4plus",
        "-m",
        str(MODEL_DIR),
        "-s",
        str(scale),
        "-t",
        "256",
        "-f",
        "png",
    ]
    try:
        result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False, timeout=180)
    except Exception as exc:
        return False, str(exc), time.time() - start
    if result.returncode != 0:
        return False, (result.stderr or result.stdout or f"exit {result.returncode}")[:1200], time.time() - start
    return True, (result.stderr or result.stdout).strip(), time.time() - start


def manual_restore(image: Image.Image) -> Image.Image:
    restored = image.filter(ImageFilter.MedianFilter(size=3))
    restored = restored.filter(ImageFilter.UnsharpMask(radius=0.9, percent=85, threshold=3))
    restored = ImageEnhance.Contrast(restored).enhance(1.045)
    restored = ImageEnhance.Sharpness(restored).enhance(1.08)
    return restored


def bytes_for(path: Path) -> int:
    return path.stat().st_size if path.exists() else 0


def make_contact_sheet(rows: list[dict[str, object]], output: Path) -> None:
    labels = ["reference", "low input", "lanczos", "manual", "ai restored", "ai clean roundtrip"]
    thumb_w, thumb_h = 360, 270
    header_h = 34
    label_h = 28
    sheet = Image.new("RGB", (thumb_w * len(labels), (thumb_h + header_h + label_h) * len(rows)), "#17140d")
    for row_index, row in enumerate(rows):
        y0 = row_index * (thumb_h + header_h + label_h)
        for col_index, label in enumerate(labels):
            x0 = col_index * thumb_w
            img = Image.open(row[label]).convert("RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            sheet.paste(img, (x0, y0 + header_h))
        # Draw labels with default bitmap font via ImageMagick-free fallback.
        from PIL import ImageDraw

        draw = ImageDraw.Draw(sheet)
        draw.text((8, y0 + 8), str(row["id"]), fill="#f4d17a")
        for col_index, label in enumerate(labels):
            draw.text((col_index * thumb_w + 8, y0 + header_h + thumb_h + 6), label, fill="#fff9ec")
    save_jpeg(sheet, output, 90)


def crop_benchmark() -> dict[str, object]:
    if not REALESRGAN.exists() or not MODEL_DIR.exists():
        return {"error": "Real-ESRGAN binary or model directory is missing."}
    rows = []
    results = []
    for sample in SAMPLES:
        sample_id = str(sample["id"])
        sample_dir = OUT / sample_id
        sample_dir.mkdir(parents=True, exist_ok=True)
        reference = crop_sample(sample)
        low = reference.resize((reference.width // 2, reference.height // 2), Image.Resampling.LANCZOS)
        low_path = sample_dir / "low-input-q70.jpg"
        ref_path = sample_dir / "reference.jpg"
        lanczos_path = sample_dir / "restored-lanczos.jpg"
        manual_path = sample_dir / "restored-manual.jpg"
        ai_path = sample_dir / "restored-ai.png"
        ai_clean_path = sample_dir / "clean-ai-roundtrip.png"
        ai_clean_down_path = sample_dir / "clean-ai-roundtrip-down.jpg"

        save_jpeg(reference, ref_path, 96)
        save_jpeg(low, low_path, 70)
        lanczos = low.resize(reference.size, Image.Resampling.LANCZOS)
        manual = manual_restore(lanczos)
        save_jpeg(lanczos, lanczos_path, 92)
        save_jpeg(manual, manual_path, 92)

        ai_ok, ai_log, ai_seconds = run_realesrgan(low_path, ai_path, 2)
        if ai_ok:
            ai_image = Image.open(ai_path).convert("RGB").resize(reference.size, Image.Resampling.LANCZOS)
        else:
            ai_image = lanczos.copy()
            ai_path = lanczos_path

        # Directly test one clean crop. Running this for a whole 70MP panorama is
        # intentionally treated as impractical unless this small test is excellent.
        clean_input = sample_dir / "clean-input.jpg"
        save_jpeg(reference, clean_input, 95)
        clean_ok = sample_id in CLEAN_ROUNDTRIP_IDS
        clean_log = "skipped: clean AI roundtrip is intentionally sampled once because it is expensive"
        clean_seconds = 0.0
        if clean_ok:
            clean_ok, clean_log, clean_seconds = run_realesrgan(clean_input, ai_clean_path, 2)
        if clean_ok and ai_clean_path.exists():
            clean_down = Image.open(ai_clean_path).convert("RGB").resize(reference.size, Image.Resampling.LANCZOS)
        else:
            clean_down = reference.copy()
            ai_clean_path = ref_path
        save_jpeg(clean_down, ai_clean_down_path, 92)

        restored = [
            ("lowInputUpscaled", lanczos_path, lanczos),
            ("manualFilter", manual_path, manual),
            ("realEsrgan", ai_path, ai_image),
            ("realEsrganCleanRoundtrip", ai_clean_down_path, clean_down),
        ]
        sample_result = {
            "id": sample_id,
            "source": str(sample["source"]),
            "box": sample["box"],
            "referenceBytes": bytes_for(ref_path),
            "lowInputBytes": bytes_for(low_path),
            "ai": {
                "restorationOk": ai_ok,
                "restorationSeconds": round(ai_seconds, 3),
                "restorationLog": ai_log,
                "cleanRoundtripOk": clean_ok,
                "cleanRoundtripSeconds": round(clean_seconds, 3),
                "cleanRoundtripLog": clean_log,
            },
            "variants": {},
        }
        for name, path, image in restored:
            variant = {
                "path": str(path),
                "bytes": bytes_for(path),
                "metricsVsReference": metrics(reference, image),
            }
            sample_result["variants"][name] = variant
        results.append(sample_result)
        rows.append({
            "id": sample_id,
            "reference": ref_path,
            "low input": low_path,
            "lanczos": lanczos_path,
            "manual": manual_path,
            "ai restored": ai_path,
            "ai clean roundtrip": ai_clean_down_path,
        })

    contact = REPORT / "ai-enhance-crop-contact-sheet.jpg"
    make_contact_sheet(rows, contact)
    return {
        "contactSheet": str(contact),
        "samples": results,
    }


def compression_benchmark() -> dict[str, object]:
    source = ROOT / "originals" / "Camera01" / "IMG_20260801_132729_00_002.jpg"
    source_image = ImageOps.exif_transpose(Image.open(source)).convert("RGB")
    target_width = 4096
    target_height = target_width // 2
    reference = source_image.resize((target_width, target_height), Image.Resampling.LANCZOS)
    ref_path = OUT / "compression-reference-4096.png"
    reference.save(ref_path, "PNG", optimize=True)
    candidates = [
        ("jpeg-q92", OUT / "compression-jpeg-q92.jpg", lambda: save_jpeg(reference, OUT / "compression-jpeg-q92.jpg", 92)),
        ("jpeg-q88", OUT / "compression-jpeg-q88.jpg", lambda: save_jpeg(reference, OUT / "compression-jpeg-q88.jpg", 88)),
        ("webp-q82", OUT / "compression-webp-q82.webp", lambda: save_webp(reference, OUT / "compression-webp-q82.webp", 82)),
        ("webp-q88", OUT / "compression-webp-q88.webp", lambda: save_webp(reference, OUT / "compression-webp-q88.webp", 88)),
        ("avif-q46", OUT / "compression-avif-q46.avif", lambda: save_avif(reference, OUT / "compression-avif-q46.avif", 46)),
        ("avif-q55", OUT / "compression-avif-q55.avif", lambda: save_avif(reference, OUT / "compression-avif-q55.avif", 55)),
    ]
    results = []
    for name, path, writer in candidates:
        started = time.time()
        error = None
        try:
            writer()
            image = Image.open(path).convert("RGB")
            variant_metrics = metrics(reference, image)
        except Exception as exc:
            error = str(exc)
            variant_metrics = None
        results.append({
            "name": name,
            "path": str(path),
            "bytes": bytes_for(path),
            "encodeSeconds": round(time.time() - started, 3),
            "metricsVsReference": variant_metrics,
            "error": error,
        })
    return {
        "source": str(source),
        "sourceBytes": bytes_for(source),
        "reference": str(ref_path),
        "referenceSize": [target_width, target_height],
        "results": results,
    }


def main() -> None:
    ensure_dirs()
    report = {
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "realEsrganBinary": str(REALESRGAN),
        "realEsrganModelDir": str(MODEL_DIR),
        "method": "Downsample X4 crops by 2x, restore to original crop size, compare against original camera crop; separately test compression on 4096px web panorama for stable local iteration.",
        "cropBenchmark": crop_benchmark(),
        "compressionBenchmark": compression_benchmark(),
    }
    report_path = REPORT / "ai-enhance-benchmark-report.json"
    report_path.write_text(json.dumps(report, indent=2), "utf-8")
    print(json.dumps({"report": str(report_path), "contactSheet": report["cropBenchmark"].get("contactSheet")}, indent=2))


if __name__ == "__main__":
    main()
