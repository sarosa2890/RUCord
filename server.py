from flask import Flask, render_template, request, jsonify, session
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from datetime import datetime, timedelta
import os
import jwt as pyjwt
from storage import storage, hash_password, check_password

# ==================== FLASK APP ====================

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'rucord-secret-key-change-in-production')
app.config['JWT_SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY', 'jwt-secret-key-change-in-production')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=30)

jwt = JWTManager(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet', logger=True, engineio_logger=True)
CORS(app)

# Helper function to get user from token
def get_user_from_token(token):
    """Получить пользователя из токена для WebSocket"""
    try:
        decoded = pyjwt.decode(token, app.config['JWT_SECRET_KEY'], algorithms=['HS256'])
        return decoded.get('sub')
    except Exception as e:
        print(f"Token decode error: {e}")
        return None

# Initialize admin user
def init_admin_user():
    """Create admin user if it doesn't exist"""
    admin = storage.get_one_by_field('users', 'username', 'admin')
    if not admin:
        print("[STORAGE] Creating admin user...")
        admin = storage.add('users', {
            'username': 'admin',
            'email': 'admin@rucord.com',
            'password_hash': hash_password('admin123'),
            'avatar': 'default_avatar.png',
            'status': 'online',
            'status_message': None
        })
        
        # Create settings for admin
        storage.add('user_settings', {
            'user_id': admin['id'],
            'theme': 'dark',
            'language': 'ru',
            'notifications': True,
            'sound_enabled': True
        })
        print("[STORAGE] Admin user created successfully")
    else:
        print("[STORAGE] Admin user already exists")

# Initialize storage
print("[STORAGE] Initializing JSON storage...")
init_admin_user()

# Global error handler
@app.errorhandler(Exception)
def handle_exception(e):
    import traceback
    error_msg = str(e)
    error_traceback = traceback.format_exc()
    print(f"[ERROR] Unhandled exception: {error_msg}")
    print(f"[ERROR] Traceback:\n{error_traceback}")
    
    if request.path.startswith('/api/'):
        return jsonify({'error': f'Server error: {error_msg}'}), 500
    
    return f"Internal Server Error: {error_msg}", 500

# ==================== API Routes ====================

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/home')
def home():
    return render_template('index.html')

@app.route('/app')
def app_route():
    return render_template('index.html')

@app.route('/api/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
            
        username = data.get('username')
        email = data.get('email')
        password = data.get('password')
        
        if not username or not email or not password:
            return jsonify({'error': 'Все поля обязательны'}), 400
        
        if storage.get_one_by_field('users', 'username', username):
            return jsonify({'error': 'Пользователь с таким именем уже существует'}), 400
        
        if storage.get_one_by_field('users', 'email', email):
            return jsonify({'error': 'Пользователь с таким email уже существует'}), 400
        
        user = storage.add('users', {
            'username': username,
            'email': email,
            'password_hash': hash_password(password),
            'avatar': 'default_avatar.png',
            'status': 'offline',
            'status_message': None
        })
        
        # Create default settings
        storage.add('user_settings', {
            'user_id': user['id'],
            'theme': 'dark',
            'language': 'ru',
            'notifications': True,
            'sound_enabled': True
        })
        
        access_token = create_access_token(identity=user['id'])
        return jsonify({
            'token': access_token,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'avatar': user['avatar'],
                'status': user['status'],
                'status_message': user.get('status_message'),
                'created_at': user.get('created_at')
            }
        }), 201
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"[ERROR] Register error: {error_msg}")
        return jsonify({'error': f'Server error: {error_msg}'}), 500

@app.route('/api/login', methods=['POST'])
def login():
    try:
        print("[LOGIN] Login request received")
        data = request.get_json()
        print(f"[LOGIN] Request data: {data}")
        
        if not data:
            print("[LOGIN] No JSON data")
            return jsonify({'error': 'Invalid JSON'}), 400
            
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            print("[LOGIN] Missing username or password")
            return jsonify({'error': 'Имя пользователя и пароль обязательны'}), 400
        
        print(f"[LOGIN] Querying user: {username}")
        user = storage.get_one_by_field('users', 'username', username)
        print(f"[LOGIN] User found: {user is not None}")
        
        if not user:
            print(f"[LOGIN] User not found: {username}")
            return jsonify({'error': 'Неверное имя пользователя или пароль'}), 401
        
        print("[LOGIN] Checking password")
        if not check_password(password, user['password_hash']):
            print("[LOGIN] Invalid password")
            return jsonify({'error': 'Неверное имя пользователя или пароль'}), 401
        
        print("[LOGIN] Creating access token")
        access_token = create_access_token(identity=user['id'])
        print("[LOGIN] Login successful")
        return jsonify({
            'token': access_token,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'avatar': user['avatar'],
                'status': user['status'],
                'status_message': user.get('status_message'),
                'created_at': user.get('created_at')
            }
        }), 200
    except Exception as e:
        import traceback
        error_msg = str(e)
        error_traceback = traceback.format_exc()
        print(f"[ERROR] Login error: {error_msg}")
        print(f"[ERROR] Traceback:\n{error_traceback}")
        return jsonify({'error': f'Server error: {error_msg}'}), 500

