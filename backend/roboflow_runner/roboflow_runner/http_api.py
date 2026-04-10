"""Small HTTP API so the browser can POST flow JSON and trigger runs (CORS-enabled)."""

from __future__ import annotations

import json
import os
import re
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import TYPE_CHECKING, Type

if TYPE_CHECKING:
    from roboflow_runner.runner_node import RoboFlowRunnerNode

_VOICE_SYSTEM = """You parse spoken commands for a mobile robot in a warehouse sim. Reply with ONLY valid minified JSON (no markdown), exactly this shape: {"commands":["..."]}
Each string in "commands" must be ONE of these exact tokens (use multiple strings for multiple intents, in order):
- pickup:any — drive to nearest cargo then pick up (use when user does not name a box)
- pickup:CARGO-A1 — pick a specific id (only if user names it; ids look like CARGO-A1, CARGO-B2)
- drop:here — set cargo down on the floor near the robot (default drop)
- drop:dock — only if user explicitly wants the loading dock/station
- drop:CARGO-A1 — drop while carrying that id (optional id check)
- stop
- home
- draw_path
- follow_path
- clear_path
- forward
- back
- left
- right
If unsure, prefer pickup:any and drop:here. Empty commands array if unrelated chit-chat."""

_VOICE_CHAT_SYSTEM = """You are a friendly autonomous warehouse robot (AMR) in a simulation. The operator speaks to you.
Reply with ONLY valid minified JSON (no markdown), exactly: {"reply":"...","commands":[]}

Field "reply": what you say out loud via text-to-speech — 1–3 short, natural sentences, first person as the robot.
Keep it concise (under 220 characters when possible). No quotes inside reply that break JSON.

Field "commands": same machine tokens as a silent parser (array of strings, may be empty):
- pickup:any — drive to nearest cargo then pick up
- pickup:CARGO-A1 (etc.)
- drop:here, drop:dock, drop:CARGO-A1
- stop, home, draw_path, follow_path, clear_path, forward, back, left, right

If the user is only chatting, use commands: [] and a brief conversational reply.
If they ask for an action, acknowledge in reply and include the matching commands in order.
If unsure, prefer pickup:any and drop:here for cargo tasks."""


def _openai_voice_json(
    user_text: str, api_key: str, base_url: str, model: str, system: str, temperature: float
) -> dict:
    url = base_url.rstrip('/') + '/chat/completions'
    payload = json.dumps(
        {
            'model': model,
            'temperature': temperature,
            'messages': [
                {'role': 'system', 'content': system},
                {'role': 'user', 'content': f'Transcript: "{user_text}"'},
            ],
        }
    ).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}',
        },
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = json.loads(resp.read().decode('utf-8'))
    content = (raw.get('choices') or [{}])[0].get('message', {}).get('content') or ''
    content = content.strip()
    content = re.sub(r'^```(?:json)?\s*', '', content, flags=re.IGNORECASE)
    content = re.sub(r'\s*```$', '', content)
    return json.loads(content)


def _voice_parse_openai(user_text: str, api_key: str, base_url: str, model: str) -> list[str]:
    data = _openai_voice_json(user_text, api_key, base_url, model, _VOICE_SYSTEM, 0.1)
    cmds = data.get('commands')
    if not isinstance(cmds, list):
        raise ValueError('Invalid JSON: missing commands array')
    return [str(c).strip() for c in cmds if str(c).strip()]


def _voice_chat_openai(user_text: str, api_key: str, base_url: str, model: str) -> tuple[str, list[str]]:
    data = _openai_voice_json(user_text, api_key, base_url, model, _VOICE_CHAT_SYSTEM, 0.35)
    reply = str(data.get('reply') or '').strip()
    cmds = data.get('commands')
    if not isinstance(cmds, list):
        raise ValueError('Invalid JSON: missing commands array')
    return reply, [str(c).strip() for c in cmds if str(c).strip()]


def _send_json(handler: BaseHTTPRequestHandler, code: int, obj: dict) -> None:
    body = json.dumps(obj).encode('utf-8')
    handler.send_response(code)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type')
    handler.end_headers()
    handler.wfile.write(body)


