from flask import Flask, render_template, request, jsonify, session
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
import os
import bcrypt

# ==================== DATABASE MODELS ====================

# Один экземпляр SQLAlchemy для всех баз данных
db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'
    __bind_key__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    avatar = db.Column(db.String(255), default='default_avatar.png')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    status = db.Column(db.String(20), default='offline')  # online, idle, dnd, offline
    status_message = db.Column(db.String(200), nullable=True)
    
    def set_password(self, password):
        self.password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    def check_password(self, password):
        return bcrypt.checkpw(password.encode('utf-8'), self.password_hash.encode('utf-8'))
    
    def to_dict(self, include_email=False):
        data = {
            'id': self.id,
            'username': self.username,
            'avatar': self.avatar,
            'status': self.status,
            'status_message': self.status_message,
            'created_at': self.created_at.isoformat()
        }
        if include_email:
            data['email'] = self.email
        return data

class Server(db.Model):
    __tablename__ = 'servers'
    __bind_key__ = 'groups'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    icon = db.Column(db.String(255), default='default_server.png')
    owner_id = db.Column(db.Integer, nullable=False)  # Без FK, так как в другой БД
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Отношения (без cascade, так как в разных БД)
    members = db.relationship('ServerMember', back_populates='server', cascade='all, delete-orphan')
    channels = db.relationship('Channel', back_populates='server', cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'icon': self.icon,
            'owner_id': self.owner_id,
            'created_at': self.created_at.isoformat(),
            'member_count': len(self.members),
            'channel_count': len(self.channels)
        }

class ServerMember(db.Model):
    __tablename__ = 'server_members'
    __bind_key__ = 'groups'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, nullable=False)  # Без FK
    server_id = db.Column(db.Integer, db.ForeignKey('servers.id'), nullable=False)
    role = db.Column(db.String(20), default='member')  # owner, admin, member
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Отношения
    server = db.relationship('Server', back_populates='members')
    
    __table_args__ = (db.UniqueConstraint('user_id', 'server_id', name='unique_server_member'),)
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'server_id': self.server_id,
            'role': self.role,
            'joined_at': self.joined_at.isoformat()
        }

