#!/usr/bin/env python3
"""Benchmark portable ncnn photo AI enhancers against RainDigit 360 crops."""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "qa" / "ai-enhance-lab"
TOOLS = LAB / "tools"
OUT = LAB / "ncnn-photo-output"
REPORT = LAB / "ncnn-photo-report"
HYBRID_LABEL = "srmd-x2-n0-mild-detail"

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
    {
        "id": "wrap-seam-kitchen",
        "source": ROOT / "originals" / "Camera01" / "IMG_20260801_132729_00_002.jpg",
        "wrap_seam": True,
        "y": 2100,
        "height": 768,
        "half_width": 512,
    },
]


def ensure_dirs() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    REPORT.mkdir(parents=True, exist_ok=True)


def save_jpeg(image: Image.Image, path: Path, quality: int = 92) -> None:
    image.save(path, "JPEG", quality=quality, subsampling="4:2:0", optimize=True, progressive=True)


def save_png(image: Image.Image, path: Path) -> None:
    image.save(path, "PNG", optimize=True)


def image_array(image: Image.Image) -> np.ndarray:
    return np.asarray(ImageOps.exif_transpose(image).convert("RGB"), dtype=np.float32)


def luma(array: np.ndarray) -> np.ndarray:
    return array[..., 0] * 0.2126 + array[..., 1] * 0.7152 + array[..., 2] * 0.0722


def edge_energy(array: np.ndarray) -> float:
    gray = luma(array)
    gx = np.diff(gray, axis=1)
    gy = np.diff(gray, axis=0)
    return float((np.mean(np.abs(gx)) + np.mean(np.abs(gy))) / 2.0)


def laplacian_variance(array: np.ndarray) -> float:
    return float(cv2.Laplacian(luma(array).astype(np.float32), cv2.CV_32F).var())


def seam_jump(image: Image.Image) -> float:
    arr = image_array(image)
    left = arr[:, 0, :]
    right = arr[:, -1, :]
    return float(np.mean(np.abs(left - right)))


def stats(reference: Image.Image, candidate: Image.Image) -> dict[str, float]:
    ref = image_array(reference)
    cand_image = candidate.resize(reference.size, Image.Resampling.LANCZOS)
    cand = image_array(cand_image)
    diff = cand - ref
    rmse = float(math.sqrt(np.mean(diff * diff)))
    ref_edge = edge_energy(ref)
    cand_edge = edge_energy(cand)
    ref_lap = laplacian_variance(ref)
    cand_lap = laplacian_variance(cand)
    return {
        "mae": round(float(np.mean(np.abs(diff))), 4),
        "rmse": round(rmse, 4),
        "psnr": round(99.0 if rmse == 0 else 20.0 * math.log10(255.0 / rmse), 4),
        "meanLumaDelta": round(float(luma(cand).mean() - luma(ref).mean()), 4),
        "edgeEnergy": round(cand_edge, 4),
        "edgeEnergyVsReferencePct": round((cand_edge / ref_edge - 1.0) * 100.0, 4),
        "laplacianVariance": round(cand_lap, 4),
        "laplacianVarianceVsReferencePct": round((cand_lap / ref_lap - 1.0) * 100.0, 4),
        "changedPixelsOver12Pct": round(float(np.mean(np.max(np.abs(diff), axis=2) > 12.0) * 100.0), 4),
        "p95MaxChannelDelta": round(float(np.percentile(np.max(np.abs(diff), axis=2), 95)), 4),
        "seamJumpDelta": round(seam_jump(cand_image) - seam_jump(reference), 4),
    }


def crop_sample(sample: dict[str, Any]) -> Image.Image:
    source = ImageOps.exif_transpose(Image.open(sample["source"])).convert("RGB")
    if sample.get("wrap_seam"):
        half_width = int(sample["half_width"])
        y = int(sample["y"])
        height = int(sample["height"])
        left = source.crop((source.width - half_width, y, source.width, y + height))
        right = source.crop((0, y, half_width, y + height))
        out = Image.new("RGB", (half_width * 2, height))
        out.paste(left, (0, 0))
        out.paste(right, (half_width, 0))
        return out
    x, y, w, h = sample["box"]
    return source.crop((x, y, x + w, y + h))


def serializable_sample(sample: dict[str, Any]) -> dict[str, Any]:
    return {key: str(value) if isinstance(value, Path) else value for key, value in sample.items()}


def natural_detail_grade(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"))
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.45, tileGridSize=(8, 8))
    l2 = clahe.apply(l)
    enhanced = Image.fromarray(cv2.cvtColor(cv2.merge([l2, a, b]), cv2.COLOR_LAB2RGB))
    graded = Image.blend(image, enhanced, 0.32)
    graded = ImageEnhance.Contrast(graded).enhance(1.045)
    return graded.filter(ImageFilter.UnsharpMask(radius=0.75, percent=75, threshold=2))