@app.route('/api/me', methods=['GET'])
@jwt_required()
def get_current_user():
    user_id = get_jwt_identity()
    user = storage.get_by_id('users', user_id)
    
    if not user:
        return jsonify({'error': 'Пользователь не найден'}), 404
    
    return jsonify({
        'id': user['id'],
        'username': user['username'],
        'avatar': user['avatar'],
        'status': user['status'],
        'status_message': user.get('status_message'),
        'created_at': user.get('created_at')
    }), 200

# Helper function to format user dict
def format_user_dict(user, include_email=False):
    """Format user dictionary for response"""
    data = {
        'id': user['id'],
        'username': user['username'],
        'avatar': user.get('avatar', 'default_avatar.png'),
        'status': user.get('status', 'offline'),
        'status_message': user.get('status_message'),
        'created_at': user.get('created_at')
    }
    if include_email:
        data['email'] = user.get('email')
    return data

# ==================== Servers API ====================

@app.route('/api/servers', methods=['GET'])
@jwt_required()
def get_servers():
    user_id = get_jwt_identity()
    memberships = storage.get_by_field('server_members', 'user_id', user_id)
    server_ids = [m['server_id'] for m in memberships]
    servers = [storage.get_by_id('servers', sid) for sid in server_ids if storage.get_by_id('servers', sid)]
    
    result = []
    for server in servers:
        channels = storage.get_by_field('channels', 'server_id', server['id'])
        members = storage.get_by_field('server_members', 'server_id', server['id'])
        result.append({
            'id': server['id'],
            'name': server['name'],
            'icon': server.get('icon', 'default_server.png'),
            'owner_id': server['owner_id'],
            'created_at': server.get('created_at'),
            'member_count': len(members),
            'channel_count': len(channels)
        })
    
    return jsonify(result), 200

@app.route('/api/servers', methods=['POST'])
@jwt_required()
def create_server():
    user_id = get_jwt_identity()
    data = request.get_json()
    name = data.get('name')
    
    if not name:
        return jsonify({'error': 'Имя сервера обязательно'}), 400
    
    server = storage.add('servers', {
        'name': name,
        'icon': 'default_server.png',
        'owner_id': user_id
    })
    
    # Add creator as owner
    storage.add('server_members', {
        'user_id': user_id,
        'server_id': server['id'],
        'role': 'owner'
    })
    
    # Create general channel
    storage.add('channels', {
        'server_id': server['id'],
        'name': 'общий',
        'type': 'text'
    })
    
    return jsonify({
        'id': server['id'],
        'name': server['name'],
        'icon': server.get('icon', 'default_server.png'),
        'owner_id': server['owner_id'],
        'created_at': server.get('created_at'),
        'member_count': 1,
        'channel_count': 1
    }), 201

@app.route('/api/servers/<int:server_id>', methods=['GET'])
@jwt_required()
def get_server(server_id):
    user_id = get_jwt_identity()
    
    members = storage.get_by_field('server_members', 'user_id', user_id)
    member = None
    for m in members:
        if m.get('server_id') == server_id:
            member = m
            break
    
    if not member:
        return jsonify({'error': 'У вас нет доступа к этому серверу'}), 403
    
    server = storage.get_by_id('servers', server_id)
    if not server:
        return jsonify({'error': 'Сервер не найден'}), 404
    
    channels = storage.get_by_field('channels', 'server_id', server_id)
    members = storage.get_by_field('server_members', 'server_id', server_id)
    
    return jsonify({
        'id': server['id'],
        'name': server['name'],
        'icon': server.get('icon', 'default_server.png'),
        'owner_id': server['owner_id'],
        'created_at': server.get('created_at'),
        'member_count': len(members),
        'channel_count': len(channels)
    }), 200

@app.route('/api/servers/<int:server_id>/join', methods=['POST'])
@jwt_required()
def join_server(server_id):
    user_id = get_jwt_identity()
    
    server = storage.get_by_id('servers', server_id)
    if not server:
        return jsonify({'error': 'Сервер не найден'}), 404
    
    # Check if already a member
    existing = storage.get_by_field('server_members', 'user_id', user_id)
    existing = [m for m in existing if m.get('server_id') == server_id]
    if existing:
        return jsonify({'error': 'Вы уже участник этого сервера'}), 400
    
    storage.add('server_members', {
        'user_id': user_id,
        'server_id': server_id,
        'role': 'member'
    })
    
    return jsonify({'message': 'Вы присоединились к серверу', 'server': {
        'id': server['id'],
        'name': server['name'],
        'icon': server.get('icon', 'default_server.png'),
        'owner_id': server['owner_id'],
        'created_at': server.get('created_at')
    }}), 200

