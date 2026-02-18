import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import xmpp from "../services/xmpp";
import { useChat } from "../context/ChatContext";

export default function LoginScreen() {
  const { state } = useChat();
  const [jid, setJid] = useState("");
  const [password, setPassword] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [connecting, setConnecting] = useState(false);

  // Load saved credentials on mount
  React.useEffect(() => {
    AsyncStorage.getItem("login_credentials").then((data) => {
      if (data) {
        const saved = JSON.parse(data);
        setJid(saved.jid || "");
        setServerUrl(saved.serverUrl || "");
      }
    });
  }, []);

  const handleConnect = async () => {
    if (!jid.trim() || !password.trim()) {
      Alert.alert("Hata", "Kullanici adi ve sifre gerekli!");
      return;
    }

    const wsUrl = serverUrl.trim() || "ws://localhost/xmpp-websocket";

    setConnecting(true);
    try {
      await xmpp.connect(jid.trim(), password, wsUrl);

      // Save credentials (not password)
      AsyncStorage.setItem(
        "login_credentials",
        JSON.stringify({ jid: jid.trim(), serverUrl: wsUrl })
      );
    } catch (err) {
      Alert.alert("Baglanti Hatasi", err.message || "Sunucuya baglanilamadi!");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.logoContainer}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>💬</Text>
        </View>
        <Text style={styles.title}>ChatApp</Text>
        <Text style={styles.subtitle}>XMPP Messenger</Text>
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Kullanici adi (emre@localhost)"
          placeholderTextColor="#999"
          value={jid}
          onChangeText={setJid}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />

        <TextInput
          style={styles.input}
          placeholder="Sifre"
          placeholderTextColor="#999"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TextInput
          style={styles.input}
          placeholder="Sunucu (wss://example.com/xmpp-websocket)"
          placeholderTextColor="#999"
          value={serverUrl}
          onChangeText={setServerUrl}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity
          style={[styles.button, connecting && styles.buttonDisabled]}
          onPress={handleConnect}
          disabled={connecting}
        >
          {connecting ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.buttonText}>Baglan</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f0f0f5",
    justifyContent: "center",
    padding: 24,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 40,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "#667eea",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  logoText: {
    fontSize: 36,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#333",
  },
  subtitle: {
    fontSize: 14,
    color: "#888",
    marginTop: 4,
  },
  form: {
    rowGap: 12,
  },
  input: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  button: {
    backgroundColor: "#667eea",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
  },
});
