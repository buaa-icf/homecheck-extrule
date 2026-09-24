#!/usr/bin/env node

/**
 * Search Feature Envy thresholds by actually running HomeCheck.
 *
 * This is slower than parsing dataset messages, but it is the accurate path:
 * lowering a threshold can create new detections that do not exist in the
 * current issuesReport.json, so a report-only or label-only search is not
 * enough.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  compareRepo,
  computeMetrics,
  loadGroundTruth,
} = require('./datasetF1');

const RULE_NAME = '@extrulesproject/feature-envy-check';
const DEFAULT_REPOS = [
  'agc-template-market-harmonyos-demos',
  'applications_photos',
  'applications_settings',
  'cases',
  'model-evaluation-testsuite',
  'openharmony_tpc_samples',
  'ostest_integration_test',
];

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith('--')) {
      continue;
    }
    const eqIndex = item.indexOf('=');
    if (eqIndex === -1) {
      args[item.slice(2)] = 'true';
    } else {
      args[item.slice(2, eqIndex)] = item.slice(eqIndex + 1);
    }
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function parseNumberList(value, fallback) {
  if (!value) {
    return fallback;
  }
  return value.split(',')
    .map((item) => Number(item.trim()))
    .filter((num) => Number.isFinite(num));
}

function toCsvValue(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, rows.map((row) => row.map(toCsvValue).join(',')).join('\n') + '\n');
}

function buildRuleConfig(baseRuleConfig, thresholds, packagePath) {
  return {
    ...baseRuleConfig,
    rules: {},
    extRuleSet: [
      {
        ...(baseRuleConfig.extRuleSet && baseRuleConfig.extRuleSet[0] ? baseRuleConfig.extRuleSet[0] : {}),
        ruleSetName: 'extrulesproject',
        packagePath,
        extRules: {
          [RULE_NAME]: [2, {
            atfdThreshold: thresholds.atfdThreshold,
            ldaThreshold: thresholds.ldaThreshold,
            cpfdThreshold: thresholds.cpfdThreshold,
          }],
        },
      },
    ],
  };
}

function buildProjectConfig(baseProjectConfig, repoName, repoPath, reportDir) {
  return {
    ...baseProjectConfig,
    projectName: repoName,
    projectPath: repoPath.endsWith(path.sep) ? repoPath : `${repoPath}${path.sep}`,
    reportDir,
    logPath: path.join(reportDir, 'HomeCheck.log'),
  };
}

function runHomecheckForRepo(options) {
  const {
    baseProjectConfig,
    repoName,
    repoPath,
    runnerPath,
    ruleConfigPath,
    issuesReportPath,
    runDir,
    npmCacheDir,
    timeoutMs,
  } = options;

  const reportDir = path.join(runDir, repoName, 'homecheck-report');
  const projectConfigPath = path.join(runDir, '.tmp', `projectConfig.${repoName}.json`);
  const savedIssuesPath = path.join(runDir, repoName, 'issuesReport.json');
  ensureDir(path.dirname(projectConfigPath));
  ensureDir(reportDir);
  fs.rmSync(issuesReportPath, { force: true });
  writeJson(projectConfigPath, buildProjectConfig(baseProjectConfig, repoName, repoPath, reportDir));

  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      `--projectConfigPath=${projectConfigPath}`,
      `--configPath=${ruleConfigPath}`,
    ],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      timeout: timeoutMs,
      env: {
        ...process.env,
        npm_config_cache: npmCacheDir,
        NPM_CONFIG_CACHE: npmCacheDir,
      },
    },
  );

  let copied = false;
  const generatedIssuesPath = path.join(reportDir, 'issuesReport.json');
  const sourceIssuesPath = fs.existsSync(generatedIssuesPath)
    ? generatedIssuesPath
    : issuesReportPath;
  if (fs.existsSync(sourceIssuesPath)) {
    ensureDir(path.dirname(savedIssuesPath));
    fs.copyFileSync(sourceIssuesPath, savedIssuesPath);
    copied = true;
  }

  return {
    repoName,
    repoPath,
    success: result.status === 0 && copied,
    exitCode: result.status,
    signal: result.signal,
    durationMs: Date.now() - started,
    issuesReportPath: savedIssuesPath,
  };
}

function evaluateRun(runResults, groundTruth, reposRoot) {
  const totals = { tp: 0, fp: 0, fn: 0 };
  const fnList = [];
  const fpList = [];
  const targets = [...groundTruth.positives, ...groundTruth.negatives];

  for (const run of runResults) {
    const issues = run.success ? readJson(run.issuesReportPath, []) : [];
    const repoResult = compareRepo({
      issues,
      repoName: run.repoName,
      repoPath: path.join(reposRoot, run.repoName),
      targets,
      labeledFiles: groundTruth.labeledFilesByRepo.get(run.repoName) || new Set(),
      ruleNames: [RULE_NAME],
    })[RULE_NAME];

    totals.tp += repoResult.tp;
    totals.fp += repoResult.fp;
    totals.fn += repoResult.fn;
    for (const item of repoResult.fnList) {
      fnList.push({ repo: run.repoName, ...item });
    }
    for (const item of repoResult.fpList) {
      fpList.push({ repo: run.repoName, ...item });
    }
  }

  return {
    ...totals,
    ...computeMetrics(totals),
    fnList,
    fpList,
  };
}

function compareResults(left, right) {
  if ((left.evaluation.f1 ?? -1) !== (right.evaluation.f1 ?? -1)) {
    return (right.evaluation.f1 ?? -1) - (left.evaluation.f1 ?? -1);
  }
  if (left.evaluation.fn !== right.evaluation.fn) {
    return left.evaluation.fn - right.evaluation.fn;
  }
  if (left.evaluation.fp !== right.evaluation.fp) {
    return left.evaluation.fp - right.evaluation.fp;
  }
  return 0;
}

function formatMetric(value) {
  return value === null || value === undefined ? '' : Number(value).toFixed(6);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const reposRoot = path.resolve(cwd, args.reposRoot || '../');
  const datasetDir = path.resolve(cwd, args.datasetDir || '../arkts-code-smell/dataset');
  const outputDir = path.resolve(cwd, args.outputDir || './report/.perftest/feature_envy_threshold_homecheck');
  const baseProjectConfigPath = path.resolve(cwd, args.baseProjectConfig || './config/projectConfig.json');
  const baseRuleConfigPath = path.resolve(cwd, args.baseRuleConfig || './config/ruleConfig.json');
  const runnerPath = path.resolve(cwd, args.runnerPath || './node_modules/homecheck/lib/run.js');
  const issuesReportPath = path.resolve(cwd, args.issuesReportPath || './report/issuesReport.json');
  const npmCacheDir = path.resolve(cwd, args.npmCacheDir || './report/.npm-cache');
  const packagePath = path.resolve(cwd, args.packagePath || './extrulesproject-1.0.0.tgz');
  const timeoutMs = Number(args.timeoutMs || 30 * 60 * 1000);
  const repos = (args.includeRepos ? args.includeRepos.split(',') : DEFAULT_REPOS).filter(Boolean);
  const atfdValues = parseNumberList(args.atfdValues, [3, 4, 5]);
  const ldaValues = parseNumberList(args.ldaValues, [0.30, 0.33, 0.35]);
  const cpfdValues = parseNumberList(args.cpfdValues, [1, 2, 3]);

  for (const required of [baseProjectConfigPath, baseRuleConfigPath, runnerPath, packagePath]) {
    if (!fs.existsSync(required)) {
      throw new Error(`Required path does not exist: ${required}`);
    }
  }

  const baseProjectConfig = readJson(baseProjectConfigPath, {});
  const baseRuleConfig = readJson(baseRuleConfigPath, {});
  const groundTruth = loadGroundTruth(datasetDir, [RULE_NAME]);
  const results = [];
  ensureDir(outputDir);
  ensureDir(npmCacheDir);

  for (const atfdThreshold of atfdValues) {
    for (const ldaThreshold of ldaValues) {
      for (const cpfdThreshold of cpfdValues) {
        const thresholds = { atfdThreshold, ldaThreshold, cpfdThreshold };
        const id = `atfd${atfdThreshold}_lda${ldaThreshold}_cpfd${cpfdThreshold}`.replace(/[^a-zA-Z0-9._-]/g, '_');
        const runDir = path.join(outputDir, 'runs', id);
        const ruleConfigPath = path.join(runDir, '.tmp', 'ruleConfig.json');
        writeJson(ruleConfigPath, buildRuleConfig(baseRuleConfig, thresholds, packagePath));

        console.log(`[threshold] ATFD>${atfdThreshold} LDA<${ldaThreshold} CPFD<=${cpfdThreshold}`);
        const runResults = [];
        for (const repoName of repos) {
          const repoPath = path.join(reposRoot, repoName);
          if (!fs.existsSync(repoPath)) {
            console.log(`  missing repo: ${repoName}`);
            runResults.push({ repoName, repoPath, success: false, issuesReportPath: '' });
            continue;
          }
          const run = runHomecheckForRepo({
            baseProjectConfig,
            repoName,
            repoPath,
            runnerPath,
            ruleConfigPath,
            issuesReportPath,
            runDir,
            npmCacheDir,
            timeoutMs,
          });
          runResults.push(run);
          console.log(`  ${repoName}: ${run.success ? 'done' : 'failed'} ${run.durationMs || 0}ms`);
        }

        const evaluation = evaluateRun(runResults, groundTruth, reposRoot);
        const result = { thresholds, evaluation, runResults };
        results.push(result);
        writeJson(path.join(runDir, 'evaluation.json'), result);
        console.log(`  result: TP=${evaluation.tp} FP=${evaluation.fp} FN=${evaluation.fn} F1=${formatMetric(evaluation.f1)}`);
      }
    }
  }

  results.sort(compareResults);
  const best = results[0];
  writeJson(path.join(outputDir, 'feature-envy-homecheck-threshold-search.json'), {
    generatedAt: new Date().toISOString(),
    reposRoot,
    datasetDir,
    searched: { atfdValues, ldaValues, cpfdValues, repos },
    best,
    results,
  });
  writeCsv(path.join(outputDir, 'feature-envy-homecheck-threshold-search.csv'), [
    ['rank', 'atfdThreshold', 'ldaThreshold', 'cpfdThreshold', 'tp', 'fp', 'fn', 'precision', 'recall', 'f1'],
    ...results.map((result, index) => [
      index + 1,
      result.thresholds.atfdThreshold,
      result.thresholds.ldaThreshold,
      result.thresholds.cpfdThreshold,
      result.evaluation.tp,
      result.evaluation.fp,
      result.evaluation.fn,
      formatMetric(result.evaluation.precision),
      formatMetric(result.evaluation.recall),
      formatMetric(result.evaluation.f1),
    ]),
  ]);

  console.log(
    `best ATFD>${best.thresholds.atfdThreshold} LDA<${best.thresholds.ldaThreshold} CPFD<=${best.thresholds.cpfdThreshold} ` +
    `TP=${best.evaluation.tp} FP=${best.evaluation.fp} FN=${best.evaluation.fn} F1=${formatMetric(best.evaluation.f1)}`
  );
  console.log(`Output: ${outputDir}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