class Channel(db.Model):
    __tablename__ = 'channels'
    __bind_key__ = 'groups'
    
    id = db.Column(db.Integer, primary_key=True)
    server_id = db.Column(db.Integer, db.ForeignKey('servers.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(20), default='text')  # text, voice
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Отношения
    server = db.relationship('Server', back_populates='channels')
    
    def to_dict(self):
        # Подсчет сообщений из другой БД - упрощенная версия
        return {
            'id': self.id,
            'server_id': self.server_id,
            'name': self.name,
            'type': self.type,
            'created_at': self.created_at.isoformat(),
            'message_count': 0  # Будет подсчитываться отдельно
        }

class Message(db.Model):
    __tablename__ = 'messages'
    __bind_key__ = 'chats'
    
    id = db.Column(db.Integer, primary_key=True)
    channel_id = db.Column(db.Integer, nullable=True)  # Без FK
    dm_channel_id = db.Column(db.Integer, db.ForeignKey('dm_channels.id'), nullable=True)
    user_id = db.Column(db.Integer, nullable=False)  # Без FK
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    edited_at = db.Column(db.DateTime, nullable=True)
    
    # Отношения
    dm_channel = db.relationship('DMChannel', back_populates='messages')
    
    def to_dict(self):
        # user будет добавляться отдельно в server.py
        return {
            'id': self.id,
            'channel_id': self.channel_id,
            'dm_channel_id': self.dm_channel_id,
            'user_id': self.user_id,
            'content': self.content,
            'created_at': self.created_at.isoformat(),
            'edited_at': self.edited_at.isoformat() if self.edited_at else None
        }

class FriendRequest(db.Model):
    __tablename__ = 'friend_requests'
    __bind_key__ = 'chats'
    
    id = db.Column(db.Integer, primary_key=True)
    from_user_id = db.Column(db.Integer, nullable=False)  # Без FK
    to_user_id = db.Column(db.Integer, nullable=False)  # Без FK
    status = db.Column(db.String(20), default='pending')  # pending, accepted, declined
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    __table_args__ = (db.UniqueConstraint('from_user_id', 'to_user_id', name='unique_friend_request'),)
    
    def to_dict(self):
        # users будут добавляться отдельно в server.py
        return {
            'id': self.id,
            'from_user_id': self.from_user_id,
            'to_user_id': self.to_user_id,
            'status': self.status,
            'created_at': self.created_at.isoformat()
        }

class Friendship(db.Model):
    __tablename__ = 'friendships'
    __bind_key__ = 'chats'
    
    id = db.Column(db.Integer, primary_key=True)
    user1_id = db.Column(db.Integer, nullable=False)  # Без FK
    user2_id = db.Column(db.Integer, nullable=False)  # Без FK
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    __table_args__ = (db.UniqueConstraint('user1_id', 'user2_id', name='unique_friendship'),)
    
    def to_dict(self):
        # users будут добавляться отдельно в server.py
        return {
            'id': self.id,
            'user1_id': self.user1_id,
            'user2_id': self.user2_id,
            'created_at': self.created_at.isoformat()
        }

class DMChannel(db.Model):
    __tablename__ = 'dm_channels'
    __bind_key__ = 'chats'
    
    id = db.Column(db.Integer, primary_key=True)
    user1_id = db.Column(db.Integer, nullable=False)  # Без FK
    user2_id = db.Column(db.Integer, nullable=False)  # Без FK
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Отношения
    messages = db.relationship('Message', back_populates='dm_channel', cascade='all, delete-orphan')
    
    __table_args__ = (db.UniqueConstraint('user1_id', 'user2_id', name='unique_dm_channel'),)
    
    def to_dict(self, current_user_id=None):
        # other_user будет добавляться отдельно в server.py
        last_message = self.messages[-1] if self.messages else None
        return {
            'id': self.id,
            'user1_id': self.user1_id,
            'user2_id': self.user2_id,
            'created_at': self.created_at.isoformat(),
            'last_message': last_message.to_dict() if last_message else None,
            'unread_count': 0
        }

class UserSettings(db.Model):
    __tablename__ = 'user_settings'
    __bind_key__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), unique=True, nullable=False)
    theme = db.Column(db.String(20), default='dark')  # dark, light
    language = db.Column(db.String(10), default='ru')
    notifications = db.Column(db.Boolean, default=True)
    sound_enabled = db.Column(db.Boolean, default=True)
    
    # Отношения
    user = db.relationship('User', backref='settings', uselist=False)
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'theme': self.theme,
            'language': self.language,
            'notifications': self.notifications,
            'sound_enabled': self.sound_enabled
        }

# ==================== FLASK APP ====================

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'rucord-secret-key-change-in-production')

# Конфигурация нескольких баз данных
app.config['SQLALCHEMY_BINDS'] = {
    'users': 'sqlite:///Users.db',
    'groups': 'sqlite:///Groups.db',
    'chats': 'sqlite:///Chats.db'
}

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY', 'jwt-secret-key-change-in-production')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=30)

# Инициализация базы данных
db.init_app(app)

jwt = JWTManager(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')
CORS(app)

# Создание таблиц во всех базах данных
with app.app_context():
    db.create_all(bind_key='users')
    db.create_all(bind_key='groups')
    db.create_all(bind_key='chats')
    
    # Создание тестового пользователя если не существует
    if not User.query.filter_by(username='admin').first():
        admin = User(username='admin', email='admin@rucord.com')
        admin.set_password('admin123')
        admin.status = 'online'
        db.session.add(admin)
        db.session.commit()
        
        # Создаем настройки для admin
        if not UserSettings.query.filter_by(user_id=admin.id).first():
            settings = UserSettings(user_id=admin.id)
            db.session.add(settings)
            db.session.commit()

# ==================== API Routes ====================

@app.route('/')
def index():
    return render_template('index.html')
    # Редирект на /home теперь обрабатывается на клиенте

@app.route('/home')
def home():
    return render_template('index.html')

@app.route('/app')
def app_route():
    return render_template('index.html')

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    email = data.get('email')
    password = data.get('password')
    
    if not username or not email or not password:
        return jsonify({'error': 'Все поля обязательны'}), 400
    
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Пользователь с таким именем уже существует'}), 400
    
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Пользователь с таким email уже существует'}), 400
    
    user = User(username=username, email=email)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    
    access_token = create_access_token(identity=user.id)
    return jsonify({
        'token': access_token,
        'user': user.to_dict()
    }), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'error': 'Имя пользователя и пароль обязательны'}), 400
    
    user = User.query.filter_by(username=username).first()
    
    if not user or not user.check_password(password):
        return jsonify({'error': 'Неверное имя пользователя или пароль'}), 401
    
    access_token = create_access_token(identity=user.id)
    return jsonify({
        'token': access_token,
        'user': user.to_dict()
    }), 200

