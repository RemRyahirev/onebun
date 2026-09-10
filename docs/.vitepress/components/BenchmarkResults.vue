<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import fallbackData from '../data/benchmark-fallback.json';

const GIST_URL =
  'https://gist.githubusercontent.com/RemRyahirev/bde6a4c4930c19a963199fa0bea2b265/raw/onebun-benchmark-results.json';

interface HttpResult {
  name: string;
  reqPerSec: number;
  avgLatency: string;
  p95Latency?: string;
  p99Latency: string;
  maxLatency: string;
  throughput?: string;
}

interface StartupResult {
  name: string;
  meanMs: number;
  minMs: number;
  maxMs: number;
}

interface RealisticEndpointResult {
  endpoint: string;
  reqPerSec: number;
  avgLatency: string;
  p95Latency?: string;
  p99Latency: string;
  maxLatency: string;
  throughput?: string;
}

interface RealisticFrameworkResult {
  name: string;
  endpoints: RealisticEndpointResult[];
}

interface BenchmarkData {
  date: string;
  settings?: string;
  machine: {
    cpu: string;
    ram: string;
    os: string;
    bunVersion: string;
    nodeVersion?: string;
  };
  http: HttpResult[];
  startup: StartupResult[];
  realistic?: RealisticFrameworkResult[];
  realisticPg?: RealisticFrameworkResult[];
}

const data = ref<BenchmarkData | null>(null);
const loading = ref(true);
const error = ref(false);
const isStale = ref(false);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function pctDiff(baseline: number, other: number): string {
  if (baseline === 0) return '—';
  const pct = Math.round(((other - baseline) / baseline) * 100);
  if (pct > 0) return `+${pct}%`;
  return `${pct}%`;
}

// ---------------------------------------------------------------------------
// Compact realistic data transform
// ---------------------------------------------------------------------------

interface CompactRealisticRow {
  name: string;
  getList: number;
  getDetail: number;
  post: number;
  p99GetList: string;
}

function toCompactRows(frameworks: RealisticFrameworkResult[]): CompactRealisticRow[] {
  return frameworks.map((fw) => {
    const getList = fw.endpoints.find((e) => e.endpoint === 'GET /api/posts');
    const getDetail = fw.endpoints.find((e) => e.endpoint === 'GET /api/posts/:id');
    const post = fw.endpoints.find((e) => e.endpoint === 'POST /api/posts');
    return {
      name: fw.name,
      getList: getList?.reqPerSec ?? 0,
      getDetail: getDetail?.reqPerSec ?? 0,
      post: post?.reqPerSec ?? 0,
      p99GetList: getList?.p99Latency ?? 'N/A',
    };
  });
}

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const httpSorted = computed(() => {
  if (!data.value) return [];
  return [...data.value.http].sort((a, b) => b.reqPerSec - a.reqPerSec);
});

const startupSorted = computed(() => {
  if (!data.value) return [];
  return [...data.value.startup].sort((a, b) => a.meanMs - b.meanMs);
});

const onebunHttp = computed(() =>
  data.value?.http.find((h) => h.name.toLowerCase().includes('onebun')) ?? null,
);

const onebunStartupMs = computed(() => {
  if (!data.value) return '?';
  const entry = data.value.startup.find((s) => s.name.toLowerCase().includes('onebun'));
  return entry ? Math.round(entry.meanMs) : '?';
});

// Realistic SQLite
const realisticRows = computed(() =>
  toCompactRows(data.value?.realistic ?? []).sort((a, b) => b.getList - a.getList),
);

const realisticOnebunGetList = computed(() => {
  const row = realisticRows.value.find((r) => r.name.toLowerCase().includes('onebun'));
  return row?.getList ?? 0;
});

// Realistic PostgreSQL
const realisticPgRows = computed(() =>
  toCompactRows(data.value?.realisticPg ?? []).sort((a, b) => b.getList - a.getList),
);

