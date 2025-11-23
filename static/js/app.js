// Global State
let currentUser = null;
let authToken = null;
let socket = null;
let currentServer = null;
let currentChannel = null;
let currentDMChannel = null;
let servers = [];
let channels = [];
let friends = [];
let friendRequests = { incoming: [], outgoing: [] };
let dmChannels = [];
let isHomeView = true;

// API Base URL
const API_BASE = '';

// Cookie Functions
function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

function deleteCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
}

// Router
function initRouter() {
    const path = window.location.pathname;
    console.log('initRouter called, path:', path);
    
    const landingPage = document.getElementById('landingPage');
    const app = document.getElementById('app');
    const authModal = document.getElementById('authModal');
    
    // Проверяем токен в cookies и localStorage
    authToken = getCookie('authToken') || localStorage.getItem('authToken');
    console.log('authToken found:', !!authToken, authToken ? 'Yes' : 'No');
    
    // Если есть токен в cookies, сохраняем в localStorage для совместимости
    if (!localStorage.getItem('authToken') && authToken) {
        localStorage.setItem('authToken', authToken);
    }
    
    if (path === '/app' || path === '/app/') {
        console.log('Path is /app, checking auth...');
        // Сразу скрываем landing page при переходе на /app
        if (landingPage) landingPage.style.display = 'none';
        if (authModal) authModal.style.display = 'none';
        
        if (authToken) {
            // Есть токен - проверяем авторизацию
            console.log('Token exists, validating...');
            checkAuth().then(() => {
                // После успешной проверки показываем приложение
                console.log('Auth check passed, showing app');
                if (landingPage) landingPage.style.display = 'none';
                if (authModal) authModal.style.display = 'none';
                if (app) app.style.display = 'flex';
                // Loader скроется после полной загрузки через window.load
            }).catch((error) => {
                // Если проверка не прошла - редирект на главную
                console.log('Auth check failed:', error);
                clearAuth();
                window.location.href = '/home';
            });
        } else {
            // Нет токена - редирект на главную
            console.log('No token, redirecting to /home');
            clearAuth();
            window.location.href = '/home';
        }
    } else if (path === '/home' || path === '/' || path === '/home/') {
        console.log('Path is /home or /, checking auth...');
        if (authToken) {
            // Есть токен - сначала проверяем его валидность
            console.log('Token exists on /home, validating...');
            checkAuth().then(() => {
                // Токен валиден - автоматически перенаправляем на /app
                console.log('Token valid, redirecting to /app');
                window.location.href = '/app';
            }).catch((error) => {
                // Токен недействителен - показываем главную страницу
                console.log('Token invalid on /home:', error);
                clearAuth();
                showLandingPage();
                // Loader скроется после полной загрузки через window.load
            });
        } else {
            // Нет токена - показываем главную страницу
            console.log('No token on /home, showing landing page');
            showLandingPage(); // showLandingPage сама скроет loader
        }
    } else {
        // Для любых других путей
        console.log('Unknown path, redirecting...');
        if (authToken) {
            window.location.href = '/app';
        } else {
            window.location.href = '/home';
        }
    }
    
    // Обработка изменения URL (убираем дубликат обработчика)
    if (!window._routerInitialized) {
        window.addEventListener('popstate', () => {
            initRouter();
        });
        window._routerInitialized = true;
    }
}

function showLandingPage() {
    const landingPage = document.getElementById('landingPage');
    const app = document.getElementById('app');
    const authModal = document.getElementById('authModal');
    
    if (landingPage) landingPage.style.display = 'block';
    if (app) app.style.display = 'none';
    if (authModal) authModal.style.display = 'none';
    
    // Loader скроется автоматически после полной загрузки страницы через window.load
    // Убеждаемся, что обработчики событий привязаны к кнопкам
    // Используем setTimeout чтобы дать время DOM обновиться
    setTimeout(() => {
        setupEventListeners();
    }, 50);
}

// Page Loader Functions
let loaderStartTime = null;
let loaderForceHideTimeout = null;
let loaderHideTimeout = null;
let pageLoaded = false;
const MIN_LOADER_TIME = 1000; // Минимальное время показа loader (1 секунда)
const MAX_LOADER_TIME = 5000; // Максимальное время показа loader (5 секунд)

function showPageLoader() {
    const loader = document.getElementById('pageLoader');
    if (loader) {
        console.log('Showing page loader');
        loaderStartTime = Date.now();
        pageLoaded = false;
        loader.classList.remove('hidden');
        loader.style.display = 'flex';
        
        // Очищаем старые таймеры если есть
        if (loaderForceHideTimeout) {
            clearTimeout(loaderForceHideTimeout);
        }
        if (loaderHideTimeout) {
            clearTimeout(loaderHideTimeout);
        }
        
        // ГАРАНТИРОВАННО скрываем loader через MAX_LOADER_TIME (5 секунд) даже если страница не загрузилась
        loaderForceHideTimeout = setTimeout(() => {
            console.log('Force hiding loader after 5 seconds (max time reached)');
            hidePageLoaderNow();
        }, MAX_LOADER_TIME);
    }
}

function hidePageLoader() {
    // Функция вызывается когда страница загрузилась
    // Ждем минимум MIN_LOADER_TIME с момента показа loader
    pageLoaded = true;
    
    if (!loaderStartTime) {
        hidePageLoaderNow();
        return;
    }
    
    const elapsed = Date.now() - loaderStartTime;
    const remaining = Math.max(0, MIN_LOADER_TIME - elapsed);
    
    console.log(`Page loaded. Loader elapsed: ${elapsed}ms, remaining: ${remaining}ms`);
    
    // Очищаем таймер принудительного скрытия, так как страница загрузилась
    if (loaderForceHideTimeout) {
        clearTimeout(loaderForceHideTimeout);
        loaderForceHideTimeout = null;
    }
    
    // Ждем минимум MIN_LOADER_TIME с момента показа
    if (loaderHideTimeout) {
        clearTimeout(loaderHideTimeout);
    }
    
    loaderHideTimeout = setTimeout(() => {
        hidePageLoaderNow();
    }, remaining);
}

function hidePageLoaderNow() {
    const loader = document.getElementById('pageLoader');
    if (!loader) return;
    
    console.log('Hiding page loader now - removing from DOM');
    
    // Очищаем все таймеры
    if (loaderForceHideTimeout) {
        clearTimeout(loaderForceHideTimeout);
        loaderForceHideTimeout = null;
    }
    if (loaderHideTimeout) {
        clearTimeout(loaderHideTimeout);
        loaderHideTimeout = null;
    }
    
    // Удаляем loader из DOM полностью
    loader.classList.add('hidden');
    setTimeout(() => {
        const loaderElement = document.getElementById('pageLoader');
        if (loaderElement && loaderElement.parentNode) {
            loaderElement.remove(); // Удаляем элемент из DOM
            console.log('Page loader removed from DOM');
        }
        loaderStartTime = null;
        pageLoaded = false;
    }, 300); // Ждем завершения transition перед удалением
}

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded fired');
    
    // Показываем loader при загрузке
    showPageLoader();
    
    // Сразу проверяем путь и скрываем/показываем нужные элементы
    const path = window.location.pathname;
    const landingPage = document.getElementById('landingPage');
    const app = document.getElementById('app');
    
    // Если путь не /home и не /app, редиректим на /home
    if (path !== '/home' && path !== '/home/' && path !== '/app' && path !== '/app/' && path !== '/') {
        console.log('Unknown path, redirecting to /home');
        window.location.href = '/home';
        return;
    }
    
    // Если путь "/", редиректим на /home
    if (path === '/') {
        console.log('Root path, redirecting to /home');
        window.location.href = '/home';
        return;
    }
    
    // Если мы на /app, сразу скрываем landing page (даже до проверки токена)
    if (path === '/app' || path === '/app/') {
        console.log('On /app, hiding landing page immediately');
        if (landingPage) landingPage.style.display = 'none';
        if (app) app.style.display = 'flex'; // Показываем app, даже если потом перенаправим
    } else {
        // Если мы на /home, показываем landing page
        if (landingPage) landingPage.style.display = 'block';
        if (app) app.style.display = 'none';
    }
    
    // Настраиваем обработчики событий
    setupEventListeners();
    
    // Затем инициализируем роутер (с небольшой задержкой, чтобы обработчики успели привязаться)
    setTimeout(() => {
        initRouter();
    }, 100);
});

// Ждем полной загрузки страницы (все ресурсы загружены)
window.addEventListener('load', () => {
    console.log('Page fully loaded, hiding loader');
    // Скрываем loader после полной загрузки (с учетом минимального времени)
    hidePageLoader();
});

// Event Listeners Setup
let eventListenersSetup = false;
function setupEventListeners() {
    // Если обработчики уже были добавлены, пропускаем
    if (eventListenersSetup) {
        return;
    }
    
    // Landing page buttons - ОБЯЗАТЕЛЬНО добавляем обработчики
    const openLoginBtn = document.getElementById('openLoginBtn');
    if (openLoginBtn) {
        openLoginBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Open login button clicked');
            showAuthModal('login');
        });
    }
    
    const openRegisterBtn = document.getElementById('openRegisterBtn');
    if (openRegisterBtn) {
        openRegisterBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Open register button clicked');
            showAuthModal('register');
        });
    }
    
    const heroDownloadBtn = document.getElementById('heroDownloadBtn');
    if (heroDownloadBtn) {
        heroDownloadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Hero download button clicked');
            showAuthModal('register');
        });
    }
    
    const heroOpenBrowserBtn = document.getElementById('heroOpenBrowserBtn');
    if (heroOpenBrowserBtn) {
        heroOpenBrowserBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Hero open browser button clicked');
            showAuthModal('login');
        });
    }
    
    eventListenersSetup = true;
    
    // Auth modal switches
    if (document.getElementById('switchToRegister')) {
        document.getElementById('switchToRegister').addEventListener('click', (e) => {
            e.preventDefault();
            switchAuthForm('register');
        });
    }
    if (document.getElementById('switchToLogin')) {
        document.getElementById('switchToLogin').addEventListener('click', (e) => {
            e.preventDefault();
            switchAuthForm('login');
        });
    }
    if (document.getElementById('closeAuthModal')) {
        document.getElementById('closeAuthModal').addEventListener('click', () => {
            hideAuthModal();
        });
    }
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.dataset.tab;
            switchTab(tab);
        });
    });
    
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
    
    document.getElementById('addServerBtn').addEventListener('click', () => {
        document.getElementById('createServerModal').style.display = 'flex';
    });
    
    document.getElementById('createServerForm').addEventListener('submit', handleCreateServer);
    document.getElementById('cancelServerBtn').addEventListener('click', () => {
        document.getElementById('createServerModal').style.display = 'none';
    });
    
    document.getElementById('createChannelForm').addEventListener('submit', handleCreateChannel);
    document.getElementById('cancelChannelBtn').addEventListener('click', () => {
        document.getElementById('createChannelModal').style.display = 'none';
    });
    
    document.getElementById('messageForm').addEventListener('submit', handleSendMessage);
    
    // Call buttons - устанавливаем обработчики с проверкой
    const callBtn = document.getElementById('callBtn');
    if (callBtn) {
        console.log('[CALL] Call button found, setting up event listener');
        callBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[CALL] Call button clicked');
            console.log('[CALL] currentDMChannel:', currentDMChannel);
            if (currentDMChannel && currentDMChannel.other_user) {
                console.log('[CALL] Starting audio call to:', currentDMChannel.other_user.id);
                startCall(currentDMChannel.other_user.id, 'audio');
            } else {
                console.warn('[CALL] Cannot start call: no currentDMChannel or other_user');
                console.warn('[CALL] currentDMChannel:', currentDMChannel);
                alert('Откройте диалог с пользователем для звонка');
            }
        });
    } else {
        console.warn('[CALL] Call button not found in DOM');
    }
    
    const videoCallBtn = document.getElementById('videoCallBtn');
    if (videoCallBtn) {
        console.log('[CALL] Video call button found, setting up event listener');
        videoCallBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[CALL] Video call button clicked');
            console.log('[CALL] currentDMChannel:', currentDMChannel);
            if (currentDMChannel && currentDMChannel.other_user) {
                console.log('[CALL] Starting video call to:', currentDMChannel.other_user.id);
                startCall(currentDMChannel.other_user.id, 'video');
            } else {
                console.warn('[CALL] Cannot start call: no currentDMChannel or other_user');
                console.warn('[CALL] currentDMChannel:', currentDMChannel);
                alert('Откройте диалог с пользователем для звонка');
            }
        });
    } else {
        console.warn('[CALL] Video call button not found in DOM');
    }
    
    document.querySelector('.home-server').addEventListener('click', showHomeView);
    
    // Friends tabs (Discord-style)
    document.querySelectorAll('.friends-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.currentTarget.dataset.tab;
            switchFriendsTab(tab);
        });
    });
    
    // Old sidebar tabs (for backward compatibility)
    document.querySelectorAll('.sidebar-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const view = e.target.dataset.view;
            switchSidebarView(view);
        });
    });
    
    // Add friend button (из левой панели)
    const addFriendBtn = document.getElementById('addFriendBtn');
    if (addFriendBtn) {
        addFriendBtn.addEventListener('click', () => {
            document.getElementById('addFriendModal').style.display = 'flex';
        });
    }
    
    // Add friend button (из панели "Активные контакты")
    const addFriendBtnFromContacts = document.getElementById('addFriendBtnFromContacts');
    if (addFriendBtnFromContacts) {
        addFriendBtnFromContacts.addEventListener('click', () => {
            document.getElementById('addFriendModal').style.display = 'flex';
        });
    }
    
    document.getElementById('addFriendForm').addEventListener('submit', handleAddFriend);
    document.getElementById('cancelFriendBtn').addEventListener('click', () => {
        document.getElementById('addFriendModal').style.display = 'none';
    });
    
    const friendInput = document.getElementById('friendUsernameInput');
    friendInput.addEventListener('input', debounce(handleFriendSearch, 300));
    
    document.querySelectorAll('#friendRequestsTabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.dataset.tab;
            switchFriendRequestsTab(tab);
        });
    });
    document.getElementById('closeRequestsBtn').addEventListener('click', () => {
        document.getElementById('friendRequestsModal').style.display = 'none';
    });
    
    // Settings
    if (document.getElementById('userMenuBtn')) {
        document.getElementById('userMenuBtn').addEventListener('click', () => {
            document.getElementById('settingsModal').style.display = 'flex';
            loadSettings();
        });
    }
    
    // Settings navigation
    document.querySelectorAll('.settings-nav-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.currentTarget.dataset.tab;
            switchSettingsTab(tab);
        });
    });
    
    // Settings old tabs (for backward compatibility)
    document.querySelectorAll('.settings-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.dataset.tab;
            switchSettingsTab(tab);
        });
    });
    
    if (document.getElementById('saveSettingsBtn')) {
        document.getElementById('saveSettingsBtn').addEventListener('click', handleSaveSettings);
    }
    
    if (document.getElementById('closeSettingsBtn')) {
        document.getElementById('closeSettingsBtn').addEventListener('click', () => {
            document.getElementById('settingsModal').style.display = 'none';
        });
    }
    
    if (document.getElementById('closeSettingsBackdrop')) {
        document.getElementById('closeSettingsBackdrop').addEventListener('click', () => {
            document.getElementById('settingsModal').style.display = 'none';
        });
    }
    
    document.getElementById('membersToggleBtn').addEventListener('click', toggleMembersSidebar);
    document.getElementById('closeMembersBtn').addEventListener('click', toggleMembersSidebar);
    
    // Close auth modal on backdrop click
    const authModalBackdrop = document.querySelector('.auth-modal-backdrop');
    if (authModalBackdrop) {
        authModalBackdrop.addEventListener('click', () => {
            hideAuthModal();
        });
    }
    
    window.addEventListener('click', (e) => {
        const modals = ['createServerModal', 'createChannelModal', 'addFriendModal', 'friendRequestsModal', 'settingsModal'];
        modals.forEach(modalId => {
            const modal = document.getElementById(modalId);
            if (e.target === modal) modal.style.display = 'none';
        });
    });
}

