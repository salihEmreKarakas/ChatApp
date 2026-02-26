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
function getStorageKey(base) {
  return myJid ? `${base}_${myJid}` : base;
}

function loadMessageHistory() {
  const saved = localStorage.getItem(getStorageKey("xmpp_message_history"));
  if (saved) {
    messageHistory = JSON.parse(saved);
  } else {
    messageHistory = {};
  }
}

function saveMessageHistory() {
  localStorage.setItem(getStorageKey("xmpp_message_history"), JSON.stringify(messageHistory));
}

// --- MAM (Message Archive Management) ---
function fetchMAMMessages() {
  if (!conn || !conn.authenticated) return;

  console.log("Fetching MAM archive...");

  const iq = $iq({ type: "set" })
    .c("query", { xmlns: "urn:xmpp:mam:2" })
    .c("x", { xmlns: "jabber:x:data", type: "submit" })
    .c("field", { var: "FORM_TYPE", type: "hidden" })
    .c("value").t("urn:xmpp:mam:2").up().up()
    .up()
    .c("set", { xmlns: "http://jabber.org/protocol/rsm" })
    .c("max").t("100").up()
    .c("before"); // Get latest messages (reverse order)

  // Listen for MAM result messages
  conn.addHandler(onMAMMessage, "urn:xmpp:mam:2", "message");

  conn.sendIQ(iq, (result) => {
    console.log("MAM query complete");
    // Re-render current chat if open
    if (currentChat) {
      loadChatHistory(currentChat.jid);
    }
  }, (error) => {
    console.log("MAM not supported or error:", error);
  });
}

