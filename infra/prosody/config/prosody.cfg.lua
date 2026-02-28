-- Prosody config with TLS enabled
use_libevent = false

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
  "mam";
  "register";
  "limits";
}

-- Rate limiting for client connections
limits = {
  c2s = {
    rate = "10kb/s";
    burst = "50kb";
  };
}

-- MAM (Message Archive Management) settings
archive_expires_after = "1w" -- Keep messages for 1 week
default_archive_policy = true -- Archive messages by default

allow_registration = true

c2s_interfaces = { "*" }
c2s_ports = { 5222 }

http_interfaces = { "*" }
http_ports = { 5280 }

c2s_require_encryption = true
s2s_require_encryption = true
s2s_secure_auth = false

log = {
  info = "*console";
  debug = "*console";
}

-- Store certs in writable data dir
certificates = "certs"

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
consider_websocket_secure = true
allow_unencrypted_plain_auth = false
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