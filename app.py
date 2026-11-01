from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
import json
import mimetypes
import os
import base64
import hashlib
import hmac
import re
import secrets
import sys
import threading
import time
import uuid
from character_store import CharacterError, CharacterStore

ROOT = Path(__file__).resolve().parent
DATA_ROOT = Path(os.environ.get("MESA_DATA_DIR", str(ROOT / ".mesa-data"))).resolve()
SHEET_DATA = DATA_ROOT / "sheets"
MUSIC_DATA = DATA_ROOT / "music"
TEMP_IMAGE_DATA = DATA_ROOT / "temporary-images"
BOOK_DATA = DATA_ROOT / "books"
character_store = CharacterStore(DATA_ROOT)
MAX_SHEET_BYTES = 20 * 1024 * 1024
MUSIC_TYPES = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
               ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".webm": "audio/webm"}
MAX_MUSIC_BYTES = 50 * 1024 * 1024
MAX_MUSIC_TRACKS = 40
MAX_MUSIC_TOTAL_BYTES = 500 * 1024 * 1024
MAX_TEMP_IMAGE_BYTES = 20 * 1024 * 1024
MAX_BOOK_SLOTS = 99
MAX_BOOK_BYTES = 100 * 1024 * 1024
SHEET_TYPES = {
    ".pdf": ("application/pdf", b"%PDF-"),
    ".jpg": ("image/jpeg", b"\xff\xd8\xff"),
    ".jpeg": ("image/jpeg", b"\xff\xd8\xff"),
    ".png": ("image/png", b"\x89PNG\r\n\x1a\n"),
    ".webp": ("image/webp", b"RIFF"),
}
rooms, room_creators, creator_tokens, kicked_players = {}, {}, {}, {}
lock = threading.Lock()
PLAYER_ID_RE = re.compile(r"[a-fA-F0-9-]{8,64}")
ROOM_EVENT_TYPES = {
    "join", "leave", "kick", "roll", "clear", "offer", "answer", "ice",
    "media-ready", "media-stopped", "camera-state", "chat", "book-added",
    "book-removed", "temporary-image", "music-playlist", "music-control",
}


def valid_room(value):
    return bool(re.fullmatch(r"[A-Za-z0-9_-]{1,48}", value or ""))


def clean_sheet_name(value):
    value = re.sub(r"[\x00-\x1f\x7f]", "", value or "")
    return value.strip()[:60] or "Aventureiro"


def sheet_index_path(room):
    return SHEET_DATA / room / "index.json"