// ---------------------------------------------------------------------------
// Derived comparisons
//
// Every number quoted in the prose below is computed from the same rows the
// tables render, so the text can never drift away from the data. Wording that
// is NOT computed (which stack leads where, how the endpoints behave) was
// checked against the last ten CI runs and holds across all of them.
// ---------------------------------------------------------------------------

type EndpointKey = 'getList' | 'getDetail' | 'post';

type RatioSet = Record<EndpointKey, number | null>;

const ENDPOINT_KEYS: EndpointKey[] = ['getList', 'getDetail', 'post'];

function isOneBun(name: string): boolean {
  return name.toLowerCase().includes('onebun');
}

function isFullObservability(name: string): boolean {
  return isOneBun(name) && name.toLowerCase().includes('full');
}

function isTypeorm(name: string): boolean {
  return name.toLowerCase().includes('typeorm');
}

// The NestJS row on Bun — matches both the "+ Fastify" label the CI data uses
// today and a future "+ Drizzle" one. `onebun` is excluded first, since it also
// contains "bun".
function isNestOnBun(name: string): boolean {
  const lower = name.toLowerCase();
  return !isOneBun(name) && !isTypeorm(name) && lower.includes('bun');
}

function pickRow(rows: CompactRealisticRow[], match: (name: string) => boolean): CompactRealisticRow | null {
  return rows.find((r) => match(r.name)) ?? null;
}

function ratioOf(a: CompactRealisticRow | null, b: CompactRealisticRow | null): RatioSet {
  const div = (x: number, y: number): number | null => (x > 0 && y > 0 ? x / y : null);
  return {
    getList: a && b ? div(a.getList, b.getList) : null,
    getDetail: a && b ? div(a.getDetail, b.getDetail) : null,
    post: a && b ? div(a.post, b.post) : null,
  };
}

function fmtRatio(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}×`;
}

function fmtPct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`;
}

// Signed overhead: the sign decides the word, so a run where observability
// comes out ahead does not print "-3% slower".
function fmtOverhead(value: number | null): string {
  if (value === null) return '—';
  const rounded = Math.round(value);
  if (rounded === 0) return 'no measurable difference';
  return rounded > 0 ? `${rounded}% slower` : `${-rounded}% faster`;
}

const pgOnebun = computed(() => pickRow(realisticPgRows.value, (n) => isOneBun(n) && !isFullObservability(n)));
const pgOnebunFull = computed(() => pickRow(realisticPgRows.value, isFullObservability));
const pgNestOnBun = computed(() => pickRow(realisticPgRows.value, isNestOnBun));
const pgTypeorm = computed(() => pickRow(realisticPgRows.value, isTypeorm));

const pgVsNestOnBun = computed(() => ratioOf(pgOnebun.value, pgNestOnBun.value));
const pgVsTypeorm = computed(() => ratioOf(pgOnebun.value, pgTypeorm.value));
const pgFullVsNestOnBun = computed(() => ratioOf(pgOnebunFull.value, pgNestOnBun.value));

const obsOverhead = computed<RatioSet>(() => {
  const base = pgOnebun.value;
  const full = pgOnebunFull.value;
  const cost = (b: number, f: number): number | null => (b > 0 && f > 0 ? ((b - f) / b) * 100 : null);
  return {
    getList: base && full ? cost(base.getList, full.getList) : null,
    getDetail: base && full ? cost(base.getDetail, full.getDetail) : null,
    post: base && full ? cost(base.post, full.post) : null,
  };
});

// Trace cost scales roughly with the sampling rate; this is an extrapolation
// from the 100%-sampling measurement, and is labelled as one in the text.
const obsSampledEstimate = computed(() => {
  const full = obsOverhead.value.getList;
  return full === null ? null : full / 10;
});

// Realistic SQLite — comparison rows
const sqOnebun = computed(() => pickRow(realisticRows.value, isOneBun));

