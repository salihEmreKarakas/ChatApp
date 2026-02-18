import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from "react-native";
import { WebView } from "react-native-webview";

export default function VideoCallModal({ visible, roomName, displayName, onClose }) {
  if (!roomName) return null;

  // Build the Jitsi URL with config to hide nav/watermark
  const jitsiUrl =
    `https://meet.jit.si/${roomName}` +
    `#config.startWithAudioMuted=false` +
    `&config.startWithVideoMuted=false` +
    `&config.disableDeepLinking=true` +
    `&config.prejoinPageEnabled=false` +
    `&userInfo.displayName=${encodeURIComponent(displayName || "User")}` +
    `&interfaceConfig.SHOW_JITSI_WATERMARK=false` +
    `&interfaceConfig.SHOW_BRAND_WATERMARK=false`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>📹 Görüntülü Görüşme</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕ Bitir</Text>
          </TouchableOpacity>
        </View>

        {/* Jitsi WebView */}
        <WebView
          source={{ uri: jitsiUrl }}
          style={styles.webview}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
          onMessage={(e) => {
            // Handle postMessage from Jitsi if needed
            try {
              const data = JSON.parse(e.nativeEvent.data);
              if (data.type === "hangup") onClose();
            } catch (_) {}
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d0d1a",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#1a1a2e",
  },
  headerTitle: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
  },
  closeBtn: {
    backgroundColor: "#ff4444",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  closeBtnText: {
    color: "white",
    fontSize: 13,
    fontWeight: "700",
  },
  webview: {
    flex: 1,
    backgroundColor: "#000",
  },
});
