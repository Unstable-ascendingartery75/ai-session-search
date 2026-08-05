import type { UpdateState } from "../shared/types.ts";

export interface UpdateService {
  getState(refresh?: boolean): Promise<UpdateState>;
  startDownload(): Promise<UpdateState>;
  ignoreVersion(): Promise<UpdateState>;
}
