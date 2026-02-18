import { DOMParser } from "@xmldom/xmldom";
import { EventEmitter } from "events";

const domParser = new DOMParser();

function parseXML(str) {
  return domParser.parseFromString(str, "text/xml").documentElement;
}

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

class XMPPService extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.myJid = null;
    this.connected = false;
    this._authData = null;
    this._local = null;
    this._domain = null;
    this._resolveConnect = null;
    this._rejectConnect = null;
  }

  async connect(userJid, password, serverUrl) {
    this._authData = { jid: userJid, password };
    const parts = userJid.split("@");
    this._local = parts[0];
    this._domain = parts[1] || "localhost";

    return new Promise((resolve, reject) => {
      this._resolveConnect = resolve;
      this._rejectConnect = reject;

      this.ws = new WebSocket(serverUrl, "xmpp");

      this.ws.onopen = () => {
        console.log("[WS] Connected to server");
        this._sendRaw(
          `<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="${this._domain}" version="1.0"/>`
        );
      };

      this.ws.onmessage = (event) => {
        this._onData(event.data);
      };

      this.ws.onerror = (err) => {
        console.log("[WS] Error:", err.message || err);
        this.emit("error", err);
        reject(new Error("WebSocket baglanti hatasi"));
      };

      this.ws.onclose = () => {
        console.log("[WS] Closed");
        this.connected = false;
        this.emit("disconnected");
      };

      setTimeout(() => {
        if (!this.connected) {
          reject(new Error("Baglanti zaman asimi (15s)"));
          this.disconnect();
        }
      }, 15000);
    });
  }

  _sendRaw(data) {
    const wsState = this.ws ? this.ws.readyState : "NO_WS";
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log("[XMPP SEND]", data.substring(0, 200));
      this.ws.send(data);
    } else {
      console.warn("[XMPP SEND FAILED] wsState=" + wsState + " connected=" + this.connected, data.substring(0, 100));
    }
  }

  _onData(data) {
    console.log("[XMPP RECV]", data.substring(0, 300));

    // Stream open
    if (data.includes("<open ") || data.includes("<stream:stream")) {
      return;
    }

    // Stream features - auth or bind
    if (data.includes("stream:features") || data.includes("<features")) {
      if (data.includes("<mechanisms")) {
        this._sendAuth();
      } else if (data.includes("<bind")) {
        this._sendBind();
      }
      return;
    }

    // Auth success -> restart stream
    if (data.includes("<success")) {
      this._sendRaw(
        `<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="${this._domain}" version="1.0"/>`
      );
      return;
    }

    // Auth failure
    if (data.includes("<failure")) {
      const err = new Error("Kullanici adi veya sifre yanlis");
      if (this._rejectConnect) this._rejectConnect(err);
      return;
    }

    // Bind result with JID
    if (data.includes("<bind") && data.includes("<jid>")) {
      const match = data.match(/<jid>([^<]+)<\/jid>/);
      if (match) {
        this.myJid = match[1].split("/")[0];
        this.connected = true;

        // Send presence + session
        this._sendRaw('<presence xmlns="jabber:client"/>');
        this._sendRaw(
          '<iq type="set" id="sess1" xmlns="jabber:client"><session xmlns="urn:ietf:params:xml:ns:xmpp-session"/></iq>'
        );

        this.emit("connected", this.myJid);
        if (this._resolveConnect) this._resolveConnect();
      }
      return;
    }

    // Parse regular stanzas
    try {
      let el;
      try {
        el = parseXML(data);
      } catch {
        el = parseXML("<w>" + data + "</w>");
        for (let i = 0; i < el.childNodes.length; i++) {
          this._handleStanza(el.childNodes[i]);
        }
        return;
      }
      this._handleStanza(el);
    } catch (e) {
      // Ignore parse errors
    }
  }

  _sendAuth() {
    const { jid, password } = this._authData;
    const local = jid.split("@")[0];

    // Build SASL PLAIN: \0username\0password as byte array
    // btoa() in Hermes/React Native doesn't handle null bytes properly
    const bytes = [];
    bytes.push(0); // null byte
    for (let i = 0; i < local.length; i++) bytes.push(local.charCodeAt(i));
    bytes.push(0); // null byte
    for (let i = 0; i < password.length; i++) bytes.push(password.charCodeAt(i));

    // Manual base64 encode from byte array
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let b64 = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      b64 += chars[(b0 >> 2) & 0x3f];
      b64 += chars[((b0 << 4) | (b1 >> 4)) & 0x3f];
      b64 += i + 1 < bytes.length ? chars[((b1 << 2) | (b2 >> 6)) & 0x3f] : "=";
      b64 += i + 2 < bytes.length ? chars[b2 & 0x3f] : "=";
    }

    this._sendRaw(
      `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">${b64}</auth>`
    );
  }

  _sendBind() {
    this._sendRaw(
      '<iq type="set" id="bind1" xmlns="jabber:client"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><resource>mobile</resource></bind></iq>'
    );
  }

  disconnect() {
    if (this.ws) {
      try {
        this._sendRaw('<close xmlns="urn:ietf:params:xml:ns:xmpp-framing"/>');
        this.ws.close();
      } catch (e) {}
    }
    this.connected = false;
    this.myJid = null;
  }

  // --- Stanza Handlers ---
  _handleStanza(el) {
    if (!el || !el.tagName) return;
    const tag = el.tagName;
    if (tag === "message") this._handleMessage(el);
    else if (tag === "presence") this._handlePresence(el);
    else if (tag === "iq") this._handleIQ(el);
  }

  _getText(el, name) {
    const c = el.getElementsByTagName(name)[0];
    return c ? (c.textContent || "") : null;
  }

  _getEl(el, name) {
    return el.getElementsByTagName(name)[0] || null;
  }

  _handleMessage(msg) {
    const from = msg.getAttribute("from") || "";
    const fromJid = from.split("/")[0];
    const type = msg.getAttribute("type") || "chat";

    if (this._getEl(msg, "seen")) {
      const messageId = this._getEl(msg, "seen").getAttribute("id");
      this.emit("seen", { from: fromJid, messageId });
      return;
    }

    if (this._getEl(msg, "composing")) {
      this.emit("chatState", { from: fromJid, state: "composing" });
      return;
    }
    if (this._getEl(msg, "paused") || this._getEl(msg, "active")) {
      this.emit("chatState", { from: fromJid, state: "active" });
      return;
    }

    const result = this._getEl(msg, "result");
    if (result) {
      this._handleMAMResult(result);
      return;
    }

    const bodyText = this._getText(msg, "body");
    if (bodyText) {
      const messageId = msg.getAttribute("id") || "msg_" + Date.now();
      if (type === "groupchat") {
        const sender = from.split("/")[1] || fromJid;
        const isSent = sender === this._local;
        this.emit("groupMessage", { roomJid: fromJid, from: sender, text: bodyText, messageId, isSent });
      } else {
        this.emit("message", { from: fromJid, text: bodyText, messageId });
      }
    }
  }

  _handlePresence(pres) {
    const from = pres.getAttribute("from") || "";
    const fromJid = from.split("/")[0];
    const type = pres.getAttribute("type") || "";

    if (!fromJid || fromJid === this.myJid) return;

    if (type === "subscribe") {
      this._sendRaw(`<presence to="${fromJid}" type="subscribed"/>`);
      this._sendRaw(`<presence to="${fromJid}" type="subscribe"/>`);
      return;
    }

    if (fromJid.includes("conference.")) return;
    const isOnline = !type || type === "available";
    this.emit("presence", { jid: fromJid, online: isOnline });
  }

  _handleIQ(iq) {
    const id = iq.getAttribute("id") || "";
    if (id === "roster1") {
      const items = iq.getElementsByTagName("item");
      const contacts = [];
      for (let i = 0; i < items.length; i++) {
        const j = items[i].getAttribute("jid");
        const n = items[i].getAttribute("name") || j.split("@")[0];
        contacts.push({ jid: j, name: n, type: "chat" });
      }
      this.emit("rosterResult", contacts);
    }
  }

  _handleMAMResult(result) {
    const forwarded = this._getEl(result, "forwarded");
    if (!forwarded) return;
    const message = this._getEl(forwarded, "message");
    const delay = this._getEl(forwarded, "delay");
    if (!message) return;

    const bodyText = this._getText(message, "body");
    if (!bodyText) return;

    const from = message.getAttribute("from") || "";
    const to = message.getAttribute("to") || "";
    const fromJid = from.split("/")[0];
    const toJid = to.split("/")[0];
    const messageId = message.getAttribute("id") || "mam_" + Date.now();
    const isSent = fromJid === this.myJid;
    const contactJid = isSent ? toJid : fromJid;

    let timestamp = Date.now();
    if (delay) {
      const stamp = delay.getAttribute("stamp");
      if (stamp) timestamp = new Date(stamp).getTime();
    }

    this.emit("mamMessage", { contactJid, from: isSent ? this.myJid : from, text: bodyText, messageId, isSent, timestamp });
  }

  // --- Send ---
  sendMessage(toJid, text, type = "chat") {
    console.log("[sendMessage] connected=" + this.connected + " to=" + toJid + " text=" + text.substring(0, 30));
    if (!this.connected) {
      console.warn("[sendMessage] ABORTED - not connected");
      return null;
    }
    const id = "msg_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    this._sendRaw(
      `<message xmlns="jabber:client" to="${toJid}" type="${type}" id="${id}"><body>${escapeXml(text)}</body><active xmlns="http://jabber.org/protocol/chatstates"/></message>`
    );
    return id;
  }

  sendChatState(toJid, state) {
    if (!this.connected) return;
    this._sendRaw(`<message xmlns="jabber:client" to="${toJid}" type="chat"><${state} xmlns="http://jabber.org/protocol/chatstates"/></message>`);
  }

  sendSeenReceipt(toJid, messageId) {
    if (!this.connected) return;
    this._sendRaw(`<message xmlns="jabber:client" to="${toJid}" type="chat"><seen xmlns="urn:xmpp:receipts" id="${messageId}"/></message>`);
  }

  fetchRoster() {
    if (!this.connected) return;
    this._sendRaw('<iq xmlns="jabber:client" type="get" id="roster1"><query xmlns="jabber:iq:roster"/></iq>');
  }

  addToRoster(contactJid, name) {
    if (!this.connected) return;
    this._sendRaw(`<iq xmlns="jabber:client" type="set" id="addR"><query xmlns="jabber:iq:roster"><item jid="${contactJid}" name="${escapeXml(name)}"/></query></iq>`);
    this.subscribeToContact(contactJid);
  }

  removeFromRoster(contactJid) {
    if (!this.connected) return;
    this._sendRaw(`<iq xmlns="jabber:client" type="set" id="rmR"><query xmlns="jabber:iq:roster"><item jid="${contactJid}" subscription="remove"/></query></iq>`);
  }

  subscribeToContact(contactJid) {
    if (!this.connected) return;
    this._sendRaw(`<presence xmlns="jabber:client" to="${contactJid}" type="subscribe"/>`);
    this._sendRaw(`<presence xmlns="jabber:client" to="${contactJid}" type="subscribed"/>`);
  }

  fetchMAM() {
    if (!this.connected) return;
    this._sendRaw(
      '<iq xmlns="jabber:client" type="set" id="mam1"><query xmlns="urn:xmpp:mam:2"><x xmlns="jabber:x:data" type="submit"><field var="FORM_TYPE" type="hidden"><value>urn:xmpp:mam:2</value></field></x><set xmlns="http://jabber.org/protocol/rsm"><max>100</max><before/></set></query></iq>'
    );
  }

  joinRoom(roomJid) {
    if (!this.connected) return;
    const nick = this._local || "user";
    this._sendRaw(`<presence xmlns="jabber:client" to="${roomJid}/${nick}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
  }
}

export default new XMPPService();