// Tab Switching
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(`${tab}Form`).classList.add('active');
    document.getElementById('loginError').classList.remove('show');
    document.getElementById('registerError').classList.remove('show');
}

function switchAuthForm(form) {
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    
    const authModal = document.getElementById('authModal');
    const authTitle = authModal?.querySelector('.auth-title');
    const authSubtitle = authModal?.querySelector('.auth-subtitle');
    
    if (form === 'login') {
        document.getElementById('loginForm').classList.add('active');
        if (authTitle) authTitle.textContent = 'Добро пожаловать обратно!';
        if (authSubtitle) authSubtitle.textContent = 'Мы так рады снова вас видеть!';
    } else {
        document.getElementById('registerForm').classList.add('active');
        if (authTitle) authTitle.textContent = 'Создать аккаунт';
        if (authSubtitle) authSubtitle.textContent = '';
    }
    
    const loginError = document.getElementById('loginError');
    const registerError = document.getElementById('registerError');
    if (loginError) loginError.classList.remove('show');
    if (registerError) registerError.classList.remove('show');
}

function initializeDateSelectors() {
    // Генерация дней
    const daySelect = document.getElementById('registerDay');
    if (daySelect) {
        for (let i = 1; i <= 31; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            daySelect.appendChild(option);
        }
    }
    
    // Генерация месяцев
    const monthSelect = document.getElementById('registerMonth');
    if (monthSelect) {
        const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                       'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
        months.forEach((month, index) => {
            const option = document.createElement('option');
            option.value = index + 1;
            option.textContent = month;
            monthSelect.appendChild(option);
        });
    }
    
    // Генерация лет
    const yearSelect = document.getElementById('registerYear');
    if (yearSelect) {
        const currentYear = new Date().getFullYear();
        for (let i = currentYear; i >= currentYear - 100; i--) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            yearSelect.appendChild(option);
        }
    }
}

// Authentication
async function checkAuth() {
    console.log('checkAuth called');
    if (!authToken) {
        // Нет токена - выбрасываем ошибку
        console.error('checkAuth: No auth token');
        throw new Error('No auth token');
    }
    
    try {
        console.log('checkAuth: Fetching /api/me with token');
        const response = await fetch(`${API_BASE}/api/me`, {
            headers: { 'Authorization': `Bearer ${authToken}` },
            credentials: 'include' // Включаем cookies
        });
        
        console.log('checkAuth: Response status:', response.status);
        
        if (response.ok) {
            currentUser = await response.json();
            console.log('checkAuth: User authenticated:', currentUser.username);
            
            // Показываем приложение
            const landingPage = document.getElementById('landingPage');
            const authModal = document.getElementById('authModal');
            const app = document.getElementById('app');
            
            if (landingPage) landingPage.style.display = 'none';
            if (authModal) authModal.style.display = 'none';
            if (app) app.style.display = 'flex';
            
            // Загружаем данные
            showApp();
            showHomeView();
            
            // Загружаем данные асинхронно (не ждем их завершения, loader скроется в initRouter)
            loadServers();
            loadFriends();
            loadDMChannels();
            loadFriendRequests();
            initSocket();
            
            // Убеждаемся, что все модальные окна скрыты
            hideAllModals();
            
            // Loader скроется автоматически после полной загрузки страницы через window.load
            // или через принудительное скрытие через 5 секунд максимум
            
            return true;
        } else {
            // Токен недействителен - выбрасываем ошибку
            const errorText = await response.text();
            console.error('checkAuth: Invalid token, response:', response.status, errorText);
            throw new Error('Invalid token');
        }
    } catch (error) {
        console.error('checkAuth: Error occurred:', error);
        throw error;
    }
}

function clearAuth() {
    authToken = null;
    currentUser = null;
    deleteCookie('authToken');
    localStorage.removeItem('authToken');
}

function hideAllModals() {
    const modals = ['createServerModal', 'createChannelModal', 'addFriendModal', 'friendRequestsModal', 'settingsModal', 'authModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
    });
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    
    if (!username || !password) {
        errorDiv.textContent = 'Пожалуйста, заполните все поля';
        errorDiv.classList.add('show');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.token;
            currentUser = data.user;
            
            // Сохраняем токен в cookies (30 дней) и localStorage
            setCookie('authToken', authToken, 30);
            localStorage.setItem('authToken', authToken);
            
            // Редирект на /app и показываем приложение
            window.location.href = '/app';
        } else {
            errorDiv.textContent = data.error || 'Неверное имя пользователя или пароль';
            errorDiv.classList.add('show');
        }
    } catch (error) {
        console.error('Login error:', error);
        errorDiv.textContent = 'Ошибка подключения к серверу';
        errorDiv.classList.add('show');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const errorDiv = document.getElementById('registerError');
    
    // Валидация
    if (!username || !email || !password) {
        errorDiv.textContent = 'Пожалуйста, заполните все поля';
        errorDiv.classList.add('show');
        return;
    }
    
    if (username.length < 3) {
        errorDiv.textContent = 'Имя пользователя должно быть не менее 3 символов';
        errorDiv.classList.add('show');
        return;
    }
    
    if (password.length < 6) {
        errorDiv.textContent = 'Пароль должен быть не менее 6 символов';
        errorDiv.classList.add('show');
        return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        errorDiv.textContent = 'Пожалуйста, введите корректный email';
        errorDiv.classList.add('show');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.token;
            currentUser = data.user;
            
            // Сохраняем токен в cookies (30 дней) и localStorage
            setCookie('authToken', authToken, 30);
            localStorage.setItem('authToken', authToken);
            
            // Редирект на /app после успешной регистрации
            window.location.href = '/app';
        } else {
            errorDiv.textContent = data.error || 'Ошибка регистрации';
            errorDiv.classList.add('show');
        }
    } catch (error) {
        console.error('Register error:', error);
        errorDiv.textContent = 'Ошибка подключения к серверу';
        errorDiv.classList.add('show');
    }
}

// UI Functions
function showAuthModal(form = 'login') {
    const landingPage = document.getElementById('landingPage');
    const authModal = document.getElementById('authModal');
    const app = document.getElementById('app');
    
    if (landingPage) landingPage.style.display = 'none';
    if (authModal) {
        authModal.style.display = 'flex';
        switchAuthForm(form);
    }
    if (app) app.style.display = 'none';
}

function hideAuthModal() {
    const landingPage = document.getElementById('landingPage');
    const authModal = document.getElementById('authModal');
    if (authModal) authModal.style.display = 'none';
    if (landingPage) landingPage.style.display = 'block';
}

function showApp() {
    // Обновляем URL без перезагрузки страницы
    if (window.location.pathname !== '/app') {
        window.history.pushState({}, '', '/app');
    }
    
    const landingPage = document.getElementById('landingPage');
    const authModal = document.getElementById('authModal');
    const app = document.getElementById('app');
    
    if (landingPage) landingPage.style.display = 'none';
    if (authModal) authModal.style.display = 'none';
    if (app) app.style.display = 'flex';
    
    // Показываем главный вид друзей
    showFriendsMainView();
    
    if (currentUser) {
        const userName = document.getElementById('userName');
        const userInitial = document.getElementById('userInitial');
        const userId = document.getElementById('userId');
        
        if (userName) userName.textContent = currentUser.username;
        if (userInitial) userInitial.textContent = currentUser.username[0].toUpperCase();
        if (userId) userId.textContent = `#${String(currentUser.id).padStart(4, '0')}`;
        
        updateUserStatus(currentUser.status || 'online');
        
        // Обновляем статус на сервере
        if (!currentUser.status || currentUser.status === 'offline') {
            updateUserStatusOnServer('online');
        }
    }
}

function showFriendsMainView() {
    const friendsMainView = document.getElementById('friendsMainView');
    const chatView = document.getElementById('chatView');
    const activeContactsSidebar = document.getElementById('activeContactsSidebar');
    
    if (friendsMainView) friendsMainView.style.display = 'block';
    if (chatView) chatView.style.display = 'none';
    if (activeContactsSidebar) activeContactsSidebar.style.display = 'block';
    
    // Показываем вкладку "Друзья" по умолчанию
    switchFriendsTab('friends');
}

function switchFriendsTab(tab) {
    // Убираем активность со всех вкладок
    document.querySelectorAll('.friends-tab').forEach(btn => btn.classList.remove('active'));
    const activeTab = document.querySelector(`.friends-tab[data-tab="${tab}"]`);
    if (activeTab) activeTab.classList.add('active');
    
    // Скрываем все содержимое вкладок
    document.querySelectorAll('.friends-tab-content').forEach(content => content.classList.remove('active'));
    
    // Показываем нужную вкладку
    const tabContentMap = {
        'friends': 'friendsTabContent',
        'online': 'onlineTabContent',
        'all': 'allTabContent',
        'pending': 'pendingTabContent'
    };
    
    const contentId = tabContentMap[tab];
    if (contentId) {
        const content = document.getElementById(contentId);
        if (content) content.classList.add('active');
        
        // Загружаем данные если нужно
        if (tab === 'friends' || tab === 'online' || tab === 'all') {
            renderFriendsList(tab);
        } else if (tab === 'pending') {
            renderFriendRequests();
        }
    }
}

function renderFriendsList(tab = 'friends') {
    if (!friends || friends.length === 0) {
        // Показываем пустое состояние в зависимости от вкладки
        if (tab === 'online') {
            const list = document.getElementById('friendsOnlineMainList');
            if (list) list.innerHTML = '<p class="empty-state">Нет друзей в сети</p>';
        } else if (tab === 'all') {
            const list = document.getElementById('friendsAllList');
            if (list) list.innerHTML = '<p class="empty-state">Нет друзей</p>';
        } else {
            const onlineList = document.getElementById('friendsOnlineMainList');
            const offlineList = document.getElementById('friendsOfflineMainList');
            if (onlineList) onlineList.innerHTML = '<p class="empty-state">Нет друзей в сети</p>';
            if (offlineList) offlineList.innerHTML = '<p class="empty-state">Нет друзей</p>';
        }
        return;
    }
    
    const onlineFriends = friends.filter(f => f.status === 'online');
    const offlineFriends = friends.filter(f => !f.status || f.status !== 'online');
    const allFriends = friends;
    
    // Обновляем счетчики
    const onlineCount = document.getElementById('friendsOnlineCount');
    const offlineCount = document.getElementById('friendsOfflineCount');
    if (onlineCount) onlineCount.textContent = onlineFriends.length;
    if (offlineCount) offlineCount.textContent = offlineFriends.length;
    
    // Рендерим в зависимости от вкладки
    if (tab === 'friends') {
        // Вкладка "Друзья" - показывает разделенные списки онлайн/оффлайн
        renderFriendsMainList(onlineFriends, offlineFriends);
    } else if (tab === 'online') {
        // Вкладка "В сети" - показывает только онлайн друзей
        renderOnlineFriendsListForTab(onlineFriends);
    } else if (tab === 'all') {
        // Вкладка "Все" - показывает всех друзей в одном списке
        renderAllFriendsList(allFriends);
    }
    
    // Обновляем активные контакты
    renderActiveContacts(onlineFriends.filter(f => f.status_message || f.status === 'online'));
}

