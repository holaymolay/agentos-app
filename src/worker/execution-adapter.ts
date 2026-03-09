import type { ToolExecutionRequest, ToolExecutionResult } from "../shared/types.js";

export interface ExecutionAdapter {
  execute(request: ToolExecutionRequest): Promise<ToolExecutionResult>;
}