@app.route('/api/servers/<int:server_id>/channels', methods=['GET'])
@jwt_required()
def get_channels(server_id):
    user_id = get_jwt_identity()
    
    member = storage.get_one_by_field('server_members', 'user_id', user_id)
    if not member or member.get('server_id') != server_id:
        return jsonify({'error': 'У вас нет доступа к этому серверу'}), 403
    
    channels = storage.get_by_field('channels', 'server_id', server_id)
    channels.sort(key=lambda x: x.get('created_at', ''))
    
    return jsonify([{
        'id': ch['id'],
        'server_id': ch['server_id'],
        'name': ch['name'],
        'type': ch.get('type', 'text'),
        'created_at': ch.get('created_at'),
        'message_count': 0
    } for ch in channels]), 200

@app.route('/api/servers/<int:server_id>/channels', methods=['POST'])
@jwt_required()
def create_channel(server_id):
    user_id = get_jwt_identity()
    data = request.get_json()
    name = data.get('name')
    channel_type = data.get('type', 'text')
    
    if not name:
        return jsonify({'error': 'Имя канала обязательно'}), 400
    
    members = storage.get_by_field('server_members', 'user_id', user_id)
    member = None
    for m in members:
        if m.get('server_id') == server_id:
            member = m
            break
    
    if not member:
        return jsonify({'error': 'У вас нет доступа к этому серверу'}), 403
    
    if member.get('role') not in ['owner', 'admin']:
        return jsonify({'error': 'У вас нет прав на создание канала'}), 403
    
    channel = storage.add('channels', {
        'server_id': server_id,
        'name': name,
        'type': channel_type
    })
    
    return jsonify({
        'id': channel['id'],
        'server_id': channel['server_id'],
        'name': channel['name'],
        'type': channel.get('type', 'text'),
        'created_at': channel.get('created_at'),
        'message_count': 0
    }), 201

@app.route('/api/channels/<int:channel_id>/messages', methods=['GET'])
@jwt_required()
def get_messages(channel_id):
    user_id = get_jwt_identity()
    
    channel = storage.get_by_id('channels', channel_id)
    if not channel:
        return jsonify({'error': 'Канал не найден'}), 404
    
    members = storage.get_by_field('server_members', 'user_id', user_id)
    member = None
    for m in members:
        if m.get('server_id') == channel['server_id']:
            member = m
            break
    
    if not member:
        return jsonify({'error': 'У вас нет доступа к этому каналу'}), 403
    
    limit = request.args.get('limit', 50, type=int)
    messages = storage.get_by_field('messages', 'channel_id', channel_id)
    messages.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    messages = messages[:limit]
    messages.reverse()
    
    result = []
    for msg in messages:
        user = storage.get_by_id('users', msg['user_id'])
        result.append({
            'id': msg['id'],
            'channel_id': msg.get('channel_id'),
            'dm_channel_id': msg.get('dm_channel_id'),
            'user_id': msg['user_id'],
            'content': msg['content'],
            'created_at': msg.get('created_at'),
            'edited_at': msg.get('edited_at'),
            'user': format_user_dict(user) if user else None
        })
    
    return jsonify(result), 200

@app.route('/api/channels/<int:channel_id>/messages', methods=['POST'])
@jwt_required()
def create_message(channel_id):
    user_id = get_jwt_identity()
    data = request.get_json()
    content = data.get('content')
    
    if not content or not content.strip():
        return jsonify({'error': 'Сообщение не может быть пустым'}), 400
    
    channel = storage.get_by_id('channels', channel_id)
    if not channel:
        return jsonify({'error': 'Канал не найден'}), 404
    
    members = storage.get_by_field('server_members', 'user_id', user_id)
    member = None
    for m in members:
        if m.get('server_id') == channel['server_id']:
            member = m
            break
    
    if not member:
        return jsonify({'error': 'У вас нет доступа к этому каналу'}), 403
    
    message = storage.add('messages', {
        'channel_id': channel_id,
        'user_id': user_id,
        'content': content.strip()
    })
    
    user = storage.get_by_id('users', user_id)
    message_dict = {
        'id': message['id'],
        'channel_id': message.get('channel_id'),
        'dm_channel_id': message.get('dm_channel_id'),
        'user_id': message['user_id'],
        'content': message['content'],
        'created_at': message.get('created_at'),
        'edited_at': message.get('edited_at'),
        'user': format_user_dict(user) if user else None
    }
    
    socketio.emit('new_message', message_dict, room=f'channel_{channel_id}')
    
    return jsonify(message_dict), 201

