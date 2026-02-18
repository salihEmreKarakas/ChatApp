import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
} from "react-native";
import { useChat } from "../context/ChatContext";
import ContactItem from "../components/ContactItem";
import xmpp from "../services/xmpp";

export default function ContactsScreen({ navigation }) {
  const { state, dispatch } = useChat();
  const [modalVisible, setModalVisible] = useState(false);
  const [newJid, setNewJid] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("chat");

  const handleContactPress = (contact) => {
    dispatch({ type: "SET_CURRENT_CHAT", payload: contact });
    dispatch({ type: "CLEAR_UNREAD", payload: contact.jid });

    if (contact.type === "room") {
      xmpp.joinRoom(contact.jid);
    }

    navigation.navigate("Chat", { contact });
  };

  const handleRemoveContact = async (jid, type) => {
    try {
      if (type === "chat") {
        await xmpp.removeFromRoster(jid);
      }
      dispatch({ type: "REMOVE_CONTACT", payload: jid });
    } catch (err) {
      Alert.alert("Hata", "Kisi silinemedi!");
    }
  };

  const handleAddContact = async () => {
    if (!newJid.trim() || !newName.trim()) {
      Alert.alert("Hata", "Tum alanlari doldurun!");
      return;
    }

    try {
      if (newType === "chat") {
        await xmpp.addToRoster(newJid.trim(), newName.trim());
      }
      dispatch({
        type: "ADD_CONTACT",
        payload: { jid: newJid.trim(), name: newName.trim(), type: newType },
      });
      setModalVisible(false);
      setNewJid("");
      setNewName("");
    } catch (err) {
      Alert.alert("Hata", "Kisi eklenemedi!");
    }
  };

  const handleDisconnect = async () => {
    await xmpp.disconnect();
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>ChatApp</Text>
          <Text style={styles.headerSubtitle}>{state.myJid}</Text>
        </View>
        <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
          <Text style={styles.disconnectText}>Cikis</Text>
        </TouchableOpacity>
      </View>

      {/* Contact List */}
      <FlatList
        data={state.contacts}
        keyExtractor={(item) => item.jid}
        renderItem={({ item }) => (
          <ContactItem
            contact={item}
            isOnline={state.presenceStates[item.jid] === "online"}
            unreadCount={state.unreadCounts[item.jid] || 0}
            onPress={() => handleContactPress(item)}
            onRemove={handleRemoveContact}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Henuz kisi eklenmedi</Text>
            <Text style={styles.emptySubtext}>+ butonuna tiklayarak kisi ekleyin</Text>
          </View>
        }
      />

      {/* FAB - Add Contact */}
      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Add Contact Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Kisi Ekle</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="JID (ornek: ayse@localhost)"
              placeholderTextColor="#999"
              value={newJid}
              onChangeText={setNewJid}
              autoCapitalize="none"
            />

            <TextInput
              style={styles.modalInput}
              placeholder="Isim"
              placeholderTextColor="#999"
              value={newName}
              onChangeText={setNewName}
            />

            <View style={styles.typeRow}>
              <TouchableOpacity
                style={[styles.typeBtn, newType === "chat" && styles.typeBtnActive]}
                onPress={() => setNewType("chat")}
              >
                <Text style={[styles.typeText, newType === "chat" && styles.typeTextActive]}>
                  Kisi
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeBtn, newType === "room" && styles.typeBtnActive]}
                onPress={() => setNewType("room")}
              >
                <Text style={[styles.typeText, newType === "room" && styles.typeTextActive]}>
                  Oda
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => { setModalVisible(false); setNewJid(""); setNewName(""); }}
              >
                <Text style={styles.cancelText}>Iptal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleAddContact}>
                <Text style={styles.saveText}>Ekle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "white" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 14,
    backgroundColor: "#667eea",
  },
  headerTitle: { fontSize: 22, fontWeight: "700", color: "white" },
  headerSubtitle: { fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  disconnectBtn: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  disconnectText: { color: "white", fontWeight: "600" },
  empty: { alignItems: "center", marginTop: 80 },
  emptyText: { fontSize: 18, color: "#888" },
  emptySubtext: { fontSize: 14, color: "#bbb", marginTop: 8 },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 30,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#667eea",
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  fabText: { fontSize: 28, color: "white", fontWeight: "300" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  modalContent: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: { fontSize: 20, fontWeight: "700", color: "#333", marginBottom: 16 },
  modalInput: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
  },
  typeRow: { flexDirection: "row", columnGap: 10, marginBottom: 16 },
  typeBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    alignItems: "center",
  },
  typeBtnActive: { borderColor: "#667eea", backgroundColor: "#f0f0ff" },
  typeText: { color: "#888", fontWeight: "600" },
  typeTextActive: { color: "#667eea" },
  modalButtons: { flexDirection: "row", gap: 10 },
  cancelBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#f0f0f0",
  },
  cancelText: { color: "#666", fontWeight: "600" },
  saveBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#667eea",
  },
  saveText: { color: "white", fontWeight: "600" },
});
