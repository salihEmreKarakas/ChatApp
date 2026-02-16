-- Prosody dev config (no TLS) - Windows/Docker friendly
-- Disable TLS/cert usage completely for local dev
use_libevent = false
ssl = nil
tls = nil

modules_enabled = {
  "roster";
  "saslauth";
  "disco";
  "private";
  "vcard_legacy";
  "vcard4";
  "pep";
  "http";
  "websocket";
  "bosh";
  "admin_adhoc";
}

allow_registration = true

c2s_interfaces = { "*" }
c2s_ports = { 5222 }

http_interfaces = { "*" }
http_ports = { 5280 }

c2s_require_encryption = false
s2s_require_encryption = false
s2s_secure_auth = false

tls = {}

log = {
  info = "*console";
  debug = "*console";
}

-- Store certs in writable data dir
certificates = "certs"

c2s_require_encryption = false
s2s_require_encryption = false
s2s_secure_auth = false
https_ports = {}

-- Allow browser apps from other origins (dev)
cross_domain_websocket = true
-- Prosody 0.11: also allow cross-domain BOSH/HTTP if needed
cross_domain_bosh = true
http_cors_override = {
  bosh = {
    enabled = true;
  };
}
consider_bosh_secure = true
bosh_max_inactivity = 120

VirtualHost "localhost"

VirtualHost "192.168.0.239"

VirtualHost "192.168.137.1"

Component "conference.localhost" "muc"
  name = "Chat Rooms"
  modules_enabled = { "muc_mam" }
  restrict_room_creation = false
  max_history_messages = 20
  muc_room_locking = false
  muc_room_lock_timeout = 0
  muc_room_default_public = true
  muc_room_default_members_only = false
  muc_room_default_moderated = false
  muc_room_default_public_jids = true
  muc_room_default_change_subject = true
  muc_room_default_history_length = 20

Component "conference.192.168.0.239" "muc"
  name = "Chat Rooms"
  modules_enabled = { "muc_mam" }
  restrict_room_creation = false
  max_history_messages = 20
  muc_room_locking = false
  muc_room_lock_timeout = 0
  muc_room_default_public = true
  muc_room_default_members_only = false
  muc_room_default_moderated = false
  muc_room_default_public_jids = true
  muc_room_default_change_subject = true
  muc_room_default_history_length = 20

Component "conference.192.168.137.1" "muc"
  name = "Chat Rooms"
  modules_enabled = { "muc_mam" }
  restrict_room_creation = false
  max_history_messages = 20
  muc_room_locking = false
  muc_room_lock_timeout = 0
  muc_room_default_public = true
  muc_room_default_members_only = false
  muc_room_default_moderated = false
  muc_room_default_public_jids = true
  muc_room_default_change_subject = true
  muc_room_default_history_length = 20