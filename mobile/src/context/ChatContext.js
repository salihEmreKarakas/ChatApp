import React, { createContext, useContext, useReducer, useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import xmpp from "../services/xmpp";

const ChatContext = createContext();

const initialState = {
  connected: false,
  myJid: null,
  contacts: [],
  messageHistory: {},
  unreadCounts: {},
  presenceStates: {},
  typingStates: {},
  currentChat: null,
  incomingCall: null, // { from, room } when someone calls us
};

function chatReducer(state, action) {
  switch (action.type) {
    case "SET_CONNECTED":
      return { ...state, connected: true, myJid: action.payload };

    case "SET_DISCONNECTED":
      return { ...state, connected: false, myJid: null, presenceStates: {}, typingStates: {} };

    case "SET_CONTACTS":
      return { ...state, contacts: action.payload };

    case "ADD_CONTACT": {
      const exists = state.contacts.find((c) => c.jid === action.payload.jid);
      if (exists) return state;
      return { ...state, contacts: [...state.contacts, action.payload] };
    }

    case "REMOVE_CONTACT":
      return {
        ...state,
        contacts: state.contacts.filter((c) => c.jid !== action.payload),
      };

    case "SET_CURRENT_CHAT":
      return { ...state, currentChat: action.payload };

    case "ADD_MESSAGE": {
      const { jid, message } = action.payload;
      const history = { ...state.messageHistory };
      if (!history[jid]) history[jid] = [];

      // Prevent duplicates by ID only
      if (message.id && history[jid].find((m) => m.id === message.id)) return state;

      history[jid] = [...history[jid], message].sort((a, b) => a.timestamp - b.timestamp).slice(-100);
      return { ...state, messageHistory: history };
    }

    case "MARK_SEEN": {
      const { jid, messageId } = action.payload;
      const history = { ...state.messageHistory };
      if (!history[jid]) return state;

      history[jid] = history[jid].map((m) =>
        m.id === messageId && m.isSent ? { ...m, seen: true } : m
      );
      return { ...state, messageHistory: history };
    }

    case "SET_MESSAGE_HISTORY":
      return { ...state, messageHistory: action.payload };

    case "INCREMENT_UNREAD": {
      const counts = { ...state.unreadCounts };
      counts[action.payload] = (counts[action.payload] || 0) + 1;
      return { ...state, unreadCounts: counts };
    }

    case "CLEAR_UNREAD": {
      const counts = { ...state.unreadCounts };
      counts[action.payload] = 0;
      return { ...state, unreadCounts: counts };
    }

    case "SET_PRESENCE": {
      const { jid, online } = action.payload;
      return {
        ...state,
        presenceStates: { ...state.presenceStates, [jid]: online ? "online" : "offline" },
      };
    }

    case "SET_TYPING": {
      const { jid, state: typingState } = action.payload;
      return {
        ...state,
        typingStates: { ...state.typingStates, [jid]: typingState },
      };
    }

    case "SET_INCOMING_CALL":
      return { ...state, incomingCall: action.payload };

    case "CLEAR_INCOMING_CALL":
      return { ...state, incomingCall: null };

    default:
      return state;
  }
}

export function ChatProvider({ children }) {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Persist messages
  useEffect(() => {
    if (state.myJid && Object.keys(state.messageHistory).length > 0) {
      AsyncStorage.setItem(
        `messages_${state.myJid}`,
        JSON.stringify(state.messageHistory)
      );
    }
  }, [state.messageHistory, state.myJid]);

  // Persist rooms
  useEffect(() => {
    if (state.myJid) {
      const rooms = state.contacts.filter((c) => c.type === "room");
      AsyncStorage.setItem(`rooms_${state.myJid}`, JSON.stringify(rooms));
    }
  }, [state.contacts, state.myJid]);

  // Load persisted data on connect
  useEffect(() => {
    if (state.myJid) {
      AsyncStorage.getItem(`messages_${state.myJid}`).then((data) => {
        if (data) {
          dispatch({ type: "SET_MESSAGE_HISTORY", payload: JSON.parse(data) });
        }
      });
    }
  }, [state.myJid]);

  // XMPP event listeners
  useEffect(() => {
    const onConnected = async (myJid) => {
      dispatch({ type: "SET_CONNECTED", payload: myJid });

      // Load rooms from storage
      const roomsData = await AsyncStorage.getItem(`rooms_${myJid}`);
      const rooms = roomsData
        ? JSON.parse(roomsData)
        : [{ jid: "general@conference.localhost", name: "Genel Oda", type: "room" }];

      // Set rooms first, roster will merge when it arrives
      dispatch({ type: "SET_CONTACTS", payload: rooms });

      // Auto-join all rooms immediately so messages arrive even when chat isn't open
      rooms.forEach(room => xmpp.joinRoom(room.jid));

      // Fetch roster from server (result comes via rosterResult event)
      xmpp.fetchRoster();

      // Fetch message archive
      xmpp.fetchMAM();
    };

    const onDisconnected = () => {
      dispatch({ type: "SET_DISCONNECTED" });
    };

    const onMessage = ({ from, text, messageId }) => {
      dispatch({
        type: "ADD_MESSAGE",
        payload: {
          jid: from,
          message: {
            id: messageId,
            from,
            text,
            isSent: false,
            showSender: false,
            timestamp: Date.now(),
            seen: null,
          },
        },
      });

      // Increment unread if not current chat
      const current = stateRef.current.currentChat;
      if (!current || current.jid !== from) {
        dispatch({ type: "INCREMENT_UNREAD", payload: from });
      } else {
        // Send seen receipt if chat is open
        xmpp.sendSeenReceipt(from, messageId);
      }
    };

    const onGroupMessage = ({ roomJid, from, text, messageId, isSent }) => {
      dispatch({
        type: "ADD_MESSAGE",
        payload: {
          jid: roomJid,
          message: {
            id: messageId,
            from,
            text,
            isSent,
            showSender: !isSent,
            timestamp: Date.now(),
            seen: null,
          },
        },
      });

      const current = stateRef.current.currentChat;
      if (!current || current.jid !== roomJid) {
        dispatch({ type: "INCREMENT_UNREAD", payload: roomJid });
      }
    };

    const onSeen = ({ from, messageId }) => {
      dispatch({ type: "MARK_SEEN", payload: { jid: from, messageId } });
    };

    const onChatState = ({ from, state: chatState }) => {
      dispatch({
        type: "SET_TYPING",
        payload: { jid: from, state: chatState },
      });
    };

    const onPresence = ({ jid, online }) => {
      dispatch({ type: "SET_PRESENCE", payload: { jid, online } });
    };

    const onMAMMessage = ({ contactJid, from, text, messageId, isSent, timestamp }) => {
      dispatch({
        type: "ADD_MESSAGE",
        payload: {
          jid: contactJid,
          message: {
            id: messageId,
            from,
            text,
            isSent,
            showSender: false,
            timestamp,
            seen: null,
          },
        },
      });
    };

    const onRosterResult = (rosterContacts) => {
      // Filter out conference JIDs from roster (they're rooms, not contacts)
      const chatContacts = rosterContacts.filter((c) => !c.jid.includes("conference."));
      const rooms = stateRef.current.contacts.filter((c) => c.type === "room");

      // Deduplicate by jid
      const seen = new Set();
      const merged = [];
      for (const c of [...chatContacts, ...rooms]) {
        if (!seen.has(c.jid)) {
          seen.add(c.jid);
          merged.push(c);
        }
      }
      dispatch({ type: "SET_CONTACTS", payload: merged });

      // Subscribe to chat contacts for presence
      chatContacts.forEach((c) => xmpp.subscribeToContact(c.jid));
    };

    const onCall = ({ from, action, room }) => {
      if (action === "invite") {
        dispatch({ type: "SET_INCOMING_CALL", payload: { from, room } });
      } else if (action === "reject") {
        // Remote end rejected our call — could show a notification here
        dispatch({ type: "CLEAR_INCOMING_CALL" });
      }
    };

    xmpp.on("connected", onConnected);
    xmpp.on("disconnected", onDisconnected);
    xmpp.on("message", onMessage);
    xmpp.on("groupMessage", onGroupMessage);
    xmpp.on("seen", onSeen);
    xmpp.on("chatState", onChatState);
    xmpp.on("presence", onPresence);
    xmpp.on("mamMessage", onMAMMessage);
    xmpp.on("rosterResult", onRosterResult);
    xmpp.on("call", onCall);

    return () => {
      xmpp.off("connected", onConnected);
      xmpp.off("disconnected", onDisconnected);
      xmpp.off("message", onMessage);
      xmpp.off("groupMessage", onGroupMessage);
      xmpp.off("seen", onSeen);
      xmpp.off("chatState", onChatState);
      xmpp.off("presence", onPresence);
      xmpp.off("mamMessage", onMAMMessage);
      xmpp.off("rosterResult", onRosterResult);
      xmpp.off("call", onCall);
    };
  }, []);

  return (
    <ChatContext.Provider value={{ state, dispatch }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  return useContext(ChatContext);
}