# ==================== Friends API ====================

@app.route('/api/users/search', methods=['GET'])
@jwt_required()
def search_users():
    user_id = get_jwt_identity()
    query = request.args.get('q', '').lower()
    
    if not query or len(query) < 2:
        return jsonify([]), 200
    
    all_users = storage.get_all('users')
    matching = [u for u in all_users if query in u.get('username', '').lower() and u['id'] != user_id]
    
    return jsonify([format_user_dict(u) for u in matching[:10]]), 200

@app.route('/api/friends/requests', methods=['GET'])
@jwt_required()
def get_friend_requests():
    user_id = get_jwt_identity()
    
    incoming = [r for r in storage.get_by_field('friend_requests', 'to_user_id', user_id) if r.get('status') == 'pending']
    outgoing = [r for r in storage.get_by_field('friend_requests', 'from_user_id', user_id) if r.get('status') == 'pending']
    
    def enrich_request(req):
        req_dict = {
            'id': req['id'],
            'from_user_id': req['from_user_id'],
            'to_user_id': req['to_user_id'],
            'status': req.get('status', 'pending'),
            'created_at': req.get('created_at')
        }
        from_user = storage.get_by_id('users', req['from_user_id'])
        to_user = storage.get_by_id('users', req['to_user_id'])
        if from_user:
            req_dict['from_user'] = format_user_dict(from_user)
        if to_user:
            req_dict['to_user'] = format_user_dict(to_user)
        return req_dict
    
    return jsonify({
        'incoming': [enrich_request(req) for req in incoming],
        'outgoing': [enrich_request(req) for req in outgoing]
    }), 200

@app.route('/api/friends/requests', methods=['POST'])
@jwt_required()
def send_friend_request():
    user_id = get_jwt_identity()
    data = request.get_json()
    to_user_id = data.get('to_user_id')
    
    if not to_user_id:
        return jsonify({'error': 'ID пользователя обязателен'}), 400
    
    if to_user_id == user_id:
        return jsonify({'error': 'Нельзя отправить запрос самому себе'}), 400
    
    to_user = storage.get_by_id('users', to_user_id)
    if not to_user:
        return jsonify({'error': 'Пользователь не найден'}), 404
    
    # Check if already friends
    friendships = storage.get_all('friendships')
    friendship = None
    for f in friendships:
        if (f['user1_id'] == user_id and f['user2_id'] == to_user_id) or \
           (f['user1_id'] == to_user_id and f['user2_id'] == user_id):
            friendship = f
            break
    
    if friendship:
        return jsonify({'error': 'Вы уже друзья'}), 400
    
    # Check if request already exists
    all_requests = storage.get_all('friend_requests')
    existing_request = None
    for req in all_requests:
        if ((req['from_user_id'] == user_id and req['to_user_id'] == to_user_id) or \
            (req['from_user_id'] == to_user_id and req['to_user_id'] == user_id)) and \
           req.get('status') == 'pending':
            existing_request = req
            break
    
    if existing_request:
        if existing_request['from_user_id'] == user_id:
            return jsonify({'error': 'Запрос уже отправлен'}), 400
        else:
            # Auto-accept if request was sent by other user
            storage.update('friend_requests', existing_request['id'], {'status': 'accepted'})
            storage.add('friendships', {
                'user1_id': min(user_id, to_user_id),
                'user2_id': max(user_id, to_user_id)
            })
            return jsonify({'message': 'Запрос принят'}), 200
    
    friend_request = storage.add('friend_requests', {
        'from_user_id': user_id,
        'to_user_id': to_user_id,
        'status': 'pending'
    })
    
    request_dict = {
        'id': friend_request['id'],
        'from_user_id': friend_request['from_user_id'],
        'to_user_id': friend_request['to_user_id'],
        'status': friend_request.get('status', 'pending'),
        'created_at': friend_request.get('created_at'),
        'from_user': format_user_dict(storage.get_by_id('users', user_id)),
        'to_user': format_user_dict(to_user)
    }
    
    user_room = f'user_{to_user_id}'
    socketio.emit('friend_request_received', request_dict, room=user_room)
    
    return jsonify(request_dict), 201

