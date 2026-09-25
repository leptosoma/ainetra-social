import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DomainError } from "@/lib/domain-error";

// P6-02: sunucuya özel kimlik bilgisi şifrelemesi (AES-256-GCM, rastgele 96-bit nonce, anahtar kimliği).
// Associated data işletme/hesap/sağlayıcıya bağlanır; şifreli metin başka bir kiracıda çözülemez.
// Anahtar yoksa ya da geçersizse işlem kapalı başarısız olur (fail closed).

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export type CredentialKeyring = {
  currentKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
};

export type EncryptedCredential = {
  ciphertext: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  authTag: Uint8Array<ArrayBuffer>;
  keyId: string;
};

function decodeKey(value: string, name: string): Buffer {
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== KEY_BYTES) throw new Error(`${name} must be ${KEY_BYTES} bytes encoded as base64`);
  return key;
}

/**
 * META_CREDENTIAL_KEY (güncel, base64 32 bayt) + META_CREDENTIAL_KEY_ID (varsayılan "k1").
 * Döndürme: eski anahtarlar META_CREDENTIAL_PREVIOUS_KEYS="k0:base64,..." ile yalnızca çözme için kalır;
 * yeniden şifreleme bir sonraki yeniden bağlamada güncel anahtarla yapılır.
 */
export function loadCredentialKeyring(env: Readonly<Record<string, string | undefined>> = process.env): CredentialKeyring | null {
  const current = env.META_CREDENTIAL_KEY?.trim();
  if (!current) return null;
  const currentKeyId = env.META_CREDENTIAL_KEY_ID?.trim() || "k1";
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(currentKeyId)) throw new Error("META_CREDENTIAL_KEY_ID is invalid");
  const keys = new Map<string, Buffer>([[currentKeyId, decodeKey(current, "META_CREDENTIAL_KEY")]]);
  for (const entry of (env.META_CREDENTIAL_PREVIOUS_KEYS ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf(":");
    const keyId = entry.slice(0, separator);
    if (separator <= 0 || !/^[A-Za-z0-9_-]{1,32}$/.test(keyId) || keys.has(keyId)) throw new Error("META_CREDENTIAL_PREVIOUS_KEYS is invalid");
    keys.set(keyId, decodeKey(entry.slice(separator + 1), "META_CREDENTIAL_PREVIOUS_KEYS"));
  }
  return { currentKeyId, keys };
}

export function requireKeyring(keyring: CredentialKeyring | null | undefined): CredentialKeyring {
  if (!keyring) throw new DomainError("Kimlik bilgisi şifreleme anahtarı yapılandırılmamış.", "VALIDATION_ERROR");
  return keyring;
}

export function credentialAad(parts: { purpose: "connection" | "pending"; businessId: string; subjectId: string; platform?: string; providerAccountId?: string }) {
  return Buffer.from(
    ["ainetra-meta-credential-v1", parts.purpose, parts.businessId, parts.subjectId, parts.platform ?? "", parts.providerAccountId ?? ""].join("|"),
    "utf8",
  );
}

export function encryptCredential(keyring: CredentialKeyring, plaintext: string, aad: Buffer): EncryptedCredential {
  const key = keyring.keys.get(keyring.currentKeyId);
  if (!key) throw new DomainError("Kimlik bilgisi şifreleme anahtarı kullanılamıyor.", "VALIDATION_ERROR");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: new Uint8Array(ciphertext),
    nonce: new Uint8Array(nonce),
    authTag: new Uint8Array(cipher.getAuthTag()),
    keyId: keyring.currentKeyId,
  };
}

/** Kimlik doğrulama etiketi, AAD veya anahtar uyuşmazsa ayrıntı sızdırmadan başarısız olur. */
export function decryptCredential(keyring: CredentialKeyring, encrypted: { ciphertext: Uint8Array; nonce: Uint8Array; authTag: Uint8Array; keyId: string }, aad: Buffer): string {
  const key = keyring.keys.get(encrypted.keyId);
  if (!key) throw new DomainError("Kimlik bilgisi anahtarı bulunamadı.", "VALIDATION_ERROR");
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.nonce));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(encrypted.authTag));
    return Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext)), decipher.final()]).toString("utf8");
  } catch {
    throw new DomainError("Kimlik bilgisi doğrulanamadı.", "VALIDATION_ERROR");
  }
}
