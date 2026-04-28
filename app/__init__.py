from flask import Flask
from flask_cors import CORS


def create_app():
    flask_app = Flask(__name__)
    CORS(flask_app)

    from app.routes import bp
    flask_app.register_blueprint(bp)

    return flask_app
