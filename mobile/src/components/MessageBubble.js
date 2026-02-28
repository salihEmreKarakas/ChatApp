import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";

const IMAGE_REGEX = /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i;

export default function MessageBubble({ message }) {
  const { text, isSent, showSender, from, timestamp, seen } = message;
  const isImage = IMAGE_REGEX.test(text?.trim() || "");

  const time = new Date(timestamp).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <View style={[styles.row, isSent && styles.rowSent]}>
      <View style={[styles.bubble, isSent ? styles.bubbleSent : styles.bubbleReceived, isImage && styles.bubbleImage]}>
        {showSender && (
          <Text style={styles.sender}>{from}</Text>
        )}
        {isImage ? (
          <Image source={{ uri: text.trim() }} style={styles.image} resizeMode="cover" />
        ) : (
          <Text style={[styles.text, isSent && styles.textSent]}>{text}</Text>
        )}
        <View style={styles.meta}>
          <Text style={[styles.time, isSent && styles.timeSent]}>{time}</Text>
          {isSent && (
            <Text style={[styles.seen, seen && styles.seenBlue]}>
              {seen ? "\u2713\u2713" : "\u2713"}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    marginVertical: 2,
    marginHorizontal: 10,
  },
  rowSent: {
    justifyContent: "flex-end",
  },
  bubble: {
    maxWidth: "78%",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  bubbleSent: {
    backgroundColor: "#667eea",
    borderBottomRightRadius: 4,
  },
  bubbleReceived: {
    backgroundColor: "white",
    borderBottomLeftRadius: 4,
    borderWidth: 0.5,
    borderColor: "#e0e0e0",
  },
  bubbleImage: {
    padding: 4,
    maxWidth: "85%",
  },
  image: {
    width: 220,
    height: 220,
    borderRadius: 12,
  },
  sender: {
    fontSize: 12,
    fontWeight: "700",
    color: "#667eea",
    marginBottom: 2,
  },
  text: {
    fontSize: 16,
    color: "#111",
    lineHeight: 22,
  },
  textSent: {
    color: "white",
  },
  meta: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginTop: 2,
    columnGap: 4,
  },
  time: {
    fontSize: 11,
    color: "#999",
  },
  timeSent: {
    color: "rgba(255,255,255,0.7)",
  },
  seen: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
  },
  seenBlue: {
    color: "#b3e5fc",
  },
});
