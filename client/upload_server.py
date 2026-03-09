"""
HTTP file upload server for ChatApp with token-based authentication.
- POST /upload-token: Generate a token (requires XMPP JID + shared secret)
- POST /upload: Upload a file (requires valid token)
- GET /uploads/<file>: Serve uploaded files
Runs on port 9091.
"""
import os
import uuid
import json
import time
import hmac
import hashlib
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
MAX_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "video/mp4", "video/webm",
    "audio/mpeg", "audio/ogg", "audio/webm",
    "application/pdf",
}
# Safe file extensions whitelist
ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp",
    ".mp4", ".webm",
    ".mp3", ".ogg",
    ".pdf",
}
# Magic bytes for file type verification
MAGIC_BYTES = {
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/png": [b"\x89PNG\r\n\x1a\n"],
    "image/gif": [b"GIF87a", b"GIF89a"],
    "image/webp": [b"RIFF"],
    "video/mp4": [b"\x00\x00\x00", b"ftyp"],
    "video/webm": [b"\x1a\x45\xdf\xa3"],
    "audio/mpeg": [b"\xff\xfb", b"\xff\xf3", b"\xff\xf2", b"ID3"],
    "audio/ogg": [b"OggS"],
    "application/pdf": [b"%PDF"],
}

# Shared secret for token generation (in production use env var)
UPLOAD_SECRET = os.environ.get("UPLOAD_SECRET", "chatapp-upload-secret-key-change-in-production")

# Token store: token -> {jid, expires, used_count}
active_tokens = {}
TOKEN_TTL = 3600  # 1 hour
MAX_UPLOADS_PER_TOKEN = 50

os.makedirs(UPLOAD_DIR, exist_ok=True)


def cleanup_expired_tokens():
    """Remove expired tokens."""
    now = time.time()
    expired = [t for t, v in active_tokens.items() if v["expires"] < now]
    for t in expired:
        del active_tokens[t]


def generate_token(jid):
    """Generate an upload token for a JID."""
    cleanup_expired_tokens()
    token = uuid.uuid4().hex
    active_tokens[token] = {
        "jid": jid,
        "expires": time.time() + TOKEN_TTL,
        "used_count": 0,
    }
    return token


def validate_token(token):
    """Validate an upload token. Returns JID or None."""
    if not token:
        return None
    cleanup_expired_tokens()
    info = active_tokens.get(token)
    if not info:
        return None
    if info["used_count"] >= MAX_UPLOADS_PER_TOKEN:
        return None
    return info["jid"]


def verify_magic_bytes(file_data, claimed_type):
    """Verify file content matches claimed MIME type via magic bytes."""
    signatures = MAGIC_BYTES.get(claimed_type)
    if not signatures:
        return True  # No signature check available for this type
    for sig in signatures:
        if file_data[:len(sig)] == sig:
            return True
    return False


