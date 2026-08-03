#!/usr/bin/python3
"""Measure whether aligned X4 RAW data provides visible safe detail over camera JPEG."""

from __future__ import annotations

import argparse
import gc
import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
ALIGNER_PATH = ROOT / "scripts" / "x4-raw-align.py"
SPEC = importlib.util.spec_from_file_location("x4_raw_align", ALIGNER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load {ALIGNER_PATH}")
ALIGNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ALIGNER)


def read(path: Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Could not read image: {path}")
    return image


def pixel_difference(reference: np.ndarray, candidate: np.ndarray) -> dict:
    delta = np.abs(reference.astype(np.int16) - candidate.astype(np.int16))
    maximum = delta.max(axis=2)
    return {
        "meanAbs8bit": float(delta.mean()),
        "p95Abs8bit": float(np.percentile(delta, 95)),
        "p99Abs8bit": float(np.percentile(delta, 99)),
        "pixelsChangedOver1Percent": float((maximum > 1).mean() * 100),
        "pixelsChangedOver5Percent": float((maximum > 5).mean() * 100),
        "pixelsChangedOver15Percent": float((maximum > 15).mean() * 100),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--aligned-raw", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--strengths", default="1.6,3.0,5.0,8.0")
    args = parser.parse_args()

    strengths = [float(value.strip()) for value in args.strengths.split(",") if value.strip()]
    if not strengths or any(value <= 0 for value in strengths):
        raise RuntimeError("Provide one or more positive fusion strengths")

    reference = read(args.reference)
    raw = read(args.aligned_raw)
    if reference.shape != raw.shape:
        raise RuntimeError("Reference and aligned RAW must have identical dimensions")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    report = {
        "reference": str(args.reference),
        "alignedRaw": str(args.aligned_raw),
        "dimensions": {"width": int(reference.shape[1]), "height": int(reference.shape[0])},
        "variants": [],
    }
    reference_energy = ALIGNER.edge_energy(reference)
    for strength in strengths:
        candidate = ALIGNER.fuse_raw_detail_striped(raw, reference, strength)
        filename = f"raw-detail-strength-{strength:.1f}.jpg"
        output = args.output_dir / filename
        if not cv2.imwrite(str(output), candidate, [cv2.IMWRITE_JPEG_QUALITY, 97]):
            raise RuntimeError(f"Could not write {output}")
        energy = ALIGNER.edge_energy(candidate)
        report["variants"].append({
            "strength": strength,
            "file": filename,
            "detailGainPercent": (energy / max(reference_energy, 1e-9) - 1.0) * 100.0,
            "pixelDifference": pixel_difference(reference, candidate),
        })
        del candidate
        gc.collect()
        (args.output_dir / "raw-benefit-report.json").write_text(
            json.dumps(report, indent=2) + "\n",
            encoding="utf-8",
        )

    report_path = args.output_dir / "raw-benefit-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
