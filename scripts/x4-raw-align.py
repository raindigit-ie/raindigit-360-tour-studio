#!/usr/bin/python3
"""Align a calibrated X4 RAW panorama to its camera JPEG and fuse RAW detail."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np


def read_image(path: Path, flags: int) -> np.ndarray:
    image = cv2.imread(str(path), flags)
    if image is None:
        raise RuntimeError(f"Could not read image: {path}")
    return image


def resize_to(image: np.ndarray, width: int, height: int) -> np.ndarray:
    return cv2.resize(image, (width, height), interpolation=cv2.INTER_LANCZOS4)


def feature_image(image: np.ndarray) -> np.ndarray:
    if image.dtype != np.uint8:
        scale = 255.0 / max(float(np.percentile(image, 99.8)), 1.0)
        image = np.clip(image.astype(np.float32) * scale, 0, 255).astype(np.uint8)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(12, 6))
    normalized = clahe.apply(gray)
    gx = cv2.Sobel(normalized, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(normalized, cv2.CV_32F, 0, 1, ksize=3)
    magnitude = cv2.magnitude(gx, gy)
    return cv2.normalize(magnitude, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)


def pixels_to_vectors(points: np.ndarray, width: int, height: int) -> np.ndarray:
    lon = (points[:, 0] / width - 0.5) * (2.0 * math.pi)
    lat = (0.5 - points[:, 1] / height) * math.pi
    cos_lat = np.cos(lat)
    return np.column_stack((cos_lat * np.sin(lon), np.sin(lat), cos_lat * np.cos(lon)))


def vectors_to_pixels(vectors: np.ndarray, width: int, height: int) -> np.ndarray:
    longitude = np.arctan2(vectors[:, 0], vectors[:, 2])
    latitude = np.arcsin(np.clip(vectors[:, 1], -1.0, 1.0))
    return np.column_stack(
        (
            (longitude / (2.0 * math.pi) + 0.5) * width,
            (0.5 - latitude / math.pi) * height,
        )
    )


def kabsch(source: np.ndarray, target: np.ndarray) -> np.ndarray:
    covariance = source.T @ target
    u, _, vt = np.linalg.svd(covariance)
    rotation = vt.T @ u.T
    if np.linalg.det(rotation) < 0:
        vt[-1, :] *= -1
        rotation = vt.T @ u.T
    return rotation


def angular_error(rotation: np.ndarray, source: np.ndarray, target: np.ndarray) -> np.ndarray:
    predicted = (rotation @ source.T).T
    cosine = np.clip(np.sum(predicted * target, axis=1), -1.0, 1.0)
    return np.degrees(np.arccos(cosine))


def estimate_rotation(
    raw_preview: np.ndarray,
    reference_preview: np.ndarray,
) -> tuple[np.ndarray, dict, np.ndarray, np.ndarray]:
    raw_features = feature_image(raw_preview)
    reference_features = feature_image(reference_preview)
    sift = cv2.SIFT_create(nfeatures=12000, contrastThreshold=0.015, edgeThreshold=18)
    raw_keys, raw_desc = sift.detectAndCompute(raw_features, None)
    ref_keys, ref_desc = sift.detectAndCompute(reference_features, None)
    if raw_desc is None or ref_desc is None:
        raise RuntimeError("Not enough features to align RAW and JPEG panoramas")

    matcher = cv2.BFMatcher(cv2.NORM_L2)
    pairs = matcher.knnMatch(raw_desc, ref_desc, k=2)
    good = [first for first, second in pairs if first.distance < 0.72 * second.distance]
    good.sort(key=lambda match: match.distance)
    good = good[:1600]
    if len(good) < 12:
        raise RuntimeError(f"Only {len(good)} reliable RAW/JPEG feature matches were found")

    raw_points = np.float64([raw_keys[match.queryIdx].pt for match in good])
    ref_points = np.float64([ref_keys[match.trainIdx].pt for match in good])
    height, width = raw_features.shape
    pole_mask = (
        (raw_points[:, 1] > height * 0.08)
        & (raw_points[:, 1] < height * 0.92)
        & (ref_points[:, 1] > height * 0.08)
        & (ref_points[:, 1] < height * 0.92)
    )
    raw_vectors = pixels_to_vectors(raw_points[pole_mask], width, height)
    ref_vectors = pixels_to_vectors(ref_points[pole_mask], width, height)
    if len(raw_vectors) < 10:
        raise RuntimeError("RAW/JPEG matches did not cover enough of the panorama")

    generator = np.random.default_rng(360)
    best_inliers = np.zeros(len(raw_vectors), dtype=bool)
    best_error = float("inf")
    for _ in range(4000):
        sample = generator.choice(len(raw_vectors), size=3, replace=False)
        rotation = kabsch(raw_vectors[sample], ref_vectors[sample])
        errors = angular_error(rotation, raw_vectors, ref_vectors)
        inliers = errors < 1.2
        score = int(np.count_nonzero(inliers))
        median = float(np.median(errors[inliers])) if score else float("inf")
        if score > int(np.count_nonzero(best_inliers)) or (
            score == int(np.count_nonzero(best_inliers)) and median < best_error
        ):
            best_inliers = inliers
            best_error = median

    if np.count_nonzero(best_inliers) < 8:
        raise RuntimeError("Could not estimate a stable spherical RAW/JPEG rotation")
    rotation = kabsch(raw_vectors[best_inliers], ref_vectors[best_inliers])
    errors = angular_error(rotation, raw_vectors, ref_vectors)
    refined = errors < 0.65
    if np.count_nonzero(refined) < 20:
        refined = best_inliers
    rotation = kabsch(raw_vectors[refined], ref_vectors[refined])
    errors = angular_error(rotation, raw_vectors, ref_vectors)
    refined = errors < 0.65
    if np.count_nonzero(refined) >= 20:
        rotation = kabsch(raw_vectors[refined], ref_vectors[refined])
        errors = angular_error(rotation, raw_vectors, ref_vectors)

    rotated_points = vectors_to_pixels(
        (rotation @ raw_vectors[refined].T).T,
        width,
        height,
    )
    control_points = ref_points[pole_mask][refined]
    residuals = rotated_points - control_points
    residuals[:, 0] = (residuals[:, 0] + width / 2.0) % width - width / 2.0
    metrics = {
        "featureMatches": len(good),
        "rotationInliers": int(np.count_nonzero(refined)),
        "medianAngularErrorDeg": float(np.median(errors[refined])),
        "p95AngularErrorDeg": float(np.percentile(errors[refined], 95)),
        "rotation": rotation.tolist(),
    }
    return rotation, metrics, control_points, residuals


def rotation_map_block(
    width: int,
    height: int,
    rotation: np.ndarray,
    top: int,
    bottom: int,
    flow: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    x = np.arange(width, dtype=np.float32)
    longitude = (x / width - 0.5) * (2.0 * math.pi)
    inverse = rotation.T
    y = np.arange(top, bottom, dtype=np.float32)
    lon_grid, lat_grid = np.meshgrid(longitude, (0.5 - y / height) * math.pi)
    if flow is not None:
        flow_height, flow_width = flow.shape[:2]
        sample_x, sample_y = np.meshgrid(
            np.arange(width, dtype=np.float32) * (flow_width / width),
            y * (flow_height / height),
        )
        sampled_flow = cv2.remap(
            flow,
            sample_x,
            sample_y,
            cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_WRAP,
        )
        corrected_x = (
            np.arange(width, dtype=np.float32)[None, :]
            + sampled_flow[..., 0] * (width / flow_width)
        ) % width
        corrected_y = np.clip(
            y[:, None] + sampled_flow[..., 1] * (height / flow_height),
            0,
            height - 1,
        )
        lon_grid = (corrected_x / width - 0.5) * (2.0 * math.pi)
        lat_grid = (0.5 - corrected_y / height) * math.pi
    cos_lat = np.cos(lat_grid)
    target = np.stack(
        (cos_lat * np.sin(lon_grid), np.sin(lat_grid), cos_lat * np.cos(lon_grid)),
        axis=-1,
    )
    source = target @ inverse.T
    source_lon = np.arctan2(source[..., 0], source[..., 2])
    source_lat = np.arcsin(np.clip(source[..., 1], -1.0, 1.0))
    map_x = (((source_lon / (2.0 * math.pi) + 0.5) * width) % width).astype(np.float32)
    map_y = np.clip((0.5 - source_lat / math.pi) * height, 0, height - 1).astype(np.float32)
    return map_x, map_y


def remap_spherical_striped(
    source: np.ndarray,
    width: int,
    height: int,
    rotation: np.ndarray,
    flow: np.ndarray | None,
) -> np.ndarray:
    if source.ndim == 3 and source.shape[2] > 3:
        source = source[..., :3]
    output = np.empty((height, width, 3), dtype=np.uint8)
    for top in range(0, height, 128):
        bottom = min(top + 128, height)
        map_x, map_y = rotation_map_block(width, height, rotation, top, bottom, flow)
        block = cv2.remap(source, map_x, map_y, cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_WRAP)
        if block.dtype == np.uint16:
            block = np.clip(block / 257.0, 0, 255).astype(np.uint8)
        output[top:bottom] = block
    return output


def build_control_flow(
    control_points: np.ndarray,
    residuals: np.ndarray,
    width: int,
    height: int,
) -> tuple[np.ndarray, dict]:
    grid_width = 128
    grid_height = 64
    grid_x = np.linspace(0, width - 1, grid_width, dtype=np.float32)
    grid_y = np.linspace(0, height - 1, grid_height, dtype=np.float32)
    output = np.zeros((grid_height, grid_width, 2), dtype=np.float32)
    confidence = np.zeros((grid_height, grid_width), dtype=np.float32)
    radius = width * 0.065

    for row, y in enumerate(grid_y):
        dx = np.abs(grid_x[:, None] - control_points[None, :, 0])
        dx = np.minimum(dx, width - dx)
        dy = grid_y[row] - control_points[:, 1]
        distance2 = dx * dx + dy[None, :] * dy[None, :]
        neighbour_count = min(10, len(control_points))
        nearest = np.argpartition(distance2, neighbour_count - 1, axis=1)[:, :neighbour_count]
        nearest_distance = np.take_along_axis(distance2, nearest, axis=1)
        weights = np.exp(-nearest_distance / (2.0 * radius * radius)) / np.maximum(nearest_distance, 1.0)
        weights /= np.maximum(np.sum(weights, axis=1, keepdims=True), 1e-6)
        output[row] = np.sum(residuals[nearest] * weights[..., None], axis=1)
        confidence[row] = np.exp(-np.sqrt(np.min(distance2, axis=1)) / radius)

    output[..., 0] = wrapped_gaussian(output[..., 0], 0.7)
    output[..., 1] = wrapped_gaussian(output[..., 1], 0.7)
    confidence = wrapped_gaussian(confidence, 0.7)
    output *= np.clip(confidence[..., None] * 1.5, 0.0, 1.0)
    flow = cv2.resize(output, (width, height), interpolation=cv2.INTER_CUBIC)
    magnitude = np.linalg.norm(flow, axis=2)
    sample_flow = cv2.remap(
        flow,
        control_points[:, 0].astype(np.float32).reshape(-1, 1),
        control_points[:, 1].astype(np.float32).reshape(-1, 1),
        cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_WRAP,
    ).reshape(-1, 2)
    remaining = np.linalg.norm(residuals - sample_flow, axis=1)
    metrics = {
        "controlPointCount": int(len(control_points)),
        "controlResidualMedianPxAt2048": float(np.median(np.linalg.norm(residuals, axis=1))),
        "controlResidualP95PxAt2048": float(np.percentile(np.linalg.norm(residuals, axis=1), 95)),
        "smoothFlowMedianPxAt2048": float(np.median(magnitude)),
        "smoothFlowP95PxAt2048": float(np.percentile(magnitude, 95)),
        "postFlowControlMedianPxAt2048": float(np.median(remaining)),
        "postFlowControlP95PxAt2048": float(np.percentile(remaining, 95)),
    }
    return flow, metrics


def seam_metric(image: np.ndarray) -> float:
    left = image[:, 0].astype(np.float32)
    right = image[:, -1].astype(np.float32)
    denominator = max(float(np.mean(image)), 1.0)
    return float(np.mean(np.abs(left - right)) / denominator)


def edge_energy(image: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    laplacian = cv2.Laplacian(gray, cv2.CV_32F, ksize=3)
    return float(np.mean(np.abs(laplacian)))


def wrapped_gaussian(image: np.ndarray, sigma: float) -> np.ndarray:
    padding = max(4, int(math.ceil(sigma * 4.0)))
    wrapped = np.concatenate((image[:, -padding:], image, image[:, :padding]), axis=1)
    blurred = cv2.GaussianBlur(wrapped, (0, 0), sigma, borderType=cv2.BORDER_REFLECT_101)
    return blurred[:, padding:-padding]


def match_histogram(source: np.ndarray, reference: np.ndarray) -> np.ndarray:
    source_values = np.clip(source, 0, 255).astype(np.uint8)
    reference_values = np.clip(reference, 0, 255).astype(np.uint8)
    source_hist = np.bincount(source_values.ravel(), minlength=256).astype(np.float64)
    reference_hist = np.bincount(reference_values.ravel(), minlength=256).astype(np.float64)
    source_cdf = np.cumsum(source_hist) / max(float(np.sum(source_hist)), 1.0)
    reference_cdf = np.cumsum(reference_hist) / max(float(np.sum(reference_hist)), 1.0)
    lookup = np.interp(source_cdf, reference_cdf, np.arange(256, dtype=np.float64))
    return lookup[source_values].astype(np.float32)


def detail_layer(raw_gray: np.ndarray, reference_gray: np.ndarray, raw_scale: float, reference_scale: float) -> np.ndarray:
    raw_fine = raw_gray - wrapped_gaussian(raw_gray, 0.62)
    reference_fine = reference_gray - wrapped_gaussian(reference_gray, 0.62)
    normalized_raw = raw_fine * (reference_scale / max(raw_scale, 0.01))
    same_direction = normalized_raw * reference_fine > 0
    visible_reference_edge = np.abs(reference_fine) > 0.3
    detail = np.where(same_direction & visible_reference_edge, normalized_raw, 0.0)
    return np.clip(detail, -(np.abs(reference_fine) * 2.2 + 0.8), np.abs(reference_fine) * 2.2 + 0.8)


def fuse_raw_detail_striped(raw: np.ndarray, reference: np.ndarray, strength: float) -> np.ndarray:
    preview_width = 2048
    preview_height = preview_width // 2
    raw_preview = resize_to(raw, preview_width, preview_height)
    reference_preview = resize_to(reference, preview_width, preview_height)
    raw_gray = cv2.cvtColor(raw_preview, cv2.COLOR_BGR2GRAY).astype(np.float32)
    reference_gray = cv2.cvtColor(reference_preview, cv2.COLOR_BGR2GRAY).astype(np.float32)
    raw_fine = raw_gray - wrapped_gaussian(raw_gray, 0.62)
    reference_fine = reference_gray - wrapped_gaussian(reference_gray, 0.62)
    raw_scale = float(np.percentile(np.abs(raw_fine), 95))
    reference_scale = float(np.percentile(np.abs(reference_fine), 95))

    height, width = reference.shape[:2]
    output = np.empty_like(reference)
    seam_fade = min(max(256, width // 24), width // 8)
    horizontal_weight = np.ones(width, dtype=np.float32)
    ramp = np.sin(np.linspace(0, math.pi / 2.0, seam_fade, dtype=np.float32)) ** 2
    horizontal_weight[:seam_fade] = ramp
    horizontal_weight[-seam_fade:] = ramp[::-1]

    overlap = 8
    for top in range(0, height, 256):
        bottom = min(top + 256, height)
        source_top = max(0, top - overlap)
        source_bottom = min(height, bottom + overlap)
        raw_block = cv2.cvtColor(raw[source_top:source_bottom], cv2.COLOR_BGR2GRAY).astype(np.float32)
        reference_block = cv2.cvtColor(reference[source_top:source_bottom], cv2.COLOR_BGR2GRAY).astype(np.float32)
        detail = detail_layer(raw_block, reference_block, raw_scale, reference_scale)
        detail *= horizontal_weight[None, :]
        crop_top = top - source_top
        crop_bottom = crop_top + (bottom - top)
        block = reference[top:bottom].astype(np.float32)
        block += strength * detail[crop_top:crop_bottom, :, None]
        output[top:bottom] = np.clip(block, 0, 255).astype(np.uint8)
    return output


def comparison_metrics(reference: np.ndarray, fused: np.ndarray) -> dict:
    width = 2048
    height = width // 2
    reference_preview = resize_to(reference, width, height)
    fused_preview = resize_to(fused, width, height)
    reference_lab = cv2.cvtColor(reference_preview, cv2.COLOR_BGR2LAB).astype(np.float32)
    fused_lab = cv2.cvtColor(fused_preview, cv2.COLOR_BGR2LAB).astype(np.float32)
    low_reference = cv2.GaussianBlur(reference_lab, (0, 0), 6.0)
    low_fused = cv2.GaussianBlur(fused_lab, (0, 0), 6.0)
    return {
        "lowFrequencyLabMae": float(np.mean(np.abs(low_fused - low_reference))),
        "chromaMae": float(np.mean(np.abs(fused_lab[..., 1:] - reference_lab[..., 1:]))),
        "referenceEdgeEnergy": edge_energy(reference_preview),
        "fusedEdgeEnergy": edge_energy(fused_preview),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-panorama", required=True, type=Path)
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--aligned-output", required=True, type=Path)
    parser.add_argument("--fused-output", required=True, type=Path)
    parser.add_argument("--metrics", required=True, type=Path)
    parser.add_argument("--width", type=int, default=8192)
    parser.add_argument("--strength", type=float, default=1.35)
    args = parser.parse_args()

    height = args.width // 2
    raw_full = read_image(args.raw_panorama, cv2.IMREAD_UNCHANGED)
    reference_full = read_image(args.reference, cv2.IMREAD_COLOR)
    preview_width = 2048
    preview_height = preview_width // 2
    raw_preview = resize_to(raw_full, preview_width, preview_height)
    reference_preview = resize_to(reference_full, preview_width, preview_height)
    rotation, metrics, control_points, residuals = estimate_rotation(raw_preview, reference_preview)
    flow, flow_metrics = build_control_flow(
        control_points,
        residuals,
        preview_width,
        preview_height,
    )
    metrics.update(flow_metrics)

    raw = raw_full if raw_full.shape[1] == args.width and raw_full.shape[0] == height else resize_to(raw_full, args.width, height)
    reference = reference_full if reference_full.shape[1] == args.width and reference_full.shape[0] == height else resize_to(reference_full, args.width, height)
    aligned8 = remap_spherical_striped(raw, args.width, height, rotation, flow)
    del raw_full, raw
    fused = fuse_raw_detail_striped(aligned8, reference, args.strength)

    args.aligned_output.parent.mkdir(parents=True, exist_ok=True)
    args.fused_output.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(args.aligned_output), aligned8, [cv2.IMWRITE_JPEG_QUALITY, 97]):
        raise RuntimeError(f"Could not write {args.aligned_output}")
    if not cv2.imwrite(str(args.fused_output), fused, [cv2.IMWRITE_JPEG_QUALITY, 97]):
        raise RuntimeError(f"Could not write {args.fused_output}")

    metrics.update(
        {
            "width": args.width,
            "height": height,
            "strength": args.strength,
            "seam": {
                "reference": seam_metric(reference),
                "alignedRaw": seam_metric(aligned8),
                "fused": seam_metric(fused),
            },
            "edgeEnergy": {
                "reference": edge_energy(reference),
                "alignedRaw": edge_energy(aligned8),
                "fused": edge_energy(fused),
            },
            "toneAndDetail": comparison_metrics(reference, fused),
        }
    )
    args.metrics.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
