#!/usr/bin/env python3
"""Benchmark non-neural enhancement controls against the AI candidates."""

from __future__ import annotations

import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "qa" / "ai-enhance-lab"
OUT = LAB / "classical-output"
REPORT = LAB / "classical-report"

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


def ensure_dirs() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    REPORT.mkdir(parents=True, exist_ok=True)


def save_jpeg(image: Image.Image, path: Path, quality: int = 92) -> None:
    image.save(path, "JPEG", quality=quality, subsampling="4:2:0", optimize=True, progressive=True)


def crop_sample(sample: dict[str, object]) -> Image.Image:
    source = ImageOps.exif_transpose(Image.open(sample["source"])).convert("RGB")
    x, y, w, h = sample["box"]
    return source.crop((x, y, x + w, y + h))


def image_array(image: Image.Image) -> np.ndarray:
    return np.asarray(image.convert("RGB"), dtype=np.float32)


def luma(array: np.ndarray) -> np.ndarray:
    return array[..., 0] * 0.2126 + array[..., 1] * 0.7152 + array[..., 2] * 0.0722


def edge_energy(array: np.ndarray) -> float:
    gray = luma(array)
    gx = np.diff(gray, axis=1)
    gy = np.diff(gray, axis=0)
    return float((np.mean(np.abs(gx)) + np.mean(np.abs(gy))) / 2.0)


def laplacian_variance(array: np.ndarray) -> float:
    return float(cv2.Laplacian(luma(array).astype(np.float32), cv2.CV_32F).var())


def stats(reference: Image.Image, candidate: Image.Image) -> dict[str, float]:
    ref = image_array(reference)
    cand = image_array(candidate.resize(reference.size, Image.Resampling.LANCZOS))
    diff = cand - ref
    ref_edge = edge_energy(ref)
    cand_edge = edge_energy(cand)
    ref_lap = laplacian_variance(ref)
    cand_lap = laplacian_variance(cand)
    cand_luma = luma(cand)
    return {
        "meanLuma": round(float(cand_luma.mean()), 4),
        "lumaStd": round(float(cand_luma.std()), 4),
        "shadowPixelsPct": round(float(np.mean(cand_luma < 32.0) * 100.0), 4),
        "highlightPixelsPct": round(float(np.mean(cand_luma > 245.0) * 100.0), 4),
        "edgeEnergy": round(cand_edge, 4),
        "edgeEnergyVsReferencePct": round((cand_edge / ref_edge - 1.0) * 100.0, 4),
        "laplacianVariance": round(cand_lap, 4),
        "laplacianVarianceVsReferencePct": round((cand_lap / ref_lap - 1.0) * 100.0, 4),
        "maeVsReference": round(float(np.mean(np.abs(diff))), 4),
        "changedPixelsOver12Pct": round(float(np.mean(np.max(np.abs(diff), axis=2) > 12.0) * 100.0), 4),
        "p95MaxChannelDelta": round(float(np.percentile(np.max(np.abs(diff), axis=2), 95)), 4),
    }


def natural_grade(image: Image.Image) -> Image.Image:
    graded = ImageEnhance.Contrast(image).enhance(1.035)
    graded = ImageEnhance.Color(graded).enhance(1.02)
    graded = graded.filter(ImageFilter.UnsharpMask(radius=0.8, percent=55, threshold=3))
    return graded


def lab_clahe(image: Image.Image, clip_limit: float = 1.35, blend: float = 0.25) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"))
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(8, 8))
    l2 = clahe.apply(l)
    lab2 = cv2.merge([l2, a, b])
    out = cv2.cvtColor(lab2, cv2.COLOR_LAB2RGB)
    enhanced = Image.fromarray(out)
    return Image.blend(image, enhanced, blend)


def detail_grade(image: Image.Image) -> Image.Image:
    graded = lab_clahe(image, clip_limit=1.45, blend=0.32)
    graded = ImageEnhance.Contrast(graded).enhance(1.045)
    graded = graded.filter(ImageFilter.UnsharpMask(radius=0.75, percent=75, threshold=2))
    return graded


def strong_grade(image: Image.Image) -> Image.Image:
    graded = lab_clahe(image, clip_limit=1.8, blend=0.5)
    graded = ImageEnhance.Contrast(graded).enhance(1.09)
    graded = ImageEnhance.Sharpness(graded).enhance(1.18)
    graded = graded.filter(ImageFilter.UnsharpMask(radius=0.7, percent=110, threshold=1))
    return graded


def make_contact_sheet(rows: list[dict[str, object]], labels: list[str], output: Path) -> None:
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
            image = Image.open(row[label]).convert("RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            sheet.paste(image, (x0, y0 + header_h))
            draw.text((x0 + 8, y0 + header_h + thumb_h + 5), label, fill="#fff9ec")
    save_jpeg(sheet, output, 90)


def main() -> None:
    ensure_dirs()
    variants = {
        "natural-grade": natural_grade,
        "lab-clahe-blend": lab_clahe,
        "detail-grade": detail_grade,
        "strong-grade": strong_grade,
    }
    labels = ["reference", *variants.keys()]
    rows = []
    sample_results = []
    for sample in SAMPLES:
        sample_id = str(sample["id"])
        sample_dir = OUT / sample_id
        sample_dir.mkdir(parents=True, exist_ok=True)
        reference = crop_sample(sample)
        ref_path = sample_dir / "reference.jpg"
        save_jpeg(reference, ref_path, 96)
        row = {"id": sample_id, "reference": ref_path}
        result_variants = {}
        for label, fn in variants.items():
            started = time.time()
            candidate = fn(reference)
            elapsed = round(time.time() - started, 3)
            out_path = sample_dir / f"{label}.jpg"
            save_jpeg(candidate, out_path, 92)
            row[label] = out_path
            result_variants[label] = {
                "path": str(out_path),
                "bytes": out_path.stat().st_size,
                "inferenceSeconds": elapsed,
                "stats": stats(reference, candidate),
            }
        rows.append(row)
        sample_results.append({
            "id": sample_id,
            "source": str(sample["source"]),
            "box": sample["box"],
            "referenceStats": stats(reference, reference),
            "variants": result_variants,
        })

    contact = REPORT / "classical-enhance-contact-sheet.jpg"
    make_contact_sheet(rows, labels, contact)
    report = {
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "method": "Non-neural controls for local contrast, tone and sharpening; used to check whether AI candidates outperform a simple honest grade.",
        "contactSheet": str(contact),
        "samples": sample_results,
    }
    report_path = REPORT / "classical-enhance-benchmark-report.json"
    report_path.write_text(json.dumps(report, indent=2), "utf-8")
    print(json.dumps({"report": str(report_path), "contactSheet": str(contact)}, indent=2))


if __name__ == "__main__":
    main()