def mild_detail_grade(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"))
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.28, tileGridSize=(8, 8))
    l2 = clahe.apply(l)
    enhanced = Image.fromarray(cv2.cvtColor(cv2.merge([l2, a, b]), cv2.COLOR_LAB2RGB))
    graded = Image.blend(image, enhanced, 0.22)
    graded = ImageEnhance.Contrast(graded).enhance(1.025)
    return graded.filter(ImageFilter.UnsharpMask(radius=0.65, percent=45, threshold=3))


def tool_size(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    total = 0
    for child in path.rglob("*"):
        if child.is_file():
            total += child.stat().st_size
    return total


def candidate_definitions() -> list[dict[str, Any]]:
    srmd = TOOLS / "srmd-ncnn-vulkan-20220728-macos"
    waifu = TOOLS / "waifu2x-ncnn-vulkan-20250915-macos"
    realsr = TOOLS / "realsr-ncnn-vulkan-20220728-macos"
    candidates = [
        {
            "label": "srmd-x2-n0",
            "kind": "ncnn",
            "root": srmd,
            "bin": srmd / "srmd-ncnn-vulkan",
            "args": ["-s", "2", "-n", "0", "-m", "models-srmd", "-f", "png", "-t", "256"],
            "maxCleanSamples": 5,
        },
        {
            "label": "srmd-x2-n3",
            "kind": "ncnn",
            "root": srmd,
            "bin": srmd / "srmd-ncnn-vulkan",
            "args": ["-s", "2", "-n", "3", "-m", "models-srmd", "-f", "png", "-t", "256"],
            "maxCleanSamples": 5,
        },
        {
            "label": "waifu2x-photo-x2-n0",
            "kind": "ncnn",
            "root": waifu,
            "bin": waifu / "waifu2x-ncnn-vulkan",
            "args": ["-s", "2", "-n", "0", "-m", "models-upconv_7_photo", "-f", "png", "-t", "256"],
            "maxCleanSamples": 5,
        },
        {
            "label": "waifu2x-photo-x2-n1",
            "kind": "ncnn",
            "root": waifu,
            "bin": waifu / "waifu2x-ncnn-vulkan",
            "args": ["-s", "2", "-n", "1", "-m", "models-upconv_7_photo", "-f", "png", "-t", "256"],
            "maxCleanSamples": 5,
        },
        {
            "label": "realsr-x4",
            "kind": "ncnn",
            "root": realsr,
            "bin": realsr / "realsr-ncnn-vulkan",
            "args": ["-s", "4", "-m", "models-DF2K_JPEG", "-f", "png", "-t", "256"],
            "cleanSampleIds": {"hall-stairs-wood"},
            "restoreSampleIds": {"hall-stairs-wood", "kitchen-window-cabinets"},
        },
    ]
    return candidates


def run_candidate(candidate: dict[str, Any], input_path: Path, output_path: Path, timeout: int = 120) -> tuple[bool, float, str | None]:
    if not Path(candidate["bin"]).exists():
        return False, 0.0, f"missing binary: {candidate['bin']}"
    started = time.time()
    command = [str(candidate["bin"]), "-i", str(input_path), "-o", str(output_path), *candidate["args"]]
    try:
        subprocess.run(command, cwd=candidate["root"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, round(time.time() - started, 3), f"timeout after {timeout}s"
    except subprocess.CalledProcessError as exc:
        message = (exc.stderr or exc.stdout or str(exc)).strip().splitlines()
        return False, round(time.time() - started, 3), message[-1] if message else str(exc)
    return True, round(time.time() - started, 3), None


def placeholder(size: tuple[int, int], text: str) -> Image.Image:
    image = Image.new("RGB", size, "#24211b")
    draw = ImageDraw.Draw(image)
    draw.text((20, 20), text, fill="#f4d17a")
    return image


def make_contact_sheet(rows: list[dict[str, Any]], labels: list[str], output: Path) -> None:
    thumb_w, thumb_h = 280, 210
    header_h = 32
    label_h = 28
    sheet = Image.new("RGB", (thumb_w * len(labels), (thumb_h + header_h + label_h) * len(rows)), "#15120d")
    draw = ImageDraw.Draw(sheet)
    for row_index, row in enumerate(rows):
        y0 = row_index * (thumb_h + header_h + label_h)
        draw.text((8, y0 + 7), str(row["id"]), fill="#f4d17a")
        for col_index, label in enumerate(labels):
            x0 = col_index * thumb_w
            image_path = row.get(label)
            if image_path and Path(image_path).exists():
                image = Image.open(image_path).convert("RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            else:
                image = placeholder((thumb_w, thumb_h), "missing")
            sheet.paste(image, (x0, y0 + header_h))
            draw.text((x0 + 8, y0 + header_h + thumb_h + 6), label, fill="#fff9ec")
    save_jpeg(sheet, output, 90)


def main() -> None:
    ensure_dirs()
    candidates = candidate_definitions()
    available_candidates = [candidate for candidate in candidates if Path(candidate["bin"]).exists()]
    if not available_candidates:
        raise SystemExit("No ncnn enhancer binaries found in qa/ai-enhance-lab/tools")

    for candidate in available_candidates:
        try:
            Path(candidate["bin"]).chmod(0o755)
        except OSError:
            pass

    restore_labels = ["reference", "low", "lanczos", "detail-grade", *[c["label"] for c in available_candidates], HYBRID_LABEL]
    clean_labels = ["reference", "detail-grade", *[c["label"] for c in available_candidates], HYBRID_LABEL]
    restore_rows: list[dict[str, Any]] = []
    clean_rows: list[dict[str, Any]] = []
    sample_results = []

    for sample in SAMPLES:
        sample_id = str(sample["id"])
        sample_dir = OUT / sample_id
        sample_dir.mkdir(parents=True, exist_ok=True)

        reference = crop_sample(sample)
        ref_path = sample_dir / "reference.jpg"
        save_jpeg(reference, ref_path, 96)

        low = reference.resize((reference.width // 2, reference.height // 2), Image.Resampling.LANCZOS)
        low_path = sample_dir / "low-input-q70.jpg"
        save_jpeg(low, low_path, 70)

        lanczos = low.resize(reference.size, Image.Resampling.LANCZOS)
        lanczos_path = sample_dir / "baseline-lanczos.jpg"
        save_jpeg(lanczos, lanczos_path, 92)

        detail = natural_detail_grade(reference)
        detail_path = sample_dir / "detail-grade.jpg"
        save_jpeg(detail, detail_path, 92)

        restore_row = {"id": sample_id, "reference": ref_path, "low": low_path, "lanczos": lanczos_path, "detail-grade": detail_path}
        clean_row = {"id": sample_id, "reference": ref_path, "detail-grade": detail_path}
        variants: dict[str, Any] = {
            "baseline-lanczos": {
                "path": str(lanczos_path),
                "bytes": lanczos_path.stat().st_size,
                "metricsVsReference": stats(reference, lanczos),
            },
            "detail-grade": {
                "path": str(detail_path),
                "bytes": detail_path.stat().st_size,
                "metricsVsReference": stats(reference, detail),
            },
        }

        for candidate in available_candidates:
            label = str(candidate["label"])
            max_restore = int(candidate.get("maxRestoreSamples", len(SAMPLES)))
            max_clean = int(candidate.get("maxCleanSamples", len(SAMPLES)))
            sample_index = len(sample_results)
            restore_sample_ids = candidate.get("restoreSampleIds")
            clean_sample_ids = candidate.get("cleanSampleIds")

            restored_path = sample_dir / f"restored-{label}.png"
            should_restore = sample_id in restore_sample_ids if restore_sample_ids else sample_index < max_restore
            if should_restore:
                ok, elapsed, error = run_candidate(candidate, low_path, restored_path)
                if ok:
                    restored = Image.open(restored_path).convert("RGB").resize(reference.size, Image.Resampling.LANCZOS)
                else:
                    restored = placeholder(reference.size, error or "failed")
                    restored_path = sample_dir / f"restored-{label}-failed.jpg"
                    save_jpeg(restored, restored_path, 88)
            else:
                ok, elapsed, error = False, 0.0, "skipped to keep heavy-model benchmark bounded"
                restored = placeholder(reference.size, error)
                restored_path = sample_dir / f"restored-{label}-skipped.jpg"
                save_jpeg(restored, restored_path, 88)
            restored_jpg = sample_dir / f"restored-{label}.jpg"
            save_jpeg(restored, restored_jpg, 92)
            restore_row[label] = restored_jpg

            clean_path = sample_dir / f"clean-roundtrip-{label}.png"
            ref_png = sample_dir / "reference-input.png"
            save_png(reference, ref_png)
            should_clean = sample_id in clean_sample_ids if clean_sample_ids else sample_index < max_clean
            if should_clean:
                clean_ok, clean_elapsed, clean_error = run_candidate(candidate, ref_png, clean_path)
                if clean_ok:
                    clean = Image.open(clean_path).convert("RGB").resize(reference.size, Image.Resampling.LANCZOS)
                else:
                    clean = placeholder(reference.size, clean_error or "failed")
                    clean_path = sample_dir / f"clean-roundtrip-{label}-failed.jpg"
                    save_jpeg(clean, clean_path, 88)
            else:
                clean_ok, clean_elapsed, clean_error = False, 0.0, "skipped to keep heavy-model benchmark bounded"
                clean = placeholder(reference.size, clean_error)
                clean_path = sample_dir / f"clean-roundtrip-{label}-skipped.jpg"
                save_jpeg(clean, clean_path, 88)
            clean_jpg = sample_dir / f"clean-roundtrip-{label}.jpg"
            save_jpeg(clean, clean_jpg, 92)
            clean_row[label] = clean_jpg

            variants[label] = {
                "toolRoot": str(candidate["root"]),
                "toolBytes": tool_size(Path(candidate["root"])),
                "restore": {
                    "ok": ok,
                    "error": error,
                    "seconds": elapsed,
                    "path": str(restored_jpg),
                    "bytes": restored_jpg.stat().st_size,
                    "metricsVsReference": stats(reference, restored),
                },
                "cleanRoundtrip": {
                    "ok": clean_ok,
                    "error": clean_error,
                    "seconds": clean_elapsed,
                    "path": str(clean_jpg),
                    "bytes": clean_jpg.stat().st_size,
                    "metricsVsReference": stats(reference, clean),
                },
            }

        hybrid_started = time.time()
        srmd_restore_path = Path(restore_row["srmd-x2-n0"])
        srmd_clean_path = Path(clean_row["srmd-x2-n0"])
        hybrid_restore = mild_detail_grade(Image.open(srmd_restore_path).convert("RGB"))
        hybrid_clean = mild_detail_grade(Image.open(srmd_clean_path).convert("RGB"))
        hybrid_elapsed = round(time.time() - hybrid_started, 3)
        hybrid_restore_path = sample_dir / f"restored-{HYBRID_LABEL}.jpg"
        hybrid_clean_path = sample_dir / f"clean-roundtrip-{HYBRID_LABEL}.jpg"
        save_jpeg(hybrid_restore, hybrid_restore_path, 92)
        save_jpeg(hybrid_clean, hybrid_clean_path, 92)
        restore_row[HYBRID_LABEL] = hybrid_restore_path
        clean_row[HYBRID_LABEL] = hybrid_clean_path
        srmd_root = TOOLS / "srmd-ncnn-vulkan-20220728-macos"
        variants[HYBRID_LABEL] = {
            "toolRoot": f"{srmd_root} + local mild detail grade",
            "toolBytes": tool_size(srmd_root),
            "restore": {
                "ok": True,
                "error": None,
                "seconds": hybrid_elapsed,
                "path": str(hybrid_restore_path),
                "bytes": hybrid_restore_path.stat().st_size,
                "metricsVsReference": stats(reference, hybrid_restore),
            },
            "cleanRoundtrip": {
                "ok": True,
                "error": None,
                "seconds": hybrid_elapsed,
                "path": str(hybrid_clean_path),
                "bytes": hybrid_clean_path.stat().st_size,
                "metricsVsReference": stats(reference, hybrid_clean),
            },
        }

        restore_rows.append(restore_row)
        clean_rows.append(clean_row)
        sample_results.append({
            "id": sample_id,
            "source": str(sample["source"]),
            "sample": serializable_sample(sample),
            "referenceStats": stats(reference, reference),
            "variants": variants,
        })

    restore_contact = REPORT / "ncnn-photo-restoration-contact-sheet.jpg"
    clean_contact = REPORT / "ncnn-photo-clean-roundtrip-contact-sheet.jpg"
    make_contact_sheet(restore_rows, restore_labels, restore_contact)
    make_contact_sheet(clean_rows, clean_labels, clean_contact)

    report = {
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "method": "Portable ncnn/Vulkan photo AI benchmark. Restoration starts from a 50% downsampled q70 input; cleanRoundtrip upscales already usable X4 JPG crops and downsamples back to tour size.",
        "sourceRepos": [
            "https://github.com/nihui/srmd-ncnn-vulkan",
            "https://github.com/nihui/waifu2x-ncnn-vulkan",
            "https://github.com/nihui/realsr-ncnn-vulkan",
        ],
        "restoreContactSheet": str(restore_contact),
        "cleanRoundtripContactSheet": str(clean_contact),
        "availableCandidates": [
            {
                "label": candidate["label"],
                "root": str(candidate["root"]),
                "bytes": tool_size(Path(candidate["root"])),
                "args": candidate["args"],
            }
            for candidate in available_candidates
        ],
        "samples": sample_results,
        "decisionRule": "A candidate is acceptable only if visual detail improves without obvious hallucination, seam/tile artifacts, large tone shifts, or impractical runtime/weight.",
    }
    report_path = REPORT / "ncnn-photo-ai-benchmark-report.json"
    report_path.write_text(json.dumps(report, indent=2), "utf-8")
    print(json.dumps({"report": str(report_path), "restoreContactSheet": str(restore_contact), "cleanContactSheet": str(clean_contact)}, indent=2))


if __name__ == "__main__":
    main()