const sqVsDrizzleBand = computed(() => {
  const base = sqOnebun.value;
  if (!base) return null;
  const values = realisticRows.value
    .filter((r) => !isOneBun(r.name) && !isTypeorm(r.name))
    .flatMap((row) => ENDPOINT_KEYS.map((k) => ratioOf(base, row)[k]))
    .filter((v): v is number => v !== null);
  return values.length > 0 ? { min: Math.min(...values), max: Math.max(...values) } : null;
});

const sqVsTypeorm = computed(() => ratioOf(sqOnebun.value, pickRow(realisticRows.value, isTypeorm)));

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

onMounted(async () => {
  try {
    const res = await fetch(GIST_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data.value = await res.json();
  } catch {
    if (fallbackData.date) {
      data.value = fallbackData as unknown as BenchmarkData;
      isStale.value = true;
    } else {
      error.value = true;
    }
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <!-- No-JS fallback -->
  <noscript>
    <div class="bm-noscript">
      <p>
        JavaScript is required to display live benchmark results.
        <a :href="GIST_URL" target="_blank" rel="noopener">View raw benchmark data on GitHub</a>.
      </p>
    </div>
  </noscript>

  <!-- Loading -->
  <div v-if="loading" class="bm-loading">Loading benchmark data&hellip;</div>

  <!-- Error -->
  <div v-else-if="error" class="bm-error">
    <p>
      Benchmark data is not available right now.
      <a :href="GIST_URL" target="_blank" rel="noopener">See raw results on GitHub.</a>
    </p>
  </div>

  <!-- Results -->
  <div v-else-if="data" class="bm-root">
    <!-- Stale data banner -->
    <div v-if="isStale" class="bm-stale-banner">
      Data from last successful CI run ({{ data.date }}). Live data temporarily unavailable.
    </div>

    <!-- Key Numbers -->
    <div class="bm-cards">
      <div class="bm-card">
        <span class="bm-card-number">~2x</span>
        <span class="bm-card-label">faster than canonical NestJS + TypeORM on the production-like PostgreSQL workload</span>
      </div>
      <div class="bm-card">
        <span class="bm-card-number">Zero</span>
        <span class="bm-card-label">build step &mdash; runs TypeScript directly, no tsc, no build pipeline</span>
      </div>
    </div>

    <p class="bm-meta">
      ~2x is a conservative estimate across CI runs; the tables below carry the exact numbers from the latest one.
      Absolute throughput depends on which shared GitHub Actions runner the job lands on and has moved by more than
      2&times; between runs &mdash; the ratios between frameworks are far steadier. Every comparison quoted in the
      text is computed from the table directly above it.
    </p>

    <!-- Intro -->
    <div class="bm-intro">
      <p>We run three benchmark scenarios, each measuring a different slice of framework behavior:</p>
      <ul>
        <li><strong>HTTP Throughput</strong> &mdash; routing overhead only, no database or middleware pipeline</li>
        <li><strong>Realistic CRUD (SQLite)</strong> &mdash; embedded DB + ORM + Swagger docs, no cache or validation. Represents edge and CLI-adjacent services.</li>
        <li><strong>Production-like (PostgreSQL)</strong> &mdash; full production stack with optional observability (logging, metrics, tracing)</li>
      </ul>
      <p>Each scenario answers a different question. Raw HTTP throughput is not a good predictor of application performance &mdash; it's the starting point, not the story.</p>
    </div>

    <!-- ================================================================ -->
    <!-- HTTP Throughput                                                   -->
    <!-- ================================================================ -->

    <h2 id="http-throughput">HTTP Throughput</h2>
    <div class="bm-table-wrap">
      <table class="bm-table">
        <thead>
          <tr>
            <th>Framework</th>
            <th>Req/sec</th>
            <th>Avg Latency</th>
            <th>P99 Latency</th>
            <th>Max Latency</th>
            <th>vs OneBun</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in httpSorted"
            :key="row.name"
            :class="{ 'bm-highlight': row.name.toLowerCase().includes('onebun') }"
          >
            <td>{{ row.name }}</td>
            <td>{{ formatNumber(row.reqPerSec) }}</td>
            <td>{{ row.avgLatency }}</td>
            <td>{{ row.p99Latency }}</td>
            <td>{{ row.maxLatency }}</td>
            <td>
              <template v-if="row.name.toLowerCase().includes('onebun')">baseline</template>
              <template v-else-if="onebunHttp">
                {{ pctDiff(onebunHttp.reqPerSec, row.reqPerSec) }}
              </template>
              <template v-else>&mdash;</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="bm-table-note"><em>Single endpoint returning static JSON. Isolates HTTP routing overhead.</em></p>

    <!-- ================================================================ -->
    <!-- Realistic CRUD (SQLite)                                          -->
    <!-- ================================================================ -->

    <template v-if="realisticRows.length > 0">
      <h2 id="realistic-crud">Realistic CRUD (SQLite)</h2>
      <p class="bm-section-subtitle"><em>Embedded database scenario &mdash; ORM, Swagger docs, CRUD endpoints.</em></p>

      <div class="bm-table-wrap">
        <table class="bm-table bm-compact-table">
          <thead>
            <tr>
              <th>Framework</th>
              <th>GET list</th>
              <th>GET detail</th>
              <th>POST</th>
              <th>vs OneBun (list)</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in realisticRows"
              :key="row.name"
              :class="{ 'bm-highlight': row.name.toLowerCase().includes('onebun') }"
            >
              <td>{{ row.name }}</td>
              <td>{{ formatNumber(row.getList) }}</td>
              <td>{{ formatNumber(row.getDetail) }}</td>
              <td>{{ formatNumber(row.post) }}</td>
              <td>
                <template v-if="row.name.toLowerCase().includes('onebun')">baseline</template>
                <template v-else>{{ pctDiff(realisticOnebunGetList, row.getList) }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <blockquote class="bm-commentary">
        <p>
          This scenario runs without cache and without validation, so what is left is ORM, driver and serialization.
          Against the two NestJS + Fastify rows (both Drizzle-based), OneBun lands in the
          <strong v-if="sqVsDrizzleBand">{{ fmtRatio(sqVsDrizzleBand.min) }}&ndash;{{ fmtRatio(sqVsDrizzleBand.max) }}</strong><strong v-else>&mdash;</strong>
          band across the three endpoints in this run; against canonical NestJS + TypeORM it is
          {{ fmtRatio(sqVsTypeorm.getList) }} on list reads, {{ fmtRatio(sqVsTypeorm.getDetail) }} on detail reads
          and {{ fmtRatio(sqVsTypeorm.post) }} on writes.
        </p>
        <p>
          The table cannot separate framework from driver: the Bun rows go through <code>bun:sqlite</code>, the Node
          rows through <code>better-sqlite3</code>. For embedded and edge workloads, read these as combined
          framework + runtime + driver numbers, not as a framework ranking.
        </p>
      </blockquote>
    </template>

    <!-- ================================================================ -->
    <!-- Production-like (PostgreSQL)                                      -->
    <!-- ================================================================ -->

    <template v-if="realisticPgRows.length > 0">
      <div class="bm-section-primary">
        <h2 id="production-like-postgresql">Production-like (PostgreSQL)</h2>
        <p class="bm-section-subtitle"><em>Full production stack &mdash; PostgreSQL, validation, cache, config. Optional observability measured separately.</em></p>
        <span class="bm-section-label">Primary scenario</span>

        <div class="bm-table-wrap">
          <table class="bm-table bm-compact-table">
            <thead>
              <tr>
                <th>Framework</th>
                <th>GET list (cached)</th>
                <th>GET detail</th>
                <th>POST</th>
                <th>P99 (GET list)</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in realisticPgRows"
                :key="row.name"
                :class="{ 'bm-highlight': row.name.toLowerCase().includes('onebun') && !row.name.toLowerCase().includes('full') }"
              >
                <td>{{ row.name }}</td>
                <td>{{ formatNumber(row.getList) }}</td>
                <td>{{ formatNumber(row.getDetail) }}</td>
                <td>{{ formatNumber(row.post) }}</td>
                <td>{{ row.p99GetList }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="bm-commentary">
          <p>GET list uses in-memory cache (hot-path reads). GET detail hits Postgres directly with a JOIN (I/O-bound). POST is uncached write.</p>
          <p>
            Against NestJS with the same ORM on the same runtime (<em>{{ pgNestOnBun?.name ?? 'NestJS on Bun' }}</em>),
            OneBun does <strong>{{ fmtRatio(pgVsNestOnBun.getList) }} the throughput on cached reads</strong>,
            {{ fmtRatio(pgVsNestOnBun.getDetail) }} on uncached reads and
            <strong>{{ fmtRatio(pgVsNestOnBun.post) }} on writes</strong>. The cached read is the one endpoint where
            the framework, not the database, sets the pace; on the uncached read both Bun stacks wait on the same
            round-trip, so they land close together. Against canonical NestJS + TypeORM the gap widens on every endpoint:
            <strong>{{ fmtRatio(pgVsTypeorm.getList) }} on cached reads</strong>,
            {{ fmtRatio(pgVsTypeorm.getDetail) }} on uncached reads and
            <strong>{{ fmtRatio(pgVsTypeorm.post) }} on writes</strong>.
          </p>
        </div>

        <!-- Observability Overhead -->
        <h3 id="observability-overhead">Observability Overhead</h3>
        <p>OneBun ships observability as optional packages (<code>@onebun/metrics</code>, <code>@onebun/trace</code>). Installing them auto-wires Prometheus metrics and OpenTelemetry tracing with zero additional configuration. The table below shows runtime cost with <strong>100% trace sampling</strong> (worst case) and <strong>no exporter configured</strong> (realistic for development).</p>

        <div class="bm-table-wrap">
          <table class="bm-table bm-compact-table bm-table-narrow">
            <thead>
              <tr>
                <th>Configuration</th>
                <th>GET list</th>
                <th>GET detail</th>
                <th>POST</th>
              </tr>
            </thead>
            <tbody>
              <tr class="bm-highlight">
                <td>OneBun (default)</td>
                <td>baseline</td>
                <td>baseline</td>
                <td>baseline</td>
              </tr>
              <tr>
                <td>OneBun (full observability)</td>
                <td>{{ fmtOverhead(obsOverhead.getList) }}</td>
                <td>{{ fmtOverhead(obsOverhead.getDetail) }}</td>
                <td>{{ fmtOverhead(obsOverhead.post) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="bm-commentary">
          <p>
            At <strong>100% sampling</strong>, observability costs {{ fmtOverhead(obsOverhead.getList) }} on cache
            hits &mdash; that is where the framework sets the pace. On the endpoints the database dominates it costs
            {{ fmtOverhead(obsOverhead.getDetail) }} (uncached read) and {{ fmtOverhead(obsOverhead.post) }} (write).
            Trace cost scales roughly with the sampling rate, so production-typical <strong>10% sampling</strong>
            puts cache hits near <strong>{{ fmtPct(obsSampledEstimate) }}</strong> &mdash; extrapolated from the run
            above, not measured.
          </p>
          <p>
            With full observability enabled OneBun stays ahead of the same-runtime NestJS + Fastify stack on writes
            ({{ fmtRatio(pgFullVsNestOnBun.post) }}) and level with it on cached reads
            ({{ fmtRatio(pgFullVsNestOnBun.getList) }}) &mdash; those two trade places between runs. Setup cost is
            <code>bun add @onebun/metrics @onebun/trace</code> &mdash; no middleware wiring, no manual instrumentation.
          </p>
        </div>
      </div>
    </template>

    <!-- ================================================================ -->
    <!-- Startup Time                                                      -->
    <!-- ================================================================ -->

    <h2 id="startup-time">Startup Time</h2>
    <div class="bm-table-wrap">
      <table class="bm-table bm-table-narrow">
        <thead>
          <tr>
            <th>Framework</th>
            <th>Mean</th>
            <th>Min</th>
            <th>Max</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in startupSorted"
            :key="row.name"
            :class="{ 'bm-highlight': row.name.toLowerCase().includes('onebun') }"
          >
            <td>{{ row.name }}</td>
            <td>{{ row.meanMs.toFixed(1) }} ms</td>
            <td>{{ row.minMs.toFixed(1) }} ms</td>
            <td>{{ row.maxMs.toFixed(1) }} ms</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="bm-footnote">
      <p>OneBun's startup (~{{ onebunStartupMs }}ms) reflects DI graph construction and Effect.ts initialization. This is a one-time cost optimized for long-running services &mdash; not for serverless cold starts. For serverless workloads, Hono or Elysia are better-suited.</p>
    </div>

    <!-- ================================================================ -->
    <!-- Methodology                                                       -->
    <!-- ================================================================ -->

    <h2 id="methodology">Methodology</h2>
    <ul>
      <li>
        <strong>Environment:</strong> {{ data.machine.cpu }}, {{ data.machine.ram }}, {{ data.machine.os }},
        Bun {{ data.machine.bunVersion }}<template v-if="data.date"> ({{ data.date }})</template>.
      </li>
      <li><strong>HTTP:</strong> <a href="https://github.com/codesenberg/bombardier" target="_blank" rel="noopener">bombardier</a>, 50 concurrent connections, 10&nbsp;s duration.</li>
      <li><strong>Startup:</strong> Time from process start to first successful HTTP response, measured with 5&nbsp;ms Bun fetch polling.</li>
      <li>All frameworks return identical JSON payloads.</li>
      <li><strong>Realistic (SQLite):</strong> SQLite database (100 users, 500 posts, 2000 comments). No cache, no validation &mdash; measures ORM + serialization overhead only. Swagger docs enabled across all frameworks. Same Drizzle ORM.</li>
      <li><strong>Realistic (PostgreSQL):</strong> PostgreSQL 16, same data set. In-memory cache on GET list only (hot-path reads). GET detail hits DB directly with a JOIN. Validation enabled across all frameworks (ArkType for OneBun, Zod via <code>nestjs-zod</code> for the NestJS + Fastify stacks, class-validator for canonical NestJS + TypeORM). Swagger docs enabled. Includes a separate OneBun run with observability enabled (Prometheus metrics + OpenTelemetry tracing at 100% sampling, no-op exporter) to isolate observability overhead.</li>
      <li>Scripts are in the <code>benchmarks/</code> directory of the repository.</li>
      <li>CI runs on shared GitHub Actions runners. Absolute throughput depends on the runner the job lands on and on the Bun / Node versions of the day; it has moved by more than 2&times; between runs. Ratios between frameworks are much steadier, but stacks sitting within a few percent of each other do swap places from run to run. Raw data from all CI runs is available via <a href="https://gist.github.com/RemRyahirev/bde6a4c4930c19a963199fa0bea2b265" target="_blank" rel="noopener">Gist revisions</a>.</li>
    </ul>

    <h3>About the stacks</h3>
    <ul>
      <li><strong>OneBun:</strong> default configuration from <code>bunx create-onebun</code>. No custom tuning.</li>
      <li><strong>NestJS + Fastify (Bun):</strong> hand-assembled best-case for NestJS on Bun &mdash; <code>@nestjs/platform-fastify</code> + Drizzle + <code>Bun.SQL</code> (<code>bun:sqlite</code> in the SQLite scenario) + custom <code>SimpleCacheService</code> + Zod via <code>nestjs-zod</code> for validation. Not a default NestJS stack; represents NestJS paired with modern best practices on Bun. In the HTTP scenario this row is the same Nest app with no database.</li>
      <li><strong>NestJS + Fastify (Node):</strong> same stack on Node &mdash; <code>pg Pool</code>, or <code>better-sqlite3</code> in the SQLite scenario. Also uses Zod via <code>nestjs-zod</code>. Modern NestJS on the traditional runtime.</li>
      <li><strong>NestJS + TypeORM (Node):</strong> canonical NestJS stack &mdash; <code>@nestjs/typeorm</code> + <code>cache-manager</code> + class-validator, on Fastify as well. What most teams currently run in production.</li>
    </ul>

    <h3>About the scenarios</h3>
    <ul>
      <li><strong>HTTP Throughput</strong> &mdash; single endpoint returning static JSON. No database, no middleware chain.</li>
      <li><strong>Realistic CRUD (SQLite)</strong> &mdash; CRUD over 100 users / 500 posts / 2000 comments. GET detail joins users + counts comments. No cache, no validation &mdash; isolates ORM + serialization overhead. Swagger docs enabled.</li>
      <li><strong>Production-like (PostgreSQL)</strong> &mdash; same data set and schema as SQLite scenario, on Postgres in Docker. In-memory cache on GET list (cached read), GET detail hits DB directly (uncached I/O-bound read), POST is uncached write. Validation enabled everywhere (see Methodology for per-stack validator).</li>
    </ul>

    <!-- ================================================================ -->
    <!-- Honest Assessment                                                 -->
    <!-- ================================================================ -->

    <h2 id="honest-assessment">Honest Assessment</h2>
    <p>OneBun is an application framework with DI, modules, validation, caching, and optional observability. Comparing raw req/sec with minimal HTTP frameworks (Elysia, Hono) is apples-to-oranges &mdash; they solve different problems.</p>
    <p>
      <strong>Against NestJS</strong> (same framework class, production-like stack with Zod validation): on the
      PostgreSQL workload above, OneBun does {{ fmtRatio(pgVsNestOnBun.getList) }} the cache-hit read throughput and
      {{ fmtRatio(pgVsNestOnBun.post) }} the write throughput of the same ORM on the same runtime; against canonical
      NestJS + TypeORM, {{ fmtRatio(pgVsTypeorm.getList) }} and {{ fmtRatio(pgVsTypeorm.post) }}.
    </p>
    <p><strong>Where OneBun doesn't lead:</strong></p>
    <ul>
      <li><strong>Raw HTTP throughput</strong> &mdash; Bun.serve and Elysia are ahead in every run; OneBun sits around Hono. Routing overhead is not where an application framework wins.</li>
      <li><strong>Cached reads against NestJS + Fastify (Node)</strong> &mdash; the two swap places from run to run. The reliable wins against that stack are writes and uncached reads, not cache hits.</li>
      <li><strong>Uncached reads hitting Postgres</strong> &mdash; I/O dominates, so the same-runtime NestJS stack lands within roughly ten percent.</li>
      <li><strong>SQLite workloads</strong> &mdash; OneBun leads there, but the scenario cannot attribute the gap: framework, runtime and SQLite driver all differ between the rows.</li>
      <li><strong>Cold startup</strong> &mdash; ~{{ onebunStartupMs }}ms reflects DI graph construction, the slowest entry in the startup table. Optimized for long-running services, not serverless.</li>
    </ul>
    <p>Performance matters, but it's a bonus — not why we built OneBun. The core pitch is <strong>enterprise practices without the integration work</strong> &mdash; structured logging, metrics, tracing, typed config, validation, and OpenAPI generation all wired from the first line of code. Validation in particular: <code>type({...})</code> in your code, and you get TypeScript types, runtime validation, and OpenAPI spec from one declaration &mdash; no bridge packages, no Swagger patches.</p>
  </div>
</template>

<style scoped>
/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

.bm-root {
  max-width: 100%;
}

/* ------------------------------------------------------------------ */
/* Key number cards                                                    */
/* ------------------------------------------------------------------ */

.bm-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin: 24px 0 32px;
}

.bm-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 16px;
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.bm-card-number {
  font-size: 2rem;
  font-weight: 700;
  color: var(--vp-c-brand-1);
  line-height: 1.2;
}

.bm-card-label {
  margin-top: 8px;
  font-size: 0.95rem;
  color: var(--vp-c-text-2);
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

.bm-table-wrap {
  overflow-x: auto;
  margin: 16px 0 24px;
}

.bm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.bm-table-narrow {
  max-width: 600px;
}

.bm-compact-table th,
.bm-compact-table td {
  padding: 8px 12px;
}

.bm-table th,
.bm-table td {
  padding: 10px 14px;
  text-align: left;
  border-bottom: 1px solid var(--vp-c-divider);
}

.bm-table th {
  font-weight: 600;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
}

.bm-table td {
  color: var(--vp-c-text-2);
}

.bm-highlight td {
  font-weight: 600;
  color: var(--vp-c-text-1);
  background: var(--vp-c-brand-soft);
}

/* ------------------------------------------------------------------ */
/* Primary section (PostgreSQL)                                        */
/* ------------------------------------------------------------------ */

.bm-section-primary {
  margin: 32px 0;
  padding: 24px;
  border-left: 4px solid var(--vp-c-brand-1);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.bm-section-primary h2 {
  margin-top: 0;
}

.bm-section-label {
  display: inline-block;
  margin-bottom: 16px;
  padding: 2px 10px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 4px;
}

/* ------------------------------------------------------------------ */
/* Section subtitle                                                    */
/* ------------------------------------------------------------------ */

.bm-section-subtitle {
  margin-top: -8px;
  margin-bottom: 16px;
  color: var(--vp-c-text-2);
}

.bm-table-note {
  margin-top: -16px;
  margin-bottom: 24px;
  font-size: 0.85rem;
  color: var(--vp-c-text-3);
}

/* ------------------------------------------------------------------ */
/* Commentary blockquote                                                */
/* ------------------------------------------------------------------ */

.bm-commentary {
  margin: 16px 0 24px;
  padding: 16px 20px;
  border-left: 3px solid var(--vp-c-divider);
  border-radius: 4px;
  font-size: 0.88rem;
  color: var(--vp-c-text-2);
}

.bm-commentary p {
  margin: 8px 0;
}

.bm-commentary p:first-child {
  margin-top: 0;
}

.bm-commentary p:last-child {
  margin-bottom: 0;
}

/* ------------------------------------------------------------------ */
/* Intro                                                               */
/* ------------------------------------------------------------------ */

.bm-intro {
  margin: 0 0 32px;
  padding: 16px 20px;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  font-size: 0.92rem;
}

.bm-intro ul {
  margin: 8px 0;
  padding-left: 20px;
}

.bm-intro li {
  margin: 4px 0;
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

.bm-loading,
.bm-error,
.bm-noscript {
  padding: 24px;
  text-align: center;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  margin: 24px 0;
}

.bm-error {
  border-left: 4px solid var(--vp-c-danger-1);
}

.bm-noscript {
  border-left: 4px solid var(--vp-c-warning-1);
}

.bm-stale-banner {
  padding: 12px 16px;
  margin-bottom: 16px;
  border-radius: 8px;
  border-left: 4px solid var(--vp-c-warning-1);
  background: var(--vp-c-warning-soft);
  font-size: 0.88rem;
  color: var(--vp-c-text-2);
}

/* ------------------------------------------------------------------ */
/* Meta / footnote                                                     */
/* ------------------------------------------------------------------ */

.bm-meta {
  font-size: 0.85rem;
  color: var(--vp-c-text-3);
  margin-bottom: 24px;
}

.bm-footnote {
  margin-top: 24px;
  padding: 16px;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  font-size: 0.88rem;
  color: var(--vp-c-text-2);
}

.bm-footnote p {
  margin: 4px 0;
}
</style>
