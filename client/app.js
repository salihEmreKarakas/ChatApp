console.log("APP.JS LOADED v4");

let conn = null;
let jitsiApi = null;
let currentChat = null; // { jid, type: 'chat' or 'room', name }
let contacts = []; // Array of contact objects
let messageHistory = {}; // { jid: [messages] }
let unreadCounts = {}; // { jid: count }
let myJid = null; // Current user's JID
let typingStates = {}; // { jid: 'composing' | 'paused' | 'active' }
let typingTimer = null; // Timer for paused state
let presenceStates = {}; // { jid: 'online' | 'offline' }

// --- Message History & Notifications ---
function loadMessageHistory() {
  const saved = localStorage.getItem("xmpp_message_history");
  if (saved) {
    messageHistory = JSON.parse(saved);
  }
}

function saveMessageHistory() {
  localStorage.setItem("xmpp_message_history", JSON.stringify(messageHistory));
}

function addToHistory(jid, from, text, isSent, showSender, messageId) {
  if (!messageHistory[jid]) {
    messageHistory[jid] = [];
  }
  const msgId = messageId || `msg_${Date.now()}_${Math.random()}`;
  messageHistory[jid].push({
    id: msgId,
    from,
    text,
    isSent,
    showSender,
    timestamp: Date.now(),
    seen: isSent ? false : null // null for received (we don't track), false for sent (not seen yet)
  });

  // Keep only last 100 messages per chat
  if (messageHistory[jid].length > 100) {
    messageHistory[jid] = messageHistory[jid].slice(-100);
  }

  saveMessageHistory();
  return msgId;
}

function markMessageAsSeen(jid, messageId) {
  if (!messageHistory[jid]) return;

  const msg = messageHistory[jid].find(m => m.id === messageId);
  if (msg && msg.isSent) {
    msg.seen = true;
    saveMessageHistory();
    updateMessageSeenStatus(messageId);
  }
}

function sendSeenReceipt(toJid, messageId) {
  if (!conn || !conn.authenticated) return;

  // Send a custom seen receipt message
  const receipt = $msg({
    to: toJid,
    type: "chat"
  }).c("seen", {
    xmlns: "urn:xmpp:receipts",
    id: messageId
  });

  conn.send(receipt.tree());
  console.log(`>> Sent seen receipt for message ${messageId} to ${toJid}`);
}

function sendAllSeenReceipts(jid) {
  if (!messageHistory[jid]) return;

  // Send seen receipts for all unseen received messages
  messageHistory[jid].forEach(msg => {
    if (!msg.isSent && msg.id) {
      sendSeenReceipt(jid, msg.id);
    }
  });
}

function updateMessageSeenStatus(messageId) {
  const msgElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (msgElement) {
    const seenIndicator = msgElement.querySelector(".message-seen");
    if (seenIndicator) {
      seenIndicator.classList.add("seen");
      seenIndicator.textContent = "✓✓";
    }
  }
}

function loadChatHistory(jid) {
  const container = document.getElementById("messagesContainer");
  if (!container) return;

  // Clear current messages
  container.innerHTML = "";

  // Load messages from history
  const messages = messageHistory[jid] || [];
  if (messages.length === 0) {
    const welcomeMsg = document.createElement("div");
    welcomeMsg.className = "system-message";
    welcomeMsg.textContent = "Sohbete başlamak için bir mesaj gönderin";
    container.appendChild(welcomeMsg);
  } else {
    messages.forEach(msg => {
      addMessageToUI(msg.from, msg.text, msg.isSent, msg.showSender, msg.id, msg.seen);
    });
  }

  // Send seen receipts for all received messages
  sendAllSeenReceipts(jid);

  // Scroll to bottom
  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 100);
}

function incrementUnread(jid) {
  if (!unreadCounts[jid]) {
    unreadCounts[jid] = 0;
  }
  unreadCounts[jid]++;
  updateContactBadge(jid);
}

function clearUnread(jid) {
  unreadCounts[jid] = 0;
  updateContactBadge(jid);
}