function renderAllFriendsList(allFriends) {
    const list = document.getElementById('friendsAllList');
    if (!list) return;
    
    list.innerHTML = '';
    
    if (allFriends.length === 0) {
        list.innerHTML = '<p class="empty-state">Нет друзей</p>';
        return;
    }
    
    // Сортируем: сначала онлайн, потом оффлайн
    const sortedFriends = [...allFriends].sort((a, b) => {
        const aOnline = a.status === 'online' ? 1 : 0;
        const bOnline = b.status === 'online' ? 1 : 0;
        return bOnline - aOnline;
    });
    
    sortedFriends.forEach(friend => {
        const item = createFriendItemMain(friend);
        list.appendChild(item);
    });
}

function renderFriendsMainList(onlineFriends, offlineFriends) {
    const onlineList = document.getElementById('friendsOnlineMainList');
    const offlineList = document.getElementById('friendsOfflineMainList');
    const onlineSection = document.getElementById('friendsOnlineSection');
    const offlineSection = document.getElementById('friendsOfflineSection');
    
    // Показываем секции
    if (onlineSection) onlineSection.style.display = 'block';
    if (offlineSection) offlineSection.style.display = 'block';
    
    if (onlineList) {
        onlineList.innerHTML = '';
        if (onlineFriends.length === 0) {
            onlineList.innerHTML = '<p class="empty-state">Нет друзей в сети</p>';
        } else {
            onlineFriends.forEach(friend => {
                const item = createFriendItemMain(friend);
                onlineList.appendChild(item);
            });
        }
    }
    
    if (offlineList) {
        offlineList.innerHTML = '';
        if (offlineFriends.length === 0) {
            offlineList.innerHTML = '<p class="empty-state">Нет друзей</p>';
        } else {
            offlineFriends.forEach(friend => {
                const item = createFriendItemMain(friend);
                offlineList.appendChild(item);
            });
        }
    }
}

function renderOnlineFriendsList(onlineFriends) {
    // Рендерим для основной панели друзей (вкладка "Друзья")
    const list = document.getElementById('friendsOnlineMainList');
    if (!list) return;
    
    list.innerHTML = '';
    
    if (onlineFriends.length === 0) {
        list.innerHTML = '<p class="empty-state">Нет друзей в сети</p>';
        return;
    }
    
    onlineFriends.forEach(friend => {
        const item = createFriendItemMain(friend);
        list.appendChild(item);
    });
}

function renderOnlineFriendsListForTab(onlineFriends) {
    // Рендерим для вкладки "В сети" - используем контейнер внутри onlineTabContent
    const list = document.getElementById('friendsOnlineList');
    if (!list) {
        console.error('friendsOnlineList not found for online tab');
        return;
    }
    
    list.innerHTML = '';
    
    if (onlineFriends.length === 0) {
        list.innerHTML = '<p class="empty-state">Нет друзей в сети</p>';
        return;
    }
    
    onlineFriends.forEach(friend => {
        const item = createFriendItemMain(friend);
        list.appendChild(item);
    });
}

function createFriendItemMain(friend) {
    const item = document.createElement('div');
    item.className = 'friend-item-main';
    
    const avatar = document.createElement('div');
    avatar.className = 'friend-avatar';
    avatar.textContent = friend.username[0].toUpperCase();
    
    const statusIndicator = document.createElement('div');
    statusIndicator.className = `status-indicator ${friend.status || 'offline'}`;
    avatar.appendChild(statusIndicator);
    
    const info = document.createElement('div');
    info.className = 'friend-info';
    
    const name = document.createElement('div');
    name.className = 'friend-name';
    name.textContent = friend.username;
    
    const status = document.createElement('div');
    status.className = 'friend-status';
    status.textContent = friend.status_message || (friend.status === 'online' ? 'В сети' : 'Не в сети');
    
    info.appendChild(name);
    info.appendChild(status);
    
    const actions = document.createElement('div');
    actions.className = 'friend-item-actions';
    
    const messageBtn = document.createElement('button');
    messageBtn.className = 'friend-item-action-btn';
    messageBtn.title = 'Написать';
    messageBtn.innerHTML = '💬';
    messageBtn.onclick = (e) => {
        e.stopPropagation();
        openDMWithFriend(friend);
    };
    
    const callBtn = document.createElement('button');
    callBtn.className = 'friend-item-action-btn';
    callBtn.title = 'Аудио звонок';
    callBtn.innerHTML = '📞';
    callBtn.onclick = (e) => {
        e.stopPropagation();
        console.log('[CALL] Friend list call button clicked for user:', friend.id);
        startCall(friend.id, 'audio');
    };
    
    const videoBtn = document.createElement('button');
    videoBtn.className = 'friend-item-action-btn';
    videoBtn.title = 'Видеозвонок';
    videoBtn.innerHTML = '📹';
    videoBtn.onclick = (e) => {
        e.stopPropagation();
        console.log('[CALL] Friend list video call button clicked for user:', friend.id);
        startCall(friend.id, 'video');
    };
    
    const menuBtn = document.createElement('button');
    menuBtn.className = 'friend-item-action-btn';
    menuBtn.title = 'Еще';
    menuBtn.innerHTML = '⋮';
    menuBtn.onclick = (e) => {
        e.stopPropagation();
        // Можно добавить меню действий
    };
    
    actions.appendChild(messageBtn);
    actions.appendChild(callBtn);
    actions.appendChild(videoBtn);
    actions.appendChild(menuBtn);
    
    item.appendChild(avatar);
    item.appendChild(info);
    item.appendChild(actions);
    
    // Обработчик клика на элемент для открытия DM
    item.addEventListener('click', () => {
        if (typeof openDMWithFriend === 'function') {
            openDMWithFriend(friend);
        }
    });
    
    return item;
}

function renderActiveContacts(activeFriends) {
    const list = document.getElementById('activeContactsList');
    if (!list) return;
    
    list.innerHTML = '';
    
    if (activeFriends.length === 0) {
        list.innerHTML = '<p class="empty-state">Нет активных контактов</p>';
        return;
    }
    
    activeFriends.forEach(friend => {
        const item = createActiveContactItem(friend);
        list.appendChild(item);
    });
}

function createActiveContactItem(friend) {
    const item = document.createElement('div');
    item.className = 'active-contact-item';
    
    const header = document.createElement('div');
    header.className = 'active-contact-header';
    
    const avatar = document.createElement('div');
    avatar.className = 'friend-avatar';
    avatar.textContent = friend.username[0].toUpperCase();
    
    const statusIndicator = document.createElement('div');
    statusIndicator.className = `status-indicator ${friend.status || 'offline'}`;
    avatar.appendChild(statusIndicator);
    
    const name = document.createElement('div');
    name.className = 'friend-name';
    name.textContent = friend.username;
    
    const activity = document.createElement('div');
    activity.className = 'active-contact-activity';
    
    const activityIcon = document.createElement('div');
    activityIcon.className = 'active-contact-activity-icon';
    activityIcon.style.background = friend.status === 'online' ? '#43b581' : '#747f8d';
    
    const activityText = document.createElement('div');
    activityText.className = 'active-contact-activity-text';
    activityText.textContent = friend.status_message || 'В сети';
    
    const activityTime = document.createElement('div');
    activityTime.className = 'active-contact-activity-text';
    activityTime.style.fontSize = '11px';
    activityTime.textContent = 'Прошло 0:00';
    
    activity.appendChild(activityIcon);
    activity.appendChild(activityText);
    
    header.appendChild(avatar);
    header.appendChild(name);
    
    item.appendChild(header);
    item.appendChild(activity);
    item.appendChild(activityTime);
    
    return item;
}

function showHomeView() {
    isHomeView = true;
    currentServer = null;
    currentChannel = null;
    currentDMChannel = null;
    
    document.getElementById('homeView').classList.add('active');
    document.getElementById('serverView').classList.remove('active');
    
    document.getElementById('channelName').textContent = 'Главная';
    document.getElementById('channelIcon').textContent = '🏠';
    document.getElementById('messagesContainer').innerHTML = '<div class="empty-state"><h2>Добро пожаловать в RUCord!</h2><p>Выберите друга или канал, чтобы начать общение</p></div>';
    document.getElementById('messageInputContainer').style.display = 'none';
    
    document.querySelectorAll('.server-icon').forEach(icon => {
        if (icon.classList.contains('home-server')) {
            icon.classList.add('active');
        } else {
            icon.classList.remove('active');
        }
    });
}

function switchSidebarView(view) {
    // Безопасное переключение вкладок
    const tabs = document.querySelectorAll('.sidebar-tab');
    tabs.forEach(btn => {
        if (btn) btn.classList.remove('active');
    });
    
    const targetTab = document.querySelector(`[data-view="${view}"]`);
    if (targetTab) {
        targetTab.classList.add('active');
    } else {
        console.warn(`Tab with data-view="${view}" not found`);
    }
    
    const friendsList = document.getElementById('friendsList');
    const dmList = document.getElementById('dmList');
    
    if (view === 'friends') {
        if (friendsList) friendsList.style.display = 'block';
        if (dmList) dmList.style.display = 'none';
    } else {
        if (friendsList) friendsList.style.display = 'none';
        if (dmList) dmList.style.display = 'block';
    }
}

function toggleMembersSidebar() {
    const sidebar = document.getElementById('membersSidebar');
    sidebar.style.display = sidebar.style.display === 'none' ? 'flex' : 'none';
}

function updateUserStatus(status) {
    const indicator = document.getElementById('userStatusIndicator');
    indicator.className = 'status-indicator';
    indicator.classList.add(status || 'offline');
}

async function updateUserStatusOnServer(status) {
    try {
        await fetch(`${API_BASE}/api/me/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ status })
        });
    } catch (error) {
        console.error('Failed to update status:', error);
    }
}

// Servers
async function loadServers() {
    try {
        const response = await fetch(`${API_BASE}/api/servers`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            servers = await response.json();
            renderServers();
        }
    } catch (error) {
        console.error('Failed to load servers:', error);
    }
}

function renderServers() {
    const serversList = document.getElementById('serversList');
    serversList.innerHTML = '';
    
    servers.forEach(server => {
        const serverIcon = document.createElement('button');
        serverIcon.className = 'server-icon';
        serverIcon.title = server.name;
        serverIcon.textContent = server.name[0].toUpperCase();
        serverIcon.onclick = () => selectServer(server);
        
        if (currentServer && currentServer.id === server.id) {
            serverIcon.classList.add('active');
        }
        
        serversList.appendChild(serverIcon);
    });
}

async function selectServer(server) {
    currentServer = server;
    currentChannel = null;
    currentDMChannel = null;
    isHomeView = false;
    
    document.getElementById('homeView').classList.remove('active');
    document.getElementById('serverView').classList.add('active');
    
    document.getElementById('serverName').textContent = server.name;
    document.getElementById('channelName').textContent = '# выберите канал';
    document.getElementById('channelIcon').textContent = '#';
    document.getElementById('messagesContainer').innerHTML = '<div class="empty-state"><h2>Выберите канал</h2></div>';
    document.getElementById('messageInputContainer').style.display = 'none';
    
    renderServers();
    loadChannels();
}

async function handleCreateServer(e) {
    e.preventDefault();
    const name = document.getElementById('serverNameInput').value;
    const errorDiv = document.getElementById('serverError');
    
    try {
        const response = await fetch(`${API_BASE}/api/servers`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            document.getElementById('createServerModal').style.display = 'none';
            document.getElementById('serverNameInput').value = '';
            loadServers();
            selectServer(data);
        } else {
            errorDiv.textContent = data.error || 'Ошибка создания сервера';
            errorDiv.classList.add('show');
        }
    } catch (error) {
        errorDiv.textContent = 'Ошибка подключения к серверу';
        errorDiv.classList.add('show');
    }
}

// Channels
async function loadChannels() {
    if (!currentServer) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/servers/${currentServer.id}/channels`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            channels = await response.json();
            renderChannels();
        }
    } catch (error) {
        console.error('Failed to load channels:', error);
    }
}

function renderChannels() {
    const channelsList = document.getElementById('channelsList');
    channelsList.innerHTML = '';
    
    if (channels.length === 0) {
        channelsList.innerHTML = '<p class="empty-state">Нет каналов</p>';
        return;
    }
    
    const header = document.createElement('div');
    header.className = 'channel-header-section';
    header.innerHTML = '<h3>ТЕКСТОВЫЕ КАНАЛЫ</h3>';
    channelsList.appendChild(header);
    
    channels.forEach(channel => {
        const channelItem = document.createElement('div');
        channelItem.className = 'channel-item';
        if (currentChannel && currentChannel.id === channel.id) {
            channelItem.classList.add('active');
        }
        channelItem.textContent = channel.name;
        channelItem.onclick = () => selectChannel(channel);
        channelsList.appendChild(channelItem);
    });
    
    if (currentServer && currentServer.owner_id === currentUser.id) {
        const createBtn = document.createElement('button');
        createBtn.className = 'channel-item';
        createBtn.style.background = 'transparent';
        createBtn.style.color = 'var(--discord-text-muted)';
        createBtn.innerHTML = '+ Создать канал';
        createBtn.onclick = () => {
            document.getElementById('createChannelModal').style.display = 'flex';
        };
        channelsList.appendChild(createBtn);
    }
}

