#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
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

const CLOC_EXCLUDE_DIR_NAMES = new Set([
  '.git',
  'ohosTest',
  'test',
  'node_modules',
  'build',
  'hvigorfile',
  'oh_modules',
  '.preview',
]);

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

function parseFileSelectors(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return values
    .map((item) => item.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(Boolean);
}

function resolveSelectedFiles(repoPath, relativeFiles) {
  if (!relativeFiles) {
    return null;
  }
  const root = path.resolve(repoPath);
  const seen = new Set();
  return relativeFiles.map((relativeFile) => {
    if (path.isAbsolute(relativeFile) || !/\.(?:ets|ts)$/i.test(relativeFile)) {
      throw new Error(`指定文件必须是仓库内的 .ets/.ts 相对路径: ${relativeFile}`);
    }
    const absolute = path.resolve(root, ...relativeFile.split('/'));
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`指定文件越出仓库目录或不是文件: ${relativeFile}`);
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new Error(`指定文件不存在: ${path.join(repoPath, relativeFile)}`);
    }
    const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    if (seen.has(key)) {
      throw new Error(`指定文件重复: ${relativeFile}`);
    }
    seen.add(key);
    return { relativePath: relative.split(path.sep).join('/'), absolutePath: absolute };
  });
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

/**
 * 统一仓库配置：name 表示 reposRoot/name，name=target 表示显式本地路径或 Git URL。
 * 同时兼容 { name: target } 对象格式。
 */
function parseRepos(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const repos = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      const text = item.trim();
      const eqIndex = text.indexOf('=');
      if (eqIndex === -1) {
        repos.push({ name: text });
        continue;
      }
      const name = text.slice(0, eqIndex).trim();
      const target = text.slice(eqIndex + 1).trim();
      if (!name || !target) {
        throw new Error(`repos 路径条目必须使用 仓库名=本地路径或git地址 格式: ${text}`);
      }
      repos.push(GIT_URL_PATTERN.test(target)
        ? { name, url: target }
        : { name, localPath: target });
      continue;
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const [rawName, rawTarget] of Object.entries(item)) {
        const name = String(rawName).trim();
        const target = String(rawTarget || '').trim();
        if (!name || !target) {
          throw new Error(`repos 对象必须使用 { "仓库名": "本地路径或git地址" } 格式`);
        }
        repos.push(GIT_URL_PATTERN.test(target)
          ? { name, url: target }
          : { name, localPath: target });
      }
      continue;
    }
    throw new Error(`repos 条目必须是 仓库名、仓库名=路径，或 { "仓库名": "路径" }`);
  }
  return repos;
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
    await runCommand('git', cloneArgs, {
      stdio: options.stdio || 'inherit',
      // Source analysis does not need binary LFS payloads. Avoid an apparently
      // finished clone waiting silently in the Git LFS smudge filter.
      env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' },
    });
    return { path: repoPath, durationMs: Date.now() - started, action: 'cloned' };
  }

  if (options.updateExisting && fs.existsSync(path.join(repoPath, '.git'))) {
    await runCommand('git', ['-C', repoPath, 'pull', '--ff-only'], {
      stdio: options.stdio || 'inherit',
      env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' },
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

async function collectArkTsFiles(repoPath, directoryConcurrency = 32) {
  let pendingDirectories = [repoPath];
  const files = [];

  while (pendingDirectories.length > 0) {
    const batch = pendingDirectories.splice(0, directoryConcurrency);
    const entriesByDirectory = await Promise.all(batch.map(async (directory) => ({
      directory,
      entries: await fs.promises.readdir(directory, { withFileTypes: true }),
    })));

    for (const { directory, entries } of entriesByDirectory) {
      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          continue;
        }
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!CLOC_EXCLUDE_DIR_NAMES.has(entry.name)) {
            pendingDirectories.push(absolutePath);
          }
        } else if (entry.isFile() && /\.(?:ets|ts)$/i.test(entry.name)) {
          files.push(path.relative(repoPath, absolutePath).split(path.sep).join('/'));
        }
      }
    }
  }

  files.sort();
  return files;
}

