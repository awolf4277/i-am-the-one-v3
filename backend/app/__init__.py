# Copyright © 2026 Andrew Wolverton. All Rights Reserved.
from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, jsonify
from flask_cors import CORS

from app.routes.catalog import catalog_bp, init_db
from app.routes.orders import init_orders_db, orders_bp


def create_app() -> Flask:
    app = Flask(__name__)

    base_dir = Path(__file__).resolve().parent

    app.config["JSON_SORT_KEYS"] = False
    app.config["APP_OWNER"] = "Andrew Wolverton"
    app.config["APP_BRAND"] = "I AM THE ONE™"
    app.config["APP_SYSTEM"] = "WOLF OS™"
    app.config["DB_PATH"] = os.getenv("DB_PATH", str(base_dir / "wolf_os_v3.sqlite3"))
    app.config["UPLOAD_ROOT"] = os.getenv("UPLOAD_ROOT", str(base_dir / "uploads"))

    CORS(app)

    app.register_blueprint(catalog_bp)
    app.register_blueprint(orders_bp)

    with app.app_context():
        init_db()
        init_orders_db()

    @app.get("/api/health")
    def health():
        return jsonify({
            "ok": True,
            "app": app.config["APP_BRAND"],
            "system": app.config["APP_SYSTEM"],
            "owner": app.config["APP_OWNER"],
        })

    return app
