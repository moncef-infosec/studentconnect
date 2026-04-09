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
    language: { nav: false },
  },

  supabase: null,
  currentUser: null,
  currentProfile: null,
  messageSubscription: null,
  presenceChannel: null,
  unreadCount: 0,
  currentScreen: 'splash',
  isReady: false,

  async init() {
    this.initDarkMode();
    this.initLanguage();
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
    
    // Check initial session
    const { data: { session } } = await this.supabase.auth.getSession();
    if (session) {
      this.currentUser = session.user;
      // Handle initial navigation but let onAuthStateChange trigger data loading
      this.navigate('home', false);
    } else {
      this.navigate('splash', false);
    }
    
    // Single source of truth for auth-related data loading
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth Event:", event);
      this.currentUser = session ? session.user : null;
      
      if (this.currentUser) {
        // Fix for Redirect/Sign-In Navigation:
        if (event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && (this.currentScreen === 'splash' || this.currentScreen === 'login' || this.currentScreen === 'create'))) {
          console.log("Navigating home from", this.currentScreen, "on", event);
          this.navigate('home');
        }

        if (!this.isReady || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          await this.onUserReady(this.currentUser);
        }
      } else {
        this.isReady = false;
        // Auto-redirect to splash on logout
        if (this.currentScreen && !['splash', 'login', 'create'].includes(this.currentScreen)) {
          this.navigate('splash');
        }
      }
    });
  },

  async onUserReady(user) {
    this.isReady = true;
    
    // Clean up URL after successful redirect login
    if (window.location.hash.includes('access_token')) {
      window.history.replaceState('', document.title, window.location.pathname + window.location.search);
    }

    // CRITICAL: Ensure profile exists before proceeding
    // This allows message insertion which requires a profile FK.
    await this.fetchOwnProfile();
    this.updateProfileUI();
    
    // UI logic: Load cache instantly
    this.loadFromCache();
    
    // Database logic: Refresh and listen
    this.fetchMessages(); 
    this.subscribeToMessages();
    this.trackPresence();
    this.requestNotificationPermission();
    
    console.log("App ready for User ID:", user.id);
  },

  saveToCache(data) {
    try {
      // Save last 200 messages to local storage for deep history
      const cacheData = data.slice(-200);
      localStorage.setItem('studentconnect_chat_cache', JSON.stringify(cacheData));
    } catch (e) {
      console.warn("Failed to save to cache:", e);
    }
  },

  loadFromCache() {
    try {
      const cached = localStorage.getItem('studentconnect_chat_cache');
      if (cached) {
        const data = JSON.parse(cached);
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
          messagesContainer.innerHTML = '';
          data.forEach(msg => this.renderMessage(msg));
          console.log("Loaded from cache:", data.length, "messages");
        }
      }
    } catch (e) {
      console.warn("Failed to load from cache:", e);
    }
  },

  async fetchOwnProfile() {
    if (!this.currentUser) return;
    
    const profileData = {
      id: this.currentUser.id,
      full_name: this.currentUser.user_metadata?.full_name || this.currentUser.email.split('@')[0],
      avatar_url: this.currentUser.user_metadata?.avatar_url || null
    };

    // Use UPSERT to handle both new and existing users correctly.
    // This fixes the "Failed to send message" error caused by missing Foreign Keys.
    const { data, error } = await this.supabase
      .from('profiles')
      .upsert(profileData)
      .select()
      .single();

    if (error) {
      console.warn("Profile sync error:", error);
      // Fallback: use memory data if DB fails
      this.currentProfile = profileData;
    } else {
      this.currentProfile = data;
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

  // ---- System Notifications ----
  async requestNotificationPermission() {
    if (!('Notification' in window)) return;
    
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        console.log("Notification permission granted!");
      }
    }
  },

  async showSystemNotification(msg, profileInfo) {
    if (Notification.permission !== 'granted') return;
    
    const name = profileInfo?.full_name || 'Student';
    const body = msg.text;
    const icon = profileInfo?.avatar_url || 'assets/logo.png';
    const tag = 'studentconnect-msg'; // Replaces old message with new one on same tag

    // Using Service Worker is more reliable for mobile phone notifications
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(name, {
        body: body,
        icon: icon,
        badge: 'assets/logo.png',
        tag: tag,
        vibrate: [100, 50, 100],
        data: { url: window.location.origin + window.location.pathname + '#chat' }
      });
    } else {
      // Fallback to basic API
      new Notification(name, { body, icon, tag });
    }
  },

  // ---- Chat ----
  async fetchMessages() {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;
    
    // Visual feedback that we're loading fresh data
    messagesContainer.style.opacity = '0.7';
    
    const { data, error } = await this.supabase
      .from('messages')
      .select('*, profiles (id, full_name, avatar_url)')
      .order('created_at', { ascending: true });
      
    messagesContainer.style.opacity = '1';

    if (error) {
      console.error('Error fetching messages:', error);
      // If we have cached messages, keep them. Otherwise show error.
      if (messagesContainer.children.length === 0) {
        messagesContainer.innerHTML = `<div class="empty-state"><h3>Connection Error</h3><p>Could not load history. Please check your internet.</p></div>`;
      }
      return;
    }
    
    // ATOMIC UPDATE: Build in fragment first to prevent flickering
    const fragment = document.createDocumentFragment();
    
    if (data.length === 0) {
       const empty = document.createElement('div');
       empty.className = 'empty-state';
       empty.id = 'chat-empty-state';
       empty.innerHTML = `
           <div class="empty-icon"><span class="material-symbols-outlined" style="font-size:32px">forum</span></div>
           <h3>No Messages Yet</h3>
           <p>Start the conversation by sending a message below!</p>`;
       fragment.appendChild(empty);
    } else {
       // Determine last read
       const lastRead = this.currentProfile?.last_read_at ? new Date(this.currentProfile.last_read_at) : new Date(0);
       this.unreadCount = 0;
       
       let lastDate = null;
       data.forEach(msg => {
          const msgDate = new Date(msg.created_at);
          
          // Insert date separator if day changed
          if (!lastDate || !this.isSameDay(lastDate, msgDate)) {
            this.renderDateSeparator(this.formatDateLabel(msgDate), fragment);
            lastDate = msgDate;
          }

          if (msgDate > lastRead && msg.user_id !== this.currentUser?.id) {
              this.unreadCount++;
          }
          this.renderMessage(msg, fragment);
       });
       
       // Track the last rendered date for real-time updates
       this.lastRenderedDate = lastDate;
    }

    // SWAP: Clear and update in one operation
    messagesContainer.innerHTML = '';
    messagesContainer.appendChild(fragment);

    // Update Cache
    this.saveToCache(data);

    // Manual scroll is no longer needed with column-reverse
    
    if (this.currentScreen !== 'chat' && this.unreadCount > 0) {
      const badge = document.getElementById('chat-badge');
      if (badge) {
        badge.textContent = this.unreadCount > 9 ? '9+' : this.unreadCount;
        badge.style.display = 'flex';
      }
    }

    // Ensure we start at the latest message instantly on load
    this.scrollToBottom(false);
  },

  isSameDay(d1, d2) {
    if (!d1 || !d2) return false;
    const date1 = new Date(d1);
    const date2 = new Date(d2);
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  },

  formatDateLabel(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);

    if (this.isSameDay(date, now)) return 'Today';
    if (this.isSameDay(date, yesterday)) return 'Yesterday';

    return date.toLocaleDateString(undefined, { 
      month: 'long', 
      day: 'numeric', 
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined 
    });
  },

  renderDateSeparator(label, container) {
    const separator = document.createElement('div');
    separator.className = 'date-separator';
    separator.innerHTML = `<span class="date-label">${label}</span>`;
    container.appendChild(separator);
  },

  scrollToBottom(smooth = true) {
    const body = document.getElementById('chat-body');
    if (!body) return;
    
    // In column-reverse, the latest message is at the bottom of the container.
    // Use scrollIntoView with configurable behavior (smooth vs instant).
    const messages = document.getElementById('chat-messages');
    if (messages && messages.lastElementChild) {
      messages.lastElementChild.scrollIntoView({ 
        behavior: smooth ? 'smooth' : 'auto', 
        block: 'end' 
      });
    } else {
      body.scrollTop = body.scrollHeight;
    }
  },
  
  renderMessage(msg, container = null) {
      const emptyState = document.getElementById('chat-empty-state');
      if (emptyState) emptyState.remove();
      
      const messagesContainer = container || document.getElementById('chat-messages');
      const bodyContainer = document.getElementById('chat-body');
      if (!messagesContainer || !bodyContainer) return;

      // Handle real-time date separators (when not rendering a batch in a fragment)
      if (!container) {
        const msgDate = new Date(msg.created_at);
        if (!this.lastRenderedDate || !this.isSameDay(this.lastRenderedDate, msgDate)) {
          this.renderDateSeparator(this.formatDateLabel(msgDate), messagesContainer);
          this.lastRenderedDate = msgDate;
        }
      }
      
      const isMine = this.currentUser && msg.user_id === this.currentUser.id;
      
      // Main wrapper
      const wrapper = document.createElement('div');
      wrapper.className = isMine ? 'message-with-avatar sent' : 'message-with-avatar received';
      
      // Avatar
      const avatar = document.createElement('img');
      avatar.className = 'chat-avatar';
      
      // Improved Profile Selection (Handles array or object)
      let profileInfo = msg.profiles;
      if (Array.isArray(profileInfo)) profileInfo = profileInfo[0];
      if (!profileInfo) profileInfo = { full_name: msg.sender_full_name, avatar_url: null };
      
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
     
     // APPEND for normal DOM order (parent handles visual inversion)
     messagesContainer.appendChild(wrapper);
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
          
          // Trigger system notification if screen is hidden or user is elsewhere
          if (document.visibilityState === 'hidden' || this.currentScreen !== 'chat') {
            this.showSystemNotification(msg, msg.profiles);
          }
        } else if (this.currentScreen === 'chat') {
          this.updateLastReadAt();
          this.scrollToBottom();
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

    const fullName = this.currentProfile?.full_name || this.currentUser.user_metadata?.full_name || 'Student';

    const { error } = await this.supabase
      .from('messages')
      .insert([{ 
        text: text, 
        user_id: this.currentUser.id,
        sender_full_name: fullName
      }]);
      
    if (error) {
      console.error('Error sending message:', error);
      alert(`Failed to send message: ${error.message || 'Database error'}`);
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

  // ---- Language & Translation ----
  translations: {
    en: {
      app_name: "StudentConnect",
      splash_subtitle: "Connecting Students, Empowering Education",
      community_hub: "Community Hub",
      active_scholarly_pulse: "Active scholarly pulse",
      get_started: "Get Started",
      sign_in: "Sign In",
      auth_subtitle: "Your academic journey, choreographed.",
      sign_in_tab: "Sign in",
      create_account_tab: "Create Account",
      email_label: "Gmail Address",
      gmail_restriction: "Registration restricted to @gmail.com accounts only.",
      password_label: "Password",
      forgot_password: "Forgot Password?",
      submit_login: "Sign In to the Stream",
      or_continue: "Or continue with",
      auth_footer_1: "By signing in, you agree to the Scholarly Terms of Service and Privacy Charter.",
      terms: "Scholarly Terms of Service",
      privacy: "Privacy Charter",
      system_optimal: "System Status: Optimal",
      create_title: "Create your scholarly profile.",
      google_signup: "Sign up with Google",
      already_have_account: "Already have an account?",
      login: "Log in",
      academic_feed: "Academic Feed",
      college_messages: "College Messages",
      scholarly_stream: "The Scholarly Stream",
      faculty_insights: "Curated insights from your faculty",
      no_updates_title: "No updates yet",
      no_updates_desc: "Check back later for curated insights and research highlights from your faculty.",
      students_online: "0 students online",
      no_messages_title: "No messages yet",
      chat_empty_desc: "Start a conversation with your fellow students.",
      alerts_title: "Alerts",
      alerts_hero_desc: "Your academic pulse, choreographed to keep you informed.",
      alerts_empty_title: "The Scholarly Stream is Quiet",
      alerts_empty_desc: "No notifications yet.",
      general_settings: "General Settings",
      appearance: "Appearance",
      dark_mode_desc: "Switch to Dark Mode",
      notifications: "Notifications",
      notifications_desc: "Manage alerts and sounds",
      privacy_security: "Privacy & Security",
      privacy_desc: "Account data and passwords",
      language: "Language",
      langs_list: "English, French, Arabic",
      academic_profile: "Academic Profile",
      university_details: "University Details",
      uni_name: "University of Batna 1",
      logout_btn: "Logout from Device",
      academic_pulse: "The Academic Pulse",
      notif_hero_desc: "Fine-tune your scholarly stream.",
      all_notifs: "All Notifications",
      all_notifs_desc: "Enable or disable all alerts globally",
      academic_updates: "Academic Updates",
      exams_deadlines: "Exams & Deadlines",
      exams_desc: "Critical alerts for upcoming tests",
      schedule_changes: "Schedule Changes",
      schedule_desc: "Class cancellations or modifications",
      community_pulse_section: "Community Pulse",
      group_chats_notif: "Group Chats",
      group_chats_desc: "New messages in your groups",
      new_posts_notif: "New Posts",
      new_posts_desc: "Activity from people you follow",
      system_alerts: "System Alerts",
      security_privacy_notif: "Security & Privacy",
      security_notif_desc: "Logins and updates",
      app_improvements: "App Improvements",
      app_news_desc: "News about features",
      smart_feature: "SMART FEATURE",
      focus_mode: "Focus Mode",
      focus_mode_desc: "Automatically silence non-critical notifications.",
      set_schedule: "Set Schedule",
      security: "Security",
      change_password: "Change Password",
      update_creds: "Update your login credentials",
      encryption_status: "Encryption Status",
      e2e_active: "End-to-end active",
      encryption_desc: "Your data is encrypted using AES-256.",
      privacy_safety: "Privacy & Safety",
      danger_zone: "Danger Zone",
      account_deletion: "Account Deletion",
      why_privacy: "Why Privacy Matters?",
      privacy_note: "Your academic journey is personal.",
      read_policy: "Read Policy →",
      password_hero_desc: "Ensure your account remains secure.",
      current_password: "Current Password",
      new_password: "New Password",
      moderate_strength: "Moderate Strength",
      confirm_password: "Confirm New Password",
      update_password: "Update Password",
      choose_lang: "Choose Language",
      choose_lang_desc: "Select your preferred scholarly language.",
      nav_home: "Home",
      nav_chat: "Chat",
      nav_alerts: "Alerts",
      nav_settings: "Settings",
      student_profile: "Student Profile",
    },
    fr: {
      app_name: "StudentConnect",
      splash_subtitle: "Connecter les étudiants, dynamiser l'éducation",
      community_hub: "Centre Communautaire",
      active_scholarly_pulse: "Pouls académique actif",
      get_started: "Commencer",
      sign_in: "Se connecter",
      auth_subtitle: "Votre voyage académique, orchestré.",
      sign_in_tab: "Connexion",
      create_account_tab: "Créer un compte",
      email_label: "Adresse Gmail",
      gmail_restriction: "Inscription restreinte aux comptes @gmail.com uniquement.",
      password_label: "Mot de passe",
      forgot_password: "Mot de passe oublié ?",
      submit_login: "Se connecter au Flux",
      or_continue: "Ou continuer avec",
      auth_footer_1: "En vous connectant, vous acceptez les Conditions d'utilisation académiques et la Charte de confidentialité.",
      terms: "Conditions d'utilisation académiques",
      privacy: "Charte de confidentialité",
      system_optimal: "État du système : Optimal",
      create_title: "Créez votre profil académique.",
      google_signup: "S'inscrire avec Google",
      already_have_account: "Vous avez déjà un compte ?",
      login: "Connexion",
      academic_feed: "Flux Académique",
      college_messages: "Messages du Collège",
      scholarly_stream: "Le Flux Académique",
      faculty_insights: "Aperçus de votre faculté",
      no_updates_title: "Aucune mise à jour",
      no_updates_desc: "Revenez plus tard pour des idées et des points saillants de la recherche.",
      students_online: "0 étudiants en ligne",
      no_messages_title: "Aucun message",
      chat_empty_desc: "Commencez une conversation avec vos camarades.",
      alerts_title: "Alertes",
      alerts_hero_desc: "Votre pouls académique, orchestré pour vous informer.",
      alerts_empty_title: "Le Flux Académique est Calme",
      alerts_empty_desc: "Pas encore de notifications.",
      general_settings: "Paramètres Généraux",
      appearance: "Apparence",
      dark_mode_desc: "Passer en Mode Sombre",
      notifications: "Notifications",
      notifications_desc: "Gérer les alertes et les sons",
      privacy_security: "Confidentialité & Sécurité",
      privacy_desc: "Données du compte et mots de passe",
      language: "Langue",
      langs_list: "Anglais, Français, Arabe",
      academic_profile: "Profil Académique",
      university_details: "Détails de l'Université",
      uni_name: "Université de Batna 1",
      logout_btn: "Se déconnecter de l'appareil",
      academic_pulse: "Le Pouls Académique",
      notif_hero_desc: "Ajustez votre flux académique.",
      all_notifs: "Toutes les Notifications",
      all_notifs_desc: "Activer ou désactiver toutes les alertes",
      academic_updates: "Mises à jour Académiques",
      exams_deadlines: "Examens & Échéances",
      exams_desc: "Alertes critiques pour les tests",
      schedule_changes: "Changements d'Horaire",
      schedule_desc: "Annulations ou modifications de cours",
      community_pulse_section: "Pouls Communautaire",
      group_chats_notif: "Chats de Groupe",
      group_chats_desc: "Nouveaux messages dans vos groupes",
      new_posts_notif: "Nouveaux Posts",
      new_posts_desc: "Activité des personnes suivies",
      system_alerts: "Alertes Système",
      security_privacy_notif: "Sécurité & Confidentialité",
      security_notif_desc: "Connexions et mises à jour",
      app_improvements: "Améliorations de l'App",
      app_news_desc: "Nouvelles sur les fonctionnalités",
      smart_feature: "FONCTION INTELLIGENTE",
      focus_mode: "Mode Concentration",
      focus_mode_desc: "Couper automatiquement les notifications non critiques.",
      set_schedule: "Définir l'horaire",
      security: "Sécurité",
      change_password: "Changer le mot de passe",
      update_creds: "Mettez à jour vos identifiants",
      encryption_status: "État du Chiffrement",
      e2e_active: "Chiffrement de bout en bout actif",
      encryption_desc: "Vos données sont chiffrées avec AES-256.",
      privacy_safety: "Confidentialité & Sécurité",
      danger_zone: "Zone de Danger",
      account_deletion: "Suppression du Compte",
      why_privacy: "Pourquoi la confidentialité ?",
      privacy_note: "Votre voyage académique est personnel.",
      read_policy: "Lire la politique →",
      password_hero_desc: "Assurez la sécurité de votre compte.",
      current_password: "Mot de passe actuel",
      new_password: "Nouveau mot de passe",
      moderate_strength: "Force modérée",
      confirm_password: "Confirmer le mot de passe",
      update_password: "Mettre à jour",
      choose_lang: "Choisir la Langue",
      choose_lang_desc: "Sélectionnez votre langue académique.",
      nav_home: "Accueil",
      nav_chat: "Chat",
      nav_alerts: "Alertes",
      nav_settings: "Paramètres",
      student_profile: "Profil Étudiant",
    },
    ar: {
      app_name: "StudentConnect",
      splash_subtitle: "ربط الطلاب، تمكين التعليم",
      community_hub: "مركز المجتمع",
      active_scholarly_pulse: "نبض أكاديمي نشط",
      get_started: "ابدأ الآن",
      sign_in: "تسجيل الدخول",
      auth_subtitle: "رحلتك الأكاديمية، منسقة.",
      sign_in_tab: "تسجيل الدخول",
      create_account_tab: "إنشاء حساب",
      email_label: "عنوان Gmail",
      gmail_restriction: "التسجيل مقصور على حسابات @gmail.com فقط.",
      password_label: "كلمة المرور",
      forgot_password: "هل نسيت كلمة المرور؟",
      submit_login: "تسجيل الدخول إلى التدفق",
      or_continue: "أو المتابعة باستخدام",
      auth_footer_1: "بتسجيل الدخول، فإنك توافق على شروط الخدمة العلمية وميثاق الخصوصية.",
      terms: "شروط الخدمة العلمية",
      privacy: "ميثاق الخصوصية",
      system_optimal: "حالة النظام: مثالية",
      create_title: "قم بإنشاء ملفك الشخصي الأكاديمي.",
      google_signup: "التسجيل باستخدام Google",
      already_have_account: "لديك حساب بالفعل؟",
      login: "تسجيل الدخول",
      academic_feed: "التدفق الأكاديمي",
      college_messages: "رسائل الكلية",
      scholarly_stream: "التدفق الدراسي",
      faculty_insights: "رؤى منسقة من كليتك",
      no_updates_title: "لا توجد تحديثات بعد",
      no_updates_desc: "تحقق مرة أخرى لاحقًا للحصول على رؤى منسقة من كليتك.",
      students_online: "0 طلاب متصلون",
      no_messages_title: "لا توجد رسائل بعد",
      chat_empty_desc: "ابدأ محادثة مع زملائك الطلاب.",
      alerts_title: "التنبيهات",
      alerts_hero_desc: "نبضك الأكاديمي، منسق لإبقائك على اطلاع.",
      alerts_empty_title: "التدفق الدراسي هادئ",
      alerts_empty_desc: "لا توجد تنبيهات بعد.",
      general_settings: "الإعدادات العامة",
      appearance: "المظهر",
      dark_mode_desc: "التبديل إلى الوضع الداكن",
      notifications: "الإشعارات",
      notifications_desc: "إدارة التنبيهات والأصوات",
      privacy_security: "الخصوصية والأمان",
      privacy_desc: "بيانات الحساب وكلمات المرور",
      language: "اللغة",
      langs_list: "الإنجليزية، الفرنسية، العربية",
      academic_profile: "الملف الأكاديمي",
      university_details: "تفاصيل الجامعة",
      uni_name: "جامعة باتنة 1",
      logout_btn: "تسجيل الخروج من الجهاز",
      academic_pulse: "النبض الأكاديمي",
      notif_hero_desc: "قم بضبط تدفقك الدراسي.",
      all_notifs: "كل الإشعارات",
      all_notifs_desc: "تمكين أو تعطيل كافة التنبيهات",
      academic_updates: "التحديثات الأكاديمية",
      exams_deadlines: "الامتحانات والمواعيد النهائية",
      exams_desc: "تنبيهات هامة للاختبارات القادمة",
      schedule_changes: "تغييرات الجدول",
      schedule_desc: "إلغاء الفصول أو التعديلات",
      community_pulse_section: "نبض المجتمع",
      group_chats_notif: "دردشات المجموعة",
      group_chats_desc: "رسائل جديدة في مجموعاتك",
      new_posts_notif: "منشورات جديدة",
      new_posts_desc: "النشاط من الأشخاص الذين تتابعهم",
      system_alerts: "تنبيهات النظام",
      security_privacy_notif: "الأمان والخصوصية",
      security_notif_desc: "تسجيلات الدخول والتحديثات",
      app_improvements: "تحسينات التطبيق",
      app_news_desc: "أخبار عن الميزات",
      smart_feature: "ميزة ذكية",
      focus_mode: "وضع التركيز",
      focus_mode_desc: "إسكات الإشعارات غير الهامة تلقائيًا.",
      set_schedule: "ضبط الجدول",
      security: "الأمان",
      change_password: "تغيير كلمة المرور",
      update_creds: "تحديث بيانات تسجيل الدخول",
      encryption_status: "حالة التشفير",
      e2e_active: "التشفير التام نشط",
      encryption_desc: "بياناتك مشفرة باستخدام AES-256.",
      privacy_safety: "الخصوصية والأمان",
      danger_zone: "منطقة الخطر",
      account_deletion: "حذف الحساب",
      why_privacy: "لماذا تهم الخصوصية؟",
      privacy_note: "رحلتك الأكاديمية شخصية.",
      read_policy: "إقرأ السياسة ←",
      password_hero_desc: "تأكد من بقاء حسابك آمنًا.",
      current_password: "كلمة المرور الحالية",
      new_password: "كلمة مرور جديدة",
      moderate_strength: "قوة متوسطة",
      confirm_password: "تأكيد كلمة المرور",
      update_password: "تحديث كلمة المرور",
      choose_lang: "اختر اللغة",
      choose_lang_desc: "اختر لغتك الدراسية المفضلة.",
      nav_home: "الرئيسية",
      nav_chat: "الدردشة",
      nav_alerts: "التنبيهات",
      nav_settings: "الإعدادات",
      student_profile: "ملف الطالب",
    }
  },

  applyTranslations(lang) {
    const dict = this.translations[lang] || this.translations.en;
    
    // Set Document Direction
    const isRTL = lang === 'ar';
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;

    // Apply text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.placeholder = dict[key];
        } else {
          // Check if it has a material icon span that we should preserve
          const icon = el.querySelector('.material-symbols-outlined');
          if (icon && (el.tagName === 'BUTTON' || el.classList.contains('gradient-button'))) {
             // Preserve icon, replace text. Assumes text is not inside a child span.
             // This is a bit fragile, better to wrap text in a span if possible.
             // But for now, let's try to update just the text node if it exists.
             el.childNodes.forEach(node => {
               if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
                 node.textContent = dict[key];
               }
             });
          } else {
            el.textContent = dict[key];
          }
        }
      }
    });

    console.log(`Translations applied for: ${lang}`);
  },

  initLanguage() {
    const saved = localStorage.getItem('sc-language') || 'en';
    this.setLanguage(saved, false);
  },

  setLanguage(lang, save = true) {
    const languages = {
      'en': 'English',
      'fr': 'Français',
      'ar': 'العربية'
    };

    // Apply the actual translations
    this.applyTranslations(lang);

    // Update UI active state in selection screen
    document.querySelectorAll('.language-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.lang === lang);
    });

    // Update Subtitle in Settings
    const displayEl = document.getElementById('current-language-display');
    if (displayEl) {
      displayEl.textContent = languages[lang] || 'English';
    }

    if (save) {
      localStorage.setItem('sc-language', lang);
    }
  },

  // ---- Navigation ----
  navigate(targetScreen, pushHistory = true) {
    if (!this.screens[targetScreen]) return;
    
    // Store current screen in history before updating
    if (pushHistory && this.currentScreen && this.currentScreen !== targetScreen) {
      this.history.push(this.currentScreen);
    }
    
    this.currentScreen = targetScreen;
    
    // Chat-specific logic
    if (targetScreen === 'chat') {
      this.clearUnreadBadge();
      this.updateLastReadAt();
      if (this.supabase && this.currentUser) {
        this.fetchMessages();
      }
    }
    
    // Switch visibility
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

    // Language Selection Navigation
    document.getElementById('settings-language')?.addEventListener('click', () => {
      this.navigate('language');
    });

    // Language Option Selection
    document.querySelectorAll('.language-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const lang = btn.dataset.lang;
        this.setLanguage(lang);
      });
    });

  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
