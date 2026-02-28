"""
Simple HTTP file upload server for ChatApp.
Handles multipart file uploads and serves uploaded files.
Runs on port 9091.
"""
import os
import uuid
import json
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

os.makedirs(UPLOAD_DIR, exist_ok=True)


class UploadHandler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != "/upload":
            self.send_response(404)
            self.end_headers()
            return

        content_type = self.headers.get("Content-Type", "")
        content_length = int(self.headers.get("Content-Length", 0))

        if content_length > MAX_SIZE:
            self.send_response(413)
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Dosya cok buyuk (max 10MB)"}).encode())
            return

        if "multipart/form-data" not in content_type:
            self.send_response(400)
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({"error": "multipart/form-data gerekli"}).encode())
            return

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

            # Get content type from part header
            file_ct = "application/octet-stream"
            for line in header_text.split("\r\n"):
                if line.lower().startswith("content-type:"):
                    file_ct = line.split(":", 1)[1].strip()

            if file_ct not in ALLOWED_TYPES:
                self.send_response(415)
                self._cors()
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Desteklenmeyen dosya tipi: {file_ct}"}).encode())
                return

            # Save file
            unique_name = f"{uuid.uuid4().hex}{ext}"
            filepath = os.path.join(UPLOAD_DIR, unique_name)
            with open(filepath, "wb") as f:
                f.write(file_data)

            # Build download URL
            url = f"/uploads/{unique_name}"

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({
                "url": url,
                "filename": original_name,
                "size": len(file_data),
                "type": file_ct,
            }).encode())
            return

        self.send_response(400)
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps({"error": "Dosya bulunamadi"}).encode())

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
    server.serve_forever()
