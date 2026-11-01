"""Private PDF persistence; credentials and storage object paths stay on the server."""
import hashlib
import json
import secrets
import threading
import uuid
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from character_store import CharacterError


class BookError(Exception):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


class BookStore:
    BUCKET = 'mesa-books-private'
    CHUNK = 4 * 1024 * 1024

    def __init__(self, database):
        self.database = database
        self.cloud = database.cloud
        self.mutex = threading.RLock()
        self.bucket_ready = False

    @staticmethod
    def prefix(room):
        return 'bookmeta-' + hashlib.sha256(room.encode()).hexdigest() + '-'

    def table(self, method, query, body=None):
        try:
            return self.database.request(method, query, body)
        except CharacterError as error:
            raise BookError('Não foi possível acessar a biblioteca na nuvem. Tente novamente.', error.status) from None

    def storage(self, method, path, data=None, binary=False):
        headers = {'apikey': self.database.cloud_key}
        if not self.database.cloud_key.startswith('sb_secret_'):
            headers['Authorization'] = 'Bearer ' + self.database.cloud_key
        if isinstance(data, bytes):
            headers['Content-Type'] = 'application/octet-stream'
            payload = data
        else:
            headers['Content-Type'] = 'application/json'
            payload = None if data is None else json.dumps(data).encode()
        request = Request(self.database.cloud_url + '/storage/v1' + path,
                          data=payload, method=method, headers=headers)
        try:
            with urlopen(request, timeout=45) as response:
                result = response.read()
                return result if binary else json.loads(result or b'{}')
        except HTTPError as error:
            status = error.code
            try:
                details = json.loads(error.read(8192))
                status = int(details.get('statusCode', status))
            except (ValueError, TypeError):
                pass
            raise BookError('Não foi possível concluir o armazenamento do PDF na nuvem. Confira o espaço disponível e tente novamente.', status) from None
        except (URLError, TimeoutError, OSError, ValueError):
            raise BookError('A conexão com a nuvem foi interrompida. Tente salvar o livro novamente.') from None

    def ensure_bucket(self):
        if self.bucket_ready:
            return
        try:
            bucket = self.storage('GET', '/bucket/' + self.BUCKET)
        except BookError as error:
            if error.status != 404:
                raise
            try:
                self.storage('POST', '/bucket/', {'id': self.BUCKET, 'name': self.BUCKET,
                             'public': False, 'file_size_limit': self.CHUNK,
                             'allowed_mime_types': ['application/octet-stream']})
            except BookError as conflict:
                if conflict.status != 409:
                    raise
            bucket = self.storage('GET', '/bucket/' + self.BUCKET)
        if bucket.get('public'):
            raise BookError('A biblioteca precisa de armazenamento privado para salvar livros.')
        self.bucket_ready = True

    def list(self, room):
        if not self.cloud:
            return []
        rows = self.table('GET', {'room': 'like.' + self.prefix(room) + '*', 'select': 'document'})
        return [row['document'] for row in rows]

    def save(self, room, record, path):
        if not self.cloud:
            raise BookError('O salvamento na nuvem não está configurado neste servidor.')
        with self.mutex:
            saved = self.list(room)
            existing = next((book for book in saved if book['id'] == record['id']), None)
            if existing:
                return existing
            if any(book['slot'] == record['slot'] for book in saved):
                raise BookError('Este espaço já tem outro livro salvo na nuvem.', 409)
            self.ensure_bucket()
            objects, checksum, size = [], hashlib.sha256(), 0
            attempt = uuid.uuid4().hex
            try:
                with path.open('rb') as source:
                    while True:
                        chunk = source.read(self.CHUNK)
                        if not chunk:
                            break
                        name = hashlib.sha256(room.encode()).hexdigest() + '/' + record['id'] + '/' + attempt + '/' + str(len(objects)) + '.part'
                        self.storage('POST', '/object/' + self.BUCKET + '/' + name, chunk)
                        objects.append(name)
                        checksum.update(chunk)
                        size += len(chunk)
                if size != record['bytes']:
                    raise BookError('O arquivo mudou durante o salvamento. Envie o PDF novamente.', 409)
                document = {**record, 'cloudSaved': True, '_objects': objects,
                            '_sha256': checksum.hexdigest(), 'savedAt': datetime.now(timezone.utc).isoformat()}
                self.table('POST', {}, {'room': self.prefix(room) + str(record['slot']), 'slot': 1,
                           'version': 1, 'token_hash': secrets.token_hex(32), 'document': document})
                return document
            except (BookError, OSError):
                # A lost HTTP confirmation may follow a successful commit. Never
                # remove objects referenced by that committed document.
                try:
                    committed = next((book for book in self.list(room) if book['id'] == record['id']), None)
                except BookError:
                    raise
                if committed:
                    return committed
                if objects:
                    try:
                        self.storage('DELETE', '/object/' + self.BUCKET, {'prefixes': objects})
                    except BookError:
                        pass
                raise

    def recover(self, record, path):
        if not record.get('cloudSaved'):
            raise BookError('O PDF não foi salvo na nuvem.', 404)
        temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
        path.parent.mkdir(parents=True, exist_ok=True)
        checksum, length = hashlib.sha256(), 0
        try:
            with temporary.open('wb') as target:
                for name in record['_objects']:
                    chunk = self.storage('GET', '/object/authenticated/' + self.BUCKET + '/' + quote(name, safe='/'), binary=True)
                    length += len(chunk)
                    if length > record['bytes']:
                        raise BookError('A cópia do PDF não passou na verificação de integridade.')
                    checksum.update(chunk)
                    target.write(chunk)
            if length != record['bytes'] or checksum.hexdigest() != record['_sha256']:
                raise BookError('A cópia do PDF não passou na verificação de integridade.')
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)

    def delete(self, room, record):
        if not record.get('cloudSaved'):
            return
        with self.mutex:
            self.storage('DELETE', '/object/' + self.BUCKET, {'prefixes': record['_objects']})
            self.table('DELETE', {'room': 'eq.' + self.prefix(room) + str(record['slot']), 'slot': 'eq.1'})