@app.route('/api/me', methods=['GET'])
@jwt_required()
def get_current_user():
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    
    if not user:
        return jsonify({'error': 'Пользователь не найден'}), 404
    
    return jsonify(user.to_dict()), 200

@app.route('/api/servers', methods=['GET'])
@jwt_required()
def get_servers():
    user_id = get_jwt_identity()
    memberships = ServerMember.query.filter_by(user_id=user_id).all()
    servers = [membership.server for membership in memberships]
    
    return jsonify([server.to_dict() for server in servers]), 200

@app.route('/api/servers', methods=['POST'])
@jwt_required()
def create_server():
    user_id = get_jwt_identity()
    data = request.get_json()
    name = data.get('name')
    
    if not name:
        return jsonify({'error': 'Имя сервера обязательно'}), 400
    
    server = Server(name=name, owner_id=user_id)
    db.session.add(server)
    db.session.commit()
    
    # Добавляем создателя как владельца
    member = ServerMember(user_id=user_id, server_id=server.id, role='owner')
    db.session.add(member)
    
    # Создаем общий канал
    channel = Channel(server_id=server.id, name='общий', type='text')
    db.session.add(channel)
    db.session.commit()
    
    return jsonify(server.to_dict()), 201

@app.route('/api/servers/<int:server_id>', methods=['GET'])
@jwt_required()
def get_server(server_id):
    user_id = get_jwt_identity()
    
    # Проверяем является ли пользователь участником
    member = ServerMember.query.filter_by(user_id=user_id, server_id=server_id).first()
    if not member:
        return jsonify({'error': 'У вас нет доступа к этому серверу'}), 403
    
    server = Server.query.get_or_404(server_id)
    return jsonify(server.to_dict()), 200

@app.route('/api/servers/<int:server_id>/join', methods=['POST'])
@jwt_required()
def join_server(server_id):
    user_id = get_jwt_identity()
    
    server = Server.query.get_or_404(server_id)
    
    # Проверяем не является ли уже участником
    existing_member = ServerMember.query.filter_by(user_id=user_id, server_id=server_id).first()
    if existing_member:
        return jsonify({'error': 'Вы уже участник этого сервера'}), 400
    
    member = ServerMember(user_id=user_id, server_id=server_id, role='member')
    db.session.add(member)
    db.session.commit()
    
    return jsonify({'message': 'Вы присоединились к серверу', 'server': server.to_dict()}), 200

@app.route('/api/servers/<int:server_id>/channels', methods=['GET'])
@jwt_required()
def get_channels(server_id):
    user_id = get_jwt_identity()
    
    # Проверяем является ли пользователь участником
    member = ServerMember.query.filter_by(user_id=user_id, server_id=server_id).first()
    if not member:
        return jsonify({'error': 'У вас нет доступа к этому серверу'}), 403
    
    channels = Channel.query.filter_by(server_id=server_id).order_by(Channel.created_at).all()
    return jsonify([channel.to_dict() for channel in channels]), 200

@app.route('/api/servers/<int:server_id>/channels', methods=['POST'])
@jwt_required()
def create_channel(server_id):
    user_id = get_jwt_identity()
    data = request.get_json()
    name = data.get('name')
    channel_type = data.get('type', 'text')
    
    if not name:
        return jsonify({'error': 'Имя канала обязательно'}), 400
    
    # Проверяем является ли пользователь участником
    member = ServerMember.query.filter_by(user_id=user_id, server_id=server_id).first()
    if not member:
        return jsonify({'error': 'У вас нет доступа к этому серверу'}), 403
    
    # Проверяем права на создание канала (владелец или админ)
    if member.role not in ['owner', 'admin']:
        return jsonify({'error': 'У вас нет прав на создание канала'}), 403
    
    channel = Channel(server_id=server_id, name=name, type=channel_type)
    db.session.add(channel)
    db.session.commit()
    
    return jsonify(channel.to_dict()), 201

