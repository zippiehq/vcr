#!/usr/bin/env python3
"""
Simple HTTP server with health endpoint using aiohttp
"""

import aiohttp
from aiohttp import web
from datetime import datetime, timezone
import os

async def health(request):
    return web.json_response({
        'status': 'OK',
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'service': 'sample-python',
        'version': '1.0.0'
    })

app = web.Application()
app.router.add_get('/health', health)

def run_app():
    """Function to run the app, used by watchgod/watchfiles"""
    port = int(os.environ.get('PORT', 8080))
    web.run_app(app, host='0.0.0.0', port=port)

if __name__ == '__main__':
    run_app() 