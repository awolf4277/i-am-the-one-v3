# Copyright © 2026 Andrew Wolverton. All Rights Reserved.
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

from flask import Blueprint, current_app, jsonify, request

catalog_bp = Blueprint("catalog", __name__)

CATALOG_TARGET = 100


BASE_PRODUCTS = [
    {
        "id": "wolf-core",
        "sku": "WOLF-CORE",
        "name": "WOLF OS™ Core",
        "description": "Foundational operator system package for modern storefront control.",
        "category": "Software",
        "price_cents": 9900,
        "stock": 25,
        "image_url": "https://placehold.co/900x700/png?text=WOLF+OS+CORE",
    },
    {
        "id": "wolf-pro",
        "sku": "WOLF-PRO",
        "name": "WOLF OS™ Pro",
        "description": "Advanced inventory, checkout, and operator dashboard foundation.",
        "category": "Software",
        "price_cents": 19900,
        "stock": 12,
        "image_url": "https://placehold.co/900x700/png?text=WOLF+OS+PRO",
    },
    {
        "id": "iato-launch",
        "sku": "IATO-LAUNCH",
        "name": "I AM THE ONE™ Launch Kit",
        "description": "Starter package for branded storefront deployment.",
        "category": "Launch",
        "price_cents": 29900,
        "stock": 7,
        "image_url": "https://placehold.co/900x700/png?text=I+AM+THE+ONE",
    },
]


PRODUCT_TEMPLATES = [
    ("Luxury Apparel", "Midnight Crown Hoodie", "Heavyweight luxury streetwear hoodie with premium storefront branding.", 8900),
    ("Luxury Apparel", "Diamond Cut Tee", "Soft-touch branded tee designed for premium retail drops.", 4900),
    ("Luxury Apparel", "Black Label Joggers", "Modern tapered joggers with luxury comfort and clean operator styling.", 7900),
    ("Accessories", "Royal Signal Cap", "Structured premium cap with clean front mark and luxury finish.", 3900),
    ("Accessories", "Operator Chain Pack", "Accessory bundle for branded launch kits and storefront collections.", 5900),
    ("Software", "Inventory Pulse Module", "Live product stock module for operator-managed storefronts.", 12900),
    ("Software", "Checkout Command Module", "Checkout foundation with order capture and stock control.", 14900),
    ("Software", "Operator Dashboard Module", "Admin-facing storefront management system package.", 17900),
    ("Digital", "Brand Asset Vault", "Digital brand kit with premium visual storefront assets.", 6900),
    ("Digital", "Launch Page Blueprint", "Premium landing page starter package for product drops.", 9900),
    ("Merch", "Founder Edition Bottle", "Luxury daily-carry bottle for premium brand merchandising.", 4500),
    ("Merch", "Wolf Desk Mat", "Large-format premium operator desk mat for branded workstations.", 5200),
    ("Merch", "Crown Sticker Vault", "High-end sticker pack for packaging, drops, and brand inserts.", 2500),
    ("Launch", "Storefront Starter Bundle", "Complete starter kit for branded product launch presentation.", 24900),
    ("Launch", "Premium Drop Bundle", "High-impact launch bundle for limited product releases.", 34900),
    ("Services", "Setup Assist Package", "Guided setup package for storefront launch preparation.", 19900),
    ("Services", "White Glove Launch", "Premium implementation package for full storefront deployment.", 49900),
    ("Collectibles", "Founder Coin", "Limited digital-inspired collectible for brand supporters.", 11900),
    ("Collectibles", "Black Card Pass", "Premium access-style collectible for VIP customer tiers.", 15900),
    ("Hardware", "Operator Stand", "Premium workstation stand for product display and operator setups.", 12900),
]


TIERS = [
    "Signature",
    "Black Label",
    "Platinum",
    "Royal",
    "Diamond",
]