@app.route('/api/friends/requests/<int:request_id>/accept', methods=['POST'])
@jwt_required()
def accept_friend_request(request_id):
    user_id = get_jwt_identity()
    
    friend_request = storage.get_by_id('friend_requests', request_id)
    if not friend_request:
        return jsonify({'error': 'Запрос не найден'}), 404
    
    if friend_request['to_user_id'] != user_id:
        return jsonify({'error': 'У вас нет прав для принятия этого запроса'}), 403
    
    if friend_request.get('status') != 'pending':
        return jsonify({'error': 'Запрос уже был обработан'}), 400
    
    storage.update('friend_requests', request_id, {'status': 'accepted'})
    
    friendship = storage.add('friendships', {
        'user1_id': min(friend_request['from_user_id'], friend_request['to_user_id']),
        'user2_id': max(friend_request['from_user_id'], friend_request['to_user_id'])
    })
    
    user1 = storage.get_by_id('users', friendship['user1_id'])
    user2 = storage.get_by_id('users', friendship['user2_id'])
    friendship_dict = {
        'id': friendship['id'],
        'user1_id': friendship['user1_id'],
        'user2_id': friendship['user2_id'],
        'created_at': friendship.get('created_at'),
        'user1': format_user_dict(user1) if user1 else None,
        'user2': format_user_dict(user2) if user2 else None
    }
    
    user_room = f'user_{friend_request["from_user_id"]}'
    socketio.emit('friend_request_accepted', {
        'friendship': friendship_dict,
        'friend': format_user_dict(user2) if user2 else {}
    }, room=user_room)
    
    return jsonify({'message': 'Запрос принят', 'friendship': friendship_dict}), 200

@app.route('/api/friends/requests/<int:request_id>/decline', methods=['POST'])
@jwt_required()
def decline_friend_request(request_id):
    user_id = get_jwt_identity()
    
    friend_request = storage.get_by_id('friend_requests', request_id)
    if not friend_request:
        return jsonify({'error': 'Запрос не найден'}), 404
    
    if friend_request['to_user_id'] != user_id:
        return jsonify({'error': 'У вас нет прав для отклонения этого запроса'}), 403
    
    storage.update('friend_requests', request_id, {'status': 'declined'})
    
    return jsonify({'message': 'Запрос отклонен'}), 200

@app.route('/api/friends', methods=['GET'])
@jwt_required()
def get_friends():
    user_id = get_jwt_identity()
    
    friendships = storage.get_all('friendships')
    user_friendships = [f for f in friendships if f['user1_id'] == user_id or f['user2_id'] == user_id]
    
    friends = []
    for friendship in user_friendships:
        friend_id = friendship['user2_id'] if friendship['user1_id'] == user_id else friendship['user1_id']
        friend = storage.get_by_id('users', friend_id)
        if friend:
            friends.append(format_user_dict(friend))
    
    return jsonify(friends), 200

@app.route('/api/friends/<int:friend_id>', methods=['DELETE'])
@jwt_required()
def remove_friend(friend_id):
    user_id = get_jwt_identity()
    
    friendships = storage.get_all('friendships')
    friendship = None
    for f in friendships:
        if ((f.get('user1_id') == user_id and f.get('user2_id') == friend_id) or
            (f.get('user1_id') == friend_id and f.get('user2_id') == user_id)):
            friendship = f
            break
    
    if not friendship:
        return jsonify({'error': 'Дружба не найдена'}), 404
    
    storage.delete('friendships', friendship['id'])
    
    return jsonify({'message': 'Друг удален'}), 200

# ==================== DM Channels API ====================

@app.route('/api/dm-channels', methods=['GET'])
@jwt_required()
def get_dm_channels():
    user_id = get_jwt_identity()
    
    all_channels = storage.get_all('dm_channels')
    user_channels = [ch for ch in all_channels if ch['user1_id'] == user_id or ch['user2_id'] == user_id]
    user_channels.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    
    result = []
    for channel in user_channels:
        other_user_id = channel['user2_id'] if channel['user1_id'] == user_id else channel['user1_id']
        other_user = storage.get_by_id('users', other_user_id)
        
        messages = storage.get_by_field('messages', 'dm_channel_id', channel['id'])
        last_message = messages[-1] if messages else None
        
        dm_dict = {
            'id': channel['id'],
            'user1_id': channel['user1_id'],
            'user2_id': channel['user2_id'],
            'created_at': channel.get('created_at'),
            'last_message': {
                'id': last_message['id'],
                'content': last_message['content'],
                'created_at': last_message.get('created_at')
            } if last_message else None,
            'unread_count': 0
        }
        
        if other_user:
            dm_dict['other_user'] = format_user_dict(other_user)
        
        result.append(dm_dict)
    
    return jsonify(result), 200

