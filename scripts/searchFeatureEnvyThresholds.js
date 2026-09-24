#!/usr/bin/env node

/**
 * Search Feature Envy threshold combinations against the labeled dataset.
 *
 * Rule condition:
 *   ATFD > atfdThreshold && LDA < ldaThreshold && CPFD <= cpfdThreshold
 *
 * The current dataset contains two historical message formats:
 * - New metric format: "(ATFD=5, LDA=0.17, CPFD=1)"
 * - Old coupling format: "(4/5 calls, 80%)"
 *
 * For the old format, the script derives an approximation:
 *   ATFD = foreign calls, LDA = local calls / total calls, CPFD = 1
 */

const fs = require('node:fs');
const path = require('node:path');

const RULE_NAME = '@extrulesproject/feature-envy-check';

function parseArgs(argv) {
  const args = {};
  for (const rawArg of argv) {
    if (!rawArg.startsWith('--')) {
      continue;
    }
    const eqIndex = rawArg.indexOf('=');
    if (eqIndex === -1) {
      args[rawArg.slice(2)] = 'true';
    } else {
      args[rawArg.slice(2, eqIndex)] = rawArg.slice(eqIndex + 1);
    }
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonArray(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array: ${filePath}`);
  }
  return parsed;
}

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function parseMetrics(message) {
  const text = String(message || '');

  const metricsMatch = /\bATFD=(\d+(?:\.\d+)?),\s*LDA=(\d+(?:\.\d+)?),\s*CPFD=(\d+(?:\.\d+)?)/.exec(text);
  if (metricsMatch) {
    return {
      atfd: Number(metricsMatch[1]),
      lda: Number(metricsMatch[2]),
      cpfd: Number(metricsMatch[3]),
      source: 'metric',
    };
  }

  const noExternalMatch = /has no external receiver access/i.exec(text);
  if (noExternalMatch) {
    return {
      atfd: 0,
      lda: 1,
      cpfd: 0,
      source: 'no-external',
    };
  }

  const coupledMatch = /\((\d+)\s*\/\s*(\d+)\s*calls,\s*\d+(?:\.\d+)?%\)/i.exec(text);
  if (coupledMatch) {
    const foreignCalls = Number(coupledMatch[1]);
    const totalCalls = Number(coupledMatch[2]);
    return {
      atfd: foreignCalls,
      lda: totalCalls > 0 ? (totalCalls - foreignCalls) / totalCalls : 1,
      cpfd: foreignCalls > 0 ? 1 : 0,
      source: 'coupling-approx',
    };
  }

  return null;
}

function loadSamplesFromJson(filePath, kind, samples, skipped) {
  for (const item of readJsonArray(filePath)) {
    const itemPath = normalizePath(item && item.filePath);
    if (!item || !Array.isArray(item.messages)) {
      continue;
    }

    for (const message of item.messages) {
      if (!message || message.rule !== RULE_NAME) {
        continue;
      }

      const metrics = parseMetrics(message.message);
      const sample = {
        kind,
        filePath: itemPath,
        line: Number(message.line) || 0,
        rangeStart: Number(message.rangeStart ?? message.line) || 0,
        rangeEnd: Number(message.rangeEnd ?? message.line) || 0,
        message: String(message.message || ''),
      };

      if (!metrics) {
        skipped.push({
          ...sample,
          reason: 'metrics-not-found',
        });
        continue;
      }

      samples.push({
        ...sample,
        ...metrics,
      });
    }
  }
}

function loadDataset(datasetDir) {
  const samples = [];
  const skipped = [];

  for (const positiveSubdir of ['local-test', 'instrument-test']) {
    const filePath = path.join(datasetDir, 'positive', positiveSubdir, 'feature-envy.json');
    if (fs.existsSync(filePath)) {
      loadSamplesFromJson(filePath, 'positive', samples, skipped);
    }
  }

  const negativeFile = path.join(datasetDir, 'negative', 'negative-feature-envy.json');
  if (fs.existsSync(negativeFile)) {
    loadSamplesFromJson(negativeFile, 'negative', samples, skipped);
  }

  return { samples, skipped };
}

function parseNumberList(value, fallback) {
  if (!value) {
    return fallback;
  }
  return value.split(',')
    .map((item) => Number(item.trim()))
    .filter((num) => Number.isFinite(num));
}

function decimalRange(start, end, step) {
  const values = [];
  const scale = 1000000;
  for (let current = start; current <= end + step / 2; current += step) {
    values.push(Math.round(current * scale) / scale);
  }
  return values;
}

function detects(sample, thresholds) {
  return sample.atfd > thresholds.atfdThreshold
    && sample.lda < thresholds.ldaThreshold
    && sample.cpfd <= thresholds.cpfdThreshold;
}

function computeResult(samples, thresholds, includeMismatches = false) {
  const mismatches = includeMismatches ? [] : undefined;
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;

  for (const sample of samples) {
    const detected = detects(sample, thresholds);
    const expected = sample.kind === 'positive';
    if (detected && expected) {
      tp += 1;
    } else if (!detected && !expected) {
      tn += 1;
    } else if (detected && !expected) {
      fp += 1;
      if (mismatches) {
        mismatches.push({ ...sample, predicted: 'positive', expected: 'negative' });
      }
    } else {
      fn += 1;
      if (mismatches) {
        mismatches.push({ ...sample, predicted: 'negative', expected: 'positive' });
      }
    }
  }

  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0
    ? null
    : (2 * precision * recall) / (precision + recall);

  return {
    thresholds,
    total: samples.length,
    correct: tp + tn,
    tp,
    fp,
    fn,
    tn,
    precision,
    recall,
    f1,
    ...(mismatches ? { mismatches } : {}),
  };
}

function compareResults(left, right) {
  if (left.correct !== right.correct) {
    return right.correct - left.correct;
  }
  if ((left.f1 ?? -1) !== (right.f1 ?? -1)) {
    return (right.f1 ?? -1) - (left.f1 ?? -1);
  }
  if (left.fn !== right.fn) {
    return left.fn - right.fn;
  }
  if (left.fp !== right.fp) {
    return left.fp - right.fp;
  }

  const leftDistance = Math.abs(left.thresholds.atfdThreshold - 4)
    + Math.abs(left.thresholds.ldaThreshold - 0.33)
    + Math.abs(left.thresholds.cpfdThreshold - 2);
  const rightDistance = Math.abs(right.thresholds.atfdThreshold - 4)
    + Math.abs(right.thresholds.ldaThreshold - 0.33)
    + Math.abs(right.thresholds.cpfdThreshold - 2);
  return leftDistance - rightDistance;
}

function formatNumber(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return Number(value).toFixed(6);
}

function toCsvValue(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows) {
  const text = rows.map((row) => row.map(toCsvValue).join(',')).join('\n') + '\n';
  fs.writeFileSync(filePath, text);
}

function buildCandidateThresholds(samples, args) {
  const maxAtfd = Math.max(4, ...samples.map((sample) => sample.atfd));
  const maxCpfd = Math.max(2, ...samples.map((sample) => sample.cpfd));
  const atfdValues = parseNumberList(args.atfdValues, Array.from({ length: Math.ceil(maxAtfd) + 1 }, (_, index) => index));
  const ldaValues = parseNumberList(args.ldaValues, decimalRange(0, 1, Number(args.ldaStep || 0.01)));
  const cpfdValues = parseNumberList(args.cpfdValues, Array.from({ length: Math.ceil(maxCpfd) + 1 }, (_, index) => index));
  return { atfdValues, ldaValues, cpfdValues };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const datasetDir = path.resolve(cwd, args.datasetDir || '../arkts-code-smell/dataset');
  const outputDir = path.resolve(cwd, args.outputDir || './report/.perftest/feature_envy_threshold_search');
  const topN = Number(args.top || 20);

  const { samples, skipped } = loadDataset(datasetDir);
  if (samples.length === 0) {
    throw new Error(`No parseable feature-envy samples found under: ${datasetDir}`);
  }

  const { atfdValues, ldaValues, cpfdValues } = buildCandidateThresholds(samples, args);
  const results = [];

  for (const atfdThreshold of atfdValues) {
    for (const ldaThreshold of ldaValues) {
      for (const cpfdThreshold of cpfdValues) {
        results.push(computeResult(samples, { atfdThreshold, ldaThreshold, cpfdThreshold }));
      }
    }
  }

  results.sort(compareResults);
  const best = computeResult(samples, results[0].thresholds, true);
  const topResults = results.slice(0, topN);
  const bySource = samples.reduce((acc, sample) => {
    acc[sample.source] = (acc[sample.source] || 0) + 1;
    return acc;
  }, {});

  ensureDir(outputDir);
  const jsonPath = path.join(outputDir, 'feature-envy-threshold-search.json');
  const csvPath = path.join(outputDir, 'feature-envy-threshold-search.csv');
  const mismatchPath = path.join(outputDir, 'feature-envy-threshold-best-mismatches.csv');

  fs.writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    datasetDir,
    sampleCount: samples.length,
    positiveCount: samples.filter((sample) => sample.kind === 'positive').length,
    negativeCount: samples.filter((sample) => sample.kind === 'negative').length,
    metricSourceCounts: bySource,
    skipped,
    searched: {
      atfdValues,
      ldaValues,
      cpfdValues,
    },
    best,
    topResults,
  }, null, 2));

  writeCsv(csvPath, [
    ['rank', 'atfdThreshold', 'ldaThreshold', 'cpfdThreshold', 'correct', 'total', 'tp', 'fp', 'fn', 'tn', 'precision', 'recall', 'f1'],
    ...topResults.map((result, index) => [
      index + 1,
      result.thresholds.atfdThreshold,
      result.thresholds.ldaThreshold,
      result.thresholds.cpfdThreshold,
      result.correct,
      result.total,
      result.tp,
      result.fp,
      result.fn,
      result.tn,
      formatNumber(result.precision),
      formatNumber(result.recall),
      formatNumber(result.f1),
    ]),
  ]);

  writeCsv(mismatchPath, [
    ['kind', 'predicted', 'filePath', 'line', 'rangeStart', 'rangeEnd', 'atfd', 'lda', 'cpfd', 'source', 'message'],
    ...best.mismatches.map((sample) => [
      sample.expected,
      sample.predicted,
      sample.filePath,
      sample.line,
      sample.rangeStart,
      sample.rangeEnd,
      sample.atfd,
      formatNumber(sample.lda),
      sample.cpfd,
      sample.source,
      sample.message,
    ]),
  ]);

  console.log(`samples=${samples.length} positive=${samples.filter((sample) => sample.kind === 'positive').length} negative=${samples.filter((sample) => sample.kind === 'negative').length} skipped=${skipped.length}`);
  console.log(`metricSources=${JSON.stringify(bySource)}`);
  console.log(
    `best ATFD>${best.thresholds.atfdThreshold} LDA<${best.thresholds.ldaThreshold} CPFD<=${best.thresholds.cpfdThreshold} ` +
    `correct=${best.correct}/${best.total} TP=${best.tp} FP=${best.fp} FN=${best.fn} TN=${best.tn} F1=${formatNumber(best.f1)}`
  );
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Mismatches: ${mismatchPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
