// The Bridge's measures (4.1.10): ingestion, acknowledgements, retries, backlog, errors, quarantine, latency. Kept in
// the process (totals for `/readyz`, `bridge doctor`, the tests) and sent through OpenTelemetry's metrics API when
// `@opentelemetry/api` is installed beside the Bridge; with `OTEL_EXPORTER_OTLP_ENDPOINT` set and
// `@opentelemetry/sdk-node` installed, an OTLP exporter is started. Neither is a dependency: absent, the measures stay
// in the process and the Bridge says so once. Attributes are the tenant and an outcome code; never a player, a token
// or a payload (docs/dev/threat-models/constellation.md).

/** The counters and histograms the Bridge records. */
export type CounterName =
  | 'signals.accepted'
  | 'signals.duplicate'
  | 'signals.refused'
  | 'acks'
  | 'store.retries'
  | 'errors'
  | 'quarantine'
  | 'streams.refused';
export type HistogramName = 'propose.ms' | 'backlog';

type Attrs = { tenant?: string; code?: string };

/** The part of `@opentelemetry/api` the Bridge uses. */
export interface OtelApi {
  metrics: {
    getMeter(
      name: string,
      version?: string,
    ): {
      createCounter(name: string, o?: { description?: string; unit?: string }): { add(n: number, a?: Attrs): void };
      createHistogram(
        name: string,
        o?: { description?: string; unit?: string },
      ): { record(n: number, a?: Attrs): void };
    };
  };
}

export class Telemetry {
  private totals = new Map<string, number>();
  private counters = new Map<string, { add(n: number, a?: Attrs): void }>();
  private histograms = new Map<string, { record(n: number, a?: Attrs): void }>();
  private meter: ReturnType<OtelApi['metrics']['getMeter']> | undefined;

  constructor(api?: OtelApi) {
    this.meter = api?.metrics.getMeter('web-scumm-bridge');
  }
  /** Whether the measures go to OpenTelemetry (said by `/readyz`). */
  get exported(): boolean {
    return this.meter !== undefined;
  }

  count(name: CounterName, attrs: Attrs = {}, n = 1): void {
    const k = `${name}${attrs.code ? `:${attrs.code}` : ''}`;
    this.totals.set(k, (this.totals.get(k) ?? 0) + n);
    if (!this.meter) return;
    let c = this.counters.get(name);
    if (!c) this.counters.set(name, (c = this.meter.createCounter(`bridge.${name}`)));
    c.add(n, attrs);
  }
  record(name: HistogramName, value: number, attrs: Attrs = {}): void {
    const k = `${name}.max`;
    this.totals.set(k, Math.max(this.totals.get(k) ?? 0, value));
    if (!this.meter) return;
    let h = this.histograms.get(name);
    if (!h)
      this.histograms.set(
        name,
        (h = this.meter.createHistogram(`bridge.${name}`, name === 'propose.ms' ? { unit: 'ms' } : {})),
      );
    h.record(value, attrs);
  }
  /** The totals since the process started (`code` after a colon). */
  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.totals].sort(([a], [b]) => a.localeCompare(b)));
  }
}

/** A module name kept out of the bundler's and the type checker's sight: an optional package, loaded if present. */
const optional = async <T>(name: string): Promise<T | undefined> => {
  try {
    return (await import(/* @vite-ignore */ name)) as T;
  } catch {
    return undefined;
  }
};

/**
 * The Bridge's telemetry: OpenTelemetry's API when installed, else the process's totals only. With
 * `OTEL_EXPORTER_OTLP_ENDPOINT`, starts `@opentelemetry/sdk-node` (which reads the standard `OTEL_*` variables) if it
 * is installed. `say` receives one line about what was found.
 */
export async function loadTelemetry(
  env: Record<string, string | undefined> = process.env,
  say: (line: string) => void = () => {},
): Promise<Telemetry> {
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const sdk = await optional<{ NodeSDK: new (o?: object) => { start(): void } }>('@opentelemetry/sdk-node');
    if (sdk) {
      new sdk.NodeSDK().start();
      say('OTLP exporter started (@opentelemetry/sdk-node)');
    } else say('OTEL_EXPORTER_OTLP_ENDPOINT is set but @opentelemetry/sdk-node is not installed: nothing exported');
  }
  const api = await optional<OtelApi>('@opentelemetry/api');
  if (!api) say('@opentelemetry/api is not installed: the measures stay in the process');
  return new Telemetry(api);
}
