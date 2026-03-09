import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useChat } from "../context/ChatContext";
import MessageBubble from "../components/MessageBubble";
import VideoCallModal from "../components/VideoCallModal";
import xmpp from "../services/xmpp";
import * as ImagePicker from "expo-image-picker";

export default function ChatScreen({ route, navigation }) {
  const { contact } = route.params;
  const { state, dispatch } = useChat();
  const [text, setText] = useState("");
  const [videoVisible, setVideoVisible] = useState(false);
  const [videoRoom, setVideoRoom] = useState(null);
  const flatListRef = useRef(null);
  const typingTimerRef = useRef(null);

  const messages = state.messageHistory[contact.jid] || [];
  const isTyping = state.typingStates[contact.jid] === "composing";
  const isOnline = state.presenceStates[contact.jid] === "online";
  const incomingCall = state.incomingCall;

  // Mark as current chat and clear unread
  useEffect(() => {
    dispatch({ type: "SET_CURRENT_CHAT", payload: contact });
    dispatch({ type: "CLEAR_UNREAD", payload: contact.jid });

    // Join room if this is a MUC chat
    if (contact.type === "room") {
      xmpp.joinRoom(contact.jid);
    }

    // Send seen receipts for all received messages (only for direct chats, not rooms)
    if (contact.type !== "room") {
      messages.forEach((msg) => {
        if (!msg.isSent && msg.id) {
          xmpp.sendSeenReceipt(contact.jid, msg.id);
        }
      });
    }

    return () => {
      dispatch({ type: "SET_CURRENT_CHAT", payload: null });
      // Send paused state when leaving
      if (contact.type === "chat") {
        xmpp.sendChatState(contact.jid, "paused");
      }
    };
  }, [contact.jid]);

  // Scroll to bottom and send seen receipt when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && !lastMsg.isSent && lastMsg.id && contact.type !== "room") {
      xmpp.sendSeenReceipt(contact.jid, lastMsg.id);
    }
  }, [messages.length]);

  const handleSend = () => {
    if (!text.trim()) return;

    const msgType = contact.type === "room" ? "groupchat" : "chat";
    const messageId = xmpp.sendMessage(contact.jid, text.trim(), msgType);

    if (messageId) {
      dispatch({
        type: "ADD_MESSAGE",
        payload: {
          jid: contact.jid,
          message: {
            id: messageId,
            from: state.myJid,
            text: text.trim(),
            isSent: true,
            showSender: false,
            timestamp: Date.now(),
            seen: false,
          },
        },
      });
    }

    setText("");

    // Clear typing timer
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
  };

  const getUploadBase = async () => {
    try {
      const creds = await require("@react-native-async-storage/async-storage").default.getItem("login_credentials");
      if (creds) {
        const { serverUrl } = JSON.parse(creds);
        return serverUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://").replace(/\/xmpp-websocket$/, "");
      }
    } catch (_) { }
    return "http://localhost:8888";
  };

  const getUploadToken = async (uploadBase) => {
    const resp = await fetch(`${uploadBase}/upload-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jid: state.myJid, secret: "chatapp-upload-secret-key-change-in-production" }),
    });
    const data = await resp.json();
    return data.token || null;
  };

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const uploadBase = await getUploadBase();

    try {
      const token = await getUploadToken(uploadBase);
      if (!token) {
        console.warn("[Upload] Token alınamadı");
        return;
      }

      const formData = new FormData();
      const fileName = asset.uri.split("/").pop() || "image.jpg";
      formData.append("file", {
        uri: asset.uri,
        name: fileName,
        type: asset.mimeType || "image/jpeg",
      });

      const resp = await fetch(`${uploadBase}/upload`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: formData,
      });
      const data = await resp.json();
      if (data.error) {
        console.warn("[Upload]", data.error);
        return;
      }
      if (data.url) {
        const fullUrl = `${uploadBase}${data.url}`;
        const msgType = contact.type === "room" ? "groupchat" : "chat";
        const messageId = xmpp.sendMessage(contact.jid, fullUrl, msgType);
        if (messageId) {
          dispatch({
            type: "ADD_MESSAGE",
            payload: {
              jid: contact.jid,
              message: {
                id: messageId,
                from: state.myJid,
                text: fullUrl,
                isSent: true,
                showSender: false,
                timestamp: Date.now(),
                seen: false,
              },
            },
          });
        }
      }
    } catch (err) {
      console.warn("[Upload Error]", err);
    }
  };

  const handleTyping = useCallback(
    (value) => {
      setText(value);

      if (contact.type === "room") return;

      // Send composing state
      xmpp.sendChatState(contact.jid, "composing");

      // Reset timer
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }

      typingTimerRef.current = setTimeout(() => {
        xmpp.sendChatState(contact.jid, "paused");
      }, 3000);
    },
    [contact.jid, contact.type]
  );

  const buildCallRoomName = (jid1, jid2) =>
    [jid1, jid2]
      .sort()
      .join("-")
      .replace(/@/g, "_")
      .replace(/\./g, "_");

  const handleStartCall = () => {
    if (contact.type === "room") {
      // Group call uses room JID as room name
      const room = contact.jid.replace(/@/g, "_").replace(/\./g, "_");
      setVideoRoom(room);
      setVideoVisible(true);
    } else {
      const room = buildCallRoomName(state.myJid, contact.jid);
      xmpp.sendCallInvite(contact.jid, room);
      setVideoRoom(room);
      setVideoVisible(true);
    }
  };

  const handleAcceptCall = () => {
    if (!incomingCall) return;
    dispatch({ type: "CLEAR_INCOMING_CALL" });
    setVideoRoom(incomingCall.room);
    setVideoVisible(true);
  };

  const handleRejectCall = () => {
    if (!incomingCall) return;
    xmpp.sendCallReject(incomingCall.from, incomingCall.room);
    dispatch({ type: "CLEAR_INCOMING_CALL" });
  };

  const getSubtitle = () => {
    if (isTyping) return "yaziyor...";
    if (contact.type === "room") return "Grup sohbeti";
    if (isOnline) return "cevrimici";
    return "cevrimdisi";
  };

  const renderItem = useCallback(
    ({ item }) => <MessageBubble message={item} />,
    []
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>{"<"}</Text>
        </TouchableOpacity>

        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>
            {contact.type === "room" ? "🏠" : (contact.name || contact.jid?.split("@")[0] || "?").charAt(0).toUpperCase()}
          </Text>
          {contact.type !== "room" && (
            <View style={[styles.statusDot, isOnline && styles.statusOnline]} />
          )}
        </View>

        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{contact.name || contact.jid?.split("@")[0] || "?"}</Text>
          <Text
            style={[styles.headerSubtitle, isTyping && styles.headerTyping]}
          >
            {getSubtitle()}
          </Text>
        </View>

        {/* Video call button */}
        <TouchableOpacity style={styles.videoBtn} onPress={handleStartCall}>
          <Text style={styles.videoBtnText}>📹</Text>
        </TouchableOpacity>
      </View>

      {/* Incoming call banner */}
      {incomingCall && (
        <View style={styles.callBanner}>
          <Text style={styles.callBannerTitle}>📹 Gelen Arama</Text>
          <Text style={styles.callBannerSub}>
            {(state.contacts.find(c => c.jid === incomingCall.from)?.name ||
              incomingCall.from.split("@")[0])} arıyor...
          </Text>
          <View style={styles.callBannerActions}>
            <TouchableOpacity style={styles.acceptBtn} onPress={handleAcceptCall}>
              <Text style={styles.acceptBtnText}>✓ Kabul Et</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rejectBtn} onPress={handleRejectCall}>
              <Text style={styles.rejectBtnText}>✕ Reddet</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item, index) => item.id || `${index}`}
        renderItem={renderItem}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        onContentSizeChange={() =>
          flatListRef.current?.scrollToEnd({ animated: false })
        }
        onLayout={() =>
          flatListRef.current?.scrollToEnd({ animated: false })
        }
      />

      {/* Typing indicator */}
      {isTyping && (
        <View style={styles.typingBar}>
          <Text style={styles.typingText}>yaziyor...</Text>
        </View>
      )}

      {/* Input */}
      <View style={styles.inputContainer}>
        <TouchableOpacity style={styles.attachBtn} onPress={handlePickImage}>
          <Text style={styles.attachBtnText}>📎</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Mesaj yaz..."
          placeholderTextColor="#999"
          value={text}
          onChangeText={handleTyping}
          multiline
          maxLength={2000}
        />
        <TouchableOpacity
          style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim()}
        >
          <Text style={styles.sendBtnText}>Gonder</Text>
        </TouchableOpacity>
      </View>

      {/* Video Call Modal */}
      <VideoCallModal
        visible={videoVisible}
        roomName={videoRoom}
        displayName={state.myJid ? state.myJid.split("@")[0] : "User"}
        onClose={() => {
          setVideoVisible(false);
          setVideoRoom(null);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f0f5" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 50,
    paddingBottom: 14,
    backgroundColor: "#667eea",
    columnGap: 12,
  },
  backBtn: { fontSize: 24, color: "white", fontWeight: "600", paddingRight: 4 },
  headerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerAvatarText: { color: "white", fontSize: 18, fontWeight: "600" },
  statusDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#9e9e9e",
    borderWidth: 2,
    borderColor: "#667eea",
  },
  statusOnline: { backgroundColor: "#4caf50" },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "white" },
  headerSubtitle: { fontSize: 13, color: "rgba(255,255,255,0.7)" },
  headerTyping: { color: "#b3e5fc", fontStyle: "italic" },
  videoBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  videoBtnText: { fontSize: 20 },
  // Incoming call banner
  callBanner: {
    backgroundColor: "white",
    borderLeftWidth: 4,
    borderLeftColor: "#4caf50",
    padding: 14,
    margin: 10,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  callBannerTitle: { fontSize: 15, fontWeight: "700", marginBottom: 2 },
  callBannerSub: { fontSize: 13, color: "#555", marginBottom: 10 },
  callBannerActions: { flexDirection: "row", gap: 8 },
  acceptBtn: {
    flex: 1,
    backgroundColor: "#4caf50",
    borderRadius: 20,
    paddingVertical: 8,
    alignItems: "center",
  },
  acceptBtnText: { color: "white", fontWeight: "700", fontSize: 13 },
  rejectBtn: {
    flex: 1,
    backgroundColor: "#ff4444",
    borderRadius: 20,
    paddingVertical: 8,
    alignItems: "center",
  },
  rejectBtnText: { color: "white", fontWeight: "700", fontSize: 13 },
  messageList: { flex: 1 },
  messageContent: { paddingVertical: 10 },
  typingBar: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  typingText: {
    fontSize: 13,
    color: "#667eea",
    fontStyle: "italic",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 10,
    backgroundColor: "white",
    borderTopWidth: 0.5,
    borderTopColor: "#e0e0e0",
    columnGap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: "#667eea",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: "white", fontWeight: "600", fontSize: 15 },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
  },
  attachBtnText: { fontSize: 20 },
});
