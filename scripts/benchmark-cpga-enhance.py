#!/usr/bin/env python3
"""Benchmark CPGA-Net lightweight enhancement on real X4 panorama crops."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "qa" / "ai-enhance-lab"
OUT = LAB / "cpga-output"
REPORT = LAB / "cpga-report"
CPGA_ROOT = LAB / "tools" / "CPGA-Net-Pytorch"

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
    {
        "label": "cpga-lolv1",
        "path": CPGA_ROOT / "weights" / "enhance_color-llie-ResCBAM_g-LOLv1.pkl",
        "efficient": False,
    },
    {
        "label": "cpga-lolv2-vgg",
        "path": CPGA_ROOT / "weights" / "enhance_color-llie-ResCBAM_g-vggloss-LOLv2.pkl",
        "efficient": False,
    },
    {
        "label": "cpga-dgf",
        "path": CPGA_ROOT / "weights" / "enhance_color-llie-ResCBAM_g-8-DGF.pkl",
        "efficient": True,
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
    gray = luma(array).astype(np.float32)
    return float(cv2.Laplacian(gray, cv2.CV_32F).var())


def stats(reference: Image.Image, candidate: Image.Image) -> dict[str, float]:
    ref = image_array(reference)
    cand = image_array(candidate.resize(reference.size, Image.Resampling.LANCZOS))
    diff = cand - ref
    cand_luma = luma(cand)
    ref_edge = edge_energy(ref)
    cand_edge = edge_energy(cand)
    return {
        "meanLuma": round(float(cand_luma.mean()), 4),
        "lumaStd": round(float(cand_luma.std()), 4),
        "shadowPixelsPct": round(float(np.mean(cand_luma < 32.0) * 100.0), 4),
        "highlightPixelsPct": round(float(np.mean(cand_luma > 245.0) * 100.0), 4),
        "edgeEnergy": round(cand_edge, 4),
        "edgeEnergyVsReferencePct": round((cand_edge / ref_edge - 1.0) * 100.0, 4),
        "laplacianVariance": round(laplacian_variance(cand), 4),
        "laplacianVarianceVsReferencePct": round((laplacian_variance(cand) / laplacian_variance(ref) - 1.0) * 100.0, 4),
        "maeVsReference": round(float(np.mean(np.abs(diff))), 4),
        "changedPixelsOver12Pct": round(float(np.mean(np.max(np.abs(diff), axis=2) > 12.0) * 100.0), 4),
        "p95MaxChannelDelta": round(float(np.percentile(np.max(np.abs(diff), axis=2), 95)), 4),
    }


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


def load_cpga(model_info: dict[str, object], device: torch.device):
    if str(CPGA_ROOT) not in sys.path:
        sys.path.insert(0, str(CPGA_ROOT))
    from model import enhance_color

    net = enhance_color(n_channels=8, isdgf=True).to(device) if bool(model_info["efficient"]) else enhance_color().to(device)
    state = torch.load(model_info["path"], map_location=device)
    net.load_state_dict(state["state_dict"] if isinstance(state, dict) and "state_dict" in state else state)
    net.eval()
    return net


def run_cpga(net, image: Image.Image, device: torch.device) -> Image.Image:
    array = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    tensor = torch.from_numpy(array).permute(2, 0, 1).unsqueeze(0).to(device)
    with torch.no_grad():
        output = net(tensor)
    output = output.clamp(0.0, 1.0).squeeze(0).permute(1, 2, 0).detach().cpu().numpy()
    return Image.fromarray(np.asarray(output * 255.0, dtype=np.uint8), "RGB")


def blend(reference: Image.Image, enhanced: Image.Image, alpha: float) -> Image.Image:
    return Image.blend(reference, enhanced.resize(reference.size, Image.Resampling.LANCZOS), alpha)


def main() -> None:
    ensure_dirs()
    missing = [str(model["path"]) for model in MODELS if not Path(model["path"]).exists()]
    if missing:
        raise SystemExit("Missing CPGA model(s): " + ", ".join(missing))

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    loaded_models = []
    for model in MODELS:
        started = time.time()
        loaded_models.append((model, load_cpga(model, device), round(time.time() - started, 3)))

    labels = ["reference"]
    for model in MODELS:
        labels.extend([str(model["label"]), f"{model['label']}-blend25"])

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
        variants = {}

        for model, net, load_seconds in loaded_models:
            label = str(model["label"])
            started = time.time()
            enhanced = run_cpga(net, reference, device)
            inference_seconds = round(time.time() - started, 3)
            out_path = sample_dir / f"{label}.jpg"
            save_jpeg(enhanced, out_path, 92)
            variants[label] = {
                "path": str(out_path),
                "bytes": out_path.stat().st_size,
                "modelBytes": Path(model["path"]).stat().st_size,
                "loadSeconds": load_seconds,
                "inferenceSeconds": inference_seconds,
                "efficient": bool(model["efficient"]),
                "stats": stats(reference, enhanced),
            }
            row[label] = out_path

            blend_label = f"{label}-blend25"
            blended = blend(reference, enhanced, 0.25)
            blend_path = sample_dir / f"{blend_label}.jpg"
            save_jpeg(blended, blend_path, 92)
            variants[blend_label] = {
                "path": str(blend_path),
                "bytes": blend_path.stat().st_size,
                "modelBytes": Path(model["path"]).stat().st_size,
                "blendAlpha": 0.25,
                "stats": stats(reference, blended),
            }
            row[blend_label] = blend_path

        sample_results.append({
            "id": sample_id,
            "source": str(sample["source"]),
            "box": sample["box"],
            "referenceStats": stats(reference, reference),
            "variants": variants,
        })
        rows.append(row)

    contact = REPORT / "cpga-enhance-contact-sheet.jpg"
    make_contact_sheet(rows, labels, contact)
    report = {
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "method": "CPGA-Net pretrained lightweight low-light/enhancement models on real X4 crops, direct output plus 25% blend.",
        "device": str(device),
        "models": [
            {
                "label": str(model["label"]),
                "path": str(model["path"]),
                "bytes": Path(model["path"]).stat().st_size,
                "efficient": bool(model["efficient"]),
            }
            for model in MODELS
        ],
        "contactSheet": str(contact),
        "samples": sample_results,
    }
    report_path = REPORT / "cpga-enhance-benchmark-report.json"
    report_path.write_text(json.dumps(report, indent=2), "utf-8")
    print(json.dumps({"report": str(report_path), "contactSheet": str(contact), "device": str(device)}, indent=2))


if __name__ == "__main__":
    main()