function updateContactBadge(jid) {
  const contactItem = document.querySelector(`.contact-item[data-jid="${jid}"]`);
  if (!contactItem) return;

  // Remove existing badge
  const existingBadge = contactItem.querySelector(".unread-badge");
  if (existingBadge) {
    existingBadge.remove();
  }

  // Add new badge if count > 0
  const count = unreadCounts[jid] || 0;
  if (count > 0) {
    const badge = document.createElement("div");
    badge.className = "unread-badge";
    badge.textContent = count > 99 ? "99+" : count;
    contactItem.appendChild(badge);
  }
}

// --- Typing Indicator ---
function sendChatState(toJid, state) {
  if (!conn || !conn.authenticated) return;
  if (!toJid) return;

  const stateMsg = $msg({
    to: toJid,
    type: "chat"
  }).c(state, { xmlns: "http://jabber.org/protocol/chatstates" });

  conn.send(stateMsg.tree());
  console.log(`>> Chat state: ${state} to ${toJid}`);
}

function showTypingIndicator(jid, name) {
  typingStates[jid] = 'composing';

  // Update UI if this is the current chat
  if (currentChat && currentChat.jid === jid) {
    const subtitle = document.getElementById("chatSubtitle");
    if (subtitle) {
      subtitle.textContent = "yazıyor...";
      subtitle.style.color = "#667eea";
      subtitle.style.fontStyle = "italic";
    }
  }
}

function hideTypingIndicator(jid) {
  typingStates[jid] = 'active';

  // Update UI if this is the current chat
  if (currentChat && currentChat.jid === jid) {
    const subtitle = document.getElementById("chatSubtitle");
    if (subtitle) {
      subtitle.textContent = jid;
      subtitle.style.color = "#888";
      subtitle.style.fontStyle = "normal";
    }
  }
}

function handleUserTyping() {
  if (!currentChat || currentChat.type === "room") return;

  // Send composing state
  sendChatState(currentChat.jid, "composing");

  // Clear previous timer
  if (typingTimer) {
    clearTimeout(typingTimer);
  }

  // Set timer to send paused state after 3 seconds of inactivity
  typingTimer = setTimeout(() => {
    sendChatState(currentChat.jid, "paused");
  }, 3000);
}

// --- Presence Management ---
function updateContactPresence(jid) {
  const isOnline = presenceStates[jid] === "online";

  // Update contact list
  const contactItem = document.querySelector(`.contact-item[data-jid="${jid}"]`);
  if (contactItem) {
    let statusDot = contactItem.querySelector(".status-dot");
    if (!statusDot) {
      statusDot = document.createElement("div");
      statusDot.className = "status-dot";
      const avatar = contactItem.querySelector(".contact-avatar");
      if (avatar) {
        avatar.style.position = "relative";
        avatar.appendChild(statusDot);
      }
    }
    statusDot.classList.toggle("online", isOnline);
  }

  // Update chat header if this is the current chat
  if (currentChat && currentChat.jid === jid && currentChat.type === "chat") {
    const chatAvatar = document.getElementById("chatAvatar");
    if (chatAvatar) {
      let statusDot = chatAvatar.querySelector(".status-dot");
      if (!statusDot) {
        statusDot = document.createElement("div");
        statusDot.className = "status-dot";
        chatAvatar.style.position = "relative";
        chatAvatar.appendChild(statusDot);
      }
      statusDot.classList.toggle("online", isOnline);
    }
  }
}

function subscribeToContact(jid) {
  if (!conn || !conn.authenticated) return;

  // Request presence subscription
  const subscribe = $pres({
    to: jid,
    type: "subscribe"
  });
  conn.send(subscribe.tree());

  // Also send subscribed to auto-approve their request
  const subscribed = $pres({
    to: jid,
    type: "subscribed"
  });
  conn.send(subscribed.tree());
}

function subscribeToAllContacts() {
  contacts.forEach(contact => {
    subscribeToContact(contact.jid);
  });
}

