import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";

export default function ContactItem({ contact, isOnline, unreadCount, onPress, onRemove }) {
  const isRoom = contact.type === "room";
  const initial = isRoom ? "G" : contact.name.charAt(0).toUpperCase();

  const handleLongPress = () => {
    Alert.alert(
      "Kisiyi Sil",
      `${contact.name} kisisini silmek istiyor musunuz?`,
      [
        { text: "Iptal", style: "cancel" },
        { text: "Sil", style: "destructive", onPress: () => onRemove(contact.jid, contact.type) },
      ]
    );
  };

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      onLongPress={handleLongPress}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{isRoom ? "🏠" : initial}</Text>
        {!isRoom && (
          <View style={[styles.statusDot, isOnline && styles.statusOnline]} />
        )}
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {contact.name}
        </Text>
        <Text style={styles.jid} numberOfLines={1}>
          {isRoom ? "Grup sohbeti" : contact.jid}
        </Text>
      </View>

      {unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: "#eee",
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#667eea",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  avatarText: {
    color: "white",
    fontSize: 20,
    fontWeight: "600",
  },
  statusDot: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#9e9e9e",
    borderWidth: 2,
    borderColor: "white",
  },
  statusOnline: {
    backgroundColor: "#4caf50",
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111",
  },
  jid: {
    fontSize: 13,
    color: "#888",
    marginTop: 2,
  },
  badge: {
    backgroundColor: "#667eea",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 24,
    alignItems: "center",
  },
  badgeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "700",
  },
});