def read_sheet_index(room):
    try:
        records = json.loads(sheet_index_path(room).read_text(encoding="utf-8"))
        return records if isinstance(records, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def book_index_path(room):
    return BOOK_DATA / room / "index.json"


def read_book_index(room):
    try:
        records = json.loads(book_index_path(room).read_text(encoding="utf-8"))
        return records if isinstance(records, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def read_book_capacity(room):
    highest = max((int(item.get("slot", 0)) + 1 for item in read_book_index(room)), default=3)
    try:
        saved = int(json.loads((BOOK_DATA / room / "slots.json").read_text(encoding="utf-8")))
    except (OSError, ValueError, TypeError):
        saved = 3
    return min(MAX_BOOK_SLOTS, max(3, highest, saved))


def public_book(record):
    return {key: record[key] for key in ("id", "filename", "bytes", "uploadedAt", "slot") if key in record}


def music_index_path(room):
    return MUSIC_DATA / room / "index.json"


def read_music_index(room):
    try:
        record = json.loads(music_index_path(room).read_text(encoding="utf-8"))
        if isinstance(record, dict) and isinstance(record.get("tracks"), list):
            return record
        if isinstance(record, dict) and record.get("id"):
            return {"tracks": [record], "current": 0}
        return {"tracks": [], "current": 0}
    except (OSError, json.JSONDecodeError):
        return {"tracks": [], "current": 0}


def public_music(record):
    return {key: record[key] for key in ("id", "filename", "bytes", "uploadedAt", "owner") if key in record}


def public_sheet(record):
    return {key: record[key] for key in (
        "id", "bundleId", "playerId", "playerName", "page", "filename",
        "contentType", "bytes", "uploadedAt",
    ) if key in record}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *_):
        pass

    def send_json(self, value, status=200):
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def translate_path(self, path):
        translated = Path(super().translate_path(path)).resolve()
        try:
            relative = translated.relative_to(ROOT)
        except ValueError:
            return str(ROOT / ".static-denied")
        if any(part.startswith(".") for part in relative.parts):
            return str(ROOT / ".static-denied")
        if translated.is_file() and translated.suffix.lower() not in {
            ".html", ".css", ".js", ".jpg", ".jpeg", ".png", ".webp", ".svg", ".ico"
        }:
            return str(ROOT / ".static-denied")
        return str(translated)

    def list_directory(self, path):
        self.send_error(404)
        return None

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        if parsed.path in ("/api/characters", "/api/npcs"):
            room = query.get("room", [""])[0]
            if not valid_room(room):
                return self.send_json({"error": "sala inválida"}, 400)
            try:
                sheets = character_store.list_npcs(room) if parsed.path == "/api/npcs" else character_store.list(room)
                return self.send_json({"sheets": [sheet for sheet in sheets if not sheet.get("deleted")],
                                       "deleted": [sheet["slot"] for sheet in sheets if sheet.get("deleted")],
                                       "storage": "cloud" if character_store.cloud else "server"})
            except CharacterError as error:
                return self.send_json({"error": str(error)}, error.status)

        if parsed.path == "/healthz":
            return self.send_json({"status": "ok"})

        if parsed.path == "/api/ice-servers":
            room = query.get("room", [""])[0]
            if not valid_room(room):
                return self.send_json({"error": "sala inválida"}, 400)
            ice_servers = [
                {"urls": "stun:stun.l.google.com:19302"},
                {"urls": "stun:stun.cloudflare.com:3478"},
            ]
            turn_urls = [value.strip() for value in os.environ.get("MESA_TURN_URLS", "").split(",") if value.strip()]
            shared_secret = os.environ.get("MESA_TURN_SHARED_SECRET", "")
            static_username = os.environ.get("MESA_TURN_USERNAME", "")
            static_credential = os.environ.get("MESA_TURN_CREDENTIAL", "")
            if turn_urls and shared_secret:
                expires_at = int(time.time()) + 3600
                username = f"{expires_at}:{room}"
                credential = base64.b64encode(
                    hmac.new(shared_secret.encode("utf-8"), username.encode("utf-8"), hashlib.sha1).digest()
                ).decode("ascii")
                ice_servers.append({"urls": turn_urls, "username": username, "credential": credential})
            elif turn_urls and static_username and static_credential:
                ice_servers.append({"urls": turn_urls, "username": static_username, "credential": static_credential})
            return self.send_json({"iceServers": ice_servers, "relayConfigured": len(ice_servers) > 2})

        if parsed.path == "/api/events":
            room = query.get("room", [""])[0]
            player_id = query.get("player", [""])[0]
            if not valid_room(room) or not PLAYER_ID_RE.fullmatch(player_id):
                return self.send_json({"error": "sala ou jogador inválido"}, 400)
            try:
                since = int(query.get("since", ["0"])[0])
            except ValueError:
                return self.send_json({"error": "cursor inválido"}, 400)
            deadline = time.time() + 20
            while time.time() < deadline:
                with lock:
                    events = []
                    for item in rooms.get(room, []):
                        if item["id"] <= since:
                            continue
                        payload = item.get("event", {})
                        recipient = payload.get("to")
                        if recipient and player_id not in (recipient, payload.get("from")):
                            continue
                        events.append(item)
                if events:
                    return self.send_json({"events": events})
                time.sleep(.35)
            return self.send_json({"events": []})

        if parsed.path == "/api/books":
            room = query.get("room", [""])[0]
            if not valid_room(room):
                return self.send_json({"error": "sala inválida"}, 400)
            books = sorted(read_book_index(room), key=lambda item: item.get("slot", 0))
            return self.send_json({"books": [public_book(item) for item in books], "capacity": read_book_capacity(room)})

        if parsed.path == "/api/books/file":
            room = query.get("room", [""])[0]
            file_id = query.get("id", [""])[0]
            if not valid_room(room) or not re.fullmatch(r"[a-f0-9]{32}", file_id):
                return self.send_json({"error": "livro não encontrado"}, 404)
            record = next((item for item in read_book_index(room) if item.get("id") == file_id), None)
            if not record:
                return self.send_json({"error": "livro não encontrado"}, 404)
            file_path = (BOOK_DATA / room / record.get("stored", "")).resolve()
            try:
                file_path.relative_to((BOOK_DATA / room).resolve())
                data = file_path.read_bytes()
            except (ValueError, OSError):
                return self.send_json({"error": "livro não encontrado"}, 404)
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", "inline")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)
            return

        if parsed.path == "/api/music":
            room = query.get("room", [""])[0]
            if not valid_room(room):
                return self.send_json({"error": "sala inválida"}, 400)
            playlist = read_music_index(room)
            return self.send_json({"tracks": [public_music(track) for track in playlist["tracks"]],
                                   "current": playlist.get("current", 0)})

        if parsed.path == "/api/music/file":
            room = query.get("room", [""])[0]
            file_id = query.get("id", [""])[0]
            playlist = read_music_index(room) if valid_room(room) else {"tracks": []}
            record = next((track for track in playlist["tracks"] if track.get("id") == file_id), None)
            if not record or not re.fullmatch(r"[a-f0-9]{32}", file_id):
                return self.send_json({"error": "trilha não encontrada"}, 404)
            file_path = (MUSIC_DATA / room / record.get("stored", "")).resolve()
            try:
                file_path.relative_to((MUSIC_DATA / room).resolve())
                data = file_path.read_bytes()
            except (ValueError, OSError):
                return self.send_json({"error": "trilha não encontrada"}, 404)
            self.send_response(200)
            self.send_header("Content-Type", MUSIC_TYPES.get(Path(record.get("stored", "")).suffix.lower(), "audio/mpeg"))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", "inline")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)
            return

        if parsed.path == "/api/temporary-image/file":
            room = query.get("room", [""])[0]
            file_id = query.get("id", [""])[0]
            match = re.fullmatch(r"([a-f0-9]{32})\.(jpg|jpeg|png|webp)", file_id)
            if not valid_room(room) or not match:
                return self.send_json({"error": "imagem temporária não encontrada"}, 404)
            file_path = (TEMP_IMAGE_DATA / room / file_id).resolve()
            try:
                file_path.relative_to((TEMP_IMAGE_DATA / room).resolve())
                data = file_path.read_bytes()
            except (ValueError, OSError):
                return self.send_json({"error": "imagem temporária não encontrada"}, 404)
            content_type = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[match.group(2)]
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", "inline")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)
            return

        if parsed.path == "/api/sheets":
            room = query.get("room", [""])[0]
            if not valid_room(room):
                return self.send_json({"error": "sala inválida"}, 400)
            records = sorted(read_sheet_index(room), key=lambda item: item.get("uploadedAt", ""))
            return self.send_json({"sheets": [public_sheet(item) for item in records]})

        if parsed.path == "/api/sheets/file":
            room = query.get("room", [""])[0]
            file_id = query.get("id", [""])[0]
            if not valid_room(room) or not re.fullmatch(r"[a-f0-9]{32}", file_id):
                return self.send_json({"error": "arquivo não encontrado"}, 404)
            record = next((item for item in read_sheet_index(room) if item.get("id") == file_id), None)
            if not record:
                return self.send_json({"error": "arquivo não encontrado"}, 404)
            file_path = (SHEET_DATA / room / record.get("stored", "")).resolve()
            try:
                file_path.relative_to((SHEET_DATA / room).resolve())
                data = file_path.read_bytes()
            except (ValueError, OSError):
                return self.send_json({"error": "arquivo não encontrado"}, 404)
            filename = quote(record.get("filename", "ficha"), safe="")
            self.send_response(200)
            self.send_header("Content-Type", record.get("contentType", "application/octet-stream"))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", f"inline; filename*=UTF-8''{filename}")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)
            return

        if parsed.path.startswith("/api/"):
            return self.send_json({"error": "endpoint não encontrado; reinicie o servidor para carregar a versão atual."}, 404)
        return super().do_GET()

    def do_DELETE(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/api/npcs":
            return self.delete_npc()
        if parsed.path == "/api/books":
            return self.delete_book(query)
        if parsed.path == "/api/music":
            return self.delete_music(query)
        if parsed.path != "/api/sheets":
            return self.send_json({"error": "endpoint não encontrado."}, 404)
        room = query.get("room", [""])[0]
        file_id = query.get("id", [""])[0]
        player_id = query.get("player", [""])[0]
        if not valid_room(room) or not re.fullmatch(r"[a-f0-9]{32}", file_id):
            return self.send_json({"error": "Imagem não encontrada."}, 404)
        with lock:
            records = read_sheet_index(room)
            record = next((item for item in records if item.get("id") == file_id), None)
            if not record:
                return self.send_json({"error": "Imagem não encontrada."}, 404)
            if not secrets.compare_digest(str(record.get("playerId", "")), player_id):
                return self.send_json({"error": "Você só pode excluir suas próprias imagens."}, 403)
            path = (SHEET_DATA / room / record.get("stored", "")).resolve()
            try:
                path.relative_to((SHEET_DATA / room).resolve())
                path.unlink(missing_ok=True)
            except (ValueError, OSError):
                return self.send_json({"error": "Não foi possível excluir a imagem."}, 500)
            records = [item for item in records if item.get("id") != file_id]
            index_path = sheet_index_path(room)
            temp_path = index_path.with_name("index.tmp")
            temp_path.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
            temp_path.replace(index_path)
        return self.send_json({"ok": True})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/api/characters", "/api/npcs"):
            return self.save_character(npc=parsed.path == "/api/npcs")
        if parsed.path == "/api/books/add-slot":
            return self.add_book_slot(parse_qs(parsed.query))
        if parsed.path == "/api/books":
            return self.upload_book(parse_qs(parsed.query))
        if parsed.path == "/api/sheets":
            return self.upload_sheet(parse_qs(parsed.query))
        if parsed.path == "/api/music":
            return self.upload_music(parse_qs(parsed.query))
        if parsed.path == "/api/temporary-image":
            return self.upload_temporary_image(parse_qs(parsed.query))
        if parsed.path != "/api/event":
            if parsed.path.startswith("/api/"):
                return self.send_json({"error": "endpoint não encontrado; reinicie o servidor para carregar a versão atual."}, 404)
            return self.send_error(404)

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 1_000_000:
                return self.send_json({"error": "evento muito grande"}, 413)
            obj = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            return self.send_json({"error": "invalid json"}, 400)

        if not isinstance(obj, dict):
            return self.send_json({"error": "invalid json"}, 400)
        room = obj.get("room", "")
        event = obj.get("event", {})
        if not valid_room(room) or not isinstance(event, dict):
            return self.send_json({"error": "sala ou evento inválido"}, 400)
        event = dict(event)
        player = event.get("from")
        kind = event.get("type")
        if not PLAYER_ID_RE.fullmatch(str(player or "")) or kind not in ROOM_EVENT_TYPES:
            return self.send_json({"error": "jogador ou tipo de evento inválido"}, 400)
        recipient = event.get("to")
        if recipient is not None and not PLAYER_ID_RE.fullmatch(str(recipient)):
            return self.send_json({"error": "destinatário inválido"}, 400)
        if kind == "chat":
            message = event.get("text")
            if not isinstance(message, str) or not message.strip() or len(message) > 500:
                return self.send_json({"error": "mensagem inválida"}, 400)
            event["text"] = message.strip()
            event["name"] = clean_sheet_name(event.get("name", ""))
        elif kind == "roll":
            roll = event.get("roll")
            if not isinstance(roll, dict):
                return self.send_json({"error": "rolagem inválida"}, 400)
            sides, quantity, modifier = roll.get("sides"), roll.get("qty"), roll.get("mod")
            values, total = roll.get("values"), roll.get("total")
            if (type(sides) is not int or sides not in {4, 6, 8, 10, 12, 20, 100}
                    or type(quantity) is not int or not 1 <= quantity <= 10
                    or type(modifier) is not int or not -99 <= modifier <= 99
                    or not isinstance(values, list) or len(values) != quantity
                    or any(type(value) is not int or not 1 <= value <= sides for value in values)
                    or type(total) is not int or total != sum(values) + modifier):
                return self.send_json({"error": "dados da rolagem inválidos"}, 400)
            roll["name"] = clean_sheet_name(roll.get("name", ""))
        elif kind in {"offer", "answer"}:
            description = event.get(kind)
            if (not isinstance(description, dict) or description.get("type") != kind
                    or not isinstance(description.get("sdp"), str) or len(description["sdp"]) > 250_000):
                return self.send_json({"error": "descrição de chamada inválida"}, 400)
        elif kind == "ice":
            candidate = event.get("candidate")
            candidate_text = candidate.get("candidate", "") if isinstance(candidate, dict) else candidate
            if not isinstance(candidate_text, str) or len(candidate_text) > 8192:
                return self.send_json({"error": "candidato de rede inválido"}, 400)
        response = {"ok": True}
        with lock:
            if kind == "join":
                if not player:
                    return self.send_json({"error": "jogador inválido"}, 400)
                banned = kicked_players.setdefault(room, set())
                if player in banned:
                    return self.send_json({"error": "Você foi removido desta sala."}, 403)
                creator = room_creators.get(room)
                if creator is None:
                    creator = player
                    room_creators[room] = creator
                    creator_tokens[room] = secrets.token_urlsafe(32)
                event["creator"] = creator
                response["creatorId"] = creator
                if player == creator:
                    response["creatorToken"] = creator_tokens[room]
            elif kind == "kick":
                target = event.get("target")
                if player != room_creators.get(room) or not secrets.compare_digest(
                    str(event.get("creatorToken", "")), creator_tokens.get(room, "")
                ):
                    return self.send_json({"error": "Somente o criador pode remover jogadores."}, 403)
                if not target or target == player:
                    return self.send_json({"error": "Não é possível remover esse jogador."}, 400)
                kicked_players.setdefault(room, set()).add(target)
                event.pop("creatorToken", None)
            events = rooms.setdefault(room, [])
            item = {"id": events[-1]["id"] + 1 if events else 1, "event": event}
            events.append(item)
            if len(events) > 300:
                del events[:-300]
        response["id"] = item["id"]
        return self.send_json(response)

    def delete_npc(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                return self.send_json({"error": "Pedido de exclusão inválido."}, 400)
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError()
            room, npc_id = payload.get("room"), payload.get("slot")
            token, version = payload.get("editToken"), payload.get("version")
            if (not isinstance(room, str) or not valid_room(room)
                    or not isinstance(npc_id, str) or not re.fullmatch(r"[a-f0-9]{32}", npc_id)
                    or not isinstance(token, str) or not re.fullmatch(r"[a-f0-9]{64}", token)
                    or type(version) is not int or version < 1):
                raise ValueError()
            character_store.delete_npc(room, npc_id, token, version)
            return self.send_json({"ok": True, "deleted": npc_id})
        except (ValueError, TypeError):
            return self.send_json({"error": "Pedido de exclusão inválido."}, 400)
        except CharacterError as error:
            return self.send_json({"error": str(error)}, error.status)

    def save_character(self, npc=False):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 512 * 1024:
                return self.send_json({"error": "Ficha muito grande ou vazia."}, 413)
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError()
            room, slot = payload.get("room"), payload.get("slot")
            fields, token = payload.get("fields"), payload.get("editToken")
            version, owner_id = payload.get("version"), payload.get("playerId")
            if (not isinstance(room, str) or not valid_room(room)
                    or (not isinstance(slot, str) or not re.fullmatch(r"[a-f0-9]{32}", slot) if npc
                        else type(slot) is not int or not 1 <= slot <= 5)
                    or not isinstance(token, str) or not re.fullmatch(r"[a-f0-9]{64}", token)
                    or type(version) is not int or version < 0
                    or not isinstance(owner_id, str) or not PLAYER_ID_RE.fullmatch(owner_id)
                    or not isinstance(fields, dict) or len(fields) > 4000
                    or any(not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", key)
                           or not isinstance(value, str) or len(value) > (300000 if key == "portrait.image" else 12000) for key, value in fields.items())):
                raise ValueError()
            portrait = fields.get("portrait.image", "")
            if portrait:
                if not re.fullmatch(r"data:image/jpeg;base64,[A-Za-z0-9+/=]+", portrait):
                    raise ValueError()
                image_data = base64.b64decode(portrait.split(",", 1)[1], validate=True)
                if len(image_data) > 200 * 1024 or not image_data.startswith(b"\xff\xd8\xff"):
                    raise ValueError()
            player_name = payload.get("playerName", "Aventureiro")
            if not isinstance(player_name, str):
                raise ValueError()
            save = character_store.save_npc if npc else character_store.save
            record = save(room, slot, token, fields, version, owner_id, clean_sheet_name(player_name))
            return self.send_json({"sheet": record, "storage": "cloud" if character_store.cloud else "server"})
        except (ValueError, TypeError, json.JSONDecodeError):
            return self.send_json({"error": "Dados de ficha inválidos."}, 400)
        except CharacterError as error:
            return self.send_json({"error": str(error)}, error.status)

    def add_book_slot(self, query):
        room, player_id = query.get("room", [""])[0], query.get("player", [""])[0]
        if not valid_room(room) or not PLAYER_ID_RE.fullmatch(player_id):
            return self.send_json({"error": "Sala ou jogador inválido."}, 400)
        with lock:
            capacity = read_book_capacity(room)
            if capacity >= MAX_BOOK_SLOTS:
                return self.send_json({"error": "A sala já possui 99 espaços de livros."}, 409)
            folder = BOOK_DATA / room
            try:
                folder.mkdir(parents=True, exist_ok=True)
                temporary = folder / "slots.tmp"
                temporary.write_text(json.dumps(capacity + 1), encoding="utf-8")
                temporary.replace(folder / "slots.json")
            except OSError:
                return self.send_json({"error": "Não foi possível criar outro espaço de livro."}, 500)
        return self.send_json({"capacity": capacity + 1})

    def upload_book(self, query):
        room = query.get("room", [""])[0]
        player_id = query.get("player", [""])[0]
        filename = query.get("filename", [""])[0].replace("\\", "/").split("/")[-1]
        try:
            slot = int(query.get("slot", ["-1"])[0])
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.send_json({"error": "dados do livro inválidos"}, 400)
        if not valid_room(room) or not re.fullmatch(r"[a-fA-F0-9-]{8,64}", player_id) or slot not in range(MAX_BOOK_SLOTS):
            return self.send_json({"error": "sala, jogador ou botão inválido"}, 400)
        if length <= 0 or length > MAX_BOOK_BYTES:
            return self.send_json({"error": "O PDF deve ter até 100 MB."}, 413)
        if Path(filename).suffix.lower() != ".pdf":
            return self.send_json({"error": "Envie um livro em PDF."}, 415)
        data = self.rfile.read(length)
        if len(data) != length:
            return self.send_json({"error": "upload incompleto"}, 400)
        if not data.startswith(b"%PDF-"):
            return self.send_json({"error": "O arquivo enviado não parece ser um PDF válido."}, 415)
        room_dir = BOOK_DATA / room
        room_dir.mkdir(parents=True, exist_ok=True)
        with lock:
            records = read_book_index(room)
            if any(item.get("slot") == slot for item in records):
                return self.send_json({"error": "Este espaço já tem um livro. Abra-o e exclua-o antes de enviar outro."}, 409)
            file_id = uuid.uuid4().hex
            record = {"id": file_id, "filename": filename[:180] or "livro.pdf", "bytes": length,
                      "uploadedAt": datetime.now(timezone.utc).isoformat(), "slot": slot,
                      "owner": player_id, "stored": f"{file_id}.pdf"}
            (room_dir / record["stored"]).write_bytes(data)
            records.append(record)
            index_path = book_index_path(room)
            temp_path = index_path.with_name("index.tmp")
            temp_path.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
            temp_path.replace(index_path)
        return self.send_json({"book": public_book(record)})

    def delete_book(self, query):
        room = query.get("room", [""])[0]
        file_id = query.get("id", [""])[0]
        if not valid_room(room) or not re.fullmatch(r"[a-f0-9]{32}", file_id):
            return self.send_json({"error": "livro não encontrado"}, 404)
        room_dir = BOOK_DATA / room
        with lock:
            records = read_book_index(room)
            record = next((item for item in records if item.get("id") == file_id), None)
            if not record:
                return self.send_json({"error": "livro não encontrado"}, 404)
            path = (room_dir / record.get("stored", "")).resolve()
            try:
                path.relative_to(room_dir.resolve())
                path.unlink(missing_ok=True)
            except (ValueError, OSError):
                return self.send_json({"error": "Não foi possível excluir o livro."}, 500)
            records = [item for item in records if item.get("id") != file_id]
            index_path = book_index_path(room)
            temp_path = index_path.with_name("index.tmp")
            temp_path.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
            temp_path.replace(index_path)
        return self.send_json({"ok": True})

    def upload_temporary_image(self, query):
        room = query.get("room", [""])[0]
        player_id = query.get("player", [""])[0]
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.send_json({"error": "tamanho da imagem inválido"}, 400)
        if not valid_room(room) or not re.fullmatch(r"[a-fA-F0-9-]{8,64}", player_id):
            return self.send_json({"error": "sala ou jogador inválido"}, 400)
        if length <= 0 or length > MAX_TEMP_IMAGE_BYTES:
            return self.send_json({"error": "A imagem deve ter até 20 MB."}, 413)
        filename = query.get("filename", [""])[0].replace("\\", "/").split("/")[-1]
        extension = Path(filename).suffix.lower()
        signatures = {".jpg": b"\xff\xd8\xff", ".jpeg": b"\xff\xd8\xff",
                      ".png": b"\x89PNG\r\n\x1a\n", ".webp": b"RIFF"}
        if extension not in signatures:
            return self.send_json({"error": "Envie uma imagem JPG, PNG ou WebP."}, 415)
        data = self.rfile.read(length)
        if len(data) != length:
            return self.send_json({"error": "upload incompleto"}, 400)
        valid_signature = data.startswith(signatures[extension])
        if extension == ".webp":
            valid_signature = len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP"
        if not valid_signature:
            return self.send_json({"error": "O arquivo não corresponde a uma imagem válida."}, 415)
        file_id = f"{uuid.uuid4().hex}{extension}"
        room_dir = TEMP_IMAGE_DATA / room
        room_dir.mkdir(parents=True, exist_ok=True)
        (room_dir / file_id).write_bytes(data)
        image = {"id": file_id, "filename": filename[:180] or f"cena{extension}", "bytes": length}
        return self.send_json({"image": image})

    def delete_music(self, query):
        room = query.get("room", [""])[0]
        file_id = query.get("id", [""])[0]
        clear_all = query.get("all", ["0"])[0] == "1"
        if not valid_room(room) or (not clear_all and not re.fullmatch(r"[a-f0-9]{32}", file_id)):
            return self.send_json({"error": "música ou sala inválida"}, 400)
        room_dir = MUSIC_DATA / room
        with lock:
            playlist = read_music_index(room)
            tracks = playlist["tracks"]
            if clear_all:
                removed = tracks[:]
                remaining = []
                current = 0
            else:
                match = next((i for i, track in enumerate(tracks) if track.get("id") == file_id), None)
                if match is None:
                    return self.send_json({"error": "A música não está na playlist."}, 404)
                removed = [tracks[match]]
                remaining = [track for track in tracks if track.get("id") != file_id]
                old_current = int(playlist.get("current", 0))
                current = old_current if old_current < match else max(0, old_current - 1)
                if old_current == match and remaining:
                    current = min(match, len(remaining) - 1)
            for track in removed:
                path = (room_dir / track.get("stored", "")).resolve()
                try:
                    path.relative_to(room_dir.resolve())
                    path.unlink(missing_ok=True)
                except (ValueError, OSError):
                    pass
            updated = {"tracks": remaining, "current": current}
            room_dir.mkdir(parents=True, exist_ok=True)
            index_path = music_index_path(room)
            temp_path = index_path.with_name("index.tmp")
            temp_path.write_text(json.dumps(updated, ensure_ascii=False), encoding="utf-8")
            temp_path.replace(index_path)
        return self.send_json({"tracks": [public_music(track) for track in remaining], "current": current})

    def upload_music(self, query):
        room = query.get("room", [""])[0]
        player_id = query.get("player", [""])[0]
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.send_json({"error": "tamanho do arquivo inválido"}, 400)
        if not valid_room(room) or not re.fullmatch(r"[a-fA-F0-9-]{8,64}", player_id):
            return self.send_json({"error": "sala ou jogador inválido"}, 400)
        if length <= 0 or length > MAX_MUSIC_BYTES:
            return self.send_json({"error": "Cada música deve ter até 50 MB."}, 413)
        filename = query.get("filename", [""])[0].replace("\\", "/").split("/")[-1]
        extension = Path(filename).suffix.lower()
        if extension not in MUSIC_TYPES:
            return self.send_json({"error": "Envie MP3, WAV, OGG, M4A, AAC, FLAC ou WebM."}, 415)
        data = self.rfile.read(length)
        if len(data) != length:
            return self.send_json({"error": "upload incompleto"}, 400)
        valid_mp3 = data.startswith(b"ID3") or (len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0)
        valid_audio = {
            ".mp3": valid_mp3,
            ".aac": data.startswith(b"ID3") or (len(data) > 1 and data[0] == 255 and data[1] & 0xF6 == 0xF0),
            ".wav": data[:4] == b"RIFF" and data[8:12] == b"WAVE",
            ".ogg": data.startswith(b"OggS"),
            ".m4a": data[4:8] == b"ftyp",
            ".flac": data.startswith(b"fLaC"),
            ".webm": data.startswith(b"\x1a\x45\xdf\xa3"),
        }.get(extension, False)
        if not valid_audio:
            return self.send_json({"error": "O conteúdo não corresponde ao formato da música."}, 415)
        file_id = uuid.uuid4().hex
        stored_name = f"{file_id}{extension}"
        room_dir = MUSIC_DATA / room
        room_dir.mkdir(parents=True, exist_ok=True)
        record = {"id": file_id, "filename": filename[:180] or "trilha.mp3", "bytes": length,
                  "uploadedAt": datetime.now(timezone.utc).isoformat(), "owner": player_id,
                  "stored": stored_name}
        with lock:
            playlist = read_music_index(room)
            tracks = playlist["tracks"]
            if len(tracks) >= MAX_MUSIC_TRACKS:
                return self.send_json({"error": f"A playlist aceita até {MAX_MUSIC_TRACKS} músicas."}, 413)
            if sum(int(item.get("bytes", 0)) for item in tracks) + length > MAX_MUSIC_TOTAL_BYTES:
                return self.send_json({"error": "A playlist da sala pode ocupar até 500 MB."}, 413)
            (room_dir / stored_name).write_bytes(data)
            tracks.append(record)
            playlist = {"tracks": tracks, "current": playlist.get("current", 0)}
            index_path = music_index_path(room)
            temp_path = index_path.with_name("index.tmp")
            temp_path.write_text(json.dumps(playlist, ensure_ascii=False), encoding="utf-8")
            temp_path.replace(index_path)
        return self.send_json({"track": public_music(record),
                               "tracks": [public_music(track) for track in tracks],
                               "current": playlist["current"]})

    def upload_sheet(self, query):
        room = query.get("room", [""])[0]
        player_id = query.get("player", [""])[0]
        bundle_id = query.get("bundle", [""])[0]
        try:
            page = int(query.get("page", ["0"])[0])
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.send_json({"error": "dados do arquivo inválidos"}, 400)
        if not valid_room(room) or not re.fullmatch(r"[a-fA-F0-9-]{8,64}", player_id):
            return self.send_json({"error": "sala ou jogador inválido"}, 400)
        if not re.fullmatch(r"[a-f0-9]{32}", bundle_id) or not 1 <= page <= 100:
            return self.send_json({"error": "grupo ou página inválidos"}, 400)
        if length <= 0 or length > MAX_SHEET_BYTES:
            return self.send_json({"error": "Cada arquivo deve ter até 20 MB."}, 413)

        raw_name = query.get("filename", [""])[0].replace("\\", "/").split("/")[-1]
        extension = Path(raw_name).suffix.lower()
        if extension not in SHEET_TYPES:
            return self.send_json({"error": "Envie PDF, JPG, PNG ou WebP."}, 415)
        data = self.rfile.read(length)
        if len(data) != length:
            return self.send_json({"error": "upload incompleto"}, 400)
        content_type, signature = SHEET_TYPES[extension]
        if extension == ".webp":
            valid_signature = len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP"
        else:
            valid_signature = data.startswith(signature)
        if not valid_signature:
            return self.send_json({"error": "O conteúdo não corresponde ao tipo de arquivo."}, 415)

        file_id = uuid.uuid4().hex
        stored_name = f"{file_id}{extension}"
        room_dir = SHEET_DATA / room
        record = {
            "id": file_id,
            "bundleId": bundle_id,
            "playerId": player_id,
            "playerName": clean_sheet_name(query.get("playerName", [""])[0]),
            "page": page,
            "filename": raw_name[:180] or f"ficha{extension}",
            "contentType": content_type,
            "bytes": length,
            "uploadedAt": datetime.now(timezone.utc).isoformat(),
            "stored": stored_name,
        }
        with lock:
            room_dir.mkdir(parents=True, exist_ok=True)
            records = read_sheet_index(room)
            replaced = [item for item in records if item.get("playerId") == player_id and item.get("page") == page]
            for old in replaced:
                old_path = (room_dir / old.get("stored", "")).resolve()
                try:
                    old_path.relative_to(room_dir.resolve())
                    old_path.unlink(missing_ok=True)
                except (ValueError, OSError):
                    pass
            records = [item for item in records if item not in replaced]
            records.append(record)
            (room_dir / stored_name).write_bytes(data)
            index_path = room_dir / "index.json"
            temporary_index = room_dir / "index.tmp"
            temporary_index.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
            temporary_index.replace(index_path)
        return self.send_json({"ok": True, "sheet": public_sheet(record)}, 201)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8000"))
    print(f"Mesa AD&D escutando na porta {port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
