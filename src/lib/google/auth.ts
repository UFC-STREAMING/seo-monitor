import crypto from "crypto";

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
  scopes: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_LIFETIME_SECONDS = 3600;
const TOKEN_REFRESH_MARGIN = 300;

export class GoogleAuth {
  private serviceAccount: ServiceAccountKey | null = null;
  private cachedToken: CachedToken | null = null;
  private initialized = false;

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;

    const keyBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (keyBase64) {
      try {
        const keyJson = Buffer.from(keyBase64, "base64").toString("utf-8");
        this.serviceAccount = JSON.parse(keyJson) as ServiceAccountKey;
      } catch (error) {
        console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY:", error);
      }
    }
  }

  isConfigured(): boolean {
    this.ensureInitialized();
    return this.serviceAccount !== null && !!this.serviceAccount.private_key;
  }

  getClientEmail(): string {
    this.ensureInitialized();
    return this.serviceAccount?.client_email || "";
  }

  async getAccessToken(scopes: string[]): Promise<string> {
    this.ensureInitialized();
    if (!this.serviceAccount) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not configured");
    }

    const scopeKey = scopes.sort().join(" ");

    if (
      this.cachedToken &&
      this.cachedToken.scopes === scopeKey &&
      this.cachedToken.expiresAt > Date.now() / 1000 + TOKEN_REFRESH_MARGIN
    ) {
      return this.cachedToken.accessToken;
    }

    const now = Math.floor(Date.now() / 1000);

    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iss: this.serviceAccount.client_email,
      scope: scopeKey,
      aud: TOKEN_URL,
      exp: now + TOKEN_LIFETIME_SECONDS,
      iat: now,
    };

    const headerB64 = this.base64url(JSON.stringify(header));
    const payloadB64 = this.base64url(JSON.stringify(payload));
    const unsignedJwt = `${headerB64}.${payloadB64}`;

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(unsignedJwt);
    const signature = signer.sign(
      this.serviceAccount.private_key,
      "base64url"
    );

    const jwt = `${unsignedJwt}.${signature}`;

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Google OAuth2 token exchange failed: ${response.status} ${errorText}`
      );
    }

    const data = await response.json();

    this.cachedToken = {
      accessToken: data.access_token,
      expiresAt: now + (data.expires_in || TOKEN_LIFETIME_SECONDS),
      scopes: scopeKey,
    };

    return data.access_token;
  }

  private base64url(input: string): string {
    return Buffer.from(input)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
}
