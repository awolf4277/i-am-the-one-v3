# Copyright © 2026 Andrew Wolverton. All Rights Reserved.
from __future__ import annotations

import os
import secrets
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request
from werkzeug.utils import secure_filename

from app.routes.auth import get_bearer_token, verify_admin_token
from app.routes.catalog import connect, row_to_dict
from app.routes.orders import init_orders_db

uploads_bp = Blueprint("uploads", __name__)

ALLOWED_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".pdf",
    ".txt",
    ".doc",
    ".docx",
    ".zip",
}

MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_uploads_db() -> None:
    init_orders_db()

    con = connect()
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS order_uploads (
                id TEXT PRIMARY KEY,
                order_id TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                stored_filename TEXT NOT NULL,
                content_type TEXT NOT NULL DEFAULT '',
                size_bytes INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(order_id) REFERENCES orders(id)
            )
            """
        )
        con.commit()
    finally:
        con.close()


def get_order(con: sqlite3.Connection, order_id: str) -> sqlite3.Row | None:
    return con.execute(
        """
        SELECT id, upload_token
        FROM orders
        WHERE id = ?
        """,
        (order_id,),
    ).fetchone()


def request_upload_token() -> str:
    token = request.args.get("token", "").strip()

    if token:
        return token

    return request.headers.get("X-Upload-Token", "").strip()


def has_upload_access(order_row: sqlite3.Row) -> bool:
    admin_token = get_bearer_token()

    if admin_token and verify_admin_token(admin_token):
        return True

    provided = request_upload_token()
    expected = str(order_row["upload_token"] or "")

    if not provided or not expected:
        return False

    return secrets.compare_digest(provided, expected)


def upload_dir_for_order(order_id: str) -> Path:
    root = Path(current_app.config["UPLOAD_ROOT"])
    folder = root / "orders" / secure_filename(order_id)
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def file_extension(filename: str) -> str:
    return Path(filename or "").suffix.lower().strip()


@uploads_bp.post("/api/orders/<order_id>/uploads")
def upload_for_order(order_id: str):
    init_uploads_db()

    con = connect()
    try:
        order_row = get_order(con, order_id)

        if order_row is None:
            return jsonify({"ok": False, "error": "Order not found"}), 404

        if not has_upload_access(order_row):
            return jsonify({"ok": False, "error": "Valid upload token required"}), 401

        if "file" not in request.files:
            return jsonify({"ok": False, "error": "Missing file field"}), 400

        file = request.files["file"]

        if not file or not file.filename:
            return jsonify({"ok": False, "error": "No file selected"}), 400

        original_filename = secure_filename(file.filename)
        ext = file_extension(original_filename)

        if ext not in ALLOWED_EXTENSIONS:
            return jsonify({
                "ok": False,
                "error": f"File type not allowed: {ext or 'unknown'}",
            }), 400

        file.seek(0, os.SEEK_END)
        size_bytes = file.tell()
        file.seek(0)

        if size_bytes > MAX_UPLOAD_BYTES:
            return jsonify({
                "ok": False,
                "error": "File is too large. Max upload is 25MB.",
            }), 413

        upload_id = f"UP-{uuid.uuid4().hex[:12].upper()}"
        stored_filename = f"{upload_id}{ext}"
        target = upload_dir_for_order(order_id) / stored_filename

        file.save(target)

        con.execute(
            """
            INSERT INTO order_uploads (
                id,
                order_id,
                original_filename,
                stored_filename,
                content_type,
                size_bytes,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                upload_id,
                order_id,
                original_filename,
                stored_filename,
                file.content_type or "",
                size_bytes,
                now_iso(),
            ),
        )
        con.commit()

        return jsonify({
            "ok": True,
            "upload": {
                "id": upload_id,
                "order_id": order_id,
                "original_filename": original_filename,
                "stored_filename": stored_filename,
                "content_type": file.content_type or "",
                "size_bytes": size_bytes,
            },
        })
    finally:
        con.close()


@uploads_bp.get("/api/orders/<order_id>/uploads")
def list_order_uploads(order_id: str):
    init_uploads_db()

    con = connect()
    try:
        order_row = get_order(con, order_id)

        if order_row is None:
            return jsonify({"ok": False, "error": "Order not found"}), 404

        if not has_upload_access(order_row):
            return jsonify({"ok": False, "error": "Valid upload token required"}), 401

        rows = con.execute(
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

        return jsonify({
            "ok": True,
            "uploads": [row_to_dict(row) for row in rows],
        })
    finally:
        con.close()
