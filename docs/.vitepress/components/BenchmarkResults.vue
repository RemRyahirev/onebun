<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

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
}

const data = ref<BenchmarkData | null>(null);
const loading = ref(true);
const error = ref(false);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseLatencyToMs(str: string): number {
  const trimmed = str.trim().toLowerCase();
  const numMatch = trimmed.match(/^([\d.]+)\s*(ms|us|µs|s)$/);
  if (!numMatch) return 0;
  const value = parseFloat(numMatch[1]);
  const unit = numMatch[2];
  if (unit === 's') return value * 1000;
  if (unit === 'ms') return value;
  if (unit === 'us' || unit === 'µs') return value / 1000;
  return value;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function computeRatio(a: number, b: number): number {
  if (b === 0) return 0;
  return Math.round((a / b) * 10) / 10;
}

function pctDiff(baseline: number, other: number): string {
  if (baseline === 0) return '—';
  const pct = Math.round(((other - baseline) / baseline) * 100);
  if (pct > 0) return `+${pct}%`;
  return `${pct}%`;
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

const nestNodeHttp = computed(() =>
  data.value?.http.find(
    (h) => h.name.toLowerCase().includes('nestjs') && h.name.toLowerCase().includes('node'),
  ) ?? null,
);

const nestBunHttp = computed(() =>
  data.value?.http.find(
    (h) =>
      h.name.toLowerCase().includes('nestjs') &&
      h.name.toLowerCase().includes('bun') &&
      !h.name.toLowerCase().includes('node'),
  ) ?? null,
);

const throughputRatio = computed(() => {
  if (!onebunHttp.value || !nestNodeHttp.value) return '?';
  return computeRatio(onebunHttp.value.reqPerSec, nestNodeHttp.value.reqPerSec);
});

const tailLatencyRatio = computed(() => {
  if (!onebunHttp.value || !nestNodeHttp.value) return '?';
  const onebunMax = parseLatencyToMs(onebunHttp.value.maxLatency);
  const nestMax = parseLatencyToMs(nestNodeHttp.value.maxLatency);
  if (onebunMax === 0) return '?';
  return computeRatio(nestMax, onebunMax);
});

const onebunStartupMs = computed(() => {
  if (!data.value) return '?';
  const entry = data.value.startup.find((s) => s.name.toLowerCase().includes('onebun'));
  return entry ? Math.round(entry.meanMs) : '?';
});

const tailLatencyEntries = computed(() => {
  if (!data.value) return [];
  return [onebunHttp.value, nestBunHttp.value, nestNodeHttp.value].filter(Boolean) as HttpResult[];
});

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

onMounted(async () => {
  try {
    const res = await fetch(GIST_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data.value = await res.json();
  } catch {
    error.value = true;
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
    <!-- Key Numbers -->
    <div class="bm-cards">
      <div class="bm-card">
        <span class="bm-card-number">{{ throughputRatio }}x</span>
        <span class="bm-card-label">faster than NestJS&nbsp;(Node.js)</span>
      </div>
      <div class="bm-card">
        <span class="bm-card-number">{{ tailLatencyRatio }}x</span>
        <span class="bm-card-label">lower tail latency</span>
      </div>
      <div class="bm-card">
        <span class="bm-card-number">Zero</span>
        <span class="bm-card-label">build step &mdash; runs TypeScript directly, no tsc, no build pipeline</span>
      </div>
    </div>

    <!-- Machine info -->
    <p class="bm-meta">
      Measured on {{ data.machine.cpu }}, {{ data.machine.ram }}, {{ data.machine.os }},
      Bun {{ data.machine.bunVersion }}.
      <template v-if="data.date">Run date: {{ data.date }}.</template>
      <template v-if="data.commit">
        Commit:
        <code>{{ data.commit.slice(0, 7) }}</code>.
      </template>
    </p>

    <!-- HTTP Throughput -->
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

    <!-- Tail Latency -->
    <h2 id="tail-latency">Tail Latency Comparison</h2>
    <p>Tail latency matters for user-facing services. Lower is better.</p>
    <div class="bm-table-wrap">
      <table class="bm-table bm-table-narrow">
        <thead>
          <tr>
            <th>Framework</th>
            <th>P99 Latency</th>
            <th>Max Latency</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in tailLatencyEntries"
            :key="row.name"
            :class="{ 'bm-highlight': row.name.toLowerCase().includes('onebun') }"
          >
            <td>{{ row.name }}</td>
            <td>{{ row.p99Latency }}</td>
            <td>{{ row.maxLatency }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Startup Time -->
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

    <!-- Methodology -->
    <h2 id="methodology">Methodology</h2>
    <ul>
      <li><strong>HTTP:</strong> <a href="https://github.com/codesenberg/bombardier" target="_blank" rel="noopener">bombardier</a>, 50 concurrent connections, 10&nbsp;s duration.</li>
      <li><strong>Startup:</strong> Time from process start to first successful HTTP response, measured with 5&nbsp;ms Bun fetch polling.</li>
      <li>All frameworks return identical JSON payloads.</li>
      <li>Scripts are in the <code>benchmarks/</code> directory of the repository.</li>
    </ul>

    <!-- Footnotes -->
    <div class="bm-footnote">
      <p>NestJS (Node) runs pre-compiled JavaScript. All Bun entries run TypeScript directly &mdash; no build step required.</p>
      <p>Startup: OneBun ~{{ onebunStartupMs }}ms. Optimized for long-running services.</p>
    </div>

    <!-- Honest Assessment -->
    <h2 id="honest-assessment">Honest Assessment</h2>
    <p>
      OneBun is an application framework with DI, modules, middleware, and observability.
      Comparing raw req/sec with minimal HTTP frameworks (Elysia, Hono) is apples-to-oranges &mdash;
      they solve different problems. The meaningful comparison is OneBun vs NestJS &mdash; same class
      of framework. OneBun is consistently faster with significantly better tail latency.
    </p>
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
