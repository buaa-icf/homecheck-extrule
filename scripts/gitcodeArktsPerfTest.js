#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildDashboardHtml, startDashboardServer } = require('./perfDashboard');
const {
  buildDatasetRepos,
  buildF1Markdown,
  compareRepo,
  computeMetrics,
  formatPercent,
  loadGroundTruth,
  summarizeF1,
} = require('./datasetF1');

// 纯性能基准仓库：只采集性能数据，不参与 F1 评估（F1 只针对数据集仓库）。
// 数据集仓库与基准仓库同名时，以数据集版本为准，基准组自动跳过。
const REPOSITORIES = [
  {
    name: 'cases',
    url: 'https://gitcode.com/HarmonyOS-Cases/cases.git',
  },
  {
    name: 'ostest_integration_test',
    url: 'https://gitcode.com/openharmony-sig/ostest_integration_test',
  },
  {
    name: 'arkui_ace_engine',
    url: 'https://gitcode.com/openharmony/arkui_ace_engine.git',
  },
  {
    name: 'agc-template-market-harmonyos-demos',
    url: 'https://gitcode.com/appgallery_connect/agc-template-market-harmonyos-demos.git',
  },
];

const RULES = {
  codeCloneFragment: {
    smell: 'code-clone-fragment',
    ruleName: '@extrulesproject/code-clone-fragment-check',
    checkerName: 'CodeCloneFragmentCheck',
  },
  featureEnvy: {
    smell: 'feature-envy',
    ruleName: '@extrulesproject/feature-envy-check',
    checkerName: 'FeatureEnvyCheck',
  },
  longMethod: {
    smell: 'long-method',
    ruleName: '@extrulesproject/long-method-check',
    checkerName: 'LongMethodCheck',
  },
  switchStatement: {
    smell: 'switch-statement',
    ruleName: '@extrulesproject/switch-statement-check',
    checkerName: 'SwitchStatementCheck',
  },
};

const RULE_ORDER = [
  RULES.codeCloneFragment,
  RULES.featureEnvy,
  RULES.longMethod,
  RULES.switchStatement,
];

const CLOC_EXCLUDE_DIRS = [
  'ohosTest',
  'test',
  'node_modules',
  'build',
  'hvigorfile',
  'oh_modules',
  '.preview',
].join(',');

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith('--')) {
      continue;
    }
    const eqIndex = item.indexOf('=');
    if (eqIndex === -1) {
      args[item.slice(2)] = 'true';
      continue;
    }
    args[item.slice(2, eqIndex)] = item.slice(eqIndex + 1);
  }
  return args;
}

function parseRepoFilter(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const names = items.map((item) => String(item).trim()).filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureTrailingSeparator(targetPath) {
  return targetPath.endsWith(path.sep) ? targetPath : `${targetPath}${path.sep}`;
}

function readJson(jsonPath, fallback) {
  if (!fs.existsSync(jsonPath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

function writeJson(jsonPath, value) {
  ensureDir(path.dirname(jsonPath));
  fs.writeFileSync(jsonPath, JSON.stringify(value, null, 2));
}

function toSafeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

const GIT_URL_PATTERN = /^(https?:\/\/|git@|ssh:\/\/)/;

/**
 * 解析额外仓库。命令行支持 name=target[,name2=target2]，配置文件支持
 * { "name": "target" }；target 为本地目录或 git 地址。
 * 额外仓库按基准仓库处理：只采集性能数据，不参与 F1 评估。
 */
function parseExtraRepos(value) {
  if (!value) {
    return [];
  }
  const items = typeof value === 'string'
    ? value.split(',').map((item) => item.trim()).filter(Boolean)
    : !Array.isArray(value) && typeof value === 'object'
      ? Object.entries(value).map(([name, target]) => `${name}=${target}`)
      : [];
  return items.map((item) => {
    const eqIndex = item.indexOf('=');
    if (eqIndex <= 0 || eqIndex === item.length - 1) {
      throw new Error(`extraRepos 条目格式应为 name=本地路径或git地址: ${item}`);
    }
    const name = item.slice(0, eqIndex);
    const target = item.slice(eqIndex + 1);
    return GIT_URL_PATTERN.test(target)
      ? { name, url: target }
      : { name, localPath: target };
  });
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return '0.00';
  }
  return value.toFixed(digits);
}

function buildNodeOptions(existingOptions, maxOldSpaceMB) {
  const trimmed = (existingOptions || '').trim();
  if (!Number.isFinite(maxOldSpaceMB) || maxOldSpaceMB <= 0) {
    return trimmed;
  }
  if (trimmed.includes('--max-old-space-size=')) {
    return trimmed;
  }
  const heapOption = `--max-old-space-size=${Math.trunc(maxOldSpaceMB)}`;
  return trimmed ? `${trimmed} ${heapOption}` : heapOption;
}

function executeCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const captureOutput = !options.stdio || options.stdio === 'pipe';
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio || 'pipe',
    });
    let stdout = '';
    let stderr = '';
    let spawnError = null;
    let timedOut = false;
    let settled = false;

    if (captureOutput) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
    }

    const timer = options.timeout
      ? setTimeout(() => {
        timedOut = true;
        child.kill(options.killSignal || 'SIGTERM');
      }, options.timeout)
      : null;

    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (status, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve({ status, signal, stdout, stderr, error: spawnError, timedOut });
    });
  });
}

