# ChatApp

Gerçek zamanlı mesajlaşma ve görüntülü görüşme uygulaması. XMPP protokolü üzerine kurulu; web ve mobil (React Native) istemci içerir.

---

## Özellikler

- **Anlık mesajlaşma** — XMPP/WebSocket üzerinden gerçek zamanlı mesaj gönderme/alma
- **Kullanıcı kaydı ve girişi** — XEP-0077 In-Band Registration ile sunucu üzerinden hesap oluşturma
- **Yazıyor... göstergesi** — XEP-0085 Chat State Notifications
- **Okundu bilgisi** — Çift tik (✓✓) ile mesaj okundu takibi
- **Çevrimiçi/çevrimdışı durumu** — Gerçek zamanlı presence gösterimi
- **Mesaj arşivi** — XEP-0313 MAM ile geçmiş mesajları sunucudan çekme
- **Grup sohbeti (MUC)** — XEP-0045 Multi-User Chat desteği
- **Görüntülü görüşme** — Jitsi Meet entegrasyonu; web'de split-pane görünümü, mobilde WebView modal
- **PWA desteği** — Web uygulaması olarak yüklenebilir (Service Worker ile offline cache)
- **React Native mobil uygulama** — Expo ile Android ve iOS'a derlenebilir

---

## Mimari

```
ChatApp/
├── client/          # Web istemcisi (Vanilla JS + Strophe.js)
│   ├── index.html
│   ├── app.js
│   └── sw.js        # Service Worker (PWA)
│
├── mobile/          # React Native mobil uygulama (Expo)
│   ├── App.js
│   └── src/
│       ├── screens/         # LoginScreen, ContactsScreen, ChatScreen
│       ├── context/         # ChatContext (global state)
│       ├── services/        # xmpp.js (WebSocket XMPP servisi)
│       └── components/      # VideoCallModal, vb.
│
└── infra/
    ├── prosody/     # Prosody XMPP sunucusu (Docker)
    │   └── config/prosody.cfg.lua
    └── nginx/       # Reverse proxy (Docker)
        └── nginx.conf
```

### Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| XMPP Sunucusu | [Prosody](https://prosody.im/) (Docker) |
| Reverse Proxy | nginx (Docker) |
| Web İstemcisi | Vanilla JS, [Strophe.js](https://strophe.im/strophejs/) |
| Mobil İstemci | React Native, Expo |
| Görüntülü Görüşme | [Jitsi Meet](https://jitsi.org/) |
| Tünel (geliştirme) | Cloudflare Quick Tunnel |

---

## Kurulum ve Çalıştırma

### Gereksinimler

- Docker Desktop
- Node.js (Expo için)
- Python 3 (web sunucusu ve dosya yükleme sunucusu için)

### 1. XMPP Sunucusunu Başlat (Prosody)

Proje kök dizininde:

```bash
cd infra/prosody
docker compose up -d
```

Bu komut Prosody XMPP sunucusunu başlatır (C2S: `15222`, HTTP/WebSocket: `15280`).

### 2. Nginx Reverse Proxy'yi Başlat

```bash
cd infra/nginx
docker compose up -d
```

Nginx, port `8888` (HTTP) ve `443` (HTTPS) üzerinden tüm servislere tek giriş noktası olarak çalışır. SSL sertifikaları `infra/prosody/certs/` altından otomatik olarak mount edilir.

### 3. Web İstemcisini Başlat

```bash
cd client
python3 -m http.server 9090
```

> **Not:** Nginx, web istemcisini `9090` portundan bekler. Port numarasını değiştirmeyin.

### 4. Dosya Yükleme Sunucusunu Başlat

Ayrı bir terminal penceresi açıp:

```bash
cd client
python3 upload_server.py
```

Bu sunucu port `9091`'de çalışır ve sohbet içi dosya/medya paylaşımını yönetir.

### 5. Tarayıcıdan Erişim

Tarayıcıda `http://localhost:8888` adresine gidin.

### 6. Mobil Uygulamayı Başlat (Expo)

```bash
cd mobile
npm install
npx expo start --tunnel
```

Expo Go uygulamasıyla QR kodu tarayın.

### 7. Dış Erişim (isteğe bağlı)

```bash
# Cloudflare Quick Tunnel (hesap gerekmez)
cloudflared tunnel --url http://localhost:8888
```

Çıkan `https://xxxx.trycloudflare.com` adresiyle internet üzerinden erişim sağlanır.

---

## Kullanım

### Hesap Oluşturma

1. Web veya mobil uygulamayı aç
2. **Kayıt Ol** sekmesine geç
3. Kullanıcı adı ve şifre gir → **Kayıt Ol**
4. Oluşturulan JID formatı: `kullanici@localhost`

### Mesajlaşma

1. **Giriş Yap** → JID (`kullanici@localhost`) ve şifre gir
2. Kişi listesinden birini seç veya yeni kişi ekle
3. Mesaj yaz ve gönder

### Görüntülü Görüşme

- Web'de sohbet ekranındaki 📹 butonuna tıkla → sağ panelde Jitsi açılır
- Mobil'de 📹 butonuna dokun → tam ekran WebView modal açılır
- Karşı taraf otomatik olarak davet bildirimini görür

---

## XMPP Protokol Desteği

| XEP | Açıklama |
|---|---|
| XEP-0077 | In-Band Registration (kullanıcı kaydı) |
| XEP-0085 | Chat State Notifications (yazıyor...) |
| XEP-0045 | Multi-User Chat (grup sohbeti) |
| XEP-0313 | Message Archive Management (mesaj arşivi) |
| RFC 7395 | XMPP over WebSocket |

---

## Lisans

MIT