@app.route('/api/channels/<int:channel_id>/messages', methods=['GET'])
@jwt_required()
def get_messages(channel_id):
    user_id = get_jwt_identity()
    
    channel = Channel.query.get_or_404(channel_id)
    
    # Проверяем является ли пользователь участником сервера
    member = ServerMember.query.filter_by(user_id=user_id, server_id=channel.server_id).first()
    if not member:
        return jsonify({'error': 'У вас нет доступа к этому каналу'}), 403
    
    limit = request.args.get('limit', 50, type=int)
    messages = Message.query.filter_by(channel_id=channel_id)\
        .order_by(Message.created_at.desc())\
        .limit(limit)\
        .all()
    
    messages.reverse()
    return jsonify([message.to_dict() for message in messages]), 200

@app.route('/api/channels/<int:channel_id>/messages', methods=['POST'])
@jwt_required()
def create_message(channel_id):
    user_id = get_jwt_identity()
    data = request.get_json()
    content = data.get('content')
    
    if not content or not content.strip():
        return jsonify({'error': 'Сообщение не может быть пустым'}), 400
    
    channel = Channel.query.get_or_404(channel_id)
    
    # Проверяем является ли пользователь участником сервера
    member = ServerMember.query.filter_by(user_id=user_id, server_id=channel.server_id).first()
    if not member:
        return jsonify({'error': 'У вас нет доступа к этому каналу'}), 403
    
    message = Message(channel_id=channel_id, user_id=user_id, content=content.strip())
    db.session.add(message)
    db.session.commit()
    
    # Получаем пользователя для message
    user = User.query.get(user_id)
    message_dict = message.to_dict()
    if user:
        message_dict['user'] = user.to_dict()
    
    # Отправляем сообщение через WebSocket
    socketio.emit('new_message', message_dict, room=f'channel_{channel_id}')
    
    return jsonify(message_dict), 201

# ==================== Friends API ====================

@app.route('/api/users/search', methods=['GET'])
@jwt_required()
def search_users():
    user_id = get_jwt_identity()
    query = request.args.get('q', '')
    
    if not query or len(query) < 2:
        return jsonify([]), 200
    
    users = User.query.filter(
        User.username.ilike(f'%{query}%'),
        User.id != user_id
    ).limit(10).all()
    
    return jsonify([user.to_dict() for user in users]), 200

@app.route('/api/friends/requests', methods=['GET'])
@jwt_required()
def get_friend_requests():
    user_id = get_jwt_identity()
    
    # Получаем входящие и исходящие запросы
    incoming = FriendRequest.query.filter_by(to_user_id=user_id, status='pending').all()
    outgoing = FriendRequest.query.filter_by(from_user_id=user_id, status='pending').all()
    
    # Добавляем пользователей к запросам
    def enrich_request(req):
        req_dict = req.to_dict()
        from_user = User.query.get(req.from_user_id)
        to_user = User.query.get(req.to_user_id)
        if from_user:
            req_dict['from_user'] = from_user.to_dict()
        if to_user:
            req_dict['to_user'] = to_user.to_dict()
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
    
    to_user = User.query.get(to_user_id)
    if not to_user:
        return jsonify({'error': 'Пользователь не найден'}), 404
    
    # Проверяем, не являются ли уже друзьями
    friendship = Friendship.query.filter(
        ((Friendship.user1_id == user_id) & (Friendship.user2_id == to_user_id)) |
        ((Friendship.user1_id == to_user_id) & (Friendship.user2_id == user_id))
    ).first()
    
    if friendship:
        return jsonify({'error': 'Вы уже друзья'}), 400
    
    # Проверяем, нет ли уже запроса
    existing_request = FriendRequest.query.filter(
        ((FriendRequest.from_user_id == user_id) & (FriendRequest.to_user_id == to_user_id)) |
        ((FriendRequest.from_user_id == to_user_id) & (FriendRequest.to_user_id == user_id))
    ).first()
    
    if existing_request:
        if existing_request.status == 'pending':
            if existing_request.from_user_id == user_id:
                return jsonify({'error': 'Запрос уже отправлен'}), 400
            else:
                # Автоматически принимаем, если запрос был отправлен другим пользователем
                existing_request.status = 'accepted'
                friendship = Friendship(user1_id=min(user_id, to_user_id), user2_id=max(user_id, to_user_id))
                db.session.add(friendship)
                db.session.commit()
                return jsonify({'message': 'Запрос принят', 'friendship': friendship.to_dict()}), 200
        else:
            return jsonify({'error': 'Запрос уже был обработан'}), 400
    
    friend_request = FriendRequest(from_user_id=user_id, to_user_id=to_user_id)
    db.session.add(friend_request)
    db.session.commit()
    
    # Получаем пользователей для friend_request
    from_user = User.query.get(user_id)
    to_user = User.query.get(to_user_id)
    request_dict = friend_request.to_dict()
    if from_user and to_user:
        request_dict['from_user'] = from_user.to_dict()
        request_dict['to_user'] = to_user.to_dict()
    
    # Уведомляем получателя через WebSocket
    user_room = f'user_{to_user_id}'
    print(f'[FRIEND REQUEST] Отправка уведомления в комнату {user_room} для пользователя {to_user_id}')
    print(f'[FRIEND REQUEST] Данные запроса: {request_dict}')
    
    # Отправляем уведомление в комнату пользователя
    try:
        socketio.emit('friend_request_received', request_dict, room=user_room)
        print(f'[FRIEND REQUEST] Уведомление отправлено успешно')
    except Exception as e:
        print(f'[FRIEND REQUEST] Ошибка при отправке уведомления: {e}')
    
    return jsonify(request_dict), 201

