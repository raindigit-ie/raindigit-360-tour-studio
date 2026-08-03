#!/usr/bin/python3
"""Develop and stitch an Insta360 X4 DNG entirely inside RainDigit Studio."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CALIBRATION = ROOT / "config" / "insta360-x4-calibration.pto"
ALIGNER = ROOT / "scripts" / "x4-raw-align.py"


def run(command: list[str], cwd: Path | None = None) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def stage(name: str) -> None:
    print(json.dumps({"stage": name}), flush=True)


def enforce_quality_gate(metrics_path: Path) -> None:
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    reference_edge = float(metrics["edgeEnergy"]["reference"])
    fused_edge = float(metrics["edgeEnergy"]["fused"])
    reference_seam = float(metrics["seam"]["reference"])
    fused_seam = float(metrics["seam"]["fused"])
    checks = {
        "nativeResolution": metrics.get("width") == 11904 and metrics.get("height") == 5952,
        "toneMatched": float(metrics["toneAndDetail"]["lowFrequencyLabMae"]) <= 0.15,
        "chromaMatched": float(metrics["toneAndDetail"]["chromaMae"]) <= 0.15,
        "wrapSeamMatched": abs(fused_seam - reference_seam) <= 0.0001,
        "rawDetailImproved": fused_edge >= reference_edge * 1.08,
        "geometryAligned": float(metrics["postFlowControlP95PxAt2048"]) <= 2.5,
    }
    metrics["qualityGate"] = {
        "passed": all(checks.values()),
        "checks": checks,
        "detailGainPercent": (fused_edge / max(reference_edge, 1e-9) - 1.0) * 100.0,
        "wrapSeamDelta": abs(fused_seam - reference_seam),
    }
    metrics_path.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    failed = [name for name, passed in checks.items() if not passed]
    if failed:
        raise RuntimeError(f"RAW quality gate failed: {', '.join(failed)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dng", required=True, type=Path)
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--metrics", type=Path)
    parser.add_argument("--width", type=int, default=11904)
    parser.add_argument("--strength", type=float, default=1.6)
    args = parser.parse_args()

    if not CALIBRATION.is_file():
        raise RuntimeError(f"Missing X4 calibration: {CALIBRATION}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    metrics_path = args.metrics or args.output.with_suffix(".metrics.json")
    metrics_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="raindigit-x4-") as directory:
        work = Path(directory)
        developed = work / "developed.tif"
        lens0 = work / "lens0.tif"
        lens1 = work / "lens1.tif"
        project = work / "calibration.pto"
        raw_panorama = work / "raw-panorama.tif"
        aligned = work / "aligned-raw.jpg"

        stage("developing-raw")
        run([
            "darktable-cli", str(args.dng), str(developed), "--out-ext", "tif",
            "--core", "--conf", "plugins/imageio/format/tiff/bpp=16",
        ])

        stage("splitting-lenses")
        run(["convert", str(developed), "-crop", "5952x5952+0+0", "+repage", str(lens0)])
        run(["convert", str(developed), "-crop", "5952x5952+5952+0", "+repage", str(lens1)])
        shutil.copy2(CALIBRATION, project)

        stage("stitching-calibrated-panorama")
        run(["nona", "-m", "TIFF_m", "-o", "remapped", project.name], cwd=work)
        run([
            "enblend", "--compression=LZW", f"-f{args.width}x{args.width // 2}+0+0",
            "-o", raw_panorama.name, "remapped0000.tif", "remapped0001.tif",
        ], cwd=work)

        stage("matching-camera-tone-and-detail")
        run([
            "/usr/bin/python3", str(ALIGNER),
            "--raw-panorama", str(raw_panorama),
            "--reference", str(args.reference),
            "--aligned-output", str(aligned),
            "--fused-output", str(args.output),
            "--metrics", str(metrics_path),
            "--width", str(args.width),
            "--strength", str(args.strength),
        ])
        stage("validating-quality")
        enforce_quality_gate(metrics_path)
        stage("complete")


if __name__ == "__main__":
    main()
