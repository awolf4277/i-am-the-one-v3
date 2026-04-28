# Copyright © 2026 Andrew Wolverton. All Rights Reserved.
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS

from app.routes.auth import auth_bp
from app.routes.catalog import catalog_bp, init_db
from app.routes.orders import init_orders_db, orders_bp
from app.routes.uploads import init_uploads_db, uploads_bp


def create_app() -> Flask:
    base_dir = Path(__file__).resolve().parent
    backend_dir = base_dir.parent
    load_dotenv(backend_dir / ".env", override=True)

    app = Flask(__name__)

    app.config["JSON_SORT_KEYS"] = False
    app.config["APP_OWNER"] = "Andrew Wolverton"
    app.config["APP_BRAND"] = "I AM THE ONE™"
    app.config["APP_SYSTEM"] = "WOLF OS™"
    app.config["DB_PATH"] = os.getenv("DB_PATH", str(base_dir / "wolf_os_v3.sqlite3"))
    app.config["UPLOAD_ROOT"] = os.getenv("UPLOAD_ROOT", str(base_dir / "uploads"))
    app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
    app.config["ADMIN_SECRET"] = os.getenv("ADMIN_SECRET", "dev-admin-secret-change-me")
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", app.config["ADMIN_SECRET"])

    CORS(app)

    app.register_blueprint(auth_bp)
    app.register_blueprint(catalog_bp)
    app.register_blueprint(orders_bp)
    app.register_blueprint(uploads_bp)

    with app.app_context():
        init_db()
        init_orders_db()
        init_uploads_db()

    @app.get("/api/health")
    def health():
        return jsonify({
            "ok": True,
            "app": app.config["APP_BRAND"],
            "system": app.config["APP_SYSTEM"],
            "owner": app.config["APP_OWNER"],
        })

    return app