// --- UI Helper Functions ---
function updateStatus(text, connected = false) {
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");

  if (statusDot) {
    statusDot.classList.toggle("connected", connected);
  }
  if (statusText) {
    statusText.textContent = text;
  }
}

function addMessageToUI(from, text, isSent = false, showSender = false, messageId = null, seen = null) {
  const container = document.getElementById("messagesContainer");
  if (!container) return;

  // Remove welcome message if exists
  const welcomeMsg = container.querySelector(".system-message");
  if (welcomeMsg && welcomeMsg.textContent.includes("başlamak")) {
    welcomeMsg.remove();
  }

  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
  if (messageId) {
    messageDiv.dataset.messageId = messageId;
  }

  // Show sender name for group chats
  if (showSender && from) {
    const senderDiv = document.createElement("div");
    senderDiv.className = "message-sender";
    senderDiv.textContent = from;
    messageDiv.appendChild(senderDiv);
  }

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = text;

  // Add seen indicator for sent messages
  if (isSent) {
    const seenIndicator = document.createElement("span");
    seenIndicator.className = `message-seen ${seen ? 'seen' : ''}`;
    seenIndicator.textContent = seen ? "✓✓" : "✓";
    bubble.appendChild(seenIndicator);
  }

  messageDiv.appendChild(bubble);
  container.appendChild(messageDiv);

  // Scroll to bottom smoothly
  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 100);
}

function addMessage(jid, from, text, isSent = false, showSender = false, messageId = null) {
  // Save to history and get message ID
  const msgId = addToHistory(jid, from, text, isSent, showSender, messageId);

  // If message is for current chat, show it
  if (currentChat && currentChat.jid === jid) {
    addMessageToUI(from, text, isSent, showSender, msgId, false);

    // Send seen receipt for received messages
    if (!isSent && msgId) {
      sendSeenReceipt(jid, msgId);
    }
  } else {
    // Otherwise increment unread count
    if (!isSent) {
      incrementUnread(jid);
    }
  }

  return msgId;
}