def make_handler_class(node: RoboFlowRunnerNode) -> Type[BaseHTTPRequestHandler]:
    class RoboFlowHTTPHandler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args) -> None:
            node.get_logger().info('HTTP %s' % (fmt % args,))

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.end_headers()

        def do_GET(self) -> None:
            path = self.path.split('?', 1)[0].rstrip('/') or '/'
            if path == '/api/health':
                _send_json(self, 200, {'ok': True, 'service': 'roboflow_runner'})
            else:
                self.send_response(404)
                self.end_headers()

        def do_POST(self) -> None:
            path = self.path.split('?', 1)[0].rstrip('/') or '/'
            n = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(n) if n else b'{}'

            if path == '/api/flow':
                try:
                    data = json.loads(raw.decode('utf-8'))
                except json.JSONDecodeError as e:
                    _send_json(self, 400, {'ok': False, 'error': f'Invalid JSON: {e}'})
                    return
                if not isinstance(data, dict) or 'blocks' not in data:
                    _send_json(
                        self,
                        400,
                        {'ok': False, 'error': 'Body must be a flow object with a "blocks" array'},
                    )
                    return
                node.set_flow_payload(data)
                _send_json(self, 200, {'ok': True, 'message': 'Flow stored; call POST /api/run'})
                return

            if path == '/api/run':
                ok, msg = node.request_run_from_api()
                _send_json(self, 200 if ok else 409, {'ok': ok, 'message': msg})
                return

            if path == '/api/stop':
                node.request_stop_from_api()
                _send_json(self, 200, {'ok': True, 'message': 'Stop requested'})
                return

            if path == '/api/voice/parse':
                api_key = os.environ.get('OPENAI_API_KEY', '').strip()
                if not api_key:
                    _send_json(
                        self,
                        503,
                        {
                            'ok': False,
                            'error': 'Set OPENAI_API_KEY in the environment for the roboflow_runner process',
                        },
                    )
                    return
                try:
                    data = json.loads(raw.decode('utf-8'))
                except json.JSONDecodeError as e:
                    _send_json(self, 400, {'ok': False, 'error': f'Invalid JSON: {e}'})
                    return
                text = (data.get('text') or '').strip()
                if not text:
                    _send_json(self, 400, {'ok': False, 'error': 'Missing "text"'})
                    return
                base = (os.environ.get('OPENAI_BASE_URL') or 'https://api.openai.com/v1').strip()
                model = (os.environ.get('OPENAI_MODEL') or 'gpt-4o-mini').strip()
                try:
                    commands = _voice_parse_openai(text, api_key, base, model)
                except urllib.error.HTTPError as e:
                    body = e.read().decode('utf-8', errors='replace')[:300]
                    _send_json(self, 502, {'ok': False, 'error': f'OpenAI HTTP {e.code}: {body}'})
                    return
                except Exception as e:
                    _send_json(self, 502, {'ok': False, 'error': str(e)})
                    return
                _send_json(self, 200, {'ok': True, 'commands': commands})
                return

            if path == '/api/voice/chat':
                api_key = os.environ.get('OPENAI_API_KEY', '').strip()
                if not api_key:
                    _send_json(
                        self,
                        503,
                        {
                            'ok': False,
                            'error': 'Set OPENAI_API_KEY in the environment for the roboflow_runner process',
                        },
                    )
                    return
                try:
                    data = json.loads(raw.decode('utf-8'))
                except json.JSONDecodeError as e:
                    _send_json(self, 400, {'ok': False, 'error': f'Invalid JSON: {e}'})
                    return
                text = (data.get('text') or '').strip()
                if not text:
                    _send_json(self, 400, {'ok': False, 'error': 'Missing "text"'})
                    return
                base = (os.environ.get('OPENAI_BASE_URL') or 'https://api.openai.com/v1').strip()
                model = (os.environ.get('OPENAI_MODEL') or 'gpt-4o-mini').strip()
                try:
                    reply, commands = _voice_chat_openai(text, api_key, base, model)
                except urllib.error.HTTPError as e:
                    body = e.read().decode('utf-8', errors='replace')[:300]
                    _send_json(self, 502, {'ok': False, 'error': f'OpenAI HTTP {e.code}: {body}'})
                    return
                except Exception as e:
                    _send_json(self, 502, {'ok': False, 'error': str(e)})
                    return
                _send_json(self, 200, {'ok': True, 'reply': reply, 'commands': commands})
                return

            self.send_response(404)
            self.end_headers()

    return RoboFlowHTTPHandler


def start_http_api(node: RoboFlowRunnerNode, host: str, port: int) -> ThreadingHTTPServer:
    handler = make_handler_class(node)
    server = ThreadingHTTPServer((host, port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    node.get_logger().info(f'RoboFlow HTTP API listening on http://{host}:{port}')
    node.get_logger().info('  POST /api/flow  — body: flow JSON from UI Save')
    node.get_logger().info('  POST /api/run   — start execution')
    node.get_logger().info('  POST /api/stop  — stop + zero cmd_vel')
    node.get_logger().info('  POST /api/voice/parse — body: {"text":"..."} (commands only)')
    node.get_logger().info('  POST /api/voice/chat   — body: {"text":"..."} (reply + commands, conversational)')
    node.get_logger().info('  GET  /api/health')
    return server
