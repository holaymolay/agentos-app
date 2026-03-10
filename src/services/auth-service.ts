import { createToken } from "../domain/ids.js";

interface SessionRecord {
  token: string;
  createdAt: string;
}

export class AuthService {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly ownerPassword: string,
    private readonly bridgeToken: string | null = null,
  ) {}

  login(password: string): string | null {
    if (password !== this.ownerPassword) {
      return null;
    }
    const token = createToken();
    this.sessions.set(token, { token, createdAt: new Date().toISOString() });
    return token;
  }

  isAuthenticated(token: string | undefined): boolean {
    if (!token) {
      return false;
    }
    return this.sessions.has(token);
  }

  isBridgeEnabled(): boolean {
    return Boolean(this.bridgeToken);
  }

  isBridgeAuthenticated(authorizationHeader: string | undefined): boolean {
    if (!this.bridgeToken) {
      return false;
    }
    const token = extractBearerToken(authorizationHeader);
    return token === this.bridgeToken;
  }
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