function scrollToBottom() {
  const container = document.getElementById("messagesContainer");
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

function setCurrentChat(jid, type, name) {
  currentChat = { jid, type, name };

  const chatTitle = document.getElementById("chatTitle");
  const chatSubtitle = document.getElementById("chatSubtitle");
  const chatAvatar = document.getElementById("chatAvatar");

  if (chatTitle) chatTitle.textContent = name;
  if (chatSubtitle) {
    chatSubtitle.textContent = jid;
    chatSubtitle.style.color = "#888";
    chatSubtitle.style.fontStyle = "normal";
  }
  if (chatAvatar) chatAvatar.textContent = name.charAt(0).toUpperCase();

  // Update presence indicator for current chat
  if (type === "chat") {
    updateContactPresence(jid);
  }

  // Update active contact
  document.querySelectorAll(".contact-item").forEach(item => {
    item.classList.toggle("active", item.dataset.jid === jid);
  });

  // Load chat history
  loadChatHistory(jid);

  // Clear unread count
  clearUnread(jid);
}

// --- XMPP Functions ---
function getHostForWs() {
  return window.location.hostname || "localhost";
}

function getBoshUrl() {
  const host = getHostForWs();
  const protocol = window.location.protocol;
  return `${protocol}//${host}/http-bind`;
}

function normalizeDomainForJid() {
  return "localhost";
}

function normalizeRoomDomain() {
  return `conference.${normalizeDomainForJid()}`;
}

function safeVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

// --- Handlers ---
function onChatMessage(msg) {
  const from = msg.getAttribute("from");
  const fromJid = from.split("/")[0]; // Remove resource

  // Check for seen receipt
  const seenElement = msg.getElementsByTagName("seen")[0];
  if (seenElement) {
    const messageId = seenElement.getAttribute("id");
    if (messageId) {
      markMessageAsSeen(fromJid, messageId);
      console.log(`<< Received seen receipt for message ${messageId} from ${fromJid}`);
    }
    return true;
  }

  // Check for chat state notifications
  const composing = msg.getElementsByTagName("composing")[0];
  const paused = msg.getElementsByTagName("paused")[0];
  const active = msg.getElementsByTagName("active")[0];

  if (composing) {
    showTypingIndicator(fromJid, from);
    return true;
  }
  if (paused || active) {
    hideTypingIndicator(fromJid);
    return true;
  }

  // Handle regular message
  const body = msg.getElementsByTagName("body")[0];
  if (body) {
    const text = Strophe.getText(body);
    const messageId = msg.getAttribute("id");

    // Add message to history and show if in current chat
    addMessage(fromJid, from, text, false, false, messageId); // false = don't show sender for direct chat

    console.log(`<< [chat] ${from}: ${text}`);
  }

  return true;
}

function onGroupMessage(msg) {
  const from = msg.getAttribute("from");
  const type = msg.getAttribute("type") || "";
  if (type !== "groupchat") return true;

  const body = msg.getElementsByTagName("body")[0];
  if (body) {
    const text = Strophe.getText(body);
    const roomJid = from.split("/")[0];
    const sender = from.split("/")[1] || "unknown";

    const myJid = safeVal("jid").split("@")[0];
    const isSent = sender === myJid || sender.includes(myJid);

    // Add message to history and show if in current chat
    addMessage(roomJid, sender, text, isSent, true); // true = show sender name

    console.log(`<< [room] ${from}: ${text}`);
  }

  return true;
}

function onPresence(pres) {
  const from = pres.getAttribute("from") || "";
  const fromJid = from.split("/")[0]; // Remove resource
  const type = pres.getAttribute("type") || "available";

  console.log(`[presence] ${fromJid} type=${type}`);

  // Ignore self presence and room presence
  if (!fromJid || fromJid === myJid || fromJid.includes("conference.")) {
    return true;
  }

  // Update presence state
  if (type === "unavailable") {
    presenceStates[fromJid] = "offline";
  } else if (type === "available" || !type) {
    presenceStates[fromJid] = "online";
  }

  // Update UI
  updateContactPresence(fromJid);

  return true;
}

function onIq(iq) {
  const type = iq.getAttribute("type") || "";
  if (type === "error") {
    const id = iq.getAttribute("id") || "";
    console.log(`[iq error] id=${id}`);
  }
  return true;
}

function addHandlers() {
  conn.addHandler(onChatMessage, null, "message", "chat");
  conn.addHandler(onGroupMessage, null, "message", "groupchat");
  conn.addHandler(onPresence, null, "presence");
  conn.addHandler(onIq, null, "iq");
}

// --- Actions ---
function connect() {
  const bosh = getBoshUrl();
  const jid = safeVal("jid").trim();
  const pass = safeVal("pass");

  if (!jid || !pass) {
    alert("Kullanıcı adı ve şifre gerekli!");
    return;
  }

  updateStatus("Bağlanıyor...", false);
  conn = new Strophe.Connection(bosh);

  conn.connect(jid, pass, (status) => {
    console.log("Connection status:", status);

    if (status === Strophe.Status.CONNECTING) {
      updateStatus("Bağlanıyor...", false);
    }

    if (status === Strophe.Status.CONNECTED) {
      updateStatus("Bağlı", true);
      addHandlers();
      conn.send($pres().tree());

      // Subscribe to all contacts for presence updates
      subscribeToAllContacts();

      // Hide login, show disconnect button
      const loginSection = document.getElementById("loginSection");
      const btnConnect = document.getElementById("btnConnect");
      const btnDisconnect = document.getElementById("btnDisconnect");

      if (btnConnect) btnConnect.style.display = "none";
      if (btnDisconnect) btnDisconnect.style.display = "block";
    }

    if (status === Strophe.Status.AUTHFAIL) {
      updateStatus("Kimlik doğrulama hatası!", false);
      alert("Kullanıcı adı veya şifre yanlış!");
    }

    if (status === Strophe.Status.DISCONNECTED) {
      updateStatus("Bağlantı kesildi", false);
      const btnConnect = document.getElementById("btnConnect");
      const btnDisconnect = document.getElementById("btnDisconnect");
      if (btnConnect) btnConnect.style.display = "block";
      if (btnDisconnect) btnDisconnect.style.display = "none";
    }

    if (status === Strophe.Status.CONNFAIL) {
      updateStatus("Bağlantı başarısız!", false);
      alert("Sunucuya bağlanılamadı!");
    }
  });
}

function disconnect() {
  if (conn) {
    conn.disconnect();
  }
}

function sendMessage() {
  if (!conn || !conn.authenticated) {
    alert("Önce bağlanmalısınız!");
    return;
  }

  if (!currentChat) {
    alert("Önce bir kişi veya oda seçin!");
    return;
  }

  const input = document.getElementById("messageInput");
  const text = input ? input.value.trim() : "";

  if (!text) return;

  if (currentChat.type === "room") {
    // Send to room
    const stanza = $msg({ to: currentChat.jid, type: "groupchat" }).c("body").t(text);
    conn.send(stanza.tree());
    console.log(`>> [room] ${currentChat.jid}: ${text}`);
  } else {
    // Send direct message with unique ID
    const messageId = `msg_${Date.now()}_${Math.random()}`;
    const stanza = $msg({ to: currentChat.jid, type: "chat", id: messageId }).c("body").t(text);
    conn.send(stanza.tree());
    addMessage(currentChat.jid, "Me", text, true, false, messageId); // false = don't show sender name for direct chat
    console.log(`>> [chat] ${currentChat.jid}: ${text} (id: ${messageId})`);

    // Send active state (finished typing)
    sendChatState(currentChat.jid, "active");
  }

  // Clear input and typing timer
  if (input) input.value = "";
  if (typingTimer) {
    clearTimeout(typingTimer);
    typingTimer = null;
  }
}

function joinRoom(roomJid) {
  if (!conn || !conn.authenticated) {
    alert("Önce bağlanmalısınız!");
    return;
  }

  const myJid = safeVal("jid").split("@")[0];
  const nick = myJid || "user";

  const pres = $pres({ to: `${roomJid}/${nick}` })
    .c("x", { xmlns: "http://jabber.org/protocol/muc" });

  conn.send(pres.tree());
  console.log(`>> [join] ${roomJid} as ${nick}`);
}

// --- Contact Management ---
function loadContacts() {
  const saved = localStorage.getItem("xmpp_contacts");
  if (saved) {
    contacts = JSON.parse(saved);
  } else {
    // Default contacts
    contacts = [
      { jid: "ayse@localhost", name: "Ayse", type: "chat" },
      { jid: "general@conference.localhost", name: "Genel Oda", type: "room" }
    ];
    saveContacts();
  }
  renderContacts();
}

function saveContacts() {
  localStorage.setItem("xmpp_contacts", JSON.stringify(contacts));
}

function addContact(jid, name, type = "chat") {
  // Check if contact already exists
  const exists = contacts.find(c => c.jid === jid);
  if (exists) {
    alert("Bu kişi zaten ekli!");
    return false;
  }

  contacts.push({ jid, name, type });
  saveContacts();
  renderContacts();

  // Subscribe to new contact's presence (if it's a chat, not a room)
  if (type === "chat") {
    subscribeToContact(jid);
  }

  return true;
}

function removeContact(jid) {
  contacts = contacts.filter(c => c.jid !== jid);
  saveContacts();
  renderContacts();
}

function renderContacts() {
  const container = document.getElementById("contactsList");
  if (!container) return;

  container.innerHTML = "";

  contacts.forEach(contact => {
    const item = document.createElement("div");
    item.className = "contact-item";
    item.dataset.jid = contact.jid;
    item.dataset.type = contact.type;

    const avatar = document.createElement("div");
    avatar.className = "contact-avatar";
    avatar.textContent = contact.type === "room" ? "🏠" : contact.name.charAt(0).toUpperCase();

    // Add presence indicator for direct chats
    if (contact.type === "chat") {
      const statusDot = document.createElement("div");
      statusDot.className = "status-dot";
      const isOnline = presenceStates[contact.jid] === "online";
      statusDot.classList.toggle("online", isOnline);
      avatar.appendChild(statusDot);
    }

    const info = document.createElement("div");
    info.className = "contact-info";

    const nameDiv = document.createElement("div");
    nameDiv.className = "contact-name";
    nameDiv.textContent = contact.name;

    const statusDiv = document.createElement("div");
    statusDiv.className = "contact-status";
    statusDiv.textContent = contact.type === "room" ? "Grup sohbeti" : contact.jid;

    info.appendChild(nameDiv);
    info.appendChild(statusDiv);
    item.appendChild(avatar);
    item.appendChild(info);

    // Click handler
    item.addEventListener("click", () => {
      setCurrentChat(contact.jid, contact.type, contact.name);
      if (contact.type === "room") {
        joinRoom(contact.jid);
      }
      closeSidebar(); // Close sidebar on mobile after selecting contact
    });

    // Long press for delete (mobile friendly)
    let pressTimer;
    item.addEventListener("touchstart", (e) => {
      pressTimer = setTimeout(() => {
        if (confirm(`${contact.name} kişisini silmek istiyor musunuz?`)) {
          removeContact(contact.jid);
        }
      }, 800);
    });
    item.addEventListener("touchend", () => {
      clearTimeout(pressTimer);
    });
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (confirm(`${contact.name} kişisini silmek istiyor musunuz?`)) {
        removeContact(contact.jid);
      }
    });

    container.appendChild(item);

    // Update unread badge for this contact
    updateContactBadge(contact.jid);
  });
}

