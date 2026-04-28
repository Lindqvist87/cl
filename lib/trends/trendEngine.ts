export type TrendSignal = {
  category: string;
  signal: string;
  confidence: number;
  source: string;
};

export type TrendQuery = {
  genre?: string;
  audience?: string;
  territory?: string;
};

export interface TrendEngine {
  getMarketSignals(query: TrendQuery): Promise<TrendSignal[]>;
}

export class StubTrendEngine implements TrendEngine {
  async getMarketSignals(_query: TrendQuery): Promise<TrendSignal[]> {
    return [];
  }
}

export const trendEngine: TrendEngine = new StubTrendEngine();
