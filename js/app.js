// ============================================
// StudentConnect - Navigation Router & App Logic
// ============================================

const App = {
  currentScreen: null,
  history: [],

  screens: {
    splash: { nav: false },
    login: { nav: false },
    create: { nav: false },
    home: { nav: true, navItem: 'home' },
    chat: { nav: true, navItem: 'chat' },
    alerts: { nav: true, navItem: 'alerts' },
    settings: { nav: true, navItem: 'settings' },
    notifications: { nav: false },
    privacy: { nav: false },
    password: { nav: false },
    'user-profile': { nav: false },
  },

  supabase: null,
  currentUser: null,
  currentProfile: null,
  messageSubscription: null,
  presenceChannel: null,
  unreadCount: 0,
  currentScreen: 'splash',

  async init() {
    this.initDarkMode();
    this.bindEvents();
    await this.initSupabase();
  },

  async initSupabase() {
    if (typeof supabase === 'undefined') {
      console.error("Supabase JS not loaded");
      this.navigate('splash');
      return;
    }
    
    this.supabase = supabase.createClient('https://nrwlciwnjpwetxrhwftm.supabase.co', 'sb_publishable_K-deyGfvdwlqJPnXTmLt6Q_4C5WBfPG');
    
    const { data: { session } } = await this.supabase.auth.getSession();
    if (session) {
      this.currentUser = session.user;
      await this.fetchOwnProfile();
      this.updateProfileUI();
      this.navigate('home', false);
      await this.fetchMessages();
      this.subscribeToMessages();
      this.trackPresence();
    } else {
      this.navigate('splash', false);
    }
    
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      this.currentUser = session ? session.user : null;
      if (this.currentUser) {
        await this.fetchOwnProfile();
        this.updateProfileUI();
        // Re-load chat history and real-time subscription after login
        if (event === 'SIGNED_IN') {
          this.fetchMessages();
          this.subscribeToMessages();
          this.trackPresence();
        }
      }
    });
  },

  async fetchOwnProfile() {
    if (!this.currentUser) return;
    const { data } = await this.supabase.from('profiles').select('*').eq('id', this.currentUser.id).single();
    if (data) {
      this.currentProfile = data;
    } else {
      this.currentProfile = { full_name: this.currentUser.user_metadata?.full_name || 'Student', avatar_url: null };
    }
  },

  updateProfileUI() {
    if (!this.currentUser || !this.currentProfile) return;
    const nameEl = document.getElementById('profile-name');
    const emailEl = document.getElementById('profile-email');
    const avatarEl = document.getElementById('profile-avatar');
    
    const fullName = this.currentProfile.full_name || 'Student';
    
    if (nameEl) nameEl.textContent = fullName;
    if (emailEl) emailEl.textContent = this.currentUser.email;
    if (avatarEl && this.currentProfile.avatar_url) {
      avatarEl.src = this.currentProfile.avatar_url;
    }
  },

  showAuthMessage(containerId, message, type) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!message) {
      el.className = 'auth-message';
      el.innerHTML = '';
      return;
    }
    el.className = `auth-message visible ${type}`;
    const icon = type === 'error' ? 'error' : 'check_circle';
    el.innerHTML = `<span class="material-symbols-outlined">${icon}</span> <span>${message}</span>`;
  },

  // ---- Notifications / Unread State ----
  trackPresence() {
    if (this.presenceChannel || !this.currentUser) return;
    
    this.presenceChannel = this.supabase.channel('online-users', {
      config: { presence: { key: this.currentUser.id } }
    });
    
    this.presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = this.presenceChannel.presenceState();
        const count = Object.keys(state).length;
        this.updateOnlineCount(count);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.presenceChannel.track({
            user_id: this.currentUser.id,
            online_at: new Date().toISOString()
          });
        }
      });
  },

  updateOnlineCount(count) {
    const el = document.getElementById('online-count');
    if (el) {
      const label = count === 1 ? 'student online' : 'students online';
      el.innerHTML = `<span class="online-dot"></span> ${count} ${label}`;
    }
  },

  clearUnreadBadge() {
    this.unreadCount = 0;
    const badge = document.getElementById('chat-badge');
    if (badge) badge.style.display = 'none';
    const toast = document.getElementById('in-app-toast');
    if (toast) toast.classList.remove('show');
  },

  async updateLastReadAt() {
    if (!this.currentUser) return;
    const now = new Date().toISOString();
    await this.supabase.from('profiles').update({ last_read_at: now }).eq('id', this.currentUser.id);
    if (this.currentProfile) this.currentProfile.last_read_at = now;
  },

  incrementUnreadBadge() {
    this.unreadCount++;
    const badge = document.getElementById('chat-badge');
    if (badge) {
      badge.textContent = this.unreadCount > 9 ? '9+' : this.unreadCount;
      badge.style.display = 'flex';
    }
  },

  showToast(msg, profileInfo) {
    const toast = document.getElementById('in-app-toast');
    if (!toast) return;
    const avatarUrl = profileInfo?.avatar_url || 'assets/logo.png';
    const name = profileInfo?.full_name || 'Student';
    
    toast.innerHTML = `
      <img src="${avatarUrl}" alt="Avatar" />
      <div class="in-app-toast-content">
        <h4>${name}</h4>
        <p>${msg.text}</p>
      </div>
    `;
    toast.classList.add('show');
    
    toast.onclick = () => {
      toast.classList.remove('show');
      this.navigate('chat');
    };
    
    setTimeout(() => toast.classList.remove('show'), 5000);
  },

  // ---- Chat ----
  async fetchMessages() {
    const { data, error } = await this.supabase
      .from('messages')
      .select('*, profiles (full_name, avatar_url)')
      .order('created_at', { ascending: true });
      
    if (error) {
      console.error('Error fetching messages:', error);
      return;
    }
    
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;
    messagesContainer.innerHTML = '';
    
    if (data.length === 0) {
       messagesContainer.innerHTML = `
         <div class="empty-state" id="chat-empty-state">
           <div class="empty-icon"><span class="material-symbols-outlined" style="font-size:32px">forum</span></div>
           <h3>No Messages Yet</h3>
           <p>Start the conversation by sending a message below!</p>
         </div>`;
       return;
    }
    
    // Determine last read
    const lastRead = this.currentProfile?.last_read_at ? new Date(this.currentProfile.last_read_at) : new Date(0);
    this.unreadCount = 0;
    
    data.forEach(msg => {
       if (new Date(msg.created_at) > lastRead && msg.user_id !== this.currentUser?.id) {
           this.unreadCount++;
       }
       this.renderMessage(msg);
    });
    
    if (this.currentScreen !== 'chat' && this.unreadCount > 0) {
      const badge = document.getElementById('chat-badge');
      if (badge) {
        badge.textContent = this.unreadCount > 9 ? '9+' : this.unreadCount;
        badge.style.display = 'flex';
      }
    }
  },
  
  renderMessage(msg) {
     const emptyState = document.getElementById('chat-empty-state');
     if (emptyState) emptyState.remove();
     
     const messagesContainer = document.getElementById('chat-messages');
     const bodyContainer = document.getElementById('chat-body');
     if (!messagesContainer || !bodyContainer) return;
     
     const isMine = this.currentUser && msg.user_id === this.currentUser.id;
     
     // Main wrapper
     const wrapper = document.createElement('div');
     wrapper.className = isMine ? 'message-with-avatar sent' : 'message-with-avatar received';
     
     // Avatar
     const avatar = document.createElement('img');
     avatar.className = 'chat-avatar';
     const profileInfo = msg.profiles || { full_name: msg.sender_full_name, avatar_url: null };
     avatar.src = profileInfo.avatar_url || 'assets/logo.png';
     avatar.alt = profileInfo.full_name || 'Student';
     
     // Navigation on click
     avatar.addEventListener('click', () => {
       if (msg.user_id) this.viewUserProfile(msg.user_id);
     });
          const msgDiv = document.createElement('div');
      msgDiv.className = isMine ? 'message message-sent' : 'message message-received';
      
      // Add sender name Above the Bubble
      const senderName = document.createElement('div');
      senderName.className = 'message-sender-name';
      
      // Handle Profile Data Joins (sometimes returned as array)
      let nameToDisplay = 'Student';
      if (profileInfo) {
        if (Array.isArray(profileInfo)) {
          nameToDisplay = profileInfo[0]?.full_name || msg.sender_full_name || 'Student';
        } else {
          nameToDisplay = profileInfo.full_name || msg.sender_full_name || 'Student';
        }
      }
      
      senderName.textContent = isMine ? 'You' : nameToDisplay;
      msgDiv.appendChild(senderName);
     
     const bubble = document.createElement('div');
     bubble.className = 'message-bubble';
     bubble.textContent = msg.text;
     
     const time = document.createElement('div');
     time.className = 'message-time';
     const date = new Date(msg.created_at);
     time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
     
     msgDiv.appendChild(bubble);
     msgDiv.appendChild(time);
     
     if (isMine) {
       wrapper.appendChild(msgDiv);
       wrapper.appendChild(avatar);
     } else {
       wrapper.appendChild(avatar);
       wrapper.appendChild(msgDiv);
     }
     
     messagesContainer.appendChild(wrapper);
     bodyContainer.scrollTop = bodyContainer.scrollHeight;
  },

  subscribeToMessages() {
    if (this.messageSubscription) return;
    
    this.messageSubscription = this.supabase
      .channel('public:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async payload => {
        const msg = payload.new;
        if (!msg.profiles && msg.user_id) {
          const { data } = await this.supabase.from('profiles').select('full_name, avatar_url').eq('id', msg.user_id).single();
          msg.profiles = data || { full_name: msg.sender_full_name, avatar_url: null };
        }
        
        this.renderMessage(msg);
        
        if (this.currentScreen !== 'chat' && msg.user_id !== this.currentUser?.id) {
          this.incrementUnreadBadge();
          this.showToast(msg, msg.profiles);
        } else if (this.currentScreen === 'chat') {
          this.updateLastReadAt();
        }
      })
      .subscribe();
  },

  async sendMessage() {
    const input = document.getElementById('chat-input');
    
    if (!input || !this.currentUser) return;

    const text = input.value.trim();
    if (!text) return;

    input.value = '';

    const fullName = this.currentUser.user_metadata?.full_name || 'Student';

    const { error } = await this.supabase
      .from('messages')
      .insert([{ 
        text: text, 
        user_id: this.currentUser.id,
        sender_full_name: fullName
      }]);
      
    if (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message.');
    }
  },

  // ---- Dark Mode ----
  initDarkMode() {
    const saved = localStorage.getItem('sc-dark-mode');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = saved ? saved === 'true' : prefersDark;
    this.setDarkMode(isDark, false);
  },

  setDarkMode(enabled, save = true) {
    const html = document.documentElement;
    if (enabled) {
      html.setAttribute('data-theme', 'dark');
    } else {
      html.removeAttribute('data-theme');
    }
    const toggle = document.getElementById('dark-mode-toggle');
    if (toggle) toggle.checked = enabled;
    if (save) localStorage.setItem('sc-dark-mode', enabled);
  },

  // ---- Navigation ----
  navigate(targetScreen, pushHistory = true) {
    if (!this.screens[targetScreen]) return;
    
    // Unread Tracker Update
    this.currentScreen = targetScreen;
    if (targetScreen === 'chat') {
      this.clearUnreadBadge();
      this.updateLastReadAt();
      // Always reload messages from database when opening chat
      if (this.supabase && this.currentUser) {
        this.fetchMessages();
      }
    }
    
    const currScreens = document.querySelectorAll('.screen');
    currScreens.forEach(s => {
      s.classList.remove('active');
      s.style.display = 'none';
    });

    const target = document.getElementById(`${targetScreen}-screen`);
    if (target) {
      target.style.display = 'block';
      setTimeout(() => target.classList.add('active'), 10);
    }

    if (pushHistory) {
      this.history.push(targetScreen);
    }

    const nav = document.getElementById('bottom-nav');
    if (this.screens[targetScreen].nav) {
      nav.classList.add('visible');
      this.setActiveNav(targetScreen);
    } else {
      nav.classList.remove('visible');
    }
  },

  goBack() {
    if (this.history.length > 0) {
      const prev = this.history.pop();
      this.navigate(prev, false);
    }
  },

  setActiveNav(itemName) {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.nav === itemName);
      const icon = item.querySelector('.material-symbols-outlined');
      if (item.dataset.nav === itemName) {
        icon.style.fontVariationSettings = "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24";
      } else {
        icon.style.fontVariationSettings = "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24";
      }
    });
  },

  // ---- Profiles & Avatars ----
  async uploadAvatar(file) {
    if (!this.currentUser) return;
    const fileExt = file.name.split('.').pop();
    const fileName = `${this.currentUser.id}.${fileExt}`;
    const filePath = `${fileName}`;

    // Upload
    const { error: uploadError } = await this.supabase.storage
      .from('avatars')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      alert('Error uploading avatar: ' + uploadError.message);
      return;
    }

    // Get public URL
    const { data } = this.supabase.storage.from('avatars').getPublicUrl(filePath);
    const publicUrl = data.publicUrl;

    // Update Profile
    await this.supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', this.currentUser.id);
    if (!this.currentProfile) this.currentProfile = {};
    this.currentProfile.avatar_url = publicUrl;
    this.updateProfileUI();
  },

  async viewUserProfile(userId) {
    this.navigate('user-profile');
    const nameEl = document.getElementById('view-user-name');
    const avatarEl = document.getElementById('view-user-avatar');
    if (!nameEl || !avatarEl) return;
    
    nameEl.textContent = "Loading...";
    avatarEl.src = "assets/logo.png";

    const { data } = await this.supabase.from('profiles').select('*').eq('id', userId).single();
    if (data) {
      nameEl.textContent = data.full_name || 'Student';
      if (data.avatar_url) avatarEl.src = data.avatar_url;
    } else {
      nameEl.textContent = "Unknown User";
    }
  },

  // ---- Event Bindings ----
  bindEvents() {
    // Avatar Upload
    const avatarContainer = document.getElementById('avatar-upload-container');
    const avatarInput = document.getElementById('avatar-upload');
    if (avatarContainer && avatarInput) {
      avatarContainer.addEventListener('click', () => avatarInput.click());
      avatarInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          const img = document.getElementById('profile-avatar');
          if (img) img.style.opacity = '0.5'; // Loading state
          await this.uploadAvatar(file);
          if (img) img.style.opacity = '1';
        }
      });
    }

    // Splash
    document.getElementById('splash-get-started')?.addEventListener('click', () => this.navigate('create'));
    document.getElementById('splash-sign-in')?.addEventListener('click', () => this.navigate('login'));

    // Logout
    document.getElementById('settings-logout')?.addEventListener('click', async () => {
      if (this.supabase) {
        await this.supabase.auth.signOut();
        if (this.messageSubscription) {
          this.supabase.removeChannel(this.messageSubscription);
          this.messageSubscription = null;
        }
        if (this.presenceChannel) {
          this.supabase.removeChannel(this.presenceChannel);
          this.presenceChannel = null;
        }
      }
      this.currentUser = null;
      this.currentProfile = null;
      document.getElementById('chat-messages').innerHTML = '';
      this.clearUnreadBadge();
      this.history = [];
      this.navigate('splash');
    });

    // Auth Tabs
    document.getElementById('tab-login')?.addEventListener('click', () => this.navigate('login', false));
    document.getElementById('tab-create')?.addEventListener('click', () => this.navigate('create', false));

    // Login Form
    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const pwd = document.getElementById('login-password').value;
      const btn = e.target.querySelector('button[type="submit"]');
      
      this.showAuthMessage('login-message', '', '');
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined" style="animation: spin 1s linear infinite">refresh</span> Signing in...';
      
      const { data, error } = await this.supabase.auth.signInWithPassword({ email, password: pwd });
      
      btn.disabled = false;
      btn.innerHTML = 'Sign In to the Stream <span class="material-symbols-outlined" style="font-size:18px">arrow_forward</span>';
      
      if (error) {
        this.showAuthMessage('login-message', error.message, 'error');
      } else {
        this.currentUser = data.session.user;
        this.updateProfileUI();
        this.navigate('home');
        this.fetchMessages();
        this.subscribeToMessages();
      }
    });

    // Create Account Form
    document.getElementById('create-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inputs = e.target.querySelectorAll('input');
      const name = inputs[0].value;
      const email = inputs[1].value;
      const pwd1 = inputs[2].value;
      const pwd2 = inputs[3].value;
      
      this.showAuthMessage('create-message', '', '');
      
      if (pwd1 !== pwd2) {
        this.showAuthMessage('create-message', 'Passwords do not match.', 'error');
        return;
      }
      
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined" style="animation: spin 1s linear infinite">refresh</span> Creating...';
      
      const { data, error } = await this.supabase.auth.signUp({ 
        email, 
        password: pwd1, 
        options: { data: { full_name: name } } 
      });
      
      btn.disabled = false;
      btn.innerHTML = '<span>Create My Account</span><span class="material-symbols-outlined">arrow_forward</span>';
      
      if (error) {
        this.showAuthMessage('create-message', error.message, 'error');
      } else if (!data.session) {
        this.showAuthMessage('create-message', 'Success! Please check your email to confirm your account.', 'success');
      } else {
        this.currentUser = data.session.user;
        this.updateProfileUI();
        this.navigate('home');
        this.fetchMessages();
        this.subscribeToMessages();
      }
    });
    document.getElementById('create-login-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.navigate('login');
    });

    // Google Sign-In
    const handleGoogleAuth = (selector) => {
      const btn = document.querySelector(selector);
      if (!btn) return;
      btn.addEventListener('click', async () => {
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined" style="animation: spin 1s linear infinite; margin-right: 8px;">refresh</span> <span class="font-headline">Connecting...</span>';
        
        // Use Supabase signInWithOAuth for Google
        const { error } = await this.supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin + window.location.pathname
          }
        });
        
        if (error) {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
          alert("Google Sign-In failed: " + error.message);
        }
      });
    };

    handleGoogleAuth('.google-btn');
    handleGoogleAuth('.create-google');

    // Bottom Nav
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const target = item.dataset.nav;
        if (target && this.screens[target]) {
          this.history = [];
          this.navigate(target);
        }
      });
    });

    // Settings sub-screens
    document.getElementById('settings-notifications')?.addEventListener('click', () => this.navigate('notifications'));
    document.getElementById('settings-privacy')?.addEventListener('click', () => this.navigate('privacy'));
    document.getElementById('privacy-change-password')?.addEventListener('click', () => this.navigate('password'));

    // Back buttons
    document.querySelectorAll('[data-action="back"]').forEach(btn => {
      btn.addEventListener('click', () => this.goBack());
    });

    // Dark Mode Toggle
    document.getElementById('dark-mode-toggle')?.addEventListener('change', (e) => {
      this.setDarkMode(e.target.checked);
    });

    // Chat Message Send
    document.getElementById('chat-send-btn')?.addEventListener('click', () => {
      this.sendMessage();
    });
    document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendMessage();
      }
    });

    // Password visibility toggles
    document.querySelectorAll('.toggle-password').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = btn.closest('.input-group').querySelector('input');
        const icon = btn.querySelector('.material-symbols-outlined');
        if (input.type === 'password') {
          input.type = 'text';
          icon.textContent = 'visibility_off';
        } else {
          input.type = 'password';
          icon.textContent = 'visibility';
        }
      });
    });

    // Logout
    document.getElementById('settings-logout')?.addEventListener('click', async () => {
      if (this.supabase) {
        await this.supabase.auth.signOut();
      }
      this.history = [];
      this.navigate('splash');
    });
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
