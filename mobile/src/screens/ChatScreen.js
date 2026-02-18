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
import xmpp from "../services/xmpp";

export default function ChatScreen({ route, navigation }) {
  const { contact } = route.params;
  const { state, dispatch } = useChat();
  const [text, setText] = useState("");
  const flatListRef = useRef(null);
  const typingTimerRef = useRef(null);

  const messages = state.messageHistory[contact.jid] || [];
  const isTyping = state.typingStates[contact.jid] === "composing";
  const isOnline = state.presenceStates[contact.jid] === "online";

  // Mark as current chat and clear unread
  useEffect(() => {
    dispatch({ type: "SET_CURRENT_CHAT", payload: contact });
    dispatch({ type: "CLEAR_UNREAD", payload: contact.jid });

    // Join room if this is a MUC chat
    if (contact.type === "room") {
      xmpp.joinRoom(contact.jid);
    }

    // Send seen receipts for all received messages
    messages.forEach((msg) => {
      if (!msg.isSent && msg.id) {
        xmpp.sendSeenReceipt(contact.jid, msg.id);
      }
    });

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
    if (lastMsg && !lastMsg.isSent && lastMsg.id) {
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
            {contact.type === "room" ? "🏠" : contact.name.charAt(0).toUpperCase()}
          </Text>
          {contact.type !== "room" && (
            <View style={[styles.statusDot, isOnline && styles.statusOnline]} />
          )}
        </View>

        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{contact.name}</Text>
          <Text
            style={[styles.headerSubtitle, isTyping && styles.headerTyping]}
          >
            {getSubtitle()}
          </Text>
        </View>
      </View>

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
});