def build_seed_products(target: int = CATALOG_TARGET) -> list[dict[str, Any]]:
    products = list(BASE_PRODUCTS)
    n = 4

    while len(products) < target:
        category, base_name, description, base_price = PRODUCT_TEMPLATES[
            (n - 4) % len(PRODUCT_TEMPLATES)
        ]
        tier = TIERS[((n - 4) // len(PRODUCT_TEMPLATES)) % len(TIERS)]

        sku = f"IATO-{n:03d}"
        name = f"{base_name} {tier}"
        price_cents = base_price + ((n % 9) * 500)
        stock = 5 + ((n * 7) % 40)
        image_text = quote_plus(f"{sku} {tier}")

        products.append(
            {
                "id": f"iato-{n:03d}",
                "sku": sku,
                "name": name,
                "description": description,
                "category": category,
                "price_cents": price_cents,
                "stock": stock,
                "image_url": f"https://placehold.co/900x700/png?text={image_text}",
            }
        )

        n += 1

    return products


def connect() -> sqlite3.Connection:
    db_path = current_app.config["DB_PATH"]
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    return con


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def list_products_payload(con: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = con.execute(
        """
        SELECT id, sku, name, description, category, price_cents, stock, image_url
        FROM products
        ORDER BY sku ASC
        """
    ).fetchall()

    return [row_to_dict(row) for row in rows]


def init_db() -> None:
    con = connect()
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                sku TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT 'General',
                price_cents INTEGER NOT NULL DEFAULT 0,
                stock INTEGER NOT NULL DEFAULT 0,
                image_url TEXT NOT NULL DEFAULT ''
            )
            """
        )

        seed_products = build_seed_products(CATALOG_TARGET)

        con.executemany(
            """
            INSERT OR IGNORE INTO products (
                id, sku, name, description, category, price_cents, stock, image_url
            )
            VALUES (
                :id, :sku, :name, :description, :category, :price_cents, :stock, :image_url
            )
            """,
            seed_products,
        )

        con.commit()
    finally:
        con.close()


@catalog_bp.get("/api/products")
def list_products():
    init_db()

    con = connect()
    try:
        return jsonify(
            {
                "ok": True,
                "capacity": CATALOG_TARGET,
                "products": list_products_payload(con),
            }
        )
    finally:
        con.close()


@catalog_bp.get("/api/products/<product_id>")
def get_product(product_id: str):
    init_db()

    con = connect()
    try:
        row = con.execute(
            """
            SELECT id, sku, name, description, category, price_cents, stock, image_url
            FROM products
            WHERE id = ?
            """,
            (product_id,),
        ).fetchone()

        if row is None:
            return jsonify({"ok": False, "error": "Product not found"}), 404

        return jsonify({"ok": True, "product": row_to_dict(row)})
    finally:
        con.close()


@catalog_bp.patch("/api/products/<product_id>")
def update_product(product_id: str):
    init_db()

    payload = request.get_json(silent=True) or {}

    allowed_fields = {
        "name",
        "description",
        "category",
        "price_cents",
        "stock",
        "image_url",
    }

    updates: dict[str, Any] = {}

    for field in allowed_fields:
        if field in payload:
            updates[field] = payload[field]

    if not updates:
        return jsonify({"ok": False, "error": "No valid fields provided"}), 400

    if "price_cents" in updates:
        try:
            updates["price_cents"] = int(updates["price_cents"])
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "Invalid price"}), 400

        if updates["price_cents"] < 0:
            return jsonify({"ok": False, "error": "Price cannot be negative"}), 400

    if "stock" in updates:
        try:
            updates["stock"] = int(updates["stock"])
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "Invalid stock"}), 400

        if updates["stock"] < 0:
            return jsonify({"ok": False, "error": "Stock cannot be negative"}), 400

    con = connect()
    try:
        existing = con.execute(
            "SELECT id FROM products WHERE id = ?",
            (product_id,),
        ).fetchone()

        if existing is None:
            return jsonify({"ok": False, "error": "Product not found"}), 404

        set_clause = ", ".join([f"{field} = ?" for field in updates.keys()])
        values = list(updates.values())
        values.append(product_id)

        con.execute(
            f"""
            UPDATE products
            SET {set_clause}
            WHERE id = ?
            """,
            values,
        )

        con.commit()

        row = con.execute(
            """
            SELECT id, sku, name, description, category, price_cents, stock, image_url
            FROM products
            WHERE id = ?
            """,
            (product_id,),
        ).fetchone()

        return jsonify(
            {
                "ok": True,
                "product": row_to_dict(row),
                "products": list_products_payload(con),
            }
        )
    finally:
        con.close()
