from flask import Blueprint, jsonify

bp = Blueprint("main", __name__)


@bp.route("/api/health")
def health():
    return jsonify({"status": "ok"})