class UploadHandler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Credentials", "true")

    def _json_response(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        path = urlparse(self.path).path

        if path == "/upload-token":
            return self._handle_token_request()
        elif path == "/upload":
            return self._handle_upload()
        else:
            self.send_response(404)
            self.end_headers()

    def _handle_token_request(self):
        """Issue an upload token for an authenticated XMPP user."""
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 1024:
            return self._json_response(400, {"error": "Istek cok buyuk"})

        try:
            body = self.rfile.read(content_length)
            data = json.loads(body)
        except (json.JSONDecodeError, Exception):
            return self._json_response(400, {"error": "Gecersiz JSON"})

        jid = data.get("jid", "").strip()
        secret = data.get("secret", "").strip()

        if not jid or not secret:
            return self._json_response(400, {"error": "jid ve secret gerekli"})

        # Verify shared secret using constant-time comparison
        if not hmac.compare_digest(secret, UPLOAD_SECRET):
            return self._json_response(403, {"error": "Gecersiz secret"})

        token = generate_token(jid)
        return self._json_response(200, {"token": token, "expires_in": TOKEN_TTL})

    def _handle_upload(self):
        """Handle file upload with token authentication."""
        # Check auth token
        auth = self.headers.get("Authorization", "")
        token = None
        if auth.startswith("Bearer "):
            token = auth[7:].strip()

        jid = validate_token(token)
        if not jid:
            return self._json_response(401, {"error": "Gecersiz veya suresi dolmus token. Tekrar giris yapin."})

        content_type = self.headers.get("Content-Type", "")
        content_length = int(self.headers.get("Content-Length", 0))

        if content_length > MAX_SIZE:
            return self._json_response(413, {"error": "Dosya cok buyuk (max 10MB)"})

        if "multipart/form-data" not in content_type:
            return self._json_response(400, {"error": "multipart/form-data gerekli"})

        # Parse boundary
        boundary = content_type.split("boundary=")[-1].strip()
        body = self.rfile.read(content_length)

        # Simple multipart parser
        parts = body.split(("--" + boundary).encode())
        for part in parts:
            if b"filename=" not in part:
                continue

            # Extract filename
            header_end = part.find(b"\r\n\r\n")
            if header_end == -1:
                continue
            header_text = part[:header_end].decode("utf-8", errors="replace")
            file_data = part[header_end + 4:]
            if file_data.endswith(b"\r\n"):
                file_data = file_data[:-2]

            # Get original filename and extension
            fname_start = header_text.find('filename="') + 10
            fname_end = header_text.find('"', fname_start)
            original_name = header_text[fname_start:fname_end] if fname_start > 9 else "file"
            ext = os.path.splitext(original_name)[1].lower() or ".bin"

            # Validate extension whitelist
            if ext not in ALLOWED_EXTENSIONS:
                return self._json_response(415, {"error": f"Desteklenmeyen dosya uzantisi: {ext}"})

            # Get content type from part header
            file_ct = "application/octet-stream"
            for line in header_text.split("\r\n"):
                if line.lower().startswith("content-type:"):
                    file_ct = line.split(":", 1)[1].strip()

            if file_ct not in ALLOWED_TYPES:
                return self._json_response(415, {"error": f"Desteklenmeyen dosya tipi: {file_ct}"})

            # Verify magic bytes match claimed type
            if not verify_magic_bytes(file_data, file_ct):
                return self._json_response(415, {"error": "Dosya icerigi bildirilen tiple uyusmuyor"})

            # Save file
            unique_name = f"{uuid.uuid4().hex}{ext}"
            filepath = os.path.join(UPLOAD_DIR, unique_name)
            with open(filepath, "wb") as f:
                f.write(file_data)

            # Increment usage counter
            active_tokens[token]["used_count"] += 1

            # Build download URL
            url = f"/uploads/{unique_name}"

            return self._json_response(200, {
                "url": url,
                "filename": original_name,
                "size": len(file_data),
                "type": file_ct,
            })

        return self._json_response(400, {"error": "Dosya bulunamadi"})

    def do_GET(self):
        path = urlparse(self.path).path
        if not path.startswith("/uploads/"):
            self.send_response(404)
            self.end_headers()
            return

        filename = os.path.basename(path)
        filepath = os.path.join(UPLOAD_DIR, filename)
        if not os.path.isfile(filepath):
            self.send_response(404)
            self.end_headers()
            return

        ext = os.path.splitext(filename)[1].lower()
        ct_map = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
            ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4",
            ".webm": "video/webm", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
            ".pdf": "application/pdf",
        }
        ct = ct_map.get(ext, "application/octet-stream")

        with open(filepath, "rb") as f:
            data = f.read()

        self.send_response(200)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        print(f"[UPLOAD] {args[0]}")


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 9091), UploadHandler)
    print("Upload server running on http://0.0.0.0:9091")
    print(f"Upload secret: {UPLOAD_SECRET[:8]}...")
    server.serve_forever()
