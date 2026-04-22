import re

path = r'c:\Users\user\Downloads\stitch_studentconnect_prd\js\app.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Define the clean chronological fetchMessages function
clean_fetch = r"""  async fetchMessages() {
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
          
          // Insert date separator if day changed (Chronological)
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

    if (this.currentScreen !== 'chat' && this.unreadCount > 0) {
      const badge = document.getElementById('chat-badge');
      if (badge) {
        badge.textContent = this.unreadCount > 9 ? '9+' : this.unreadCount;
        badge.style.display = 'flex';
      }
    }

    // Robust Multi-Pass Scroll for Normal Layout
    this.scrollToBottom(false); 
    setTimeout(() => this.scrollToBottom(false), 50);
    setTimeout(() => this.scrollToBottom(false), 300);
  },"""

# Also fix renderMessage prepend to appendChild
# and date separator logic
clean_render = r"""  renderMessage(msg, container = null) {
      const emptyState = document.getElementById('chat-empty-state');
      if (emptyState) emptyState.remove();
      
      const messagesContainer = container || document.getElementById('chat-messages');
      const bodyContainer = document.getElementById('chat-body');
      if (!messagesContainer || !bodyContainer) return;

      // Handle real-time date separators (Normal layout: compare with previous)
      if (!container) {
        const msgDate = new Date(msg.created_at);
        if (!this.lastRenderedDate || !this.isSameDay(this.lastRenderedDate, msgDate)) {
          this.renderDateSeparator(this.formatDateLabel(msgDate), messagesContainer);
          this.lastRenderedDate = msgDate;
        }
      }
      
      const isMine = this.currentUser && msg.user_id === this.currentUser.id;
      
      const wrapper = document.createElement('div');
      wrapper.className = isMine ? 'message-with-avatar sent' : 'message-with-avatar received';
      
      const avatar = document.createElement('img');
      avatar.className = 'chat-avatar';
      
      let profileInfo = msg.profiles;
      if (Array.isArray(profileInfo)) profileInfo = profileInfo[0];
      if (!profileInfo) profileInfo = { full_name: msg.sender_full_name, avatar_url: null };
      
      avatar.src = profileInfo.avatar_url || 'assets/logo.png';
      avatar.alt = profileInfo.full_name || 'Student';
      avatar.addEventListener('click', () => {
        if (msg.user_id) this.openProfileModal(msg.user_id);
      });

      const msgDiv = document.createElement('div');
      msgDiv.className = isMine ? 'message message-sent' : 'message message-received';
      
      const senderName = document.createElement('div');
      senderName.className = 'message-sender-name';
      
      let nameToDisplay = 'Student';
      if (profileInfo) {
        nameToDisplay = profileInfo.full_name || msg.sender_full_name || 'Student';
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
      
      // Standard Append for Chronological Layout
      messagesContainer.appendChild(wrapper);
  },"""

# Use markers to replace the blocks
content = re.sub(r'  async fetchMessages\(\) \{.*?setTimeout\(\) => this\.scrollToBottom\(false\), 300\);\s+\},', clean_fetch, content, flags=re.DOTALL)
content = re.sub(r'  renderMessage\(msg, container = null\) \{.*?\/\/ Real-time prepends to stay at bottom\s+\}\s+\},', clean_render, content, flags=re.DOTALL)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Reversion successful.")