function openAddContactModal() {
  const modal = document.getElementById("addContactModal");
  if (modal) {
    modal.classList.add("active");
    document.getElementById("contactJid").value = "";
    document.getElementById("contactName").value = "";
    document.getElementById("contactIsRoom").checked = false;
  }
}

function closeAddContactModal() {
  const modal = document.getElementById("addContactModal");
  if (modal) {
    modal.classList.remove("active");
  }
}

function saveNewContact() {
  const jid = document.getElementById("contactJid").value.trim();
  const name = document.getElementById("contactName").value.trim();
  const isRoom = document.getElementById("contactIsRoom").checked;

  if (!jid || !name) {
    alert("Lütfen tüm alanları doldurun!");
    return;
  }

  const type = isRoom ? "room" : "chat";
  if (addContact(jid, name, type)) {
    closeAddContactModal();
  }
}

// --- Video Call ---
function startVideoCall() {
  if (!currentChat) {
    alert("Önce bir kişi seçin!");
    return;
  }

  if (currentChat.type === "room") {
    alert("Grup görüşmesi için tüm üyelerin katılması gerekir!");
    return;
  }

  const myJid = safeVal("jid").trim();
  const users = [myJid, currentChat.jid].sort();
  const roomName = users.join("-").replace(/@/g, "_").replace(/\./g, "_");

  console.log(`Starting video call with ${currentChat.jid}`);

  // Show video container
  const container = document.getElementById("videoContainer");
  container.classList.add("active");

  // Initialize Jitsi Meet
  const domain = "meet.jit.si";
  const options = {
    roomName: roomName,
    width: "100%",
    height: "100%",
    parentNode: document.getElementById("jitsiMeet"),
    userInfo: {
      displayName: myJid.split("@")[0]
    }
  };

  jitsiApi = new JitsiMeetExternalAPI(domain, options);

  // Send video call invite
  const inviteMsg = `📹 Video görüşmesi başlatıldı`;
  const stanza = $msg({ to: currentChat.jid, type: "chat" }).c("body").t(inviteMsg);
  if (conn && conn.authenticated) {
    conn.send(stanza.tree());
  }
}