@app.route('/api/dm-channels', methods=['POST'])
@jwt_required()
def create_dm_channel():
    user_id = get_jwt_identity()
    data = request.get_json()
    other_user_id = data.get('user_id')
    
    if not other_user_id:
        return jsonify({'error': 'ID пользователя обязателен'}), 400
    
    if other_user_id == user_id:
        return jsonify({'error': 'Нельзя создать DM с самим собой'}), 400
    
    other_user = storage.get_by_id('users', other_user_id)
    if not other_user:
        return jsonify({'error': 'Пользователь не найден'}), 404
    
    # Check if channel already exists
    all_channels = storage.get_all('dm_channels')
    existing_channel = None
    for ch in all_channels:
        if ((ch.get('user1_id') == user_id and ch.get('user2_id') == other_user_id) or
            (ch.get('user1_id') == other_user_id and ch.get('user2_id') == user_id)):
            existing_channel = ch
            break
    
    if existing_channel:
        dm_dict = {
            'id': existing_channel['id'],
            'user1_id': existing_channel['user1_id'],
            'user2_id': existing_channel['user2_id'],
            'created_at': existing_channel.get('created_at'),
            'last_message': None,
            'unread_count': 0
        }
        if other_user:
            dm_dict['other_user'] = format_user_dict(other_user)
        return jsonify(dm_dict), 200
    
    # Create new channel
    dm_channel = storage.add('dm_channels', {
        'user1_id': min(user_id, other_user_id),
        'user2_id': max(user_id, other_user_id)
    })
    
    dm_dict = {
        'id': dm_channel['id'],
        'user1_id': dm_channel['user1_id'],
        'user2_id': dm_channel['user2_id'],
        'created_at': dm_channel.get('created_at'),
        'last_message': None,
        'unread_count': 0
    }
    if other_user:
        dm_dict['other_user'] = format_user_dict(other_user)
    
    return jsonify(dm_dict), 201

@app.route('/api/dm-channels/<int:channel_id>/messages', methods=['GET'])
@jwt_required()
def get_dm_messages(channel_id):
    user_id = get_jwt_identity()
    
    dm_channel = storage.get_by_id('dm_channels', channel_id)
    if not dm_channel:
        return jsonify({'error': 'Канал не найден'}), 404
    
    if dm_channel.get('user1_id') != user_id and dm_channel.get('user2_id') != user_id:
        return jsonify({'error': 'У вас нет доступа к этому каналу'}), 403
    
    limit = request.args.get('limit', 50, type=int)
    messages = storage.get_by_field('messages', 'dm_channel_id', channel_id)
    messages.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    messages = messages[:limit]
    messages.reverse()
    
    result = []
    for msg in messages:
        user = storage.get_by_id('users', msg['user_id'])
        result.append({
            'id': msg['id'],
            'channel_id': msg.get('channel_id'),
            'dm_channel_id': msg.get('dm_channel_id'),
            'user_id': msg['user_id'],
            'content': msg['content'],
            'created_at': msg.get('created_at'),
            'edited_at': msg.get('edited_at'),
            'user': format_user_dict(user) if user else None
        })
    
    return jsonify(result), 200

@app.route('/api/dm-channels/<int:channel_id>/messages', methods=['POST'])
@jwt_required()
def create_dm_message(channel_id):
    user_id = get_jwt_identity()
    data = request.get_json()
    content = data.get('content')
    
    if not content or not content.strip():
        return jsonify({'error': 'Сообщение не может быть пустым'}), 400
    
    dm_channel = storage.get_by_id('dm_channels', channel_id)
    if not dm_channel:
        return jsonify({'error': 'Канал не найден'}), 404
    
    if dm_channel.get('user1_id') != user_id and dm_channel.get('user2_id') != user_id:
        return jsonify({'error': 'У вас нет доступа к этому каналу'}), 403
    
    message = storage.add('messages', {
        'dm_channel_id': channel_id,
        'user_id': user_id,
        'content': content.strip()
    })
    
    user = storage.get_by_id('users', user_id)
    message_dict = {
        'id': message['id'],
        'channel_id': message.get('channel_id'),
        'dm_channel_id': message.get('dm_channel_id'),
        'user_id': message['user_id'],
        'content': message['content'],
        'created_at': message.get('created_at'),
        'edited_at': message.get('edited_at'),
        'user': format_user_dict(user) if user else None
    }
    
    socketio.emit('new_dm_message', message_dict, room=f'dm_channel_{channel_id}')
    
    other_user_id = dm_channel['user2_id'] if dm_channel['user1_id'] == user_id else dm_channel['user1_id']
    socketio.emit('new_dm_message', message_dict, room=f'user_{other_user_id}')
    
    return jsonify(message_dict), 201

# ==================== Settings API ====================

@app.route('/api/settings', methods=['GET'])
@jwt_required()
def get_settings():
    user_id = get_jwt_identity()
    
    settings = storage.get_one_by_field('user_settings', 'user_id', user_id)
    if not settings:
        settings = storage.add('user_settings', {
            'user_id': user_id,
            'theme': 'dark',
            'language': 'ru',
            'notifications': True,
            'sound_enabled': True
        })
    
    return jsonify({
        'id': settings['id'],
        'user_id': settings['user_id'],
        'theme': settings.get('theme', 'dark'),
        'language': settings.get('language', 'ru'),
        'notifications': settings.get('notifications', True),
        'sound_enabled': settings.get('sound_enabled', True)
    }), 200

