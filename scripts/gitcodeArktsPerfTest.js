#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
  },
  featureEnvy: {
    smell: 'feature-envy',
    ruleName: '@extrulesproject/feature-envy-check',
  },
  longMethod: {
    smell: 'long-method',
    ruleName: '@extrulesproject/long-method-check',
  },
  switchStatement: {
    smell: 'switch-statement',
    ruleName: '@extrulesproject/switch-statement-check',
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

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    timeout: options.timeout,
    killSignal: options.killSignal,
  });
  if (result.status !== 0 || result.error) {
    const rendered = [command, ...args].join(' ');
    const stdout = result.stdout ? `\nstdout:\n${result.stdout}` : '';
    const stderr = result.stderr ? `\nstderr:\n${result.stderr}` : '';
    const errMessage = result.error ? `\nerror: ${result.error.message}` : '';
    throw new Error(`Command failed (${result.status}): ${rendered}${errMessage}${stdout}${stderr}`);
  }
  return result.stdout || '';
}

function cloneOrUpdateRepository(repo, reposRoot, options = {}) {
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
    runCommand('git', cloneArgs, { stdio: options.stdio || 'inherit' });
    return { path: repoPath, durationMs: Date.now() - started, action: 'cloned' };
  }

  if (options.updateExisting && fs.existsSync(path.join(repoPath, '.git'))) {
    runCommand('git', ['-C', repoPath, 'pull', '--ff-only'], {
      stdio: options.stdio || 'inherit',
    });
    return { path: repoPath, durationMs: Date.now() - started, action: 'updated' };
  }

  return { path: repoPath, durationMs: Date.now() - started, action: 'reused' };
}