async function runCommand(command, args, options = {}) {
  const result = await executeCommand(command, args, options);
  if (result.status !== 0 || result.error) {
    const rendered = [command, ...args].join(' ');
    const stdout = result.stdout ? `\nstdout:\n${result.stdout}` : '';
    const stderr = result.stderr ? `\nstderr:\n${result.stderr}` : '';
    const errMessage = result.error ? `\nerror: ${result.error.message}` : '';
    throw new Error(`Command failed (${result.status}): ${rendered}${errMessage}${stdout}${stderr}`);
  }
  return result.stdout || '';
}

async function cloneOrUpdateRepository(repo, reposRoot, options = {}) {
  const repoPath = path.join(reposRoot, repo.name);
  const started = Date.now();
  ensureDir(reposRoot);

  if (!fs.existsSync(repoPath)) {
    const cloneArgs = ['clone'];
    const cloneDepth = options.cloneDepth ?? '1';
    if (cloneDepth !== '0') {
      cloneArgs.push(`--depth=${cloneDepth}`);
    }
    cloneArgs.push(repo.url, repoPath);
    await runCommand('git', cloneArgs, { stdio: options.stdio || 'inherit' });
    return { path: repoPath, durationMs: Date.now() - started, action: 'cloned' };
  }

  if (options.updateExisting && fs.existsSync(path.join(repoPath, '.git'))) {
    await runCommand('git', ['-C', repoPath, 'pull', '--ff-only'], {
      stdio: options.stdio || 'inherit',
    });
    return { path: repoPath, durationMs: Date.now() - started, action: 'updated' };
  }

  return { path: repoPath, durationMs: Date.now() - started, action: 'reused' };
}

function resolveClocInvocation() {
  const toolsDir = path.resolve(__dirname, '..', 'tools');
  if (process.platform === 'win32') {
    const bundledExe = path.join(toolsDir, 'cloc-2.10.exe');
    if (fs.existsSync(bundledExe)) {
      return { command: bundledExe, prefixArgs: [], source: 'bundled' };
    }
  } else {
    const bundledPerlScript = path.join(toolsDir, 'cloc-2.10.pl');
    if (fs.existsSync(bundledPerlScript)) {
      const perlCommand = fs.existsSync('/usr/bin/perl') ? '/usr/bin/perl' : 'perl';
      return {
        command: perlCommand,
        prefixArgs: [bundledPerlScript],
        source: 'bundled',
      };
    }
  }

  if (process.env.CLOC_PATH) {
    return { command: process.env.CLOC_PATH, prefixArgs: [], source: 'environment' };
  }
  return { command: 'cloc', prefixArgs: [], source: 'system' };
}