async function selectChannel(channel) {
    currentChannel = channel;
    currentDMChannel = null;
    isHomeView = false;
    
    document.getElementById('channelName').textContent = `# ${channel.name}`;
    document.getElementById('channelIcon').textContent = '#';
    document.getElementById('messageInputContainer').style.display = 'block';
    
    renderChannels();
    loadMessages();
    
    if (socket) {
        socket.emit('join_channel', { channel_id: channel.id });
    }
}

async function handleCreateChannel(e) {
    e.preventDefault();
    if (!currentServer) return;
    
    const name = document.getElementById('channelNameInput').value;
    const type = document.getElementById('channelTypeInput').value;
    const errorDiv = document.getElementById('channelError');
    
    try {
        const response = await fetch(`${API_BASE}/api/servers/${currentServer.id}/channels`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name, type })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            document.getElementById('createChannelModal').style.display = 'none';
            document.getElementById('channelNameInput').value = '';
            loadChannels();
            selectChannel(data);
        } else {
            errorDiv.textContent = data.error || 'Ошибка создания канала';
            errorDiv.classList.add('show');
        }
    } catch (error) {
        errorDiv.textContent = 'Ошибка подключения к серверу';
        errorDiv.classList.add('show');
    }
}

// Messages
async function loadMessages() {
    if (currentChannel) {
        try {
            const response = await fetch(`${API_BASE}/api/channels/${currentChannel.id}/messages`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            
            if (response.ok) {
                const messages = await response.json();
                renderMessages(messages);
            }
        } catch (error) {
            console.error('Failed to load messages:', error);
        }
    }
}

function renderMessages(messages) {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    
    if (messages.length === 0) {
        const channelName = currentChannel ? '#' + currentChannel.name : (currentDMChannel ? currentDMChannel.other_user.username : 'канал');
        container.innerHTML = '<div class="empty-state"><h2>Начните разговор!</h2><p>Это начало ' + channelName + '</p></div>';
        return;
    }
    
    let lastAuthorId = null;
    
    messages.forEach(message => {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';
        
        const showAvatar = lastAuthorId !== message.user_id;
        lastAuthorId = message.user_id;
        
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        if (showAvatar) {
            avatar.textContent = message.user.username[0].toUpperCase();
            avatar.classList.remove('hidden-avatar');
        } else {
            avatar.style.width = '0';
            avatar.style.visibility = 'hidden';
            avatar.classList.add('hidden-avatar');
        }
        
        const content = document.createElement('div');
        content.className = 'message-content';
        
        const header = document.createElement('div');
        header.className = 'message-header';
        
        if (showAvatar) {
            const author = document.createElement('span');
            author.className = 'message-author';
            author.textContent = message.user.username;
            header.appendChild(author);
        }
        
    // Timestamp already added above
        
        const text = document.createElement('div');
        text.className = 'message-text';
        text.textContent = message.content;
        
        content.appendChild(header);
        content.appendChild(text);
        
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content);
        container.appendChild(messageDiv);
    });
    
    container.scrollTop = container.scrollHeight;
}

async function handleSendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('messageInput');
    if (!input) {
        console.error('messageInput not found');
        return;
    }
    
    const content = input.value.trim();
    
    if (!content) return;
    
    const channelId = currentChannel?.id;
    const dmChannelId = currentDMChannel?.id;
    
    if (!channelId && !dmChannelId) {
        console.error('No channel or DM channel selected. currentChannel:', currentChannel, 'currentDMChannel:', currentDMChannel);
        return;
    }
    
    try {
        const url = channelId 
            ? `${API_BASE}/api/channels/${channelId}/messages`
            : `${API_BASE}/api/dm-channels/${dmChannelId}/messages`;
        
        console.log('Sending message to:', url, 'content:', content);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ content })
        });
        
        if (response.ok) {
            input.value = '';
            const message = await response.json();
            console.log('Message sent successfully:', message);
            
            // Добавляем сообщение в UI сразу
            addMessageToView(message);
        } else {
            const data = await response.json();
            console.error('Failed to send message:', data.error);
            alert('Ошибка отправки сообщения: ' + (data.error || 'Неизвестная ошибка'));
        }
    } catch (error) {
        console.error('Failed to send message:', error);
        alert('Ошибка отправки сообщения: ' + error.message);
    }
}

function formatTimestamp(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) {
        return 'сейчас';
    } else if (diff < 3600000) {
        return Math.floor(diff / 60000) + ' мин. назад';
    } else if (diff < 86400000) {
        return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } else {
        return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    }
}

function addMessageToView(message) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) {
        container.innerHTML = '';
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    // Определяем текущего автора
    const currentAuthor = message.user?.username || message.user_name || 'Неизвестно';
    const currentTime = new Date(message.created_at || message.timestamp);
    
    // Проверяем последние сообщения для группировки
    const messages = Array.from(container.querySelectorAll('.message'));
    let showAvatar = true;
    let groupPosition = 'single'; // single, start, middle, end
    
    if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        const lastAuthor = lastMessage.querySelector('.message-author');
        const lastAuthorText = lastAuthor ? lastAuthor.textContent : null;
        
        if (lastAuthorText === currentAuthor) {
            // Проверяем время (группируем если прошло меньше 5 минут)
            const lastTimestamp = lastMessage.querySelector('.message-timestamp');
            if (lastTimestamp && lastTimestamp.dataset.timestamp) {
                const lastTime = new Date(lastTimestamp.dataset.timestamp);
                const diffMinutes = (currentTime - lastTime) / (1000 * 60);
                
                if (diffMinutes < 5) {
                    // Группируем сообщения
                    showAvatar = false;
                    
                    // Определяем позицию в группе
                    const lastGroupClass = Array.from(lastMessage.classList).find(c => 
                        c.includes('group-') && c !== 'message'
                    );
                    
                    if (!lastGroupClass || lastGroupClass === 'message-group-single') {
                        // Предыдущее сообщение было единственным - делаем его началом группы
                        lastMessage.classList.remove('message-group-single');
                        lastMessage.classList.add('message-group-start');
                        groupPosition = 'end';
                    } else if (lastGroupClass === 'message-group-start') {
                        // Предыдущее было началом группы - это будет второе сообщение, делаем его концом
                        groupPosition = 'end';
                    } else if (lastGroupClass === 'message-group-middle') {
                        // Предыдущее было серединой группы - делаем его концом, новое тоже конец (исправим после)
                        lastMessage.classList.remove('message-group-middle');
                        lastMessage.classList.add('message-group-end');
                        groupPosition = 'end';
                    } else if (lastGroupClass === 'message-group-end') {
                        // Предыдущее было концом группы - начинаем новую группу
                        groupPosition = 'end';
                    }
                } else {
                    // Прошло много времени - новое сообщение
                    showAvatar = true;
                    groupPosition = 'single';
                }
            }
        } else {
            // Другой автор
            showAvatar = true;
            groupPosition = 'single';
        }
    } else {
        // Первое сообщение
        showAvatar = true;
        groupPosition = 'single';
    }
    
    // Добавляем класс группировки
    messageDiv.classList.add(`message-group-${groupPosition}`);
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    if (showAvatar) {
        avatar.textContent = currentAuthor[0].toUpperCase();
        avatar.style.visibility = 'visible';
        avatar.style.width = '40px';
        avatar.style.height = '40px';
        avatar.style.marginTop = '2px';
        avatar.classList.remove('hidden-avatar');
    } else {
        avatar.style.width = '0';
        avatar.style.height = '0';
        avatar.style.visibility = 'hidden';
        avatar.style.margin = '0';
        avatar.classList.add('hidden-avatar');
    }
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    const header = document.createElement('div');
    header.className = 'message-header';
    
    // Показываем заголовок только для первого сообщения в группе
    if (showAvatar) {
        const author = document.createElement('span');
        author.className = 'message-author';
        author.textContent = currentAuthor;
        header.appendChild(author);
        
        const timestamp = document.createElement('span');
        timestamp.className = 'message-timestamp';
        timestamp.textContent = formatTimestamp(message.created_at || message.timestamp);
        timestamp.dataset.timestamp = message.created_at || message.timestamp;
        header.appendChild(timestamp);
        
        content.appendChild(header);
    }
    
    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message.content;
    
    content.appendChild(text);
    
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    container.appendChild(messageDiv);
    
    // Плавная прокрутка вниз
    container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
    });
}

// Friends Functions
async function loadFriends() {
    try {
        const response = await fetch(`${API_BASE}/api/friends`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            friends = await response.json();
            // Используем новую функцию рендеринга для Discord-style меню
            renderFriendsList('friends');
            // Также обновляем старую функцию для совместимости
            renderFriends();
        }
    } catch (error) {
        console.error('Failed to load friends:', error);
    }
}

function renderFriends() {
    // Проверяем наличие элементов перед их использованием
    const onlineList = document.getElementById('friendsOnlineList');
    const offlineList = document.getElementById('friendsOfflineList');
    
    if (!onlineList || !offlineList) {
        console.warn('Friends lists containers not found, skipping renderFriends');
        return;
    }
    
    onlineList.innerHTML = '';
    offlineList.innerHTML = '';
    
    const online = friends.filter(f => f.status === 'online');
    const offline = friends.filter(f => f.status !== 'online');
    
    const onlineCount = document.getElementById('friendsOnlineCount');
    const offlineCount = document.getElementById('friendsOfflineCount');
    if (onlineCount) onlineCount.textContent = online.length;
    if (offlineCount) offlineCount.textContent = offline.length;
    
    online.forEach(friend => {
        const item = createFriendItem(friend);
        onlineList.appendChild(item);
    });
    
    offline.forEach(friend => {
        const item = createFriendItem(friend);
        offlineList.appendChild(item);
    });
}

function createFriendItem(friend) {
    const item = document.createElement('div');
    item.className = 'friend-item';
    item.onclick = () => openDMWithFriend(friend);
    
    const avatar = document.createElement('div');
    avatar.className = 'friend-avatar';
    avatar.textContent = friend.username[0].toUpperCase();
    
    const statusIndicator = document.createElement('span');
    statusIndicator.className = 'status-indicator';
    statusIndicator.classList.add(friend.status || 'offline');
    avatar.appendChild(statusIndicator);
    
    const info = document.createElement('div');
    info.className = 'friend-info';
    
    const name = document.createElement('div');
    name.className = 'friend-name';
    name.textContent = friend.username;
    
    const status = document.createElement('div');
    status.className = 'friend-status';
    status.textContent = friend.status_message || getStatusText(friend.status);
    
    info.appendChild(name);
    info.appendChild(status);
    
    item.appendChild(avatar);
    item.appendChild(info);
    
    return item;
}

function getStatusText(status) {
    const statusMap = {
        'online': 'В сети',
        'idle': 'Не активен',
        'dnd': 'Не беспокоить',
        'offline': 'Не в сети'
    };
    return statusMap[status] || 'Не в сети';
}

async function handleFriendSearch(e) {
    const query = e.target.value.trim();
    const resultsDiv = document.getElementById('userSearchResults');
    resultsDiv.innerHTML = '';
    
    if (query.length < 2) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/users/search?q=${encodeURIComponent(query)}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const users = await response.json();
            if (users.length === 0) {
                resultsDiv.innerHTML = '<div class="empty-state">Пользователи не найдены</div>';
                return;
            }
            
            users.forEach(user => {
                const item = document.createElement('div');
                item.className = 'search-result-item';
                item.innerHTML = `
                    <div class="friend-avatar">${user.username[0].toUpperCase()}</div>
                    <div class="friend-info">
                        <div class="friend-name">${user.username}</div>
                    </div>
                `;
                item.onclick = () => {
                    document.getElementById('friendUsernameInput').value = user.username;
                    document.getElementById('friendUsernameInput').dataset.userId = user.id;
                    resultsDiv.innerHTML = '';
                };
                resultsDiv.appendChild(item);
            });
        }
    } catch (error) {
        console.error('Failed to search users:', error);
    }
}