async function countEtsLinesWithCloc(repoPath, selectedFiles = null) {
  const clocInvocation = resolveClocInvocation();
  const arkTsFiles = selectedFiles
    ? selectedFiles.map((file) => file.relativePath)
    : await collectArkTsFiles(repoPath);
  if (arkTsFiles.length === 0) {
    return 0;
  }

  // Let Node enumerate large/complex directory trees. CLOC's Windows build
  // can misparse nested directory output; --list-file makes it process only
  // the already selected .ets/.ts files and avoids a second recursive walk.
  // Keep staged paths short. The bundled Perl-based Windows cloc cannot open
  // many valid repository paths once their absolute length approaches MAX_PATH.
  const listDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloc-arkts-'));
  // cloc-2.10.exe on Windows exhausts its internal file handles when one
  // --list-file contains thousands of inputs. Process bounded batches and
  // sum the exact same CLOC code-line totals.
  const batchSize = 2000;
  let totalCodeLines = 0;
  try {
    for (let offset = 0; offset < arkTsFiles.length; offset += batchSize) {
      const batch = arkTsFiles.slice(offset, offset + batchSize);
      const stageDirectory = path.join(listDirectory, 'stage');
      fs.rmSync(stageDirectory, { recursive: true, force: true });
      fs.mkdirSync(stageDirectory);
      const stagedFiles = batch.map((relativePath, index) => {
        const extension = path.extname(relativePath).toLowerCase() === '.ets' ? '.ets' : '.ts';
        const stagedName = `${index}${extension}`;
        fs.copyFileSync(path.join(repoPath, ...relativePath.split('/')), path.join(stageDirectory, stagedName));
        return stagedName;
      });
      const listPath = path.join(listDirectory, `files-${offset / batchSize}.txt`);
      fs.writeFileSync(listPath, `${stagedFiles.join('\n')}\n`, 'utf8');
      const output = await runCommand(clocInvocation.command, [
        ...clocInvocation.prefixArgs,
        `--list-file=${listPath}`,
        '--json',
        '--quiet',
        // HomeCheck scans every source file, including identical copies in
        // different sample projects; keep the throughput denominator aligned.
        '--skip-uniqueness',
        // CLOC knows .ts as TypeScript; only the ArkTS-specific .ets extension
        // needs an explicit mapping.
        '--force-lang=ArkTs,ets',
      ], { cwd: stageDirectory });
      const start = output.indexOf('{');
      const end = output.lastIndexOf('}');
      if (start === -1 || end === -1 || end < start) {
        throw new Error(`Failed to parse cloc JSON output for ${repoPath}`);
      }
      const parsed = JSON.parse(output.slice(start, end + 1));
      totalCodeLines += Number(parsed.SUM && parsed.SUM.code) || 0;
    }
  } finally {
    fs.rmSync(listDirectory, { recursive: true, force: true });
  }
  return totalCodeLines;
}

function scopeIgnorePatterns(patterns, repoPath) {
  if (!repoPath || !Array.isArray(patterns)) {
    return patterns;
  }
  const normalizedRoot = path.resolve(repoPath).split(path.sep).join('/').replace(/\/+$/, '');
  return patterns.map((pattern) => {
    const normalizedPattern = String(pattern).replace(/\\/g, '/').replace(/^\/+/, '');
    return path.isAbsolute(pattern) ? pattern : `${normalizedRoot}/${normalizedPattern}`;
  });
}

function scopeRuleConfigIgnores(config, repoPath) {
  return {
    ...config,
    ...(Array.isArray(config.ignore) ? { ignore: scopeIgnorePatterns(config.ignore, repoPath) } : {}),
    ...(Array.isArray(config.excluded) ? { excluded: scopeIgnorePatterns(config.excluded, repoPath) } : {}),
    ...(Array.isArray(config.overrides)
      ? { overrides: config.overrides.map((override) => scopeRuleConfigIgnores(override, repoPath)) }
      : {}),
  };
}

function buildMultiRuleConfig(baseConfig, rules, packagePath, repoPath) {
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
    ...scopeRuleConfigIgnores(baseConfig, repoPath),
    extRuleSet: [{
      ...baseRuleSet,
      packagePath: resolvedPackagePath,
      extRules,
    }],
  };
}

