# Copyright © 2026 Andrew Wolverton. All Rights Reserved.
from __future__ import annotations

import secrets
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, jsonify, request

from app.routes.auth import require_admin
from app.routes.catalog import connect, init_db as init_catalog_db, list_products_payload, row_to_dict

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
                upload_token TEXT NOT NULL DEFAULT '',
                customer_name TEXT NOT NULL DEFAULT '',
                customer_email TEXT NOT NULL DEFAULT '',
                customer_phone TEXT NOT NULL DEFAULT '',
                shipping_address TEXT NOT NULL DEFAULT '',
                shipping_city TEXT NOT NULL DEFAULT '',
                shipping_state TEXT NOT NULL DEFAULT '',
                shipping_zip TEXT NOT NULL DEFAULT '',
                order_notes TEXT NOT NULL DEFAULT ''
            )
            """
        )

        ensure_column(con, "orders", "upload_token", "upload_token TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "orders", "customer_name", "customer_name TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "orders", "customer_email", "customer_email TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "orders", "customer_phone", "customer_phone TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "orders", "shipping_address", "shipping_address TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "orders", "shipping_city", "shipping_city TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "orders", "shipping_state", "shipping_state TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "orders", "shipping_zip", "shipping_zip TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "orders", "order_notes", "order_notes TEXT NOT NULL DEFAULT ''")

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


def clean_text(value: Any, max_len: int = 500) -> str:
    return str(value or "").strip()[:max_len]


def normalize_customer(payload: dict[str, Any]) -> dict[str, str]:
    raw = payload.get("customer", {})

    if not isinstance(raw, dict):
        raw = {}

    return {
        "customer_name": clean_text(raw.get("name"), 120),
        "customer_email": clean_text(raw.get("email"), 180),
        "customer_phone": clean_text(raw.get("phone"), 60),
        "shipping_address": clean_text(raw.get("address"), 240),
        "shipping_city": clean_text(raw.get("city"), 120),
        "shipping_state": clean_text(raw.get("state"), 80),
        "shipping_zip": clean_text(raw.get("zip"), 40),
        "order_notes": clean_text(raw.get("notes"), 1000),
    }


def validate_customer(customer: dict[str, str]) -> str | None:
    if not customer["customer_name"]:
        return "Customer name is required"

    if not customer["customer_email"]:
        return "Customer email is required"

    if "@" not in customer["customer_email"] or "." not in customer["customer_email"]:
        return "Valid customer email is required"

    return None


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
    payload = request.get_json(silent=True) or {}
    requested, error = normalize_cart_items(payload.get("items", []))

    if error or requested is None:
        return jsonify({"ok": False, "error": error or "Invalid cart"}), 400

    customer = normalize_customer(payload)
    customer_error = validate_customer(customer)

    if customer_error:
        return jsonify({"ok": False, "error": customer_error}), 400

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
                return jsonify(
                    {
                        "ok": False,
                        "error": f"Product not found: {product_id}",
                        "products": products,
                    }
                ), 404

            current_stock = int(row["stock"])

            if requested_qty > current_stock:
                products = list_products_payload(con)
                con.rollback()
                return jsonify(
                    {
                        "ok": False,
                        "error": f"Not enough stock for {row['name']}. Requested {requested_qty}, available {current_stock}.",
                        "product_id": product_id,
                        "requested_qty": requested_qty,
                        "available_stock": current_stock,
                        "products": products,
                    }
                ), 409

            product_rows[product_id] = row

        lines: list[dict[str, Any]] = []
        total_cents = 0

        for product_id, qty in requested.items():
            row = product_rows[product_id]
            line_total = int(row["price_cents"]) * qty
            total_cents += line_total

            lines.append(
                {
                    "id": f"ITEM-{uuid.uuid4().hex[:10].upper()}",
                    "order_id": order_id,
                    "product_id": row["id"],
                    "sku": row["sku"],
                    "name": row["name"],
                    "unit_price_cents": int(row["price_cents"]),
                    "quantity": qty,
                    "line_total_cents": line_total,
                }
            )

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
            INSERT INTO orders (
                id,
                created_at,
                status,
                total_cents,
                upload_token,
                customer_name,
                customer_email,
                customer_phone,
                shipping_address,
                shipping_city,
                shipping_state,
                shipping_zip,
                order_notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                order_id,
                now_iso(),
                "paid",
                total_cents,
                upload_token,
                customer["customer_name"],
                customer["customer_email"],
                customer["customer_phone"],
                customer["shipping_address"],
                customer["shipping_city"],
                customer["shipping_state"],
                customer["shipping_zip"],
                customer["order_notes"],
            ),
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

        return jsonify(
            {
                "ok": True,
                "order": {
                    "id": order_id,
                    "status": "paid",
                    "total_cents": total_cents,
                    "items": lines,
                    "upload_token": upload_token,
                    "customer": {
                        "name": customer["customer_name"],
                        "email": customer["customer_email"],
                        "phone": customer["customer_phone"],
                        "address": customer["shipping_address"],
                        "city": customer["shipping_city"],
                        "state": customer["shipping_state"],
                        "zip": customer["shipping_zip"],
                        "notes": customer["order_notes"],
                    },
                },
                "products": products,
            }
        )
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


@orders_bp.get("/api/orders")
@require_admin
def list_orders():
    con = connect()
    try:
        rows = con.execute(
            """
            SELECT
                id,
                created_at,
                status,
                total_cents,
                customer_name,
                customer_email,
                customer_phone,
                shipping_city,
                shipping_state
            FROM orders
            ORDER BY created_at DESC
            LIMIT 50
            """
        ).fetchall()

        return jsonify(
            {
                "ok": True,
                "orders": [row_to_dict(row) for row in rows],
            }
        )
    finally:
        con.close()


@orders_bp.get("/api/orders/<order_id>")
@require_admin
def get_order_detail(order_id: str):
    con = connect()
    try:
        order_row = con.execute(
            """
            SELECT
                id,
                created_at,
                status,
                total_cents,
                upload_token,
                customer_name,
                customer_email,
                customer_phone,
                shipping_address,
                shipping_city,
                shipping_state,
                shipping_zip,
                order_notes
            FROM orders
            WHERE id = ?
            """,
            (order_id,),
        ).fetchone()

        if order_row is None:
            return jsonify({"ok": False, "error": "Order not found"}), 404

        item_rows = con.execute(
            """
            SELECT
                id,
                order_id,
                product_id,
                sku,
                name,
                unit_price_cents,
                quantity,
                line_total_cents
            FROM order_items
            WHERE order_id = ?
            ORDER BY name ASC
            """,
            (order_id,),
        ).fetchall()

        upload_rows = con.execute(
            """
            SELECT
                id,
                order_id,
                original_filename,
                stored_filename,
                content_type,
                size_bytes,
                created_at
            FROM order_uploads
            WHERE order_id = ?
            ORDER BY created_at DESC
            """,
            (order_id,),
        ).fetchall()

        return jsonify(
            {
                "ok": True,
                "order": row_to_dict(order_row),
                "items": [row_to_dict(row) for row in item_rows],
                "uploads": [row_to_dict(row) for row in upload_rows],
            }
        )
    finally:
        con.close()
