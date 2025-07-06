#!/usr/bin/env python3
"""
Simple HTTP server with health endpoint using Flask
"""

from flask import Flask, jsonify
from datetime import datetime, timezone
import os

app = Flask(__name__)

@app.route('/health')
def health():
    return jsonify({
        'status': 'OK',
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'service': 'sample-python',
        'version': '1.0.0'
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False) 