function closeVideoCall() {
  const container = document.getElementById("videoContainer");
  container.classList.remove("active");

  if (jitsiApi) {
    jitsiApi.dispose();
    jitsiApi = null;
  }
}

// --- Mobile Menu Toggle ---
function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (sidebar) {
    sidebar.classList.toggle("active");
  }
  if (backdrop) {
    backdrop.classList.toggle("active");
  }
}

function closeSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (sidebar && window.innerWidth <= 768) {
    sidebar.classList.remove("active");
    if (backdrop) {
      backdrop.classList.remove("active");
    }
  }
}

// --- Initialize ---
window.addEventListener("DOMContentLoaded", () => {
  console.log("UI initializing...");

  // Load contacts and message history
  loadContacts();
  loadMessageHistory();

  // Connect button
  const btnConnect = document.getElementById("btnConnect");
  if (btnConnect) {
    btnConnect.addEventListener("click", connect);
  }

  // Disconnect button
  const btnDisconnect = document.getElementById("btnDisconnect");
  if (btnDisconnect) {
    btnDisconnect.addEventListener("click", disconnect);
  }

  // Send button
  const btnSend = document.getElementById("btnSend");
  if (btnSend) {
    btnSend.addEventListener("click", sendMessage);
  }

  // Enter key to send
  const messageInput = document.getElementById("messageInput");
  if (messageInput) {
    messageInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        sendMessage();
      }
    });

    // Typing indicator
    messageInput.addEventListener("input", () => {
      handleUserTyping();
    });
  }

  // Video call button
  const btnVideoCall = document.getElementById("btnVideoCall");
  if (btnVideoCall) {
    btnVideoCall.addEventListener("click", startVideoCall);
  }

  // Close video button
  const btnCloseVideo = document.getElementById("closeVideo");
  if (btnCloseVideo) {
    btnCloseVideo.addEventListener("click", closeVideoCall);
  }

  // Menu toggle button (mobile)
  const menuToggle = document.getElementById("menuToggle");
  if (menuToggle) {
    menuToggle.addEventListener("click", toggleSidebar);
  }

  // Sidebar backdrop (mobile)
  const sidebarBackdrop = document.getElementById("sidebarBackdrop");
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener("click", closeSidebar);
  }

  // Add contact button
  const btnAddContact = document.getElementById("btnAddContact");
  if (btnAddContact) {
    btnAddContact.addEventListener("click", openAddContactModal);
  }

  // Modal close buttons
  const closeModal = document.getElementById("closeModal");
  if (closeModal) {
    closeModal.addEventListener("click", closeAddContactModal);
  }

  const btnCancelContact = document.getElementById("btnCancelContact");
  if (btnCancelContact) {
    btnCancelContact.addEventListener("click", closeAddContactModal);
  }

  // Save contact button
  const btnSaveContact = document.getElementById("btnSaveContact");
  if (btnSaveContact) {
    btnSaveContact.addEventListener("click", saveNewContact);
  }

  // Close modal when clicking outside
  const modal = document.getElementById("addContactModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeAddContactModal();
      }
    });
  }

  // Mobile: Handle input focus for better keyboard experience
  if (messageInput) {
    messageInput.addEventListener("focus", () => {
      setTimeout(scrollToBottom, 300);
    });
    messageInput.addEventListener("blur", () => {
      setTimeout(scrollToBottom, 100);
    });
  }

  // Mobile: Handle window resize (keyboard appearance)
  let lastHeight = window.innerHeight;
  window.addEventListener("resize", () => {
    const currentHeight = window.innerHeight;
    if (currentHeight < lastHeight) {
      // Keyboard appeared
      setTimeout(scrollToBottom, 100);
    }
    lastHeight = currentHeight;
  });

  // Prevent overscroll bounce on iOS
  document.body.addEventListener("touchmove", (e) => {
    if (e.target === document.body) {
      e.preventDefault();
    }
  }, { passive: false });

  updateStatus("Bağlantı Yok", false);
  console.log("UI ready!");
});
