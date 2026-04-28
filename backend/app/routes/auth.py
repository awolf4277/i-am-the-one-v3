# Copyright © 2026 Andrew Wolverton. All Rights Reserved.
from __future__ import annotations

import os
from functools import wraps
from typing import Any, Callable

from flask import Blueprint, current_app, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

auth_bp = Blueprint("auth", __name__)

TOKEN_MAX_AGE_SECONDS = 60 * 60 * 12


def _serializer() -> URLSafeTimedSerializer:
    secret = current_app.config.get("ADMIN_SECRET") or current_app.config.get("SECRET_KEY")
    return URLSafeTimedSerializer(str(secret), salt="i-am-the-one-admin")


def create_admin_token() -> str:
    return _serializer().dumps({"role": "owner"})


def verify_admin_token(token: str) -> bool:
    try:
        data = _serializer().loads(token, max_age=TOKEN_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return False

    return data.get("role") == "owner"


def get_bearer_token() -> str:
    auth_header = request.headers.get("Authorization", "").strip()

    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()

    return request.headers.get("X-Admin-Token", "").strip()


def require_admin(fn: Callable[..., Any]):
    @wraps(fn)
    def wrapper(*args: Any, **kwargs: Any):
        token = get_bearer_token()

        if not token or not verify_admin_token(token):
            return jsonify({"ok": False, "error": "Owner login required"}), 401

        return fn(*args, **kwargs)

    return wrapper


@auth_bp.post("/api/admin/login")
def admin_login():
    payload = request.get_json(silent=True) or {}
    password = str(payload.get("password", ""))

    expected = os.getenv("ADMIN_PASSWORD", "").strip()

    if not expected:
        return jsonify({
            "ok": False,
            "error": "ADMIN_PASSWORD is not configured",
        }), 500

    if password != expected:
        return jsonify({"ok": False, "error": "Invalid owner password"}), 401

    return jsonify({
        "ok": True,
        "token": create_admin_token(),
        "expires_in_seconds": TOKEN_MAX_AGE_SECONDS,
    })


@auth_bp.get("/api/admin/me")
@require_admin
def admin_me():
    return jsonify({"ok": True, "role": "owner"})