async function handleAddFriend(e) {
    e.preventDefault();
    const input = document.getElementById('friendUsernameInput');
    const userId = input.dataset.userId;
    const errorDiv = document.getElementById('friendError');
    
    if (!userId) {
        errorDiv.textContent = 'Выберите пользователя из списка';
        errorDiv.classList.add('show');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/friends/requests`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ to_user_id: parseInt(userId) })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            document.getElementById('addFriendModal').style.display = 'none';
            input.value = '';
            input.dataset.userId = '';
            document.getElementById('userSearchResults').innerHTML = '';
            
            // Обновляем список запросов
            loadFriendRequests();
            
            // Показываем сообщение об успехе
            console.log('Запрос в друзья отправлен:', data);
        } else {
            errorDiv.textContent = data.error || 'Ошибка отправки запроса';
            errorDiv.classList.add('show');
        }
    } catch (error) {
        errorDiv.textContent = 'Ошибка подключения к серверу';
        errorDiv.classList.add('show');
    }
}

async function loadFriendRequests() {
    try {
        const response = await fetch(`${API_BASE}/api/friends/requests`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            friendRequests = data;
            console.log('Загружены запросы в друзья:', friendRequests);
            renderFriendRequests();
            
            // Обновляем счетчик на вкладке "Ожидание"
            const pendingTab = document.querySelector('.friends-tab[data-tab="pending"]');
            if (pendingTab && friendRequests.incoming && friendRequests.incoming.length > 0) {
                pendingTab.innerHTML = `Ожидание <span style="background: var(--discord-red); color: white; padding: 2px 6px; border-radius: 10px; font-size: 12px; margin-left: 4px;">${friendRequests.incoming.length}</span>`;
            }
        } else {
            console.error('Ошибка загрузки запросов:', await response.text());
        }
    } catch (error) {
        console.error('Failed to load friend requests:', error);
    }
}

function renderFriendRequests() {
    const incomingDiv = document.getElementById('incomingRequests');
    const outgoingDiv = document.getElementById('outgoingRequests');
    
    if (friendRequests.incoming.length === 0) {
        incomingDiv.innerHTML = '<p class="empty-state">Нет входящих запросов</p>';
    } else {
        incomingDiv.innerHTML = '';
        friendRequests.incoming.forEach(request => {
            const item = createFriendRequestItem(request, 'incoming');
            incomingDiv.appendChild(item);
        });
    }
    
    if (friendRequests.outgoing.length === 0) {
        outgoingDiv.innerHTML = '<p class="empty-state">Нет исходящих запросов</p>';
    } else {
        outgoingDiv.innerHTML = '';
        friendRequests.outgoing.forEach(request => {
            const item = createFriendRequestItem(request, 'outgoing');
            outgoingDiv.appendChild(item);
        });
    }
}

function createFriendRequestItem(request, type) {
    const item = document.createElement('div');
    item.className = 'request-item';
    
    const user = type === 'incoming' ? request.from_user : request.to_user;
    
    item.innerHTML = `
        <div class="request-info">
            <div class="friend-avatar">${user.username[0].toUpperCase()}</div>
            <div class="friend-info">
                <div class="friend-name">${user.username}</div>
            </div>
        </div>
        <div class="request-actions">
            ${type === 'incoming' ? `
                <button class="btn-primary" onclick="acceptFriendRequest(${request.id})">Принять</button>
                <button class="btn-secondary" onclick="declineFriendRequest(${request.id})">Отклонить</button>
            ` : '<span class="friend-status">Ожидание...</span>'}
        </div>
    `;
    
    return item;
}

async function acceptFriendRequest(requestId) {
    try {
        const response = await fetch(`${API_BASE}/api/friends/requests/${requestId}/accept`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            loadFriendRequests();
            loadFriends();
        }
    } catch (error) {
        console.error('Failed to accept friend request:', error);
    }
}

async function declineFriendRequest(requestId) {
    try {
        const response = await fetch(`${API_BASE}/api/friends/requests/${requestId}/decline`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            loadFriendRequests();
        }
    } catch (error) {
        console.error('Failed to decline friend request:', error);
    }
}

function switchFriendRequestsTab(tab) {
    document.querySelectorAll('#friendRequestsTabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`#friendRequestsTabs [data-tab="${tab}"]`).classList.add('active');
    
    if (tab === 'incoming') {
        document.getElementById('incomingRequests').style.display = 'block';
        document.getElementById('outgoingRequests').style.display = 'none';
    } else {
        document.getElementById('incomingRequests').style.display = 'none';
        document.getElementById('outgoingRequests').style.display = 'block';
    }
}

// DM Channels Functions
async function loadDMChannels() {
    try {
        const response = await fetch(`${API_BASE}/api/dm-channels`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            dmChannels = await response.json();
            renderDMChannels();
        }
    } catch (error) {
        console.error('Failed to load DM channels:', error);
    }
}

function renderDMChannels() {
    const list = document.getElementById('dmChannelsList');
    list.innerHTML = '';
    
    if (dmChannels.length === 0) {
        list.innerHTML = '<p class="empty-state">Нет личных сообщений</p>';
        return;
    }
    
    dmChannels.forEach(dmChannel => {
        const item = document.createElement('div');
        item.className = 'dm-item';
        if (currentDMChannel && currentDMChannel.id === dmChannel.id) {
            item.classList.add('active');
        }
        
        const avatar = document.createElement('div');
        avatar.className = 'friend-avatar';
        avatar.textContent = dmChannel.other_user.username[0].toUpperCase();
        
        const statusIndicator = document.createElement('span');
        statusIndicator.className = 'status-indicator';
        statusIndicator.classList.add(dmChannel.other_user.status || 'offline');
        avatar.appendChild(statusIndicator);
        
        const info = document.createElement('div');
        info.className = 'friend-info';
        
        const name = document.createElement('div');
        name.className = 'friend-name';
        name.textContent = dmChannel.other_user.username;
        
        info.appendChild(name);
        
        item.appendChild(avatar);
        item.appendChild(info);
        item.onclick = () => selectDMChannel(dmChannel);
        
        list.appendChild(item);
    });
}

async function openDMWithFriend(friend) {
    try {
        const response = await fetch(`${API_BASE}/api/dm-channels`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ user_id: friend.id })
        });
        
        if (response.ok) {
            const dmChannel = await response.json();
            selectDMChannel(dmChannel);
            // Не нужно переключать таб, так как у нас другая система навигации
            loadDMChannels();
        }
    } catch (error) {
        console.error('Failed to open DM:', error);
    }
}

async function selectDMChannel(dmChannel) {
    if (!dmChannel) {
        console.error('DM channel is null or undefined');
        return;
    }
    
    // Если other_user отсутствует, загружаем данные канала заново
    if (!dmChannel.other_user) {
        console.warn('[DM] other_user missing, reloading channel data');
        try {
            const response = await fetch(`${API_BASE}/api/dm-channels`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (response.ok) {
                const channels = await response.json();
                const fullChannel = channels.find(c => c.id === dmChannel.id);
                if (fullChannel && fullChannel.other_user) {
                    dmChannel = fullChannel;
                    console.log('[DM] Reloaded channel with other_user:', fullChannel.other_user);
                }
            }
        } catch (error) {
            console.error('[DM] Failed to reload channel:', error);
        }
    }
    
    currentDMChannel = dmChannel;
    currentChannel = null;
    currentServer = null;
    
    console.log('[DM] Selecting DM channel:', dmChannel);
    console.log('[DM] Other user:', dmChannel.other_user);
    
    // Проверяем наличие other_user перед продолжением
    if (!dmChannel.other_user) {
        console.error('[DM] Cannot select channel: other_user is missing');
        alert('Ошибка: не удалось загрузить данные пользователя');
        return;
    }
    
    // Показываем чат и скрываем список друзей
    const friendsMainView = document.getElementById('friendsMainView');
    const chatView = document.getElementById('chatView');
    
    if (friendsMainView) friendsMainView.style.display = 'none';
    if (chatView) chatView.style.display = 'block';
    
    // Обновляем заголовок канала
    const channelName = document.getElementById('channelName');
    const channelIcon = document.getElementById('channelIcon');
    
    if (channelName) channelName.textContent = dmChannel.other_user?.username || 'Пользователь';
    if (channelIcon) channelIcon.textContent = '@';
    
    // Проверяем наличие кнопок звонка после показа chatView
    const callBtn = document.getElementById('callBtn');
    const videoCallBtn = document.getElementById('videoCallBtn');
    console.log('[CALL] After opening DM - callBtn found:', !!callBtn, 'videoCallBtn found:', !!videoCallBtn);
    console.log('[CALL] currentDMChannel.other_user:', currentDMChannel.other_user);
    
    // Показываем поле ввода сообщений
    const messageInputContainer = document.getElementById('messageInputContainer');
    if (messageInputContainer) {
        messageInputContainer.style.display = 'block';
        console.log('Message input container shown');
    } else {
        console.error('messageInputContainer not found');
    }
    
    // Очищаем контейнер сообщений
    const messagesContainer = document.getElementById('messagesContainer');
    if (messagesContainer) {
        messagesContainer.innerHTML = '<div class="empty-state">Загрузка сообщений...</div>';
    }
    
    renderDMChannels();
    loadDMMessages();
    
    if (socket) {
        socket.emit('join_dm_channel', { channel_id: dmChannel.id });
    }
}

async function loadDMMessages() {
    if (!currentDMChannel) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/dm-channels/${currentDMChannel.id}/messages`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const messages = await response.json();
            renderMessages(messages);
        }
    } catch (error) {
        console.error('Failed to load DM messages:', error);
    }
}

// Settings Functions
async function loadSettings() {
    try {
        const response = await fetch(`${API_BASE}/api/settings`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const settings = await response.json();
            document.getElementById('settingsTheme').value = settings.theme;
            document.getElementById('settingsNotifications').checked = settings.notifications;
            document.getElementById('settingsSound').checked = settings.sound_enabled;
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
    
    if (currentUser) {
        document.getElementById('settingsUsername').value = currentUser.username;
        document.getElementById('settingsEmail').value = currentUser.email || '';
        document.getElementById('settingsStatus').value = currentUser.status || 'online';
        document.getElementById('settingsStatusMessage').value = currentUser.status_message || '';
    }
}

async function handleSaveSettings() {
    const settings = {
        theme: document.getElementById('settingsTheme').value,
        notifications: document.getElementById('settingsNotifications').checked,
        sound_enabled: document.getElementById('settingsSound').checked
    };
    
    const status = {
        status: document.getElementById('settingsStatus').value,
        status_message: document.getElementById('settingsStatusMessage').value
    };
    
    try {
        await Promise.all([
            fetch(`${API_BASE}/api/settings`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(settings)
            }),
            fetch(`${API_BASE}/api/me/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(status)
            })
        ]);
        
        checkAuth();
        loadFriends();
        document.getElementById('settingsModal').style.display = 'none';
    } catch (error) {
        console.error('Failed to save settings:', error);
    }
}

function switchSettingsTab(tab) {
    // New settings nav
    document.querySelectorAll('.settings-nav-item').forEach(btn => btn.classList.remove('active'));
    const navItem = document.querySelector(`.settings-nav-item[data-tab="${tab}"]`);
    if (navItem) navItem.classList.add('active');
    
    // Old settings tabs (for backward compatibility)
    document.querySelectorAll('.settings-tab').forEach(btn => btn.classList.remove('active'));
    const oldTab = document.querySelector(`.settings-tab[data-tab="${tab}"]`);
    if (oldTab) oldTab.classList.add('active');
    
    // Show corresponding section
    document.querySelectorAll('.settings-section').forEach(section => section.classList.remove('active'));
    const section = document.getElementById(`${tab}Settings`);
    if (section) section.classList.add('active');
}

// WebSocket
function initSocket() {
    if (socket) {
        socket.disconnect();
    }
    
    socket = io({
        auth: { token: authToken },
        transports: ['websocket', 'polling']
    });
    
    socket.on('connect', () => {
        console.log('[SOCKET] WebSocket connected');
        console.log('[SOCKET] Socket ID:', socket.id);
        updateUserStatusOnServer('online');
        
        if (currentChannel) {
            socket.emit('join_channel', { channel_id: currentChannel.id });
        }
        if (currentDMChannel) {
            socket.emit('join_dm_channel', { channel_id: currentDMChannel.id });
        }
    });
    
    socket.on('connected', (data) => {
        console.log('[SOCKET] Server confirmed connection:', data);
    });
    
    socket.on('disconnect', () => {
        console.log('WebSocket disconnected');
    });
    
    socket.on('new_message', (message) => {
        if (currentChannel && message.channel_id === currentChannel.id) {
            addMessageToView(message);
        }
    });
    
    socket.on('new_dm_message', (message) => {
        if (currentDMChannel && message.dm_channel_id === currentDMChannel.id) {
            addMessageToView(message);
        }
        loadDMChannels();
    });
    
    socket.on('friend_request_received', (request) => {
        console.log('Получено уведомление о новой заявке в друзья:', request);
        
        // Добавляем запрос в локальный список
        if (request.to_user_id === currentUser?.id) {
            if (!friendRequests.incoming.find(r => r.id === request.id)) {
                friendRequests.incoming.push(request);
                renderFriendRequests();
            }
        }
        
        // Перезагружаем список запросов с сервера
        loadFriendRequests();
        
        // Показываем визуальное уведомление
        if (request.from_user) {
            showNotification(`Новая заявка в друзья от ${request.from_user.username}`);
            
            // Если открыта вкладка "Ожидание", переключаемся на нее
            const pendingTab = document.querySelector('.friends-tab[data-tab="pending"]');
            if (pendingTab) {
                switchFriendsTab('pending');
            }
        }
    });
    
    // Дополнительный обработчик для broadcast
    socket.on('friend_request_received_broadcast', (request) => {
        // Проверяем, что запрос адресован текущему пользователю
        if (request.to_user_id === currentUser?.id) {
            console.log('Получено broadcast уведомление о заявке в друзья:', request);
            loadFriendRequests();
        }
    });
    
    socket.on('friend_request_accepted', (data) => {
        loadFriends();
        loadFriendRequests();
    });
    
    socket.on('user_status_changed', (user) => {
        if (friends.find(f => f.id === user.id)) {
            loadFriends();
        }
        if (user.id === currentUser.id) {
            updateUserStatus(user.status);
        }
    });
    
    socket.on('joined_channel', (data) => {
        console.log('Joined channel:', data);
    });
    
    socket.on('joined_dm_channel', (data) => {
        console.log('Joined DM channel:', data);
    });
    
    // Call Events
    socket.on('call_incoming', (data) => {
        console.log('[CALL] Received call_incoming event:', data);
        handleIncomingCall(data);
    });
    
    socket.on('call_accepted', (data) => {
        console.log('[CALL] Received call_accepted event:', data);
        handleCallAccepted(data);
    });
    
    socket.on('call_rejected', (data) => {
        console.log('[CALL] Received call_rejected event:', data);
        handleCallRejected(data);
    });
    
    socket.on('call_ended', (data) => {
        console.log('[CALL] Received call_ended event:', data);
        handleCallEnded(data);
    });
    
    socket.on('call_offer', (data) => {
        console.log('[CALL] Received call_offer event:', data);
        handleCallOffer(data);
    });
    
    socket.on('call_answer', (data) => {
        console.log('[CALL] Received call_answer event:', data);
        handleCallAnswer(data);
    });
    
    socket.on('call_ice_candidate', (data) => {
        console.log('[CALL] Received call_ice_candidate event:', data);
        handleIceCandidate(data);
    });
}

