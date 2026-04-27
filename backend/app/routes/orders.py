# Copyright © 2026 Andrew Wolverton. All Rights Reserved.
from __future__ import annotations

import secrets
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, jsonify, request

from app.routes.auth import require_admin
from app.routes.catalog import connect, init_db as init_catalog_db, row_to_dict

orders_bp = Blueprint("orders", __name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_upload_token() -> str:
    return secrets.token_urlsafe(32)


def ensure_column(con: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    cols = con.execute(f"PRAGMA table_info({table})").fetchall()
    existing = {row["name"] for row in cols}

    if column not in existing:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_orders_db() -> None:
    init_catalog_db()

    con = connect()
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'paid',
                total_cents INTEGER NOT NULL DEFAULT 0,
                upload_token TEXT NOT NULL DEFAULT ''
            )
            """
        )

        ensure_column(con, "orders", "upload_token", "upload_token TEXT NOT NULL DEFAULT ''")

        con.execute(
            """
            CREATE TABLE IF NOT EXISTS order_items (
                id TEXT PRIMARY KEY,
                order_id TEXT NOT NULL,
                product_id TEXT NOT NULL,
                sku TEXT NOT NULL,
                name TEXT NOT NULL,
                unit_price_cents INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                line_total_cents INTEGER NOT NULL,
                FOREIGN KEY(order_id) REFERENCES orders(id)
            )
            """
        )

        con.commit()
    finally:
        con.close()


def list_products_payload(con: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = con.execute(
        """
        SELECT id, sku, name, description, category, price_cents, stock, image_url
        FROM products
        ORDER BY sku ASC
        """
    ).fetchall()

    return [row_to_dict(row) for row in rows]


def normalize_cart_items(raw_items: Any) -> tuple[dict[str, int] | None, str | None]:
    if not isinstance(raw_items, list) or not raw_items:
        return None, "Cart is empty"

    totals: dict[str, int] = {}

    for item in raw_items:
        if not isinstance(item, dict):
            return None, "Invalid cart item"

        product_id = str(item.get("product_id", "")).strip()

        try:
            qty = int(item.get("qty", 0))
        except (TypeError, ValueError):
            return None, "Invalid cart quantity"

        if not product_id:
            return None, "Missing product ID"

        if qty <= 0:
            return None, "Quantity must be greater than zero"

        totals[product_id] = totals.get(product_id, 0) + qty

    return totals, None


@orders_bp.post("/api/checkout")
def checkout():
    init_orders_db()

    payload = request.get_json(silent=True) or {}
    requested, error = normalize_cart_items(payload.get("items", []))

    if error or requested is None:
        return jsonify({"ok": False, "error": error or "Invalid cart"}), 400

    order_id = f"ORD-{uuid.uuid4().hex[:10].upper()}"
    upload_token = new_upload_token()

    con = connect()
    try:
        con.execute("BEGIN IMMEDIATE")

        product_rows: dict[str, sqlite3.Row] = {}

        for product_id, requested_qty in requested.items():
            row = con.execute(
                """
                SELECT id, sku, name, price_cents, stock
                FROM products
                WHERE id = ?
                """,
                (product_id,),
            ).fetchone()

            if row is None:
                products = list_products_payload(con)
                con.rollback()
                return jsonify({
                    "ok": False,
                    "error": f"Product not found: {product_id}",
                    "products": products,
                }), 404

            current_stock = int(row["stock"])

            if requested_qty > current_stock:
                products = list_products_payload(con)
                con.rollback()
                return jsonify({
                    "ok": False,
                    "error": f"Not enough stock for {row['name']}. Requested {requested_qty}, available {current_stock}.",
                    "product_id": product_id,
                    "requested_qty": requested_qty,
                    "available_stock": current_stock,
                    "products": products,
                }), 409

            product_rows[product_id] = row

        lines: list[dict[str, Any]] = []
        total_cents = 0

        for product_id, qty in requested.items():
            row = product_rows[product_id]
            line_total = int(row["price_cents"]) * qty
            total_cents += line_total

            lines.append({
                "id": f"ITEM-{uuid.uuid4().hex[:10].upper()}",
                "order_id": order_id,
                "product_id": row["id"],
                "sku": row["sku"],
                "name": row["name"],
                "unit_price_cents": int(row["price_cents"]),
                "quantity": qty,
                "line_total_cents": line_total,
            })

            con.execute(
                """
                UPDATE products
                SET stock = stock - ?
                WHERE id = ?
                """,
                (qty, product_id),
            )

        con.execute(
            """
            INSERT INTO orders (id, created_at, status, total_cents, upload_token)
            VALUES (?, ?, ?, ?, ?)
            """,
            (order_id, now_iso(), "paid", total_cents, upload_token),
        )

        con.executemany(
            """
            INSERT INTO order_items (
                id,
                order_id,
                product_id,
                sku,
                name,
                unit_price_cents,
                quantity,
                line_total_cents
            )
            VALUES (
                :id,
                :order_id,
                :product_id,
                :sku,
                :name,
                :unit_price_cents,
                :quantity,
                :line_total_cents
            )
            """,
            lines,
        )

        products = list_products_payload(con)
        con.commit()

        return jsonify({
            "ok": True,
            "order": {
                "id": order_id,
                "status": "paid",
                "total_cents": total_cents,
                "items": lines,
                "upload_token": upload_token,
            },
            "products": products,
        })
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


@orders_bp.get("/api/orders")
@require_admin
def list_orders():
    init_orders_db()

    con = connect()
    try:
        rows = con.execute(
            """
            SELECT id, created_at, status, total_cents
            FROM orders
            ORDER BY created_at DESC
            LIMIT 50
            """
        ).fetchall()

        return jsonify({
            "ok": True,
            "orders": [row_to_dict(row) for row in rows],
        })
    finally:
        con.close()