@app.route('/api/friends/requests/<int:request_id>/accept', methods=['POST'])
@jwt_required()
def accept_friend_request(request_id):
    user_id = get_jwt_identity()
    
    friend_request = FriendRequest.query.get_or_404(request_id)
    
    if friend_request.to_user_id != user_id:
        return jsonify({'error': 'У вас нет прав для принятия этого запроса'}), 403
    
    if friend_request.status != 'pending':
        return jsonify({'error': 'Запрос уже был обработан'}), 400
    
    friend_request.status = 'accepted'
    
    # Создаем дружбу
    friendship = Friendship(
        user1_id=min(friend_request.from_user_id, friend_request.to_user_id),
        user2_id=max(friend_request.from_user_id, friend_request.to_user_id)
    )
    db.session.add(friendship)
    db.session.commit()
    
    # Получаем пользователей для friendship
    user1 = User.query.get(friendship.user1_id)
    user2 = User.query.get(friendship.user2_id)
    friendship_dict = friendship.to_dict()
    if user1 and user2:
        friendship_dict['user1'] = user1.to_dict()
        friendship_dict['user2'] = user2.to_dict()
    
    # Уведомляем отправителя
    user_room = f'user_{friend_request.from_user_id}'
    print(f'[FRIEND ACCEPT] Отправка уведомления в комнату {user_room} для пользователя {friend_request.from_user_id}')
    socketio.emit('friend_request_accepted', {
        'friendship': friendship_dict,
        'friend': user2.to_dict() if user2 else {}
    }, room=user_room)
    
    return jsonify({'message': 'Запрос принят', 'friendship': friendship_dict}), 200

@app.route('/api/friends/requests/<int:request_id>/decline', methods=['POST'])
@jwt_required()
def decline_friend_request(request_id):
    user_id = get_jwt_identity()
    
    friend_request = FriendRequest.query.get_or_404(request_id)
    
    if friend_request.to_user_id != user_id:
        return jsonify({'error': 'У вас нет прав для отклонения этого запроса'}), 403
    
    friend_request.status = 'declined'
    db.session.commit()
    
    return jsonify({'message': 'Запрос отклонен'}), 200

@app.route('/api/friends', methods=['GET'])
@jwt_required()
def get_friends():
    user_id = get_jwt_identity()
    
    friendships = Friendship.query.filter(
        (Friendship.user1_id == user_id) | (Friendship.user2_id == user_id)
    ).all()
    
    friends = []
    for friendship in friendships:
        friend_id = friendship.user2_id if friendship.user1_id == user_id else friendship.user1_id
        friend = User.query.get(friend_id)
        if friend:
            friends.append(friend.to_dict())
    
    return jsonify(friends), 200

