import { Injectable } from "@nestjs/common";
import * as crypto from "crypto";

type EncPayload = {
  iv: Buffer;
  tag: Buffer;
  data: Buffer;
};

@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    const secret = String(process.env.BOOKING_SESSION_SECRET || "").trim();
    if (!secret) {
      throw new Error(
        "BOOKING_SESSION_SECRET is required to encrypt booking sessions"
      );
    }
    this.key = this._deriveKey(secret);
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      cipher.update(Buffer.from(plaintext, "utf8")),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${data.toString(
      "base64"
    )}`;
  }

  decrypt(payload: string): string {
    const parsed = this._parse(payload);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.key,
      parsed.iv
    );
    decipher.setAuthTag(parsed.tag);
    const plain = Buffer.concat([
      decipher.update(parsed.data),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  }

  private _parse(payload: string): EncPayload {
    const parts = payload.split(":");
    if (parts.length !== 4 || parts[0] !== "v1") {
      throw new Error("Invalid encrypted payload format");
    }
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const data = Buffer.from(parts[3], "base64");
    if (iv.length !== 12 || tag.length !== 16 || data.length === 0) {
      throw new Error("Invalid encrypted payload components");
    }
    return { iv, tag, data };
  }

  private _deriveKey(secret: string): Buffer {
    const hexKey = this._tryHexKey(secret);
    if (hexKey) return hexKey;
    const b64Key = this._tryBase64Key(secret);
    if (b64Key) return b64Key;
    return crypto.createHash("sha256").update(secret, "utf8").digest();
  }

  private _tryHexKey(secret: string): Buffer | null {
    const cleaned = secret.replace(/^0x/i, "").trim();
    if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) return null;
    return Buffer.from(cleaned, "hex");
  }

  private _tryBase64Key(secret: string): Buffer | null {
    try {
      const buf = Buffer.from(secret, "base64");
      return buf.length === 32 ? buf : null;
    } catch {
      return null;
    }
  }
}


