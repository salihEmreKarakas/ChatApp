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
- Python 3 (web sunucusu için)

### 1. XMPP Sunucusunu Başlat

```bash
# Prosody
docker run -d --name prosody \
  -p 15222:5222 -p 15280:5280 \
  -v "$PWD/infra/prosody/config:/etc/prosody/conf.d" \
  -v "$PWD/infra/prosody/data:/var/lib/prosody" \
  prosody/prosody:latest

# nginx reverse proxy
docker run -d --name nginx_proxy \
  -p 80:80 \
  -v "$PWD/infra/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
  nginx:alpine
```

### 2. Web İstemcisini Başlat

```bash
cd client
python3 -m http.server 3000
```

Tarayıcıda `http://localhost` adresine git.

### 3. Mobil Uygulamayı Başlat (Expo)

```bash
cd mobile
npm install
npx expo start --tunnel
```

Expo Go uygulamasıyla QR kodu tara.

### 4. Dış Erişim (isteğe bağlı)

```bash
# Cloudflare Quick Tunnel (hesap gerekmez)
./cloudflared tunnel --url http://localhost:80
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
