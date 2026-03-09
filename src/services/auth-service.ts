import { createToken } from "../domain/ids.js";

interface SessionRecord {
  token: string;
  createdAt: string;
}

export class AuthService {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(private readonly ownerPassword: string) {}

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
}