@app.route('/api/settings', methods=['PUT'])
@jwt_required()
def update_settings():
    user_id = get_jwt_identity()
    data = request.get_json()
    
    settings = storage.get_one_by_field('user_settings', 'user_id', user_id)
    if not settings:
        settings = storage.add('user_settings', {
            'user_id': user_id,
            'theme': 'dark',
            'language': 'ru',
            'notifications': True,
            'sound_enabled': True
        })
    
    updates = {}
    if 'theme' in data:
        updates['theme'] = data['theme']
    if 'language' in data:
        updates['language'] = data['language']
    if 'notifications' in data:
        updates['notifications'] = data['notifications']
    if 'sound_enabled' in data:
        updates['sound_enabled'] = data['sound_enabled']
    
    storage.update('user_settings', settings['id'], updates)
    updated = storage.get_by_id('user_settings', settings['id'])
    
    return jsonify({
        'id': updated['id'],
        'user_id': updated['user_id'],
        'theme': updated.get('theme', 'dark'),
        'language': updated.get('language', 'ru'),
        'notifications': updated.get('notifications', True),
        'sound_enabled': updated.get('sound_enabled', True)
    }), 200

@app.route('/api/me/status', methods=['PUT'])
@jwt_required()
def update_status():
    user_id = get_jwt_identity()
    data = request.get_json()
    
    user = storage.get_by_id('users', user_id)
    if not user:
        return jsonify({'error': 'Пользователь не найден'}), 404
    
    updates = {}
    if 'status' in data:
        updates['status'] = data['status']
    if 'status_message' in data:
        updates['status_message'] = data['status_message']
    
    storage.update('users', user_id, updates)
    updated = storage.get_by_id('users', user_id)
    
    socketio.emit('user_status_changed', format_user_dict(updated), namespace='/')
    
    return jsonify(format_user_dict(updated)), 200

# ==================== WebSocket Events ====================

@socketio.on('connect')
def on_connect(auth=None):
    """Подключение через WebSocket"""
    try:
        if auth and isinstance(auth, dict):
            token = auth.get('token')
        else:
            from flask import request as flask_request
            token = flask_request.headers.get('Authorization', '').replace('Bearer ', '')
        
        if not token:
            print('No token provided in WebSocket connection')
            return False
        
        user_id = get_user_from_token(token)
        if not user_id:
            print(f'Invalid token in WebSocket connection')
            return False
        
        print(f'[SOCKET] Пользователь {user_id} подключился')
        session['user_id'] = user_id
        
        user_room = f'user_{user_id}'
        join_room(user_room)
        print(f'[SOCKET] Пользователь {user_id} присоединился к комнате {user_room}')
        
        # Update user status to online
        user = storage.get_by_id('users', user_id)
        if user:
            storage.update('users', user_id, {'status': 'online'})
            updated = storage.get_by_id('users', user_id)
            socketio.emit('user_status_changed', format_user_dict(updated), namespace='/')
        
        emit('connected', {'message': 'Подключено к RUCord'})
        return True
    except Exception as e:
        print(f'[SOCKET] Error in on_connect: {e}')
        import traceback
        traceback.print_exc()
        return False

@socketio.on('disconnect')
def on_disconnect():
    user_id = session.get('user_id')
    if user_id:
        print(f'Пользователь {user_id} отключился')
        # Update status to offline
        user = storage.get_by_id('users', user_id)
        if user:
            storage.update('users', user_id, {'status': 'offline'})
            updated = storage.get_by_id('users', user_id)
            socketio.emit('user_status_changed', format_user_dict(updated), namespace='/')

@socketio.on('join_channel')
def on_join_channel(data):
    user_id = session.get('user_id')
    if not user_id:
        return
    
    channel_id = data.get('channel_id')
    if not channel_id:
        return
    
    channel = storage.get_by_id('channels', channel_id)
    if not channel:
        return
    
    members = storage.get_by_field('server_members', 'user_id', user_id)
    member = None
    for m in members:
        if m.get('server_id') == channel['server_id']:
            member = m
            break
    
    if not member:
        return
    
    room = f'channel_{channel_id}'
    join_room(room)
    emit('joined_channel', {'channel_id': channel_id, 'room': room})

@socketio.on('leave_channel')
def on_leave_channel(data):
    channel_id = data.get('channel_id')
    if channel_id:
        room = f'channel_{channel_id}'
        leave_room(room)
        emit('left_channel', {'channel_id': channel_id})