function buildProjectConfig(baseProjectConfig, repoName, repoPath, reportDir, logPath, arkCheckPath, checkPath) {
  return {
    ...baseProjectConfig,
    projectName: repoName,
    projectPath: ensureTrailingSeparator(path.resolve(repoPath)),
    reportDir,
    logPath,
    arkCheckPath,
    ...(checkPath ? { checkPath } : {}),
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
    fileConcurrency,
    packagePath,
    arkCheckPath,
    perfEnabled,
    selectedFiles,
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
  const tempCheckPath = selectedFiles
    ? path.join(tmpConfigDir, `checkPath.${toSafeName(repo.name)}.json`)
    : '';
  const generatedIssuesPath = path.join(reportDir, 'issuesReport.json');
  const fallbackIssuesPath = path.join(cwd, 'report', 'issuesReport.json');
  const generatedPerfPath = path.join(cwd, 'report', 'perfReport.json');
  const savedIssuesPath = path.join(runDir, 'issuesReport.json');
  const savedPerfPath = path.join(runDir, 'perfReport.json');
  const memoryTimelinePath = path.join(runDir, 'memoryTimeline.ndjson');
  const homecheckLogPath = logPath;

  ensureDir(runDir);
  ensureDir(reportDir);
  if (selectedFiles) {
    writeJson(tempCheckPath, {
      checkPath: selectedFiles.map((file) => ({ filePath: file.absolutePath, fixKey: [] })),
    });
  }
  writeJson(
    tempProjectConfigPath,
    buildProjectConfig(
      baseProjectConfig,
      repo.name,
      repoPath,
      reportDir,
      logPath,
      resolvedArkCheckPath,
      tempCheckPath,
    ),
  );
  writeJson(tempRuleConfigPath, buildMultiRuleConfig(baseRuleConfig, rules, resolvedPackagePath, repoPath));

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
      '--require',
      path.join(__dirname, 'fsConcurrencyLimit.js'),
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
        HOMECHECK_FILE_CONCURRENCY: String(fileConcurrency),
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
  lines.push('| 仓库 | .ets/.ts 代码行数 | 异味类型 | 检测耗时（不含预处理）(s) | 告警对象数 | 告警指标数 | 检测吞吐 (行/s) | 检测吞吐 (万行/s) | ≥2万行/s |');
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
  console.log('  --fileConcurrency=<n>          Maximum concurrently open async files (default 1)');
  console.log('  --dashboard=false              Disable live HTTP dashboard (final HTML is still written)');
  console.log('  --dashboardPort=<n>            Dashboard port, default 0 selects a free local port');
  console.log('  --perf=false                   Disable CLOC and performance collection (enabled by default)');
  console.log('  --f1=false                     Disable dataset F1 evaluation');
  console.log('  --datasetDir=<path>            Override projectConfig.datasetDir; empty config disables F1');
  console.log('  --f1Repos=a,b                  Only run selected dataset repository names');
  console.log('  --files=a.ets,b.ts             Scan only relative files in the single configured repo');
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
  if (current && current.startedMs) {
    const memorySamples = current.kind === 'scan'
      ? readMemoryTimeline(current.memoryTimelinePath)
      : [];
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
  const rawArgs = process.argv.slice(2);
  const args = parseArgs(rawArgs);
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
  const timeoutMs = args.timeoutMs ? Number(args.timeoutMs) : 60 * 60 * 1000;
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
  const commandLineFiles = parseFileSelectors(args.files);
  const fileSelectors = commandLineFiles.length > 0
    ? commandLineFiles
    : parseFileSelectors(baseProjectConfig.checkFiles);
  const configuredFileConcurrency = args.fileConcurrency !== undefined
    ? args.fileConcurrency
    : baseProjectConfig.fileConcurrency;
  const fileConcurrency = configuredFileConcurrency !== undefined
    ? Number(configuredFileConcurrency)
    : 1;
  if (!Number.isInteger(fileConcurrency) || fileConcurrency <= 0) {
    throw new Error(`fileConcurrency should be a positive integer, got: ${configuredFileConcurrency}`);
  }
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
  const configuredRepos = parseRepos(baseProjectConfig.repos);
  const configuredDatasetDir = typeof baseProjectConfig.datasetDir === 'string'
    ? baseProjectConfig.datasetDir.trim()
    : '';
  const datasetDirValue = args.datasetDir !== undefined
    ? String(args.datasetDir).trim()
    : configuredDatasetDir;
  const f1Requested = args.f1 !== 'false' && datasetDirValue.length > 0 && fileSelectors.length === 0;

  if (fileSelectors.length > 0 && args.f1 !== 'false' && datasetDirValue.length > 0) {
    console.log('[files] 指定文件模式不计算整库 F1，已自动跳过数据集评估');
  }

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
  const labeledRepoNames = new Set(groundTruth ? groundTruth.repoNames : []);
  let repoWorkItems;
  if (configuredRepos.length > 0) {
    const knownRepoUrls = new Map([
      ...REPOSITORIES.map((repo) => [repo.name, repo.url]),
      ...buildDatasetRepos([...labeledRepoNames]).map((repo) => [repo.name, repo.url]),
    ]);
    const seenNames = new Set();
    repoWorkItems = configuredRepos.map((configuredRepo) => {
      if (seenNames.has(configuredRepo.name)) {
        throw new Error(`repos 中存在重复仓库名: ${configuredRepo.name}`);
      }
      seenNames.add(configuredRepo.name);
      const defaultLocalPath = path.join(reposRoot, configuredRepo.name);
      const explicitLocalPath = configuredRepo.localPath
        ? path.resolve(cwd, configuredRepo.localPath)
        : null;
      const localPath = explicitLocalPath || (fs.existsSync(defaultLocalPath) ? defaultLocalPath : null);
      const url = configuredRepo.url || knownRepoUrls.get(configuredRepo.name);
      if (!localPath && !url) {
        throw new Error(
          `仓库不存在: ${defaultLocalPath}；请创建该目录或在 repos 中为 ${configuredRepo.name} 指定路径/地址`,
        );
      }
      if (explicitLocalPath && !fs.existsSync(explicitLocalPath)) {
        throw new Error(`repos 本地路径不存在: ${explicitLocalPath}`);
      }
      return {
        repo: { name: configuredRepo.name, url: url || explicitLocalPath },
        group: f1Requested && labeledRepoNames.has(configuredRepo.name) ? 'dataset' : 'benchmark',
        cloneRoot: reposRoot,
        localPath,
      };
    });
    datasetRepos = repoWorkItems
      .filter((item) => item.group === 'dataset')
      .map((item) => item.repo);
  } else {
    // 兼容旧配置与命令行：includeRepos 筛选内置/数据集仓库，extraRepos 追加仓库。
    const datasetRepoNames = new Set(datasetRepos.map((repo) => repo.name));
    const benchmarkRepos = selectedRepos.filter((repo) => !datasetRepoNames.has(repo.name));
    const extraWorkItems = [];
    for (const extra of extraRepos) {
      if (datasetRepoNames.has(extra.name) || benchmarkRepos.some((repo) => repo.name === extra.name)) {
        console.log(`[repo] ${extra.name} 已在扫描列表中，跳过重复项`);
        continue;
      }
      extraWorkItems.push({
        repo: { name: extra.name, url: extra.url || path.resolve(cwd, extra.localPath) },
        group: 'benchmark',
        cloneRoot: reposRoot,
        localPath: extra.localPath ? path.resolve(cwd, extra.localPath) : null,
      });
    }
    repoWorkItems = [
      ...datasetRepos.map((repo) => ({ repo, group: 'dataset', cloneRoot: reposRoot })),
      ...benchmarkRepos.map((repo) => ({ repo, group: 'benchmark', cloneRoot: reposRoot })),
      ...extraWorkItems,
    ];
  }
  if (fileSelectors.length > 0) {
    if (repoWorkItems.length !== 1) {
      throw new Error('--files 仅支持 config/projectConfig.json 中恰好配置一个仓库');
    }
  }
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
      const selectedFiles = resolveSelectedFiles(
        cloneResult.path,
        fileSelectors.length > 0 ? fileSelectors : null,
      );
      if (selectedFiles) {
        console.log(`  [files] 只扫描 ${selectedFiles.length} 个指定文件`);
      }
      dashboardState.current = {
        kind: 'setup',
        label: `统计代码行数 ${repo.name}`,
        startedMs: Date.now(),
      };
      console.log('  [count] 正在统计 ArkTS/TypeScript 代码行数...');
      const etsLines = perfEnabled ? await countEtsLinesWithCloc(cloneResult.path, selectedFiles) : 0;
      console.log(`  [count] 完成，共 ${etsLines} 行 ArkTS/TypeScript`);
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
          fileConcurrency,
          packagePath,
          arkCheckPath,
          perfEnabled,
          selectedFiles,
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
  collectArkTsFiles,
  computeThroughput,
  computeThroughputWan,
  countIssues,
  countEtsLinesWithCloc,
  filterIssuesByRule,
  main,
  parseArgs,
  parseExtraRepos,
  parseFileSelectors,
  parseRepos,
  parseRepoFilter,
  readMemoryTimeline,
  resolveSelectedFiles,
  resolveClocInvocation,
  runRepositoryScan,
  scopeIgnorePatterns,
  snapshotDashboardState,
};
