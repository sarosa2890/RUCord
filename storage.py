"""
JSON-based storage system for RUCord
"""
import json
import os
from datetime import datetime
from threading import Lock
import bcrypt

class JSONStorage:
    """Thread-safe JSON storage system"""
    
    def __init__(self, storage_dir='instance'):
        self.storage_dir = storage_dir
        if not os.path.exists(storage_dir):
            os.makedirs(storage_dir, exist_ok=True)
        
        self.locks = {
            'users': Lock(),
            'user_settings': Lock(),
            'servers': Lock(),
            'server_members': Lock(),
            'channels': Lock(),
            'messages': Lock(),
            'friend_requests': Lock(),
            'friendships': Lock(),
            'dm_channels': Lock()
        }
        
        self._init_storage()
    
    def _get_file_path(self, collection):
        return os.path.join(self.storage_dir, f'{collection}.json')
    
    def _init_storage(self):
        """Initialize empty storage files if they don't exist"""
        for collection in self.locks.keys():
            file_path = self._get_file_path(collection)
            if not os.path.exists(file_path):
                self._write_file(collection, [])
    
    def _read_file(self, collection):
        """Read JSON file for a collection"""
        file_path = self._get_file_path(collection)
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return []
    
    def _write_file(self, collection, data):
        """Write JSON file for a collection"""
        file_path = self._get_file_path(collection)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    
    def get_all(self, collection):
        """Get all items from a collection"""
        with self.locks[collection]:
            return self._read_file(collection)
    
    def get_by_id(self, collection, item_id):
        """Get item by ID"""
        items = self.get_all(collection)
        for item in items:
            if item.get('id') == item_id:
                return item
        return None
    
    def get_by_field(self, collection, field, value):
        """Get items by field value"""
        items = self.get_all(collection)
        return [item for item in items if item.get(field) == value]
    
    def get_one_by_field(self, collection, field, value):
        """Get one item by field value"""
        items = self.get_all(collection)
        for item in items:
            if item.get(field) == value:
                return item
        return None
    
    def add(self, collection, item):
        """Add new item to collection"""
        with self.locks[collection]:
            items = self._read_file(collection)
            # Generate ID if not present
            if 'id' not in item:
                max_id = max([i.get('id', 0) for i in items] + [0])
                item['id'] = max_id + 1
            
            # Add timestamps if not present
            if 'created_at' not in item:
                item['created_at'] = datetime.utcnow().isoformat()
            
            items.append(item)
            self._write_file(collection, items)
            return item
    
    def update(self, collection, item_id, updates):
        """Update item in collection"""
        with self.locks[collection]:
            items = self._read_file(collection)
            for i, item in enumerate(items):
                if item.get('id') == item_id:
                    items[i].update(updates)
                    if 'updated_at' not in items[i]:
                        items[i]['updated_at'] = datetime.utcnow().isoformat()
                    self._write_file(collection, items)
                    return items[i]
            return None
    
    def delete(self, collection, item_id):
        """Delete item from collection"""
        with self.locks[collection]:
            items = self._read_file(collection)
            items = [item for item in items if item.get('id') != item_id]
            self._write_file(collection, items)
            return True
    
    def delete_by_field(self, collection, field, value):
        """Delete items by field value"""
        with self.locks[collection]:
            items = self._read_file(collection)
            items = [item for item in items if item.get(field) != value]
            self._write_file(collection, items)
            return True

# Global storage instance
storage = JSONStorage()

# Helper functions for password hashing
def hash_password(password):
    """Hash a password"""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def check_password(password, password_hash):
    """Check if password matches hash"""
    return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))