function onMAMMessage(msg) {
  const result = msg.getElementsByTagName("result")[0];
  if (!result) return true;

  const forwarded = result.getElementsByTagName("forwarded")[0];
  if (!forwarded) return true;

  const message = forwarded.getElementsByTagName("message")[0];
  const delay = forwarded.getElementsByTagName("delay")[0];

  if (!message) return true;

  const body = message.getElementsByTagName("body")[0];
  if (!body) return true;

  const text = Strophe.getText(body);
  const from = message.getAttribute("from") || "";
  const to = message.getAttribute("to") || "";
  const fromJid = from.split("/")[0];
  const toJid = to.split("/")[0];
  const messageId = message.getAttribute("id") || result.getAttribute("id");

  const isSent = fromJid === myJid;
  const contactJid = isSent ? toJid : fromJid;

  // Get timestamp from delay
  let timestamp = Date.now();
  if (delay) {
    const stamp = delay.getAttribute("stamp");
    if (stamp) timestamp = new Date(stamp).getTime();
  }

  // Skip if already in history (avoid duplicates)
  if (messageHistory[contactJid]) {
    const exists = messageHistory[contactJid].find(m =>
      m.id === messageId || (m.text === text && Math.abs(m.timestamp - timestamp) < 2000)
    );
    if (exists) return true;
  }

  // Add to history
  if (!messageHistory[contactJid]) {
    messageHistory[contactJid] = [];
  }

  messageHistory[contactJid].push({
    id: messageId,
    from: isSent ? myJid : from,
    text,
    isSent,
    showSender: false,
    timestamp,
    seen: null
  });

  // Sort by timestamp
  messageHistory[contactJid].sort((a, b) => a.timestamp - b.timestamp);

  // Keep last 100
  if (messageHistory[contactJid].length > 100) {
    messageHistory[contactJid] = messageHistory[contactJid].slice(-100);
  }

  saveMessageHistory();
  return true;
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
    if (contact.type !== "room") {
      subscribeToContact(contact.jid);
    }
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

function addSystemMessage(text) {
  const container = document.getElementById("messagesContainer");
  if (!container) return;
  const div = document.createElement("div");
  div.className = "system-message";
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
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

// --- Auth Tab Toggle ---
function showAuthTab(tab) {
  document.getElementById("tabLogin").classList.toggle("active", tab === "login");
  document.getElementById("tabRegister").classList.toggle("active", tab === "register");
  document.getElementById("loginForm").classList.toggle("active", tab === "login");
  document.getElementById("registerForm").classList.toggle("active", tab === "register");
}

// --- Registration (XEP-0077 In-Band Registration) ---
function xmlEscape(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showRegisterMsg(type, text) {
  const err = document.getElementById("registerError");
  const ok = document.getElementById("registerSuccess");
  if (err) { err.textContent = ""; err.classList.remove("active"); }
  if (ok)  { ok.textContent  = ""; ok.classList.remove("active"); }
  if (type === "error" && err) { err.textContent = text; err.classList.add("active"); }
  if (type === "success" && ok) { ok.textContent = text; ok.classList.add("active"); }
}

function registerAccount() {
  const username = safeVal("regUsername").trim();
  const domain   = safeVal("regDomain").trim() || "localhost";
  const pass     = safeVal("regPass");
  const pass2    = safeVal("regPassConfirm");

  if (!username) { showRegisterMsg("error", "Kullanıcı adı boş olamaz."); return; }
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    showRegisterMsg("error", "Kullanıcı adı sadece harf, rakam, nokta, tire ve alt çizgi içerebilir."); return;
  }
  if (pass.length < 4) { showRegisterMsg("error", "Şifre en az 4 karakter olmalı."); return; }
  if (pass !== pass2)  { showRegisterMsg("error", "Şifreler eşleşmiyor."); return; }

  const wsUrl = getXmppUrl(domain);
  const btn = document.getElementById("btnRegister");
  if (btn) { btn.disabled = true; btn.textContent = "Kayıt yapılıyor..."; }
  showRegisterMsg("", "");

  const ws = new WebSocket(wsUrl, "xmpp");
  let done = false;
  let iqSent = false;

  function finish(success, msg) {
    if (done) return;
    done = true;
    try { ws.close(); } catch (_) {}
    if (btn) { btn.disabled = false; btn.textContent = "Kayıt Ol"; }
    if (success) {
      showRegisterMsg("success", "Kayıt başarılı! Giriş yapabilirsiniz.");
      // Pre-fill login form
      const jidEl = document.getElementById("jid");
      if (jidEl) jidEl.value = username + "@" + domain;
      setTimeout(() => showAuthTab("login"), 1500);
    } else {
      showRegisterMsg("error", msg);
    }
  }

  ws.onopen = () => {
    ws.send(`<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="${xmlEscape(domain)}" version="1.0"/>`);
  };

  ws.onmessage = (e) => {
    const text = e.data;
    // After stream features arrive, send registration IQ
    if (!iqSent && (text.includes("<features") || text.includes("stream:features"))) {
      iqSent = true;
      ws.send(
        `<iq type="set" id="reg1" to="${xmlEscape(domain)}">` +
        `<query xmlns="jabber:iq:register">` +
        `<username>${xmlEscape(username)}</username>` +
        `<password>${xmlEscape(pass)}</password>` +
        `</query></iq>`
      );
      return;
    }
    // Parse registration result
    if (text.includes('id="reg1"') || text.includes("id='reg1'")) {
      if (text.includes('type="result"') || text.includes("type='result'")) {
        finish(true);
      } else {
        let msg = "Kayıt başarısız.";
        if (text.includes("conflict"))    msg = "Bu kullanıcı adı zaten kullanımda.";
        if (text.includes("not-allowed")) msg = "Kayıt şu an kapalı.";
        if (text.includes("bad-request")) msg = "Geçersiz kullanıcı adı veya şifre.";
        finish(false, msg);
      }
    }
  };

  ws.onerror = () => finish(false, "Sunucuya bağlanılamadı.");
  ws.onclose = () => { if (!done) finish(false, "Bağlantı kesildi."); };
  setTimeout(() => { if (!done) finish(false, "Bağlantı zaman aşımına uğradı."); }, 12000);
}

function getXmppUrl(overrideDomain) {
  const isSecure = window.location.protocol === "https:";
  const host = overrideDomain || getHostForWs();
  // If override is a plain domain (e.g. "localhost"), use window host for WS endpoint
  if (overrideDomain) {
    const wsHost = getHostForWs();
    return `${isSecure ? "wss" : "ws"}://${wsHost}/xmpp-websocket`;
  }
  return `${isSecure ? "wss" : "ws"}://${host}/xmpp-websocket`;
}

// --- Handlers ---
function onChatMessage(msg) {
  // Skip MAM result wrappers — handled separately by onMAMMessage
  if (msg.getElementsByTagName("result")[0]) return true;

  const from = msg.getAttribute("from") || "";
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

  // Handle call signaling
  const callEl = msg.getElementsByTagName("call")[0];
  if (callEl && callEl.getAttribute("xmlns") === "urn:app:call") {
    const action = callEl.getAttribute("action");
    const room = callEl.getAttribute("room");
    if (action === "invite") {
      handleCallInvite(fromJid, room);
    } else if (action === "reject") {
      addSystemMessage("📵 " + (contacts.find(c => c.jid === fromJid)?.name || fromJid.split("@")[0]) + " aramayı reddetti.");
    }
    return true;
  }

  // Handle regular message body first
  const body = msg.getElementsByTagName("body")[0];
  if (body) {
    const text = Strophe.getText(body);
    const messageId = msg.getAttribute("id");

    // Skip call-related system messages that come with a <call> element
    if (text.startsWith("📹") || text.startsWith("📵")) {
      // These are fallback bodies for call signaling, skip rendering
      return true;
    }

    // Add message to history and show if in current chat
    addMessage(fromJid, from, text, false, false, messageId); // false = don't show sender for direct chat

    console.log(`<< [chat] ${from}: ${text}`);
    return true;
  }

  // Check for chat state notifications (only when no body)
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

  // Auto-approve subscription requests
  if (type === "subscribe") {
    conn.send($pres({ to: fromJid, type: "subscribed" }).tree());
    conn.send($pres({ to: fromJid, type: "subscribe" }).tree());
    return true;
  }

  // Update presence state
  if (type === "unavailable") {
    presenceStates[fromJid] = "offline";
  } else if (type === "available" || type === "" || !pres.getAttribute("type")) {
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
  // Single catch-all message handler — avoids Strophe.js type-filter issues in WebSocket mode
  conn.addHandler(function(msg) {
    const type = msg.getAttribute("type") || "";
    if (type === "groupchat") return onGroupMessage(msg);
    return onChatMessage(msg);
  }, null, "message");
  conn.addHandler(onPresence, null, "presence");
  conn.addHandler(onIq, null, "iq");
}

// --- Actions ---
function connect() {
  const wsUrl = getXmppUrl();
  const jid = safeVal("jid").trim();
  const pass = safeVal("pass");

  if (!jid || !pass) {
    alert("Kullanıcı adı ve şifre gerekli!");
    return;
  }

  updateStatus("Bağlanıyor...", false);
  conn = new Strophe.Connection(wsUrl);

  conn.connect(jid, pass, (status) => {
    console.log("Connection status:", status);

    if (status === Strophe.Status.CONNECTING) {
      updateStatus("Bağlanıyor...", false);
    }

    if (status === Strophe.Status.CONNECTED) {
      updateStatus("Bağlı", true);

      // Set global myJid
      myJid = conn.jid.split("/")[0];
      console.log("Logged in as:", myJid);

      addHandlers();
      conn.send($pres().tree());

      // Load user-specific data
      loadContacts();
      loadMessageHistory();

      // Fetch roster from server (contacts synced across devices)
      fetchRoster();

      // Fetch message history from server (MAM)
      fetchMAMMessages();

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

// --- Contact Management (XMPP Roster + localStorage for rooms) ---
function loadContacts() {
  // Load rooms from localStorage
  const savedRooms = localStorage.getItem(getStorageKey("xmpp_rooms"));
  const rooms = savedRooms ? JSON.parse(savedRooms) : [
    { jid: "general@conference.localhost", name: "Genel Oda", type: "room" }
  ];

  // Start with rooms, roster contacts will be added after fetchRoster
  contacts = rooms;
  renderContacts();
}

function saveRooms() {
  const rooms = contacts.filter(c => c.type === "room");
  localStorage.setItem(getStorageKey("xmpp_rooms"), JSON.stringify(rooms));
}

function fetchRoster() {
  if (!conn || !conn.authenticated) return;

  const iq = $iq({ type: "get" }).c("query", { xmlns: "jabber:iq:roster" });
  conn.sendIQ(iq, (result) => {
    const items = result.getElementsByTagName("item");
    const rosterContacts = [];

    for (let i = 0; i < items.length; i++) {
      const jid = items[i].getAttribute("jid");
      const name = items[i].getAttribute("name") || jid.split("@")[0];

      // Remove MUC/conference JIDs from roster — they don't belong there
      if (jid.includes("conference.")) {
        const removeIq = $iq({ type: "set" })
          .c("query", { xmlns: "jabber:iq:roster" })
          .c("item", { jid: jid, subscription: "remove" });
        conn.sendIQ(removeIq, () => console.log("Removed conference JID from roster:", jid));
        continue;
      }

      rosterContacts.push({ jid, name, type: "chat" });
    }

    // Merge: keep rooms from localStorage + roster contacts from server
    const rooms = contacts.filter(c => c.type === "room");
    contacts = [...rosterContacts, ...rooms];
    renderContacts();

    // Auto-join all saved rooms
    rooms.forEach(room => joinRoom(room.jid));

    console.log(`Roster loaded: ${rosterContacts.length} contacts`);
  });
}

function addContact(jid, name, type = "chat") {
  const exists = contacts.find(c => c.jid === jid);
  if (exists) {
    alert("Bu kişi zaten ekli!");
    return false;
  }

  if (type === "room") {
    // Rooms are stored locally
    contacts.push({ jid, name, type });
    saveRooms();
    renderContacts();
  } else {
    // Add to XMPP Roster on server
    const iq = $iq({ type: "set" })
      .c("query", { xmlns: "jabber:iq:roster" })
      .c("item", { jid: jid, name: name });
    conn.sendIQ(iq, () => {
      contacts.push({ jid, name, type });
      renderContacts();
      subscribeToContact(jid);
      console.log(`Added ${jid} to roster`);
    });
  }

  return true;
}

function removeContact(jid) {
  const contact = contacts.find(c => c.jid === jid);

  if (contact && contact.type === "room") {
    contacts = contacts.filter(c => c.jid !== jid);
    saveRooms();
    renderContacts();
  } else {
    // Remove from XMPP Roster on server
    const iq = $iq({ type: "set" })
      .c("query", { xmlns: "jabber:iq:roster" })
      .c("item", { jid: jid, subscription: "remove" });
    conn.sendIQ(iq, () => {
      contacts = contacts.filter(c => c.jid !== jid);
      renderContacts();
      console.log(`Removed ${jid} from roster`);
    });
  }
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
let pendingCallRoom = null; // room name from incoming invite

function buildCallRoomName(jid1, jid2) {
  return [jid1, jid2].sort().join("-").replace(/@/g, "_").replace(/\./g, "_");
}

function startVideoCall(roomName) {
  if (!roomName) {
    if (!currentChat) {
      alert("Önce bir kişi seçin!");
      return;
    }
    if (currentChat.type === "room") {
      // Group call: use room JID as room name
      roomName = currentChat.jid.replace(/@/g, "_").replace(/\./g, "_");
    } else {
      roomName = buildCallRoomName(myJid, currentChat.jid);
    }
  }

  console.log(`Starting video call, room: ${roomName}`);

  // Show video panel
  const panel = document.getElementById("videoPanel");
  panel.classList.add("active");

  const titleEl = document.getElementById("videoCallTitle");
  if (titleEl && currentChat) titleEl.textContent = currentChat.name || currentChat.jid.split("@")[0];

  // Dispose previous instance if any
  if (jitsiApi) {
    jitsiApi.dispose();
    jitsiApi = null;
  }

  // Initialize Jitsi Meet embedded
  const domain = "meet.jit.si";
  const options = {
    roomName: roomName,
    width: "100%",
    height: "100%",
    parentNode: document.getElementById("jitsiMeet"),
    userInfo: {
      displayName: myJid ? myJid.split("@")[0] : "User"
    },
    configOverwrite: {
      startWithAudioMuted: false,
      startWithVideoMuted: false,
      disableDeepLinking: true
    },
    interfaceConfigOverwrite: {
      SHOW_JITSI_WATERMARK: false,
      SHOW_BRAND_WATERMARK: false,
      TOOLBAR_BUTTONS: [
        "microphone", "camera", "hangup", "chat",
        "tileview", "fullscreen"
      ]
    }
  };

  jitsiApi = new JitsiMeetExternalAPI(domain, options);

  jitsiApi.addEventListener("readyToClose", () => {
    closeVideoCall();
  });
}

function sendCallInvite(toJid, roomName) {
  if (!conn || !conn.authenticated) return;
  const stanza = $msg({ to: toJid, type: "chat" })
    .c("call", { xmlns: "urn:app:call", action: "invite", room: roomName }).up()
    .c("body").t("📹 Görüntülü görüşme daveti gönderildi");
  conn.send(stanza.tree());
}

function sendCallReject(toJid, roomName) {
  if (!conn || !conn.authenticated) return;
  const stanza = $msg({ to: toJid, type: "chat" })
    .c("call", { xmlns: "urn:app:call", action: "reject", room: roomName }).up()
    .c("body").t("📵 Görüntülü görüşme reddedildi");
  conn.send(stanza.tree());
}

function handleCallInvite(fromJid, roomName) {
  pendingCallRoom = roomName;

  const banner = document.getElementById("incomingCallBanner");
  const fromEl = document.getElementById("incomingCallFrom");
  if (fromEl) {
    const contact = contacts.find(c => c.jid === fromJid);
    fromEl.textContent = (contact ? contact.name : fromJid.split("@")[0]) + " arıyor...";
  }
  if (banner) banner.classList.add("active");

  // Auto-dismiss after 30 seconds
  setTimeout(() => {
    if (banner && banner.classList.contains("active")) {
      banner.classList.remove("active");
      pendingCallRoom = null;
    }
  }, 30000);
}

function closeVideoCall() {
  const panel = document.getElementById("videoPanel");
  panel.classList.remove("active");

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

  // Auth tab buttons
  const tabLogin = document.getElementById("tabLogin");
  if (tabLogin) tabLogin.addEventListener("click", () => showAuthTab("login"));
  const tabRegister = document.getElementById("tabRegister");
  if (tabRegister) tabRegister.addEventListener("click", () => showAuthTab("register"));

  // Register button
  const btnRegister = document.getElementById("btnRegister");
  if (btnRegister) btnRegister.addEventListener("click", registerAccount);

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

  // Video call button — send invite then open panel
  const btnVideoCall = document.getElementById("btnVideoCall");
  if (btnVideoCall) {
    btnVideoCall.addEventListener("click", () => {
      if (!currentChat) { alert("Önce bir kişi seçin!"); return; }
      let roomName;
      if (currentChat.type === "room") {
        roomName = currentChat.jid.replace(/@/g, "_").replace(/\./g, "_");
      } else {
        roomName = buildCallRoomName(myJid, currentChat.jid);
        sendCallInvite(currentChat.jid, roomName);
      }
      startVideoCall(roomName);
    });
  }

  // Close video button
  const btnCloseVideo = document.getElementById("closeVideo");
  if (btnCloseVideo) {
    btnCloseVideo.addEventListener("click", closeVideoCall);
  }

  // Accept incoming call
  const btnAcceptCall = document.getElementById("btnAcceptCall");
  if (btnAcceptCall) {
    btnAcceptCall.addEventListener("click", () => {
      const banner = document.getElementById("incomingCallBanner");
      if (banner) banner.classList.remove("active");
      if (pendingCallRoom) {
        startVideoCall(pendingCallRoom);
        pendingCallRoom = null;
      }
    });
  }

  // Reject incoming call
  const btnRejectCall = document.getElementById("btnRejectCall");
  if (btnRejectCall) {
    btnRejectCall.addEventListener("click", () => {
      const banner = document.getElementById("incomingCallBanner");
      if (banner) banner.classList.remove("active");
      pendingCallRoom = null;
    });
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
