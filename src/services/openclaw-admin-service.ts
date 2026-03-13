import type { OpenClawAdminBridgeStatus, OpenClawAdminStatus, OpenClawServiceAction } from "../shared/types.js";

export class OpenClawAdminService {
  constructor(
    private readonly adminUrl: string | null,
    private readonly adminToken: string | null,
    private readonly dashboardUrl: string | null,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.adminUrl && this.adminToken);
  }

  async getStatus(): Promise<OpenClawAdminStatus> {
    if (!this.isConfigured()) {
      return {
        configured: false,
        serviceName: "openclaw-gateway.service",
        activeState: "unconfigured",
        subState: "unconfigured",
        unitFileState: "unknown",
        mainPid: null,
        startedAt: null,
        fragmentPath: null,
        dashboardUrl: this.dashboardUrl,
      };
    }

    const status = await this.request<OpenClawAdminBridgeStatus>("/status", { method: "GET" });
    return { ...status, configured: true, dashboardUrl: this.dashboardUrl };
  }

  async performAction(action: OpenClawServiceAction): Promise<OpenClawAdminStatus> {
    if (!this.isConfigured()) {
      throw new Error("OPENCLAW_ADMIN_UNCONFIGURED");
    }

    const status = await this.request<OpenClawAdminBridgeStatus>(`/actions/${action}`, { method: "POST" });
    return { ...status, configured: true, dashboardUrl: this.dashboardUrl };
  }

  private async request<T>(pathname: string, init: RequestInit): Promise<T> {
    if (!this.adminUrl || !this.adminToken) {
      throw new Error("OPENCLAW_ADMIN_UNCONFIGURED");
    }

    const response = await fetch(new URL(pathname, this.adminUrl), {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.adminToken}`,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error((payload as { error?: string }).error ?? `OPENCLAW_ADMIN_REQUEST_FAILED:${response.status}`);
    }

    return response.json() as Promise<T>;
  }
}