async function countEtsLinesWithCloc(repoPath) {
  const clocInvocation = resolveClocInvocation();
  const output = await runCommand(clocInvocation.command, [
    ...clocInvocation.prefixArgs,
    '.',
    '--json',
    '--quiet',
    '--include-lang=ArkTs',
    // '--include-ext=ets',
    // '--force-lang=TypeScript,ets',
    `--exclude-dir=${CLOC_EXCLUDE_DIRS}`,
  ], { cwd: repoPath });
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Failed to parse cloc JSON output for ${repoPath}`);
  }
  const parsed = JSON.parse(output.slice(start, end + 1));
  return Number(parsed.SUM && parsed.SUM.code) || 0;
}

function buildMultiRuleConfig(baseConfig, rules, packagePath) {
  const baseExtRuleSet = Array.isArray(baseConfig.extRuleSet)
    ? baseConfig.extRuleSet
    : [];
  const baseRuleSet = baseExtRuleSet[0] || {
    ruleSetName: 'extrulesproject',
    packagePath: packagePath || path.resolve(process.cwd(), 'extrulesproject-1.0.0.tgz'),
  };
  const resolvedPackagePath = packagePath || baseRuleSet.packagePath;
  const extRules = {};
  for (const rule of rules) {
    extRules[rule.ruleName] = 2;
  }
  return {
    ...baseConfig,
    extRuleSet: [{
      ...baseRuleSet,
      packagePath: resolvedPackagePath,
      extRules,
    }],
  };
}

function buildProjectConfig(baseProjectConfig, repoName, repoPath, reportDir, logPath, arkCheckPath) {
  return {
    ...baseProjectConfig,
    projectName: repoName,
    projectPath: ensureTrailingSeparator(path.resolve(repoPath)),
    reportDir,
    logPath,
    arkCheckPath,
  };
}

function countIssues(issues) {
  if (!Array.isArray(issues)) {
    return { issueObjects: 0, issueMessages: 0 };
  }
  let issueMessages = 0;
  for (const item of issues) {
    if (item && Array.isArray(item.messages)) {
      issueMessages += item.messages.length;
    }
  }
  return {
    issueObjects: issues.length,
    issueMessages,
  };
}

function filterIssuesByRule(issues, ruleName) {
  if (!Array.isArray(issues)) {
    return [];
  }
  return issues.flatMap((item) => {
    if (!item || !Array.isArray(item.messages)) {
      return [];
    }
    const messages = item.messages.filter((message) => message && message.rule === ruleName);
    return messages.length > 0 ? [{ ...item, messages }] : [];
  });
}

function computeThroughput(lines, durationMs) {
  if (!Number.isFinite(lines) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }
  return Math.round((lines / (durationMs / 1000)) * 100) / 100;
}

function computeThroughputWan(lines, durationMs) {
  return Math.round((computeThroughput(lines, durationMs) / 10000) * 10000) / 10000;
}

function readMemoryTimeline(timelinePath) {
  if (!timelinePath || !fs.existsSync(timelinePath)) {
    return [];
  }
  return fs.readFileSync(timelinePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function copyIfExists(fromPath, toPath) {
  if (!fs.existsSync(fromPath)) {
    return false;
  }
  ensureDir(path.dirname(toPath));
  fs.copyFileSync(fromPath, toPath);
  return true;
}

function removeIfExists(targetPath) {
  fs.rmSync(targetPath, { force: true });
}

function buildDerivedRulePerfReport(sharedPerf, rule, checkerPerf, sharedRun) {
  return {
    runId: `${sharedPerf.runId || sharedRun.repositoryRunId}/${rule.smell}`,
    perfEnabled: true,
    wallStartIso: sharedPerf.wallStartIso,
    wallEndIso: sharedPerf.wallEndIso,
    totalWallMs: Number(checkerPerf && checkerPerf.totalMs) || 0,
    durationScope: 'detector-only',
    peakHeapUsedMB: sharedRun.peakHeapMB,
    peakRssMB: sharedRun.peakRssMB,
    memoryScope: 'repository-shared',
    repositoryRunId: sharedRun.repositoryRunId,
    checkers: checkerPerf ? { [rule.checkerName]: checkerPerf } : {},
  };
}

async function runRepositoryScan(context) {
  const {
    cwd,
    repo,
    repoPath,
    rules,
    etsLines,
    baseProjectConfig,
    baseRuleConfig,
    runnerPath,
    outputDir,
    tmpConfigDir,
    npmCacheDir,
    timeoutMs,
    nodeMaxOldSpaceMB,
    packagePath,
    arkCheckPath,
    perfEnabled,
  } = context;
  const resolvedPackagePath = packagePath || path.resolve(cwd, 'extrulesproject-1.0.0.tgz');
  const resolvedArkCheckPath = arkCheckPath || path.dirname(path.dirname(runnerPath));
  const shouldCollectPerf = perfEnabled !== false;

  const runDir = path.join(outputDir, 'runs', repo.name);
  const configuredReportDir = typeof baseProjectConfig.reportDir === 'string'
    ? baseProjectConfig.reportDir.trim()
    : '';
  const reportDir = configuredReportDir
    ? path.resolve(cwd, configuredReportDir, repo.name)
    : path.join(runDir, 'homecheck-report');
  const configuredLogPath = typeof baseProjectConfig.logPath === 'string'
    ? baseProjectConfig.logPath.trim()
    : '';
  const logPath = configuredLogPath
    ? path.resolve(cwd, configuredLogPath)
    : path.join(reportDir, 'HomeCheck.log');
  const tempProjectConfigPath = path.join(
    tmpConfigDir,
    `projectConfig.${toSafeName(repo.name)}.json`,
  );
  const tempRuleConfigPath = path.join(
    tmpConfigDir,
    `ruleConfig.${toSafeName(repo.name)}.json`,
  );
  const generatedIssuesPath = path.join(reportDir, 'issuesReport.json');
  const fallbackIssuesPath = path.join(cwd, 'report', 'issuesReport.json');
  const generatedPerfPath = path.join(cwd, 'report', 'perfReport.json');
  const savedIssuesPath = path.join(runDir, 'issuesReport.json');
  const savedPerfPath = path.join(runDir, 'perfReport.json');
  const memoryTimelinePath = path.join(runDir, 'memoryTimeline.ndjson');
  const homecheckLogPath = logPath;

  ensureDir(runDir);
  ensureDir(reportDir);
  writeJson(
    tempProjectConfigPath,
    buildProjectConfig(baseProjectConfig, repo.name, repoPath, reportDir, logPath, resolvedArkCheckPath),
  );
  writeJson(tempRuleConfigPath, buildMultiRuleConfig(baseRuleConfig, rules, resolvedPackagePath));

  removeIfExists(generatedIssuesPath);
  removeIfExists(fallbackIssuesPath);
  removeIfExists(generatedPerfPath);
  removeIfExists(savedIssuesPath);
  removeIfExists(savedPerfPath);
  removeIfExists(memoryTimelinePath);
  removeIfExists(homecheckLogPath);
  for (const rule of rules) {
    const compatibilityDir = path.join(runDir, rule.smell);
    removeIfExists(path.join(compatibilityDir, 'issuesReport.json'));
    removeIfExists(path.join(compatibilityDir, 'perfReport.json'));
    removeIfExists(path.join(compatibilityDir, 'memoryTimeline.ndjson'));
    removeIfExists(path.join(compatibilityDir, 'homecheck-report', 'issuesReport.json'));
  }

  const started = Date.now();
  const result = await executeCommand(
    'node',
    [
      runnerPath,
      `--projectConfigPath=${tempProjectConfigPath}`,
      `--configPath=${tempRuleConfigPath}`,
    ],
    {
      cwd,
      stdio: 'inherit',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        EXTRULES_PERF: shouldCollectPerf ? '1' : '0',
        ...(shouldCollectPerf ? { EXTRULES_PERF_TIMELINE_PATH: memoryTimelinePath } : {}),
        NODE_OPTIONS: buildNodeOptions(process.env.NODE_OPTIONS, nodeMaxOldSpaceMB),
        npm_config_cache: npmCacheDir,
        NPM_CONFIG_CACHE: npmCacheDir,
      },
    },
  );
  const durationMs = Date.now() - started;
  const timedOut = result.timedOut;

  const copiedIssues =
    copyIfExists(generatedIssuesPath, savedIssuesPath) ||
    copyIfExists(fallbackIssuesPath, savedIssuesPath);
  const copiedPerf = shouldCollectPerf && copyIfExists(generatedPerfPath, savedPerfPath);
  const issues = readJson(savedIssuesPath, []);
  const issueCounts = countIssues(issues);
  const perf = readJson(savedPerfPath, {});
  const timeline = readMemoryTimeline(memoryTimelinePath);
  const peakHeapMB = Number(perf.peakHeapUsedMB) || Math.max(
    0,
    ...timeline.map((sample) => Number(sample.heapUsedMB) || 0),
  );
  const peakRssMB = Number(perf.peakRssMB) || Math.max(
    0,
    ...timeline.map((sample) => Number(sample.rssMB) || 0),
  );
  const sharedSuccess = result.status === 0 && copiedIssues && (!shouldCollectPerf || copiedPerf) && !timedOut;
  const repositoryRunId = repo.name;
  const sharedRun = {
    repositoryRunId,
    success: sharedSuccess,
    exitCode: result.status,
    signal: result.signal,
    timedOut,
    durationMs,
    homecheckWallMs: shouldCollectPerf ? Number(perf.totalWallMs) || 0 : durationMs,
    issueObjects: issueCounts.issueObjects,
    issueMessages: issueCounts.issueMessages,
    peakHeapMB,
    peakRssMB,
    issuesReportPath: savedIssuesPath,
    perfReportPath: savedPerfPath,
    memoryTimelinePath,
    homecheckLogPath,
    rules: rules.map((rule) => rule.smell),
  };

  const runs = [];
  for (const rule of rules) {
    const checkerPerf = perf.checkers && perf.checkers[rule.checkerName];
    const detectorDurationMs = Number(checkerPerf && checkerPerf.totalMs) || 0;
    const ruleIssues = filterIssuesByRule(issues, rule.ruleName);
    const ruleIssueCounts = countIssues(ruleIssues);
    const compatibilityDir = path.join(runDir, rule.smell);
    const issuesReportPath = path.join(compatibilityDir, 'issuesReport.json');
    const perfReportPath = path.join(compatibilityDir, 'perfReport.json');
    const success = sharedSuccess && (!shouldCollectPerf || Boolean(checkerPerf));
    const throughputLinesPerSecond = success
      ? computeThroughput(etsLines, detectorDurationMs)
      : 0;

    writeJson(issuesReportPath, ruleIssues);
    writeJson(
      perfReportPath,
      buildDerivedRulePerfReport(perf, rule, checkerPerf, sharedRun),
    );
    runs.push({
      smell: rule.smell,
      ruleName: rule.ruleName,
      checkerName: rule.checkerName,
      success,
      exitCode: result.status,
      signal: result.signal,
      timedOut,
      durationMs: detectorDurationMs,
      detectorDurationMs: shouldCollectPerf ? detectorDurationMs : 0,
      durationScope: 'detector-only',
      repositoryWallMs: durationMs,
      homecheckWallMs: sharedRun.homecheckWallMs,
      issueObjects: ruleIssueCounts.issueObjects,
      issueMessages: ruleIssueCounts.issueMessages,
      throughputLinesPerSecond: shouldCollectPerf ? throughputLinesPerSecond : 0,
      throughputWanLinesPerSecond: shouldCollectPerf && success
        ? computeThroughputWan(etsLines, detectorDurationMs)
        : null,
      peakHeapMB,
      peakRssMB,
      memoryScope: 'repository-shared',
      repositoryRunId,
      issuesReportPath,
      perfReportPath,
      memoryTimelinePath,
    });
  }
  return { sharedRun, runs };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push('# ArkTS 异味检测性能报告');
  lines.push('');
  lines.push(`- 开始时间: ${report.startedAt}`);
  lines.push(`- 结束时间: ${report.finishedAt}`);
  lines.push(`- 输出目录: ${report.outputDir}`);
  lines.push('');
  lines.push('## 检测器性能（不含共享预处理）');
  lines.push('');
  lines.push('| 仓库 | .ets 代码行数 | 异味类型 | 检测耗时（不含预处理）(s) | 告警对象数 | 告警指标数 | 检测吞吐 (行/s) | 检测吞吐 (万行/s) | ≥2万行/s |');
  lines.push('| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const repo of report.repositories) {
    for (const run of repo.runs) {
      lines.push([
        `| ${repo.name}`,
        String(repo.etsLines),
        run.smell,
        formatNumber(run.detectorDurationMs / 1000),
        String(run.issueObjects),
        String(run.issueMessages),
        formatNumber(run.throughputLinesPerSecond),
        run.throughputWanLinesPerSecond === null ? '—' : formatNumber(run.throughputWanLinesPerSecond, 4),
        `${run.throughputWanLinesPerSecond !== null && run.throughputWanLinesPerSecond >= 2 ? '是' : '否'} |`,
      ].join(' | '));
    }
  }
  lines.push('');
  lines.push('## 仓库共享资源（Scene + 全部选中规则）');
  lines.push('');
  lines.push('- 预处理耗时 = 端到端总耗时 − 各规则检测耗时合计（进程启动、Scene 构建等共享开销）；分析耗时 = 全部选中规则的检测耗时合计');
  lines.push('');
  lines.push('| 仓库 | 规则 | 预处理耗时 (s) | 分析耗时 (s) | 共享 peakHeapMB | 共享 peakRssMB |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: |');
  for (const repo of report.repositories) {
    if (!repo.sharedRun) {
      continue;
    }
    const analysisMs = repo.runs.reduce(
      (sum, run) => sum + (Number(run.detectorDurationMs) || 0),
      0,
    );
    const preprocessingMs = Math.max(0, repo.sharedRun.durationMs - analysisMs);
    lines.push([
      `| ${repo.name}`,
      repo.sharedRun.rules.join(', '),
      formatNumber(preprocessingMs / 1000),
      formatNumber(analysisMs / 1000),
      formatNumber(repo.sharedRun.peakHeapMB),
      `${formatNumber(repo.sharedRun.peakRssMB)} |`,
    ].join(' | '));
  }
  lines.push('');
  lines.push('## 输入仓库');
  lines.push('');
  lines.push('| 仓库 | 组别 | URL | 本地路径 | 克隆/更新时间 (s) |');
  lines.push('| --- | --- | --- | --- | ---: |');
  for (const repo of report.repositories) {
    lines.push(`| ${repo.name} | ${repo.group || 'benchmark'} | ${repo.url} | ${repo.path} | ${formatNumber(repo.cloneDurationMs / 1000)} |`);
  }
  return `${lines.join('\n')}\n`;
}

function buildAggregatePerfReport(report) {
  const checkers = {};
  for (const repo of report.repositories) {
    for (const run of repo.runs) {
      checkers[`${repo.name}/${run.smell}`] = {
        totalMs: run.detectorDurationMs,
        durationScope: 'detector-only',
        stages: {
          detector: {
            count: 1,
            totalMs: run.detectorDurationMs,
            avgMs: run.detectorDurationMs,
            minMs: run.detectorDurationMs,
            maxMs: run.detectorDurationMs,
          },
        },
      };
    }
  }
  return {
    runId: report.startedAt,
    perfEnabled: true,
    wallStartIso: report.startedAt,
    wallEndIso: report.finishedAt,
    totalWallMs: report.totalWallMs,
    peakHeapUsedMB: Math.max(
      0,
      ...report.repositories.map((repo) => Number(repo.sharedRun && repo.sharedRun.peakHeapMB) || 0),
    ),
    peakRssMB: Math.max(
      0,
      ...report.repositories.map((repo) => Number(repo.sharedRun && repo.sharedRun.peakRssMB) || 0),
    ),
    checkers,
    repositories: report.repositories,
  };
}

function printUsage() {
  console.log('Usage: node ./scripts/gitcodeArktsPerfTest.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --reposRoot=<path>             Override projectConfig.projectPath');
  console.log('  --outputDir=<path>             Output report root');
  console.log('  --baseProjectConfig=<path>     Base projectConfig.json');
  console.log('  --baseRuleConfig=<path>        Base ruleConfig JSON used for files/ignore/packagePath');
  console.log('  --runnerPath=<path>            homecheck runner JS path');
  console.log('  --npmCacheDir=<path>           npm cache dir for homecheck');
  console.log('  --includeRepos=a,b             Override projectConfig.includeRepos');
  console.log('  --extraRepos=name=target,...   Extra perf-only repos; target = local dir or git URL');
  console.log('  --includeRules=a,b             Only run selected smell names');
  console.log('  --updateExisting=true          Run git pull --ff-only when a repo already exists');
  console.log('  --cloneDepth=1                 git clone depth, use 0 for full clone');
  console.log('  --timeoutMs=<n>                Timeout for each repository run');
  console.log('  --nodeMaxOldSpaceMB=<n>        Child homecheck Node heap limit (default 8192)');
  console.log('  --dashboard=false              Disable live HTTP dashboard (final HTML is still written)');
  console.log('  --dashboardPort=<n>            Dashboard port, default 0 selects a free local port');
  console.log('  --perf=false                   Disable CLOC and performance collection (enabled by default)');
  console.log('  --f1=false                     Disable dataset F1 evaluation');
  console.log('  --datasetDir=<path>            Override projectConfig.datasetDir; empty config disables F1');
  console.log('  --f1Repos=a,b                  Only run selected dataset repository names');
}

function toDashboardRun(repoName, run) {
  return {
    id: `${repoName}/${run.smell}`,
    kind: 'scan',
    repoName,
    smell: run.smell,
    success: run.success,
    timedOut: run.timedOut,
    durationMs: run.detectorDurationMs,
    detectorDurationMs: run.detectorDurationMs,
    issueMessages: run.issueMessages,
    throughputWanLinesPerSecond: run.throughputWanLinesPerSecond,
    // 峰值内存为仓库级共享（同一仓库的全部规则在同一进程内检测）
    peakRssMB: run.peakRssMB,
  };
}

function toDashboardRepositoryRun(repoName, sharedRun, etsLines, timing = {}) {
  const memorySamples = readMemoryTimeline(sharedRun.memoryTimelinePath);
  const sampledPeakRssMB = Math.max(0, ...memorySamples.map((sample) => Number(sample.rssMB) || 0));
  return {
    id: repoName,
    kind: 'repository',
    repoName,
    success: sharedRun.success,
    timedOut: sharedRun.timedOut,
    durationMs: sharedRun.durationMs,
    homecheckWallMs: sharedRun.homecheckWallMs,
    // 预处理耗时 = 端到端总耗时 - 各规则检测耗时合计（进程启动、Scene 构建等共享开销）
    preprocessingMs: timing.preprocessingMs ?? null,
    // 分析耗时 = 全部选中规则的检测耗时合计
    analysisMs: timing.analysisMs ?? null,
    peakRssMB: Math.max(sharedRun.peakRssMB, sampledPeakRssMB),
    etsLines,
    rules: sharedRun.rules,
    memorySamples,
  };
}

function snapshotDashboardState(state) {
  let current = state.current;
  if (current && current.kind === 'scan') {
    const memorySamples = readMemoryTimeline(current.memoryTimelinePath);
    current = {
      ...current,
      elapsedMs: Date.now() - current.startedMs,
      peakRssMB: Math.max(0, ...memorySamples.map((sample) => Number(sample.rssMB) || 0)),
      memorySamples,
    };
    delete current.startedMs;
    delete current.memoryTimelinePath;
  }
  return {
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    totalRuns: state.totalRuns,
    current,
    runs: state.runs,
    repositoryRuns: state.repositoryRuns,
    f1: state.f1 || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true') {
    printUsage();
    return 0;
  }

  const cwd = process.cwd();
  const projectRoot = path.resolve(__dirname, '..');
  const startedAt = new Date().toISOString();
  const wallStart = Date.now();
  const outputDir = path.resolve(cwd, args.outputDir || './report/.perftest/gitcode_arkts_smell_perf');
  const tmpConfigDir = path.join(outputDir, '.tmp');
  const baseProjectConfigPath = args.baseProjectConfig
    ? path.resolve(cwd, args.baseProjectConfig)
    : path.join(projectRoot, 'config', 'projectConfig.json');
  const baseRuleConfigPath = args.baseRuleConfig
    ? path.resolve(cwd, args.baseRuleConfig)
    : path.join(projectRoot, 'config', 'ruleConfig.json');
  const packagePath = path.join(projectRoot, 'extrulesproject-1.0.0.tgz');
  const npmCacheDir = path.resolve(cwd, args.npmCacheDir || './report/.npm-cache');
  const timeoutMs = args.timeoutMs ? Number(args.timeoutMs) : 30 * 60 * 1000;
  const nodeMaxOldSpaceMB = args.nodeMaxOldSpaceMB ? Number(args.nodeMaxOldSpaceMB) : 8192;
  const includeRules = args.includeRules ? new Set(args.includeRules.split(',').filter(Boolean)) : null;
  const updateExisting = args.updateExisting === 'true';
  const dashboardEnabled = args.dashboard !== 'false';
  const dashboardPort = args.dashboardPort ? Number(args.dashboardPort) : 0;
  const perfEnabled = args.perf !== 'false';

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`timeoutMs should be a positive number, got: ${args.timeoutMs}`);
  }
  if (!Number.isFinite(nodeMaxOldSpaceMB) || nodeMaxOldSpaceMB <= 0) {
    throw new Error(`nodeMaxOldSpaceMB should be a positive number, got: ${args.nodeMaxOldSpaceMB}`);
  }
  if (!Number.isInteger(dashboardPort) || dashboardPort < 0 || dashboardPort > 65535) {
    throw new Error(`dashboardPort should be an integer from 0 to 65535, got: ${args.dashboardPort}`);
  }
  for (const requiredPath of [baseProjectConfigPath, baseRuleConfigPath, packagePath]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Required path does not exist: ${requiredPath}`);
    }
  }

  const baseProjectConfig = readJson(baseProjectConfigPath, {});
  const baseRuleConfig = readJson(baseRuleConfigPath, {});
  const configuredArkCheckPath = typeof baseProjectConfig.arkCheckPath === 'string'
    ? baseProjectConfig.arkCheckPath.trim()
    : '';
  const arkCheckPath = path.resolve(
    cwd,
    configuredArkCheckPath || path.join(projectRoot, 'node_modules', 'homecheck'),
  );
  const runnerPath = args.runnerPath
    ? path.resolve(cwd, args.runnerPath)
    : path.join(arkCheckPath, 'lib', 'run.js');
  if (!fs.existsSync(arkCheckPath)) {
    throw new Error(`Required path does not exist: ${arkCheckPath}`);
  }
  if (!fs.existsSync(runnerPath)) {
    throw new Error(`Required path does not exist: ${runnerPath}`);
  }
  const configuredProjectPath = typeof baseProjectConfig.projectPath === 'string'
    ? baseProjectConfig.projectPath.trim()
    : '';
  const reposRoot = path.resolve(
    cwd,
    args.reposRoot || configuredProjectPath || './report/.perftest/gitcode_arkts_repos',
  );
  const includeRepos = args.includeRepos !== undefined
    ? parseRepoFilter(args.includeRepos)
    : parseRepoFilter(baseProjectConfig.includeRepos);
  const configuredDatasetDir = typeof baseProjectConfig.datasetDir === 'string'
    ? baseProjectConfig.datasetDir.trim()
    : '';
  const datasetDirValue = args.datasetDir !== undefined
    ? String(args.datasetDir).trim()
    : configuredDatasetDir;
  const f1Requested = args.f1 !== 'false' && datasetDirValue.length > 0;

  if (!perfEnabled && !f1Requested) {
    throw new Error('No task enabled: enable performance collection or configure a dataset for F1');
  }

  ensureDir(outputDir);
  ensureDir(tmpConfigDir);
  ensureDir(npmCacheDir);

  const repositories = [];
  const f1RepoResults = [];
  const selectedRules = RULE_ORDER.filter((rule) => !includeRules || includeRules.has(rule.smell));
  const selectedRepos = REPOSITORIES.filter((repo) => !includeRepos || includeRepos.has(repo.name));
  const extraRepos = [
    ...parseExtraRepos(baseProjectConfig.extraRepos),
    ...parseExtraRepos(args.extraRepos),
  ];
  for (const extra of extraRepos) {
    if (extra.localPath && !fs.existsSync(path.resolve(cwd, extra.localPath))) {
      throw new Error(`extraRepos 本地路径不存在: ${extra.localPath}`);
    }
  }

  // 基准仓库只采集性能数据；数据集仓库（arkts-code-smell 标注涉及的仓库）在此基础上参与 F1 评估（默认开启）。
  const datasetDir = datasetDirValue ? path.resolve(cwd, datasetDirValue) : null;
  const f1ReposFilter = args.f1Repos ? new Set(args.f1Repos.split(',').filter(Boolean)) : null;
  let groundTruth = null;
  let datasetRepos = [];
  if (f1Requested && selectedRules.length > 0) {
    if (!fs.existsSync(datasetDir)) {
      console.log(`[dataset] 数据集目录不存在，跳过数据集仓库与 F1 评估: ${datasetDir}`);
    } else {
      try {
        groundTruth = loadGroundTruth(datasetDir, selectedRules.map((rule) => rule.ruleName));
        datasetRepos = buildDatasetRepos(groundTruth.repoNames)
          .filter((repo) => !includeRepos || includeRepos.has(repo.name))
          .filter((repo) => !f1ReposFilter || f1ReposFilter.has(repo.name));
        console.log(
          `[dataset] 加载标注: ${groundTruth.positives.length} 正例 / ${groundTruth.negatives.length} 负例, ` +
          `${datasetRepos.length} 个数据集仓库`,
        );
      } catch (error) {
        console.log(`[dataset] 加载数据集标注失败，跳过数据集仓库与 F1 评估: ${error instanceof Error ? error.message : error}`);
        groundTruth = null;
        datasetRepos = [];
      }
    }
  }
  // 数据集仓库与基准仓库可能同名不同源（如 agc-template-market-harmonyos-demos），
  // 隔离到 reposRoot/dataset 下；同名时以数据集版本为准（F1 标注基于它），
  // 基准组自动跳过，避免同一仓库被扫描两遍、性能面板出现重复条目。
  const datasetReposRoot = reposRoot;
  const datasetRepoNames = new Set(datasetRepos.map((repo) => repo.name));
  const benchmarkRepos = selectedRepos.filter((repo) => {
    if (!datasetRepoNames.has(repo.name)) {
      return true;
    }
    console.log(`[repo] ${repo.name} 与数据集仓库同名，跳过基准组，仅扫描数据集版本`);
    return false;
  });
  // 额外仓库（--extraRepos）按基准组处理，与已有仓库同名时跳过，避免重复扫描
  const extraWorkItems = [];
  for (const extra of extraRepos) {
    if (datasetRepoNames.has(extra.name) || benchmarkRepos.some((repo) => repo.name === extra.name)) {
      console.log(`[repo] ${extra.name} 已在扫描列表中，跳过 --extraRepos 重复项`);
      continue;
    }
    extraWorkItems.push({
      repo: { name: extra.name, url: extra.url || path.resolve(cwd, extra.localPath) },
      group: 'benchmark',
      cloneRoot: reposRoot,
      localPath: extra.localPath ? path.resolve(cwd, extra.localPath) : null,
    });
  }
  // 数据集仓库优先（F1 结果尽早产出），纯性能基准仓库（含大仓库与 --extraRepos）排到最后
  const repoWorkItems = [
    ...datasetRepos.map((repo) => ({ repo, group: 'dataset', cloneRoot: datasetReposRoot })),
    ...benchmarkRepos.map((repo) => ({ repo, group: 'benchmark', cloneRoot: reposRoot })),
    ...extraWorkItems,
  ];
  const dashboardState = {
    status: 'running',
    startedAt,
    finishedAt: null,
    totalRuns: repoWorkItems.length,
    current: null,
    runs: [],
    repositoryRuns: [],
    f1: null,
  };
  let dashboardServer = null;
  if (dashboardEnabled) {
    dashboardServer = await startDashboardServer({
      port: dashboardPort,
      getState: () => snapshotDashboardState(dashboardState),
    });
    console.log(`Live dashboard: ${dashboardServer.url}`);
  }

  const perfReportPath = path.join(outputDir, 'perfReport.json');
  const summaryPath = path.join(outputDir, 'summary.json');
  const markdownPath = path.join(outputDir, 'perfReport.md');
  const dashboardPath = path.join(outputDir, 'perfDashboard.html');
  const f1ReportPath = path.join(outputDir, 'f1Report.json');
  const f1MarkdownPath = path.join(outputDir, 'f1Report.md');
  let failure = null;

  try {
    for (const workItem of repoWorkItems) {
      const { repo, group, cloneRoot, localPath } = workItem;
      dashboardState.current = { kind: 'setup', label: `准备仓库 ${repo.name}` };
      console.log(`[repo] ${repo.name} (${group})`);
      const cloneResult = localPath
        ? { path: localPath, durationMs: 0, action: 'local' }
        : await cloneOrUpdateRepository(repo, cloneRoot, {
          updateExisting,
          cloneDepth: args.cloneDepth || '1',
        });
      const etsLines = perfEnabled ? await countEtsLinesWithCloc(cloneResult.path) : 0;
      const repoResult = {
        name: repo.name,
        url: repo.url,
        path: cloneResult.path,
        cloneAction: cloneResult.action,
        cloneDurationMs: cloneResult.durationMs,
        etsLines,
        group,
        runs: [],
      };
      repositories.push(repoResult);

      if (selectedRules.length > 0) {
        const memoryTimelinePath = path.join(outputDir, 'runs', repo.name, 'memoryTimeline.ndjson');
        dashboardState.current = {
          id: repo.name,
          kind: 'scan',
          repoName: repo.name,
          smell: selectedRules.map((rule) => rule.smell).join(', '),
          startedMs: Date.now(),
          memoryTimelinePath,
        };
        console.log(`  [scan] ${selectedRules.map((rule) => rule.smell).join(', ')}`);
        const result = await runRepositoryScan({
          cwd,
          repo,
          repoPath: cloneResult.path,
          rules: selectedRules,
          etsLines,
          baseProjectConfig,
          baseRuleConfig,
          runnerPath,
          outputDir,
          tmpConfigDir,
          npmCacheDir,
          timeoutMs,
          nodeMaxOldSpaceMB,
          packagePath,
          arkCheckPath,
          perfEnabled,
        });
        repoResult.sharedRun = result.sharedRun;
        repoResult.runs.push(...result.runs);
        const analysisMs = perfEnabled ? result.runs.reduce(
          (sum, run) => sum + (Number(run.detectorDurationMs) || 0),
          0,
        ) : 0;
        // 预处理耗时 = 端到端总耗时 − 各规则检测耗时合计。
        // PerfReporter 随规则包加载才启动计时，其 totalWallMs 不含 Scene 构建，
        // 因此预处理必须用最外层进程墙钟时间倒推（含进程启动、Scene 构建等共享开销）。
        const preprocessingMs = perfEnabled
          ? Math.max(0, result.sharedRun.durationMs - analysisMs)
          : null;
        dashboardState.runs.push(...result.runs.map((run) => toDashboardRun(repo.name, run)));
        dashboardState.repositoryRuns.push(
          toDashboardRepositoryRun(repo.name, result.sharedRun, etsLines, { preprocessingMs, analysisMs }),
        );
        if (group === 'dataset' && f1Requested && groundTruth && result.sharedRun.success) {
          const issues = readJson(result.sharedRun.issuesReportPath, []);
          const ruleComparison = compareRepo({
            issues,
            repoName: repo.name,
            repoPath: cloneResult.path,
            targets: [...groundTruth.positives, ...groundTruth.negatives],
            labeledFiles: groundTruth.labeledFilesByRepo.get(repo.name) || new Set(),
            ruleNames: selectedRules.map((rule) => rule.ruleName),
          });
          f1RepoResults.push({ repoName: repo.name, rules: ruleComparison });
          dashboardState.f1 = summarizeF1(f1RepoResults, selectedRules);
          for (const rule of selectedRules) {
            const counts = ruleComparison[rule.ruleName];
            const metrics = computeMetrics(counts);
            console.log(
              `      [f1] ${rule.smell}: tp=${counts.tp} fp=${counts.fp} fn=${counts.fn} tn=${counts.tn}, ` +
              `P=${formatPercent(metrics.precision)} R=${formatPercent(metrics.recall)} ` +
              `F1=${formatPercent(metrics.f1)}`,
            );
          }
        }
        console.log(`    ${result.sharedRun.success ? 'done' : 'failed'} ${result.sharedRun.durationMs}ms`);
        if (perfEnabled) {
          console.log(`      sceneShared=true, peakRssMB=${formatNumber(result.sharedRun.peakRssMB)}`);
          for (const run of result.runs) {
            console.log(
              `      ${run.smell}: detector=${formatNumber(run.detectorDurationMs)}ms, ` +
              `throughput=${formatNumber(run.throughputWanLinesPerSecond, 4)} wan lines/s`,
            );
          }
        }
      }
      dashboardState.current = null;
    }
    dashboardState.status = 'completed';
  } catch (error) {
    failure = error;
    dashboardState.status = 'failed';
  } finally {
    dashboardState.current = null;
    dashboardState.finishedAt = new Date().toISOString();
    const report = {
      startedAt,
      finishedAt: dashboardState.finishedAt,
      totalWallMs: Date.now() - wallStart,
      perfEnabled,
      reposRoot,
      outputDir,
      repositories,
    };
    writeJson(summaryPath, report);
    if (perfEnabled) {
      writeJson(perfReportPath, buildAggregatePerfReport(report));
      fs.writeFileSync(markdownPath, buildMarkdown(report));
    }
    fs.writeFileSync(dashboardPath, buildDashboardHtml(snapshotDashboardState(dashboardState)));
    if (f1Requested && groundTruth && f1RepoResults.length > 0) {
      const f1Report = {
        generatedAt: dashboardState.finishedAt,
        datasetDir,
        datasetRepos: datasetRepos.map((repo) => repo.name),
        rules: selectedRules.map(({ ruleName, smell }) => ({ ruleName, smell })),
        summary: summarizeF1(f1RepoResults, selectedRules),
        repoResults: f1RepoResults,
      };
      writeJson(f1ReportPath, f1Report);
      fs.writeFileSync(f1MarkdownPath, buildF1Markdown(f1Report));
    }
    if (dashboardServer) {
      // 宽限几秒让实时面板拉取最终状态，避免页面定格在中间进度并显示"连接中断"
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await dashboardServer.close();
    }
  }

  if (failure) {
    throw failure;
  }

  console.log('');
  console.log(`Summary: ${summaryPath}`);
  if (perfEnabled) {
    console.log(`Perf report: ${perfReportPath}`);
    console.log(`Markdown: ${markdownPath}`);
  }
  console.log(`Dashboard: ${dashboardPath}`);
  if (f1Requested && groundTruth && f1RepoResults.length > 0) {
    console.log(`F1 report: ${f1ReportPath}`);
    console.log(`F1 markdown: ${f1MarkdownPath}`);
  }
  return 0;
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  REPOSITORIES,
  RULES,
  RULE_ORDER,
  buildAggregatePerfReport,
  buildMarkdown,
  buildMultiRuleConfig,
  buildNodeOptions,
  computeThroughput,
  computeThroughputWan,
  countIssues,
  filterIssuesByRule,
  main,
  parseArgs,
  parseExtraRepos,
  parseRepoFilter,
  readMemoryTimeline,
  resolveClocInvocation,
  runRepositoryScan,
  snapshotDashboardState,
};