function countEtsLinesWithCloc(repoPath) {
  const output = runCommand('cloc', [
    repoPath,
    '--json',
    '--quiet',
    '--include-ext=ets',
    '--force-lang=TypeScript,ets',
    `--exclude-dir=${CLOC_EXCLUDE_DIRS}`,
  ]);
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Failed to parse cloc JSON output for ${repoPath}`);
  }
  const parsed = JSON.parse(output.slice(start, end + 1));
  return Number(parsed.SUM && parsed.SUM.code) || 0;
}

function buildSingleRuleConfig(baseConfig, rule) {
  const baseExtRuleSet = Array.isArray(baseConfig.extRuleSet)
    ? baseConfig.extRuleSet
    : [];
  const baseRuleSet = baseExtRuleSet[0] || {
    ruleSetName: 'extrulesproject',
    packagePath: path.resolve(process.cwd(), 'extrulesproject-1.0.0.tgz'),
  };
  return {
    ...baseConfig,
    extRuleSet: [{
      ...baseRuleSet,
      extRules: {
        [rule.ruleName]: 2,
      },
    }],
  };
}

function buildProjectConfig(baseProjectConfig, repoName, repoPath, reportDir) {
  return {
    ...baseProjectConfig,
    projectName: repoName,
    projectPath: ensureTrailingSeparator(path.resolve(repoPath)),
    reportDir,
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

function computeThroughput(lines, durationMs) {
  if (!Number.isFinite(lines) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }
  return Math.round((lines / (durationMs / 1000)) * 100) / 100;
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

function runRuleScan(context) {
  const {
    cwd,
    repo,
    repoPath,
    rule,
    etsLines,
    baseProjectConfig,
    baseRuleConfig,
    runnerPath,
    outputDir,
    tmpConfigDir,
    npmCacheDir,
    timeoutMs,
    nodeMaxOldSpaceMB,
  } = context;

  const runDir = path.join(outputDir, 'runs', repo.name, rule.smell);
  const reportDir = path.join(runDir, 'homecheck-report');
  const tempProjectConfigPath = path.join(
    tmpConfigDir,
    `projectConfig.${toSafeName(repo.name)}.${rule.smell}.json`,
  );
  const tempRuleConfigPath = path.join(
    tmpConfigDir,
    `ruleConfig.${toSafeName(repo.name)}.${rule.smell}.json`,
  );
  const generatedIssuesPath = path.join(reportDir, 'issuesReport.json');
  const fallbackIssuesPath = path.join(cwd, 'report', 'issuesReport.json');
  const generatedPerfPath = path.join(cwd, 'report', 'perfReport.json');
  const savedIssuesPath = path.join(runDir, 'issuesReport.json');
  const savedPerfPath = path.join(runDir, 'perfReport.json');

  ensureDir(runDir);
  ensureDir(reportDir);
  writeJson(
    tempProjectConfigPath,
    buildProjectConfig(baseProjectConfig, `${repo.name}__${rule.smell}`, repoPath, reportDir),
  );
  writeJson(tempRuleConfigPath, buildSingleRuleConfig(baseRuleConfig, rule));

  removeIfExists(generatedIssuesPath);
  removeIfExists(fallbackIssuesPath);
  removeIfExists(generatedPerfPath);
  removeIfExists(savedIssuesPath);
  removeIfExists(savedPerfPath);

  const started = Date.now();
  const result = spawnSync(
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
        EXTRULES_PERF: '1',
        NODE_OPTIONS: buildNodeOptions(process.env.NODE_OPTIONS, nodeMaxOldSpaceMB),
        npm_config_cache: npmCacheDir,
        NPM_CONFIG_CACHE: npmCacheDir,
      },
    },
  );
  const durationMs = Date.now() - started;
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');

  const copiedIssues =
    copyIfExists(generatedIssuesPath, savedIssuesPath) ||
    copyIfExists(fallbackIssuesPath, savedIssuesPath);
  const copiedPerf = copyIfExists(generatedPerfPath, savedPerfPath);
  const issues = readJson(savedIssuesPath, []);
  const issueCounts = countIssues(issues);
  const perf = readJson(savedPerfPath, {});
  const peakHeapMB = Number(perf.peakHeapUsedMB) || 0;

  return {
    smell: rule.smell,
    ruleName: rule.ruleName,
    success: result.status === 0 && copiedIssues && copiedPerf && !timedOut,
    exitCode: result.status,
    signal: result.signal,
    timedOut,
    durationMs,
    issueObjects: issueCounts.issueObjects,
    issueMessages: issueCounts.issueMessages,
    throughputLinesPerSecond: computeThroughput(etsLines, durationMs),
    peakHeapMB,
    issuesReportPath: savedIssuesPath,
    perfReportPath: savedPerfPath,
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push('# ArkTS 异味检测性能报告');
  lines.push('');
  lines.push(`- 开始时间: ${report.startedAt}`);
  lines.push(`- 结束时间: ${report.finishedAt}`);
  lines.push(`- 输出目录: ${report.outputDir}`);
  lines.push('');
  lines.push('| 仓库 | .ets 代码行数 | 异味类型 | 外层脚本耗时 (s) | 告警对象数 | 告警指标数 | 端到端吞吐 (行/s) | peakHeapMB |');
  lines.push('| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const repo of report.repositories) {
    for (const run of repo.runs) {
      lines.push([
        `| ${repo.name}`,
        String(repo.etsLines),
        run.smell,
        formatNumber(run.durationMs / 1000),
        String(run.issueObjects),
        String(run.issueMessages),
        formatNumber(run.throughputLinesPerSecond),
        `${formatNumber(run.peakHeapMB)} |`,
      ].join(' | '));
    }
  }
  lines.push('');
  lines.push('## 输入仓库');
  lines.push('');
  lines.push('| 仓库 | URL | 本地路径 | 克隆/更新时间 (s) |');
  lines.push('| --- | --- | --- | ---: |');
  for (const repo of report.repositories) {
    lines.push(`| ${repo.name} | ${repo.url} | ${repo.path} | ${formatNumber(repo.cloneDurationMs / 1000)} |`);
  }
  return `${lines.join('\n')}\n`;
}

function buildAggregatePerfReport(report) {
  const checkers = {};
  for (const repo of report.repositories) {
    for (const run of repo.runs) {
      checkers[`${repo.name}/${run.smell}`] = {
        totalMs: run.durationMs,
        stages: {
          endToEnd: {
            count: 1,
            totalMs: run.durationMs,
            avgMs: run.durationMs,
            minMs: run.durationMs,
            maxMs: run.durationMs,
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
      ...report.repositories.flatMap((repo) => repo.runs.map((run) => run.peakHeapMB)),
    ),
    peakRssMB: 0,
    checkers,
    repositories: report.repositories,
  };
}

function printUsage() {
  console.log('Usage: node ./scripts/gitcodeArktsPerfTest.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --reposRoot=<path>             Clone/reuse repositories here');
  console.log('  --outputDir=<path>             Output report root');
  console.log('  --baseProjectConfig=<path>     Base projectConfig.json');
  console.log('  --baseRuleConfig=<path>        Base ruleConfig JSON used for files/ignore/packagePath');
  console.log('  --runnerPath=<path>            homecheck runner JS path');
  console.log('  --npmCacheDir=<path>           npm cache dir for homecheck');
  console.log('  --includeRepos=a,b             Only run selected repository names');
  console.log('  --includeRules=a,b             Only run selected smell names');
  console.log('  --updateExisting=true          Run git pull --ff-only when a repo already exists');
  console.log('  --cloneDepth=1                 git clone depth, use 0 for full clone');
  console.log('  --timeoutMs=<n>                Timeout for each smell run');
  console.log('  --nodeMaxOldSpaceMB=<n>        Child homecheck Node heap limit (default 8192)');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true') {
    printUsage();
    return 0;
  }

  const cwd = process.cwd();
  const startedAt = new Date().toISOString();
  const wallStart = Date.now();
  const reposRoot = path.resolve(cwd, args.reposRoot || './report/.perftest/gitcode_arkts_repos');
  const outputDir = path.resolve(cwd, args.outputDir || './report/.perftest/gitcode_arkts_smell_perf');
  const tmpConfigDir = path.join(outputDir, '.tmp');
  const baseProjectConfigPath = path.resolve(cwd, args.baseProjectConfig || './config/projectConfig.json');
  const baseRuleConfigPath = path.resolve(cwd, args.baseRuleConfig || './config/ruleConfig.perfAll.json');
  const runnerPath = path.resolve(cwd, args.runnerPath || './node_modules/homecheck/lib/run.js');
  const npmCacheDir = path.resolve(cwd, args.npmCacheDir || './report/.npm-cache');
  const timeoutMs = args.timeoutMs ? Number(args.timeoutMs) : 30 * 60 * 1000;
  const nodeMaxOldSpaceMB = args.nodeMaxOldSpaceMB ? Number(args.nodeMaxOldSpaceMB) : 8192;
  const includeRepos = args.includeRepos ? new Set(args.includeRepos.split(',').filter(Boolean)) : null;
  const includeRules = args.includeRules ? new Set(args.includeRules.split(',').filter(Boolean)) : null;
  const updateExisting = args.updateExisting === 'true';

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`timeoutMs should be a positive number, got: ${args.timeoutMs}`);
  }
  if (!Number.isFinite(nodeMaxOldSpaceMB) || nodeMaxOldSpaceMB <= 0) {
    throw new Error(`nodeMaxOldSpaceMB should be a positive number, got: ${args.nodeMaxOldSpaceMB}`);
  }
  for (const requiredPath of [baseProjectConfigPath, baseRuleConfigPath, runnerPath]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Required path does not exist: ${requiredPath}`);
    }
  }

  ensureDir(outputDir);
  ensureDir(tmpConfigDir);
  ensureDir(npmCacheDir);

  const baseProjectConfig = readJson(baseProjectConfigPath, {});
  const baseRuleConfig = readJson(baseRuleConfigPath, {});
  const repositories = [];
  const selectedRepos = REPOSITORIES.filter((repo) => !includeRepos || includeRepos.has(repo.name));
  const selectedRules = RULE_ORDER.filter((rule) => !includeRules || includeRules.has(rule.smell));

  for (const repo of selectedRepos) {
    console.log(`[repo] ${repo.name}`);
    const cloneResult = cloneOrUpdateRepository(repo, reposRoot, {
      updateExisting,
      cloneDepth: args.cloneDepth || '1',
    });
    const etsLines = countEtsLinesWithCloc(cloneResult.path);
    const repoResult = {
      name: repo.name,
      url: repo.url,
      path: cloneResult.path,
      cloneAction: cloneResult.action,
      cloneDurationMs: cloneResult.durationMs,
      etsLines,
      runs: [],
    };

    for (const rule of selectedRules) {
      console.log(`  [scan] ${rule.smell}`);
      const run = runRuleScan({
        cwd,
        repo,
        repoPath: cloneResult.path,
        rule,
        etsLines,
        baseProjectConfig,
        baseRuleConfig,
        runnerPath,
        outputDir,
        tmpConfigDir,
        npmCacheDir,
        timeoutMs,
        nodeMaxOldSpaceMB,
      });
      repoResult.runs.push(run);
      console.log(
        `    ${run.success ? 'done' : 'failed'} ${run.durationMs}ms, ` +
        `issues=${run.issueObjects}, messages=${run.issueMessages}, ` +
        `throughput=${formatNumber(run.throughputLinesPerSecond)} lines/s, ` +
        `peakHeapMB=${formatNumber(run.peakHeapMB)}`,
      );
    }
    repositories.push(repoResult);
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    totalWallMs: Date.now() - wallStart,
    reposRoot,
    outputDir,
    repositories,
  };
  const aggregatePerfReport = buildAggregatePerfReport(report);
  const perfReportPath = path.join(outputDir, 'perfReport.json');
  const summaryPath = path.join(outputDir, 'summary.json');
  const markdownPath = path.join(outputDir, 'perfReport.md');

  writeJson(perfReportPath, aggregatePerfReport);
  writeJson(summaryPath, report);
  fs.writeFileSync(markdownPath, buildMarkdown(report));

  console.log('');
  console.log(`Perf report: ${perfReportPath}`);
  console.log(`Summary: ${summaryPath}`);
  console.log(`Markdown: ${markdownPath}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  }
}

module.exports = {
  REPOSITORIES,
  RULES,
  RULE_ORDER,
  buildAggregatePerfReport,
  buildMarkdown,
  buildNodeOptions,
  buildSingleRuleConfig,
  computeThroughput,
  countIssues,
  main,
  parseArgs,
};