@app.route('/api/friends/<int:friend_id>', methods=['DELETE'])
@jwt_required()
def remove_friend(friend_id):
    user_id = get_jwt_identity()
    
    friendship = Friendship.query.filter(
        ((Friendship.user1_id == user_id) & (Friendship.user2_id == friend_id)) |
        ((Friendship.user1_id == friend_id) & (Friendship.user2_id == user_id))
    ).first()
    
    if not friendship:
        return jsonify({'error': 'Дружба не найдена'}), 404
    
    db.session.delete(friendship)
    db.session.commit()
    
    return jsonify({'message': 'Друг удален'}), 200

# ==================== DM Channels API ====================

@app.route('/api/dm-channels', methods=['GET'])
@jwt_required()
def get_dm_channels():
    user_id = get_jwt_identity()
    
    channels = DMChannel.query.filter(
        (DMChannel.user1_id == user_id) | (DMChannel.user2_id == user_id)
    ).order_by(DMChannel.created_at.desc()).all()
    
    result = []
    for channel in channels:
        dm_dict = channel.to_dict(user_id)
        other_user_id = channel.user2_id if channel.user1_id == user_id else channel.user1_id
        other_user = User.query.get(other_user_id)
        if other_user:
            dm_dict['other_user'] = other_user.to_dict()
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
    
    other_user = User.query.get(other_user_id)
    if not other_user:
        return jsonify({'error': 'Пользователь не найден'}), 404
    
    # Проверяем, существует ли уже канал
    existing_channel = DMChannel.query.filter(
        ((DMChannel.user1_id == user_id) & (DMChannel.user2_id == other_user_id)) |
        ((DMChannel.user1_id == other_user_id) & (DMChannel.user2_id == user_id))
    ).first()
    
    if existing_channel:
        dm_dict = existing_channel.to_dict(user_id)
        # ВАЖНО: Добавляем other_user для существующего канала
        if other_user:
            dm_dict['other_user'] = other_user.to_dict()
        return jsonify(dm_dict), 200
    
    # Создаем новый канал
    dm_channel = DMChannel(
        user1_id=min(user_id, other_user_id),
        user2_id=max(user_id, other_user_id)
    )
    db.session.add(dm_channel)
    db.session.commit()
    
    # Получаем другого пользователя
    other_user = User.query.get(other_user_id)
    dm_dict = dm_channel.to_dict(user_id)
    if other_user:
        dm_dict['other_user'] = other_user.to_dict()
    
    return jsonify(dm_dict), 201

@app.route('/api/dm-channels/<int:channel_id>/messages', methods=['GET'])
@jwt_required()
def get_dm_messages(channel_id):
    user_id = get_jwt_identity()
    
    dm_channel = DMChannel.query.get_or_404(channel_id)
    
    # Проверяем, является ли пользователь участником
    if dm_channel.user1_id != user_id and dm_channel.user2_id != user_id:
        return jsonify({'error': 'У вас нет доступа к этому каналу'}), 403
    
    limit = request.args.get('limit', 50, type=int)
    messages = Message.query.filter_by(dm_channel_id=channel_id)\
        .order_by(Message.created_at.desc())\
        .limit(limit)\
        .all()
    
    messages.reverse()
    # Добавляем информацию о пользователях к сообщениям
    result = []
    for message in messages:
        msg_dict = message.to_dict()
        user = User.query.get(message.user_id)
        if user:
            msg_dict['user'] = user.to_dict()
        result.append(msg_dict)
    return jsonify(result), 200

@app.route('/api/dm-channels/<int:channel_id>/messages', methods=['POST'])
@jwt_required()
def create_dm_message(channel_id):
    user_id = get_jwt_identity()
    data = request.get_json()
    content = data.get('content')
    
    if not content or not content.strip():
        return jsonify({'error': 'Сообщение не может быть пустым'}), 400
    
    dm_channel = DMChannel.query.get_or_404(channel_id)
    
    # Проверяем, является ли пользователь участником
    if dm_channel.user1_id != user_id and dm_channel.user2_id != user_id:
        return jsonify({'error': 'У вас нет доступа к этому каналу'}), 403
    
    message = Message(dm_channel_id=channel_id, user_id=user_id, content=content.strip())
    db.session.add(message)
    db.session.commit()
    
    # Получаем пользователя для message
    user = User.query.get(user_id)
    message_dict = message.to_dict()
    if user:
        message_dict['user'] = user.to_dict()
    
    # Отправляем сообщение через WebSocket обоим участникам
    socketio.emit('new_dm_message', message_dict, room=f'dm_channel_{channel_id}')
    
    # Уведомляем другого пользователя
    other_user_id = dm_channel.user2_id if dm_channel.user1_id == user_id else dm_channel.user1_id
    socketio.emit('new_dm_message', message_dict, room=f'user_{other_user_id}')
    
    return jsonify(message_dict), 201

