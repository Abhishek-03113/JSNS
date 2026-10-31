const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function sha256(input: string): string {
  return new Bun.CryptoHasher("sha256").update(input).digest("hex");
}

/** PKCE S256 code challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
}

/** AES-256-GCM with a key derived from SESSION_SECRET. Used for Google tokens at rest. */
export class Sealer {
  private keyPromise: Promise<CryptoKey>;
  constructor(secret: string) {
    const raw = new Uint8Array(new Bun.CryptoHasher("sha256").update("formbuilder:token-key:" + secret).digest());
    this.keyPromise = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  async seal(plain: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await this.keyPromise, enc.encode(plain));
    return "v1." + b64url(iv) + "." + b64url(new Uint8Array(ct));
  }
  async open(sealed: string): Promise<string> {
    const [v, iv, ct] = sealed.split(".");
    if (v !== "v1" || !iv || !ct) throw new Error("Unrecognised sealed value");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(Buffer.from(iv, "base64url")) },
      await this.keyPromise,
      new Uint8Array(Buffer.from(ct, "base64url")),
    );
    return dec.decode(plain);
  }
}