// Helper Functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Notification function
function showNotification(message, duration = 3000) {
    // Проверяем поддержку уведомлений браузера
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('RUCord', {
            body: message,
            icon: '/static/favicon.ico'
        });
    } else if ('Notification' in window && Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification('RUCord', {
                    body: message,
                    icon: '/static/favicon.ico'
                });
            }
        });
    }
    
    // Также показываем консольное сообщение
    console.log('Notification:', message);
}

// Make functions available globally for onclick handlers
window.acceptFriendRequest = acceptFriendRequest;
window.declineFriendRequest = declineFriendRequest;

// ==================== WebRTC Call Functions ====================

let peerConnection = null;
let localStream = null;
let currentCall = null;
let isMuted = false;
let isVideoOff = false;
let isScreenSharing = false;
let screenStream = null;
let audioContext = null;
let audioProcessor = null;
let noiseSuppressionEnabled = false;
let remoteStreams = new Map(); // Храним все удаленные потоки для объединения
let pendingIceCandidates = []; // Храним ICE кандидаты, полученные до создания peerConnection
let audioDevices = { input: [], output: [] }; // Список аудио устройств
let currentInputDeviceId = null;
let currentOutputDeviceId = null;
let outputVolume = 1.0; // Громкость вывода (0.0 - 1.0)
let inputVolume = 1.0; // Громкость ввода (0.0 - 1.0)
let testAudioContext = null;
let testAudioSource = null;

const rtcConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

async function startCall(userId, type = 'audio') {
    console.log('[CALL] startCall called with userId:', userId, 'type:', type);
    
    // Пытаемся найти друга в списке друзей
    let friend = friends.find(f => f.id === userId);
    
    // Если не найден в списке друзей, пробуем найти через currentDMChannel
    if (!friend && currentDMChannel && currentDMChannel.other_user) {
        if (currentDMChannel.other_user.id === userId) {
            friend = currentDMChannel.other_user;
        }
    }
    
    // Если все еще не найден, создаем временный объект друга
    if (!friend) {
        console.warn('[CALL] Friend not found in friends list, using userId:', userId);
        friend = {
            id: userId,
            username: 'Пользователь #' + userId
        };
    }
    
    currentCall = {
        userId: userId,
        userName: friend.username,
        type: type,
        isInitiator: true
    };
    
    console.log('[CALL] Starting call to:', friend.username, 'type:', type);
    
    showCallModal(friend.username, friend.username[0].toUpperCase(), 'Вызов...');
    
    // Проверяем наличие socket
    if (!socket || !socket.connected) {
        console.error('[CALL] Socket not connected, reinitializing...');
        initSocket();
        // Ждем подключения
        await new Promise((resolve) => {
            if (socket && socket.connected) {
                console.log('[CALL] Socket connected after reinit');
                resolve();
            } else {
                const timeout = setTimeout(() => {
                    console.warn('[CALL] Socket connection timeout');
                    resolve();
                }, 3000);
                socket.on('connect', () => {
                    clearTimeout(timeout);
                    console.log('[CALL] Socket connected via event');
                    resolve();
                });
            }
        });
    }
    
    if (!socket || !socket.connected) {
        console.error('[CALL] Socket still not connected after wait');
        alert('Ошибка подключения к серверу. Проверьте соединение.');
        endCall();
        return;
    }
    
    console.log('[CALL] Socket is connected, proceeding with call setup');
    
    try {
        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: type === 'video' ? {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } : false
        };
        
        console.log('Requesting media with constraints:', constraints);
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('Media stream obtained');
        
        // Применяем громкость ввода
        applyInputVolume();
        
        // Включаем шумоподавление через Web Audio API
        await enableNoiseSuppression(localStream);
        
        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
            // Показываем localVideo для всех типов звонков (для аудио показываем аватар, но элемент нужен)
            localVideo.srcObject = localStream;
            localVideo.muted = true; // Всегда заглушаем локальное видео
            localVideo.autoplay = true;
            localVideo.playsInline = true;
            if (type === 'video') {
                localVideo.style.display = 'block';
                localVideo.classList.add('fade-in');
            } else {
                // Для аудио звонков можно скрыть видео, но оставить поток для передачи
                localVideo.style.display = 'none';
            }
        }
        
        peerConnection = new RTCPeerConnection(rtcConfiguration);
        console.log('[CALL] RTCPeerConnection created');
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Добавляем отложенные ICE кандидаты если есть
        await addPendingIceCandidates();
        
        // Очищаем старые потоки при новом звонке
        remoteStreams.clear();
        
        peerConnection.ontrack = (event) => {
            console.log('[CALL] Received remote track:', event.track.kind, 'streams:', event.streams.length);
            const remoteVideo = document.getElementById('remoteVideo');
            
            if (event.streams && event.streams.length > 0) {
                const stream = event.streams[0];
                const streamId = stream.id;
                
                // Сохраняем поток
                if (!remoteStreams.has(streamId)) {
                    remoteStreams.set(streamId, stream);
                }
                
                // Объединяем все треки из всех потоков
                const combinedStream = new MediaStream();
                remoteStreams.forEach(s => {
                    s.getTracks().forEach(track => {
                        if (track.readyState === 'live') {
                            // Проверяем, не добавлен ли уже этот трек
                            if (!combinedStream.getTracks().some(t => t.id === track.id)) {
                                combinedStream.addTrack(track);
                            }
                        }
                    });
                });
                
                if (remoteVideo && combinedStream.getTracks().length > 0) {
                    // Сохраняем текущий srcObject если есть
                    const currentSrc = remoteVideo.srcObject;
                    
                    remoteVideo.srcObject = combinedStream;
                    remoteVideo.muted = false; // ВАЖНО: не заглушаем для прослушивания аудио
                    remoteVideo.volume = outputVolume; // Применяем настройки громкости вывода
                    remoteVideo.autoplay = true;
                    remoteVideo.playsInline = true;
                    
                    // Применяем выбранное устройство вывода если доступно
                    if (currentOutputDeviceId && 'setSinkId' in remoteVideo) {
                        remoteVideo.setSinkId(currentOutputDeviceId).catch(err => {
                            console.warn('[CALL] Could not set output device:', err);
                        });
                    }
                    
                    // Останавливаем старые треки если они есть
                    if (currentSrc && currentSrc instanceof MediaStream) {
                        currentSrc.getTracks().forEach(track => {
                            if (!combinedStream.getTracks().some(t => t.id === track.id)) {
                                track.stop();
                            }
                        });
                    }
                    
                    // Пытаемся воспроизвести
                    const playPromise = remoteVideo.play();
                    if (playPromise !== undefined) {
                        playPromise.then(() => {
                            console.log('[CALL] Remote video/audio playing successfully');
                        }).catch(err => {
                            console.error('[CALL] Error playing remote video:', err);
                            // Пробуем еще раз после небольшой задержки
                            setTimeout(() => {
                                remoteVideo.play().catch(e => {
                                    console.error('[CALL] Retry play failed:', e);
                                });
                            }, 500);
                        });
                    }
                    
                    remoteVideo.style.display = 'block';
                    remoteVideo.classList.add('fade-in');
                    
                    const placeholder = document.getElementById('callPlaceholder');
                    if (placeholder) {
                        placeholder.style.display = 'none';
                        placeholder.classList.add('fade-out');
                    }
                    
                    const audioTracks = combinedStream.getAudioTracks();
                    const videoTracks = combinedStream.getVideoTracks();
                    console.log('[CALL] Remote stream updated - audio tracks:', audioTracks.length, 'video tracks:', videoTracks.length);
                    console.log('[CALL] All tracks:', combinedStream.getTracks().map(t => `${t.kind}:${t.id}:${t.readyState}`));
                }
            }
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && socket && socket.connected) {
                console.log('Sending ICE candidate');
                socket.emit('call_ice_candidate', {
                    to_user_id: userId,
                    candidate: event.candidate
                });
            }
        };
        
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true // Всегда запрашиваем видео, даже для аудио звонков (для демонстрации экрана)
        });
        await peerConnection.setLocalDescription(offer);
        console.log('Created offer:', offer.type);
        
        if (socket && socket.connected) {
            console.log('[CALL] Emitting call_request to user:', userId, 'type:', type);
            console.log('[CALL] Offer:', offer);
            socket.emit('call_request', {
                to_user_id: userId,
                type: type,
                offer: offer
            });
            updateCallStatus('Вызов...');
        } else {
            console.error('[CALL] Socket not connected, cannot send call request');
            console.error('[CALL] Socket state:', socket ? (socket.connected ? 'connected' : 'disconnected') : 'null');
            alert('Ошибка подключения. Проверьте соединение.');
            endCall();
        }
        
    } catch (error) {
        console.error('Error starting call:', error);
        alert('Не удалось начать звонок: ' + error.message);
        endCall();
    }
}

// Функция для включения шумоподавления через Web Audio API
async function enableNoiseSuppression(stream) {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const source = audioContext.createMediaStreamSource(stream);
        const destination = audioContext.createMediaStreamDestination();
        
        // Создаем AudioWorklet для шумоподавления
        try {
            await audioContext.audioWorklet.addModule('/static/js/noise-suppressor.js');
            audioProcessor = new AudioWorkletNode(audioContext, 'noise-suppressor');
            source.connect(audioProcessor);
            audioProcessor.connect(destination);
            
            // Заменяем аудио треки в локальном потоке
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length > 0 && destination.stream) {
                const newAudioTracks = destination.stream.getAudioTracks();
                audioTracks.forEach(oldTrack => {
                    oldTrack.stop();
                    stream.removeTrack(oldTrack);
                });
                newAudioTracks.forEach(newTrack => {
                    stream.addTrack(newTrack);
                });
            }
            noiseSuppressionEnabled = true;
            console.log('Noise suppression enabled');
        } catch (workletError) {
            console.warn('AudioWorklet not available, using basic noise suppression:', workletError);
            // Используем базовое шумоподавление через constraints
            noiseSuppressionEnabled = true;
        }
    } catch (error) {
        console.warn('Error enabling noise suppression:', error);
        // Продолжаем без шумоподавления
    }
}

function showCallModal(userName, avatarText, status) {
    const modal = document.getElementById('callModal');
    if (!modal) return;
    
    modal.style.display = 'flex';
    const userNameEl = document.getElementById('callUserName');
    const avatarEl = document.getElementById('callAvatar');
    const placeholderAvatarEl = document.getElementById('callPlaceholderAvatar');
    const statusEl = document.getElementById('callStatus');
    
    if (userNameEl) userNameEl.textContent = userName;
    if (avatarEl) avatarEl.textContent = avatarText;
    if (placeholderAvatarEl) placeholderAvatarEl.textContent = avatarText;
    if (statusEl) statusEl.textContent = status;
    
    setupCallControls();
}

function updateCallStatus(status) {
    const statusEl = document.getElementById('callStatus');
    if (statusEl) statusEl.textContent = status;
}

function setupCallControls() {
    document.getElementById('muteBtn')?.addEventListener('click', toggleMute);
    document.getElementById('videoToggleBtn')?.addEventListener('click', toggleVideo);
    document.getElementById('screenShareBtn')?.addEventListener('click', toggleScreenShare);
    document.getElementById('endCallBtn')?.addEventListener('click', endCall);
    document.getElementById('callSettingsBtn')?.addEventListener('click', toggleCallSettings);
    document.getElementById('closeCallSettingsBtn')?.addEventListener('click', toggleCallSettings);
    document.getElementById('outputVolumeSlider')?.addEventListener('input', handleOutputVolumeChange);
    document.getElementById('inputVolumeSlider')?.addEventListener('input', handleInputVolumeChange);
    document.getElementById('outputDeviceSelect')?.addEventListener('change', handleOutputDeviceChange);
    document.getElementById('inputDeviceSelect')?.addEventListener('change', handleInputDeviceChange);
    document.getElementById('testAudioBtn')?.addEventListener('click', testAudio);
}

async function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });
    const muteBtn = document.getElementById('muteBtn');
    if (muteBtn) muteBtn.classList.toggle('active', isMuted);
}

async function toggleVideo() {
    if (!localStream) return;
    isVideoOff = !isVideoOff;
    localStream.getVideoTracks().forEach(track => {
        track.enabled = !isVideoOff;
    });
    const videoBtn = document.getElementById('videoToggleBtn');
    const localVideo = document.getElementById('localVideo');
    if (videoBtn) videoBtn.classList.toggle('active', isVideoOff);
    if (localVideo) localVideo.style.display = isVideoOff ? 'none' : 'block';
}

