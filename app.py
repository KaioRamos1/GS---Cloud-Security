"""Kaio Automóveis: API WSGI e SQLite. Adaptada do material de Eduardo Popovici.

Local: python app.py --seed. Azure: Gunicorn app:application, atrás de Nginx.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import sqlite3
from contextlib import closing
from datetime import date
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs

ROOT = Path(__file__).resolve().parent
DEFAULT_DATA = Path(os.environ.get('LOCALAPPDATA', Path.home() / '.local/share')) / 'MinhaFrotaCloud'
DB_PATH = Path(os.environ.get('MINHA_FROTA_DATA_DIR', DEFAULT_DATA)) / 'minha_frota.sqlite3'
PLATE = re.compile(r'^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$')
MAX_BODY = 65536
VEHICLE_FIELDS = {'type', 'brand', 'model', 'version', 'year', 'plate', 'renavam', 'chassis',
                  'color', 'fuel', 'odometer_km', 'acquired_on', 'acquisition_value',
                  'photo_path', 'notes', 'status'}
RECORD_FIELDS = {'vehicle_id', 'kind', 'category', 'description', 'due_date', 'performed_on',
                 'amount', 'status', 'odometer_km', 'details'}
KINDS = {'manutencao', 'pagamento', 'seguro', 'documento', 'abastecimento', 'despesa'}
RECORD_STATUSES = {'pendente', 'pago', 'atrasado', 'concluido', 'ativo'}


class ApiError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


def invalid(message):
    raise ApiError(400, 'validation_error', message)


def connect():
    connection = sqlite3.connect(DB_PATH, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys=ON')
    return connection


def init_database(seed=False):
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect()) as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.executescript((ROOT / 'schema.sql').read_text(encoding='utf-8'))
        initialized = conn.execute("SELECT value FROM app_meta WHERE key='initialized'").fetchone()
        if not initialized:
            if seed and conn.execute('SELECT COUNT(*) FROM vehicles').fetchone()[0] == 0:
                conn.executemany('''INSERT INTO vehicles
                    (type,brand,model,year,plate,odometer_km,is_demo) VALUES (?,?,?,?,?,?,1)''', [
                    ('carro', 'Toyota', 'Corolla', 2022, 'ABC1D23', 32450),
                    ('carro', 'Honda', 'Civic', 2020, 'DEF4G56', 56230),
                    ('moto', 'Honda', 'CG 160', 2023, 'HIJ7K89', 18920)])
                conn.execute('''INSERT INTO records
                    (vehicle_id,kind,category,description,due_date,amount)
                    VALUES (1,'manutencao','Revisao','Revisao demonstrativa',?,480)''',
                    (date.today().isoformat(),))
            conn.execute("INSERT INTO app_meta VALUES ('initialized','1')")
        conn.commit()


def validate(data, entity, creating=True):
    allowed = VEHICLE_FIELDS if entity == 'vehicles' else RECORD_FIELDS
    required = {'type', 'brand', 'model', 'year', 'plate'} if entity == 'vehicles' else {
        'vehicle_id', 'kind', 'category', 'description'}
    if not isinstance(data, dict):
        invalid('Envie um objeto JSON.')
    if not data or set(data) - allowed:
        invalid('Informe campos conhecidos e ao menos um valor.')
    if creating and not required.issubset(data):
        invalid('Campos obrigatorios: ' + ', '.join(sorted(required)))
    data = data.copy()
    enums = {'type': {'carro', 'moto'}, 'kind': KINDS,
             'status': {'ativo', 'vendido', 'inativo'} if entity == 'vehicles' else RECORD_STATUSES}
    numbers = {'odometer_km', 'amount', 'acquisition_value'}
    dates = {'acquired_on', 'due_date', 'performed_on'}
    nonempty = required | {'status'}
    for key, value in data.items():
        if value is None:
            if key in nonempty or key == 'amount' or (entity == 'vehicles' and key == 'odometer_km'):
                invalid(f'{key} nao pode ser nulo.')
            continue
        if key in enums:
            if not isinstance(value, str) or value not in enums[key]:
                invalid(f'{key} possui valor invalido.')
        elif key in {'year', 'vehicle_id'}:
            if type(value) is not int or value < 1:
                invalid(f'{key} deve ser um inteiro positivo.')
            if key == 'year' and not 1886 <= value <= date.today().year + 2:
                invalid('Ano invalido.')
        elif key in numbers:
            if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                invalid(f'{key} deve ser um numero finito nao negativo.')
            if value > 1e12:
                invalid(f'{key} excede o limite permitido.')
        elif key in dates:
            try:
                if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
                    raise ValueError()
                date.fromisoformat(value)
            except ValueError:
                invalid(f'{key} deve ser uma data valida no formato AAAA-MM-DD.')
        else:
            if not isinstance(value, str) or len(value) > (2000 if key in {'notes', 'details'} else 160):
                invalid(f'{key} deve ser texto dentro do limite permitido.')
            data[key] = value.strip()
            if key in nonempty and not data[key]:
                invalid(f'{key} nao pode ser vazio.')
    if 'plate' in data:
        data['plate'] = data['plate'].upper().replace('-', '')
        if not PLATE.fullmatch(data['plate']):
            invalid('Placa invalida. Exemplo: ABC1D23.')
    return data


def read_json(env):
    if env.get('CONTENT_TYPE', '').split(';')[0].strip().lower() != 'application/json':
        raise ApiError(415, 'unsupported_media_type', 'Use Content-Type: application/json.')
    try:
        length = int(env.get('CONTENT_LENGTH') or '0')
    except ValueError:
        invalid('Content-Length invalido.')
    if length < 0:
        invalid('Content-Length invalido.')
    if length > MAX_BODY:
        raise ApiError(413, 'too_large', 'Corpo da requisicao excede 64 KiB.')
    try:
        return json.loads(env['wsgi.input'].read(length), parse_constant=lambda _: invalid('Numero JSON invalido.'))
    except (ValueError, UnicodeDecodeError):
        invalid('JSON invalido.')


def query_rows(conn, sql, values=()):
    return [dict(row) for row in conn.execute(sql, values).fetchall()]


def get_one(conn, entity, ident):
    # entity is selected only from the fixed routes, never from request data.
    sql = 'SELECT * FROM vehicles WHERE id=?' if entity == 'vehicles' else 'SELECT * FROM records WHERE id=?'
    row = conn.execute(sql, (ident,)).fetchone()
    if not row:
        raise ApiError(404, 'not_found', 'Registro nao encontrado.')
    return dict(row)


def route(env):
    path = env.get('PATH_INFO', '/').rstrip('/') or '/'
    method = env['REQUEST_METHOD']
    try:
        query = parse_qs(env.get('QUERY_STRING', ''), max_num_fields=20)
    except ValueError:
        invalid('Quantidade excessiva de parametros.')
    assets = {'/': ('dashboard.html', 'text/html; charset=utf-8'),
              '/static/app.js': ('static/app.js', 'text/javascript; charset=utf-8'),
              '/static/style.css': ('static/style.css', 'text/css; charset=utf-8'),
              '/static/kaio-hero.png': ('static/kaio-hero.png', 'image/png')}
    if path in assets:
        if method != 'GET':
            raise ApiError(405, 'method_not_allowed', 'Use GET.')
        filename, mime = assets[path]
        return 200, (ROOT / filename).read_bytes(), mime
    if method not in {'GET', 'POST', 'PUT', 'DELETE'}:
        raise ApiError(405, 'method_not_allowed', 'Metodo nao permitido.')
    # Browser cross-origin requests cannot add this header without a preflight.
    # No CORS headers are sent and OPTIONS is rejected. This is CSRF protection,
    # not authentication: public authentication belongs to the HTTPS proxy.
    if method != 'GET' and env.get('HTTP_X_REQUESTED_WITH') != 'MinhaFrota':
        raise ApiError(403, 'csrf_check_failed', 'Envie X-Requested-With: MinhaFrota.')
    with closing(connect()) as conn:
        if path == '/api/health' and method == 'GET':
            conn.execute('SELECT 1 FROM vehicles LIMIT 1')
            return 200, {'status': 'ok', 'database': 'ok'}, None
        if path == '/api/dashboard' and method == 'GET':
            count = conn.execute("SELECT COUNT(*) FROM vehicles WHERE status='ativo'").fetchone()[0]
            cost = conn.execute('''SELECT COALESCE(SUM(amount),0) FROM records
                WHERE substr(COALESCE(performed_on,due_date),1,7)=?''', (date.today().strftime('%Y-%m'),)).fetchone()[0]
            upcoming = query_rows(conn, """SELECT r.*,v.brand||' '||v.model AS vehicle_name
                FROM records r JOIN vehicles v ON r.vehicle_id=v.id WHERE r.status='pendente'
                ORDER BY r.due_date IS NULL,r.due_date LIMIT 10""")
            return 200, {'data': {'active_vehicles': count, 'monthly_cost': cost, 'upcoming': upcoming}}, None
        if path == '/api/reports/costs' and method == 'GET':
            return 200, {'data': query_rows(conn, '''SELECT kind,category,ROUND(SUM(amount),2) AS total
                FROM records GROUP BY kind,category ORDER BY total DESC''')}, None
        match = re.fullmatch(r'/api/(vehicles|records)(?:/(\d+))?', path)
        if not match:
            raise ApiError(404, 'not_found', 'Rota nao encontrada.')
        entity, ident_text = match.groups()
        ident = int(ident_text) if ident_text else None
        if ident is not None:
            get_one(conn, entity, ident)
        if method == 'GET':
            if ident is not None:
                result = get_one(conn, entity, ident)
            elif entity == 'vehicles':
                kind = query.get('type', [None])[0]
                if kind is not None and kind not in {'carro', 'moto'}:
                    invalid('Filtro type invalido.')
                result = query_rows(conn, 'SELECT * FROM vehicles WHERE (? IS NULL OR type=?) ORDER BY id', (kind, kind))
            else:
                vehicle = query.get('vehicle_id', [None])[0]
                if vehicle is not None and (not vehicle.isdecimal() or int(vehicle) < 1):
                    invalid('Filtro vehicle_id invalido.')
                result = query_rows(conn, '''SELECT r.*,v.brand||' '||v.model AS vehicle_name
                    FROM records r JOIN vehicles v ON r.vehicle_id=v.id
                    WHERE (? IS NULL OR r.vehicle_id=?) ORDER BY r.id DESC''', (vehicle, vehicle))
            return 200, {'data': result}, None
        if method == 'POST' and ident is None:
            data = validate(read_json(env), entity)
            keys = list(data)
            # nosec B608: table is route-enumerated; columns are an explicit allowlist; values use placeholders.
            sql = f"INSERT INTO {entity} ({','.join(keys)}) VALUES ({','.join('?' for _ in keys)})"  # nosec B608: identifiers are allowlisted
            cursor = conn.execute(sql, list(data.values()))
            conn.commit()
            return 201, {'data': get_one(conn, entity, cursor.lastrowid)}, None
        if method == 'PUT' and ident is not None:
            data = validate(read_json(env), entity, creating=False)
            timestamp = ',updated_at=CURRENT_TIMESTAMP' if entity == 'vehicles' else ''
            # nosec B608: table and field names are restricted above; no user values are interpolated.
            sql = f"UPDATE {entity} SET {','.join(key+'=?' for key in data)}{timestamp} WHERE id=?"  # nosec B608: identifiers are allowlisted
            conn.execute(sql, [*data.values(), ident])
            conn.commit()
            return 200, {'data': get_one(conn, entity, ident)}, None
        if method == 'DELETE' and ident is not None:
            if query.get('confirm') != ['true']:
                raise ApiError(409, 'confirmation_required', 'Confirme com ?confirm=true. Registros relacionados serao excluidos.')
            sql = 'DELETE FROM vehicles WHERE id=?' if entity == 'vehicles' else 'DELETE FROM records WHERE id=?'
            conn.execute(sql, (ident,))
            conn.commit()
            return 204, b'', None
        raise ApiError(405, 'method_not_allowed', 'Metodo nao permitido nesta rota.')


def application(env, start_response):
    try:
        status, payload, mime = route(env)
    except sqlite3.IntegrityError:
        status, payload, mime = 409, {'error': {'code': 'conflict', 'message': 'Duplicidade ou relacionamento invalido.'}}, None
    except ApiError as exc:
        status, payload, mime = exc.status, {'error': {'code': exc.code, 'message': exc.message}}, None
    except Exception:
        # Do not log request bodies, credentials or exception messages with user data.
        logging.error('Falha interna ao processar requisicao')
        status, payload, mime = 500, {'error': {'code': 'internal_error', 'message': 'Erro interno.'}}, None
    body = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode('utf-8')
    headers = [('X-Content-Type-Options', 'nosniff'), ('X-Frame-Options', 'DENY'),
               ('Referrer-Policy', 'no-referrer'), ('Cache-Control', 'no-store'),
               ('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")]
    if status != 204:
        headers.append(('Content-Type', mime or 'application/json; charset=utf-8'))
        headers.append(('Content-Length', str(len(body))))
    start_response(f'{status} {HTTPStatus(status).phrase}', headers)
    return [body]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--init-db', action='store_true')
    parser.add_argument('--seed', action='store_true')
    args = parser.parse_args()
    init_database(args.seed or os.environ.get('MINHA_FROTA_SEED_DEMO') == '1')
    if args.init_db:
        print('Banco inicializado.')
        return
    from wsgiref.simple_server import make_server
    port = int(os.environ.get('MINHA_FROTA_PORT', '3001'))
    print(f'Desenvolvimento local: http://127.0.0.1:{port}', flush=True)
    print('Para Azure, use Gunicorn e Nginx conforme docs/GUIA_AZURE.md.', flush=True)
    with make_server('127.0.0.1', port, application) as server:
        server.serve_forever()


if __name__ == '__main__':
    main()
