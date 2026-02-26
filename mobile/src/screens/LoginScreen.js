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
  ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import xmpp from "../services/xmpp";
import { useChat } from "../context/ChatContext";

export default function LoginScreen() {
  const { } = useChat();
  const [mode, setMode] = useState("login"); // "login" | "register"

  // Login state
  const [jid, setJid] = useState("");
  const [password, setPassword] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [connecting, setConnecting] = useState(false);

  // Register state
  const [regUsername, setRegUsername] = useState("");
  const [regPass, setRegPass] = useState("");
  const [regPassConfirm, setRegPassConfirm] = useState("");
  const [registering, setRegistering] = useState(false);

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

  const handleRegister = async () => {
    if (!regUsername.trim()) {
      Alert.alert("Hata", "Kullanıcı adı boş olamaz.");
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(regUsername.trim())) {
      Alert.alert("Hata", "Kullanıcı adı sadece harf, rakam, nokta, tire ve alt çizgi içerebilir.");
      return;
    }
    if (regPass.length < 4) {
      Alert.alert("Hata", "Şifre en az 4 karakter olmalı.");
      return;
    }
    if (regPass !== regPassConfirm) {
      Alert.alert("Hata", "Şifreler eşleşmiyor.");
      return;
    }

    const wsUrl = serverUrl.trim() || "ws://localhost/xmpp-websocket";
    setRegistering(true);
    try {
      await xmpp.register(regUsername.trim(), regPass, wsUrl);
      Alert.alert(
        "Kayıt Başarılı",
        "Hesabınız oluşturuldu! Giriş yapabilirsiniz.",
        [{ text: "Giriş Yap", onPress: () => {
          const domain = wsUrl.replace(/^wss?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
          setJid(regUsername.trim() + "@" + domain);
          setPassword(regPass);
          setMode("login");
        }}]
      );
    } catch (err) {
      Alert.alert("Kayıt Hatası", err.message || "Kayıt başarısız.");
    } finally {
      setRegistering(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>💬</Text>
          </View>
          <Text style={styles.title}>ChatApp</Text>
          <Text style={styles.subtitle}>XMPP Messenger</Text>
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, mode === "login" && styles.tabActive]}
            onPress={() => setMode("login")}
          >
            <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>
              Giriş Yap
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === "register" && styles.tabActive]}
            onPress={() => setMode("register")}
          >
            <Text style={[styles.tabText, mode === "register" && styles.tabTextActive]}>
              Kayıt Ol
            </Text>
          </TouchableOpacity>
        </View>

        {/* Login Form */}
        {mode === "login" && (
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
        )}

        {/* Register Form */}
        {mode === "register" && (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Kullanıcı adı (örn: emre)"
              placeholderTextColor="#999"
              value={regUsername}
              onChangeText={setRegUsername}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={styles.input}
              placeholder="Şifre (en az 4 karakter)"
              placeholderTextColor="#999"
              value={regPass}
              onChangeText={setRegPass}
              secureTextEntry
            />
            <TextInput
              style={styles.input}
              placeholder="Şifre tekrar"
              placeholderTextColor="#999"
              value={regPassConfirm}
              onChangeText={setRegPassConfirm}
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
              style={[styles.button, styles.buttonRegister, registering && styles.buttonDisabled]}
              onPress={handleRegister}
              disabled={registering}
            >
              {registering ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.buttonText}>Kayıt Ol</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f0f0f5",
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 32,
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
  logoText: { fontSize: 36 },
  title: { fontSize: 28, fontWeight: "700", color: "#333" },
  subtitle: { fontSize: 14, color: "#888", marginTop: 4 },
  tabs: {
    flexDirection: "row",
    backgroundColor: "white",
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 9,
  },
  tabActive: {
    backgroundColor: "#667eea",
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#888",
  },
  tabTextActive: {
    color: "white",
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
  buttonRegister: {
    backgroundColor: "#43a047",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "white", fontSize: 18, fontWeight: "600" },
});