async function toggleScreenShare() {
    if (isScreenSharing) {
        // Останавливаем демонстрацию экрана
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
        }
        
        // Возвращаем видео камеру
        if (localStream) {
            try {
                const videoTrack = localStream.getVideoTracks()[0];
                if (!videoTrack || !videoTrack.enabled) {
                    // Получаем новый видео поток
                    const stream = await navigator.mediaDevices.getUserMedia({ 
                        video: {
                            width: { ideal: 1280 },
                            height: { ideal: 720 }
                        }
                    });
                    const newVideoTrack = stream.getVideoTracks()[0];
                    
                    const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video');
                    if (sender && newVideoTrack) {
                        await sender.replaceTrack(newVideoTrack);
                        // Останавливаем старые треки
                        localStream.getVideoTracks().forEach(track => {
                            if (track !== newVideoTrack) track.stop();
                        });
                        // Добавляем новый трек
                        if (!localStream.getVideoTracks().includes(newVideoTrack)) {
                            localStream.addTrack(newVideoTrack);
                        }
                    }
                } else {
                    const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video');
                    if (sender && videoTrack) {
                        await sender.replaceTrack(videoTrack);
                    }
                }
                
                const localVideo = document.getElementById('localVideo');
                if (localVideo) {
                    localVideo.srcObject = localStream;
                    localVideo.muted = true;
                    if (currentCall?.type === 'video') {
                        localVideo.style.display = 'block';
                        localVideo.classList.add('fade-in');
                    }
                }
            } catch (error) {
                console.error('Error restoring video:', error);
            }
        }
        
        isScreenSharing = false;
        document.getElementById('screenShareBtn')?.classList.remove('active');
    } else {
        // Начинаем демонстрацию экрана
        try {
            // Запрашиваем демонстрацию экрана с аудио (системный звук)
            screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                video: {
                    cursor: 'always',
                    displaySurface: 'monitor'
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            const videoTrack = screenStream.getVideoTracks()[0];
            const audioTracks = screenStream.getAudioTracks();
            
            console.log('[CALL] Starting screen share, video track:', !!videoTrack, 'audio tracks:', audioTracks.length);
            
            if (!videoTrack) {
                console.error('[CALL] No video track in screen stream');
                throw new Error('Не удалось получить видео с экрана');
            }
            
            // Заменяем видео трек на экран
            const videoSender = peerConnection?.getSenders().find(s => s.track?.kind === 'video');
            if (videoSender) {
                console.log('[CALL] Replacing video track with screen');
                await videoSender.replaceTrack(videoTrack);
                console.log('[CALL] Video track replaced successfully');
            } else {
                // Если нет видео сендера (например, для аудио звонка), добавляем новый трек
                console.log('[CALL] No video sender found, adding new video track');
                if (peerConnection) {
                    // Добавляем видео трек
                    peerConnection.addTrack(videoTrack, screenStream);
                    console.log('[CALL] Video track added successfully');
                    
                    // Создаем новый offer для переговоров с видео
                    try {
                        const offer = await peerConnection.createOffer();
                        await peerConnection.setLocalDescription(offer);
                        console.log('[CALL] Created new offer with screen share');
                        
                        // Отправляем новый offer собеседнику
                        if (socket && socket.connected && currentCall) {
                            socket.emit('call_offer', {
                                to_user_id: currentCall.userId,
                                offer: offer
                            });
                            console.log('[CALL] Sent new offer with screen share');
                        }
                    } catch (error) {
                        console.error('[CALL] Error creating offer for screen share:', error);
                    }
                }
            }
            
            // Обрабатываем аудио трек (системный звук) если доступен
            if (audioTracks.length > 0) {
                const audioSender = peerConnection?.getSenders().find(s => s.track?.kind === 'audio');
                if (audioSender) {
                    console.log('[CALL] Replacing audio track with screen audio');
                    await audioSender.replaceTrack(audioTracks[0]);
                    console.log('[CALL] Audio track replaced successfully');
                } else if (peerConnection) {
                    // Добавляем новый аудио трек если нет существующего
                    console.log('[CALL] Adding new audio track from screen');
                    peerConnection.addTrack(audioTracks[0], screenStream);
                }
            } else {
                console.log('[CALL] No audio tracks in screen stream (this is normal)');
            }
            
            // Обработчик для остановки демонстрации экрана
            videoTrack.onended = () => {
                console.log('[CALL] Screen share ended by user');
                toggleScreenShare();
            };
            
            const localVideo = document.getElementById('localVideo');
            if (localVideo) {
                localVideo.srcObject = screenStream;
                localVideo.muted = true;
                localVideo.style.display = 'block';
                localVideo.classList.add('fade-in');
                localVideo.play().catch(err => {
                    console.error('[CALL] Error playing screen share:', err);
                });
            }
            
            isScreenSharing = true;
            document.getElementById('screenShareBtn')?.classList.add('active');
            
            // Останавливаем демонстрацию когда пользователь прекращает её
            videoTrack.onended = () => {
                console.log('[CALL] Screen share ended by user');
                toggleScreenShare();
            };
            
            if (audioTracks.length > 0) {
                audioTracks[0].onended = () => {
                    console.log('[CALL] Screen share audio ended');
                    toggleScreenShare();
                };
            }
            
            console.log('[CALL] Screen share started successfully');
            
            if (audioTracks.length > 0) {
                audioTracks.forEach(track => {
                    track.onended = () => {
                        toggleScreenShare();
                    };
                });
            }
            
        } catch (error) {
            console.error('Error sharing screen:', error);
            if (error.name === 'NotAllowedError') {
                alert('Доступ к демонстрации экрана запрещен. Разрешите доступ в настройках браузера.');
            } else {
                alert('Не удалось начать демонстрацию экрана: ' + error.message);
            }
        }
    }
}

function endCall() {
    console.log('[CALL] Ending call');
    
    // Закрываем панель настроек если открыта
    const settingsPanel = document.getElementById('callSettingsPanel');
    if (settingsPanel) {
        settingsPanel.style.display = 'none';
    }
    const settingsBtn = document.getElementById('callSettingsBtn');
    if (settingsBtn) {
        settingsBtn.classList.remove('active');
    }
    
    // Останавливаем тест звука если активен
    if (testAudioContext) {
        if (testAudioSource) {
            testAudioSource.stop();
        }
        testAudioContext.close();
        testAudioContext = null;
        testAudioSource = null;
        const testBtn = document.getElementById('testAudioBtn');
        if (testBtn) testBtn.textContent = 'Тест звука';
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            console.log('[CALL] Stopped local track:', track.kind);
        });
        localStream = null;
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => {
            track.stop();
            console.log('[CALL] Stopped screen track:', track.kind);
        });
        screenStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Останавливаем все удаленные потоки
    remoteStreams.forEach(stream => {
        stream.getTracks().forEach(track => track.stop());
    });
    remoteStreams.clear();
    
    // Очищаем отложенные ICE кандидаты
    pendingIceCandidates = [];
    
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    const placeholder = document.getElementById('callPlaceholder');
    if (localVideo) {
        localVideo.srcObject = null;
        localVideo.style.display = 'none';
    }
    if (remoteVideo) {
        remoteVideo.srcObject = null;
        remoteVideo.style.display = 'none';
    }
    if (placeholder) placeholder.style.display = 'flex';
    if (currentCall && socket && socket.connected) {
        socket.emit('call_end', { to_user_id: currentCall.userId });
    }
    document.getElementById('callModal').style.display = 'none';
    currentCall = null;
    isMuted = false;
    isVideoOff = false;
    isScreenSharing = false;
    
    console.log('[CALL] Call ended');
}

function handleIncomingCall(data) {
    console.log('[CALL] Incoming call received:', data);
    
    // Пытаемся найти друга в списке друзей
    let friend = friends.find(f => f.id === data.from_user_id);
    
    // Если не найден в списке друзей, пробуем найти через currentDMChannel
    if (!friend && currentDMChannel && currentDMChannel.other_user) {
        if (currentDMChannel.other_user.id === data.from_user_id) {
            friend = currentDMChannel.other_user;
        }
    }
    
    // Если все еще не найден, создаем временный объект
    if (!friend) {
        console.warn('[CALL] Friend not found for incoming call, using userId:', data.from_user_id);
        friend = {
            id: data.from_user_id,
            username: 'Пользователь #' + data.from_user_id
        };
    }
    
    // Сохраняем данные входящего звонка ПЕРЕД показом модального окна
    currentCall = {
        userId: data.from_user_id,
        userName: friend.username,
        type: data.type || 'audio',
        isInitiator: false,
        incomingData: data
    };
    
    // Показываем модальное окно звонка
    showCallModal(friend.username, friend.username[0].toUpperCase(), 'Входящий звонок...');
    
    // Добавляем кнопки для принятия/отклонения
    const callControls = document.querySelector('.call-controls');
    if (callControls) {
        // Удаляем старые кнопки если есть
        const oldAcceptBtn = document.getElementById('acceptCallBtn');
        const oldRejectBtn = document.getElementById('rejectCallBtn');
        if (oldAcceptBtn) oldAcceptBtn.remove();
        if (oldRejectBtn) oldRejectBtn.remove();
        
        // Создаем кнопку принятия
        const acceptBtn = document.createElement('button');
        acceptBtn.id = 'acceptCallBtn';
        acceptBtn.className = 'call-control-btn';
        acceptBtn.style.background = 'var(--discord-green)';
        acceptBtn.style.color = 'white';
        acceptBtn.innerHTML = '✓';
        acceptBtn.title = 'Принять';
        acceptBtn.onclick = () => {
            console.log('[CALL] Accept button clicked');
            acceptCall(data);
            acceptBtn.remove();
            const rejectBtn = document.getElementById('rejectCallBtn');
            if (rejectBtn) rejectBtn.remove();
        };
        
        // Создаем кнопку отклонения
        const rejectBtn = document.createElement('button');
        rejectBtn.id = 'rejectCallBtn';
        rejectBtn.className = 'call-control-btn end-call-btn';
        rejectBtn.innerHTML = '✕';
        rejectBtn.title = 'Отклонить';
        rejectBtn.onclick = () => {
            console.log('[CALL] Reject button clicked');
            if (socket && socket.connected) {
                socket.emit('call_reject', { to_user_id: data.from_user_id });
            }
            endCall();
        };
        
        // Вставляем кнопки в начало списка контролов
        callControls.insertBefore(acceptBtn, callControls.firstChild);
        callControls.insertBefore(rejectBtn, callControls.firstChild);
    }
}

async function acceptCall(data) {
    console.log('Accepting call:', data);
    
    // Используем данные из currentCall если они есть, иначе из data
    const callData = currentCall?.incomingData || data;
    const userId = callData.from_user_id || data.from_user_id;
    const callType = callData.type || data.type || 'audio';
    
    let friend = friends.find(f => f.id === userId);
    if (!friend && currentDMChannel && currentDMChannel.other_user) {
        if (currentDMChannel.other_user.id === userId) {
            friend = currentDMChannel.other_user;
        }
    }
    
    if (!friend && currentCall) {
        friend = {
            id: userId,
            username: currentCall.userName || 'Пользователь #' + userId
        };
    }
    
    if (!friend) {
        console.error('Friend not found for call:', userId);
        return;
    }
    
    updateCallStatus('Соединение...');
    
    // Удаляем кнопки принятия/отклонения
    const acceptBtn = document.getElementById('acceptCallBtn');
    const rejectBtn = document.getElementById('rejectCallBtn');
    if (acceptBtn) acceptBtn.remove();
    if (rejectBtn) rejectBtn.remove();
    
    try {
        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                deviceId: currentInputDeviceId ? { exact: currentInputDeviceId } : undefined
            },
            video: callType === 'video' ? {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } : false
        };
        
        console.log('Accepting call with constraints:', constraints);
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('Local stream obtained for call acceptance');
        
        // Применяем громкость ввода
        applyInputVolume();
        
        // Включаем шумоподавление
        await enableNoiseSuppression(localStream);
        
        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
            // Показываем localVideo для всех типов звонков
            localVideo.srcObject = localStream;
            localVideo.muted = true; // Всегда заглушаем локальное видео
            localVideo.autoplay = true;
            localVideo.playsInline = true;
            if (callType === 'video') {
                localVideo.style.display = 'block';
                localVideo.classList.add('fade-in');
            } else {
                // Для аудио звонков можно скрыть видео, но оставить поток для передачи
                localVideo.style.display = 'none';
            }
        }
        
        peerConnection = new RTCPeerConnection(rtcConfiguration);
        console.log('[CALL] RTCPeerConnection created for accepting call');
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Добавляем отложенные ICE кандидаты если есть
        await addPendingIceCandidates();
        
        // Очищаем старые потоки при новом звонке
        remoteStreams.clear();
        
        peerConnection.ontrack = (event) => {
            console.log('[CALL] Received remote track in accepted call:', event.track.kind, 'streams:', event.streams.length);
            const remoteVideo = document.getElementById('remoteVideo');
            
            if (event.streams && event.streams.length > 0) {
                const stream = event.streams[0];
                const streamId = stream.id;
                
                // Сохраняем поток
                if (!remoteStreams.has(streamId)) {
                    remoteStreams.set(streamId, stream);
                }
                
                // Объединяем все треки из всех потоков
                const combinedStream = new MediaStream();
                remoteStreams.forEach(s => {
                    s.getTracks().forEach(track => {
                        if (track.readyState === 'live') {
                            // Проверяем, не добавлен ли уже этот трек
                            if (!combinedStream.getTracks().some(t => t.id === track.id)) {
                                combinedStream.addTrack(track);
                            }
                        }
                    });
                });
                
                if (remoteVideo && combinedStream.getTracks().length > 0) {
                    // Сохраняем текущий srcObject если есть
                    const currentSrc = remoteVideo.srcObject;
                    
                    remoteVideo.srcObject = combinedStream;
                    remoteVideo.muted = false; // ВАЖНО: не заглушаем для прослушивания аудио
                    remoteVideo.volume = outputVolume; // Применяем настройки громкости вывода
                    remoteVideo.autoplay = true;
                    remoteVideo.playsInline = true;
                    
                    // Применяем выбранное устройство вывода если доступно
                    if (currentOutputDeviceId && 'setSinkId' in remoteVideo) {
                        remoteVideo.setSinkId(currentOutputDeviceId).catch(err => {
                            console.warn('[CALL] Could not set output device:', err);
                        });
                    }
                    
                    // Останавливаем старые треки если они есть
                    if (currentSrc && currentSrc instanceof MediaStream) {
                        currentSrc.getTracks().forEach(track => {
                            if (!combinedStream.getTracks().some(t => t.id === track.id)) {
                                track.stop();
                            }
                        });
                    }
                    
                    // Пытаемся воспроизвести
                    const playPromise = remoteVideo.play();
                    if (playPromise !== undefined) {
                        playPromise.then(() => {
                            console.log('[CALL] Remote video/audio playing successfully');
                        }).catch(err => {
                            console.error('[CALL] Error playing remote video:', err);
                            // Пробуем еще раз после небольшой задержки
                            setTimeout(() => {
                                remoteVideo.play().catch(e => {
                                    console.error('[CALL] Retry play failed:', e);
                                });
                            }, 500);
                        });
                    }
                    
                    remoteVideo.style.display = 'block';
                    remoteVideo.classList.add('fade-in');
                    
                    const placeholder = document.getElementById('callPlaceholder');
                    if (placeholder) {
                        placeholder.style.display = 'none';
                        placeholder.classList.add('fade-out');
                    }
                    
                    const audioTracks = combinedStream.getAudioTracks();
                    const videoTracks = combinedStream.getVideoTracks();
                    console.log('[CALL] Remote stream updated - audio tracks:', audioTracks.length, 'video tracks:', videoTracks.length);
                    console.log('[CALL] All tracks:', combinedStream.getTracks().map(t => `${t.kind}:${t.id}:${t.readyState}`));
                }
            }
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && socket && socket.connected) {
                console.log('Sending ICE candidate from accepted call');
                socket.emit('call_ice_candidate', {
                    to_user_id: userId,
                    candidate: event.candidate
                });
            }
        };
        
        // Устанавливаем offer если он есть
        if (callData.offer) {
            console.log('[CALL] Setting remote description from offer');
            await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
            
            // После установки remote description добавляем отложенные ICE кандидаты
            await addPendingIceCandidates();
            
            const answer = await peerConnection.createAnswer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true // Всегда запрашиваем видео, даже для аудио звонков (для демонстрации экрана)
            });
            await peerConnection.setLocalDescription(answer);
            console.log('[CALL] Sending answer');
            socket.emit('call_answer', {
                to_user_id: userId,
                answer: answer
            });
        }
        
        // Обновляем currentCall
        if (currentCall) {
            currentCall.type = callType;
        } else {
            currentCall = {
                userId: userId,
                userName: friend.username,
                type: callType,
                isInitiator: false
            };
        }
        
        updateCallStatus('В разговоре');
        socket.emit('call_accept', { to_user_id: userId });
    } catch (error) {
        console.error('Error accepting call:', error);
        alert('Не удалось принять звонок: ' + error.message);
        endCall();
    }
}

