"""Character documents. Optional Supabase persistence; no credentials reach clients."""
import hashlib
import json
import os
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class CharacterError(Exception):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


class CharacterStore:
    def __init__(self, data_root):
        self.root = Path(data_root) / 'characters'
        self.mutex = threading.RLock()
        self.cloud_url = os.environ.get('MESA_SUPABASE_URL', '').rstrip('/')
        self.cloud_key = os.environ.get('MESA_SUPABASE_SERVICE_KEY', '')
        self.cloud = bool(self.cloud_url and self.cloud_key)

    def request(self, method, query, body=None):
        payload = None if body is None else json.dumps(body).encode('utf-8')
        headers = {'apikey': self.cloud_key, 'Content-Type': 'application/json',
                   'Prefer': 'return=representation'}
        if not self.cloud_key.startswith('sb_secret_'):
            headers['Authorization'] = 'Bearer ' + self.cloud_key
        req = Request(self.cloud_url + '/rest/v1/mesa_characters?' + urlencode(query),
                      data=payload, method=method, headers=headers)
        try:
            with urlopen(req, timeout=12) as response:
                return json.loads(response.read() or b'[]')
        except HTTPError as error:
            if error.code == 409:
                raise CharacterError('A ficha foi alterada. Reabra-a para conferir a versão atual.', 409) from None
            raise CharacterError('Não foi possível acessar o banco das fichas. Sua cópia neste aparelho foi preservada.') from None
        except (URLError, TimeoutError, OSError, ValueError):
            raise CharacterError('Banco de fichas indisponível. Sua cópia neste aparelho foi preservada.') from None

    def _load(self, room):
        if bool(self.cloud_url) != bool(self.cloud_key):
            raise CharacterError('A configuração de nuvem está incompleta. Configure a URL e a chave do banco no servidor.')
        if self.cloud:
            rows = self.request('GET', {'room': 'eq.' + room, 'select': 'document,token_hash'})
            return [{**row['document'], '_tokenHash': row['token_hash']} for row in rows]
        path = self.root / room / 'index.json'
        if not path.exists():
            return []
        try:
            records = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(records, list):
                raise ValueError()
            return records
        except (OSError, ValueError):
            raise CharacterError('Não foi possível ler as fichas salvas. Os arquivos não foram substituídos.') from None

    def list(self, room):
        with self.mutex:
            return [self.public(record) for record in self._load(room)]

    @staticmethod
    def npc_prefix(room):
        # Separate namespace; each NPC uses slot 1 without changing existing player rows.
        return 'npc-' + hashlib.sha256(room.encode()).hexdigest() + '-'

    def list_npcs(self, room):
        prefix = self.npc_prefix(room)
        with self.mutex:
            if self.cloud:
                rows = self.request('GET', {'room': 'like.' + prefix + '*',
                                           'select': 'room,document'})
                return [{**row['document'], 'slot': row['room'][len(prefix):]}
                        for row in rows]
            records = []
            for folder in sorted(self.root.glob(prefix + '*')):
                records.extend({**self.public(record), 'slot': folder.name[len(prefix):]}
                               for record in self._load(folder.name))
            return records

    def save_npc(self, room, npc_id, token, fields, version, owner_id, owner_name):
        document = self.save(self.npc_prefix(room) + npc_id, 1, token, fields,
                             version, owner_id, owner_name)
        return {**document, 'slot': npc_id}

    @staticmethod
    def public(record):
        return {key: value for key, value in record.items() if not key.startswith('_')}

    def save(self, room, slot, token, fields, version, owner_id, owner_name):
        token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()
        with self.mutex:
            records = self._load(room)
            previous = next((record for record in records if record['slot'] == slot), None)
            if previous and not secrets.compare_digest(previous.get('_tokenHash', ''), token_hash):
                raise CharacterError('Esta ficha pertence a outro jogador. Use sua chave de edição para recuperá-la.', 403)
            if (previous and previous['version'] != version) or (not previous and version != 0):
                raise CharacterError('A ficha mudou no servidor. Sua edição está guardada neste aparelho; reabra a ficha para conferir.', 409)
            document = {'slot': slot, 'fields': fields, 'version': version + 1,
                        'ownerId': previous['ownerId'] if previous else owner_id,
                        'ownerName': owner_name,
                        'updatedAt': datetime.now(timezone.utc).isoformat()}
            if self.cloud:
                row = {'room': room, 'slot': slot, 'version': document['version'],
                       'token_hash': token_hash, 'document': document}
                if previous:
                    result = self.request('PATCH', {'room': 'eq.' + room, 'slot': 'eq.' + str(slot),
                                                   'version': 'eq.' + str(version)}, row)
                    if not result:
                        raise CharacterError('Outra edição foi salva primeiro. Reabra a ficha antes de continuar.', 409)
                else:
                    self.request('POST', {}, row)
            else:
                records = [record for record in records if record['slot'] != slot]
                records.append({**document, '_tokenHash': token_hash})
                path = self.root / room / 'index.json'
                try:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    temporary = path.with_suffix('.tmp')
                    temporary.write_text(json.dumps(records, ensure_ascii=False), encoding='utf-8')
                    temporary.replace(path)
                except OSError:
                    raise CharacterError('Não foi possível gravar no servidor. Sua cópia neste aparelho foi preservada.') from None
            return document
