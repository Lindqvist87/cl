import { importManualTrendSignal } from "@/lib/trends/manualTrendImport";

export interface TrendIngestionAdapter {
  importSignals(query: Record<string, unknown>): Promise<number>;
}

export class GoogleBooksTrendAdapter implements TrendIngestionAdapter {
  async importSignals(_query: Record<string, unknown>): Promise<number> {
    throw new Error(
      "Google Books trend ingestion is stubbed. Add API credentials and implement metadata fetch before enabling."
    );
  }
}

export class NytBooksAdapter implements TrendIngestionAdapter {
  async importSignals(_query: Record<string, unknown>): Promise<number> {
    throw new Error(
      "NYT Books ingestion is stubbed. Add NYT Books API credentials before enabling."
    );
  }
}

export class ManualTrendImport {
  async importSignal(input: Parameters<typeof importManualTrendSignal>[0]) {
    await importManualTrendSignal(input);
    return 1;
  }
}