function handleCallAccepted(data) {
    updateCallStatus('В разговоре');
}

function handleCallRejected(data) {
    alert('Звонок отклонен');
    endCall();
}

function handleCallEnded(data) {
    alert('Звонок завершен');
    endCall();
}

async function handleCallOffer(data) {
    console.log('Received call offer:', data);
    if (!peerConnection) {
        console.error('No peer connection for offer');
        return;
    }
    if (data.offer) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true // Всегда запрашиваем видео, даже для аудио звонков (для демонстрации экрана)
            });
            await peerConnection.setLocalDescription(answer);
            if (socket && socket.connected) {
                socket.emit('call_answer', {
                    to_user_id: data.from_user_id,
                    answer: answer
                });
            }
        } catch (error) {
            console.error('Error handling call offer:', error);
        }
    }
}

async function handleCallAnswer(data) {
    console.log('Received call answer:', data);
    if (!peerConnection) {
        console.error('No peer connection for answer');
        return;
    }
    if (data.answer) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            updateCallStatus('В разговоре');
        } catch (error) {
            console.error('Error handling call answer:', error);
        }
    }
}

async function handleIceCandidate(data) {
    console.log('[CALL] Received ICE candidate:', data);
    if (!data.candidate) {
        console.warn('[CALL] No candidate in ICE candidate data');
        return;
    }
    
    if (!peerConnection) {
        console.log('[CALL] PeerConnection not ready yet, storing ICE candidate');
        pendingIceCandidates.push(data.candidate);
        return;
    }
    
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.log('[CALL] ICE candidate added successfully');
    } catch (error) {
        console.error('[CALL] Error handling ICE candidate:', error);
    }
}

// Функция для добавления отложенных ICE кандидатов
async function addPendingIceCandidates() {
    if (pendingIceCandidates.length > 0 && peerConnection) {
        console.log(`[CALL] Adding ${pendingIceCandidates.length} pending ICE candidates`);
        for (const candidate of pendingIceCandidates) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('[CALL] Error adding pending ICE candidate:', error);
            }
        }
        pendingIceCandidates = [];
    }
}

// ==================== Call Settings Functions ====================

async function toggleCallSettings() {
    const panel = document.getElementById('callSettingsPanel');
    const settingsBtn = document.getElementById('callSettingsBtn');
    
    if (!panel) return;
    
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'block';
    
    if (settingsBtn) {
        settingsBtn.classList.toggle('active', !isVisible);
    }
    
    if (!isVisible) {
        await loadAudioDevices();
        updateVolumeSliders();
    }
}

async function loadAudioDevices() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            console.warn('[CALL SETTINGS] enumerateDevices not supported');
            return;
        }
        
        // Запрашиваем разрешение на доступ к микрофону для получения полного списка устройств
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            console.warn('[CALL SETTINGS] Could not get user media for device enumeration:', e);
        }
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.log('[CALL SETTINGS] Available devices:', devices);
        
        audioDevices.input = devices.filter(device => device.kind === 'audioinput');
        audioDevices.output = devices.filter(device => device.kind === 'audiooutput');
        
        const inputSelect = document.getElementById('inputDeviceSelect');
        const outputSelect = document.getElementById('outputDeviceSelect');
        
        if (inputSelect) {
            inputSelect.innerHTML = '';
            audioDevices.input.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Микрофон ${index + 1}`;
                if (device.deviceId === currentInputDeviceId || (!currentInputDeviceId && index === 0)) {
                    option.selected = true;
                    currentInputDeviceId = device.deviceId;
                }
                inputSelect.appendChild(option);
            });
        }
        
        if (outputSelect) {
            outputSelect.innerHTML = '';
            audioDevices.output.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Динамики ${index + 1}`;
                if (device.deviceId === currentOutputDeviceId || (!currentOutputDeviceId && index === 0)) {
                    option.selected = true;
                    currentOutputDeviceId = device.deviceId;
                }
                outputSelect.appendChild(option);
            });
        }
        
        // Применяем текущие настройки
        applyOutputVolume();
        applyInputVolume();
        
    } catch (error) {
        console.error('[CALL SETTINGS] Error loading audio devices:', error);
    }
}

function updateVolumeSliders() {
    const outputSlider = document.getElementById('outputVolumeSlider');
    const inputSlider = document.getElementById('inputVolumeSlider');
    const outputValue = document.getElementById('outputVolumeValue');
    const inputValue = document.getElementById('inputVolumeValue');
    
    if (outputSlider) {
        outputSlider.value = Math.round(outputVolume * 100);
    }
    if (outputValue) {
        outputValue.textContent = `${Math.round(outputVolume * 100)}%`;
    }
    
    if (inputSlider) {
        inputSlider.value = Math.round(inputVolume * 100);
    }
    if (inputValue) {
        inputValue.textContent = `${Math.round(inputVolume * 100)}%`;
    }
}

function handleOutputVolumeChange(event) {
    outputVolume = event.target.value / 100;
    const outputValue = document.getElementById('outputVolumeValue');
    if (outputValue) {
        outputValue.textContent = `${event.target.value}%`;
    }
    applyOutputVolume();
}

function handleInputVolumeChange(event) {
    inputVolume = event.target.value / 100;
    const inputValue = document.getElementById('inputVolumeValue');
    if (inputValue) {
        inputValue.textContent = `${event.target.value}%`;
    }
    applyInputVolume();
}

function applyOutputVolume() {
    const remoteVideo = document.getElementById('remoteVideo');
    if (remoteVideo) {
        remoteVideo.volume = outputVolume;
        console.log('[CALL SETTINGS] Output volume set to:', outputVolume);
    }
}

function applyInputVolume() {
    if (localStream) {
        const audioTracks = localStream.getAudioTracks();
        audioTracks.forEach(track => {
            if (track.getSettings && track.getSettings().volume !== undefined) {
                track.applyConstraints({ volume: inputVolume }).catch(err => {
                    console.warn('[CALL SETTINGS] Could not set input volume:', err);
                });
            }
        });
        console.log('[CALL SETTINGS] Input volume set to:', inputVolume);
    }
}

async function handleOutputDeviceChange(event) {
    const deviceId = event.target.value;
    currentOutputDeviceId = deviceId;
    
    const remoteVideo = document.getElementById('remoteVideo');
    if (remoteVideo && 'setSinkId' in remoteVideo) {
        try {
            await remoteVideo.setSinkId(deviceId);
            console.log('[CALL SETTINGS] Output device changed to:', deviceId);
        } catch (error) {
            console.error('[CALL SETTINGS] Error setting output device:', error);
        }
    } else {
        console.warn('[CALL SETTINGS] setSinkId not supported in this browser');
    }
}

async function handleInputDeviceChange(event) {
    const deviceId = event.target.value;
    currentInputDeviceId = deviceId;
    
    if (!localStream) {
        console.warn('[CALL SETTINGS] No local stream to change input device');
        return;
    }
    
    try {
        // Получаем новый аудио поток с выбранным устройством
        const newStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: deviceId } },
            video: localStream.getVideoTracks().length > 0 ? {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } : false
        });
        
        // Заменяем аудио треки в localStream
        const oldAudioTracks = localStream.getAudioTracks();
        const newAudioTrack = newStream.getAudioTracks()[0];
        
        if (newAudioTrack && peerConnection) {
            // Находим sender для аудио
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (sender) {
                await sender.replaceTrack(newAudioTrack);
                console.log('[CALL SETTINGS] Input device changed, track replaced');
            } else {
                // Если нет sender, добавляем новый трек
                peerConnection.addTrack(newAudioTrack, localStream);
                console.log('[CALL SETTINGS] Input device changed, track added');
            }
            
            // Останавливаем старые треки
            oldAudioTracks.forEach(track => track.stop());
            
            // Удаляем старые треки из localStream и добавляем новый
            oldAudioTracks.forEach(track => localStream.removeTrack(track));
            localStream.addTrack(newAudioTrack);
            
            // Применяем громкость
            applyInputVolume();
            
            // Обновляем localVideo если есть
            const localVideo = document.getElementById('localVideo');
            if (localVideo) {
                localVideo.srcObject = localStream;
            }
            
            // Создаем новый offer для пересогласования
            if (peerConnection.signalingState !== 'stable') {
                console.log('[CALL SETTINGS] Waiting for stable state before renegotiation');
                return;
            }
            
            try {
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                
                if (socket && socket.connected && currentCall) {
                    socket.emit('call_offer', {
                        to: currentCall.other_user_id,
                        offer: offer
                    });
                    console.log('[CALL SETTINGS] Sent new offer after input device change');
                }
            } catch (error) {
                console.error('[CALL SETTINGS] Error creating offer after device change:', error);
            }
        }
        
        // Останавливаем остальные треки из newStream
        newStream.getTracks().forEach(track => {
            if (track !== newAudioTrack) track.stop();
        });
        
    } catch (error) {
        console.error('[CALL SETTINGS] Error changing input device:', error);
        alert('Не удалось переключить устройство ввода. Убедитесь, что устройство подключено и доступно.');
    }
}

async function testAudio() {
    const testBtn = document.getElementById('testAudioBtn');
    if (!testBtn) return;
    
    try {
        if (testAudioContext) {
            // Останавливаем тест
            testAudioContext.close();
            testAudioContext = null;
            testAudioSource = null;
            testBtn.textContent = 'Тест звука';
            return;
        }
        
        // Создаем тестовый звук
        testAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        testAudioSource = testAudioContext.createOscillator();
        const gainNode = testAudioContext.createGain();
        
        testAudioSource.type = 'sine';
        testAudioSource.frequency.value = 440; // Ля первой октавы
        gainNode.gain.value = 0.1;
        
        testAudioSource.connect(gainNode);
        gainNode.connect(testAudioContext.destination);
        
        testAudioSource.start();
        testBtn.textContent = 'Остановить тест';
        
        // Останавливаем через 2 секунды
        setTimeout(() => {
            if (testAudioSource) {
                testAudioSource.stop();
                testAudioContext.close();
                testAudioContext = null;
                testAudioSource = null;
                testBtn.textContent = 'Тест звука';
            }
        }, 2000);
        
    } catch (error) {
        console.error('[CALL SETTINGS] Error testing audio:', error);
        alert('Не удалось воспроизвести тестовый звук.');
    }
}
