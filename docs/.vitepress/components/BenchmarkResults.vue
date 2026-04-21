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
const realisticRows = computed(() => toCompactRows(data.value?.realistic ?? []));

const realisticOnebunGetList = computed(() => {
  const row = realisticRows.value.find((r) => r.name.toLowerCase().includes('onebun'));
  return row?.getList ?? 0;
});

// Realistic PostgreSQL
const realisticPgRows = computed(() => toCompactRows(data.value?.realisticPg ?? []));

const realisticPgOnebunRow = computed(() =>
  realisticPgRows.value.find((r) =>
    r.name.toLowerCase().includes('onebun') && !r.name.toLowerCase().includes('full'),
  ) ?? null,
);

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
        <span class="bm-card-label">faster than NestJS&nbsp;(Node.js)</span>
      </div>
      <div class="bm-card">
        <span class="bm-card-number">Zero</span>
        <span class="bm-card-label">build step &mdash; runs TypeScript directly, no tsc, no build pipeline</span>
      </div>
    </div>

    <p class="bm-meta">
      ~2x is a conservative estimate across multiple runs. Exact results from the latest CI run
      are in the tables below. Results vary &plusmn;20% between runs due to shared GitHub Actions runners.
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
        <p>SQLite results show smaller framework overhead differences. The bottleneck here is the <code>bun:sqlite</code> integration in Drizzle, which currently underperforms <code>better-sqlite3</code> on Node. OneBun leads on detail reads and writes, but NestJS + Drizzle on Node wins on list reads in this configuration.</p>
        <p>For embedded and edge workloads, driver + runtime choice dominates framework overhead. If you're running SQLite in production today, the current <code>bun:sqlite</code> + Drizzle combination is not the fastest option, regardless of framework.</p>
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
          <p>Against NestJS with the same ORM on the same runtime, OneBun is <strong>~2&times; faster on cached reads</strong> and <strong>~1.3&times; faster on writes</strong>. On uncached reads, framework overhead dissolves into database round-trip time &mdash; all frameworks land within noise. Against canonical NestJS + TypeORM, the gap widens to <strong>~4&times; on cached reads</strong> and <strong>~1.7&times; on writes</strong>.</p>
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
                <td>~29% slower</td>
                <td>~9% slower</td>
                <td>~13% slower</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="bm-commentary">
          <p>At <strong>100% sampling</strong>, observability adds ~29% overhead on cache hits and near-zero on I/O-bound endpoints. With production-typical <strong>10% sampling</strong>, overhead scales roughly linearly to an estimated ~3&ndash;5% on cache hits.</p>
          <p>Even with full observability enabled, OneBun remains faster than NestJS + Drizzle on the same runtime for cached reads and writes. Setup cost is <code>bun add @onebun/metrics @onebun/trace</code> &mdash; no middleware wiring, no manual instrumentation.</p>
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
      <li><strong>Realistic (PostgreSQL):</strong> PostgreSQL 16, same data set. In-memory cache on GET list only (hot-path reads). GET detail hits DB directly with a JOIN. Validation enabled across all frameworks (ArkType for OneBun, Zod via <code>nestjs-zod</code> for NestJS + Drizzle stacks, class-validator for canonical NestJS + TypeORM). Swagger docs enabled. Includes a separate OneBun run with observability enabled (Prometheus metrics + OpenTelemetry tracing at 100% sampling, no-op exporter) to isolate observability overhead.</li>
      <li>Scripts are in the <code>benchmarks/</code> directory of the repository.</li>
      <li>CI runs on shared GitHub Actions runners. Results vary &plusmn;20% between runs due to noisy-neighbor effects. Relative ranking between frameworks is consistent across runs. Raw data from all CI runs is available via <a href="https://gist.github.com/RemRyahirev/bde6a4c4930c19a963199fa0bea2b265" target="_blank" rel="noopener">Gist revisions</a>.</li>
    </ul>

    <h3>About the stacks</h3>
    <ul>
      <li><strong>OneBun:</strong> default configuration from <code>bunx create-onebun</code>. No custom tuning.</li>
      <li><strong>NestJS + Drizzle (Bun):</strong> hand-assembled best-case for NestJS on Bun &mdash; <code>@nestjs/common</code> + Drizzle + <code>Bun.SQL</code> + custom <code>SimpleCacheService</code> + Zod via <code>nestjs-zod</code> for validation. Not a default NestJS stack; represents NestJS paired with modern best practices on Bun.</li>
      <li><strong>NestJS + Drizzle (Node):</strong> same as above but on Node + <code>pg Pool</code>. Also uses Zod via <code>nestjs-zod</code>. Modern NestJS on the traditional runtime.</li>
      <li><strong>NestJS + TypeORM (Node):</strong> canonical NestJS stack &mdash; <code>@nestjs/typeorm</code> + <code>cache-manager</code> + class-validator. What most teams currently run in production.</li>
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
    <p><strong>Against NestJS</strong> (same framework class, production-like stack with Zod validation): OneBun is <strong>~2&times; faster on cache-hit reads</strong> and <strong>~1.3&times; faster on writes</strong> with the same ORM on the same runtime. Against canonical NestJS + TypeORM, gaps widen to ~4&times; and ~1.7&times;.</p>
    <p><strong>Where OneBun doesn't lead:</strong></p>
    <ul>
      <li><strong>SQLite workloads</strong> &mdash; gaps between frameworks narrow significantly. Driver and runtime choice dominate framework overhead in embedded scenarios; OneBun still leads but margins are small.</li>
      <li><strong>Uncached reads hitting Postgres</strong> &mdash; I/O dominates, parity with other frameworks expected.</li>
      <li><strong>Cold startup</strong> &mdash; ~477ms reflects DI graph construction. Optimized for long-running services, not serverless.</li>
    </ul>
    <p>Performance is a nice bonus, not the main pitch. The pitch is <strong>enterprise practices without the integration work</strong> &mdash; structured logging, metrics, tracing, typed config, validation, and OpenAPI generation all wired from the first line of code. Validation in particular: <code>type({...})</code> in your code, and you get TypeScript types, runtime validation, and OpenAPI spec from one declaration &mdash; no bridge packages, no Swagger patches.</p>
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
