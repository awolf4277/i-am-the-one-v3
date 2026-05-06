# Copyright © 2026 Andrew Wolverton. All Rights Reserved.
from __future__ import annotations

import json
import os
from urllib.parse import quote_plus

from flask import jsonify, request

from app import create_app

app = create_app()


def _media_slot_count() -> int:
    raw = os.getenv("MEDIA_SLOTS", str(app.config.get("MEDIA_SLOTS", 25)))
    try:
        value = int(raw)
    except ValueError:
        value = 25
    return max(1, min(value, 25))


def _safe_text(value: object, fallback: str = "") -> str:
    text = str(value or "").strip()
    return text if text else fallback


def _demo_image_url(sku: str, name: str, slot: int) -> str:
    label = quote_plus(f"{sku} Slot {slot:02d}")
    return f"https://placehold.co/900x700/png?text={label}"


def _ensure_product_demo_media(product: dict) -> dict:
    slot_count = _media_slot_count()

    product_id = _safe_text(product.get("id"), _safe_text(product.get("sku"), "demo-product"))
    sku = _safe_text(product.get("sku"), product_id).upper()
    name = _safe_text(product.get("name"), sku)

    primary_url = _safe_text(product.get("image_url"))
    if not primary_url:
        primary_url = _demo_image_url(sku, name, 1)

    existing_media = product.get("media")
    if not isinstance(existing_media, list):
        existing_media = []

    by_slot: dict[int, dict] = {}

    for entry in existing_media:
        if not isinstance(entry, dict):
            continue

        try:
            slot = int(entry.get("slot") or 0)
        except (TypeError, ValueError):
            slot = 0

        if slot < 1 or slot > slot_count:
            continue

        url = _safe_text(entry.get("url"), _safe_text(entry.get("image_url")))
        if not url:
            url = primary_url if slot == 1 else _demo_image_url(sku, name, slot)

        by_slot[slot] = {
            **entry,
            "id": _safe_text(entry.get("id"), f"{product_id}-media-{slot:02d}"),
            "product_id": _safe_text(entry.get("product_id"), product_id),
            "slot": slot,
            "url": url,
            "alt": _safe_text(entry.get("alt"), f"{name} slot {slot:02d}"),
            "is_primary": slot == 1,
        }

    for slot in range(1, slot_count + 1):
        if slot in by_slot:
            continue

        url = primary_url if slot == 1 else _demo_image_url(sku, name, slot)

        by_slot[slot] = {
            "id": f"{product_id}-media-{slot:02d}",
            "product_id": product_id,
            "slot": slot,
            "url": url,
            "alt": f"{name} slot {slot:02d}",
            "is_primary": slot == 1,
        }

    product["image_url"] = primary_url
    product["media"] = [by_slot[slot] for slot in range(1, slot_count + 1)]
    product["media_slots"] = slot_count

    return product


@app.after_request
def inject_demo_media_slots(response):
    if request.path != "/api/products":
        return response

    if response.status_code != 200 or not response.is_json:
        return response

    data = response.get_json(silent=True)
    if not isinstance(data, dict):
        return response

    products = data.get("products")
    if not isinstance(products, list):
        return response

    data["products"] = [
        _ensure_product_demo_media(product)
        for product in products
        if isinstance(product, dict)
    ]
    data["ok"] = True
    data["media_slots"] = _media_slot_count()
    data["demo_media_slots"] = True

    response.set_data(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    response.mimetype = "application/json"

    return response


@app.get("/")
def render_root():
    return jsonify(
        ok=True,
        app="I AM THE ONE v3 API",
        system="WOLF OS",
        message="Backend is live. Use /api/health or /api/products.",
    )


@app.get("/api/debug/routes")
def debug_routes():
    return jsonify(
        ok=True,
        routes=sorted(str(rule) for rule in app.url_map.iter_rules()),
    )