@socketio.on('join_dm_channel')
def on_join_dm_channel(data):
    user_id = session.get('user_id')
    if not user_id:
        return
    
    channel_id = data.get('channel_id')
    if not channel_id:
        return
    
    dm_channel = storage.get_by_id('dm_channels', channel_id)
    if not dm_channel:
        return
    
    if dm_channel.get('user1_id') != user_id and dm_channel.get('user2_id') != user_id:
        return
    
    user = storage.get_by_id('users', user_id)
    if user:
        storage.update('users', user_id, {'status': 'online'})
        updated = storage.get_by_id('users', user_id)
        socketio.emit('user_status_changed', format_user_dict(updated), namespace='/')
    
    room = f'dm_channel_{channel_id}'
    user_room = f'user_{user_id}'
    join_room(room)
    join_room(user_room)
    emit('joined_dm_channel', {'channel_id': channel_id, 'room': room})

@socketio.on('leave_dm_channel')
def on_leave_dm_channel(data):
    channel_id = data.get('channel_id')
    if channel_id:
        room = f'dm_channel_{channel_id}'
        leave_room(room)
        emit('left_dm_channel', {'channel_id': channel_id})

# ==================== Call WebSocket Events ====================

@socketio.on('call_request')
def on_call_request(data):
    user_id = session.get('user_id')
    if not user_id:
        print(f'[CALL] No user_id in session for call_request')
        return
    
    to_user_id = data.get('to_user_id')
    call_type = data.get('type', 'audio')
    offer = data.get('offer')
    
    if not to_user_id:
        print(f'[CALL] No to_user_id in call_request')
        return
    
    print(f'[CALL] User {user_id} calling user {to_user_id}, type: {call_type}')
    print(f'[CALL] Offer present: {offer is not None}')
    
    user_room = f'user_{to_user_id}'
    print(f'[CALL] Sending call_incoming to room: {user_room}')
    
    try:
        socketio.emit('call_incoming', {
            'from_user_id': user_id,
            'type': call_type,
            'offer': offer
        }, room=user_room)
        print(f'[CALL] Successfully sent call_incoming to room {user_room}')
    except Exception as e:
        print(f'[CALL] Error sending call_incoming: {e}')
        import traceback
        traceback.print_exc()

@socketio.on('call_accept')
def on_call_accept(data):
    user_id = session.get('user_id')
    to_user_id = data.get('to_user_id')
    
    if user_id and to_user_id:
        print(f'[CALL] User {user_id} accepted call from user {to_user_id}')
        user_room = f'user_{to_user_id}'
        socketio.emit('call_accepted', {
            'from_user_id': user_id
        }, room=user_room)

@socketio.on('call_reject')
def on_call_reject(data):
    user_id = session.get('user_id')
    to_user_id = data.get('to_user_id')
    
    if user_id and to_user_id:
        print(f'[CALL] User {user_id} rejected call from user {to_user_id}')
        user_room = f'user_{to_user_id}'
        socketio.emit('call_rejected', {
            'from_user_id': user_id
        }, room=user_room)

@socketio.on('call_end')
def on_call_end(data):
    user_id = session.get('user_id')
    to_user_id = data.get('to_user_id')
    
    if user_id and to_user_id:
        print(f'[CALL] User {user_id} ended call with user {to_user_id}')
        user_room = f'user_{to_user_id}'
        socketio.emit('call_ended', {
            'from_user_id': user_id
        }, room=user_room)

@socketio.on('call_offer')
def on_call_offer(data):
    user_id = session.get('user_id')
    to_user_id = data.get('to_user_id')
    offer = data.get('offer')
    
    if user_id and to_user_id and offer:
        print(f'[CALL] User {user_id} sending offer to user {to_user_id}')
        user_room = f'user_{to_user_id}'
        socketio.emit('call_offer', {
            'from_user_id': user_id,
            'offer': offer
        }, room=user_room)

@socketio.on('call_answer')
def on_call_answer(data):
    user_id = session.get('user_id')
    to_user_id = data.get('to_user_id')
    answer = data.get('answer')
    
    if user_id and to_user_id and answer:
        print(f'[CALL] User {user_id} sending answer to user {to_user_id}')
        user_room = f'user_{to_user_id}'
        socketio.emit('call_answer', {
            'from_user_id': user_id,
            'answer': answer
        }, room=user_room)

@socketio.on('call_ice_candidate')
def on_call_ice_candidate(data):
    user_id = session.get('user_id')
    to_user_id = data.get('to_user_id')
    candidate = data.get('candidate')
    
    if user_id and to_user_id and candidate:
        user_room = f'user_{to_user_id}'
        socketio.emit('call_ice_candidate', {
            'from_user_id': user_id,
            'candidate': candidate
        }, room=user_room)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV') == 'development'
    print("=" * 50)
    print(f"RUCord сервер запущен на http://0.0.0.0:{port}")
    print("Тестовый пользователь: admin / admin123")
    print("=" * 50)
    socketio.run(app, host='0.0.0.0', port=port, debug=debug, allow_unsafe_werkzeug=True)