# ==================== Settings API ====================

@app.route('/api/settings', methods=['GET'])
@jwt_required()
def get_settings():
    user_id = get_jwt_identity()
    
    settings = UserSettings.query.filter_by(user_id=user_id).first()
    if not settings:
        settings = UserSettings(user_id=user_id)
        db.session.add(settings)
        db.session.commit()
    
    return jsonify(settings.to_dict()), 200

@app.route('/api/settings', methods=['PUT'])
@jwt_required()
def update_settings():
    user_id = get_jwt_identity()
    data = request.get_json()
    
    settings = UserSettings.query.filter_by(user_id=user_id).first()
    if not settings:
        settings = UserSettings(user_id=user_id)
        db.session.add(settings)
    
    if 'theme' in data:
        settings.theme = data['theme']
    if 'language' in data:
        settings.language = data['language']
    if 'notifications' in data:
        settings.notifications = data['notifications']
    if 'sound_enabled' in data:
        settings.sound_enabled = data['sound_enabled']
    
    db.session.commit()
    return jsonify(settings.to_dict()), 200

@app.route('/api/me/status', methods=['PUT'])
@jwt_required()
def update_status():
    user_id = get_jwt_identity()
    data = request.get_json()
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Пользователь не найден'}), 404
    
    if 'status' in data:
        user.status = data['status']
    if 'status_message' in data:
        user.status_message = data['status_message']
    
    db.session.commit()
    
    # Уведомляем всех о изменении статуса
    socketio.emit('user_status_changed', user.to_dict(), namespace='/')
    
    return jsonify(user.to_dict()), 200

# ==================== WebSocket Events ====================

def get_user_from_token(token):
    """Получить пользователя из токена для WebSocket"""
    try:
        import jwt as pyjwt
        decoded = pyjwt.decode(token, app.config['JWT_SECRET_KEY'], algorithms=['HS256'])
        return decoded.get('sub')
    except Exception as e:
        print(f"Token decode error: {e}")
        return None

@socketio.on('connect')
def on_connect(auth=None):
    """Подключение через WebSocket"""
    try:
        # Получаем токен из auth объекта
        if auth and isinstance(auth, dict):
            token = auth.get('token')
        else:
            # Пытаемся получить токен из заголовков запроса
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
        
        # ВАЖНО: Присоединяем пользователя к его личной комнате для получения уведомлений
        user_room = f'user_{user_id}'
        join_room(user_room)
        print(f'[SOCKET] Пользователь {user_id} присоединился к комнате {user_room}')
        
        # Обновляем статус пользователя на онлайн
        user = User.query.get(user_id)
        if user:
            user.status = 'online'
            db.session.commit()
            # Уведомляем всех подключенных клиентов об изменении статуса
            socketio.emit('user_status_changed', user.to_dict(), namespace='/')
        
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

@socketio.on('join_channel')
def on_join_channel(data):
    user_id = session.get('user_id')
    if not user_id:
        return
    
    channel_id = data.get('channel_id')
    if not channel_id:
        return
    
    channel = Channel.query.get(channel_id)
    if not channel:
        return
    
    # Проверяем доступ
    member = ServerMember.query.filter_by(user_id=user_id, server_id=channel.server_id).first()
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
    
    dm_channel = DMChannel.query.get(channel_id)
    if not dm_channel:
        return
    
    # Проверяем доступ
    if dm_channel.user1_id != user_id and dm_channel.user2_id != user_id:
        return
    
    # Обновляем статус пользователя на онлайн
    user = User.query.get(user_id)
    if user:
        user.status = 'online'
        db.session.commit()
        socketio.emit('user_status_changed', user.to_dict(), namespace='/')
    
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
    
    # Отправляем запрос на звонок получателю
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
    print("=" * 50)
    print("RUCord сервер запущен на http://localhost:5000")
    print("Тестовый пользователь: admin / admin123")
    print("=" * 50)
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)

