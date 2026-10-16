declare module 'arima' {
  export interface ArimaOptions {
    auto?: boolean;
    p?: number; d?: number; q?: number;
    P?: number; D?: number; Q?: number; s?: number;
    method?: number; optimizer?: number; verbose?: boolean;
  }
  export default class ARIMA {
    constructor(options?: ArimaOptions);
    train(values: number[]): this;
    fit(values: number[]): this;
    predict(horizon: number): [number[], number[]];
    destroy(): void;
  }
}

